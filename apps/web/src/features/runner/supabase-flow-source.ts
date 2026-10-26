import type {
  Json,
  MyFlowRow,
  RecentRunRow,
  ResolvedVersionRow,
  RunLogInsert,
} from '../../lib/database.types';
import type { Supabase } from '../../lib/supabase';
import type { FlowSource, FlowSummary, LoadedFlow, RecentRun } from './flow-source';
import type { RunLogger } from './run-log';

/** Server/network failure while reading flows (not "not found", which is `null`). */
export class FlowSourceError extends Error {
  constructor(readonly kind: 'network' | 'server') {
    super(`flow source ${kind} error`);
    this.name = 'FlowSourceError';
  }
}

/** The part of the Supabase client this source uses (lets tests pass a small fake). */
export type FlowSourceClient = Pick<Supabase, 'rpc' | 'from'>;

interface PgError {
  code?: string;
  message?: string;
}

function toError(error: PgError): FlowSourceError {
  // supabase-js reports fetch failures with an empty code.
  return new FlowSourceError(error.code ? 'server' : 'network');
}

function inputCount(definition: Json): number {
  if (definition && typeof definition === 'object' && !Array.isArray(definition)) {
    const slots = definition.inputSlots;
    if (Array.isArray(slots)) return slots.length;
  }
  return 0;
}

function summaryOf(
  row: Pick<MyFlowRow, 'code' | 'name' | 'description' | 'category' | 'instructions'>,
  count: number,
  versionNo: number | null,
): FlowSummary {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    ...(row.instructions ? { instructions: row.instructions } : {}),
    inputCount: count,
    ...(versionNo !== null ? { versionLabel: `v${versionNo}` } : {}),
  };
}

function asRecord(v: Json): Record<string, Json | undefined> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function recentRunOf(row: RecentRunRow): RecentRun {
  const values = asRecord(row.params);
  const defs = Array.isArray(row.param_defs) ? row.param_defs : [];
  const params: RecentRun['params'] = [];
  for (const d of defs) {
    const def = asRecord(d);
    const key = typeof def.key === 'string' ? def.key : null;
    const v = key ? values[key] : undefined;
    if (!key || v === undefined || v === null || typeof v === 'object') continue;
    params.push({
      key,
      label: typeof def.label === 'string' ? def.label : key,
      type: typeof def.type === 'string' ? def.type : 'string',
      value: String(v),
    });
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    flowName: row.flow_name,
    versionNo: row.version_no,
    params,
    status: row.status,
  };
}

/**
 * Flows from Supabase under the User's RLS (spec §7.3, §14.2): `my_flows` for the list,
 * `resolve_flow_version` for the definition effective on the as-of date, `run_logs` inserts for
 * metadata-only run logging, `my_recent_runs` for the history card.
 */
export class SupabaseFlowSource implements FlowSource, RunLogger {
  constructor(private readonly sb: FlowSourceClient) {}

  async list(asOf: string): Promise<FlowSummary[]> {
    const { data, error } = await this.sb.rpc('my_flows', { p_as_of: asOf });
    if (error) throw toError(error);
    return (data ?? []).map((r) => summaryOf(r, r.input_count, r.version_no));
  }

  async get(code: string, asOf: string): Promise<LoadedFlow | null> {
    const { data, error } = await this.sb.rpc('resolve_flow_version', {
      p_code: code,
      p_as_of: asOf,
    });
    if (error) throw toError(error);
    const row: ResolvedVersionRow | undefined = data?.[0];
    if (!row) return null;
    return {
      summary: summaryOf(row, inputCount(row.definition), row.version_no),
      definition: row.definition,
      version: {
        id: row.version_id,
        versionNo: row.version_no,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
        applies: row.applies,
      },
    };
  }

  async recentRuns(limit: number): Promise<RecentRun[]> {
    const { data, error } = await this.sb.rpc('my_recent_runs', { p_limit: limit });
    if (error) throw toError(error);
    return (data ?? []).map(recentRunOf);
  }

  async logRun(entry: RunLogInsert): Promise<void> {
    const { error } = await this.sb.from('run_logs').insert(entry);
    if (error) throw toError(error);
  }
}
