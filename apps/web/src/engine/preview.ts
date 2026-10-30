import {
  FlowDefinitionSchema,
  InputSlotSchema,
  migrateFlowDefinition,
  type FlowDefinition,
} from '@hrflow/flow-schema';
import { isDecimal } from './core/decimal';
import { runFlow } from './core/executor';
import { EngineError, type Table, type Translate, type Value } from './core/types';
import type { DuckDbProvider } from './duckdb/base';
import { readSlot, type SlotReadResult, type SourceFile } from './io/excel-reader';
import type {
  CellValue,
  ColumnInfo,
  EngineErrorInfo,
  ParamValues,
  SlotValidation,
  UploadFile,
} from './protocol';
import { ENGINE_CRASHED_KEY, type RunWarningInfo } from './protocol';

/**
 * Per-node preview in the Designer (spec §13.3, AC-B3-50..57). Sample files live only in this
 * worker's memory (never persisted, never sent anywhere, no run log); terminating the worker
 * (closing the Designer, idle sign-out, closing the tab) releases them.
 *
 * "Xem trước" runs the ancestors of the chosen node and the node itself, on the definition that
 * is on the canvas right now (saved or not), and returns the first 200 rows of each output port
 * with the total. Output nodes show what they receive (each sheet of `output.excel`, the columns
 * of `output.preview`); no file is created. Simplification allowed by the spec: every preview
 * re-runs all ancestors (no cache between previews).
 */

export const PREVIEW_ROWS = 200;

export interface PreviewTable {
  /** Output port, sheet name (output.excel) or title (output.preview). */
  name: string;
  columns: ColumnInfo[];
  rows: CellValue[][];
  total: number;
}

export type PreviewOutcome =
  | {
      ok: true;
      nodeId: string;
      tables: PreviewTable[];
      ran: string[];
      /** Run warnings of the previewed nodes (counts and row numbers only, e.g. formula errors). */
      warnings: RunWarningInfo[];
    }
  | { ok: false; error: EngineErrorInfo; ran: string[] };

function cell(v: Value | undefined): CellValue {
  if (v === undefined || v === null) return null;
  return isDecimal(v) ? v.toFixed() : v;
}

function head(name: string, table: Table): PreviewTable {
  const n = Math.min(table.rowCount, PREVIEW_ROWS);
  const rows: CellValue[][] = [];
  for (let i = 0; i < n; i++) rows.push(table.vectors.map((v) => cell(v.get(i))));
  return {
    name,
    columns: table.columns.map((c) => ({ key: c.key, title: c.title ?? c.key, type: c.type })),
    rows,
    total: table.rowCount,
  };
}

function info(err: unknown): EngineErrorInfo {
  if (err instanceof EngineError) {
    return {
      messageKey: err.messageKey,
      params: err.params,
      ...(err.nodeId ? { nodeId: err.nodeId } : {}),
    };
  }
  return { messageKey: ENGINE_CRASHED_KEY, params: {} };
}

/** Ids of `target` and all its ancestors. */
export function ancestorsOf(flow: FlowDefinition, target: string): Set<string> {
  const keep = new Set([target]);
  const stack = [target];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const e of flow.edges) {
      if (e.to === id && !keep.has(e.from)) {
        keep.add(e.from);
        stack.push(e.from);
      }
    }
  }
  return keep;
}

export class PreviewSession {
  private readonly samples = new Map<string, SourceFile[]>();

  constructor(
    private readonly t: Translate,
    private readonly duck?: DuckDbProvider,
  ) {}

  /** Keep the sample files of a slot (bytes only) and validate them with the given slot config. */
  async setSampleFiles(
    slotKey: string,
    files: readonly UploadFile[],
    slotConfig: unknown,
  ): Promise<SlotValidation | null> {
    const sources: SourceFile[] = [];
    for (const f of files) sources.push({ name: f.name, data: await f.blob.arrayBuffer() });
    if (sources.length === 0) this.samples.delete(slotKey);
    else this.samples.set(slotKey, sources);
    return this.validate(slotKey, slotConfig);
  }

