import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import type { ProfileRow } from '../../lib/database.types';
import {
  browserSessionStorage,
  clearStoredSession,
  readStoredSession,
  type Supabase,
} from '../../lib/supabase';
import { authErrorKey, usernameToEmail, type AuthErrorKey } from './credentials';
import type { AuthState, SessionUser, SignedOutReason } from './guard';
import { parseStoredTokens, revokeSession, type SessionRevoker } from './session-revoke';

/** Auth for the UI: an observable state plus the three actions the screens need. */
export interface AuthService {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => AuthState;
  /** null = signed in; otherwise the i18n key of the problem (`auth.errors.*`). */
  signIn(username: string, password: string): Promise<AuthErrorKey | null>;
  changePassword(password: string): Promise<AuthErrorKey | null>;
  /**
   * Sign out. Default: global scope (every session of the account ends).
   * `idle` (auto sign-out after 8 hours, spec §6.1, MEMORY 2026-10-27 12:30): scope `local` —
   * still a `POST /logout?scope=local`, so the server revokes THIS session's refresh token; other
   * tabs/devices are not affected. The session is removed from sessionStorage synchronously, before
   * the request; the returned promise follows the request (callers do not wait more than 3 s).
   */
  signOut(reason?: 'idle'): Promise<void>;
}

/** Resolves with the first auth state that is not `loading` (session restored or not). */
export function waitForAuth(service: AuthService): Promise<AuthState> {
  const now = service.getSnapshot();
  if (now.status !== 'loading') return Promise.resolve(now);
  return new Promise((resolve) => {
    const unsubscribe = service.subscribe(() => {
      const state = service.getSnapshot();
      if (state.status === 'loading') return;
      unsubscribe();
      resolve(state);
    });
  });
}

abstract class BaseAuth {
  protected state: AuthState = { status: 'loading' };
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AuthState => this.state;

  protected set(state: AuthState): void {
    this.state = state;
    for (const l of this.listeners) l();
  }
}

/** Dev/test without a server (VITE_FLOW_SOURCE=local, never in production). */
export class LocalAuth extends BaseAuth implements AuthService {
  constructor() {
    super();
    this.state = {
      status: 'signedIn',
      user: {
        id: 'local',
        username: 'local',
        fullName: '',
        role: 'admin',
        mustChangePassword: false,
      },
    };
  }
  signIn(): Promise<AuthErrorKey | null> {
    return Promise.resolve(null);
  }
  changePassword(): Promise<AuthErrorKey | null> {
    return Promise.resolve(null);
  }
  signOut(): Promise<void> {
    return Promise.resolve();
  }
}

type ProfileFields = Pick<
  ProfileRow,
  'id' | 'username' | 'full_name' | 'role' | 'is_active' | 'must_change_password'
>;

type ProfileResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: Exclude<SignedOutReason, 'signedOut' | 'sessionExpired'> };

export type AuthClient = Pick<Supabase, 'auth' | 'from'>;

/**
 * Supabase Auth with the `profiles` row (role, active, first-login flag). A locked or
 * profile-less account is signed out right away; RLS blocks such accounts anyway.
 */
export class SupabaseAuth extends BaseAuth implements AuthService {
  private loading: { userId: string; promise: Promise<ProfileResult> } | null = null;
  /** Set right before an intentional sign-out so the screen does not say "session expired". */
  private nextReason: SignedOutReason | null = null;

  constructor(
    private readonly sb: AuthClient,
    /** Where supabase-js keeps the session (sessionStorage in the app). */
    private readonly storage: Storage | null = browserSessionStorage(),
    /** Idle sign-out revocation; default: logout only (no refresh), via supabase-js. */
    private readonly revoker: SessionRevoker = {
      refresh: () => Promise.resolve(null),
      logout: async (token) => {
        const { error } = await sb.auth.admin.signOut(token, 'local');
        return !error ? 'ok' : error.status === 401 ? 'unauthorized' : 'failed';
      },
    },
  ) {
    super();
    sb.auth.onAuthStateChange((event, session) => {
      // Never await Supabase calls inside this callback (auth lock); defer.
      setTimeout(() => void this.onAuthChange(event, session), 0);
    });
  }

