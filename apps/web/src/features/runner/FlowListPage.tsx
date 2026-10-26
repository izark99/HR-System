import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, Card, Chip, cx, PageHeader, type Tone } from '../../components/ui';
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

function RecentRuns({ runs, failed }: { runs: RecentRun[] | null; failed: boolean }) {
  const { t } = useTranslation();
  return (
    <Card aria-labelledby="recent-runs" className="flex flex-col gap-3.5">
      <h2 id="recent-runs" className="m-0 text-section text-ink">
        {t('recent.title')}
      </h2>
      {failed && <p className="m-0 text-coral-text">{t('recent.loadError')}</p>}
      {!failed && runs === null && <p className="m-0 text-muted">{t('common.loading')}</p>}
      {runs !== null && runs.length === 0 && (
        <p className="m-0 rounded-callout bg-neutral px-4 py-6 text-center text-label text-muted">
          {t('recent.empty')}
        </p>
      )}
      {runs !== null && runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-160 border-collapse text-label text-body">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <th scope="col" className="px-2 py-2.5 font-semibold">
                  {t('recent.col.time')}
                </th>
                <th scope="col" className="px-2 py-2.5 font-semibold">
                  {t('recent.col.flow')}
                </th>
                <th scope="col" className="px-2 py-2.5 font-semibold">
                  {t('recent.col.params')}
                </th>
                <th scope="col" className="px-2 py-2.5 font-semibold">
                  {t('recent.col.version')}
                </th>
                <th scope="col" className="px-2 py-2.5 font-semibold">
                  {t('recent.col.status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-b-0">
                  <td className="px-2 py-3 whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                  <td className="px-2 py-3">{r.flowName}</td>
                  <td className="px-2 py-3">{r.params.map(paramText).join(', ') || '-'}</td>
                  <td className="px-2 py-3">v{r.versionNo}</td>
                  <td className="px-2 py-3">
                    <Chip tone={STATUS_TONE[r.status]}>{t(`recent.status.${r.status}`)}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 text-small text-muted">{t('recent.note')}</p>
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
        className="flex max-w-60 flex-[1_1_200px] flex-col gap-1.5 px-3.5 py-5"
      >
        <Link
          to="/"
          aria-current="page"
          className="flex min-h-target items-center rounded-control bg-teal-tint px-3.5 text-label font-bold text-teal-strong no-underline"
        >
          {t('nav.runFlows')}
        </Link>
        <Link
          to="/change-password"
          className="flex min-h-target items-center rounded-control px-3.5 text-label font-medium text-body no-underline hover:bg-teal-tint hover:text-teal-strong"
        >
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
              <label htmlFor="flow-search" className="text-small font-semibold text-body">
                {t('flows.searchLabel')}
              </label>
              <input
                id="flow-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('flows.searchPlaceholder')}
                className="h-target w-70 max-w-full rounded-control border border-line-input bg-card px-3.5 text-label"
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
                  className={cx(
                    'min-h-target rounded-full px-4 text-small',
                    active
                      ? 'bg-teal-strong font-bold text-white'
                      : 'border border-line-input bg-card font-semibold text-body hover:bg-page',
                  )}
                >
                  {c ?? t('flows.allCategories')}
                </button>
              );
            })}
          </div>
        )}

        {failed && <p className="m-0 text-coral-text">{t('flows.loadError')}</p>}
        {flows === null && !failed && <p className="m-0 text-muted">{t('common.loading')}</p>}
        {flows !== null && visible.length === 0 && (
          <p className="m-0 text-muted">{t('flows.empty')}</p>
        )}

        <ul className="m-0 grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((f) => (
            <li key={f.code} className="flex">
              <article className="flex w-full flex-col gap-3 rounded-card border-t-[6px] border-teal bg-card p-6 shadow-card">
                <span className="self-start rounded-full bg-teal-tint-soft px-2.5 py-1 text-[11px] font-bold tracking-[0.06em] text-teal-strong uppercase">
                  {f.category}
                </span>
                <h2 className="m-0 text-section text-ink">{f.name}</h2>
                <p className="m-0 text-label text-muted">{f.description}</p>
                <p className="m-0 text-small text-muted">
                  {t('flows.inputs', { count: f.inputCount })}
                  {f.versionLabel ? ` · ${t('flows.version', { version: f.versionLabel })}` : ''}
                </p>
                <Link
                  to="/run/$flowCode"
                  params={{ flowCode: f.code }}
                  aria-label={t('flows.runNamed', { name: f.name })}
                  className={cx(buttonClass.primary, 'mt-auto no-underline hover:text-white')}
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
