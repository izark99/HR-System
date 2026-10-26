/**
 * Username ↔ synthetic e-mail mapping and auth error → i18n key mapping (spec §6). UI-agnostic so
 * it can be unit-tested.
 */

export const SYNTHETIC_EMAIL_DOMAIN = 'users.hrflow.local';
export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 72; // bcrypt limit used by Supabase Auth

/** Same rule as profiles.username in the database. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

/** The User types only a username; Supabase Auth needs an e-mail. */
export function usernameToEmail(input: string): string {
  return `${normalizeUsername(input)}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

export type PasswordProblem = 'empty' | 'tooShort' | 'tooLong' | 'mismatch';

export function checkNewPassword(password: string, confirm: string): PasswordProblem | null {
  if (password.length === 0) return 'empty';
  if (password.length < MIN_PASSWORD_LENGTH) return 'tooShort';
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_LENGTH) return 'tooLong';
  if (password !== confirm) return 'mismatch';
  return null;
}

export type AuthErrorKey =
  | 'invalidCredentials'
  | 'locked'
  | 'rateLimited'
  | 'network'
  | 'weakPassword'
  | 'samePassword'
  | 'reauthNeeded'
  | 'sessionExpired'
  | 'unknown';

interface AuthErrorLike {
  name?: unknown;
  code?: unknown;
  status?: unknown;
}

/** Supabase AuthError (or fetch failure) → key under `auth.errors.*`. Never shows raw text. */
export function authErrorKey(err: unknown): AuthErrorKey {
  if (err instanceof TypeError) return 'network';
  if (!err || typeof err !== 'object') return 'unknown';
  const e = err as AuthErrorLike;
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const name = typeof e.name === 'string' ? e.name : '';
  switch (code) {
    case 'invalid_credentials':
    case 'email_not_confirmed':
    case 'user_not_found':
      return 'invalidCredentials';
    case 'user_banned':
      return 'locked';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rateLimited';
    case 'weak_password':
      return 'weakPassword';
    case 'same_password':
      return 'samePassword';
    case 'reauthentication_needed':
    case 'reauthentication_not_valid':
      return 'reauthNeeded';
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'bad_jwt':
      return 'sessionExpired';
  }
  if (name === 'AuthRetryableFetchError' || status === 0) return 'network';
  if (status === 429) return 'rateLimited';
  if (status === 400 && name === 'AuthApiError') return 'invalidCredentials';
  return 'unknown';
}
