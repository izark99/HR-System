import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoTip } from './InfoTip';
import { CloseIcon } from './icons';
import { Button, cx, floatClass } from './ui';

/**
 * Modal dialog on the native <dialog> element (spec §25.3 "Dialog", §25.5): focus trap, Escape and
 * inert background come from the browser. Focus goes back to the element that had it before the
 * dialog opened (the opener) when the dialog closes, also when the browser leaves it on <body>.
 */
export function Dialog({
  open,
  onClose,
  title,
  initialFocusId,
  locked = false,
  hint,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /**
   * An action started from the dialog is running: Escape and the close button do nothing (the
   * dialog cannot be left half-way, e.g. while an account is being locked).
   */
  locked?: boolean;
  /**
   * Element focused when the dialog opens. Default: the element marked `data-autofocus` inside
   * the dialog, else the browser's choice (the close button).
   */
  initialFocusId?: string;
  /** Explanation of the dialog, behind an (i) button beside the title (`InfoTip`). */
  hint?: ReactNode;
  /** 720px instead of 520px (a data table inside, e.g. "Xem bảng"). */
  wide?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const lockedRef = useRef(locked);
  useEffect(() => {
    lockedRef.current = locked;
  }, [locked]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
      const target = initialFocusId
        ? d.querySelector<HTMLElement>(`#${CSS.escape(initialFocusId)}`)
        : (d.querySelector<HTMLElement>('[data-autofocus]') ??
          // The close button, as the browser would pick when no (i) button comes first.
          (hint ? d.querySelector<HTMLElement>('[data-dialog-close]') : null));
      target?.focus();
    }
    if (!open && d.open) d.close();
  }, [open, initialFocusId, hint]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-busy={locked || undefined}
      onCancel={(e) => {
        if (lockedRef.current) e.preventDefault();
      }}
      onClose={() => {
        // Chromium lets a repeated Escape close the dialog even when `cancel` is prevented: while
        // locked and still meant to be open, show it again instead of reporting a close.
        if (lockedRef.current && open) {
          ref.current?.showModal();
          return;
        }
        const back = opener.current;
        opener.current = null;
        onClose();
        // The browser normally restores focus itself; only step in when it did not.
        if (
          back?.isConnected &&
          (!document.activeElement || document.activeElement === document.body)
        )
          back.focus();
      }}
      className={cx(
        floatClass,
        'm-auto p-0 text-ink backdrop:bg-ink/40',
        wide ? 'w-[min(720px,calc(100vw-24px))]' : 'w-[min(520px,calc(100vw-24px))]',
      )}
    >
      {open && (
        <div className="flex flex-col gap-4 p-6 max-sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center">
              <h2 id={titleId} className="m-0 text-title-sm text-ink">
                {title}
              </h2>
              {hint && <InfoTip label={title}>{hint}</InfoTip>}
            </div>
            <button
              type="button"
              data-dialog-close
              aria-label={t('common.close')}
              disabled={locked}
              onClick={onClose}
              className="inline-flex size-target shrink-0 items-center justify-center rounded-card hover:bg-neutral disabled:cursor-not-allowed disabled:text-muted"
            >
              <CloseIcon />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/**
 * Button row at the bottom of a dialog (§25.5): right-aligned, in reading order Cancel (text
 * button) first and the primary / danger button last, so it sits at the outer edge.
 */
export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div data-dialog-footer className="flex flex-wrap items-center justify-end gap-3">
      {children}
    </div>
  );
}

export type ConfirmTone = 'primary' | 'danger';

/**
 * Which button gets focus when a confirmation opens (§25.5 "ConfirmDialog"): Cancel for a
 * destructive action, so a stray Enter cannot lock an account or retire a version; the confirm
 * button otherwise.
 */
export function confirmInitialFocus(tone: ConfirmTone): 'cancel' | 'confirm' {
  return tone === 'danger' ? 'cancel' : 'confirm';
}

/**
 * One-question confirmation ("Khóa tài khoản hr.nv07?"): `title` holds the object's name,
 * `description` the consequence. Escape / Cancel / the close button call `onCancel`; focus then
 * returns to the opener (see `Dialog`).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'primary',
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** Default: "Hủy". */
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** The action is running: both buttons are disabled, Escape / close do nothing. */
  busy?: boolean;
  /** Failure of the action, shown inside the dialog (it stays open). */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const focus = confirmInitialFocus(tone);
  const errorId = useId();
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      title={title}
      locked={busy}
    >
      {description && <div className="m-0 text-body text-ink-soft">{description}</div>}
      {error && (
        <p id={errorId} role="alert" className="m-0 text-caption text-coral-text">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button
          variant="text"
          disabled={busy}
          onClick={onCancel}
          data-autofocus={focus === 'cancel' || undefined}
        >
          {cancelLabel ?? t('common.cancel')}
        </Button>
        <Button
          variant={tone}
          disabled={busy}
          onClick={onConfirm}
          aria-describedby={error ? errorId : undefined}
          data-autofocus={focus === 'confirm' || undefined}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
