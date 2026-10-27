import type { FlowParam } from '@hrflow/flow-schema';
import type { EngineErrorInfo, ParamValues, RunSummary } from '../../engine/protocol';
import type { RunLogInsert, RunLogStatus } from '../../lib/database.types';

/**
 * Run log = METADATA ONLY (spec §7.1, MEMORY "Dữ liệu & tuân thủ"): flow version, logged params,
 * per slot the SHA-256 of each original file NAME (names can contain people's names) + byte size
 * + row count, status, duration, output row count, error i18n key and node id. Never file
 * content, cell values, sheet data, or error params/raw messages. The database CHECK constraints
 * enforce the same shape.
 */

export interface RunLogger {
  /** Must not throw into the run: callers ignore failures. */
  logRun(entry: RunLogInsert): Promise<void>;
}

export interface RunLogInput {
  flowVersionId: string;
  flowParams: readonly FlowParam[];
  params: ParamValues;
  slots: { key: string; files: readonly { name: string; size: number }[]; rows: number | null }[];
  status: RunLogStatus;
  durationMs: number;
  summary: RunSummary | null;
  error: EngineErrorInfo | null;
}

const ERROR_CODE = /^[A-Za-z][A-Za-z0-9_.]{0,99}$/;
const NODE_ID = /^[a-z_][a-z0-9_]{0,63}$/;
const PARAM_KEY = /^[a-z_][a-z0-9_]{0,63}$/;
const MAX_PARAM_LENGTH = 100;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Default-deny for free text: `string` params are logged only when the Admin sets `log: true`
 * explicitly; other types unless `log: false`.
 */
export function isParamLogged(p: Pick<FlowParam, 'type' | 'log'>): boolean {
  return p.log ?? p.type !== 'string';
}

/** Only params that may be logged (see isParamLogged), as small scalars. */
function loggedParams(
  flowParams: readonly FlowParam[],
  values: ParamValues,
): RunLogInsert['params'] {
  const out: RunLogInsert['params'] = {};
  for (const p of flowParams) {
    if (!isParamLogged(p) || !PARAM_KEY.test(p.key)) continue;
    const v = values[p.key];
    if (v === undefined || v === null || v === '') continue;
    out[p.key] = typeof v === 'string' ? v.trim().slice(0, MAX_PARAM_LENGTH) : v;
  }
  return out;
}

export async function buildRunLog(input: RunLogInput): Promise<RunLogInsert> {
  const inputs_meta = await Promise.all(
    input.slots.map(async (s) => ({
      slot: s.key,
      rows: Math.max(0, Math.trunc(s.rows ?? 0)),
      files: await Promise.all(
        s.files.map(async (f) => ({ sha256: await sha256Hex(f.name), size: f.size })),
      ),
    })),
  );
  const rowsOut = input.summary
    ? input.summary.sheets.reduce(
        (n, sheet) => (sheet.kind === 'preview' ? n : n + sheet.rowCount),
        0,
      )
    : null;
  const code = input.error?.messageKey;
  const nodeId = input.error?.nodeId;
  return {
    flow_version_id: input.flowVersionId,
    params: loggedParams(input.flowParams, input.params),
    inputs_meta,
    status: input.status,
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    rows_out: rowsOut,
    error_code: input.status === 'failed' && code && ERROR_CODE.test(code) ? code : null,
    error_node_id: input.status === 'failed' && nodeId && NODE_ID.test(nodeId) ? nodeId : null,
    client_info: null,
  };
}
