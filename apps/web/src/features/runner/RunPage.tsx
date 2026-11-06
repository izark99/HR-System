import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PageHeader, PageShell, StickyActionBar } from '../../components/layout';
import { Stepper } from '../../components/Stepper';
import { Button, buttonClass, Callout, cx } from '../../components/ui';
import { formatMonth } from '../../lib/format';
import { asOfParam } from './as-of';
import { ParamsCard } from './components/ParamsCard';
import { RunProgress } from './components/RunProgress';
import { SlotCard } from './components/SlotCard';
import { ValidationReport } from './components/ValidationReport';
import { readiness, type Readiness } from './readiness';
import { useRunState, useRunStore } from './run-context';
import type { SessionState } from './run-store';
import { LoadingRegion, PageSkeleton } from '../../components/Skeleton';
import { ArrowLeftIcon, LockIcon } from '../../components/icons';

function currentStep(state: SessionState, ready: Readiness): number {
  const s = state.run.status;
  if (s === 'done') return 3;
  if (s === 'running' || s === 'cancelling') return 2;
  return ready.missingParams.length > 0 ? 0 : 1;
}

function runLabel(state: SessionState, ready: Readiness, t: TFunction) {
  if (state.run.status === 'running' || state.run.status === 'cancelling') {
    return t('run.actions.running');
  }
  if (state.restoreFailed) return t('run.actions.restoreFailed');
  if (state.versionCheck === 'resolving') return t('run.actions.resolvingVersion');
  if (state.versionCheck === 'none') return t('run.actions.noVersion');
  if (state.versionCheck === 'error') return t('run.actions.versionError');
  if (ready.validating || state.restoring) return t('run.actions.validating');
  if (ready.errors > 0) return t('run.actions.fixErrors', { count: ready.errors });
  if (ready.missingSlots.length > 0) return t('run.actions.needFiles');
  if (ready.missingParams.length > 0) return t('run.actions.needParams');
  return t('run.actions.run');
}

