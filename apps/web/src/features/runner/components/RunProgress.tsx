import { useTranslation } from 'react-i18next';
import { Button, Callout, Card, CheckIcon, cx } from '../../../components/ui';
import { formatSeconds } from '../../../lib/format';
import type { RunState } from '../run-store';

/** Progress per node while a run is going, plus the failure / cancel message afterwards. */
export function RunProgress({
  run,
  restoring,
  restoreFailed,
  onCancel,
  onRetryRestore,
}: {
  run: RunState;
  restoring: boolean;
  restoreFailed: boolean;
  onCancel: () => void;
  onRetryRestore: () => void;
}) {
  const { t } = useTranslation();
  const { t: te } = useTranslation('engine');
  const active = run.status === 'running' || run.status === 'cancelling';

  if (restoreFailed) {
    return (
      <Callout tone="coral" label={t('run.restoreFailedLabel')} role="alert">
        <span className="flex flex-wrap items-center gap-3">
          {t('run.restoreFailed')}
          <Button onClick={onRetryRestore}>{t('run.actions.retryRestore')}</Button>
        </span>
      </Callout>
    );
  }
  if (run.status === 'failed' && run.error) {
    return (
      <Callout tone="coral" label={t('run.failed')} role="alert">
        {te(run.error.messageKey, run.error.params)}
      </Callout>
    );
  }
  if (run.status === 'cancelled') {
    return (
      <Callout tone="amber" label={t('run.cancelledLabel')} role="status">
        {restoring ? t('run.restoring') : t('run.cancelled')}
      </Callout>
    );
  }
  if (!active) return null;

  const done = run.nodes.filter((n) => n.status === 'done').length;
  const percent = run.nodes.length ? Math.round((done / run.nodes.length) * 100) : 0;

  return (
    <Card aria-labelledby="progress-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="progress-title" className="m-0 text-section text-ink">
          {t('run.progress.title')}
        </h2>
        <Button onClick={onCancel} disabled={run.status === 'cancelling'}>
          {run.status === 'cancelling' ? t('run.actions.cancelling') : t('run.actions.cancel')}
        </Button>
      </div>
      <div
        role="progressbar"
        aria-labelledby="progress-title"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2.5 overflow-hidden rounded-full bg-neutral"
      >
        <div
          className="h-full rounded-full bg-teal transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      {run.engineLoading && (
        <Callout tone="blue" label={t('run.engineLoadingLabel')} role="status">
          {te('duckdb.loading')}
          {run.engineLoading.totalBytes > 0 &&
            ` (${Math.min(
              100,
              Math.round((run.engineLoading.loadedBytes / run.engineLoading.totalBytes) * 100),
            )}%)`}
        </Callout>
      )}
      <ol className="m-0 flex list-none flex-col gap-2 p-0 text-label" aria-live="polite">
        {run.nodes.map((n) => {
          const rows = n.rows ? Object.values(n.rows).reduce((a, b) => a + b, 0) : null;
          return (
            <li
              key={n.id}
              className="flex items-center justify-between gap-3 rounded-control bg-page px-3.5 py-2.5"
            >
              <span className={cx(n.status === 'pending' ? 'text-muted' : 'text-ink')}>
                {n.label}
              </span>
              <span
                className={cx(
                  'flex items-center gap-1.5 font-semibold',
                  n.status === 'done' ? 'text-teal-strong' : 'text-muted',
                )}
              >
                {n.status === 'done' && rows !== null && n.rows && Object.keys(n.rows).length > 0
                  ? `${t('run.progress.rows', { count: rows })} · `
                  : ''}
                {n.status === 'done'
                  ? t('run.progress.done', { seconds: formatSeconds(n.durationMs ?? 0) })
                  : t(`run.progress.${n.status}`)}
                {n.status === 'done' && <CheckIcon />}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
