import type { Severity } from '@hrflow/flow-schema';

export type IssueRule =
  | 'file'
  | 'files'
  | 'sheet'
  | 'column'
  | 'required'
  | 'type'
  | 'unique'
  | 'regex'
  | 'min'
  | 'max'
  | 'rows';

export type IssueParams = Record<string, string | number>;

/**
 * One validation finding. `messageKey` is relative to the i18n `engine` namespace
 * (e.g. "validation.unique"); the UI renders it with `params`. `row` is the original
 * 1-based Excel row number.
 */
export interface ValidationIssue {
  severity: Severity;
  rule: IssueRule;
  messageKey: string;
  params: IssueParams;
  file?: string;
  sheet?: string;
  row?: number;
  /** Slot column key. */
  column?: string;
}

/** A row excluded as non-data (total/signature row). Informational, never blocks a run. */
export interface SkippedRow {
  file: string;
  sheet: string;
  row: number;
  messageKey: string;
  params: IssueParams;
}

export interface FileSummary {
  file: string;
  sheet?: string;
  dataRows: number;
  skippedRows: number;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  skippedRows: SkippedRow[];
  files: FileSummary[];
  errorCount: number;
  warningCount: number;
}

export function buildReport(
  issues: ValidationIssue[],
  skippedRows: SkippedRow[],
  files: FileSummary[],
): ValidationReport {
  return {
    issues,
    skippedRows,
    files,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
  };
}

/**
 * Render an issue (or skipped row) with the engine-namespace translator. The `type` param holds a
 * data type id and is localized here, so cell content is never re-interpreted by i18next.
 */
export function formatIssue(
  item: { messageKey: string; params: IssueParams },
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const params: Record<string, unknown> = { ...item.params };
  if (typeof params.type === 'string') params.type = t(`validation.type_${params.type}`);
  return t(item.messageKey, params);
}
