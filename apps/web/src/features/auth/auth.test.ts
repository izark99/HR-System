import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../../lib/env';
import {
  authErrorKey,
  checkNewPassword,
  normalizeUsername,
  usernameToEmail,
  USERNAME_PATTERN,
} from './credentials';
import { resolveGuard, safeRedirect, type AuthState, type SessionUser } from './guard';

const user = (p: Partial<SessionUser> = {}): AuthState => ({
  status: 'signedIn',
  user: {
    id: 'u1',
    username: 'hr.nv01',
    fullName: 'Nhân viên Giả',
    role: 'user',
    mustChangePassword: false,
    ...p,
  },
});

describe('route guard (spec §3, §6)', () => {
  it('waits while the session is being restored', () => {
    expect(resolveGuard('/', { status: 'loading' })).toEqual({ kind: 'wait' });
  });

  it('unauthenticated → /login, remembering a deep link', () => {
    const out: AuthState = { status: 'signedOut' };
    expect(resolveGuard('/', out)).toEqual({ kind: 'redirect', href: '/login' });
    expect(resolveGuard('/run/payroll-timesheet', out)).toEqual({
      kind: 'redirect',
      href: '/login?redirect=%2Frun%2Fpayroll-timesheet',
    });
    expect(resolveGuard('/admin/users', out, '?tab=1')).toEqual({
      kind: 'redirect',
      href: '/login?redirect=%2Fadmin%2Fusers%3Ftab%3D1',
    });
    expect(resolveGuard('/login', out)).toEqual({ kind: 'allow' });
    expect(resolveGuard('/change-password', out).kind).toBe('redirect');
  });

  it('must_change_password forces /change-password everywhere', () => {
    const s = user({ mustChangePassword: true, role: 'admin' });
    for (const path of ['/', '/run/x', '/admin/users', '/login']) {
      expect(resolveGuard(path, s)).toEqual({ kind: 'redirect', href: '/change-password' });
    }
    expect(resolveGuard('/change-password', s)).toEqual({ kind: 'allow' });
  });

  it('/admin/* only for admins', () => {
    expect(resolveGuard('/admin', user())).toEqual({ kind: 'redirect', href: '/' });
    expect(resolveGuard('/admin/flows', user())).toEqual({ kind: 'redirect', href: '/' });
    expect(resolveGuard('/administrator', user())).toEqual({ kind: 'allow' });
    expect(resolveGuard('/admin/users', user({ role: 'admin' }))).toEqual({ kind: 'allow' });
  });

  it('signed in on /login → the remembered page (never an admin page for users)', () => {
    expect(resolveGuard('/login', user())).toEqual({ kind: 'redirect', href: '/' });
    expect(resolveGuard('/login', user(), '?redirect=%2Frun%2Fa')).toEqual({
      kind: 'redirect',
      href: '/run/a',
    });
    expect(resolveGuard('/login', user(), '?redirect=%2Fadmin%2Fusers')).toEqual({
      kind: 'redirect',
      href: '/',
    });
    expect(resolveGuard('/login', user({ role: 'admin' }), '?redirect=%2Fadmin%2Fusers')).toEqual({
      kind: 'redirect',
      href: '/admin/users',
    });
    expect(resolveGuard('/change-password', user())).toEqual({ kind: 'allow' });
  });

  it('safeRedirect blocks open redirects', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil',
      'javascript:x',
      '',
      null,
      '/login',
      '/change-password?x',
    ]) {
      expect(safeRedirect(bad)).toBe('/');
    }
    expect(safeRedirect('/run/a?x=1')).toBe('/run/a?x=1');
  });
});

