/**
 * Hermetic Supabase for E2E: every request to the project origin is answered here with
 * `context.route` (auth, PostgREST, Edge Functions). Nothing reaches the network; an endpoint
 * the mock does not know is answered 501 and recorded in `unhandled` (tests assert it stays
 * empty). The E2E build uses a fake publishable key (vite --mode e2e).
 *
 * Fake accounts and data only.
 */
import type { BrowserContext, Page, Request, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const SUPABASE_ORIGIN = 'https://rzakjtgvbyxqsmbpcomw.supabase.co';
const AUTH_STORAGE_KEY = 'hrflow.auth';
const EMAIL_DOMAIN = 'users.hrflow.local';

const FLOW_JSON: unknown = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../fixtures/payroll-timesheet/flow.json'), 'utf8'),
);

export interface MockUser {
  id: string;
  username: string;
  full_name: string;
  role: 'admin' | 'user';
  is_active: boolean;
  must_change_password: boolean;
  password: string;
}

export interface MockGroup {
  id: string;
  name: string;
  description: string;
}

export interface RecordedCall {
  method: string;
  path: string;
  body: string;
}

export const USER: MockUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'hr.nv01',
  full_name: 'Nhân viên Giả',
  role: 'user',
  is_active: true,
  must_change_password: false,
  password: 'mat-khau-gia-01',
};

export const ADMIN: MockUser = {
  id: '00000000-0000-4000-8000-00000000000a',
  username: 'admin',
  full_name: 'Quản trị Giả',
  role: 'admin',
  is_active: true,
  must_change_password: false,
  password: 'mat-khau-admin-01',
};

const FLOW = {
  id: '00000000-0000-4000-8000-0000000000f1',
  code: 'payroll-timesheet',
  name: 'Đối chiếu bảng lương – chấm công',
  description:
    'Upload bảng lương và chấm công các chi nhánh, nhận file Excel 4 sheet chỉ ra sai lệch.',
  category: 'Lương & công',
  instructions:
    'upload đủ file của các chi nhánh trong kỳ. File lương lấy từ sheet "Luong", file chấm công từ sheet "ChamCong".',
};

const VERSION = {
  id: '00000000-0000-4000-8000-0000000001f1',
  version_no: 3,
  effective_from: '2026-01-01',
  effective_to: null as string | null,
};

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function fakeJwt(user: MockUser): string {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    b64url(
      JSON.stringify({
        sub: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: `${user.username}@${EMAIL_DOMAIN}`,
        iat: now,
        exp: now + 24 * 3600,
        session_id: `s-${user.id}`,
      }),
    ),
    'fake-signature',
  ].join('.');
}

function authUser(user: MockUser) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: `${user.username}@${EMAIL_DOMAIN}`,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { username: user.username },
    created_at: '2026-10-26T00:00:00Z',
    updated_at: '2026-10-26T00:00:00Z',
  };
}

export function sessionFor(user: MockUser) {
  const expiresIn = 24 * 3600;
  return {
    access_token: fakeJwt(user),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: `refresh-${user.id}`,
    user: authUser(user),
  };
}

export class SupabaseMock {
  users: MockUser[] = [{ ...USER }, { ...ADMIN }];
  groups: MockGroup[] = [
    { id: '00000000-0000-4000-8000-0000000000b1', name: 'C&B', description: '' },
  ];
  members: { group_id: string; user_id: string }[] = [
    { group_id: '00000000-0000-4000-8000-0000000000b1', user_id: USER.id },
  ];
  assignments: { id: string; flow_id: string; user_id: string | null; group_id: string | null }[] =
    [
      {
        id: 'a1',
        flow_id: FLOW.id,
        user_id: null,
        group_id: '00000000-0000-4000-8000-0000000000b1',
      },
    ];
  /** Bodies of run_logs inserts, as sent by the app. */
  runLogs: Record<string, unknown>[] = [];
  /** Bodies sent to the admin-users Edge Function. */
  functionCalls: Record<string, unknown>[] = [];
  calls: RecordedCall[] = [];
  unhandled: string[] = [];
  /** Flow assigned to USER; set false to test the "not assigned" case. */
  flowVisibleToUsers = true;

