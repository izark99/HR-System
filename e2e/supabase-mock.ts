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

export interface MockFlow {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  instructions: string;
  is_archived: boolean;
}

export interface MockVersion {
  id: string;
  flow_id: string;
  version_no: number;
  status: 'draft' | 'published' | 'retired';
  effective_from: string;
  effective_to: string | null;
  definition: unknown;
  /** Drafts: null. */
  published_at: string | null;
  change_note?: string;
  published_by?: string | null;
  /** Optimistic-lock token (spec §14.5); defaults to a fixed timestamp. */
  updated_at?: string;
}

const DEFAULT_UPDATED_AT = '2026-10-26T00:00:00.000001+00:00';

/** Error the mock answers instead of doing the work (one-shot unless `sticky`). */
export interface InjectedFailure {
  status: number;
  /** Edge Function: `{ error: { code } }`; PostgREST: `{ code }` (e.g. 23P01). */
  code: string;
  sticky?: boolean;
}

/** Flow definition of the acceptance flow, deep-cloned so a test can tweak it. */
export function baseFlowDefinition(): Record<string, unknown> {
  return structuredClone(FLOW_JSON) as Record<string, unknown>;
}

/** The acceptance flow with the "Công" tolerance changed (other metrics untouched). */
export function flowWithCongTolerance(tolerance: string): Record<string, unknown> {
  const def = baseFlowDefinition();
  const nodes = def.nodes as {
    id: string;
    config: { metrics: { left: string; tolerance: string }[] };
  }[];
  const cmp = nodes.find((n) => n.id === 'cmp')!;
  cmp.config.metrics.find((m) => m.left === 'cong')!.tolerance = tolerance;
  return def;
}

export const FIXED_TEMP_PASSWORD = 'TamThoi2345abcXY';
export const RESET_TEMP_PASSWORD = 'DatLai7788qwrtZK';

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

let jwtSerial = 0;

