import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField, TextInput } from '../../components/FormField';
import { ArrowLeftIcon } from '../../components/icons';
import { PageHeader } from '../../components/layout';
import { Button, Callout } from '../../components/ui';
import { signOutAndReload, useAuth, useAuthService } from './auth-context';
import { AuthLayout, authCardClass } from './AuthLayout';
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
      <PageHeader
        eyebrow={forced ? t('auth.password.eyebrowFirst') : undefined}
        eyebrowTone="amber"
        back={
          forced ? undefined : (
            <Link
              to="/"
              className="inline-flex min-h-target items-center gap-2 self-start text-label"
            >
              <ArrowLeftIcon />
              {t('run.back')}
            </Link>
          )
        }
        title={t('auth.password.title')}
        subtitle={
          <span id="password-rules">
            {forced
              ? t('auth.password.introFirst', { min: MIN_PASSWORD_LENGTH })
              : t('auth.password.intro', { min: MIN_PASSWORD_LENGTH })}
          </span>
        }
      />
      <form className={authCardClass} onSubmit={(e) => void submit(e)} noValidate>
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

        <FormField label={t('auth.password.new')} id="new-password">
          {(field) => (
            <TextInput
              {...field.input}
              aria-describedby="password-rules"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('auth.password.confirm')} id="confirm-password">
          {(field) => (
            <TextInput
              {...field.input}
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </FormField>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {forced && (
            <Button variant="outline" onClick={() => void signOutAndReload(auth)}>
              {t('userMenu.signOut')}
            </Button>
          )}
          {/* Dark button per wireframe (white text on #1F2A44 passes WCAG AA). */}
          <Button type="submit" variant="dark" disabled={busy}>
            {busy ? t('auth.password.saving') : t('auth.password.save')}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
