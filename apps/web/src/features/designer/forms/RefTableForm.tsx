import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/ui';
import { formatIsoDate, formatMonth } from '../../../lib/format';
import { useRefCatalog, type RefCatalog } from '../ref-catalog';
import { issuesAt, SelectField } from './fields';
import type { NodeFormProps } from './NodeForms';

type TFn = (key: string, options?: Record<string, unknown>) => string;

/** "kỳ mẫu 09/2026" / "ngày mẫu 05/03/2026" / "hôm nay": the date the preview uses. */
export function previewWhen(t: TFn, from: RefCatalog['previewFrom']): string {
  if (from.kind === 'period')
    return t('node.refTable.whenPeriod', { period: formatMonth(from.value) });
  if (from.kind === 'date') return t('node.refTable.whenDate', { date: formatIsoDate(from.value) });
  return t('node.refTable.whenToday');
}

/**
 * Form of `input.refTable` (spec §34 AC-RT-07, mock approved 2026-11-09 14:38, screen 5): the
 * table (Select, with search when the list is long), which version the preview uses (by the
 * as-of date of the sample params, else today) and the output columns from the table definition.
 */
export function RefTableForm(p: NodeFormProps) {
  const { t } = useTranslation('designer');
  const catalog = useRefCatalog();
  const c = p.node.config;
  const code = typeof c.refTable === 'string' ? c.refTable : '';
  const tables = catalog.tables ?? [];
  const options = tables.map((x) => ({ value: x.code, label: `${x.code} — ${x.name}` }));
  if (code && !options.some((o) => o.value === code)) options.push({ value: code, label: code });
  const table = tables.find((x) => x.code === code);
  const version = code ? catalog.previewVersion(code) : null;
  const when = previewWhen(t, catalog.previewFrom);
  const note = catalog.failed
    ? t('node.refTable.loadFailed')
    : catalog.tables === null
      ? t('node.refTable.loading')
      : tables.length === 0
        ? t('node.refTable.noTables')
        : undefined;

  return (
    <div className="flex flex-col gap-stack-dense">
      <SelectField
        label={t('node.refTable.refTable')}
        value={code}
        onChange={(v) => p.onConfig({ ...c, refTable: v }, `${p.node.id}:refTable`)}
        options={options}
        issues={issuesAt(p.issues, 'refTable')}
        disabled={p.readOnly}
        placeholder={t('node.refTable.pick')}
        hint={t('node.refTable.hint')}
        note={note}
      />
      {catalog.failed && (
        <Button size="sm" className="self-start" onClick={catalog.retry}>
          {t('node.refTable.retry')}
        </Button>
      )}
      {table && (
        <p data-note data-ref-preview className="m-0 text-dense text-muted">
          {version
            ? t('node.refTable.previewVersion', {
                version: version.versionNo,
                from: formatIsoDate(version.effectiveFrom),
                when,
              })
            : t('node.refTable.previewNone', { when })}
        </p>
      )}
      {table && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-dense font-semibold text-ink">
            {t('node.refTable.columns', { count: table.columns.length })}
          </p>
          <ul
            aria-label={t('node.refTable.columns', { count: table.columns.length })}
            className="m-0 grid list-none grid-cols-2 overflow-hidden rounded-card border border-line p-0 text-dense"
          >
            <li className="contents" aria-hidden>
              <span className="bg-neutral px-3 py-2 font-semibold text-muted">
                {t('node.refTable.columnKey')}
              </span>
              <span className="bg-neutral px-3 py-2 font-semibold text-muted">
                {t('node.refTable.columnType')}
              </span>
            </li>
            {table.columns.map((col) => (
              <li key={col.key} className="contents">
                <span
                  className="truncate border-t border-line px-3 py-2 font-mono text-ink"
                  title={col.title}
                >
                  {col.key}
                </span>
                <span className="border-t border-line px-3 py-2 text-ink-soft">
                  {t(`types.${col.type}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