/** "dd/MM/yyyy" from an ISO date. */
function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** The day before an exclusive upper bound, as dd/MM/yyyy. */
function lastDay(exclusiveTo: string): string {
  const d = new Date(`${exclusiveTo}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return formatIsoDate(d.toISOString().slice(0, 10));
}

/** Which period the as-of date comes from, for the callout text. */
function periodText(state: SessionState, t: TFunction): string {
  const p = state.flow ? asOfParam(state.flow.params) : undefined;
  const v = p ? String(state.params[p.key] ?? '') : '';
  if (!p || !v) return t('run.version.today');
  return p.type === 'month'
    ? t('run.version.period', { period: formatMonth(v) })
    : t('run.version.date', { date: formatIsoDate(v) });
}

/** "Phiên bản áp dụng: v3, hiệu lực từ 01/09/2026, theo kỳ đã chọn." (wireframe, spec §15.1). */
function VersionCallout({ state, onRetry }: { state: SessionState; onRetry: () => void }) {
  const { t } = useTranslation();
  const v = state.version;
  if (!v) return null;
  const className = 'flex-[1_1_320px]';
  if (state.versionCheck === 'resolving') {
    return (
      <Callout tone="blue" label={t('run.version.label')} role="status" className={className}>
        {t('run.version.resolving')}
      </Callout>
    );
  }
  if (state.versionCheck === 'none') {
    return (
      <Callout tone="coral" label={t('run.version.noneLabel')} role="alert" className={className}>
        {t('run.version.none', { when: periodText(state, t) })}
      </Callout>
    );
  }
  if (state.versionCheck === 'error') {
    return (
      <div className={cx('flex flex-col gap-2', className)}>
        <Callout tone="coral" label={t('run.version.errorLabel')} role="alert">
          {t('run.version.error')}
        </Callout>
        <Button className="self-start" onClick={onRetry}>
          {t('run.version.retry')}
        </Button>
      </div>
    );
  }
  const p = state.flow ? asOfParam(state.flow.params) : undefined;
  const chosen = p && String(state.params[p.key] ?? '') !== '';
  return (
    <Callout tone="blue" label={t('run.version.label')} role="status" className={className}>
      {t(v.effectiveTo ? 'run.version.rangeTo' : 'run.version.range', {
        version: `v${v.versionNo}`,
        from: formatIsoDate(v.effectiveFrom),
        to: v.effectiveTo ? lastDay(v.effectiveTo) : '',
      })}
      {chosen ? t('run.version.forPeriod') : t('run.version.forToday')}
    </Callout>
  );
}

export function useOpenFlow(flowCode: string) {
  const store = useRunStore();
  useEffect(() => {
    void store.open(flowCode);
  }, [store, flowCode]);
}

const STEPS = ['params', 'upload', 'run', 'result'] as const;

/** The four wizard steps (spec §15.1) for `Stepper`. */
export function useRunSteps() {
  const { t } = useTranslation();
  return STEPS.map((id) => ({ id, label: t(`run.step.${id}`) }));
}

export function BackToFlows() {
  const { t } = useTranslation();
  return (
    <Link to="/" className="inline-flex min-h-target items-center gap-2 self-start text-label">
      <ArrowLeftIcon />
      {t('run.back')}
    </Link>
  );
}

export function RunPage() {
  const { flowCode } = useParams({ from: '/run/$flowCode' });
  const { t } = useTranslation();
  const store = useRunStore();
  const state = useRunState();
  const navigate = useNavigate();
  useOpenFlow(flowCode);

  // Show the result once a run started from this page finishes.
  const prevStatus = useRef(state.run.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = state.run.status;
    if (prev === 'running' && state.run.status === 'done') {
      void navigate({ to: '/run/$flowCode/result', params: { flowCode } });
    }
  }, [state.run.status, navigate, flowCode]);

  const ready = readiness(state);
  const flow = state.flow;
  const busy = state.run.status === 'running' || state.run.status === 'cancelling';
  const steps = useRunSteps();
  const loaded = state.load === 'ready' && flow && state.summary;

  return (
    // Wizard (spec §25.5): the sticky action bar is the last block, flush with the page bottom.
    <PageShell width="content" className="pb-0">
      {!loaded && <BackToFlows />}

      {state.load === 'loading' && (
        <LoadingRegion>
          <PageSkeleton />
        </LoadingRegion>
      )}
      {state.load === 'notFound' && <Callout tone="coral" label={t('run.notFound')} role="alert" />}
      {state.load === 'error' && (
        <div className="flex flex-col items-start gap-3">
          <Callout tone="coral" label={t('run.loadErrorLabel')} role="alert">
            {t('run.loadError')}
          </Callout>
          <Button onClick={() => void store.open(flowCode)}>{t('run.version.retry')}</Button>
        </div>
      )}
      {state.load === 'invalid' && (
        <Callout tone="coral" label={t('run.loadFailed')} role="alert">
          {state.problems.join('; ')}
        </Callout>
      )}

      {loaded && (
        <>
          <PageHeader
            back={<BackToFlows />}
            title={state.summary!.name}
            oneLineTitle
            subtitle={
              state.summary!.instructions ? (
                <>
                  {t('run.instructions')} {state.summary!.instructions}
                </>
              ) : (
                state.summary!.description
              )
            }
          />
          <Stepper label={t('run.stepsLabel')} steps={steps} current={currentStep(state, ready)} />

          <ParamsCard
            params={flow.params}
            values={state.params}
            disabled={busy}
            onChange={(k, v) => store.setParam(k, v)}
            aside={<VersionCallout state={state} onRetry={() => store.retryVersion()} />}
          />

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {flow.inputSlots.map((slot) => {
              const slotState = state.slots[slot.key];
              if (!slotState) return null;
              return (
                <SlotCard
                  key={slot.key}
                  slot={slot}
                  state={slotState}
                  disabled={busy || state.restoring || state.restoreFailed}
                  onAdd={(files) => store.addFiles(slot.key, files)}
                  onRemove={(id) => store.removeFile(slot.key, id)}
                />
              );
            })}
          </div>

          <ValidationReport
            flow={flow}
            state={state}
            ready={ready}
            onDownload={() => store.downloadValidationReport()}
          />

          <RunProgress
            run={state.run}
            restoring={state.restoring}
            restoreFailed={state.restoreFailed}
            onRetryRestore={() => void store.retryRestore()}
          />

          <Callout
            tone="teal"
            label={t('run.safety.label')}
            icon={<LockIcon className="mt-0.5 shrink-0 text-teal-strong" />}
            size="caption"
          >
            {t('run.safety.text')}
          </Callout>

          {/* Always in view (AC-UI-72); in the flow of the page, so it never covers the end. */}
          <StickyActionBar label={t('run.actions.barLabel')} className="-mx-page-x">
            {busy ? (
              <Button
                onClick={() => void store.cancel()}
                disabled={state.run.status === 'cancelling'}
              >
                {state.run.status === 'cancelling'
                  ? t('run.actions.cancelling')
                  : t('run.actions.cancel')}
              </Button>
            ) : (
              <Link to="/" className={cx(buttonClass('outline'), 'no-underline hover:text-ink')}>
                {t('run.actions.back')}
              </Link>
            )}
            {/* The previous run's result is still in memory (MEMORY 13:08). */}
            {state.run.status === 'done' && state.run.summary && (
              <Link
                to="/run/$flowCode/result"
                params={{ flowCode }}
                className={cx(buttonClass('outline'), 'no-underline hover:text-ink')}
              >
                {t('run.actions.viewResult')}
              </Link>
            )}
            <Button
              variant="primary"
              disabled={!ready.canRun || busy}
              onClick={() => void store.run()}
            >
              {runLabel(state, ready, t)}
            </Button>
          </StickyActionBar>
        </>
      )}
    </PageShell>
  );
}
