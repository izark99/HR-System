import { useTranslation } from 'react-i18next';
import { Button, cx, toneText, toneTint } from '../../../components/ui';
import { formatIsoDate, lastDay } from '../../../lib/format';
import type { FlowVersionInfo } from '../flow-source';
import type { RefState, RefUse } from '../ref-runtime';

/**
 * "Phiên bản áp dụng" of a flow that uses reference tables (spec §34 AC-RT-15, mock approved
 * 2026-11-10 07:50): the flow version and "Tên bảng · vN · từ dd/MM/yyyy" + "Xem bảng" per table.
 * A table without a usable version for the period turns the box into an error naming the table
 * (Run locked, upload dimmed by the page); a version whose cells no longer fit the column types
 * names the table, version and column — never a cell value.
 */
export function RefVersionsBox({
  refs,
  version,
  chosen,
  when,
  onView,
  onRetry,
}: {
  refs: RefState;
  /** Flow version in use (null: bundled flow). */
  version: FlowVersionInfo | null;
  /** The period / date was chosen by the User (else today). */
  chosen: boolean;
  /** "kỳ 03/2025", "ngày 05/03/2025", "hôm nay". */
  when: string;
  onView: (table: RefUse) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const error = refs.status === 'error';
  const blocked = refs.status === 'blocked';
  const tone = error || blocked ? 'coral' : 'blue';
  const usable = refs.tables.filter((r) => r.version && !r.problem);
  const title = error
    ? t('run.refs.errorTitle')
    : blocked
      ? t('run.refs.blockedTitle', { when })
      : t('run.refs.label');

  return (
    <div
      data-ref-versions
      role={error || blocked ? 'alert' : 'status'}
      className={cx('flex flex-col gap-1 rounded-card px-4 py-3 text-body', toneTint[tone])}
    >
      <p className={cx('m-0 font-semibold', toneText[tone])}>{title}</p>
      {refs.status === 'loading' && <p className="m-0 text-ink-soft">{t('run.refs.loading')}</p>}
      {error && (
        <p className="m-0 flex flex-wrap items-center gap-x-3 text-ink-soft">
          {t('run.refs.loadError')}
          <Button size="sm" variant="text" className="text-coral-text!" onClick={onRetry}>
            {t('run.refs.retry')}
          </Button>
        </p>
      )}
      {refs.status === 'ok' && version && (
        <p className={cx('m-0', toneText[tone])}>
          {t(version.effectiveTo ? 'run.refs.flowTo' : 'run.refs.flow', {
            version: `v${version.versionNo}`,
            from: formatIsoDate(version.effectiveFrom),
            to: version.effectiveTo ? lastDay(version.effectiveTo) : '',
          })}
          {chosen ? t('run.refs.forPeriod') : t('run.refs.forToday')}
        </p>
      )}
      {blocked &&
        refs.tables
          .filter((r) => r.problem)
          .map((r) => (
            <p key={r.code} className={cx('m-0', toneText[tone])}>
              {r.problem === 'type'
                ? t('run.refs.type', {
                    name: r.name,
                    version: r.version?.versionNo ?? '',
                    column: r.column ?? '',
                  })
                : t('run.refs.missing', { name: r.name, when })}
            </p>
          ))}
      {!error &&
        refs.status !== 'loading' &&
        usable.map((r) => (
          <p
            key={r.code}
            data-ref-table={r.code}
            className={cx('m-0 flex flex-wrap items-center gap-x-2', toneText[tone])}
          >
            <span>
              {t('run.refs.table', {
                name: r.name,
                version: r.version!.versionNo,
                from: formatIsoDate(r.version!.effectiveFrom),
              })}
            </span>
            <Button
              size="sm"
              variant="text"
              className={cx(tone === 'coral' ? 'text-coral-text!' : 'text-teal-strong!')}
              aria-label={t('run.refs.viewAria', { name: r.name })}
              onClick={() => onView(r)}
            >
              {t('run.refs.view')}
            </Button>
          </p>
        ))}
    </div>
  );
}
