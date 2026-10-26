import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '../components/ui';
import { signOutAndReload, useAuthService } from '../features/auth/auth-context';
import type { SessionUser } from '../features/auth/guard';

function initials(user: SessionUser): string {
  const source = user.fullName.trim() || user.username;
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words.at(-1)![0]] : [source[0], source[1]];
  return letters.filter(Boolean).join('').toUpperCase();
}

const itemClass =
  'flex min-h-target w-full items-center rounded-control px-3.5 text-left text-label font-medium text-body no-underline hover:bg-teal-tint hover:text-teal-strong';

/** Disclosure menu (button + list of links), closes on Escape / outside click / navigation. */
export function UserMenu({ user }: { user: SessionUser }) {
  const { t } = useTranslation();
  const auth = useAuthService();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const admin = user.role === 'admin';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('userMenu.open', { name: user.username })}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-target items-center gap-2.5 rounded-control px-2 text-label hover:bg-page"
      >
        <span
          aria-hidden
          className={cx(
            'flex size-9 items-center justify-center rounded-full text-small font-bold',
            admin ? 'bg-blue-tint text-blue-text' : 'bg-teal-tint text-teal-strong',
          )}
        >
          {initials(user)}
        </span>
        <span className="font-semibold text-body max-sm:sr-only">{user.username}</span>
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute right-0 z-40 mt-2 flex w-60 flex-col gap-1 rounded-tile bg-card p-2 shadow-card"
        >
          <p className="m-0 px-3.5 py-2 text-small text-muted">
            {user.fullName || user.username}
            <span className="block font-semibold text-body">{t(`userMenu.role.${user.role}`)}</span>
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            <li>
              <Link to="/" className={itemClass} onClick={() => setOpen(false)}>
                {t('nav.runFlows')}
              </Link>
            </li>
            {admin && (
              <li>
                <Link to="/admin/users" className={itemClass} onClick={() => setOpen(false)}>
                  {t('userMenu.admin')}
                </Link>
              </li>
            )}
            <li>
              <Link to="/change-password" className={itemClass} onClick={() => setOpen(false)}>
                {t('nav.changePassword')}
              </Link>
            </li>
            <li>
              <button
                type="button"
                className={itemClass}
                onClick={() => void signOutAndReload(auth)}
              >
                {t('userMenu.signOut')}
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
