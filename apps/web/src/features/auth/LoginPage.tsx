import { useRouterState } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField, TextInput } from '../../components/FormField';
import { PageHeader } from '../../components/layout';
import { Button, Callout, type Tone } from '../../components/ui';
import { useAuth, useAuthService } from './auth-context';
import { AuthLayout, authCardClass } from './AuthLayout';
import type { AuthErrorKey } from './credentials';
import type { SignedOutReason } from './guard';
import { LockIcon } from '../../components/icons';

function isReason(v: string | null): v is SignedOutReason {
  return v !== null && Object.hasOwn(REASON_TONE, v);
}

const REASON_TONE: Record<SignedOutReason, Tone> = {
  locked: 'coral',
  profileMissing: 'coral',
  profileError: 'coral',
  sessionExpired: 'amber',
  signedOut: 'teal',
  idle: 'amber',
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
      <PageHeader
        variant="showcase"
        eyebrow={t('auth.eyebrow')}
        title={t('auth.login.title')}
        subtitle={t('auth.login.note')}
      />
      <form className={authCardClass} onSubmit={(e) => void submit(e)} noValidate>
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

        <FormField label={t('auth.login.username')} id="login-username">
          {(field) => (
            <TextInput
              {...field.input}
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          )}
        </FormField>
        <FormField label={t('auth.login.password')} id="login-password">
          {(field) => (
            <TextInput
              {...field.input}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </FormField>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('auth.login.submitting') : t('auth.login.submit')}
        </Button>
        <Callout
          tone="teal"
          label={t('run.safety.label')}
          icon={<LockIcon className="mt-0.5 shrink-0 text-teal-strong" />}
          size="caption"
        >
          {t('auth.login.safety')}
        </Callout>
      </form>
    </AuthLayout>
  );
}
