import { describe, expect, it, vi } from 'vitest';
import {
  AdminError,
  generateTempPassword,
  handleRequest,
  parseAllowedOrigins,
  type AdminBackend,
  type ProfileRow,
} from './handler.ts';

const ORIGIN = 'https://app.example.test';
const ADMIN: ProfileRow = {
  id: '00000000-0000-4000-8000-00000000000a',
  username: 'admin',
  full_name: 'Quản trị Giả',
  role: 'admin',
  is_active: true,
};
const USER: ProfileRow = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'hr.nv01',
  full_name: 'Nhân viên Giả',
  role: 'user',
  is_active: true,
};
const GROUP = '00000000-0000-4000-8000-0000000000b1';
const NEW_ID = '00000000-0000-4000-8000-0000000000c1';

function fakeBackend(overrides: Partial<AdminBackend> = {}) {
  const profiles = new Map([ADMIN, USER].map((p) => [p.id, p]));
  const tokens: Record<string, string> = { 'admin-token': ADMIN.id, 'user-token': USER.id };
  const backend: AdminBackend = {
    userIdFromToken: vi.fn((t: string) => Promise.resolve(tokens[t] ?? null)),
    getProfile: vi.fn((id: string) => Promise.resolve(profiles.get(id) ?? null)),
    usernameExists: vi.fn((u: string) =>
      Promise.resolve([...profiles.values()].some((p) => p.username === u)),
    ),
    missingGroups: vi.fn((ids: readonly string[]) =>
      Promise.resolve(ids.filter((id) => id !== GROUP)),
    ),
    createAuthUser: vi.fn(() => Promise.resolve(NEW_ID)),
    deleteAuthUser: vi.fn(() => Promise.resolve()),
    setPassword: vi.fn(() => Promise.resolve()),
    setBanned: vi.fn(() => Promise.resolve()),
    revokeSessions: vi.fn(() => Promise.resolve()),
    insertProfile: vi.fn(() => Promise.resolve()),
    updateProfile: vi.fn(() => Promise.resolve()),
    setGroups: vi.fn(() => Promise.resolve()),
    audit: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  return backend;
}

function request(
  body: unknown,
  opts: { token?: string | null; origin?: string | null; method?: string } = {},
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const token = opts.token === undefined ? 'admin-token' : opts.token;
  if (token) headers.set('authorization', `Bearer ${token}`);
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin) headers.set('origin', origin);
  const method = opts.method ?? 'POST';
  return new Request('https://fn.example.test/admin-users', {
    method,
    headers,
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

const env = { allowedOrigins: [ORIGIN] };

async function call(backend: AdminBackend, body: unknown, opts?: Parameters<typeof request>[1]) {
  const res = await handleRequest(request(body, opts), env, backend);
  return {
    res,
    json: (await res.json()) as {
      ok: boolean;
      data?: Record<string, unknown>;
      error?: { code: string };
    },
  };
}

describe('admin-users: access control and CORS', () => {
  it('preflight from an allowed origin gets CORS headers', async () => {
    const res = await handleRequest(request(null, { method: 'OPTIONS' }), env, fakeBackend());
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('rejects other origins without CORS headers', async () => {
    const { res, json } = await call(
      fakeBackend(),
      { action: 'reset_password', user_id: USER.id },
      {
        origin: 'https://evil.example',
      },
    );
    expect(res.status).toBe(403);
    expect(json.error?.code).toBe('origin_not_allowed');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('401 without or with an invalid token, 403 for non-admins and locked admins', async () => {
    const body = { action: 'reset_password', user_id: USER.id };
    expect((await call(fakeBackend(), body, { token: null })).json.error?.code).toBe(
      'unauthorized',
    );
    expect((await call(fakeBackend(), body, { token: 'bogus' })).res.status).toBe(401);
    expect((await call(fakeBackend(), body, { token: 'user-token' })).json.error?.code).toBe(
      'forbidden',
    );
    const locked = fakeBackend({
      getProfile: (id) => Promise.resolve(id === ADMIN.id ? { ...ADMIN, is_active: false } : USER),
    });
    expect((await call(locked, body)).res.status).toBe(403);
  });

  it('405 for GET, 400 for bad JSON / unknown action / extra fields', async () => {
    expect((await call(fakeBackend(), null, { method: 'GET' })).res.status).toBe(405);
    expect((await call(fakeBackend(), '{not json')).json.error?.code).toBe('invalid_input');
    expect((await call(fakeBackend(), { action: 'drop_db' })).json.error?.code).toBe(
      'invalid_input',
    );
    expect(
      (await call(fakeBackend(), { action: 'reset_password', user_id: USER.id, password: 'x' }))
        .json.error?.code,
    ).toBe('invalid_input');
    expect(
      (await call(fakeBackend(), { action: 'create', username: 'A B' })).json.error?.code,
    ).toBe('invalid_input');
  });

  it('unexpected backend failure → 500 "internal" without the raw message', async () => {
    const backend = fakeBackend({ setPassword: () => Promise.reject(new Error('secret detail')) });
    const { res, json } = await call(backend, { action: 'reset_password', user_id: USER.id });
    expect(res.status).toBe(500);
    expect(json).toEqual({ ok: false, error: { code: 'internal' } });
  });
});

describe('admin-users: actions', () => {
  it('create: synthetic e-mail, temp password returned once, must_change_password, groups, audit without password', async () => {
    const backend = fakeBackend();
    const { res, json } = await call(backend, {
      action: 'create',
      username: '  HR.CN03 ',
      full_name: 'Nhân viên Giả 3',
      role: 'user',
      group_ids: [GROUP, GROUP],
    });
    expect(res.status).toBe(200);
    const pw = json.data?.temp_password as string;
    expect(pw).toMatch(/^[A-Za-z2-9]{16}$/);
    expect(json.data).toMatchObject({ user_id: NEW_ID, username: 'hr.cn03' });
    expect(backend.createAuthUser).toHaveBeenCalledWith(
      'hr.cn03@users.hrflow.local',
      pw,
      'hr.cn03',
    );
    expect(backend.insertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: NEW_ID,
        username: 'hr.cn03',
        must_change_password: true,
        role: 'user',
      }),
    );
    expect(backend.setGroups).toHaveBeenCalledWith(NEW_ID, [GROUP], ADMIN.id);
    const audit = JSON.stringify(vi.mocked(backend.audit).mock.calls);
    expect(audit).toContain('user.create');
    expect(audit).not.toContain(pw);
  });

  it('create: username taken / unknown group', async () => {
    expect(
      (await call(fakeBackend(), { action: 'create', username: 'hr.nv01' })).json.error?.code,
    ).toBe('username_taken');
    expect(
      (
        await call(fakeBackend(), {
          action: 'create',
          username: 'hr.new',
          group_ids: ['00000000-0000-4000-8000-0000000000ff'],
        })
      ).json.error?.code,
    ).toBe('group_not_found');
  });

  it('create: profile insert fails → auth user deleted (rollback)', async () => {
    const backend = fakeBackend({
      insertProfile: () => Promise.reject(new AdminError('username_taken')),
    });
    const { json } = await call(backend, { action: 'create', username: 'hr.race' });
    expect(json.error?.code).toBe('username_taken');
    expect(backend.deleteAuthUser).toHaveBeenCalledWith(NEW_ID);
  });

  it('reset_password: new password, flag set AFTER the password change, sessions revoked', async () => {
    const order: string[] = [];
    const backend = fakeBackend({
      setPassword: () => (order.push('password'), Promise.resolve()),
      updateProfile: (_id, patch) => (
        order.push(`profile:${JSON.stringify(patch)}`),
        Promise.resolve()
      ),
      revokeSessions: () => (order.push('revoke'), Promise.resolve()),
    });
    const { json } = await call(backend, { action: 'reset_password', user_id: USER.id });
    expect(json.ok).toBe(true);
    expect(json.data?.temp_password).toMatch(/^[A-Za-z2-9]{16}$/);
    expect(order).toEqual(['password', 'profile:{"must_change_password":true}', 'revoke']);
  });

  it('self actions are refused: reset own password, lock self, demote self', async () => {
    const b = fakeBackend();
    expect((await call(b, { action: 'reset_password', user_id: ADMIN.id })).json.error?.code).toBe(
      'self_action_forbidden',
    );
    expect(
      (await call(b, { action: 'set_active', user_id: ADMIN.id, active: false })).res.status,
    ).toBe(409);
    expect((await call(b, { action: 'update', user_id: ADMIN.id, role: 'user' })).res.status).toBe(
      409,
    );
    // Renaming self is fine.
    expect(
      (await call(b, { action: 'update', user_id: ADMIN.id, full_name: 'Tên mới' })).json.ok,
    ).toBe(true);
  });

  it('set_active false: ban + is_active false + revoke; true: unban', async () => {
    const b = fakeBackend();
    await call(b, { action: 'set_active', user_id: USER.id, active: false });
    expect(b.setBanned).toHaveBeenCalledWith(USER.id, true);
    expect(b.updateProfile).toHaveBeenCalledWith(USER.id, { is_active: false });
    expect(b.revokeSessions).toHaveBeenCalledWith(USER.id);
    const b2 = fakeBackend();
    await call(b2, { action: 'set_active', user_id: USER.id, active: true });
    expect(b2.setBanned).toHaveBeenCalledWith(USER.id, false);
    expect(b2.revokeSessions).not.toHaveBeenCalled();
  });

  it('update: role and groups; unknown target → not_found', async () => {
    const b = fakeBackend();
    const { json } = await call(b, {
      action: 'update',
      user_id: USER.id,
      role: 'admin',
      group_ids: [],
    });
    expect(json.ok).toBe(true);
    expect(b.updateProfile).toHaveBeenCalledWith(USER.id, { role: 'admin' });
    expect(b.setGroups).toHaveBeenCalledWith(USER.id, [], ADMIN.id);
    expect(
      (
        await call(b, {
          action: 'update',
          user_id: '00000000-0000-4000-8000-0000000000ee',
          role: 'user',
        })
      ).json.error?.code,
    ).toBe('not_found');
  });
});

describe('helpers', () => {
  it('generateTempPassword: length, alphabet, character classes, no modulo bias source', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateTempPassword();
      expect(pw).toHaveLength(16);
      expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
    }
    // Bytes >= the rejection limit are skipped.
    let n = 0;
    const bytes = (len: number) => Uint8Array.from({ length: len }, () => (n++ % 2 ? 255 : n % 57));
    expect(generateTempPassword(bytes)).toHaveLength(16);
  });

  it('parseAllowedOrigins keeps exact origins only', () => {
    expect(
      parseAllowedOrigins(' https://a.pages.dev/ ,http://localhost:5173, *, ftp://x ,'),
    ).toEqual(['https://a.pages.dev', 'http://localhost:5173']);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});
