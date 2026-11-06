/**
 * State of the app-wide toasts (spec §25.5 "ToastProvider / useToast", AC-UI-67), kept apart from
 * React so the timing rules can be tested alone:
 * - at most `MAX_TOASTS` on screen; a new one pushes the oldest out;
 * - teal (success) and blue (info) close by themselves after `AUTO_DISMISS_MS`; the timer stops
 *   while the pointer is over the toast or it has focus, and starts again from the full delay;
 * - coral (error) and amber (warning) stay until closed.
 *
 * A toast holds only i18n text and the name of a configuration object (account, flow, version):
 * never personnel data.
 */

export type ToastTone = 'teal' | 'blue' | 'amber' | 'coral';

export interface ToastInput {
  tone: ToastTone;
  message: string;
}

export interface Toast extends ToastInput {
  id: number;
}

export const MAX_TOASTS = 3;
export const AUTO_DISMISS_MS = 5000;

/** Whether a toast of this tone closes by itself. */
export function autoDismisses(tone: ToastTone): boolean {
  return tone === 'teal' || tone === 'blue';
}

/** ARIA role of a toast: errors and warnings interrupt (`alert`), the rest is polite (`status`). */
export function toastRole(tone: ToastTone): 'status' | 'alert' {
  return tone === 'coral' || tone === 'amber' ? 'alert' : 'status';
}

export interface ToastStore {
  getSnapshot: () => readonly Toast[];
  subscribe: (listener: () => void) => () => void;
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
  /** Pointer over / focus inside the toast: hold its timer. */
  pause: (id: number) => void;
  resume: (id: number) => void;
  /** Remove everything and stop the timers. */
  clear: () => void;
}

interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createToastStore(timers: Timers = defaultTimers): ToastStore {
  let toasts: readonly Toast[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const handles = new Map<number, unknown>();

  const emit = () => listeners.forEach((l) => l());
  const stop = (id: number) => {
    if (!handles.has(id)) return;
    timers.clearTimeout(handles.get(id));
    handles.delete(id);
  };
  const start = (toast: Toast) => {
    stop(toast.id);
    if (!autoDismisses(toast.tone)) return;
    handles.set(
      toast.id,
      timers.setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS),
    );
  };
  const dismiss = (id: number) => {
    stop(id);
    const next = toasts.filter((t) => t.id !== id);
    if (next.length === toasts.length) return;
    toasts = next;
    emit();
  };

  return {
    getSnapshot: () => toasts,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show: (input) => {
      const toast: Toast = { id: nextId++, tone: input.tone, message: input.message };
      const all = [...toasts, toast];
      for (const old of all.slice(0, Math.max(0, all.length - MAX_TOASTS))) stop(old.id);
      toasts = all.slice(-MAX_TOASTS);
      start(toast);
      emit();
      return toast.id;
    },
    dismiss,
    pause: stop,
    resume: (id) => {
      const toast = toasts.find((t) => t.id === id);
      if (toast && !handles.has(id)) start(toast);
    },
    clear: () => {
      for (const id of [...handles.keys()]) stop(id);
      if (toasts.length === 0) return;
      toasts = [];
      emit();
    },
  };
}
