import { describe, expect, it, vi } from 'vitest';
import type { RunLogInsert } from '../../../lib/database.types';
import {
  FlowSourceError,
  SupabaseFlowSource,
  type FlowSourceClient,
} from '../supabase-flow-source';

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

type Insert = () => Promise<{ error: { code: string } | null }>;

function fakeClient(rpc: Rpc, insert = vi.fn<Insert>(() => Promise.resolve({ error: null }))) {
  const from = vi.fn(() => ({ insert }));
  return { client: { rpc, from } as unknown as FlowSourceClient, from, insert };
}

const DEF = { schemaVersion: 1, inputSlots: [{}, {}], nodes: [] };

describe('SupabaseFlowSource', () => {
  it('list(asOf) → my_flows with the date; version label only when a version is effective', async () => {
    const rpc = vi.fn<Rpc>(() =>
      Promise.resolve({
        data: [
          {
            flow_id: 'f1',
            code: 'payroll-timesheet',
            name: 'Đối chiếu',
            description: 'd',
            category: 'Lương & công',
            instructions: 'hướng dẫn',
            version_id: 'v3',
            version_no: 3,
            effective_from: '2026-09-01',
            effective_to: null,
            input_count: 2,
          },
          {
            flow_id: 'f2',
            code: 'later',
            name: 'Sau',
            description: '',
            category: '',
            instructions: '',
            version_id: null,
            version_no: null,
            effective_from: null,
            effective_to: null,
            input_count: 1,
          },
        ],
        error: null,
      }),
    );
    const list = await new SupabaseFlowSource(fakeClient(rpc).client).list('2026-10-26');
    expect(rpc).toHaveBeenCalledWith('my_flows', { p_as_of: '2026-10-26' });
    expect(list).toEqual([
      {
        code: 'payroll-timesheet',
        name: 'Đối chiếu',
        description: 'd',
        category: 'Lương & công',
        instructions: 'hướng dẫn',
        inputCount: 2,
        versionLabel: 'v3',
      },
      { code: 'later', name: 'Sau', description: '', category: '', inputCount: 1 },
    ]);
  });

  it('get(code, asOf) → resolve_flow_version: definition + version info; null when not visible', async () => {
    const rpc = vi.fn<Rpc>((_fn, args) =>
      Promise.resolve({
        data:
          args.p_code === 'payroll-timesheet'
            ? [
                {
                  version_id: 'v2',
                  flow_id: 'f1',
                  code: 'payroll-timesheet',
                  name: 'Đối chiếu',
                  description: '',
                  category: 'Lương',
                  instructions: '',
                  version_no: 2,
                  effective_from: '2026-09-01',
                  effective_to: '2026-12-01',
                  definition: DEF,
                  applies: true,
                },
              ]
            : [],
        error: null,
      }),
    );
    const source = new SupabaseFlowSource(fakeClient(rpc).client);
    const loaded = await source.get('payroll-timesheet', '2026-09-01');
    expect(rpc).toHaveBeenCalledWith('resolve_flow_version', {
      p_code: 'payroll-timesheet',
      p_as_of: '2026-09-01',
    });
    expect(loaded).toEqual({
      summary: {
        code: 'payroll-timesheet',
        name: 'Đối chiếu',
        description: '',
        category: 'Lương',
        inputCount: 2,
        versionLabel: 'v2',
      },
      definition: DEF,
      version: {
        id: 'v2',
        versionNo: 2,
        effectiveFrom: '2026-09-01',
        effectiveTo: '2026-12-01',
        applies: true,
      },
    });
    expect(await source.get('unknown', '2026-09-01')).toBeNull();
  });

  it('server and network errors are typed (not mistaken for "not found")', async () => {
    const server = new SupabaseFlowSource(
      fakeClient(() => Promise.resolve({ data: null, error: { code: '42501', message: 'x' } }))
        .client,
    );
    await expect(server.get('a', '2026-01-01')).rejects.toEqual(new FlowSourceError('server'));
    const network = new SupabaseFlowSource(
      fakeClient(() =>
        Promise.resolve({ data: null, error: { code: '', message: 'Failed to fetch' } }),
      ).client,
    );
    await expect(network.list('2026-01-01')).rejects.toMatchObject({ kind: 'network' });
  });

  it('recentRuns maps logged params with their labels', async () => {
    const rpc = vi.fn<Rpc>(() =>
      Promise.resolve({
        data: [
          {
            id: 'r1',
            created_at: '2026-10-01T02:00:00Z',
            flow_code: 'payroll-timesheet',
            flow_name: 'Đối chiếu',
            version_no: 2,
            params: { ky_luong: '2026-09', bi_mat: 'x' },
            param_defs: [
              { key: 'ky_luong', label: 'Kỳ lương', type: 'month' },
              { key: 'khong_log', label: 'Không log', type: 'string' },
            ],
            status: 'failed',
            duration_ms: 10,
            rows_out: null,
            error_code: 'executor.error.engineCrashed',
          },
        ],
        error: null,
      }),
    );
    const runs = await new SupabaseFlowSource(fakeClient(rpc).client).recentRuns(5);
    expect(rpc).toHaveBeenCalledWith('my_recent_runs', { p_limit: 5 });
    expect(runs).toEqual([
      {
        id: 'r1',
        createdAt: '2026-10-01T02:00:00Z',
        flowName: 'Đối chiếu',
        versionNo: 2,
        params: [{ key: 'ky_luong', label: 'Kỳ lương', type: 'month', value: '2026-09' }],
        status: 'failed',
      },
    ]);
  });

  it('logRun inserts into run_logs; insert errors reject', async () => {
    const entry = { flow_version_id: 'v2' } as RunLogInsert;
    const ok = fakeClient(() => Promise.resolve({ data: null, error: null }));
    await new SupabaseFlowSource(ok.client).logRun(entry);
    expect(ok.from).toHaveBeenCalledWith('run_logs');
    expect(ok.insert).toHaveBeenCalledWith(entry);
    const bad = fakeClient(
      () => Promise.resolve({ data: null, error: null }),
      vi.fn<Insert>(() => Promise.resolve({ error: { code: '23514' } })),
    );
    await expect(new SupabaseFlowSource(bad.client).logRun(entry)).rejects.toBeInstanceOf(
      FlowSourceError,
    );
  });
});
