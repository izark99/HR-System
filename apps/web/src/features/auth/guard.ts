/**
 * Route guard rules (spec §3, §6), as a pure function of the path and the auth state:
 * - not signed in → /login (remembering where the User wanted to go);
 * - must_change_password → /change-password only (forced);
 * - /admin/* → Admins only;
 * - signed in on /login → home (or the remembered page).
 */

export type Role = 'admin' | 'user';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

/** The account cannot use the app (spec §6: one shared "locked or no access" message). */
type AccountProblem = 'locked' | 'profileMissing' | 'profileError';

export type SignedOutReason = AccountProblem | 'sessionExpired' | 'signedOut';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; reason?: SignedOutReason }
  | { status: 'signedIn'; user: SessionUser };

type GuardRedirect = { kind: 'redirect'; href: string };

export type GuardDecision = { kind: 'wait' } | { kind: 'allow' } | GuardRedirect;

export const LOGIN_PATH = '/login';
export const CHANGE_PASSWORD_PATH = '/change-password';

/** C0/C1 control characters (tab, CR, LF, …) and DEL: URL parsers strip or reinterpret them. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Only same-app absolute paths; anything else (//host, https:…, /login, control characters such
 * as "/\t/host") falls back to "/".
 */
export function safeRedirect(target: string | undefined | null): string {
  if (
    !target ||
    CONTROL_CHARS.test(target) ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    target.includes('\\')
  ) {
    return '/';
  }
  const path = target.split(/[?#]/)[0] ?? '/';
  if (path === LOGIN_PATH || path === CHANGE_PASSWORD_PATH) return '/';
  return target;
}

export function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/');
}

export function resolveGuard(path: string, auth: AuthState, search = ''): GuardDecision {
  if (auth.status === 'loading') return { kind: 'wait' };

  if (auth.status === 'signedOut') {
    if (path === LOGIN_PATH) return { kind: 'allow' };
    const back = safeRedirect(path + search);
    return {
      kind: 'redirect',
      href: back === '/' ? LOGIN_PATH : `${LOGIN_PATH}?redirect=${encodeURIComponent(back)}`,
    };
  }

  const { user } = auth;
  if (user.mustChangePassword) {
    return path === CHANGE_PASSWORD_PATH
      ? { kind: 'allow' }
      : { kind: 'redirect', href: CHANGE_PASSWORD_PATH };
  }
  if (path === LOGIN_PATH) {
    const target = new URLSearchParams(search).get('redirect');
    const href = safeRedirect(target);
    return { kind: 'redirect', href: isAdminPath(href) && user.role !== 'admin' ? '/' : href };
  }
  if (isAdminPath(path) && user.role !== 'admin') return { kind: 'redirect', href: '/' };
  return { kind: 'allow' };
}
