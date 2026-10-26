import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { cx } from './ui';

/**
 * Building blocks shared by MonthPicker and DatePicker: the input-like trigger button, the
 * non-modal popover dialog (closes on Escape / outside click / focus leaving it, returns focus to
 * the trigger on Escape; inside a modal <dialog> Escape closes only the picker) and the icons. No dependency.
 */

const iconProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className} {...iconProps}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function ChevronIcon({ dir, className }: { dir: 'left' | 'right'; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className={className} {...iconProps}>
      <path d={dir === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

export const triggerClass =
  'inline-flex h-target min-w-48 items-center justify-between gap-3 rounded-control border ' +
  'border-line-input bg-card px-3.5 text-left text-label text-ink hover:border-teal-strong ' +
  'disabled:cursor-not-allowed disabled:bg-neutral disabled:text-muted';

export const navButtonClass =
  'inline-flex size-target items-center justify-center rounded-control text-ink hover:bg-teal-tint hover:text-teal-strong';

export const footerButtonClass =
  'inline-flex min-h-target items-center rounded-control px-3 text-label font-semibold text-teal-strong hover:bg-teal-tint';

export const cellBaseClass =
  'flex min-h-target min-w-target items-center justify-center rounded-control text-label';

export function cellClass(selected: boolean, current: boolean): string {
  return cx(
    cellBaseClass,
    selected
      ? 'bg-teal-strong font-bold text-white'
      : cx(
          'text-body hover:bg-teal-tint hover:text-teal-strong',
          current && 'font-bold text-teal-strong ring-2 ring-teal ring-inset',
        ),
  );
}

const PANEL_MAX_WIDTH = 336;
const VIEWPORT_MARGIN = 12;

/** Horizontal shift (px, <= 0) keeping a panel of the given width inside the viewport. */
export function panelShift(triggerLeft: number, viewportWidth: number, width: number): number {
  const panel = Math.min(width, viewportWidth - VIEWPORT_MARGIN * 2);
  const overflow = triggerLeft + panel - (viewportWidth - VIEWPORT_MARGIN);
  return overflow > 0 ? -Math.min(overflow, Math.max(0, triggerLeft - VIEWPORT_MARGIN)) : 0;
}

export function usePickerPopover(triggerRef: RefObject<HTMLButtonElement | null>) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(
    (focusTrigger: boolean) => {
      setOpen(false);
      if (focusTrigger) triggerRef.current?.focus();
    },
    [triggerRef],
  );

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setShift(panelShift(rect.left, window.innerWidth, PANEL_MAX_WIDTH));
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    // Fallback for a picker inside a modal <dialog>: if the browser still raises the dialog's
    // `cancel` (close request) while the picker is open, it closes the picker only.
    const onCancel = (e: Event) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && e.target.contains(root)) {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('cancel', onCancel, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('cancel', onCancel, true);
    };
  }, [open, close]);

  return { open, setOpen, close, shift, rootRef };
}

export function PickerPanel({
  labelledBy,
  shift,
  onClose,
  rootRef,
  children,
}: {
  labelledBy: string;
  shift: number;
  onClose: (focusTrigger: boolean) => void;
  rootRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledBy}
      style={{
        left: shift,
        width: `min(${PANEL_MAX_WIDTH}px, calc(100vw - ${VIEWPORT_MARGIN * 2}px))`,
      }}
      className="absolute top-full z-40 mt-2 flex flex-col gap-2 rounded-card bg-card p-3 shadow-card"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // preventDefault: inside a modal <dialog> the browser would otherwise turn this Escape
          // into a close request for the dialog too (only the picker must close).
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        }
      }}
      onBlur={(e) => {
        // Non-modal: leaving the dialog with Tab closes it.
        const next = e.relatedTarget as Node | null;
        if (next && !rootRef.current?.contains(next)) onClose(false);
      }}
    >
      {children}
    </div>
  );
}