  private async onAuthChange(event: AuthChangeEvent, session: Session | null): Promise<void> {
    if (!session) {
      const reason =
        this.nextReason ??
        (event === 'SIGNED_OUT' && this.state.status === 'signedIn' ? 'sessionExpired' : undefined);
      this.nextReason = null;
      this.set(reason ? { status: 'signedOut', reason } : { status: 'signedOut' });
      return;
    }
    if (event === 'TOKEN_REFRESHED' && this.state.status === 'signedIn') return;
    if (
      this.state.status === 'signedIn' &&
      this.state.user.id === session.user.id &&
      event !== 'USER_UPDATED'
    ) {
      return;
    }
    await this.applyProfile(session.user.id, event === 'USER_UPDATED');
  }

  private fetchProfile(userId: string, fresh: boolean): Promise<ProfileResult> {
    if (!fresh && this.loading?.userId === userId) return this.loading.promise;
    const promise = (async (): Promise<ProfileResult> => {
      const { data, error } = await this.sb
        .from('profiles')
        .select('id, username, full_name, role, is_active, must_change_password')
        .eq('id', userId)
        .maybeSingle();
      if (error) return { ok: false, reason: 'profileError' };
      const row: ProfileFields | null = data;
      if (!row) return { ok: false, reason: 'profileMissing' };
      if (!row.is_active) return { ok: false, reason: 'locked' };
      return {
        ok: true,
        user: {
          id: row.id,
          username: row.username,
          fullName: row.full_name,
          role: row.role,
          mustChangePassword: row.must_change_password,
        },
      };
    })();
    this.loading = { userId, promise };
    void promise.finally(() => {
      if (this.loading?.promise === promise) this.loading = null;
    });
    return promise;
  }

  private async applyProfile(userId: string, fresh: boolean): Promise<ProfileResult> {
    const result = await this.fetchProfile(userId, fresh);
    if (result.ok) {
      this.set({ status: 'signedIn', user: result.user });
    } else {
      this.nextReason = result.reason;
      await this.sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
      this.set({ status: 'signedOut', reason: result.reason });
    }
    return result;
  }

  async signIn(username: string, password: string): Promise<AuthErrorKey | null> {
    try {
      const { data, error } = await this.sb.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });
      if (error || !data.user) return authErrorKey(error);
      const result = await this.applyProfile(data.user.id, true);
      if (result.ok) return null;
      // A locked profile and one hidden by RLS look the same to the User (tester observation).
      return result.reason === 'locked' || result.reason === 'profileMissing'
        ? 'noAccess'
        : 'unknown';
    } catch (err) {
      return authErrorKey(err);
    }
  }

  async changePassword(password: string): Promise<AuthErrorKey | null> {
    if (this.state.status !== 'signedIn') return 'sessionExpired';
    try {
      const { error } = await this.sb.auth.updateUser({ password });
      if (error) return authErrorKey(error);
      // The database clears must_change_password when the password actually changes.
      const result = await this.applyProfile(this.state.user.id, true);
      if (!result.ok) return 'unknown';
      return result.user.mustChangePassword ? 'unknown' : null;
    } catch (err) {
      return authErrorKey(err);
    }
  }

  async signOut(reason?: 'idle'): Promise<void> {
    const why: SignedOutReason = reason ?? 'signedOut';
    this.nextReason = why;
    if (reason === 'idle') {
      // Synchronously: take both tokens, then drop the stored session at once (spec §6.1).
      const tokens = parseStoredTokens(readStoredSession(this.storage));
      // First stop the refresh ticker: a refresh firing now would write a new session back.
      try {
        void this.sb.auth.stopAutoRefresh().catch(() => undefined);
      } catch {
        // older/mock clients
      }
      clearStoredSession(this.storage);
      // Server-side revocation of this session (refreshing an expired access token first, see
      // session-revoke.ts). The state changes only after it: the route guard reloads the page on
      // sign-out, which would abort the request. The caller bounds the wait to 3 s.
      await revokeSession(tokens, this.revoker);
      // Clears the client's in-memory state (no stored session left: no second request).
      await this.sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
    } else {
      try {
        await this.sb.auth.signOut();
      } catch {
        await this.sb.auth.signOut({ scope: 'local' }).catch(() => undefined);
      }
    }
    this.set({ status: 'signedOut', reason: why });
  }
}
