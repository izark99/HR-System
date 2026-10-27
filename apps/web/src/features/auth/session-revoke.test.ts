/** Idle sign-out revocation (spec §6.1, MEMORY 2026-10-27 12:30). Fake tokens only. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idleSignOut } from './idle/idle-signout';
import {
  createHttpRevoker,
  isExpired,
  parseStoredTokens,
  revokeSession,
  type LogoutResult,
  type SessionRevoker,
} from './session-revoke';

const NOW = Date.UTC(2026, 9, 27, 10, 0, 0);
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const jwt = (exp: number) => `${b64({ alg: 'HS256' })}.${b64({ exp })}.sig`;

function fakeRevoker(opts: {
  refresh?: string | null | Promise<string | null>;
  logout?: (token: string) => LogoutResult;
}) {
  const calls: string[] = [];
  const revoker: SessionRevoker = {
    refresh: vi.fn((rt: string) => {
      calls.push(`refresh:${rt}`);
      return Promise.resolve(opts.refresh ?? null);
    }),
    logout: vi.fn((at: string) => {
      calls.push(`logout:${at}`);
      return Promise.resolve(opts.logout ? opts.logout(at) : 'ok');
    }),
  };
  return { revoker, calls };
}

describe('parseStoredTokens / isExpired', () => {
  it('reads both tokens and expires_at, falls back to the JWT exp', () => {
    const exp = NOW / 1000 + 3600;
    expect(
      parseStoredTokens(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 5 })),
    ).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 5 });
    expect(parseStoredTokens(JSON.stringify({ access_token: jwt(exp) })).expiresAt).toBe(exp);
    expect(parseStoredTokens('not json')).toEqual({
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
    });
    expect(isExpired({ accessToken: 'a', refreshToken: null, expiresAt: exp }, NOW)).toBe(false);
    expect(
      isExpired({ accessToken: 'a', refreshToken: null, expiresAt: NOW / 1000 + 5 }, NOW),
    ).toBe(true); // within the skew
  });
});

describe('revokeSession', () => {
  const valid = { accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: NOW / 1000 + 3600 };
  const expired = { ...valid, expiresAt: NOW / 1000 - 8 * 3600 };

  it('valid access token: logout with it, no refresh', async () => {
    const { revoker, calls } = fakeRevoker({});
    await expect(revokeSession(valid, revoker, NOW)).resolves.toBe(true);
    expect(calls).toEqual(['logout:at-1']);
  });

  it('expired access token: refresh first, then logout with the new token', async () => {
    const { revoker, calls } = fakeRevoker({ refresh: 'at-2' });
    await expect(revokeSession(expired, revoker, NOW)).resolves.toBe(true);
    expect(calls).toEqual(['refresh:rt-1', 'logout:at-2']);
  });

  it('logout answers 401 (expired server-side): refresh once and retry', async () => {
    const { revoker, calls } = fakeRevoker({
      refresh: 'at-2',
      logout: (t) => (t === 'at-1' ? 'unauthorized' : 'ok'),
    });
    await expect(revokeSession(valid, revoker, NOW)).resolves.toBe(true);
    expect(calls).toEqual(['logout:at-1', 'refresh:rt-1', 'logout:at-2']);
  });

  it('refresh fails: no logout with a stale token, resolves false (never rejects)', async () => {
    const { revoker, calls } = fakeRevoker({ refresh: null });
    await expect(revokeSession(expired, revoker, NOW)).resolves.toBe(false);
    expect(calls).toEqual(['refresh:rt-1']);

    const always401 = fakeRevoker({ refresh: 'at-2', logout: () => 'unauthorized' });
    await expect(revokeSession(valid, always401.revoker, NOW)).resolves.toBe(false);
    expect(always401.calls).toEqual(['logout:at-1', 'refresh:rt-1', 'logout:at-2']); // no loop

    const throwing: SessionRevoker = {
      refresh: () => Promise.reject(new Error('x')),
      logout: () => Promise.reject(new Error('x')),
    };
    await expect(revokeSession(expired, throwing, NOW)).resolves.toBe(false);
  });

  it('nothing stored: nothing sent', async () => {
    const { revoker, calls } = fakeRevoker({});
    await expect(
      revokeSession({ accessToken: null, refreshToken: null, expiresAt: null }, revoker, NOW),
    ).resolves.toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('budget: a refresh that never answers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('the login page still loads after 3 s', async () => {
    const { revoker } = fakeRevoker({ refresh: new Promise<string | null>(() => undefined) });
    const expired = { accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: 1 };
    const redirect = vi.fn();
    const done = idleSignOut({
      signOut: () => revokeSession(expired, revoker).then(() => undefined),
      disposeEngines: () => undefined,
      releaseUnsavedGuard: () => undefined,
      clearSession: () => undefined,
      redirect,
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(redirect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(revoker.logout).not.toHaveBeenCalled();
  });
});

describe('createHttpRevoker', () => {
  it('posts to the Supabase auth endpoints with the publishable key; maps statuses', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const responses = [
      new Response(JSON.stringify({ access_token: 'at-new' }), { status: 200 }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 401 }),
      new Response('x', { status: 400 }),
    ];
    const fetcher = vi.fn((url: string, init: RequestInit) => {
      requests.push({ url, init });
      return Promise.resolve(responses.shift()!);
    }) as unknown as typeof fetch;
    const r = createHttpRevoker('https://x.supabase.co', 'pk', fetcher);
    await expect(r.refresh('rt')).resolves.toBe('at-new');
    await expect(r.logout('at-new')).resolves.toBe('ok');
    await expect(r.logout('old')).resolves.toBe('unauthorized');
    await expect(r.refresh('bad')).resolves.toBeNull();
    expect(requests.map((q) => q.url)).toEqual([
      'https://x.supabase.co/auth/v1/token?grant_type=refresh_token',
      'https://x.supabase.co/auth/v1/logout?scope=local',
      'https://x.supabase.co/auth/v1/logout?scope=local',
      'https://x.supabase.co/auth/v1/token?grant_type=refresh_token',
    ]);
    expect(requests[0]!.init.body).toBe(JSON.stringify({ refresh_token: 'rt' }));
    expect((requests[1]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer at-new',
    );
  });
});
