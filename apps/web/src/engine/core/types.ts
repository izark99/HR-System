import type { DataType, FlowDefinition } from '@hrflow/flow-schema';
import type { SlotReadResult } from '../io/excel-reader';
import type { DuckDbProvider } from '../duckdb/base';
import type { Decimal } from './decimal';
import { Table } from './table';

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

/** Tables are columnar (`core/table.ts`); `Table.fromRows` builds one from row objects. */
export { Table };

export type Translate = (key: string, params?: Record<string, unknown>) => string;

export interface EngineContext {
  /** Translator bound to the engine namespace; used for generated column titles. */
  t: Translate;
  /** The flow being designed/run (input slots etc.). Absent in isolated node tests. */
  flow?: FlowDefinition;
  /** Run-scoped services; only present while the executor runs a node. */
  run?: RunServices;
  /** Opens DuckDB on demand (design-time `code.sql` schema via DESCRIBE). */
  duck?: DuckDbProvider;
}

/** Runtime parameter value as entered by the User (e.g. month "2026-09"). */
export type ParamValue = string | number | boolean | null;

/** A file produced by an output node (kept in the browser, offered as a download). */
export interface RunArtifact {
  nodeId: string;
  fileName: string;
  mimeType: string;
  data: Uint8Array;
}

/** Warning raised while running (e.g. `join.warning.rowsMultiplied`); counts only, no values. */
export interface RunWarning {
  nodeId: string;
  messageKey: string;
  params: Record<string, unknown>;
}

/**
 * A view-only result of `output.preview` (spec §12.1.10): kept in the worker's memory, never a
 * file, never sent anywhere.
 */
export interface RunView {
  nodeId: string;
  title: string;
  table: Table;
  /** Rows of the input before `maxRows` was applied. */
  totalRows: number;
}

export interface RunServices {
  nodeId: string;
  params: Readonly<Record<string, ParamValue>>;
  /** Read + validate the files of an input slot (the caller may serve a cached result). */
  readSlot(slotKey: string): SlotReadResult | Promise<SlotReadResult>;
  emitArtifact(artifact: Omit<RunArtifact, 'nodeId'>): void;
  emitView(view: Omit<RunView, 'nodeId'>): void;
  warn(warning: Omit<RunWarning, 'nodeId'>): void;
  signal: AbortSignal | undefined;
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
