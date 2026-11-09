import { Link, useNavigate } from '@tanstack/react-router';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataTableColumn } from '../../../components/DataTable';
import { FormField, TextInput } from '../../../components/FormField';
import { LayersIcon, PencilIcon } from '../../../components/icons';
import { PageHeader, Toolbar } from '../../../components/layout';
import type { MenuItem } from '../../../components/Menu';
import { RowActions, RowIcon, rowIconClass } from '../../../components/RowActions';
import { LoadingRegion, TableCardSkeleton } from '../../../components/Skeleton';
import { Button, buttonClass, Callout, cardClass, Chip, cx } from '../../../components/ui';
import { todayIso } from '../../runner/as-of';
import { isEffectiveOn } from '../versions/version-ranges';
import { fold } from './model';
import {
  refErrorOf,
  refErrorText,
  type RefApiErrorKey,
  type RefTable,
  type RefUsage,
} from './ref-tables-api';
import { formatDay, refPath, useRefApi } from './shared';

/** The version in force today, else null. */
export function currentVersion(table: RefTable, day = todayIso()) {
  return table.versions.find((v) => isEffectiveOn(v, day));
}

function VersionChips({ table }: { table: RefTable }) {
  const { t } = useTranslation('refTables');
  const current = currentVersion(table);
  const published = table.versions
    .filter((v) => v.status === 'published')
    .sort((a, b) => (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''));
  const shown = published.slice(0, 2);
  const draft = table.versions.find((v) => v.status === 'draft');
  return (
    <span className="flex items-center gap-2">
      {shown.length === 0 && <Chip tone="neutral">{t('list.unpublished')}</Chip>}
      {shown.map((v) => (
        <Chip key={v.id} tone={v.id === current?.id ? 'teal' : 'neutral'}>
          {t('list.versionFrom', { version: v.versionNo, from: formatDay(v.effectiveFrom) })}
        </Chip>
      ))}
      {published.length > 2 && (
        <span className="text-caption text-muted">+{published.length - 2}</span>
      )}
      {draft && <Chip tone="amber">{t('status.draft')}</Chip>}
    </span>
  );
}

export function RefTablesListPage() {
  const { t } = useTranslation('refTables');
  const api = useRefApi();
  const navigate = useNavigate();
  const [tables, setTables] = useState<RefTable[] | null>(null);
  const [usage, setUsage] = useState<Map<string, RefUsage[]>>(new Map());
  const [error, setError] = useState<RefApiErrorKey | null>(null);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    api.listTables().then(
      (list) => {
        if (!alive) return;
        setTables(list);
        setError(null);
      },
      (e: unknown) => alive && setError(refErrorOf(e)),
    );
    // Usage is extra information: the list works without it.
    api.usage().then(
      (u) => alive && setUsage(u),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [api, tick]);

  const deferred = useDeferredValue(query);
  const shown = useMemo(() => {
    const q = fold(deferred);
    return (tables ?? []).filter((r) => !q || fold(`${r.code} ${r.name}`).includes(q));
  }, [tables, deferred]);

  const columns: DataTableColumn<RefTable>[] = [
    {
      id: 'code',
      header: t('list.col.code'),
      cell: (r) => <span className="font-mono text-caption text-ink">{r.code}</span>,
    },
    { id: 'name', header: t('list.col.name'), rowHeader: true, cell: (r) => r.name },
    { id: 'versions', header: t('list.col.versions'), cell: (r) => <VersionChips table={r} /> },
    {
      id: 'rows',
      header: t('list.col.rows'),
      align: 'right',
      cell: (r) => {
        const v = currentVersion(r) ?? r.versions[0];
        return <span className="tabular-nums">{v ? v.rowCount.toLocaleString('vi-VN') : '–'}</span>;
      },
    },
    {
      id: 'usage',
      header: t('list.col.usage'),
      cell: (r) => {
        const n = new Set((usage.get(r.code) ?? []).map((u) => u.flowId)).size;
        return n > 0 ? t('list.usage', { count: n }) : '–';
      },
    },
  ];

  const menu = (r: RefTable): MenuItem[] => {
    const items: MenuItem[] = [];
    const draft = r.versions.find((v) => v.status === 'draft');
    const current = currentVersion(r);
    const go = (no: number) =>
      void navigate({ to: '/admin/ref-tables/$', params: refPath(r.code, `versions/${no}`) });
    if (draft) {
      const label = t('list.menu.editDraft', { version: draft.versionNo });
      items.push({ key: 'draft', label, onSelect: () => go(draft.versionNo) });
    }
    if (current) {
      const label = t('list.menu.viewCurrent', { version: current.versionNo });
      items.push({ key: 'current', label, onSelect: () => go(current.versionNo) });
    }
    return items;
  };

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        actions={
          <Link to="/admin/ref-tables/$" params={refPath('new')} className={buttonClass('primary')}>
            {t('list.create')}
          </Link>
        }
      />
      {error && !tables && (
        <div className="flex flex-col items-start gap-3">
          <Callout tone="coral" label={t('errorLabel')} role="alert">
            {t(refErrorText(error))}
          </Callout>
          <Button size="sm" onClick={() => setTick((n) => n + 1)}>
            {t('retry')}
          </Button>
        </div>
      )}
      {!tables && !error && (
        <LoadingRegion>
          <TableCardSkeleton rows={4} columns={6} />
        </LoadingRegion>
      )}
      {tables && (
        <section
          aria-label={t('list.cardLabel')}
          data-card
          className={cx(cardClass, 'flex min-w-0 flex-col overflow-hidden')}
        >
          <Toolbar
            className="items-end"
            end={
              <span
                aria-live="polite"
                className="flex h-control items-center text-caption whitespace-nowrap text-muted tabular-nums"
              >
                {t('list.count', { count: shown.length })}
              </span>
            }
          >
            <FormField id="ref-search" label={t('list.search')} className="w-64 max-w-full">
              {(f) => (
                <TextInput
                  {...f.input}
                  type="search"
                  autoComplete="off"
                  value={query}
                  placeholder={t('list.searchPlaceholder')}
                  onChange={(e) => setQuery(e.target.value)}
                />
              )}
            </FormField>
          </Toolbar>
          <DataTable
            caption={t('list.caption')}
            columns={columns}
            rows={shown}
            rowKey={(r) => r.id}
            empty={
              tables.length === 0
                ? { title: t('list.emptyTitle'), text: t('list.emptyText') }
                : { title: t('list.noMatch') }
            }
            actions={{
              header: t('list.col.actions'),
              cell: (r) => (
                <RowActions
                  rowName={r.code}
                  visible={
                    <>
                      <RowIcon label={t('list.editColumns')}>
                        <Link
                          to="/admin/ref-tables/$"
                          params={refPath(r.code)}
                          aria-label={t('list.editColumnsFor', { code: r.code })}
                          className={cx(rowIconClass, 'hover:text-ink')}
                        >
                          <PencilIcon />
                        </Link>
                      </RowIcon>
                      <RowIcon label={t('list.openVersions')}>
                        <Link
                          to="/admin/ref-tables/$"
                          params={refPath(r.code, 'versions')}
                          aria-label={t('list.openVersionsFor', { code: r.code })}
                          className={cx(rowIconClass, 'hover:text-ink')}
                        >
                          <LayersIcon />
                        </Link>
                      </RowIcon>
                    </>
                  }
                  items={menu(r)}
                />
              ),
            }}
          />
        </section>
      )}
    </>
  );
}
