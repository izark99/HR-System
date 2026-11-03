import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buttonClass,
  Card,
  cardClass,
  Chip,
  cx,
  Eyebrow,
  inputClass,
  navItemClass,
  PageHeader,
  pillClass,
  tdClass,
  thClass,
  type Tone,
} from '../../components/ui';
import { formatMonth } from '../../lib/format';
import { todayIso } from './as-of';
import type { FlowSummary, RecentRun } from './flow-source';
import { useRunStore } from './run-context';
import { FlowCardsSkeleton, LinesSkeleton, LoadingRegion } from '../../components/Skeleton';

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

function RecentRuns({ runs, failed }: { runs: RecentRun[] | null; failed: boolean }) {
  const { t } = useTranslation();
  return (
    <Card aria-labelledby="recent-runs" className="flex flex-col gap-4">
      <h2 id="recent-runs" className="m-0 text-title-md text-ink">
        {t('recent.title')}
      </h2>
      {failed && <p className="m-0 text-coral-text">{t('recent.loadError')}</p>}
      {!failed && runs === null && (
        <LoadingRegion>
          <LinesSkeleton />
        </LoadingRegion>
      )}
      {runs !== null && runs.length === 0 && (
        <p className="m-0 rounded-card bg-neutral px-4 py-6 text-center text-body text-muted">
          {t('recent.empty')}
        </p>
      )}
      {runs !== null && runs.length > 0 && (
        <div
          className="overflow-x-auto"
          role="region"
          tabIndex={0}
          aria-label={t('recent.tableLabel')}
        >
          <table className="w-full min-w-160 border-collapse text-body text-ink-soft">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  {t('recent.col.time')}
                </th>
                <th scope="col" className={thClass}>
                  {t('recent.col.flow')}
                </th>
                <th scope="col" className={thClass}>
                  {t('recent.col.params')}
                </th>
                <th scope="col" className={thClass}>
                  {t('recent.col.version')}
                </th>
                <th scope="col" className={thClass}>
                  {t('recent.col.status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className={cx(tdClass, 'whitespace-nowrap')}>
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className={tdClass}>{r.flowName}</td>
                  <td className={tdClass}>{r.params.map(paramText).join(', ') || '-'}</td>
                  <td className={tdClass}>v{r.versionNo}</td>
                  <td className={tdClass}>
                    <Chip tone={STATUS_TONE[r.status]}>{t(`recent.status.${r.status}`)}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 text-caption text-muted">{t('recent.note')}</p>
    </Card>
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

  useEffect(() => {
    let alive = true;
    source.list(todayIso()).then(
      (list) => alive && setFlows(list),
      () => alive && setFailed(true),
    );
    if (source.recentRuns) {
      source.recentRuns(10).then(
        (list) => alive && setRuns(list),
        () => alive && setRunsFailed(true),
      );
    }
    return () => {
      alive = false;
    };
  }, [source]);

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
    <div className="flex flex-wrap">
      <nav
        aria-label={t('nav.label')}
        className="flex max-w-64 flex-[1_1_220px] flex-col gap-1.5 px-3.5 py-6"
      >
        <Link to="/" aria-current="page" className={navItemClass(true)}>
          {t('nav.runFlows')}
        </Link>
        <Link to="/change-password" className={navItemClass(false)}>
          {t('nav.changePassword')}
        </Link>
      </nav>

      <main
        id="main"
        className="flex min-w-0 flex-[999_1_560px] flex-col gap-6 px-4 pt-8 pb-12 md:pr-8 md:pl-4"
      >
        <PageHeader
          eyebrow={t('flows.eyebrow')}
          title={t('flows.title')}
          subtitle={t('flows.subtitle')}
          actions={
            <div className="flex flex-col gap-1.5">
              <label htmlFor="flow-search" className="text-label text-ink">
                {t('flows.searchLabel')}
              </label>
              <input
                id="flow-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('flows.searchPlaceholder')}
                className={cx(inputClass, 'w-80 max-w-full')}
              />
            </div>
          }
        />

        {categories.length > 0 && (
          <div
            role="group"
            aria-label={t('flows.categoriesLabel')}
            className="flex flex-wrap gap-2"
          >
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

        {failed && <p className="m-0 text-coral-text">{t('flows.loadError')}</p>}
        {flows === null && !failed && (
          <LoadingRegion>
            <FlowCardsSkeleton />
          </LoadingRegion>
        )}
        {flows !== null && visible.length === 0 && (
          <p className="m-0 text-muted">{t('flows.empty')}</p>
        )}

        <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((f) => (
            <li key={f.code} className="flex">
              <article
                data-card
                className={cx(cardClass, 'flex w-full min-w-0 flex-col gap-3 p-6')}
              >
                <Eyebrow>{f.category}</Eyebrow>
                <h2 className="m-0 text-title-md break-words text-ink">{f.name}</h2>
                <p className="m-0 text-body text-muted">{f.description}</p>
                <p className="m-0 text-caption text-muted">
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

        <RecentRuns runs={runs} failed={runsFailed} />
      </main>
    </div>
  );
}
