/**
 * admin-users Edge Function: account management for Admins (spec §6).
 *
 * Pure request handling; every side effect goes through `AdminBackend` (implemented with the
 * service-role client in backend.ts, faked in tests). Responses are
 *   200 { ok: true, data }   |   4xx/5xx { ok: false, error: { code } }
 * where `code` is a stable identifier the web app maps to an i18n message. Passwords are only
 * ever returned once in the response body; they are never logged or written to audit_logs.
 */
import { z } from 'zod';

export const SYNTHETIC_EMAIL_DOMAIN = 'users.hrflow.local';
export const MIN_PASSWORD_LENGTH = 10;
const TEMP_PASSWORD_LENGTH = 16;
const MAX_BODY_BYTES = 16 * 1024;

export type ErrorCode =
  | 'origin_not_allowed'
  | 'method_not_allowed'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_input'
  | 'username_taken'
  | 'not_found'
  | 'group_not_found'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  origin_not_allowed: 403,
  method_not_allowed: 405,
  unauthorized: 401,
  forbidden: 403,
  invalid_input: 400,
  username_taken: 409,
  not_found: 404,
  group_not_found: 400,
  internal: 500,
};

export class AdminError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'AdminError';
  }
}

export type Role = 'admin' | 'user';

export interface ProfileRow {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
}

export interface AuditEntry {
  actorId: string;
  action: string;
  entityId: string;
  diff: Record<string, unknown>;
}

/** Side effects of the function. Implementations throw on unexpected failures. */
export interface AdminBackend {
  /** Verified user id of an access token, or null when the token is invalid/expired. */
  userIdFromToken(token: string): Promise<string | null>;
  getProfile(id: string): Promise<ProfileRow | null>;
  usernameExists(username: string): Promise<boolean>;
  /** Ids among `ids` that do not exist in public.groups. */
  missingGroups(ids: readonly string[]): Promise<string[]>;
  /** Returns the new auth user id; throws AdminError('username_taken') if the e-mail exists. */
  createAuthUser(email: string, password: string, username: string): Promise<string>;
  deleteAuthUser(id: string): Promise<void>;
  setPassword(id: string, password: string): Promise<void>;
  setBanned(id: string, banned: boolean): Promise<void>;
  revokeSessions(id: string): Promise<void>;
  insertProfile(
    row: ProfileRow & { must_change_password: boolean; created_by: string },
  ): Promise<void>;
  updateProfile(
    id: string,
    patch: Partial<Pick<ProfileRow, 'full_name' | 'role' | 'is_active'>> & {
      must_change_password?: boolean;
    },
  ): Promise<void>;
  /** Replace the user's group memberships with exactly `groupIds`. */
  setGroups(userId: string, groupIds: readonly string[], actorId: string): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface HandlerEnv {
  /** Exact origins (scheme://host[:port]) allowed to call the function from a browser. */
  allowedOrigins: readonly string[];
  /** Random source; injectable for tests. */
  randomBytes?: (n: number) => Uint8Array;
}

// ---- input --------------------------------------------------------------------------------

export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/);
const UserIdSchema = z.uuid();
const FullNameSchema = z.string().trim().max(120);
const RoleSchema = z.enum(['admin', 'user']);
const GroupIdsSchema = z.array(z.uuid()).max(50);

export const RequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'),
    username: UsernameSchema,
    full_name: FullNameSchema.default(''),
    role: RoleSchema.default('user'),
    group_ids: GroupIdsSchema.default([]),
  }),
  z.strictObject({ action: z.literal('reset_password'), user_id: UserIdSchema }),
  z.strictObject({ action: z.literal('set_active'), user_id: UserIdSchema, active: z.boolean() }),
  z.strictObject({
    action: z.literal('update'),
    user_id: UserIdSchema,
    full_name: FullNameSchema.optional(),
    role: RoleSchema.optional(),
    group_ids: GroupIdsSchema.optional(),
  }),
]);
export type AdminRequest = z.infer<typeof RequestSchema>;

// ---- helpers ------------------------------------------------------------------------------