  async install(context: BrowserContext): Promise<void> {
    await context.route(`${SUPABASE_ORIGIN}/**`, (route, request) => this.handle(route, request));
  }

  /** Start the page already signed in (session in sessionStorage, like after a login). */
  async signInAs(page: Page, user: MockUser): Promise<void> {
    const session = sessionFor(user);
    // window.name survives navigations in the tab: seed only once so a sign-out sticks.
    await page.addInitScript(
      ([key, value]) => {
        if (window.name !== 'hrflow-e2e-seeded') {
          window.name = 'hrflow-e2e-seeded';
          sessionStorage.setItem(key, value);
        }
      },
      [AUTH_STORAGE_KEY, JSON.stringify(session)] as const,
    );
  }

  private userFromRequest(request: Request): MockUser | undefined {
    const auth = request.headers()['authorization'] ?? '';
    const token = /^Bearer (.+)$/.exec(auth)?.[1];
    if (!token || token.split('.').length !== 3) return undefined;
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
        sub?: string;
      };
      return this.users.find((u) => u.id === payload.sub);
    } catch {
      return undefined;
    }
  }

  private canSeeFlow(user: MockUser | undefined): boolean {
    if (!user || !user.is_active) return false;
    if (user.role === 'admin') return true;
    if (!this.flowVisibleToUsers) return false;
    const groups = this.members.filter((m) => m.user_id === user.id).map((m) => m.group_id);
    return this.assignments.some(
      (a) =>
        a.flow_id === FLOW.id &&
        (a.user_id === user.id || (a.group_id && groups.includes(a.group_id))),
    );
  }

  private async handle(route: Route, request: Request): Promise<void> {
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ?? '';
    this.calls.push({ method, path: url.pathname + url.search, body });
    const origin = request.headers()['origin'] ?? '*';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-expose-headers': '*',
      'x-supabase-api-version': '2024-01-01',
    };
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
      route.fulfill({
        status,
        headers: { ...cors, 'content-type': 'application/json', ...headers },
        body: data === undefined ? '' : JSON.stringify(data),
      });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

    const path = url.pathname;
    const caller = this.userFromRequest(request);
    const parsed = (): Record<string, unknown> => {
      try {
        return JSON.parse(body) as Record<string, unknown>;
      } catch {
        return {};
      }
    };

    // ---- auth ----
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = parsed() as { email?: string; password?: string };
      const user = this.users.find((u) => `${u.username}@${EMAIL_DOMAIN}` === email);
      if (!user || user.password !== password) {
        return json(400, { code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      if (!user.is_active) return json(400, { code: 'user_banned', msg: 'User is banned' });
      return json(200, sessionFor(user));
    }
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const { refresh_token } = parsed() as { refresh_token?: string };
      const user = this.users.find((u) => `refresh-${u.id}` === refresh_token);
      return user
        ? json(200, sessionFor(user))
        : json(400, { code: 'refresh_token_not_found', msg: 'x' });
    }
    if (path === '/auth/v1/user' && method === 'GET') {
      return caller ? json(200, authUser(caller)) : json(401, { code: 'bad_jwt', msg: 'x' });
    }
    if (path === '/auth/v1/user' && method === 'PUT') {
      if (!caller) return json(401, { code: 'bad_jwt', msg: 'x' });
      const { password } = parsed() as { password?: string };
      if (password === caller.password) {
        return json(422, { code: 'same_password', msg: 'New password should be different' });
      }
      if (password) {
        caller.password = password;
        caller.must_change_password = false; // the database trigger does this in production
      }
      return json(200, authUser(caller));
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });

    // ---- PostgREST ----
    const single = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const rows = (all: unknown[]) => (single ? json(200, all[0] ?? null) : json(200, all));
    const eqFilter = (field: string) => url.searchParams.get(field)?.replace(/^eq\./, '');

    if (path === '/rest/v1/profiles' && method === 'GET') {
      if (!caller?.is_active) return rows([]);
      const id = eqFilter('id');
      const visible = this.users.filter(
        (u) => (caller.role === 'admin' || u.id === caller.id) && (!id || u.id === id),
      );
      return rows(visible.map(({ password: _p, ...p }) => p));
    }
    if (path === '/rest/v1/group_members' && method === 'GET') return rows(this.members);
    if (path === '/rest/v1/groups' && method === 'GET') return rows(this.groups);
    if (path === '/rest/v1/flow_assignments' && method === 'GET') return rows(this.assignments);
    if (path === '/rest/v1/flows' && method === 'GET') {
      return rows([{ ...FLOW, is_archived: false }]);
    }
    if (path === '/rest/v1/flow_versions' && method === 'GET') {
      return rows([
        {
          id: VERSION.id,
          flow_id: FLOW.id,
          version_no: VERSION.version_no,
          status: 'published',
          effective_from: VERSION.effective_from,
          effective_to: VERSION.effective_to,
          published_at: '2026-10-26T00:00:00Z',
        },
      ]);
    }
    if (path === '/rest/v1/rpc/my_flows') {
      return json(
        200,
        this.canSeeFlow(caller)
          ? [
              {
                flow_id: FLOW.id,
                ...FLOW,
                version_id: VERSION.id,
                version_no: VERSION.version_no,
                effective_from: VERSION.effective_from,
                effective_to: VERSION.effective_to,
                input_count: 2,
              },
            ]
          : [],
      );
    }
    if (path === '/rest/v1/rpc/resolve_flow_version') {
      const { p_code, p_as_of } = parsed() as { p_code?: string; p_as_of?: string };
      if (p_code !== FLOW.code || !this.canSeeFlow(caller)) return json(200, []);
      return json(200, [
        {
          version_id: VERSION.id,
          flow_id: FLOW.id,
          ...FLOW,
          version_no: VERSION.version_no,
          effective_from: VERSION.effective_from,
          effective_to: VERSION.effective_to,
          definition: FLOW_JSON,
          applies: (p_as_of ?? '') >= VERSION.effective_from,
        },
      ]);
    }
    if (path === '/rest/v1/rpc/my_recent_runs') {
      return json(
        200,
        this.runLogs.map((r, i) => ({
          id: `r${i}`,
          created_at: '2026-10-26T03:00:00Z',
          flow_code: FLOW.code,
          flow_name: FLOW.name,
          version_no: VERSION.version_no,
          params: r.params ?? {},
          param_defs: [{ key: 'ky_luong', label: 'Kỳ lương', type: 'month' }],
          status: r.status,
          duration_ms: r.duration_ms,
          rows_out: r.rows_out,
          error_code: r.error_code,
        })),
      );
    }
    if (path === '/rest/v1/run_logs' && method === 'POST') {
      if (!this.canSeeFlow(caller)) return json(403, { code: '42501', message: 'denied' });
      this.runLogs.push(parsed());
      return route.fulfill({ status: 201, headers: cors });
    }

    // ---- Edge Function ----
    if (path === '/functions/v1/admin-users' && method === 'POST') {
      if (!caller) return json(401, { ok: false, error: { code: 'unauthorized' } });
      if (caller.role !== 'admin') return json(403, { ok: false, error: { code: 'forbidden' } });
      const req = parsed();
      this.functionCalls.push(req);
      if (req.action === 'create') {
        const username = String(req.username);
        if (this.users.some((u) => u.username === username)) {
          return json(409, { ok: false, error: { code: 'username_taken' } });
        }
        const user: MockUser = {
          id: `00000000-0000-4000-8000-${String(this.users.length + 100).padStart(12, '0')}`,
          username,
          full_name: typeof req.full_name === 'string' ? req.full_name : '',
          role: req.role === 'admin' ? 'admin' : 'user',
          is_active: true,
          must_change_password: true,
          password: 'TamThoi2345abcXY',
        };
        this.users.push(user);
        for (const g of (req.group_ids as string[] | undefined) ?? []) {
          this.members.push({ group_id: g, user_id: user.id });
        }
        return json(200, {
          ok: true,
          data: { user_id: user.id, username, temp_password: user.password },
        });
      }
      return json(200, { ok: true, data: {} });
    }

    this.unhandled.push(`${method} ${path}${url.search}`);
    return json(501, { message: 'not mocked' });
  }
}
