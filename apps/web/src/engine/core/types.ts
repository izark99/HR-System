import type { DataType } from '@hrflow/flow-schema';
import type { Decimal } from './decimal';

/**
 * In-memory value representation (pure-TS executor):
 * - string   → string
 * - integer  → number (safe integer)
 * - decimal  → Decimal (big.js), never a JS float
 * - boolean  → boolean
 * - date     → ISO string "YYYY-MM-DD" (calendar date, no timezone)
 * - datetime → ISO string "YYYY-MM-DDTHH:mm:ss" (local wall time, no timezone)
 * - blank    → null
 */
export type Value = string | number | boolean | Decimal | null;

export interface ColumnDef {
  key: string;
  type: DataType;
  /** Display header (Excel output). Falls back to `key`. */
  title?: string;
  /** Excel number format override, e.g. "#,##0.00". */
  numFmt?: string;
}

export type Row = Record<string, Value>;

export interface Table {
  columns: ColumnDef[];
  rows: Row[];
}

export type Translate = (key: string, params?: Record<string, unknown>) => string;

export interface EngineContext {
  /** Translator bound to the engine namespace; used for generated column titles. */
  t: Translate;
}

/** Error with an i18n message key (engine namespace) + params, so the UI can localize it. */
export class EngineError extends Error {
  readonly messageKey: string;
  readonly params: Record<string, unknown>;
  readonly nodeId: string | undefined;

  constructor(messageKey: string, params: Record<string, unknown> = {}, nodeId?: string) {
    super(messageKey);
    this.name = 'EngineError';
    this.messageKey = messageKey;
    this.params = params;
    this.nodeId = nodeId;
  }
}