export function syntheticEmail(username: string): string {
  return `${username}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function defaultRandomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/**
 * Crypto-random temporary password without look-alike characters (0/O, 1/l/I). Contains an
 * upper-case letter, a lower-case letter and a digit so it also satisfies Supabase's optional
 * "password requirements" setting. Rejection sampling avoids modulo bias.
 */
export function generateTempPassword(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
  length = TEMP_PASSWORD_LENGTH,
): string {
  const limit = 256 - (256 % ALPHABET.length);
  for (;;) {
    let out = '';
    while (out.length < length) {
      for (const b of randomBytes(length * 2)) {
        if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length];
      }
    }
    if (/[A-Z]/.test(out) && /[a-z]/.test(out) && /[0-9]/.test(out)) return out;
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  return origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function fail(code: ErrorCode, cors: Record<string, string>): Response {
  return json({ ok: false, error: { code } }, STATUS[code], cors);
}

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new AdminError('invalid_input');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AdminError('invalid_input');
  }
}

// ---- actions ------------------------------------------------------------------------------

async function requireTarget(backend: AdminBackend, id: string): Promise<ProfileRow> {
  const target = await backend.getProfile(id);
  if (!target) throw new AdminError('not_found');
  return target;
}

async function requireGroups(backend: AdminBackend, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  if ((await backend.missingGroups(ids)).length > 0) throw new AdminError('group_not_found');
}

/**
 * Audit for an action that already happened and produced a temporary password. Failing the
 * request here would lose the password (the account exists / was reset, nobody knows it), so a
 * failed audit insert is reported as a warning instead.
 */
async function auditAfterPassword(
  backend: AdminBackend,
  entry: AuditEntry,
): Promise<{ warning?: 'audit_failed' }> {
  try {
    await backend.audit(entry);
    return {};
  } catch {
    return { warning: 'audit_failed' };
  }
}

async function run(
  request: AdminRequest,
  caller: ProfileRow,
  backend: AdminBackend,
  env: HandlerEnv,
): Promise<Record<string, unknown>> {
  const random = env.randomBytes ?? defaultRandomBytes;

  switch (request.action) {
    case 'create': {
      const groupIds = [...new Set(request.group_ids)];
      if (await backend.usernameExists(request.username)) throw new AdminError('username_taken');
      await requireGroups(backend, groupIds);
      const password = generateTempPassword(random);
      const id = await backend.createAuthUser(
        syntheticEmail(request.username),
        password,
        request.username,
      );
      try {
        await backend.insertProfile({
          id,
          username: request.username,
          full_name: request.full_name,
          role: request.role,
          is_active: true,
          must_change_password: true,
          created_by: caller.id,
        });
        await backend.setGroups(id, groupIds, caller.id);
      } catch (err) {
        // Roll back: no auth user without a profile (cascades the partial profile/groups).
        await backend.deleteAuthUser(id).catch(() => undefined);
        throw err;
      }
      const warning = await auditAfterPassword(backend, {
        actorId: caller.id,
        action: 'user.create',
        entityId: id,
        diff: { username: request.username, role: request.role, group_ids: groupIds },
      });
      return { user_id: id, username: request.username, temp_password: password, ...warning };
    }

    case 'reset_password': {
      // Admins may reset their own password too (MEMORY 2026-10-26 18:09).
      await requireTarget(backend, request.user_id);
      const password = generateTempPassword(random);
      // Order matters: the password change trigger clears must_change_password, so set it after.
      await backend.setPassword(request.user_id, password);
      await backend.updateProfile(request.user_id, { must_change_password: true });
      await backend.revokeSessions(request.user_id);
      const warning = await auditAfterPassword(backend, {
        actorId: caller.id,
        action: 'user.reset_password',
        entityId: request.user_id,
        diff: {},
      });
      return { user_id: request.user_id, temp_password: password, ...warning };
    }

    case 'set_active': {
      // Self-lock allowed (MEMORY 2026-10-26 18:09); recovery is via SQL on the dashboard.
      await requireTarget(backend, request.user_id);
      await backend.setBanned(request.user_id, !request.active);
      await backend.updateProfile(request.user_id, { is_active: request.active });
      if (!request.active) await backend.revokeSessions(request.user_id);
      await backend.audit({
        actorId: caller.id,
        action: request.active ? 'user.unlock' : 'user.lock',
        entityId: request.user_id,
        diff: { is_active: request.active },
      });
      return { user_id: request.user_id, is_active: request.active };
    }

    case 'update': {
      // Self-demotion allowed (MEMORY 2026-10-26 18:09).
      await requireTarget(backend, request.user_id);
      const groupIds = request.group_ids ? [...new Set(request.group_ids)] : undefined;
      if (groupIds) await requireGroups(backend, groupIds);
      const patch: { full_name?: string; role?: Role } = {};
      if (request.full_name !== undefined) patch.full_name = request.full_name;
      if (request.role !== undefined) patch.role = request.role;
      if (Object.keys(patch).length > 0) await backend.updateProfile(request.user_id, patch);
      if (groupIds) await backend.setGroups(request.user_id, groupIds, caller.id);
      await backend.audit({
        actorId: caller.id,
        action: 'user.update',
        entityId: request.user_id,
        diff: { ...patch, ...(groupIds ? { group_ids: groupIds } : {}) },
      });
      return { user_id: request.user_id };
    }
  }
}

/** Entry point shared by the Deno server (index.ts) and the unit tests. */
export async function handleRequest(
  req: Request,
  env: HandlerEnv,
  backend: AdminBackend,
): Promise<Response> {
  const origin = req.headers.get('origin');
  // Browsers always send Origin on cross-origin requests. Non-browser callers (no Origin) still
  // need an Admin access token.
  if (origin !== null && !env.allowedOrigins.includes(origin)) {
    return fail('origin_not_allowed', corsHeaders(null));
  }
  const cors = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return fail('method_not_allowed', cors);

  try {
    const auth = req.headers.get('authorization') ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
    if (!token) throw new AdminError('unauthorized');
    const callerId = await backend.userIdFromToken(token);
    if (!callerId) throw new AdminError('unauthorized');
    const caller = await backend.getProfile(callerId);
    if (!caller || caller.role !== 'admin' || !caller.is_active) throw new AdminError('forbidden');

    const parsed = RequestSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new AdminError('invalid_input');
    const data = await run(parsed.data, caller, backend, env);
    return json({ ok: true, data }, 200, cors);
  } catch (err) {
    if (err instanceof AdminError) return fail(err.code, cors);
    return fail('internal', cors);
  }
}

/** ALLOWED_ORIGINS="https://a.pages.dev, http://localhost:5173" → exact origins. */
export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => /^https?:\/\/[^/\s]+$/.test(s));
}
