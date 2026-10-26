import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, Card, cx, PageHeader } from '../../components/ui';
import type { FlowSummary } from './flow-source';
import { useRunStore } from './run-context';

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

  useEffect(() => {
    let alive = true;
    source.list().then(
      (list) => alive && setFlows(list),
      () => alive && setFailed(true),
    );
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
                  {f.versionLabel ? ` · ${f.versionLabel}` : ''}
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

        <Card aria-labelledby="recent-runs" className="flex flex-col gap-3.5">
          <h2 id="recent-runs" className="m-0 text-section text-ink">
            {t('recent.title')}
          </h2>
          <p className="m-0 rounded-callout bg-neutral px-4 py-6 text-center text-label text-muted">
            {t('recent.empty')}
          </p>
          <p className="m-0 text-small text-muted">{t('recent.note')}</p>
        </Card>
      </main>
    </div>
  );
}