  /** Validation report of the sample of a slot with the current slot config (null: no sample). */
  validate(slotKey: string, slotConfig: unknown): SlotValidation | null {
    const files = this.samples.get(slotKey);
    const slot = InputSlotSchema.safeParse(slotConfig);
    if (!files || !slot.success) return null;
    const r = readSlot(slot.data, files);
    return { slotKey, report: r.report, rowCount: r.table.rowCount };
  }

  clear(): void {
    this.samples.clear();
  }

  async preview(raw: unknown, nodeId: string, params: ParamValues): Promise<PreviewOutcome> {
    const ran: string[] = [];
    try {
      const parsed = FlowDefinitionSchema.safeParse(migrateFlowDefinition(raw).definition);
      if (!parsed.success) throw new EngineError('preview.error.flowInvalid');
      const flow = parsed.data;
      const node = flow.nodes.find((n) => n.id === nodeId);
      if (!node) throw new EngineError('preview.error.flowInvalid');
      const isOutput = node.type === 'output.excel' || node.type === 'output.preview';
      const keep = ancestorsOf(flow, nodeId);
      // An output node is shown through what it receives: run its ancestors only.
      if (isOutput) keep.delete(nodeId);
      const sub: FlowDefinition = {
        ...flow,
        nodes: flow.nodes.filter((n) => keep.has(n.id)),
        edges: flow.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
      };

      // Samples: a slot used by the sub-flow without a sample, or with errors, stops here.
      const reads = new Map<string, SlotReadResult>();
      for (const n of sub.nodes) {
        if (n.type !== 'input.excel') continue;
        const key = (n.config as { slot?: unknown }).slot;
        const slot = flow.inputSlots.find((s) => s.key === key);
        if (!slot) continue; // planFlow reports it
        const files = this.samples.get(slot.key);
        if (!files) throw new EngineError('preview.error.noSample', { slot: slot.label }, n.id);
        const r = readSlot(slot, files);
        if (r.report.errorCount > 0) {
          throw new EngineError('preview.error.sampleInvalid', { slot: slot.label }, n.id);
        }
        reads.set(slot.key, r);
      }

      const result = await runFlow(sub, {
        t: this.t,
        params,
        collect: isOutput ? edgesInto(flow, nodeId).map((e) => e.from) : [nodeId],
        ...(this.duck ? { duck: this.duck } : {}),
        onProgress: (e) => {
          if (e.type === 'node-started') ran.push(e.nodeId);
        },
        readSlot: (key) => {
          const r = reads.get(key);
          if (!r) throw new EngineError('executor.error.unknownSlot', { slot: key });
          return r;
        },
      });

      const warnings: RunWarningInfo[] = result.warnings.map((w) => ({ ...w }));
      if (!isOutput) {
        const outs = result.outputs[nodeId] ?? {};
        return {
          ok: true,
          warnings,
          nodeId,
          ran,
          tables: Object.entries(outs).map(([port, table]) => head(port, table)),
        };
      }
      const into = edgesInto(flow, nodeId);
      const input = (port: string) => {
        const e =
          into.find((x) => (x.toPort ?? 'in') === port) ?? (port === 'in' ? into[0] : undefined);
        if (!e) return undefined;
        const ports = result.outputs[e.from] ?? {};
        return e.fromPort ? ports[e.fromPort] : Object.values(ports)[0];
      };
      const cfg = node.config as {
        sheets?: { name: string; port: string }[];
        title?: string;
        columns?: string[];
      };
      if (node.type === 'output.excel') {
        return {
          ok: true,
          warnings,
          nodeId,
          ran,
          tables: (cfg.sheets ?? []).flatMap((s) => {
            const tbl = input(s.port);
            return tbl ? [head(s.name, tbl)] : [];
          }),
        };
      }
      const tbl = input('in');
      if (!tbl) return { ok: true, nodeId, ran, warnings, tables: [] };
      const cols = cfg.columns
        ? cfg.columns.flatMap((k) => tbl.columns.filter((c) => c.key === k))
        : tbl.columns;
      return {
        ok: true,
        warnings,
        nodeId,
        ran,
        tables: [head(cfg.title ?? nodeId, tbl.select(cols))],
      };
    } catch (err) {
      return { ok: false, error: info(err), ran };
    }
  }
}

function edgesInto(flow: FlowDefinition, nodeId: string) {
  return flow.edges.filter((e) => e.to === nodeId);
}
