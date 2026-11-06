import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataTableColumn } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { FormField, TextInput } from '../../components/FormField';
import { PageHeader, PageShell, Section } from '../../components/layout';
import { FlowCardsSkeleton, LoadingRegion } from '../../components/Skeleton';
import {
  Button,
  buttonClass,
  Callout,
  cardClass,
  Chip,
  cx,
  Eyebrow,
  pillClass,
  type Tone,
} from '../../components/ui';
import { formatMonth } from '../../lib/format';
import { todayIso } from './as-of';
import type { FlowSummary, RecentRun } from './flow-source';
import { useRunStore } from './run-context';

const STATUS_TONE: Record<RecentRun['status'], Tone> = {
  succeeded: 'teal',
  failed: 'coral',
  cancelled: 'neutral',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function paramText(p: RecentRun['params'][number]): string {
  const value =
    p.type === 'month'
      ? formatMonth(p.value)
      : p.type === 'date'
        ? p.value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1')
        : p.value;
  return `${p.label}: ${value}`;
}

/** "Lần chạy gần đây" (metadata only): a `DataTable` in a `Section` (spec §25.5, AC-UI-77). */
function RecentRuns({
  runs,
  failed,
  onRetry,
}: {
  runs: RecentRun[] | null;
  failed: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const columns: DataTableColumn<RecentRun>[] = [
    { id: 'time', header: t('recent.col.time'), cell: (r) => formatDateTime(r.createdAt) },
    { id: 'flow', header: t('recent.col.flow'), cell: (r) => r.flowName },
    {
      id: 'params',
      header: t('recent.col.params'),
      cell: (r) => r.params.map(paramText).join(', ') || '-',
    },
    { id: 'version', header: t('recent.col.version'), cell: (r) => `v${r.versionNo}` },
    {
      id: 'status',
      header: t('recent.col.status'),
      cell: (r) => <Chip tone={STATUS_TONE[r.status]}>{t(`recent.status.${r.status}`)}</Chip>,
    },
  ];
  return (
    <Section title={t('recent.title')} description={t('recent.note')} plain>
      <div className={cx(cardClass, 'overflow-hidden')}>
        <DataTable
          caption={t('recent.tableLabel')}
          columns={columns}
          rows={runs ?? []}
          rowKey={(r) => r.id}
          loading={!failed && runs === null}
          error={failed ? { message: t('recent.loadError'), onRetry } : null}
          empty={{ title: t('recent.empty'), text: t('recent.emptyHint') }}
        />
      </div>
    </Section>
  );
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

export function FlowListPage() {
  const { t } = useTranslation();
  const { source } = useRunStore();
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // Without run history (bundled flows) the card shows its empty state right away.
  const [runs, setRuns] = useState<RecentRun[] | null>(() => (source.recentRuns ? null : []));
  const [runsFailed, setRunsFailed] = useState(false);
  // Bumped by "Thử lại" to load the list / the history again.
  const [flowsAttempt, setFlowsAttempt] = useState(0);
  const [runsAttempt, setRunsAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    source.list(todayIso()).then(
      (list) => alive && setFlows(list),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [source, flowsAttempt]);

  useEffect(() => {
    if (!source.recentRuns) return;
    let alive = true;
    source.recentRuns(10).then(
      (list) => alive && setRuns(list),
      () => alive && setRunsFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [source, runsAttempt]);

  const categories = useMemo(() => [...new Set((flows ?? []).map((f) => f.category))], [flows]);
  const visible = useMemo(() => {
    const q = normalize(query.trim());
    return (flows ?? []).filter(
      (f) =>
        (!category || f.category === category) &&
        (!q || normalize(`${f.name} ${f.description}`).includes(q)),
    );
  }, [flows, query, category]);

  return (
    <PageShell width="content">
      <PageHeader
        variant="showcase"
        eyebrow={t('flows.eyebrow')}
        title={t('flows.title')}
        subtitle={t('flows.subtitle')}
        actions={
          <FormField label={t('flows.searchLabel')} id="flow-search" className="w-80 max-w-full">
            {(field) => (
              <TextInput
                {...field.input}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('flows.searchPlaceholder')}
              />
            )}
          </FormField>
        }
      />

      {categories.length > 0 && (
        <div role="group" aria-label={t('flows.categoriesLabel')} className="flex flex-wrap gap-2">
          {[null, ...categories].map((c) => {
            const active = category === c;
            return (
              <button
                key={c ?? '*'}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(c)}
                className={pillClass(active)}
              >
                {c ?? t('flows.allCategories')}
              </button>
            );
          })}
        </div>
      )}

      {failed && (
        <div className="flex flex-col items-start gap-3">
          <Callout tone="coral" label={t('common.errorLabel')} role="alert">
            {t('flows.loadError')}
          </Callout>
          <Button
            size="sm"
            onClick={() => {
              setFailed(false);
              setFlows(null);
              setFlowsAttempt((n) => n + 1);
            }}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
      {flows === null && !failed && (
        <LoadingRegion>
          <FlowCardsSkeleton />
        </LoadingRegion>
      )}
      {flows !== null && visible.length === 0 && (
        <EmptyState
          className={cardClass}
          title={t('flows.empty')}
          text={flows.length === 0 ? t('flows.emptyNone') : t('flows.emptyHint')}
        />
      )}

      {visible.length > 0 && (
        <ul className="m-0 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((f) => (
            <li key={f.code} className="flex">
              <article
                data-card
                className={cx(cardClass, 'flex w-full min-w-0 flex-col gap-3 p-6')}
              >
                <Eyebrow>{f.category}</Eyebrow>
                <h2 className="m-0 text-title-md break-words text-ink">{f.name}</h2>
                <p className="m-0 text-body text-muted">{f.description}</p>
                <p data-note className="m-0 text-caption text-muted">
                  {t('flows.inputs', { count: f.inputCount })}
                  {f.versionLabel ? ` · ${t('flows.version', { version: f.versionLabel })}` : ''}
                </p>
                <Link
                  to="/run/$flowCode"
                  params={{ flowCode: f.code }}
                  aria-label={t('flows.runNamed', { name: f.name })}
                  className={cx(buttonClass('primary'), 'mt-auto no-underline hover:text-white')}
                >
                  {t('flows.run')}
                </Link>
              </article>
            </li>
          ))}
        </ul>
      )}

      <RecentRuns
        runs={runs}
        failed={runsFailed}
        onRetry={() => {
          setRunsFailed(false);
          setRuns(null);
          setRunsAttempt((n) => n + 1);
        }}
      />
    </PageShell>
  );
}
