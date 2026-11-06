import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField, TextInput } from '../../components/FormField';
import { ConclusionCard, KpiCard, KpiRow } from '../../components/KpiCard';
import { PageHeader, PageShell, Toolbar } from '../../components/layout';
import { Select } from '../../components/Select';
import { TabPanel, Tabs } from '../../components/Tabs';
import { Button, buttonClass, Callout, cardClass, cx, type Tone } from '../../components/ui';
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
import { DownloadIcon } from '../../components/icons';

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
      className="flex flex-wrap items-end gap-3"
    >
      {options.map((o) => (
        <FormField key={o.column} label={o.title} id={`filter-${o.column}`}>
          {(field) => (
            <Select
              id={field.id}
              value={values[o.column] ?? ''}
              onChange={(v) => onChange(o.column, v)}
              options={[
                { value: '', label: t('result.filterAll') },
                ...o.values.map((v) => ({ value: v, label: v })),
              ]}
              className="min-w-40"
            />
          )}
        </FormField>
      ))}
    </div>
  );
}

/**
 * The one dark card of the Result screen (AC-UI-09): the main conclusion of the comparison, from
 * the counts already in memory.
 */
function Conclusion({ cmp }: { cmp: NonNullable<RunSummary['compare']> }) {
  const { t } = useTranslation();
  const pending = cmp.mismatched + cmp.onlyLeft + cmp.onlyRight;
  const sides = { left: cmp.sideLabels.left, right: cmp.sideLabels.right };
  return (
    <ConclusionCard
      title={
        pending > 0
          ? t('result.conclusion.actionTitle', { count: pending })
          : t('result.conclusion.okTitle')
      }
      text={
        pending > 0
          ? t('result.conclusion.actionText', {
              ...sides,
              mismatched: formatInteger(cmp.mismatched),
              onlyLeft: formatInteger(cmp.onlyLeft),
              onlyRight: formatInteger(cmp.onlyRight),
            })
          : t('result.conclusion.okText', { ...sides, matched: formatInteger(cmp.matched) })
      }
    />
  );
}

const SEARCH_DEBOUNCE_MS = 250;

function SheetPanel({ sheet, tabsId }: { sheet: SheetInfo; tabsId: string }) {
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
    <TabPanel tabsId={tabsId} item={sheet.id} focusable={false} className="flex flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 pb-3">
        <Filters
          options={options}
          values={values}
          onChange={(column, value) => setValues((v) => ({ ...v, [column]: value }))}
        />
        <FormField label={t('result.search')} id={searchId} className="w-60 max-w-full">
          {(field) => (
            <TextInput
              {...field.input}
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </FormField>
      </div>
      {truncated && (
        <div className="px-4 pb-3">
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
    </TabPanel>
  );
}

const TABS_ID = 'result-sheets';

/** Card of the result sheets (Report template, §25.5): `Toolbar` with the sheet `Tabs` + table. */
function SheetTabs({ summary }: { summary: RunSummary }) {
  const { t } = useTranslation();
  const initial = summary.sheets.find((s) => s.role === 'mismatched') ?? summary.sheets[0];
  const [selected, setSelected] = useState(initial?.id ?? '');
  const current = summary.sheets.find((s) => s.id === selected) ?? initial;
  if (!current) return null;

  return (
    <section className={cx(cardClass, 'flex flex-col overflow-hidden')}>
      <Toolbar>
        <Tabs
          id={TABS_ID}
          label={t('result.tabsLabel')}
          selected={current.id}
          onChange={setSelected}
          items={summary.sheets.map((s) => ({
            id: s.id,
            tone: ROLE_TONE[s.role],
            label:
              s.role === 'summary'
                ? s.name
                : t('result.tabCount', { name: s.name, count: s.totalRows ?? s.rowCount }),
            badge: s.kind === 'preview' && (
              <span className="rounded-pill bg-neutral px-2 py-0.5 text-caption font-semibold text-muted">
                {t('result.viewOnly')}
              </span>
            ),
          }))}
        />
      </Toolbar>
      <SheetPanel key={current.id} sheet={current} tabsId={TABS_ID} />
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
      <PageShell width="content">
        <BackToFlows />
        <Callout tone="amber" label={t('result.noteLabel')} role="status">
          {t('result.noSession')}
        </Callout>
        <Link
          to="/run/$flowCode"
          params={{ flowCode }}
          className={cx(buttonClass('primary'), 'self-start no-underline hover:text-white')}
        >
          {t('result.goRun')}
        </Link>
      </PageShell>
    );
  }

  const cmp = summary.compare;
  const period = periodOf(state, state.run.params);
  // "khớp toàn bộ" only when nothing needs attention (MEMORY 2026-11-03 10:49): N counts the same
  // employees as the dark conclusion card (differ + only in one file).
  const pending = cmp ? cmp.mismatched + cmp.onlyLeft + cmp.onlyRight : 0;
  const title = cmp
    ? pending > 0
      ? period
        ? t('result.titlePending', { period, count: pending })
        : t('result.titlePendingNoPeriod', { count: pending })
      : period
        ? t('result.titleMatchedCount', { period, count: cmp.matched })
        : t('result.titleMatchedCountNoPeriod', { count: cmp.matched })
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
    <PageShell width="content">
      <BackToFlows />
      <PageHeader
        variant="showcase"
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
        <KpiRow label={t('result.kpi.label')}>
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
        </KpiRow>
      )}
      {cmp && <Conclusion cmp={cmp} />}

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
    </PageShell>
  );
}
