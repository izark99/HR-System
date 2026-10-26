import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClass, Callout, cx, Eyebrow } from '../../components/ui';
import { signOutAndReload, useAuth, useAuthService } from './auth-context';
import { AuthLayout, authCardClass, authInputClass } from './AuthLayout';
import {
  checkNewPassword,
  MIN_PASSWORD_LENGTH,
  type AuthErrorKey,
  type PasswordProblem,
} from './credentials';

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const auth = useAuthService();
  const state = useAuth();
  const forced = state.status === 'signedIn' && state.user.mustChangePassword;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<PasswordProblem | null>(null);
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const p = checkNewPassword(password, confirm);
    setProblem(p);
    setError(null);
    if (p) return;
    setBusy(true);
    const err = await auth.changePassword(password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setPassword('');
    setConfirm('');
    // Forced change: continue into the app. Voluntary change: confirm here.
    if (forced) void navigate({ to: '/', replace: true });
    else setDone(true);
  }

  const message = problem
    ? t(`auth.password.problem.${problem}`, { min: MIN_PASSWORD_LENGTH })
    : error
      ? t(`auth.errors.${error}`)
      : null;

  return (
    <AuthLayout>
      <form
        className={cx(authCardClass, 'border-t-8 border-amber')}
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        <Eyebrow tone="amber">
          {forced ? t('auth.password.eyebrowFirst') : t('auth.password.eyebrow')}
        </Eyebrow>
        <h1 className="m-0 text-2xl font-bold tracking-[-0.5px]">{t('auth.password.title')}</h1>
        <p className="m-0 text-label text-muted" id="password-rules">
          {forced
            ? t('auth.password.introFirst', { min: MIN_PASSWORD_LENGTH })
            : t('auth.password.intro', { min: MIN_PASSWORD_LENGTH })}
        </p>

        {message && (
          <Callout tone="coral" label={t('auth.errorLabel')} role="alert">
            {message}
          </Callout>
        )}
        {done && !forced && (
          <Callout tone="teal" label={t('auth.password.doneLabel')} role="status">
            {t('auth.password.done')}
          </Callout>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-password" className="text-label font-semibold text-body">
            {t('auth.password.new')}
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            aria-describedby="password-rules"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm-password" className="text-label font-semibold text-body">
            {t('auth.password.confirm')}
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={authInputClass}
          />
        </div>
        {/* Dark ink button per wireframe (white text on #1F2A44 passes WCAG AA). */}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11.5 items-center justify-center rounded-control bg-ink px-5 text-copy font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? t('auth.password.saving') : t('auth.password.save')}
        </button>
        {forced ? (
          <button
            type="button"
            onClick={() => void signOutAndReload(auth)}
            className={cx(buttonClass.secondary)}
          >
            {t('userMenu.signOut')}
          </button>
        ) : (
          <Link to="/" className={cx(buttonClass.secondary, 'no-underline hover:text-ink')}>
            {t('auth.password.back')}
          </Link>
        )}
      </form>
    </AuthLayout>
  );
}
