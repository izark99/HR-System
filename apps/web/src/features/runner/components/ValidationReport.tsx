import type { FlowDefinition } from '@hrflow/flow-schema';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Callout, Card, Chip, cx } from '../../../components/ui';
import { formatIssue, type ValidationIssue } from '../../../engine/io/validation';
import type { SessionState } from '../run-store';
import type { Readiness } from '../readiness';

/** Rows rendered in the page; the downloadable report always has all of them. */
const MAX_ROWS = 500;

interface Row {
  key: string;
  issue: ValidationIssue;
  column: string;
}

function collect(flow: FlowDefinition, state: SessionState): Row[] {
  const rows: Row[] = [];
  for (const slot of flow.inputSlots) {
    const report = state.slots[slot.key]?.validation?.report;
    if (!report || state.slots[slot.key]?.files.length === 0) continue;
    report.issues.forEach((issue, i) => {
      const col = slot.columns.find((c) => c.key === issue.column);
      rows.push({
        key: `${slot.key}:${i}`,
        issue,
        column: col ? (col.label ?? col.aliases[0] ?? col.key) : (issue.column ?? ''),
      });
    });
  }
  // Errors first, then warnings; stable within each group.
  return rows.sort(
    (a, b) => Number(a.issue.severity !== 'error') - Number(b.issue.severity !== 'error'),
  );
}

export function ValidationReport({
  flow,
  state,
  ready,
  onDownload,
}: {
  flow: FlowDefinition;
  state: SessionState;
  ready: Readiness;
  onDownload: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { t: te } = useTranslation('engine');
  const [downloading, setDownloading] = useState(false);
  const rows = collect(flow, state);
  const anyValidated = flow.inputSlots.some(
    (s) => (state.slots[s.key]?.files.length ?? 0) > 0 && state.slots[s.key]?.validation,
  );
  const shown = rows.slice(0, MAX_ROWS);

  return (
    <Card aria-labelledby="report-title" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="report-title" className="m-0 text-section text-ink">
          {t('report.title')}
        </h2>
        {anyValidated && (
          <div className="flex flex-wrap gap-2" aria-live="polite">
            <Chip tone={ready.errors > 0 ? 'coral' : 'neutral'}>
              {t('report.errors', { count: ready.errors })}
            </Chip>
            <Chip tone={ready.warnings > 0 ? 'amber' : 'neutral'}>
              {t('report.warnings', { count: ready.warnings })}
            </Chip>
            {ready.skipped > 0 && (
              <Chip tone="neutral">{t('report.skipped', { count: ready.skipped })}</Chip>
            )}
          </div>
        )}
      </div>

      {!anyValidated && <p className="m-0 text-label text-muted">{t('report.empty')}</p>}

      {anyValidated && rows.length === 0 && !ready.validating && (
        <Callout tone="teal" label={t('report.validLabel')} role="status">
          {t('report.valid')}
        </Callout>
      )}
      {anyValidated && rows.length > 0 && ready.errors === 0 && (
        <Callout tone="amber" label={t('report.warningsOnlyLabel')} role="status">
          {t('report.warningsOnly')}
        </Callout>
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 border-collapse text-label text-body">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="px-2 py-2.5 font-semibold">
                  {t('report.col.severity')}
                </th>
                <th scope="col" className="px-2 py-2.5 font-semibold">
                  {t('report.col.file')}
                </th>
                <th scope="col" className="px-2 py-2.5 font-semibold">
                  {t('report.col.row')}
                </th>
                <th scope="col" className="px-2 py-2.5 font-semibold">
                  {t('report.col.column')}
                </th>
                <th scope="col" className="px-2 py-2.5 font-semibold">
                  {t('report.col.message')}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ key, issue, column }) => {
                const error = issue.severity === 'error';
                return (
                  <tr
                    key={key}
                    className={cx('border-b border-line last:border-0', error && 'bg-coral-tint')}
                  >
                    <td
                      className={cx(
                        'px-2 py-3 font-bold',
                        error ? 'text-coral-text' : 'text-amber-text',
                      )}
                    >
                      {t(`report.severity.${issue.severity}`)}
                    </td>
                    <td className="px-2 py-3 break-all">{issue.file ?? ''}</td>
                    <td className="px-2 py-3">{issue.row ?? ''}</td>
                    <td className="px-2 py-3 whitespace-nowrap">{column}</td>
                    <td className="px-2 py-3">{formatIssue(issue, (k, p) => te(k, p ?? {}))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > MAX_ROWS && (
        <p className="m-0 text-small text-muted">
          {t('report.truncated', { shown: MAX_ROWS, total: rows.length })}
        </p>
      )}
      {rows.length > 0 && (
        <div>
          <button
            type="button"
            disabled={downloading}
            onClick={() => {
              setDownloading(true);
              void onDownload().finally(() => setDownloading(false));
            }}
            className="min-h-target rounded-control px-1 text-label font-semibold text-teal-strong underline hover:text-teal-hover"
          >
            {t('report.download')}
          </button>
        </div>
      )}
    </Card>
  );
}
