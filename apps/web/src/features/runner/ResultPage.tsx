import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '../../components/Select';
import {
  Button,
  buttonClass,
  Callout,
  cx,
  DownloadIcon,
  PageHeader,
  toneText,
  toneTint,
  type Tone,
} from '../../components/ui';
import type {
  FilterOption,
  ParamValues,
  RowFilter,
  RunSummary,
  SheetInfo,
  SheetRole,
} from '../../engine/protocol';
import { formatDecimalString, formatInteger, formatMonth, formatSeconds } from '../../lib/format';
import { ResultTable, type SortState } from './components/ResultTable';
import { useRunState, useRunStore } from './run-context';
import { BackToFlows, useOpenFlow } from './RunPage';
import type { SessionState } from './run-store';

const ROLE_TONE: Record<SheetRole, Tone> = {
  summary: 'teal',
  mismatched: 'coral',
  only_left: 'amber',
  only_right: 'amber',
  table: 'blue',
};

function periodOf(state: SessionState, params: ParamValues): string | null {
  const defs = state.flow?.params ?? [];
  const def = defs.find((p) => p.isAsOfDate) ?? defs.find((p) => p.type === 'month');
  const v = def ? params[def.key] : null;
  if (typeof v !== 'string' || !v) return null;
  return def?.type === 'month' ? formatMonth(v) : v;
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  const border: Record<Tone, string> = {
    teal: 'border-teal',
    coral: 'border-coral',
    amber: 'border-amber',
    blue: 'border-blue',
    neutral: 'border-line-input',
  };
  return (
    <div
      className={cx('rounded-card border-t-8 bg-card px-5.5 py-5 shadow-card', border[tone])}
      data-testid="kpi"
    >
      <dt className="text-small font-semibold text-muted">{label}</dt>
      <dd className={cx('m-0 text-kpi', toneText[tone])}>{formatInteger(value)}</dd>
    </div>
  );
}

function Filters({
  options,
  values,
  onChange,
}: {
  options: FilterOption[];
  values: Record<string, string>;
  onChange: (column: string, value: string) => void;
}) {
  const { t } = useTranslation();
  if (options.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t('result.filtersLabel')}
      className="flex flex-wrap items-end gap-3 px-5 py-3.5"
    >
      {options.map((o) => {
        const id = `filter-${o.column}`;
        return (
          <div key={o.column} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-small font-semibold text-body">
              {o.title}
            </label>
            <Select
              id={id}
              value={values[o.column] ?? ''}
              onChange={(v) => onChange(o.column, v)}
              options={[
                { value: '', label: t('result.filterAll') },
                ...o.values.map((v) => ({ value: v, label: v })),
              ]}
              className="min-w-40"
            />
          </div>
        );
      })}
    </div>
  );
}

const SEARCH_DEBOUNCE_MS = 250;

