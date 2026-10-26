import { useRouterState } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Callout, LockIcon, type Tone } from '../../components/ui';
import { useAuth, useAuthService } from './auth-context';
import { AuthLayout, authCardClass, authInputClass } from './AuthLayout';
import type { AuthErrorKey } from './credentials';
import type { SignedOutReason } from './guard';

function isReason(v: string | null): v is SignedOutReason {
  return v !== null && Object.hasOwn(REASON_TONE, v);
}

const REASON_TONE: Record<SignedOutReason, Tone> = {
  locked: 'coral',
  profileMissing: 'coral',
  profileError: 'coral',
  sessionExpired: 'amber',
  signedOut: 'teal',
};

export function LoginPage() {
  const { t } = useTranslation();
  const auth = useAuthService();
  const state = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AuthErrorKey | 'missingFields' | null>(null);
  const [busy, setBusy] = useState(false);
  // After a reload the reason arrives in the URL (?reason=…), set by the app itself.
  const fromUrl = useRouterState({
    select: (s) => new URLSearchParams(s.location.searchStr).get('reason'),
  });
  const reason =
    (state.status === 'signedOut' ? state.reason : undefined) ??
    (isReason(fromUrl) ? fromUrl : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError('missingFields');
      return;
    }
    setBusy(true);
    setError(null);
    const problem = await auth.signIn(username, password);
    setBusy(false);
    if (problem) {
      setError(problem);
      setPassword('');
    }
    // On success the route guard moves on (home, or the page asked for before login).
  }

  return (
    <AuthLayout>
      <form className={authCardClass} onSubmit={(e) => void submit(e)} noValidate>
        <h1 className="m-0 text-2xl font-bold tracking-[-0.5px]">{t('auth.login.title')}</h1>
        <p className="m-0 text-label text-muted">{t('auth.login.note')}</p>

        {reason && !error && (
          <Callout
            tone={REASON_TONE[reason]}
            label={t(`auth.reason.${reason}.label`)}
            role="status"
          >
            {t(`auth.reason.${reason}.text`)}
          </Callout>
        )}
        {error && (
          <Callout tone="coral" label={t('auth.errorLabel')} role="alert">
            {t(`auth.errors.${error}`)}
          </Callout>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-username" className="text-label font-semibold text-body">
            {t('auth.login.username')}
          </label>
          <input
            id="login-username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={authInputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-password" className="text-label font-semibold text-body">
            {t('auth.login.password')}
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
          />
        </div>
        <Button type="submit" variant="primary" disabled={busy} className="h-11.5 text-copy">
          {busy ? t('auth.login.submitting') : t('auth.login.submit')}
        </Button>
        <Callout
          tone="teal"
          label={t('run.safety.label')}
          icon={<LockIcon className="mt-0.5 shrink-0 text-teal-strong" />}
          className="text-small"
        >
          {t('auth.login.safety')}
        </Callout>
      </form>
    </AuthLayout>
  );
}
