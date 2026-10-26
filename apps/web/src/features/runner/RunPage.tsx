import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ArrowLeftIcon,
  Button,
  buttonClass,
  Callout,
  cx,
  LockIcon,
  PageHeader,
} from '../../components/ui';
import { ParamsCard } from './components/ParamsCard';
import { RunProgress } from './components/RunProgress';
import { SlotCard } from './components/SlotCard';
import { Steps } from './components/Steps';
import { ValidationReport } from './components/ValidationReport';
import { readiness, type Readiness } from './readiness';
import { useRunState, useRunStore } from './run-context';
import type { SessionState } from './run-store';

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
  if (ready.validating || state.restoring) return t('run.actions.validating');
  if (ready.errors > 0) return t('run.actions.fixErrors', { count: ready.errors });
  if (ready.missingSlots.length > 0) return t('run.actions.needFiles');
  if (ready.missingParams.length > 0) return t('run.actions.needParams');
  return t('run.actions.run');
}

export function useOpenFlow(flowCode: string) {
  const store = useRunStore();
  useEffect(() => {
    void store.open(flowCode);
  }, [store, flowCode]);
}

export function BackToFlows() {
  const { t } = useTranslation();
  return (
    <Link
      to="/"
      className="inline-flex min-h-target items-center gap-1.5 self-start text-label font-semibold"
    >
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

  return (
    <main id="main" className="mx-auto flex max-w-260 flex-col gap-5.5 px-4 pt-7 pb-12">
      <BackToFlows />

      {state.load === 'loading' && <p className="m-0 text-muted">{t('common.loading')}</p>}
      {state.load === 'notFound' && <Callout tone="coral" label={t('run.notFound')} role="alert" />}
      {state.load === 'invalid' && (
        <Callout tone="coral" label={t('run.loadFailed')} role="alert">
          {state.problems.join('; ')}
        </Callout>
      )}

      {state.load === 'ready' && flow && state.summary && (
        <>
          <PageHeader
            eyebrow={state.summary.category}
            title={state.summary.name}
            subtitle={
              state.summary.instructions ? (
                <>
                  {t('run.instructions')} {state.summary.instructions}
                </>
              ) : (
                state.summary.description
              )
            }
          />
          <Steps current={currentStep(state, ready)} />

          <ParamsCard
            params={flow.params}
            values={state.params}
            disabled={busy}
            onChange={(k, v) => store.setParam(k, v)}
          />

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {flow.inputSlots.map((slot) => {
              const slotState = state.slots[slot.key];
              if (!slotState) return null;
              return (
                <SlotCard
                  key={slot.key}
                  slot={slot}
                  state={slotState}
                  disabled={busy || state.restoring}
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
            onCancel={() => void store.cancel()}
          />

          <div className="flex flex-wrap items-center justify-between gap-4">
            <Callout
              tone="teal"
              label={t('run.safety.label')}
              icon={<LockIcon className="mt-0.5 shrink-0 text-teal-strong" />}
              className="text-small"
            >
              {t('run.safety.text')}
            </Callout>
            <div className="flex flex-wrap gap-3">
              <Link to="/" className={cx(buttonClass.secondary, 'no-underline hover:text-ink')}>
                {t('run.actions.back')}
              </Link>
              <Button
                variant="primary"
                disabled={!ready.canRun || busy}
                onClick={() => void store.run()}
              >
                {runLabel(state, ready, t)}
              </Button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