function SheetPanel({ sheet, tabId }: { sheet: SheetInfo; tabId: string }) {
  const { t } = useTranslation();
  const store = useRunStore();
  const [options, setOptions] = useState<FilterOption[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState>(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const searchId = `search-${sheet.id}`;
  const truncated =
    sheet.kind === 'preview' && sheet.totalRows !== undefined && sheet.totalRows > sheet.rowCount;

  useEffect(() => {
    let alive = true;
    void store.getFilterOptions(sheet.id).then((o) => alive && setOptions(o));
    return () => {
      alive = false;
    };
  }, [store, sheet.id]);

  const filters = useMemo<RowFilter[]>(
    () =>
      options
        .filter((o) => values[o.column])
        .map((o) => ({ column: o.column, op: o.op, value: values[o.column]! })),
    [options, values],
  );

  return (
    <div role="tabpanel" id={`panel-${sheet.id}`} aria-labelledby={tabId} className="flex flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 pr-5">
        <Filters
          options={options}
          values={values}
          onChange={(column, value) => setValues((v) => ({ ...v, [column]: value }))}
        />
        <div className={cx('flex flex-col gap-1', options.length === 0 && 'pt-3.5 pl-5')}>
          <label htmlFor={searchId} className="text-small font-semibold text-body">
            {t('result.search')}
          </label>
          <input
            id={searchId}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-target w-60 rounded-control border border-line-input bg-card px-3 text-label"
          />
        </div>
      </div>
      <div className="h-3" />
      {truncated && (
        <div className="px-5 pb-3">
          <Callout tone="blue" label={t('result.noteLabel')} role="status">
            {t('result.truncated', {
              shown: formatInteger(sheet.rowCount),
              total: formatInteger(sheet.totalRows ?? 0),
            })}
          </Callout>
        </div>
      )}
      <ResultTable
        key={`${sheet.id}|${JSON.stringify(filters)}|${JSON.stringify(sort)}|${search}`}
        sheet={sheet}
        filters={filters}
        label={sheet.name}
        sort={sort}
        search={search}
        onSort={setSort}
      />
    </div>
  );
}

function SheetTabs({ summary }: { summary: RunSummary }) {
  const { t } = useTranslation();
  const initial = summary.sheets.find((s) => s.role === 'mismatched') ?? summary.sheets[0];
  const [selected, setSelected] = useState(initial?.id ?? '');
  const current = summary.sheets.find((s) => s.id === selected) ?? initial;
  if (!current) return null;

  const tabId = (s: SheetInfo) => `tab-${s.id}`;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = summary.sheets.length;
    const i = summary.sheets.findIndex((s) => s.id === current.id);
    // WAI-ARIA tabs pattern: arrows wrap around, Home/End jump to the first/last tab.
    const target =
      e.key === 'ArrowRight'
        ? (i + 1) % n
        : e.key === 'ArrowLeft'
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1;
    if (target < 0) return;
    e.preventDefault();
    const next = summary.sheets[target]!;
    setSelected(next.id);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-card bg-card shadow-card">
      <div
        role="tablist"
        aria-label={t('result.tabsLabel')}
        onKeyDown={onKey}
        className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3"
      >
        {summary.sheets.map((s) => {
          const active = s.id === current.id;
          const tone = ROLE_TONE[s.role];
          return (
            <button
              key={s.id}
              id={tabId(s)}
              type="button"
              role="tab"
              aria-selected={active}
              // Only the selected tab's panel exists in the DOM.
              aria-controls={active ? `panel-${s.id}` : undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => setSelected(s.id)}
              className={cx(
                'min-h-target rounded-full px-4 text-label',
                active
                  ? cx('font-bold', toneTint[tone], toneText[tone])
                  : 'font-semibold text-muted hover:bg-page',
              )}
            >
              {s.role === 'summary'
                ? s.name
                : t('result.tabCount', { name: s.name, count: s.totalRows ?? s.rowCount })}
              {s.kind === 'preview' && (
                <span className="ml-2 rounded-full bg-neutral px-2 py-0.5 text-xs font-bold text-muted">
                  {t('result.viewOnly')}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <SheetPanel key={current.id} sheet={current} tabId={tabId(current)} />
    </section>
  );
}

export function ResultPage() {
  const { flowCode } = useParams({ from: '/run/$flowCode/result' });
  const { t } = useTranslation();
  const { t: te } = useTranslation('engine');
  const store = useRunStore();
  const state = useRunState();
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);
  useOpenFlow(flowCode);

  const summary = state.code === flowCode ? state.run.summary : null;
  if (!summary) {
    return (
      <main id="main" className="mx-auto flex max-w-280 flex-col gap-5.5 px-4 pt-7 pb-12">
        <BackToFlows />
        <Callout tone="amber" label={t('result.noteLabel')} role="status">
          {t('result.noSession')}
        </Callout>
        <Link
          to="/run/$flowCode"
          params={{ flowCode }}
          className={cx(buttonClass.primary, 'self-start no-underline hover:text-white')}
        >
          {t('result.goRun')}
        </Link>
      </main>
    );
  }

  const cmp = summary.compare;
  const period = periodOf(state, state.run.params);
  const title = cmp
    ? cmp.mismatched > 0
      ? period
        ? t('result.titleMismatched', { period, count: cmp.mismatched })
        : t('result.titleMismatchedNoPeriod', { count: cmp.mismatched })
      : period
        ? t('result.titleMatched', { period })
        : t('result.titleMatchedNoPeriod')
    : t('result.titleGeneric');
  const eyebrow = t('result.eyebrow', {
    rows: summary.inputs.map((i) => formatInteger(i.rows)).join(' + '),
    seconds: formatSeconds(summary.durationMs),
  });
  const thresholds = cmp
    ? t('result.thresholds', {
        list: cmp.metrics.map((m) => `${m.label} ${formatDecimalString(m.tolerance)}`).join(' · '),
      })
    : undefined;

  const download = (index: number) => {
    setDownloading(true);
    void store.downloadArtifact(index).finally(() => setDownloading(false));
  };

  return (
    <main id="main" className="mx-auto flex max-w-280 flex-col gap-5.5 px-4 pt-7 pb-12">
      <BackToFlows />
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        subtitle={thresholds}
        actions={
          <>
            <Button
              onClick={() => {
                store.resetRun();
                void navigate({ to: '/run/$flowCode', params: { flowCode } });
              }}
            >
              {t('result.rerun')}
            </Button>
            {summary.artifacts.map((a) => (
              <Button
                key={a.index}
                variant="primary"
                disabled={downloading}
                onClick={() => download(a.index)}
                title={a.fileName}
              >
                <DownloadIcon />
                {summary.artifacts.length === 1
                  ? t('result.download', {
                      count: summary.sheets.filter((s) => s.kind !== 'preview').length,
                    })
                  : t('result.downloadNamed', { name: a.fileName })}
              </Button>
            ))}
          </>
        }
      />

      {cmp && (
        <dl
          aria-label={t('result.kpi.label')}
          className="m-0 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <KpiCard label={t('result.kpi.matched')} value={cmp.matched} tone="teal" />
          <KpiCard label={t('result.kpi.mismatched')} value={cmp.mismatched} tone="coral" />
          <KpiCard
            label={t('result.kpi.onlyLeft', { side: cmp.sideLabels.left })}
            value={cmp.onlyLeft}
            tone="amber"
          />
          <KpiCard
            label={t('result.kpi.onlyRight', { side: cmp.sideLabels.right })}
            value={cmp.onlyRight}
            tone="amber"
          />
        </dl>
      )}

      {summary.warnings.length > 0 && (
        <Callout tone="amber" label={t('result.warningsLabel')} role="status">
          <span className="flex flex-col gap-1">
            {summary.warnings.map((w, i) => {
              const node = state.flow?.nodes.find((n) => n.id === w.nodeId);
              return (
                <span key={i}>
                  {te(w.messageKey, { node: node?.label ?? w.nodeId, ...w.params })}
                </span>
              );
            })}
          </span>
        </Callout>
      )}

      <SheetTabs summary={summary} />

      <Callout tone="amber" label={t('result.noteLabel')}>
        {t('result.note')}
      </Callout>
    </main>
  );
}
