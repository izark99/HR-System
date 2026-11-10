/**
 * Reference tables on the run page (spec §34 AC-RT-08, 10, 15) through the RunStore, with the
 * engine worker replaced by an in-process EngineSession + RefStore and the Supabase client by a
 * small fake answering the PostgREST calls of `ref-source.ts`. Fake data only (branch list).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefTablePayload } from '../../../engine/io/ref-data';
import type { ParamValues } from '../../../engine/protocol';
import type { EngineSession } from '../../../engine/session';
import type { RunLogInsert } from '../../../lib/database.types';
import type { FlowSource } from '../flow-source';
import { readiness } from '../readiness';
import { effectiveVersion, parseRefColumns, refParamOptions } from '../ref-source';
import type { RunLogger } from '../run-log';

const engine = vi.hoisted(() => ({ refCalls: 0 }));

vi.mock('../engine-client', async () => {
  const { EngineSession: Session } = await import('../../../engine/session');
  const { RefStore: Store } = await import('../../../engine/io/ref-data');
  class EngineClient {
    api: unknown;
    constructor() {
      const refs = new Store();
      const s = new Session('vi', { refs });
      this.api = {
        loadFlow: (raw: unknown) => Promise.resolve(s.loadFlow(raw)),
        setSlotFiles: () => Promise.resolve(null),
        setRefTables: (p: RefTablePayload[]) => {
          engine.refCalls++;
          return Promise.resolve(refs.set(p));
        },
        cancel: () => Promise.resolve(s.cancel()),
      };
      this.session = s;
    }
    session: EngineSession;
    run(params: ParamValues) {
      return this.session.run(params);
    }
    restart() {}
    dispose() {}
  }
  return { EngineClient };
});

const { RunStore } = await import('../run-store');

const COLUMNS = [
  { key: 'ma_cn', title: 'Mã chi nhánh', type: 'string', aliases: [], isKey: true },
  { key: 'ten_cn', title: 'Tên chi nhánh', type: 'string', aliases: [], isKey: false },
];
const HE_SO_COLUMNS = [
  { key: 'bac', title: 'Bậc', type: 'integer', aliases: [], isKey: true },
  { key: 'he_so', title: 'Hệ số', type: 'decimal', aliases: [], isKey: false },
];

interface Db {
  tables: { id: string; code: string; name: string; columns: unknown }[];
  versions: {
    id: string;
    ref_table_id: string;
    version_no: number;
    status: string;
    effective_from: string;
    effective_to: string | null;
    rows: unknown[];
  }[];
  rowReads: string[];
}

function fakeClient(db: Db) {
  return {
    from(table: string) {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      let single = false;
      let wantsRows = false;
      const b = {
        select(cols: string) {
          wantsRows = cols.includes('rows');
          return b;
        },
        order: () => b,
        in(col: string, values: unknown[]) {
          filters.push((r) => values.includes(r[col]));
          return b;
        },
        eq(col: string, value: unknown) {
          filters.push((r) => r[col] === value);
          return b;
        },
        maybeSingle() {
          single = true;
          return b;
        },
        then(resolve: (v: unknown) => void) {
          const list = (table === 'ref_tables' ? db.tables : db.versions) as unknown as Record<
            string,
            unknown
          >[];
          const out = list.filter((r) => filters.every((f) => f(r)));
          if (wantsRows) for (const r of out) db.rowReads.push(String(r.id));
          resolve({ data: single ? (out[0] ?? null) : out, error: null });
        },
      };
      return b;
    },
  };
}

const FLOW = {
  schemaVersion: 1,
  params: [
    { key: 'ky', label: 'Kỳ', type: 'month', required: true, isAsOfDate: true },
    {
      key: 'chi_nhanh',
      label: 'Chi nhánh',
      type: 'select',
      options: { fromRefTable: 'DM_CN', valueColumn: 'ma_cn', labelColumn: 'ten_cn' },
    },
  ],
  nodes: [
    { id: 'ref_cn', type: 'input.refTable', config: { refTable: 'DM_CN' } },
    { id: 'ref_hs', type: 'input.refTable', config: { refTable: 'HE_SO' } },
    { id: 'xem', type: 'output.preview', config: { title: 'Chi nhánh', maxRows: 100 } },
  ],
  edges: [{ from: 'ref_cn', to: 'xem' }],
  inputSlots: [],
};

function setup(heSoRows: unknown[] = [{ bac: 1, he_so: '1.5' }]) {
  const db: Db = {
    tables: [
      { id: 't1', code: 'DM_CN', name: 'Danh mục chi nhánh', columns: COLUMNS },
      { id: 't2', code: 'HE_SO', name: 'Hệ số phụ cấp', columns: HE_SO_COLUMNS },
    ],
    versions: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        ref_table_id: 't1',
        version_no: 1,
        status: 'published',
        effective_from: '2026-01-01',
        effective_to: '2026-07-01',
        rows: [{ ma_cn: 'CN01', ten_cn: 'Chi nhánh Một' }],
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        ref_table_id: 't1',
        version_no: 3,
        status: 'published',
        effective_from: '2026-07-01',
        effective_to: null,
        rows: [
          { ma_cn: 'CN01', ten_cn: 'Chi nhánh Một' },
          { ma_cn: 'CN02', ten_cn: 'Chi nhánh Hai' },
        ],
      },
      {
        id: '00000000-0000-4000-8000-000000000005',
        ref_table_id: 't2',
        version_no: 5,
        status: 'published',
        effective_from: '2026-07-01',
        effective_to: null,
        rows: heSoRows,
      },
      {
        id: '00000000-0000-4000-8000-000000000006',
        ref_table_id: 't2',
        version_no: 6,
        status: 'draft',
        effective_from: '2025-01-01',
        effective_to: null,
        rows: [],
      },
    ],
    rowReads: [],
  };
  const logs: RunLogInsert[] = [];
  const logger: RunLogger = {
    logRun: (e) => {
      logs.push(e);
      return Promise.resolve();
    },
  };
  const source: FlowSource = {
    list: () => Promise.resolve([]),
    get: (code) =>
      Promise.resolve({
        summary: { code, name: 'Flow giả', description: '', category: '', inputCount: 0 },
        definition: FLOW,
        version: {
          id: '00000000-0000-4000-8000-0000000000f1',
          versionNo: 2,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          applies: true,
        },
      }),
    refs: fakeClient(db) as unknown as FlowSource['refs'],
  };
  const store = new RunStore(source, { logger, today: () => '2026-09-15' });
  return { store, db, logs };
}

async function until(pred: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timeout waiting for store state');
    await new Promise((r) => setTimeout(r, 5));
  }
}

afterEach(() => {
  engine.refCalls = 0;
});

describe('ref-source helpers', () => {
  it('picks the version with effective_from ≤ as-of < effective_to', () => {
    const v = [
      { id: 'a', versionNo: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01' },
      { id: 'b', versionNo: 2, effectiveFrom: '2026-07-01', effectiveTo: null },
    ];
    expect(effectiveVersion(v, '2025-12-31')).toBeNull();
    expect(effectiveVersion(v, '2026-01-01')?.id).toBe('a');
    expect(effectiveVersion(v, '2026-06-30')?.id).toBe('a');
    expect(effectiveVersion(v, '2026-07-01')?.id).toBe('b');
    expect(effectiveVersion(v, '2099-01-01')?.id).toBe('b');
  });

  it('builds list options "value – label", skipping blanks and duplicates', () => {
    expect(
      refParamOptions(
        [
          { ma: 'CN01', ten: 'Một' },
          { ma: 'CN01', ten: 'Trùng' },
          { ten: 'Không mã' },
          { ma: 'CN02', ten: 'CN02' },
          { ma: 3 },
        ],
        'ma',
        'ten',
      ),
    ).toEqual([
      { value: 'CN01', label: 'CN01 – Một' },
      { value: 'CN02', label: 'CN02' },
      { value: '3', label: '3' },
    ]);
  });

  it('reads key / title / type of the stored columns', () => {
    expect(parseRefColumns([...COLUMNS, { key: 'x', type: 'color' }, null])).toEqual([
      { key: 'ma_cn', title: 'Mã chi nhánh', type: 'string' },
      { key: 'ten_cn', title: 'Tên chi nhánh', type: 'string' },
    ]);
  });
});

describe('RunStore reference tables', () => {
  it('resolves every table for today, fills list options, runs and logs ref_versions', async () => {
    const { store, logs } = setup();
    await store.open('f');
    await until(() => store.getSnapshot().refs.status === 'ok');
    const s = store.getSnapshot();
    expect(s.refs.tables.map((t) => [t.code, t.version?.versionNo, t.problem])).toEqual([
      ['DM_CN', 3, null],
      ['HE_SO', 5, null],
    ]);
    expect(s.refs.params.chi_nhanh!.options).toEqual([
      { value: 'CN01', label: 'CN01 – Chi nhánh Một' },
      { value: 'CN02', label: 'CN02 – Chi nhánh Hai' },
    ]);
    store.setParam('ky', '2026-09');
    await until(() => store.getSnapshot().refs.status === 'ok');
    expect(readiness(store.getSnapshot()).canRun).toBe(true);
    await store.run();
    expect(store.getSnapshot().run.status).toBe('done');
    expect(store.getSnapshot().run.summary!.sheets[0]!.rowCount).toBe(2);
    await until(() => logs.length === 1);
    expect(logs[0]!.ref_versions).toEqual({
      DM_CN: '00000000-0000-4000-8000-000000000003',
      HE_SO: '00000000-0000-4000-8000-000000000005',
    });
  });

  it('a period without a version of a table blocks the run and names the table (AC-RT-15 a)', async () => {
    const { store, db } = setup();
    await store.open('f');
    await until(() => store.getSnapshot().refs.status === 'ok');
    store.setParam('ky', '2026-03');
    await until(() => store.getSnapshot().refs.status === 'blocked');
    const s = store.getSnapshot();
    expect(s.refs.tables.map((t) => [t.code, t.version?.versionNo ?? null, t.problem])).toEqual([
      ['DM_CN', 1, null],
      ['HE_SO', null, 'missing'],
    ]);
    // The draft (from 2025) never counts.
    expect(readiness(s)).toMatchObject({ refsBlocked: true, canRun: false });
    expect(s.refs.params.chi_nhanh!.options).toHaveLength(1);
    // Back to a covered period: rows of v3 are not fetched again (once per open, AC-RT-15 c).
    store.setParam('ky', '2026-09');
    await until(() => store.getSnapshot().refs.status === 'ok');
    expect(db.rowReads.filter((id) => id.endsWith('03'))).toHaveLength(1);
  });

  it('a list param whose table has no version shows its own error (AC-RT-10)', async () => {
    const { store } = setup();
    await store.open('f');
    store.setParam('ky', '2025-05');
    await until(() => store.getSnapshot().refs.status === 'blocked');
    expect(store.getSnapshot().refs.params.chi_nhanh).toMatchObject({
      problem: 'missing',
      options: [],
      table: 'Danh mục chi nhánh',
    });
  });

  it('cells that cannot be converted block the run with table, version and column only', async () => {
    const { store } = setup([{ bac: 1, he_so: 'một rưỡi' }]);
    await store.open('f');
    await until(() => store.getSnapshot().refs.status === 'blocked');
    const t = store.getSnapshot().refs.tables.find((x) => x.code === 'HE_SO')!;
    expect(t).toMatchObject({ problem: 'type', column: 'Hệ số' });
    expect(t.version!.versionNo).toBe(5);
    expect(JSON.stringify(store.getSnapshot().refs)).not.toContain('một rưỡi');
  });

  it('converts losslessly (integer stored as text) and keeps the run possible', async () => {
    const { store } = setup([{ bac: '1', he_so: 2 }]);
    await store.open('f');
    await until(() => store.getSnapshot().refs.status === 'ok');
    expect(store.getSnapshot().refs.tables.every((t) => t.problem === null)).toBe(true);
  });

  it('a server failure ends in error (Run locked) and "Thử lại" loads again', async () => {
    const { store, db } = setup();
    const tables = db.tables;
    db.tables = undefined as unknown as Db['tables'];
    await store.open('f');
    await until(() => store.getSnapshot().refs.status === 'error');
    expect(readiness(store.getSnapshot()).canRun).toBe(false);
    db.tables = tables;
    await store.resolveRefs(true);
    expect(store.getSnapshot().refs.status).toBe('ok');
  });

  it('rows are loaded again on the next open of the run page', async () => {
    const { store, db } = setup();
    await store.open('f');
    await until(() => store.getSnapshot().refs.status === 'ok');
    const reads = db.rowReads.length;
    await store.open('g');
    await until(() => store.getSnapshot().code === 'g' && store.getSnapshot().refs.status === 'ok');
    expect(db.rowReads.length).toBeGreaterThan(reads);
    expect(engine.refCalls).toBeGreaterThanOrEqual(2);
  });
});
