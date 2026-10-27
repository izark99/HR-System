import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  AdminApi,
  AdminApiError,
  dbErrorKey,
  functionErrorKey,
  type AdminClient,
} from './admin-api';

const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status }));

describe('admin API error mapping', () => {
  it('Edge Function error codes pass through; unknown codes and non-JSON become "unknown"', async () => {
    expect(
      await functionErrorKey(httpError(409, { ok: false, error: { code: 'username_taken' } })),
    ).toBe('username_taken');
    // Removed with the self-action guard (MEMORY 2026-10-26 18:09): no longer a known code.
    expect(
      await functionErrorKey(
        httpError(409, { ok: false, error: { code: 'self_action_forbidden' } }),
      ),
    ).toBe('unknown');
    expect(await functionErrorKey(httpError(403, { error: { code: 'origin_not_allowed' } }))).toBe(
      'origin_not_allowed',
    );
    expect(await functionErrorKey(httpError(500, { error: { code: 'drop table' } }))).toBe(
      'unknown',
    );
    expect(
      await functionErrorKey(new FunctionsHttpError(new Response('<html>', { status: 502 }))),
    ).toBe('unknown');
    expect(await functionErrorKey(new FunctionsFetchError(new Error('offline')))).toBe('network');
    expect(await functionErrorKey(new Error('x'))).toBe('unknown');
  });

  it('Postgres/PostgREST codes → keys', () => {
    expect(dbErrorKey({ code: '23505' })).toBe('duplicate');
    expect(dbErrorKey({ code: '23P01' })).toBe('overlap');
    expect(dbErrorKey({ code: '42501' })).toBe('forbidden');
    expect(dbErrorKey({ code: 'HF001' })).toBe('immutable');
    expect(dbErrorKey({ code: '22023' })).toBe('invalid_definition');
    expect(dbErrorKey({ code: '23514' })).toBe('check_failed');
    expect(dbErrorKey({ code: '' })).toBe('network');
    expect(dbErrorKey({ code: 'XX000' })).toBe('unknown');
    expect(dbErrorKey({ code: 'HF002', message: 'draft_conflict' })).toBe('draft_conflict');
    expect(dbErrorKey({ code: 'P0002' })).toBe('version_not_found');
    expect(dbErrorKey({ code: '22023', message: 'change_note_required' })).toBe(
      'change_note_required',
    );
    expect(dbErrorKey({ code: '22023', message: 'effective_from_required' })).toBe(
      'invalid_definition',
    );
  });
});

describe('AdminApi', () => {
  function client(invoke: AdminClient['functions']['invoke']) {
    return { functions: { invoke }, from: vi.fn(), rpc: vi.fn() } as unknown as AdminClient;
  }

  it('createUser calls the admin-users function with the documented body', async () => {
    const invoke = vi.fn(() =>
      Promise.resolve({
        data: {
          ok: true,
          data: { user_id: 'u1', username: 'hr.cn03', temp_password: 'Abc23456789xyzQW' },
        },
        error: null,
      }),
    );
    const api = new AdminApi(client(invoke as unknown as AdminClient['functions']['invoke']));
    const r = await api.createUser({
      username: 'hr.cn03',
      fullName: 'A',
      role: 'user',
      groupIds: ['g1'],
    });
    expect(r.temp_password).toBe('Abc23456789xyzQW');
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: {
        action: 'create',
        username: 'hr.cn03',
        full_name: 'A',
        role: 'user',
        group_ids: ['g1'],
      },
    });
  });

  it('audit_failed warning is passed through with the password; other warnings are dropped', async () => {
    const reply = (data: Record<string, unknown>) =>
      vi.fn(() => Promise.resolve({ data: { ok: true, data }, error: null }));
    const created = await new AdminApi(
      client(
        reply({
          user_id: 'u1',
          username: 'hr.cn03',
          temp_password: 'Abc23456789xyzQW',
          warning: 'audit_failed',
        }) as unknown as AdminClient['functions']['invoke'],
      ),
    ).createUser({ username: 'hr.cn03', fullName: '', role: 'user', groupIds: [] });
    expect(created).toEqual({
      user_id: 'u1',
      username: 'hr.cn03',
      temp_password: 'Abc23456789xyzQW',
      warning: 'audit_failed',
    });
    const reset = await new AdminApi(
      client(
        reply({
          temp_password: 'Abc23456789xyzQW',
          warning: '<script>',
        }) as unknown as AdminClient['functions']['invoke'],
      ),
    ).resetPassword('u1');
    expect(reset).toEqual({ temp_password: 'Abc23456789xyzQW' });
  });

  it('function errors surface as AdminApiError with the mapped key', async () => {
    const invoke = vi.fn(() =>
      Promise.resolve({
        data: null,
        error: httpError(409, { ok: false, error: { code: 'username_taken' } }),
      }),
    ) as unknown as AdminClient['functions']['invoke'];
    const api = new AdminApi(client(invoke));
    await expect(api.resetPassword('u1')).rejects.toEqual(new AdminApiError('username_taken'));
  });

  it('updateUser only sends provided fields', async () => {
    const invoke = vi.fn(() => Promise.resolve({ data: { ok: true, data: {} }, error: null }));
    const api = new AdminApi(client(invoke as unknown as AdminClient['functions']['invoke']));
    await api.updateUser('u1', { groupIds: [] });
    expect(invoke).toHaveBeenCalledWith('admin-users', {
      body: { action: 'update', user_id: 'u1', group_ids: [] },
    });
  });
});

