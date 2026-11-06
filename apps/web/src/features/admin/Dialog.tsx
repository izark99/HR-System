import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cx, floatClass } from '../../components/ui';
import { CloseIcon } from '../../components/icons';

/**
 * Modal dialog on the native <dialog> element: focus trap, Escape and inert background come
 * from the browser.
 */
export function Dialog({
  open,
  onClose,
  title,
  initialFocusId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Element focused when the dialog opens (default: the browser's choice, the close button). */
  initialFocusId?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      if (initialFocusId) d.querySelector<HTMLElement>(`#${initialFocusId}`)?.focus();
    }
    if (!open && d.open) d.close();
  }, [open, initialFocusId]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className={cx(
        floatClass,
        'm-auto w-[min(520px,calc(100vw-24px))] p-0 text-ink backdrop:bg-ink/40',
      )}
    >
      {open && (
        <div className="flex flex-col gap-4 p-6 max-sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="m-0 text-title-sm text-ink">
              {title}
            </h2>
            <button
              type="button"
              aria-label={t('admin.dialog.close')}
              onClick={onClose}
              className="inline-flex size-target shrink-0 items-center justify-center rounded-card hover:bg-neutral"
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
