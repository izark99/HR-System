/**
 * Messages between the UI (main thread) and the engine worker. Types only: the main thread
 * imports this file with `import type`, so no engine code ends up in the main bundle.
 *
 * Everything here is structured-clone friendly: decimals cross the boundary as strings
 * ("-2", "0.5") and are formatted for display by the UI, never converted to float for math.
 */
import type { DataType, FlowDefinition } from '@hrflow/flow-schema';
import type { NodeRunStats, RunProgressEvent } from './core/executor';
import type { ValidationReport } from './io/validation';

export type { RunProgressEvent, NodeRunStats, ValidationReport };

/** A file picked by the User. `File` objects are cloned by reference (no copy of the bytes). */
export interface UploadFile {
  name: string;
  blob: Blob;
}

export type LoadFlowResult = { ok: true; flow: FlowDefinition } | { ok: false; problems: string[] };

export interface SlotValidation {
  slotKey: string;
  report: ValidationReport;
  /** Data rows after union (only meaningful when the report has no errors). */
  rowCount: number;
}

/** Error raised by the engine, localizable by the UI (engine i18n namespace). */
export interface EngineErrorInfo {
  messageKey: string;
  params: Record<string, unknown>;
  nodeId?: string;
}

export type CellValue = string | number | boolean | null;

export interface ColumnInfo {
  key: string;
  title: string;
  type: DataType;
}

/** Which output of `control.compare` feeds the sheet ("table" for other nodes). */
export type SheetRole = 'summary' | 'mismatched' | 'only_left' | 'only_right' | 'table';

export interface SheetInfo {
  id: string;
  name: string;
  role: SheetRole;
  rowCount: number;
  columns: ColumnInfo[];
}

export interface CompareKpis {
  matched: number;
  mismatched: number;
  onlyLeft: number;
  onlyRight: number;
  sideLabels: { left: string; right: string };
  metrics: { label: string; tolerance: string }[];
}

export interface ArtifactInfo {
  index: number;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface RunSummary {
  durationMs: number;
  nodes: NodeRunStats[];
  inputs: { slotKey: string; label: string; rows: number }[];
  sheets: SheetInfo[];
  compare: CompareKpis | null;
  artifacts: ArtifactInfo[];
}

export type RunOutcome =
  { ok: true; summary: RunSummary } | { ok: false; cancelled: boolean; error: EngineErrorInfo };

export interface RowFilter {
  column: string;
  /** `eq`: cell equals value. `listIncludes`: cell is a ", "-separated list containing value. */
  op: 'eq' | 'listIncludes';
  value: string;
}

export interface RowQuery {
  offset: number;
  limit: number;
  filters?: RowFilter[];
}

export interface RowPage {
  /** Rows matching the filters. */
  total: number;
  offset: number;
  /** Cells in `SheetInfo.columns` order. */
  rows: CellValue[][];
  /** Per row: column keys to highlight (e.g. diff cells of failing metrics). */
  highlights: string[][];
}

export interface FilterOption {
  column: string;
  title: string;
  op: RowFilter['op'];
  values: string[];
  /** `metric`: the list of failing metrics; `column`: a carried column such as the branch. */
  kind: 'metric' | 'column';
}

export interface FileDownload {
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
}

export type ParamValues = Record<string, string | number | boolean | null>;
