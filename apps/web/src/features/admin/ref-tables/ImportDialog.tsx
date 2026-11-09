import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { denseTdClass, denseThClass } from '../../../components/DataTable';
import { Dialog, DialogFooter } from '../../../components/Dialog';
import { Checkbox } from '../../../components/FormField';
import { Button, Callout, Chip, cx, MiddleCut } from '../../../components/ui';
import type { RefImportResult } from '../../../engine/io/ref-import';
import { formatIssue, type ValidationIssue } from '../../../engine/io/validation';
import { EngineClient } from '../../runner/engine-client';
import {
  compactRow,
  formatCell,
  MAX_BYTES,
  MAX_ROWS,
  personalColumns,
  rowsBytes,
  type RefRow,
} from './model';
import { refErrorOf, refErrorText, type RefApiErrorKey, type RefTable } from './ref-tables-api';
import { useRefApi } from './shared';

/** Issues listed in the dialog (the counts cover all of them). */
const MAX_ISSUES = 50;

type Phase =
  | { kind: 'pick' }
  | { kind: 'reading'; name: string }
  | { kind: 'done'; name: string; result: RefImportResult; extra: ValidationIssue[] }
  | { kind: 'crashed'; name: string };

/**
 * "Import Excel vào draft" (spec §34 AC-RT-03): the engine worker reads and checks the file (same
 * reader and zip-bomb limits as the input slots), the dialog shows the report and the first 200
 * rows; "Thay dữ liệu draft" replaces every row of the draft (creates it when there is none).
 */
export function ImportDialog({
  open,
  table,
  draft,
  gridDirty = false,
  onClose,
  onDone,
}: {
  open: boolean;
  table: RefTable;
  /** The open draft (null: saving creates one). */
  draft: { versionNo: number; rowCount: number; updatedAt: string } | null;
  /** The data grid has unsaved edits (they would be lost). */
  gridDirty?: boolean;
  onClose: () => void;
  onDone: (versionNo: number) => void;
}) {
  const { t } = useTranslation('refTables');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={draft ? t('import.title', { version: draft.versionNo }) : t('import.titleNew')}
    >
      {open && (
        <ImportBody
          table={table}
          draft={draft}
          gridDirty={gridDirty}
          onCancel={onClose}
          onDone={onDone}
        />
      )}
    </Dialog>
  );
}

