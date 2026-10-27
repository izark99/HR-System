import { describe, expect, it, vi } from 'vitest';
import { LocalAuth, SupabaseAuth, waitForAuth, type AuthClient } from './auth-service';

interface Profile {
  id: string;
  username: string;
  full_name: string;
  role: 'admin' | 'user';
  is_active: boolean;
  must_change_password: boolean;
}

function fake(profile: Profile | null, signInError: unknown = null) {
  let current = profile;
  const auth = {
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signInWithPassword: vi.fn(() =>
      Promise.resolve(
        signInError
          ? { data: { user: null, session: null }, error: signInError }
          : { data: { user: { id: 'u1' }, session: {} }, error: null },
      ),
    ),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    stopAutoRefresh: vi.fn(() => Promise.resolve()),
    updateUser: vi.fn(() => {
      // The database trigger clears the flag when the password really changes.
      if (current) current = { ...current, must_change_password: false };
      return Promise.resolve({ data: {}, error: null });
    }),
  };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({ data: current, error: null }),
  };
  const client = { auth, from: vi.fn(() => query) } as unknown as AuthClient;
  return { client, auth };
}

const PROFILE: Profile = {
  id: 'u1',
  username: 'hr.nv01',
  full_name: 'Nhân viên Giả',
  role: 'user',
  is_active: true,
  must_change_password: true,
};

describe('SupabaseAuth', () => {
  it('signs in with the synthetic e-mail and exposes the profile (first-login flag)', async () => {
    const { client, auth } = fake(PROFILE);
    const service = new SupabaseAuth(client);
    expect(await service.signIn(' HR.NV01 ', 'temp-password-1')).toBeNull();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'hr.nv01@users.hrflow.local',
      password: 'temp-password-1',
    });
    expect(service.getSnapshot()).toEqual({
      status: 'signedIn',
      user: {
        id: 'u1',
        username: 'hr.nv01',
        fullName: 'Nhân viên Giả',
        role: 'user',
        mustChangePassword: true,
      },
    });
  });

  it('changePassword clears the flag through the database, not the client', async () => {
    const { client, auth } = fake(PROFILE);
    const service = new SupabaseAuth(client);
    await service.signIn('hr.nv01', 'temp-password-1');
    expect(await service.changePassword('new-password-123')).toBeNull();
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'new-password-123' });
    expect(service.getSnapshot()).toMatchObject({ user: { mustChangePassword: false } });
  });

  it('a locked account is signed out right away with reason "locked"', async () => {
    const { client, auth } = fake({ ...PROFILE, is_active: false });
    const service = new SupabaseAuth(client);
    expect(await service.signIn('hr.nv01', 'x'.repeat(10))).toBe('noAccess');
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(service.getSnapshot()).toEqual({ status: 'signedOut', reason: 'locked' });
  });

  it('wrong password → invalidCredentials; no profile (or hidden by RLS) → noAccess + profileMissing', async () => {
    const bad = fake(PROFILE, { name: 'AuthApiError', code: 'invalid_credentials', status: 400 });
    expect(await new SupabaseAuth(bad.client).signIn('hr.nv01', 'wrong-pass-1')).toBe(
      'invalidCredentials',
    );
    const none = fake(null);
    const service = new SupabaseAuth(none.client);
    expect(await service.signIn('hr.nv01', 'x'.repeat(10))).toBe('noAccess');
    expect(service.getSnapshot()).toEqual({ status: 'signedOut', reason: 'profileMissing' });
  });

  it('signOut ends the session server-side (global scope)', async () => {
    const { client, auth } = fake({ ...PROFILE, must_change_password: false });
    const service = new SupabaseAuth(client);
    await service.signIn('hr.nv01', 'x'.repeat(10));
    await service.signOut();
    expect(auth.signOut).toHaveBeenCalledWith();
    expect(service.getSnapshot()).toEqual({ status: 'signedOut', reason: 'signedOut' });
  });

  it('signOut("idle"): session removed from storage first, then scope-local revocation (spec §6.1)', async () => {
    const { client, auth } = fake({ ...PROFILE, must_change_password: false });
    const store = new Map<string, string>([
      ['hrflow.auth', JSON.stringify({ access_token: 'tok-1', refresh_token: 'r' })],
      ['hrflow.auth-code-verifier', 'v'],
      ['other', 'kept'],
    ]);
    const storage = {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;
    let storedWhenRevoking: string[] = [];
    const logout = vi.fn((_token: string) => {
      storedWhenRevoking = [...store.keys()];
      return Promise.resolve('ok' as const);
    });
    const refresh = vi.fn((_rt: string) => Promise.resolve('tok-2'));
    const service = new SupabaseAuth(client, storage, { refresh, logout });
    await service.signIn('hr.nv01', 'x'.repeat(10));
    const pending = service.signOut('idle');
    // Synchronous part: the stored session is gone before any request.
    expect([...store.keys()]).toEqual(['other']);
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    await pending;
    // No expires_at and not a JWT: treated as expired, so the refresh token is used first.
    expect(refresh).toHaveBeenCalledWith('r');
    expect(logout).toHaveBeenCalledWith('tok-2');
    expect(storedWhenRevoking).toEqual(['other']);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(service.getSnapshot()).toEqual({ status: 'signedOut', reason: 'idle' });
  });
});

describe('waitForAuth', () => {
  it('resolves at once when the state is known, else on the first non-loading state', async () => {
    await expect(waitForAuth(new LocalAuth())).resolves.toMatchObject({ status: 'signedIn' });

    const { client } = fake(null);
    const svc = new SupabaseAuth(client);
    expect(svc.getSnapshot().status).toBe('loading');
    let settled = false;
    const p = waitForAuth(svc).then((s) => {
      settled = true;
      return s;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await svc.signOut();
    await expect(p).resolves.toMatchObject({ status: 'signedOut' });
  });
});
