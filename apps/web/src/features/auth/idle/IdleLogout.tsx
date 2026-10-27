import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Callout } from '../../../components/ui';
import { browserSessionStorage, clearStoredSession } from '../../../lib/supabase';
import { disposeAllEngines } from '../../runner/engine-client';
import { useAuthService } from '../auth-context';
import {
  hasUnsavedChanges,
  isEngineBusy,
  releaseUnsavedChangesGuard,
  subscribeEngineWork,
  subscribeUnsavedChanges,
} from './activity';
import { idleSignOut } from './idle-signout';
import { IdleTimer } from './idle-timer';

/** Interaction in this tab (spec §6.1). `scroll` does not bubble: listen in the capture phase. */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'];

export const IDLE_LOGIN_HREF = '/login?reason=idle';

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Mounted while signed in: counts inactivity, shows the 5-minute warning, signs out after 8 hours.
 * Sign-out: see idle-signout.ts (engines terminated, session removed at once, server revocation
 * awaited at most 3 s, then a full page load of the login screen).
 */
export function IdleLogout() {
  const { t } = useTranslation();
  const auth = useAuthService();
  const [timer] = useState(
    () =>
      new IdleTimer({
        now: () => Date.now(),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (h) => window.clearTimeout(h as number),
        onSignOut: () => {
          void idleSignOut({
            signOut: () => auth.signOut('idle'),
            disposeEngines: disposeAllEngines,
            releaseUnsavedGuard: releaseUnsavedChangesGuard,
            clearSession: () => clearStoredSession(browserSessionStorage()),
            redirect: () => window.location.assign(IDLE_LOGIN_HREF),
          });
        },
      }),
  );
  const snap = useSyncExternalStore(timer.subscribe, timer.getSnapshot);
  const unsaved = useSyncExternalStore(subscribeUnsavedChanges, hasUnsavedChanges);

  useEffect(() => {
    const onActivity = () => timer.activity();
    const onVisible = () => {
      if (document.visibilityState === 'visible') timer.check();
    };
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);

    let endBusy: (() => void) | null = isEngineBusy() ? timer.beginBusy() : null;
    const unsubscribe = subscribeEngineWork(() => {
      if (isEngineBusy() && !endBusy) endBusy = timer.beginBusy();
      if (!isEngineBusy() && endBusy) {
        endBusy();
        endBusy = null;
      }
    });
    return () => {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, { capture: true });
      }
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      unsubscribe();
      timer.dispose();
    };
  }, [timer]);

  return snap.phase === 'warning' && snap.deadline !== null ? (
    <IdleWarningDialog deadline={snap.deadline} unsaved={unsaved} onContinue={() => timer.extend()}>
      {t('idle.title')}
    </IdleWarningDialog>
  ) : null;
}

function IdleWarningDialog({
  deadline,
  unsaved,
  onContinue,
  children,
}: {
  deadline: number;
  unsaved: boolean;
  onContinue: () => void;
  children: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(id);
      if (d?.open) d.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      role="alertdialog"
      aria-labelledby="idle-title"
      aria-describedby="idle-text"
      // Escape must not dismiss it: only the button extends the session (spec §6.1).
      onCancel={(e) => e.preventDefault()}
      className="m-auto w-[min(480px,calc(100vw-24px))] rounded-card border-0 bg-card p-0 text-ink shadow-card backdrop:bg-ink/40"
    >
      <div className="flex flex-col gap-4 p-6 max-sm:p-4">
        <h2 id="idle-title" className="m-0 text-section text-ink">
          {children}
        </h2>
        <p id="idle-text" className="m-0 text-copy text-body">
          {t('idle.text')}{' '}
          <b className="font-bold text-amber-text" aria-live="off">
            {formatCountdown(deadline - now)}
          </b>
        </p>
        {unsaved && (
          <Callout tone="coral" label={t('idle.unsavedLabel')} role="alert">
            {t('idle.unsaved')}
          </Callout>
        )}
        <Button variant="primary" onClick={onContinue} className="self-end">
          {t('idle.continue')}
        </Button>
      </div>
    </dialog>
  );
}