function ImportBody({
  table,
  draft,
  gridDirty,
  onCancel,
  onDone,
}: {
  table: RefTable;
  draft: { versionNo: number; rowCount: number; updatedAt: string } | null;
  gridDirty: boolean;
  onCancel: () => void;
  onDone: (versionNo: number) => void;
}) {
  const { t } = useTranslation('refTables');
  const { t: te } = useTranslation('engine');
  const api = useRefApi();
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' });
  const [dragging, setDragging] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RefApiErrorKey | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const engine = useRef<EngineClient | null>(null);
  // The file content lives in the worker only while the dialog is open.
  useEffect(
    () => () => {
      engine.current?.dispose();
      engine.current = null;
    },
    [],
  );

  async function read(file: File) {
    setPhase({ kind: 'reading', name: file.name });
    setError(null);
    setConfirmed(false);
    try {
      engine.current ??= new EngineClient();
      const result = await engine.current.api.refImport(
        { name: file.name, blob: file },
        table.columns,
        MAX_ROWS,
      );
      // Size limit of a version (AC-RT-01), on the rows as stored.
      const extra: ValidationIssue[] = [];
      if (result.rows) {
        const bytes = rowsBytes(result.rows.map((r) => compactRow(r, table.columns)));
        if (bytes > MAX_BYTES) {
          extra.push({
            severity: 'error',
            rule: 'rows',
            messageKey: 'refTables:import.tooLarge',
            params: { mb: (bytes / 1024 / 1024).toFixed(1), max: MAX_BYTES / 1024 / 1024 },
          });
        }
      }
      setPhase({ kind: 'done', name: file.name, result, extra });
    } catch {
      engine.current?.dispose();
      engine.current = null;
      setPhase({ kind: 'crashed', name: file.name });
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) void read(f);
  };

  const done = phase.kind === 'done' ? phase : null;
  const issues = done ? [...done.extra, ...done.result.report.issues] : [];
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  const rows: RefRow[] | null = done && errors === 0 ? done.result.rows : null;
  const personal = personalColumns(table.columns);
  const needConfirm = rows !== null && personal.length > 0;
  const columnTitle = (key: string | undefined) =>
    table.columns.find((c) => c.key === key)?.title ?? '';

  async function save() {
    if (!rows || busy || (needConfirm && !confirmed)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.replaceDraft(
        table.id,
        rows.map((row) => compactRow(row, table.columns)),
        draft?.updatedAt ?? null,
        needConfirm ? personal.map((c) => c.key) : [],
      );
      onDone(r.versionNo);
    } catch (e) {
      setError(refErrorOf(e));
      setBusy(false);
    }
  }

  const chip = done ? (
    errors > 0 ? (
      <Chip tone="coral">{t('import.errors', { count: errors })}</Chip>
    ) : warnings > 0 ? (
      <Chip tone="amber">{t('import.warnings', { count: warnings })}</Chip>
    ) : (
      <Chip tone="teal">{t('import.valid')}</Chip>
    )
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        aria-label={t('import.chooseLabel')}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void read(f);
        }}
      />
      {phase.kind === 'pick' && (
        <div
          data-import-drop
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cx(
            'flex flex-col items-center gap-1 rounded-card border-2 border-dashed p-4 text-center text-body',
            dragging
              ? 'border-teal-strong bg-teal-tint text-ink-soft'
              : 'border-drop-border bg-drop-bg text-ink-soft',
          )}
        >
          <span>
            {t('import.drop')}{' '}
            <button
              type="button"
              data-autofocus
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="min-h-target rounded-card px-2 font-semibold text-teal-strong underline hover:text-teal-hover disabled:cursor-not-allowed disabled:text-muted"
            >
              {t('import.choose')}
            </button>
          </span>
          <span className="text-caption text-muted">
            {t('import.limits', {
              rows: MAX_ROWS.toLocaleString('vi-VN'),
              mb: MAX_BYTES / 1024 / 1024,
            })}
          </span>
        </div>
      )}

      {phase.kind !== 'pick' && (
        <div
          data-import-file
          className="flex items-center justify-between gap-3 rounded-card bg-neutral px-4 py-2"
        >
          <MiddleCut text={phase.name} className="min-w-0 text-body text-ink" />
          {phase.kind === 'reading' && (
            <span role="status" className="text-caption whitespace-nowrap text-muted">
              {t('import.reading')}
            </span>
          )}
          <span className="flex shrink-0 items-center gap-2">
            {chip}
            {phase.kind !== 'reading' && (
              <Button
                variant="text"
                size="sm"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {t('import.chooseOther')}
              </Button>
            )}
          </span>
        </div>
      )}
      {phase.kind === 'crashed' && (
        <Callout tone="coral" label={t('errorLabel')} role="alert">
          {t('import.crashed')}
        </Callout>
      )}

      {done && issues.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-label text-ink">{t('import.reportTitle')}</h3>
          <div
            className="max-h-40 overflow-auto rounded-card border border-line"
            role="region"
            tabIndex={0}
            aria-label={t('import.reportTitle')}
          >
            <table className="w-full border-collapse text-dense text-ink-soft">
              <thead>
                <tr>
                  <th scope="col" className={denseThClass}>
                    {t('import.col.severity')}
                  </th>
                  <th scope="col" className={denseThClass}>
                    {t('import.col.row')}
                  </th>
                  <th scope="col" className={denseThClass}>
                    {t('import.col.column')}
                  </th>
                  <th scope="col" className={denseThClass}>
                    {t('import.col.message')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {issues
                  .slice()
                  .sort((a, b) => Number(a.severity !== 'error') - Number(b.severity !== 'error'))
                  .slice(0, MAX_ISSUES)
                  .map((i, n) => (
                    <tr key={n} className={cx(i.severity === 'error' && 'bg-coral-tint')}>
                      <td
                        className={cx(
                          denseTdClass,
                          'font-semibold',
                          i.severity === 'error' ? 'text-coral-text' : 'text-amber-text',
                        )}
                      >
                        {t(`import.severity.${i.severity}`)}
                      </td>
                      <td className={denseTdClass}>{i.row ?? '–'}</td>
                      <td className={denseTdClass}>{columnTitle(i.column) || '–'}</td>
                      <td className={cx(denseTdClass, 'whitespace-normal')}>
                        {formatIssue(i, (k, p) => te(k, p ?? {}))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {issues.length > MAX_ISSUES && (
            <p className="m-0 text-caption text-muted">
              {t('import.moreIssues', { count: issues.length - MAX_ISSUES })}
            </p>
          )}
        </div>
      )}

      {done && errors > 0 && (
        <Callout tone="coral" label={t('import.blockedLabel')} role="alert">
          {draft ? t('import.blocked', { count: draft.rowCount }) : t('import.blockedNew')}
        </Callout>
      )}
      {rows && done && done.result.preview.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-label text-ink">
            {t('import.previewTitle', {
              count: done.result.preview.length,
              total: done.result.rowCount,
            })}
          </h3>
          <div
            data-import-preview
            className="max-h-40 overflow-auto rounded-card border border-line"
            role="region"
            tabIndex={0}
            aria-label={t('import.previewLabel')}
          >
            <table className="w-full border-collapse text-dense text-ink-soft">
              <thead className="sticky top-0">
                <tr>
                  {table.columns.map((c) => (
                    <th key={c.key} scope="col" className={denseThClass}>
                      {c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {done.result.preview.map((r, n) => (
                  <tr key={n}>
                    {table.columns.map((c) => (
                      <td key={c.key} className={denseTdClass}>
                        {formatCell(r[c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {needConfirm && (
        <Checkbox
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          label={t('personal.confirm')}
          hint={`${t('personal.label')} ${t('personal.columns', {
            columns: personal.map((c) => `"${c.title}"`).join(', '),
          })}`}
          hintLabel={t('personal.label')}
        />
      )}
      {rows && gridDirty && (
        <Callout tone="amber" label={t('import.gridDirtyLabel')} role="status">
          {t('import.gridDirty')}
        </Callout>
      )}
      {error && (
        <Callout tone="coral" label={t('errorLabel')} role="alert">
          {t(error === 'draft_conflict' ? 'import.conflict' : refErrorText(error))}
        </Callout>
      )}

      <DialogFooter>
        <Button variant="text" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={!rows || busy || (needConfirm && !confirmed)}
          onClick={() => void save()}
        >
          {busy
            ? t('saving')
            : rows
              ? t('import.replace', { before: draft?.rowCount ?? 0, after: rows.length })
              : t('import.replaceIdle')}
        </Button>
      </DialogFooter>
    </div>
  );
}
