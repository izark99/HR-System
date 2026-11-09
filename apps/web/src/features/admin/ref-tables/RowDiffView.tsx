import { useTranslation } from 'react-i18next';
import { denseTdClass, denseThClass } from '../../../components/DataTable';
import { cx } from '../../../components/ui';
import { formatCell, keyLabel, type RefColumn, type RefRow, type RowDiff } from './model';

/** Rows listed per kind (the counts cover all of them). */
const MAX_LINES = 200;

type Line =
  | { kind: 'added' | 'removed'; row: RefRow }
  | { kind: 'changed'; before: RefRow; after: RefRow; columns: string[] };

/**
 * Differences between two versions matched by key (spec §34 AC-RT-06): counts, then one line per
 * row added / removed / changed with every column; a changed cell shows "old → new".
 */
export function RowDiffView({ columns, diff }: { columns: RefColumn[]; diff: RowDiff }) {
  const { t } = useTranslation('refTables');
  const keyCols = columns.filter((c) => c.isKey);
  const lines: Line[] = [
    ...diff.changed.slice(0, MAX_LINES).map((c) => ({ kind: 'changed' as const, ...c })),
    ...diff.added.slice(0, MAX_LINES).map((row) => ({ kind: 'added' as const, row })),
    ...diff.removed.slice(0, MAX_LINES).map((row) => ({ kind: 'removed' as const, row })),
  ];
  const truncated =
    diff.changed.length > MAX_LINES ||
    diff.added.length > MAX_LINES ||
    diff.removed.length > MAX_LINES;

  return (
    <div className="flex flex-col gap-3">
      <p data-diff-summary className="m-0 text-body text-ink-soft" aria-live="polite">
        {t('diff.summary', {
          added: diff.added.length,
          removed: diff.removed.length,
          changed: diff.changed.length,
          unchanged: diff.unchanged,
        })}
      </p>
      {lines.length > 0 && (
        <div
          className="overflow-x-auto rounded-card border border-line"
          role="region"
          tabIndex={0}
          aria-label={t('diff.tableLabel')}
        >
          <table className="w-full border-collapse text-dense text-ink-soft">
            <thead>
              <tr>
                <th scope="col" className={denseThClass}>
                  {t('diff.col.change')}
                </th>
                <th scope="col" className={denseThClass}>
                  {t('diff.col.key')}
                </th>
                {columns
                  .filter((c) => !c.isKey)
                  .map((c) => (
                    <th key={c.key} scope="col" className={denseThClass}>
                      {c.title}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, n) => {
                const row = l.kind === 'changed' ? l.after : l.row;
                return (
                  <tr
                    key={n}
                    data-diff-line={l.kind}
                    className={cx(
                      l.kind === 'added' && 'bg-teal-tint',
                      l.kind === 'removed' && 'bg-coral-tint',
                    )}
                  >
                    <td
                      className={cx(
                        denseTdClass,
                        'font-semibold',
                        l.kind === 'added'
                          ? 'text-teal-strong'
                          : l.kind === 'removed'
                            ? 'text-coral-text'
                            : 'text-amber-text',
                      )}
                    >
                      {t(`diff.kind.${l.kind}`)}
                    </td>
                    <th
                      scope="row"
                      className={cx(denseTdClass, 'text-left font-semibold text-ink')}
                    >
                      {keyLabel(row, keyCols)}
                    </th>
                    {columns
                      .filter((c) => !c.isKey)
                      .map((c) => {
                        const now = formatCell(row[c.key], c.type);
                        if (l.kind !== 'changed' || !l.columns.includes(c.key)) {
                          return (
                            <td
                              key={c.key}
                              className={cx(denseTdClass, l.kind === 'removed' && 'line-through')}
                            >
                              {now}
                            </td>
                          );
                        }
                        const before = formatCell(l.before[c.key], c.type);
                        return (
                          <td
                            key={c.key}
                            data-diff-cell
                            className={cx(denseTdClass, 'bg-amber-tint')}
                          >
                            <span className="text-muted line-through">
                              {before || t('diff.blank')}
                            </span>
                            {' → '}
                            <span className="font-semibold text-ink">{now || t('diff.blank')}</span>
                          </td>
                        );
                      })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {truncated && (
        <p className="m-0 text-caption text-muted">{t('diff.truncated', { max: MAX_LINES })}</p>
      )}
    </div>
  );
}
