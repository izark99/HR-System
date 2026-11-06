import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircleIcon, CheckCircleIcon, CloseIcon, InfoIcon } from './icons';
import {
  createToastStore,
  toastRole,
  type Toast,
  type ToastInput,
  type ToastStore,
  type ToastTone,
} from './toast-store';
import { cx, floatClass, toneText } from './ui';

export type { ToastInput, ToastTone } from './toast-store';

export interface ToastApi {
  /** Show a toast; returns its id. `message`: i18n text (+ a configuration object's name). */
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Result of an action (saved, created, locked, published…) as a toast. Needs `ToastProvider`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast() must be used inside <ToastProvider>');
  return api;
}

const BAR: Record<ToastTone, string> = {
  teal: 'border-l-teal-strong',
  blue: 'border-l-blue-text',
  amber: 'border-l-amber',
  coral: 'border-l-coral-text',
};

function ToneIcon({ tone }: { tone: ToastTone }) {
  const className = cx('mt-0.5 shrink-0', toneText[tone]);
  if (tone === 'teal') return <CheckCircleIcon className={className} />;
  if (tone === 'blue') return <InfoIcon className={className} />;
  return <AlertCircleIcon size={20} className={className} />;
}

function ToastItem({ toast, store }: { toast: Toast; store: ToastStore }) {
  const { t } = useTranslation();
  // The timer holds while the pointer is over the toast OR focus is inside it.
  const hold = useRef({ hover: false, focus: false });
  const update = (key: 'hover' | 'focus', on: boolean) => {
    hold.current[key] = on;
    if (hold.current.hover || hold.current.focus) store.pause(toast.id);
    else store.resume(toast.id);
  };
  return (
    <div
      role={toastRole(toast.tone)}
      data-toast={toast.tone}
      onMouseEnter={() => update('hover', true)}
      onMouseLeave={() => update('hover', false)}
      onFocus={() => update('focus', true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) update('focus', false);
      }}
      className={cx(
        floatClass,
        'hr-toast pointer-events-auto flex items-start gap-3 border-l-4 py-1 pr-1 pl-4 text-body text-ink',
        BAR[toast.tone],
      )}
    >
      <span className="flex min-w-0 flex-1 items-start gap-3 py-2">
        <ToneIcon tone={toast.tone} />
        <span className="min-w-0 break-words">{toast.message}</span>
      </span>
      <button
        type="button"
        aria-label={t('common.closeNotification')}
        onClick={() => store.dismiss(toast.id)}
        className="inline-flex size-target shrink-0 items-center justify-center rounded-card text-ink hover:bg-neutral"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

/** The toast list, bottom right (mobile: bottom, full width), newest last. */
export function ToastViewport({ store }: { store: ToastStore }) {
  const { t } = useTranslation();
  const toasts = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return (
    <section
      aria-label={t('common.notifications')}
      data-toast-viewport
      className="pointer-events-none fixed right-6 bottom-6 z-50 flex w-96 max-w-[calc(100vw-48px)] flex-col gap-2 max-md:inset-x-4 max-md:bottom-4 max-md:w-auto max-md:max-w-none"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} store={store} />
      ))}
    </section>
  );
}

/**
 * One toast region for the whole app (spec §25.5, AC-UI-67), mounted at the app root. Blocking
 * errors inside a form are still shown in place, not as toasts.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => createToastStore());
  useEffect(() => () => store.clear(), [store]);
  const api = useMemo<ToastApi>(() => ({ show: store.show, dismiss: store.dismiss }), [store]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport store={store} />
    </ToastContext.Provider>
  );
}
