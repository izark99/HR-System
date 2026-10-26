import {
  CompareConfigSchema,
  FlowDefinitionSchema,
  migrateFlowDefinition,
  type CompareConfig,
  type FlowDefinition,
} from '@hrflow/flow-schema';
import { isDecimal } from './core/decimal';
import { isCancelled, planFlow, runFlow, type RunFlowResult } from './core/executor';
import { createEngineTranslator } from './core/i18n';
import { EngineError, type Table, type Translate, type Value } from './core/types';
import { readSlot, type SlotReadResult, type SourceFile } from './io/excel-reader';
import { writeWorkbook } from './io/excel-writer';
import { formatIssue } from './io/validation';
import { compareDiffColumns, MISMATCHED_METRICS_COLUMN } from './nodes/control-compare';
import { XLSX_MIME } from './nodes/output-excel';
import type {
  CellValue,
  CompareKpis,
  EngineErrorInfo,
  FileDownload,
  FilterOption,
  LoadFlowResult,
  ParamValues,
  RowFilter,
  RowPage,
  RowQuery,
  RunOutcome,
  RunProgressEvent,
  RunSummary,
  SheetInfo,
  SheetRole,
  SlotValidation,
  UploadFile,
} from './protocol';
import { ENGINE_CRASHED_KEY } from './protocol';

/** Max distinct values for a carried column to be offered as a filter (e.g. branch). */
const MAX_FILTER_VALUES = 50;
const LIST_SEPARATOR = ', ';

interface SheetState {
  info: SheetInfo;
  table: Table;
  /** For `mismatched`: metric label → diff column key. */
  diffColumns: { label: string; key: string }[];
  carryColumns: string[];
  filterCache: { key: string; indexes: number[] } | null;
}

function toCell(v: Value | undefined): CellValue {
  if (v === undefined || v === null) return null;
  return isDecimal(v) ? v.toString() : v;
}

export function errorInfo(err: unknown): EngineErrorInfo {
  if (err instanceof EngineError) {
    return {
      messageKey: err.messageKey,
      params: err.params,
      ...(err.nodeId ? { nodeId: err.nodeId } : {}),
    };
  }
  // Unexpected (non-engine) failure: never forward the raw exception text. It may contain cell
  // values, and this object is what the UI shows and a future run log would record.
  return { messageKey: ENGINE_CRASHED_KEY, params: {} };
}

/**
 * Engine state of one browser tab, living inside the worker: the loaded flow, the files per slot,
 * the cached slot read results (so a run does not parse the files again) and the last run's
 * tables. Nothing here is persisted or sent anywhere.
 */
export class EngineSession {
  private readonly t: Translate;
  private flow: FlowDefinition | null = null;
  private readonly slotResults = new Map<string, SlotReadResult>();
  /** Latest `setSlotFiles` version seen per slot. */
  private readonly slotVersions = new Map<string, number>();
  private sheets: SheetState[] = [];
  private artifacts: RunFlowResult['artifacts'] = [];
  private abort: AbortController | null = null;

  constructor(lng: 'vi' | 'en' = 'vi') {
    this.t = createEngineTranslator(lng);
  }

