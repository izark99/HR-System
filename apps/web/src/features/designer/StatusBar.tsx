import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '../../components/ui';
import type { DesignCheckResult, DesignIssue } from '../../engine/design';

/**
 * Status bar (spec §15.3 "Kiểm tra realtime"): number of errors / warnings; the list jumps to the
 * node (or the params / slot tab) of a problem.
 */
export function StatusBar({
  check,
  checking,
  failed,
  onJump,
}: {
  check: DesignCheckResult | null;
  checking: boolean;
  failed: boolean;
  onJump: (issue: DesignIssue) => void;
}) {
  const { t } = useTranslation('designer');
  const [open, setOpen] = useState(false);
  const listId = useId();
  const errors = check?.errorCount ?? 0;
  const warnings = check?.warningCount ?? 0;
  const issues = check?.issues ?? [];
  return (
    <div className="relative flex min-h-target items-center gap-3 border-t border-line bg-card px-3.5 text-small">
      <span role="status" aria-live="polite" className="text-muted">
        {failed
          ? t('status.failed')
          : checking && !check
            ? t('status.checking')
            : checking
              ? t('status.rechecking')
              : ''}
      </span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        disabled={issues.length === 0}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-target items-center gap-2 rounded-control px-2.5 font-semibold hover:bg-page disabled:cursor-default"
      >
        <span className={cx(errors > 0 ? 'text-coral-text' : 'text-teal-strong')}>
          {t('status.errors', { count: errors })}
        </span>
        <span className="text-muted">·</span>
        <span className={cx(warnings > 0 ? 'text-amber-text' : 'text-muted')}>
          {t('status.warnings', { count: warnings })}
        </span>
      </button>
      {open && issues.length > 0 && (
        <div
          id={listId}
          className="absolute bottom-full left-3 z-20 mb-2 max-h-80 w-[min(560px,calc(100vw-48px))] overflow-y-auto rounded-tile bg-card p-2 shadow-card"
        >
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {issues.map((i, k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => {
                    onJump(i);
                    setOpen(false);
                  }}
                  className="flex min-h-target w-full items-start gap-2 rounded-control px-2.5 py-2 text-left text-small hover:bg-page"
                >
                  <span
                    className={cx(
                      'shrink-0 font-bold',
                      i.severity === 'error' ? 'text-coral-text' : 'text-amber-text',
                    )}
                  >
                    {i.severity === 'error' ? t('status.error') : t('status.warning')}
                  </span>
                  <span className="text-body">{i.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
