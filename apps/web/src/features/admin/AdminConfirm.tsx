import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, type ConfirmTone } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { errorKeyOf, type AdminErrorKey } from './admin-api';

/** One confirmation asked by an Admin screen (List template, spec §25.5). */
export interface ConfirmRequest {
  /** Question naming the object ("Khóa tài khoản hr.nv07?"). */
  title: string;
  body: ReactNode;
  /** Label of the confirm button. */
  action: string;
  /** `danger` for lock / retire / delete: focus starts on "Hủy". */
  tone?: ConfirmTone;
  run: () => Promise<void>;
  /** Toast shown once `run` succeeded (AC-UI-73); none when the next screen says it already. */
  success?: string;
}

/**
 * `ConfirmDialog` running an Admin action: while it runs both buttons are disabled and Escape does
 * nothing; a failure stays in the dialog (localized), a success closes it and shows a toast.
 */
export function AdminConfirm({
  confirm,
  onClose,
}: {
  confirm: ConfirmRequest | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminErrorKey | null>(null);
  function close() {
    setError(null);
    onClose();
  }
  return (
    <ConfirmDialog
      open={confirm !== null}
      title={confirm?.title ?? ''}
      description={confirm?.body}
      confirmLabel={confirm?.action ?? ''}
      tone={confirm?.tone ?? 'primary'}
      busy={busy}
      error={error ? `${t('admin.errorLabel')} ${t(`admin.errors.${error}`)}` : null}
      onCancel={close}
      onConfirm={() => {
        if (!confirm || busy) return;
        setBusy(true);
        setError(null);
        confirm.run().then(
          () => {
            setBusy(false);
            close();
            if (confirm.success) toast.show({ tone: 'teal', message: confirm.success });
          },
          (e: unknown) => {
            setBusy(false);
            setError(errorKeyOf(e));
          },
        );
      }}
    />
  );
}