describe('credentials', () => {
  it('username → synthetic e-mail (trimmed, lower case)', () => {
    expect(usernameToEmail('  HR.Thao ')).toBe('hr.thao@users.hrflow.local');
    expect(normalizeUsername(' A ')).toBe('a');
    expect(USERNAME_PATTERN.test('hr.cn03')).toBe(true);
    expect(USERNAME_PATTERN.test('a')).toBe(false);
    expect(USERNAME_PATTERN.test('hr thao')).toBe(false);
  });

  it('new password rules: >= 10 chars, <= 72 bytes, confirmation matches', () => {
    expect(checkNewPassword('', '')).toBe('empty');
    expect(checkNewPassword('123456789', '123456789')).toBe('tooShort');
    expect(checkNewPassword('mật khẩu dài', 'khác')).toBe('mismatch');
    expect(checkNewPassword('ư'.repeat(40), 'ư'.repeat(40))).toBe('tooLong');
    expect(checkNewPassword('0123456789', '0123456789')).toBeNull();
  });

  it('maps Supabase auth errors to i18n keys, never raw messages', () => {
    expect(authErrorKey({ name: 'AuthApiError', code: 'invalid_credentials', status: 400 })).toBe(
      'invalidCredentials',
    );
    expect(authErrorKey({ name: 'AuthApiError', code: 'user_banned', status: 403 })).toBe('locked');
    expect(
      authErrorKey({ name: 'AuthApiError', code: 'over_request_rate_limit', status: 429 }),
    ).toBe('rateLimited');
    expect(authErrorKey({ name: 'AuthApiError', status: 429 })).toBe('rateLimited');
    expect(authErrorKey({ name: 'AuthRetryableFetchError', status: 0 })).toBe('network');
    expect(authErrorKey(new TypeError('Failed to fetch'))).toBe('network');
    expect(
      authErrorKey({ name: 'AuthWeakPasswordError', code: 'weak_password', status: 422 }),
    ).toBe('weakPassword');
    expect(authErrorKey({ code: 'same_password', status: 422 })).toBe('samePassword');
    expect(authErrorKey({ code: 'session_not_found', status: 403 })).toBe('sessionExpired');
    expect(authErrorKey({ name: 'AuthApiError', status: 500 })).toBe('unknown');
    expect(authErrorKey('boom')).toBe('unknown');
  });
});

describe('resolveConfig (production cannot bypass auth)', () => {
  const url = 'https://rzakjtgvbyxqsmbpcomw.supabase.co';
  const key = 'sb_publishable_test';

  it('VITE_FLOW_SOURCE=local is honoured only outside production', () => {
    expect(resolveConfig({ PROD: false, VITE_FLOW_SOURCE: 'local' })).toEqual({ mode: 'local' });
    expect(
      resolveConfig({
        PROD: true,
        VITE_FLOW_SOURCE: 'local',
        VITE_SUPABASE_URL: url,
        VITE_SUPABASE_ANON_KEY: key,
      }),
    ).toEqual({ mode: 'supabase', supabaseUrl: url, supabaseKey: key });
    expect(resolveConfig({ PROD: true, VITE_FLOW_SOURCE: 'local' })).toEqual({
      mode: 'misconfigured',
    });
  });

  it('defaults to Supabase; trailing slash trimmed', () => {
    expect(
      resolveConfig({ PROD: true, VITE_SUPABASE_URL: `${url}/`, VITE_SUPABASE_ANON_KEY: key }),
    ).toEqual({
      mode: 'supabase',
      supabaseUrl: url,
      supabaseKey: key,
    });
  });

  it('refuses secret / service-role keys and odd URLs', () => {
    const serviceJwt = `x.${btoa(JSON.stringify({ role: 'service_role' }))}.y`;
    for (const bad of [
      { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'sb_secret_abc' },
      { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: serviceJwt },
      { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: '' },
      { VITE_SUPABASE_URL: 'https://evil.example', VITE_SUPABASE_ANON_KEY: key },
      { VITE_SUPABASE_URL: 'http://rzakjtgvbyxqsmbpcomw.supabase.co', VITE_SUPABASE_ANON_KEY: key },
    ]) {
      expect(resolveConfig({ PROD: true, ...bad })).toEqual({ mode: 'misconfigured' });
    }
  });
});