  loadFlow(raw: unknown): LoadFlowResult {
    this.reset();
    // Published versions must stay loadable: old shapes are upgraded in memory first (spec §8).
    const migrated = migrateFlowDefinition(raw);
    const notices = migrated.notes.map((n) => this.t(`flow.migration.${n.code}`, { slot: n.slot }));
    const parsed = FlowDefinitionSchema.safeParse(migrated.definition);
    if (!parsed.success) {
      return {
        ok: false,
        problems: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    }
    try {
      planFlow(parsed.data);
    } catch (err) {
      const info = errorInfo(err);
      return { ok: false, problems: [this.t(info.messageKey, info.params)] };
    }
    this.flow = parsed.data;
    return { ok: true, flow: parsed.data, notices };
  }

  private requireFlow(): FlowDefinition {
    if (!this.flow) throw new Error('flow not loaded');
    return this.flow;
  }

  private reset(): void {
    this.flow = null;
    this.slotResults.clear();
    this.slotVersions.clear();
    this.clearRun();
  }

  private clearRun(): void {
    this.sheets = [];
    this.artifacts = [];
  }

  /**
   * Replace the files of one slot, then read + validate them (cached for the run).
   *
   * `version` must grow with every call for the slot (the UI bumps it on each file change).
   * Calls overlap while file bytes are being read; only the latest version may change the cache,
   * so an older call finishing late can neither restore stale files nor drop newer ones.
   * Returns `null` when the call was superseded (nothing committed).
   */
  async setSlotFiles(
    slotKey: string,
    files: readonly UploadFile[],
    version?: number,
  ): Promise<SlotValidation | null> {
    const slot = this.requireFlow().inputSlots.find((s) => s.key === slotKey);
    if (!slot) throw new EngineError('executor.error.unknownSlot', { slot: slotKey });
    const latest = this.slotVersions.get(slotKey) ?? 0;
    if (version !== undefined && version < latest) return null;
    const mine = version ?? latest + 1;
    this.slotVersions.set(slotKey, mine);
    const isLatest = () => this.slotVersions.get(slotKey) === mine;

    const sources: SourceFile[] = [];
    for (const f of files) {
      const data = await f.blob.arrayBuffer();
      if (!isLatest()) return null;
      sources.push({ name: f.name, data });
    }
    if (!isLatest()) return null;
    // Synchronous from here on: no newer call can interleave before the commit.
    const result = readSlot(slot, sources);
    this.clearRun();
    if (files.length > 0) this.slotResults.set(slotKey, result);
    else this.slotResults.delete(slotKey);
    return { slotKey, report: result.report, rowCount: result.table.rows.length };
  }

  async run(
    params: ParamValues,
    onProgress?: (event: RunProgressEvent) => void,
  ): Promise<RunOutcome> {
    const flow = this.requireFlow();
    this.clearRun();
    this.abort = new AbortController();
    try {
      const result = await runFlow(flow, {
        t: this.t,
        params,
        signal: this.abort.signal,
        ...(onProgress ? { onProgress } : {}),
        readSlot: (key) => {
          const slot = flow.inputSlots.find((s) => s.key === key);
          if (!slot) throw new EngineError('executor.error.unknownSlot', { slot: key });
          return this.slotResults.get(key) ?? readSlot(slot, []);
        },
      });
      return { ok: true, summary: this.collect(flow, result) };
    } catch (err) {
      return { ok: false, cancelled: isCancelled(err), error: errorInfo(err) };
    } finally {
      this.abort = null;
    }
  }

  cancel(): void {
    this.abort?.abort();
  }

  private collect(flow: FlowDefinition, result: RunFlowResult): RunSummary {
    const plan = planFlow(flow);
    const sheets: SheetState[] = [];
    let compare: CompareKpis | null = null;

    for (const step of plan) {
      if (step.node.type === 'control.compare' && !compare) {
        compare = this.compareKpis(step.config as CompareConfig, result.outputs[step.node.id]!);
      }
      if (step.node.type !== 'output.excel') continue;
      const cfg = step.config as { sheets: { name: string; port: string }[] };
      for (const sheet of cfg.sheets) {
        const link = step.inputs.find((l) => l.port === sheet.port);
        const table = link ? result.outputs[link.from]?.[link.fromPort] : undefined;
        if (!link || !table) continue;
        const source = plan.find((p) => p.node.id === link.from)!;
        let role: SheetRole = 'table';
        let diffColumns: SheetState['diffColumns'] = [];
        let carryColumns: string[] = [];
        if (source.node.type === 'control.compare') {
          role = link.fromPort as SheetRole;
          const cc = CompareConfigSchema.parse(source.node.config);
          if (role === 'mismatched') {
            diffColumns = compareDiffColumns(cc);
            carryColumns = cc.carryColumns.filter((c) => !cc.keys.includes(c));
          }
        }
        sheets.push({
          info: {
            id: `${step.node.id}:${sheets.length}`,
            name: sheet.name,
            role,
            rowCount: table.rows.length,
            columns: table.columns.map((c) => ({
              key: c.key,
              title: c.title ?? c.key,
              type: c.type,
            })),
          },
          table,
          diffColumns,
          carryColumns,
          filterCache: null,
        });
      }
    }
    this.sheets = sheets;
    this.artifacts = result.artifacts;

    const inputs = plan
      .filter((p) => p.node.type === 'input.excel')
      .map((p) => {
        const slotKey = (p.config as { slot: string }).slot;
        const slot = flow.inputSlots.find((s) => s.key === slotKey);
        return {
          slotKey,
          label: slot?.label ?? slotKey,
          rows: Object.values(result.outputs[p.node.id] ?? {})[0]?.rows.length ?? 0,
        };
      });

    return {
      durationMs: result.durationMs,
      nodes: result.nodes,
      inputs,
      sheets: sheets.map((s) => s.info),
      compare,
      artifacts: result.artifacts.map((a, index) => ({
        index,
        fileName: a.fileName,
        mimeType: a.mimeType,
        size: a.data.byteLength,
      })),
    };
  }

  private compareKpis(config: CompareConfig, outputs: Record<string, Table>): CompareKpis | null {
    const rows = outputs.summary?.rows;
    const total = rows?.[rows.length - 1];
    if (!rows || !total) return null;
    const num = (v: Value | undefined) => (typeof v === 'number' ? v : 0);
    return {
      matched: num(total.matched),
      mismatched: num(total.mismatched),
      onlyLeft: num(total.only_left),
      onlyRight: num(total.only_right),
      sideLabels: {
        left: config.sideLabels?.left ?? this.t('compare.side.left'),
        right: config.sideLabels?.right ?? this.t('compare.side.right'),
      },
      metrics: rows.slice(0, -1).map((r) => ({
        label: String(r.metric),
        tolerance: String(toCell(r.tolerance) ?? '0'),
      })),
    };
  }

  private sheet(sheetId: string): SheetState {
    const s = this.sheets.find((x) => x.info.id === sheetId);
    if (!s) throw new Error('unknown sheet');
    return s;
  }

  private filtered(s: SheetState, filters: readonly RowFilter[]): number[] | null {
    if (filters.length === 0) return null;
    const key = JSON.stringify(filters);
    if (s.filterCache?.key === key) return s.filterCache.indexes;
    const indexes: number[] = [];
    s.table.rows.forEach((row, i) => {
      const ok = filters.every((f) => {
        const cell = toCell(row[f.column]);
        const text = cell === null ? '' : String(cell);
        return f.op === 'eq' ? text === f.value : text.split(LIST_SEPARATOR).includes(f.value);
      });
      if (ok) indexes.push(i);
    });
    s.filterCache = { key, indexes };
    return indexes;
  }

  getRows(sheetId: string, query: RowQuery): RowPage {
    const s = this.sheet(sheetId);
    const indexes = this.filtered(s, query.filters ?? []);
    const total = indexes ? indexes.length : s.table.rows.length;
    const offset = Math.max(0, Math.min(query.offset, total));
    const end = Math.min(total, offset + Math.max(0, query.limit));
    const keys = s.info.columns.map((c) => c.key);
    const rows: CellValue[][] = [];
    const highlights: string[][] = [];
    for (let i = offset; i < end; i++) {
      const row = s.table.rows[indexes ? indexes[i]! : i]!;
      rows.push(keys.map((k) => toCell(row[k])));
      const failed = String(row[MISMATCHED_METRICS_COLUMN] ?? '').split(LIST_SEPARATOR);
      highlights.push(s.diffColumns.filter((d) => failed.includes(d.label)).map((d) => d.key));
    }
    return { total, offset, rows, highlights };
  }

  getFilterOptions(sheetId: string): FilterOption[] {
    const s = this.sheet(sheetId);
    if (s.info.role !== 'mismatched') return [];
    const options: FilterOption[] = [];
    for (const key of s.carryColumns) {
      const col = s.info.columns.find((c) => c.key === key);
      if (!col) continue;
      const values = new Set<string>();
      for (const row of s.table.rows) {
        const v = toCell(row[key]);
        if (v !== null && v !== '') values.add(String(v));
        if (values.size > MAX_FILTER_VALUES) break;
      }
      // Only low-cardinality columns (e.g. branch) make useful filters; names do not.
      if (values.size < 2 || values.size > MAX_FILTER_VALUES || values.size >= s.table.rows.length)
        continue;
      options.push({
        column: key,
        title: col.title,
        op: 'eq',
        values: [...values].sort((a, b) => a.localeCompare(b, 'vi')),
        kind: 'column',
      });
    }
    if (s.diffColumns.length > 0) {
      options.push({
        column: MISMATCHED_METRICS_COLUMN,
        title: s.info.columns.find((c) => c.key === MISMATCHED_METRICS_COLUMN)?.title ?? '',
        op: 'listIncludes',
        values: s.diffColumns.map((d) => d.label),
        kind: 'metric',
      });
    }
    return options;
  }

  /** A copy of the output file (the original stays available for repeated downloads). */
  getArtifact(index: number): FileDownload {
    const a = this.artifacts[index];
    if (!a) throw new Error('unknown artifact');
    return { fileName: a.fileName, mimeType: a.mimeType, data: a.data.slice().buffer };
  }

  /** Validation issues + skipped rows of every slot as an .xlsx to send back to file owners. */
  async validationReportFile(): Promise<FileDownload> {
    const flow = this.requireFlow();
    const t = this.t;
    const rows: Record<string, Value>[] = [];
    for (const slot of flow.inputSlots) {
      const result = this.slotResults.get(slot.key);
      if (!result) continue;
      const columnTitle = (key: string | undefined) => {
        const c = slot.columns.find((x) => x.key === key);
        return c ? (c.label ?? c.aliases[0] ?? c.key) : (key ?? null);
      };
      for (const i of result.report.issues) {
        rows.push({
          slot: slot.label,
          severity: t(`report.severity_${i.severity}`),
          file: i.file ?? null,
          sheet: i.sheet ?? null,
          row: i.row ?? null,
          column: columnTitle(i.column),
          message: formatIssue(i, t),
        });
      }
      for (const s of result.report.skippedRows) {
        rows.push({
          slot: slot.label,
          severity: t('report.severity_skipped'),
          file: s.file,
          sheet: s.sheet,
          row: s.row,
          column: null,
          message: formatIssue(s, t),
        });
      }
    }
    const columns = (
      ['slot', 'severity', 'file', 'sheet', 'row', 'column', 'message'] as const
    ).map((key) => ({
      key,
      type: key === 'row' ? ('integer' as const) : ('string' as const),
      title: t(`report.${key}`),
    }));
    const data = await writeWorkbook([{ name: t('report.sheetName'), table: { columns, rows } }]);
    return { fileName: t('report.fileName'), mimeType: XLSX_MIME, data: data.slice().buffer };
  }
}
