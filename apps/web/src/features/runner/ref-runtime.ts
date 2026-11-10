import type { FlowDefinition } from '@hrflow/flow-schema';
import { flowRefTables } from '@hrflow/flow-schema/ref-tables';
import type { RefColumnDef } from '../../engine/core/types';
import type { RefLoadStatus, RefTablePayload } from '../../engine/io/ref-data';
import type { ParamValues } from '../../engine/protocol';
import { asOfFromParams } from './as-of';
import {
  effectiveVersion,
  loadRefCatalog,
  loadRefRows,
  refParamOptions,
  type RefClient,
  type RefTableMeta,
  type RefVersionInfo,
} from './ref-source';

/**
 * Reference tables of the run page (spec §34 AC-RT-08, 10, 15): which version of each table the
 * flow uses applies on the chosen period, its rows (loaded once per run-page open, RAM only) and
 * the options of list params taken from a table. Imported lazily by the run store, so none of
 * this reaches the app entry.
 */

/** One table the flow uses, for the "Phiên bản áp dụng" box. */
export interface RefUse {
  code: string;
  name: string;
  /** Effective version on the as-of date (null: none). */
  version: RefVersionInfo | null;
  /** `missing`: no effective version; `type`: cells that do not fit `column` (title). */
  problem: 'missing' | 'type' | null;
  column?: string;
  /** Current columns of the table ("Xem bảng"). */
  columns: RefColumnDef[];
}

/** Options of a list param taken from a table (or why there are none). */
export interface RefParamState {
  table: string;
  options: { value: string; label: string }[];
  /** `missing`: no effective version on the date used for this param. */
  problem: 'missing' | null;
}

export interface RefState {
  /** `none`: the flow uses no table; `blocked`: a table has no usable version (Run locked). */
  status: 'none' | 'loading' | 'ok' | 'blocked' | 'error';
  tables: RefUse[];
  params: Record<string, RefParamState>;
}

export const NO_REFS: RefState = { status: 'none', tables: [], params: {} };

export interface ResolvedRefs {
  tables: RefUse[];
  params: Record<string, RefParamState>;
  /** Rows for the worker: tables read by `input.refTable` nodes with an effective version. */
  payload: RefTablePayload[];
}

/** Codes of the tables read by `input.refTable` nodes (list-param tables stay on this thread). */
function nodeTables(flow: FlowDefinition): Set<string> {
  return new Set(
    flow.nodes
      .filter((n) => n.type === 'input.refTable')
      .map((n) => (n.config as { refTable?: unknown }).refTable)
      .filter((c): c is string => typeof c === 'string'),
  );
}

/** Loads and caches what one run-page open needs. */
export class RefLoader {
  private catalog: Promise<RefTableMeta[]> | null = null;
  private catalogKey = '';
  private readonly rows = new Map<string, Promise<unknown[]>>();

  constructor(private readonly client: RefClient) {}

  private tables(codes: string[]): Promise<RefTableMeta[]> {
    const key = codes.join(',');
    if (!this.catalog || key !== this.catalogKey) {
      this.catalogKey = key;
      this.catalog = loadRefCatalog(this.client, codes);
      // A failure is not cached: "Thử lại" asks again.
      this.catalog.catch(() => {
        if (this.catalogKey === key) this.catalog = null;
      });
    }
    return this.catalog;
  }

  /** Rows of a version, fetched once per open. */
  rowsOf(versionId: string): Promise<unknown[]> {
    let p = this.rows.get(versionId);
    if (!p) {
      p = loadRefRows(this.client, versionId);
      this.rows.set(versionId, p);
      p.catch(() => this.rows.delete(versionId));
    }
    return p;
  }

  async resolve(flow: FlowDefinition, values: ParamValues, today: string): Promise<ResolvedRefs> {
    const codes = flowRefTables(flow);
    const metas = await this.tables(codes);
    const asOf = asOfFromParams(flow.params, values, today);
    const byCode = new Map(metas.map((m) => [m.code, m]));
    const read = nodeTables(flow);
    const tables: RefUse[] = [];
    const payload: RefTablePayload[] = [];
    for (const code of codes) {
      const meta = byCode.get(code);
      const version = meta ? effectiveVersion(meta.versions, asOf) : null;
      tables.push({
        code,
        name: meta?.name ?? code,
        version,
        problem: version ? null : 'missing',
        columns: meta?.columns ?? [],
      });
      if (meta && version && read.has(code)) {
        payload.push({
          code,
          name: meta.name,
          versionId: version.id,
          versionNo: version.versionNo,
          columns: meta.columns,
          rows: await this.rowsOf(version.id),
        });
      }
    }
    const params: Record<string, RefParamState> = {};
    for (const p of flow.params) {
      const o = p.options;
      if (!o || Array.isArray(o)) continue;
      const meta = byCode.get(o.fromRefTable);
      // A list param used as the as-of date itself cannot depend on it: today's version.
      const version = meta ? effectiveVersion(meta.versions, p.isAsOfDate ? today : asOf) : null;
      params[p.key] = {
        table: meta?.name ?? o.fromRefTable,
        options: version
          ? refParamOptions(await this.rowsOf(version.id), o.valueColumn, o.labelColumn)
          : [],
        problem: version ? null : 'missing',
      };
    }
    return { tables, params, payload };
  }
}

/** Final state once the worker checked the rows against the current column types. */
export function refStateOf(resolved: ResolvedRefs, statuses: readonly RefLoadStatus[]): RefState {
  const tables = resolved.tables.map((t) => {
    const s = statuses.find((x) => x.code === t.code);
    return s && !s.ok ? { ...t, problem: 'type' as const, column: s.column } : t;
  });
  return {
    status: tables.length === 0 ? 'none' : tables.some((t) => t.problem) ? 'blocked' : 'ok',
    tables,
    params: resolved.params,
  };
}

/** `{ CODE: versionId }` of the run log (no data, AC-RT-08). */
export function refVersionsOf(state: RefState): Record<string, string> {
  return Object.fromEntries(
    state.tables.filter((t) => t.version).map((t) => [t.code, t.version!.id]),
  );
}