describe('AdminApi version RPCs', () => {
  it('publishDraft sends the draft id, range, trimmed-by-caller note and the updated_at token', async () => {
    const rpc = vi.fn(() =>
      Promise.resolve({ data: [{ version_id: 'v2', version_no: 2 }], error: null }),
    );
    const api = new AdminApi({ rpc, from: vi.fn(), functions: {} } as unknown as AdminClient);
    await expect(
      api.publishDraft({
        versionId: 'v2',
        effectiveFrom: '2026-10-01',
        effectiveTo: null,
        changeNote: 'Đổi ngưỡng OT',
        closePrevious: true,
        expectedUpdatedAt: '2026-10-27T01:02:03.123456+00:00',
      }),
    ).resolves.toEqual({ versionNo: 2 });
    expect(rpc).toHaveBeenCalledWith('admin_publish_flow_draft', {
      p_version_id: 'v2',
      p_effective_from: '2026-10-01',
      p_effective_to: null,
      p_change_note: 'Đổi ngưỡng OT',
      p_close_previous: true,
      p_expected_updated_at: '2026-10-27T01:02:03.123456+00:00',
    });
  });

  it('a stale draft and an existing draft map to their own keys', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'HF002', message: 'draft_conflict' } })
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'dup' } });
    const api = new AdminApi({ rpc, from: vi.fn(), functions: {} } as unknown as AdminClient);
    await expect(api.saveDraft('v1', { schemaVersion: 1 }, 't')).rejects.toMatchObject({
      key: 'draft_conflict',
    });
    await expect(api.createDraftFromVersion('v1')).rejects.toMatchObject({ key: 'duplicate' });
  });

  it('retire / discard filter by status and report a row that was not there', async () => {
    const calls: unknown[][] = [];
    const chain = {
      update: (...a: unknown[]) => (calls.push(['update', ...a]), chain),
      delete: () => (calls.push(['delete']), chain),
      eq: (...a: unknown[]) => (calls.push(['eq', ...a]), chain),
      select: () => Promise.resolve({ data: [] as unknown[], error: null }),
    };
    const api = new AdminApi({
      from: () => chain,
      rpc: vi.fn(),
      functions: {},
    } as unknown as AdminClient);
    await expect(api.retireVersion('v1')).rejects.toMatchObject({ key: 'version_not_found' });
    expect(calls).toEqual([
      ['update', { status: 'retired' }],
      ['eq', 'id', 'v1'],
      ['eq', 'status', 'published'],
    ]);
    calls.length = 0;
    await expect(api.discardDraft('v3')).rejects.toBeInstanceOf(AdminApiError);
    expect(calls).toEqual([['delete'], ['eq', 'id', 'v3'], ['eq', 'status', 'draft']]);
  });
});
