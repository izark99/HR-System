import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from '../../components/ui';

/**
 * Modal dialog on the native <dialog> element: focus trap, Escape and inert background come
 * from the browser.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(520px,calc(100vw-24px))] rounded-card border-0 bg-card p-0 text-ink shadow-card backdrop:bg-ink/40"
    >
      {open && (
        <div className="flex flex-col gap-4 p-6 max-sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="m-0 text-section text-ink">
              {title}
            </h2>
            <button
              type="button"
              aria-label={t('admin.dialog.close')}
              onClick={onClose}
              className="inline-flex size-target shrink-0 items-center justify-center rounded-control hover:bg-page"
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