function fakeJwt(user: MockUser): string {
  const now = Math.floor(Date.now() / 1000);
  jwtSerial++;
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
        // Makes every issued token distinct (e.g. before / after a refresh).
        jti: `t${jwtSerial}`,
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
  flows: MockFlow[] = [{ ...FLOW, is_archived: false }];
  versions: MockVersion[] = [
    {
      id: VERSION.id,
      flow_id: FLOW.id,
      version_no: VERSION.version_no,
      status: 'published',
      effective_from: VERSION.effective_from,
      effective_to: VERSION.effective_to,
      definition: FLOW_JSON,
      published_at: '2026-10-26T00:00:00Z',
    },
  ];
  /** Next admin-users call / publish RPC fails with this (see InjectedFailure). */
  functionFailure: InjectedFailure | null = null;
  /** Successful create / reset_password replies carry this warning (audit insert failed). */
  functionWarning: 'audit_failed' | null = null;
  publishFailure: InjectedFailure | null = null;
  /** resolve_flow_version fails (500) while set; `resolveDelayMs(asOf)` delays its answer. */
  resolveFailure: InjectedFailure | null = null;
  resolveDelayMs: ((asOf: string) => number) | null = null;
  /** run_logs insert fails with this (the run itself must not notice). */
  runLogFailure: InjectedFailure | null = null;
  /** Next password sign-in fails with this status/code (e.g. 429 over_request_rate_limit). */
  tokenFailure: InjectedFailure | null = null;
  /** /auth/v1/logout refuses (401) the first token it sees, accepts later (refreshed) ones. */
  logoutRejectsFirstToken = false;
  /** Bearer tokens /auth/v1/logout received while `logoutRejectsFirstToken` is set. */
  logoutTokens: string[] = [];
  /** Delay (ms) before /auth/v1/logout answers (a slow or unreachable server). */
  logoutDelayMs = 0;
  /** Auth server refuses refresh tokens (session revoked / expired). */
  refreshRevoked = false;
  /** false: the token endpoint accepts a locked account, only the profile row says "locked". */
  authEnforcesBan = true;

  /** PATCH/DELETE requests on flow_versions, as received. */
  versionWrites: { method: string; id: string; body: Record<string, unknown> }[] = [];
  /** Next flow_versions PATCH/DELETE fails with this. */
  versionFailure: InjectedFailure | null = null;
  private updatedCounter = 0;

  private nextUpdatedAt(): string {
    this.updatedCounter++;
    return `2026-10-27T03:00:${String(this.updatedCounter).padStart(2, '0')}.123456+00:00`;
  }

  /** PostgREST row of a version (definition only when selected, like the real API). */
  private versionRow(v: MockVersion, withDefinition: boolean): Record<string, unknown> {
    const { definition, ...rest } = v;
    return {
      ...rest,
      effective_from: v.status === 'draft' && !v.effective_from ? null : v.effective_from,
      change_note: v.change_note ?? '',
      published_by: v.published_by ?? null,
      updated_at: v.updated_at ?? DEFAULT_UPDATED_AT,
      ...(withDefinition ? { definition } : {}),
    };
  }

  /** DB constraints on one version: range check and no overlap among published (23P01). */
  private checkVersion(
    v: MockVersion,
    all: MockVersion[] = this.versions,
  ): ((json: (s: number, d: unknown) => Promise<void>) => Promise<void>) | null {
    if (v.effective_to !== null && v.effective_from && v.effective_to <= v.effective_from) {
      return (json) => json(400, { code: '23514', message: 'check' });
    }
    if (v.status !== 'published') return null;
    const clash = all.some(
      (o) =>
        o.id !== v.id &&
        o.flow_id === v.flow_id &&
        o.status === 'published' &&
        (v.effective_to === null || o.effective_from < v.effective_to) &&
        (o.effective_to === null || o.effective_to > v.effective_from),
    );
    return clash ? (json) => json(409, { code: '23P01', message: 'overlap' }) : null;
  }

  /** Replace the versions of the acceptance flow. */
  setVersions(
    list: { no: number; from: string; to?: string | null; definition?: unknown }[],
  ): MockVersion[] {
    this.versions = list.map((v) => ({
      id: `00000000-0000-4000-8000-0000000002${String(v.no).padStart(2, '0')}`,
      flow_id: FLOW.id,
      version_no: v.no,
      status: 'published',
      effective_from: v.from,
      effective_to: v.to ?? null,
      definition: v.definition ?? FLOW_JSON,
      published_at: '2026-10-26T00:00:00Z',
    }));
    return this.versions;
  }

  /** Calls whose path matches (substring or regexp), parsed JSON bodies. */
  bodiesOf(path: string | RegExp, method?: string): Record<string, unknown>[] {
    return this.calls
      .filter(
        (c) =>
          (!method || c.method === method) &&
          (typeof path === 'string' ? c.path.startsWith(path) : path.test(c.path)),
      )
      .map((c) => {
        try {
          return JSON.parse(c.body) as Record<string, unknown>;
        } catch {
          return {};
        }
      });
  }

  /** Any request that only an Admin screen makes (admin API surface). */
  adminCalls(): string[] {
    return this.calls
      .filter(
        (c) =>
          c.path.startsWith('/functions/v1/admin-users') ||
          /^\/rest\/v1\/(groups|group_members|flow_assignments|flow_versions|flows)(\?|$)/.test(
            c.path,
          ) ||
          c.path.startsWith('/rest/v1/rpc/admin_'),
      )
      .map((c) => `${c.method} ${c.path}`);
  }

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

  private canSeeFlow(user: MockUser | undefined, flowId: string = FLOW.id): boolean {
    if (!user || !user.is_active) return false;
    if (user.role === 'admin') return true;
    if (!this.flowVisibleToUsers && flowId === FLOW.id) return false;
    const groups = this.members.filter((m) => m.user_id === user.id).map((m) => m.group_id);
    return this.assignments.some(
      (a) =>
        a.flow_id === flowId &&
        (a.user_id === user.id || (a.group_id && groups.includes(a.group_id))),
    );
  }

  /** SQL resolve_flow_version: effective version first, else the latest published (applies=false). */
  private resolveVersion(flowId: string, asOf: string) {
    const rows = this.versions
      .filter((v) => v.flow_id === flowId && v.status === 'published')
      .map((v) => ({
        v,
        applies: v.effective_from <= asOf && (v.effective_to === null || v.effective_to > asOf),
      }))
      .sort(
        (a, b) =>
          Number(b.applies) - Number(a.applies) ||
          b.v.effective_from.localeCompare(a.v.effective_from),
      );
    return rows[0];
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
      if (this.tokenFailure) {
        const f = this.tokenFailure;
        if (!f.sticky) this.tokenFailure = null;
        return json(f.status, { code: f.code, msg: 'injected' });
      }
      const { email, password } = parsed() as { email?: string; password?: string };
      const user = this.users.find((u) => `${u.username}@${EMAIL_DOMAIN}` === email);
      if (!user || user.password !== password) {
        return json(400, { code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      if (!user.is_active && this.authEnforcesBan) {
        return json(400, { code: 'user_banned', msg: 'User is banned' });
      }
      return json(200, sessionFor(user));
    }
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const { refresh_token } = parsed() as { refresh_token?: string };
      const user = this.users.find((u) => `refresh-${u.id}` === refresh_token);
      if (this.refreshRevoked) return json(400, { code: 'refresh_token_not_found', msg: 'x' });
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
    if (path === '/auth/v1/logout' && this.logoutRejectsFirstToken) {
      const token = /^Bearer (.+)$/.exec(request.headers()['authorization'] ?? '')?.[1] ?? '';
      this.logoutTokens.push(token);
      // The token the tab started with counts as expired server-side: 401, nothing revoked.
      if (this.logoutTokens[0] === token) {
        return json(401, { code: 'bad_jwt', msg: 'invalid JWT: token is expired' });
      }
    }
    if (path === '/auth/v1/logout') {
      if (this.logoutDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.logoutDelayMs));
        // The page may be gone by then (the app does not wait more than 3 s).
        return route.fulfill({ status: 204, headers: cors }).catch(() => undefined);
      }
      return route.fulfill({ status: 204, headers: cors });
    }

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
    const pgError = (f: InjectedFailure) => json(f.status, { code: f.code, message: 'injected' });
    const adminOnly = caller?.role === 'admin' && caller.is_active;
    const denied = () => json(403, { code: '42501', message: 'denied' });
    const idEq = eqFilter('id');

    if (path === '/rest/v1/group_members' && method === 'GET') return rows(this.members);
    if (path === '/rest/v1/groups' && method === 'GET') return rows(this.groups);
    if (path === '/rest/v1/groups' && method === 'POST') {
      if (!adminOnly) return denied();
      const g = parsed() as { name?: string; description?: string };
      if (this.groups.some((x) => x.name === g.name)) {
        return json(409, { code: '23505', message: 'duplicate' });
      }
      this.groups.push({
        id: `00000000-0000-4000-8000-0000000000${String(this.groups.length + 10)}`,
        name: String(g.name),
        description: g.description ?? '',
      });
      return route.fulfill({ status: 201, headers: cors });
    }
    if (path === '/rest/v1/groups' && method === 'PATCH') {
      if (!adminOnly) return denied();
      const g = parsed() as { name?: string; description?: string };
      const row = this.groups.find((x) => x.id === idEq);
      if (!row) return route.fulfill({ status: 204, headers: cors });
      if (this.groups.some((x) => x.id !== row.id && x.name === g.name)) {
        return json(409, { code: '23505', message: 'duplicate' });
      }
      row.name = g.name ?? row.name;
      row.description = g.description ?? row.description;
      return route.fulfill({ status: 204, headers: cors });
    }
    if (path === '/rest/v1/groups' && method === 'DELETE') {
      if (!adminOnly) return denied();
      this.groups = this.groups.filter((x) => x.id !== idEq);
      this.members = this.members.filter((m) => m.group_id !== idEq);
      this.assignments = this.assignments.filter((a) => a.group_id !== idEq);
      return route.fulfill({ status: 204, headers: cors });
    }
    if (path === '/rest/v1/flow_assignments' && method === 'GET') return rows(this.assignments);
    if (path === '/rest/v1/flow_assignments' && method === 'POST') {
      if (!adminOnly) return denied();
      const a = parsed() as { flow_id: string; user_id?: string; group_id?: string };
      this.assignments.push({
        id: `asg-${this.assignments.length + 1}-${Date.now()}`,
        flow_id: a.flow_id,
        user_id: a.user_id ?? null,
        group_id: a.group_id ?? null,
      });
      return route.fulfill({ status: 201, headers: cors });
    }
    if (path === '/rest/v1/flow_assignments' && method === 'DELETE') {
      if (!adminOnly) return denied();
      this.assignments = this.assignments.filter((a) => a.id !== idEq);
      return route.fulfill({ status: 204, headers: cors });
    }
    if (path === '/rest/v1/flows' && method === 'GET') {
      const code = eqFilter('code');
      return rows(
        [...this.flows]
          .filter((f) => !code || f.code === code)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    }
    if (path === '/rest/v1/flow_versions' && method === 'GET') {
      const flowId = eqFilter('flow_id');
      const withDefinition = (url.searchParams.get('select') ?? '').includes('definition');
      return rows(
        [...this.versions]
          .filter((v) => !flowId || v.flow_id === flowId)
          .sort((a, b) => b.version_no - a.version_no)
          .map((v) => this.versionRow(v, withDefinition)),
      );
    }
    if (path === '/rest/v1/flow_versions' && (method === 'PATCH' || method === 'DELETE')) {
      if (!adminOnly) return denied();
      this.versionWrites.push({ method, id: idEq ?? '', body: parsed() });
      if (this.versionFailure) {
        const f = this.versionFailure;
        if (!f.sticky) this.versionFailure = null;
        return pgError(f);
      }
      const status = eqFilter('status');
      const row = this.versions.find((v) => v.id === idEq && (!status || v.status === status));
      if (!row) return json(200, []);
      if (method === 'DELETE') {
        if (row.status !== 'draft')
          return json(400, { code: 'HF001', message: 'flow_version_immutable' });
        this.versions = this.versions.filter((v) => v !== row);
        return json(200, [{ id: row.id }]);
      }
      const patch = parsed() as { status?: string; effective_to?: string | null };
      if (row.status === 'retired') return json(400, { code: 'HF001', message: 'immutable' });
      const next = { ...row };
      if (patch.status === 'retired') next.status = 'retired';
      if ('effective_to' in patch) next.effective_to = patch.effective_to ?? null;
      const fail = this.checkVersion(next);
      if (fail) return fail(json);
      Object.assign(row, next, { updated_at: this.nextUpdatedAt() });
      return json(200, [{ id: row.id }]);
    }
    if (path === '/rest/v1/rpc/admin_create_draft_from_version') {
      if (!adminOnly) return denied();
      const { p_version_id } = parsed() as { p_version_id?: string };
      const src = this.versions.find((v) => v.id === p_version_id);
      if (!src) return json(404, { code: 'P0002', message: 'version_not_found' });
      if (this.versions.some((v) => v.flow_id === src.flow_id && v.status === 'draft')) {
        return json(409, { code: '23505', message: 'duplicate key' });
      }
      const no =
        Math.max(
          0,
          ...this.versions.filter((v) => v.flow_id === src.flow_id).map((v) => v.version_no),
        ) + 1;
      const id = `00000000-0000-4000-8000-0000000004${String(this.versions.length).padStart(2, '0')}`;
      const updated = this.nextUpdatedAt();
      this.versions.push({
        id,
        flow_id: src.flow_id,
        version_no: no,
        status: 'draft',
        effective_from: '',
        effective_to: null,
        definition: structuredClone(src.definition),
        published_at: null,
        change_note: '',
        published_by: null,
        updated_at: updated,
      });
      return json(200, [{ version_id: id, version_no: no, updated_at: updated }]);
    }
    if (path === '/rest/v1/rpc/admin_publish_flow_draft') {
      if (!adminOnly) return denied();
      if (this.publishFailure) {
        const f = this.publishFailure;
        if (!f.sticky) this.publishFailure = null;
        return pgError(f);
      }
      const p = parsed() as {
        p_version_id: string;
        p_effective_from: string | null;
        p_effective_to: string | null;
        p_change_note: string | null;
        p_close_previous: boolean;
        p_expected_updated_at: string;
      };
      if (!p.p_effective_from)
        return json(400, { code: '22023', message: 'effective_from_required' });
      if (!p.p_change_note || !p.p_change_note.trim()) {
        return json(400, { code: '22023', message: 'change_note_required' });
      }
      const draft = this.versions.find((v) => v.id === p.p_version_id);
      if (!draft) return json(404, { code: 'P0002', message: 'version_not_found' });
      if (draft.status !== 'draft') return json(400, { code: 'HF001', message: 'immutable' });
      if ((draft.updated_at ?? DEFAULT_UPDATED_AT) !== p.p_expected_updated_at) {
        return json(409, { code: 'HF002', message: 'draft_conflict' });
      }
      // One transaction: compute everything, then apply (nothing changes on failure).
      const from = p.p_effective_from;
      const staged = this.versions.map((v) => ({ ...v }));
      if (p.p_close_previous) {
        for (const v of staged) {
          if (
            v.flow_id === draft.flow_id &&
            v.status === 'published' &&
            v.effective_to === null &&
            v.effective_from < from
          ) {
            v.effective_to = from;
          }
        }
      }
      const target = staged.find((v) => v.id === draft.id)!;
      Object.assign(target, {
        status: 'published',
        effective_from: from,
        effective_to: p.p_effective_to,
        change_note: p.p_change_note.trim(),
        published_at: '2026-10-27T02:00:00Z',
        published_by: caller.id,
      });
      for (const v of staged) {
        const fail = this.checkVersion(v, staged);
        if (fail) return fail(json);
      }
      this.versions = staged;
      return json(200, [{ version_id: draft.id, version_no: draft.version_no }]);
    }
    if (path === '/rest/v1/rpc/admin_publish_flow_version') {
      if (!adminOnly) return denied();
      if (this.publishFailure) {
        const f = this.publishFailure;
        if (!f.sticky) this.publishFailure = null;
        return pgError(f);
      }
      const p = parsed() as Record<string, string | null>;
      if (!p.p_change_note || !String(p.p_change_note).trim()) {
        return json(400, { code: '22023', message: 'change_note_required' });
      }
      let flow = this.flows.find((f) => f.code === p.p_code);
      if (!flow) {
        flow = {
          id: `00000000-0000-4000-8000-0000000000f${this.flows.length + 2}`,
          code: String(p.p_code),
          name: '',
          description: '',
          category: '',
          instructions: '',
          is_archived: false,
        };
        this.flows.push(flow);
      }
      flow.name = String(p.p_name);
      flow.description = p.p_description ?? '';
      flow.category = p.p_category ?? '';
      flow.instructions = p.p_instructions ?? '';
      const mine = this.versions.filter((v) => v.flow_id === flow.id);
      if (p.p_close_previous) {
        for (const v of mine) {
          if (
            v.status === 'published' &&
            v.effective_to === null &&
            v.effective_from < String(p.p_effective_from)
          ) {
            v.effective_to = String(p.p_effective_from);
          }
        }
      }
      const no = Math.max(0, ...mine.map((v) => v.version_no)) + 1;
      const id = `00000000-0000-4000-8000-0000000003${String(this.versions.length).padStart(2, '0')}`;
      this.versions.push({
        id,
        flow_id: flow.id,
        version_no: no,
        status: 'published',
        effective_from: String(p.p_effective_from),
        effective_to: (p.p_effective_to as string | null) ?? null,
        definition: p.p_definition,
        published_at: '2026-10-26T00:00:00Z',
        change_note: String(p.p_change_note).trim(),
        published_by: caller.id,
      });
      return json(200, [{ flow_id: flow.id, version_id: id, version_no: no }]);
    }
    if (path === '/rest/v1/rpc/my_flows') {
      const { p_as_of } = parsed() as { p_as_of?: string };
      const out = this.flows
        .filter((f) => !f.is_archived && this.canSeeFlow(caller, f.id))
        .map((f) => {
          const r = this.resolveVersion(f.id, p_as_of ?? '9999-12-31');
          const slots = (r?.v.definition as { inputSlots?: unknown[] } | undefined)?.inputSlots;
          return {
            flow_id: f.id,
            code: f.code,
            name: f.name,
            description: f.description,
            category: f.category,
            instructions: f.instructions,
            version_id: r?.v.id ?? null,
            version_no: r?.v.version_no ?? null,
            effective_from: r?.v.effective_from ?? null,
            effective_to: r?.v.effective_to ?? null,
            input_count: Array.isArray(slots) ? slots.length : 0,
          };
        });
      return json(200, out);
    }
    if (path === '/rest/v1/rpc/resolve_flow_version') {
      const { p_code, p_as_of } = parsed() as { p_code?: string; p_as_of?: string };
      const delay = this.resolveDelayMs?.(p_as_of ?? '') ?? 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (this.resolveFailure) {
        const f = this.resolveFailure;
        if (!f.sticky) this.resolveFailure = null;
        return pgError(f);
      }
      const flow = this.flows.find((f) => f.code === p_code && !f.is_archived);
      if (!flow || !this.canSeeFlow(caller, flow.id)) return json(200, []);
      const r = this.resolveVersion(flow.id, p_as_of ?? '');
      if (!r) return json(200, []);
      return json(200, [
        {
          version_id: r.v.id,
          flow_id: flow.id,
          code: flow.code,
          name: flow.name,
          description: flow.description,
          category: flow.category,
          instructions: flow.instructions,
          version_no: r.v.version_no,
          effective_from: r.v.effective_from,
          effective_to: r.v.effective_to,
          definition: r.v.definition,
          applies: r.applies,
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
      if (this.runLogFailure) {
        const f = this.runLogFailure;
        if (!f.sticky) this.runLogFailure = null;
        return json(f.status, { code: f.code, message: 'injected' });
      }
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
      if (this.functionFailure) {
        const f = this.functionFailure;
        if (!f.sticky) this.functionFailure = null;
        return json(f.status, { ok: false, error: { code: f.code } });
      }
      const target = this.users.find((u) => u.id === req.user_id);
      // Admins may reset / lock / demote themselves (MEMORY 2026-10-26 18:09): no self guard.
      const warning = this.functionWarning ? { warning: this.functionWarning } : {};
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
          password: FIXED_TEMP_PASSWORD,
        };
        this.users.push(user);
        for (const g of (req.group_ids as string[] | undefined) ?? []) {
          this.members.push({ group_id: g, user_id: user.id });
        }
        return json(200, {
          ok: true,
          data: { user_id: user.id, username, temp_password: user.password, ...warning },
        });
      }
      if (!target) return json(404, { ok: false, error: { code: 'not_found' } });
      if (req.action === 'reset_password') {
        target.password = RESET_TEMP_PASSWORD;
        target.must_change_password = true;
        return json(200, { ok: true, data: { temp_password: RESET_TEMP_PASSWORD, ...warning } });
      }
      if (req.action === 'set_active') {
        target.is_active = Boolean(req.active);
        return json(200, { ok: true, data: {} });
      }
      if (req.action === 'update') {
        if (typeof req.full_name === 'string') target.full_name = req.full_name;
        if (req.role === 'admin' || req.role === 'user') target.role = req.role;
        if (Array.isArray(req.group_ids)) {
          this.members = this.members.filter((m) => m.user_id !== target.id);
          for (const g of req.group_ids as string[]) {
            this.members.push({ group_id: g, user_id: target.id });
          }
        }
        return json(200, { ok: true, data: {} });
      }
      return json(200, { ok: true, data: {} });
    }

    this.unhandled.push(`${method} ${path}${url.search}`);
    return json(501, { message: 'not mocked' });
  }
}
