/**
 * Verifier checks (spec §34 AC-RT-08, 15 b/c) written from the requirements, independent of the
 * developer's tests: effective-date boundaries, month as-of, a period changed while the rows of
 * another version are still downloading (the worker must end up with the rows the box shows and
 * the run log records), and lossless-only conversions. Fake data only (branch list).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefTablePayload } from '../../../engine/io/ref-data';
import { castRefValue } from '../../../engine/io/ref-data';
import type { ParamValues } from '../../../engine/protocol';
import type { EngineSession } from '../../../engine/session';
import type { RunLogInsert } from '../../../lib/database.types';
import { asOfFromParams } from '../as-of';
import type { FlowSource } from '../flow-source';
import { effectiveVersion, type RefVersionInfo } from '../ref-source';
import type { RunLogger } from '../run-log';

const engine = vi.hoisted(() => ({ sent: [] as string[][] }));

vi.mock('../engine-client', async () => {
  const { EngineSession: Session } = await import('../../../engine/session');
  const { RefStore: Store } = await import('../../../engine/io/ref-data');
  class EngineClient {
    api: unknown;
    session: EngineSession;
    constructor() {
      const refs = new Store();
      const s = new Session('vi', { refs });
      this.api = {
        loadFlow: (raw: unknown) => Promise.resolve(s.loadFlow(raw)),
        setSlotFiles: () => Promise.resolve(null),
        setRefTables: (p: RefTablePayload[]) => {
          engine.sent.push(p.map((x) => x.versionId));
          return Promise.resolve(refs.set(p));
        },
        cancel: () => Promise.resolve(s.cancel()),
      };
      this.session = s;
    }
    run(params: ParamValues) {
      return this.session.run(params);
    }
    restart() {}
    dispose() {}
  }
  return { EngineClient };
});

const { RunStore } = await import('../run-store');

const V1 = '00000000-0000-4000-8000-0000000000a1';
const V2 = '00000000-0000-4000-8000-0000000000a2';

interface Row {
  id: string;
  ref_table_id: string;
  version_no: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
  rows: unknown[];
}

/** PostgREST fake; row reads of `slow` wait for `gate`. */
function fakeClient(versions: Row[], slow: string, gate: Promise<void>) {
  const tables = [
    {
      id: 't1',
      code: 'DM_CN',
      name: 'Danh mục chi nhánh',
      columns: [
        { key: 'ma_cn', title: 'Mã chi nhánh', type: 'string', aliases: [], isKey: true },
        { key: 'ten_cn', title: 'Tên chi nhánh', type: 'string', aliases: [], isKey: false },
      ],
    },
  ];
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
          const list = (table === 'ref_tables' ? tables : versions) as unknown as Record<
            string,
            unknown
          >[];
          const out = list.filter((r) => filters.every((f) => f(r)));
          const answer = { data: single ? (out[0] ?? null) : out, error: null };
          if (wantsRows && out[0]?.id === slow) void gate.then(() => resolve(answer));
          else resolve(answer);
        },
      };
      return b;
    },
  };
}

const FLOW = {
  schemaVersion: 1,
  params: [{ key: 'ky', label: 'Kỳ', type: 'month', required: true, isAsOfDate: true }],
  nodes: [
    { id: 'ref_cn', type: 'input.refTable', config: { refTable: 'DM_CN' } },
    { id: 'xem', type: 'output.preview', config: { title: 'Chi nhánh', maxRows: 100 } },
  ],
  edges: [{ from: 'ref_cn', to: 'xem' }],
  inputSlots: [],
};

function setup(slow: string, gate: Promise<void>) {
  const versions: Row[] = [
    {
      id: V1,
      ref_table_id: 't1',
      version_no: 1,
      status: 'published',
      effective_from: '2026-01-01',
      effective_to: '2026-07-01',
      rows: [{ ma_cn: 'CN01', ten_cn: 'Chi nhánh Một' }],
    },
    {
      id: V2,
      ref_table_id: 't1',
      version_no: 2,
      status: 'published',
      effective_from: '2026-07-01',
      effective_to: null,
      rows: [
        { ma_cn: 'CN01', ten_cn: 'Chi nhánh Một' },
        { ma_cn: 'CN02', ten_cn: 'Chi nhánh Hai' },
        { ma_cn: 'CN03', ten_cn: 'Chi nhánh Ba' },
      ],
    },
  ];
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
          versionNo: 1,
          effectiveFrom: '2026-01-01',
          effectiveTo: null,
          applies: true,
        },
      }),
    refs: fakeClient(versions, slow, gate) as unknown as FlowSource['refs'],
  };
  return { store: new RunStore(source, { logger, today: () => '2026-09-15' }), logs };
}

async function until(pred: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timeout waiting for store state');
    await new Promise((r) => setTimeout(r, 5));
  }
}

afterEach(() => {
  engine.sent = [];
});

describe('effective version boundaries (effective_from ≤ as_of < effective_to)', () => {
  const versions: RefVersionInfo[] = [
    { id: 'a', versionNo: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01' },
    { id: 'b', versionNo: 2, effectiveFrom: '2026-07-01', effectiveTo: null },
  ];
  it('first day belongs to the new version, the day before to the old one', () => {
    expect(effectiveVersion(versions, '2025-12-31')).toBeNull();
    expect(effectiveVersion(versions, '2026-01-01')?.id).toBe('a');
    expect(effectiveVersion(versions, '2026-06-30')?.id).toBe('a');
    expect(effectiveVersion(versions, '2026-07-01')?.id).toBe('b');
    expect(effectiveVersion(versions, '9999-12-31')?.id).toBe('b');
  });
  it('a month period means its first day; an empty or invalid period falls back to today', () => {
    const params = FLOW.params as never;
    expect(asOfFromParams(params, { ky: '2026-06' }, '2026-09-15')).toBe('2026-06-01');
    expect(asOfFromParams(params, { ky: '2026-07' }, '2026-09-15')).toBe('2026-07-01');
    expect(asOfFromParams(params, { ky: '' }, '2026-09-15')).toBe('2026-09-15');
    expect(asOfFromParams(params, { ky: '2026-13' }, '2026-09-15')).toBe('2026-09-15');
  });
});

describe('period changed while the rows of another version are downloading', () => {
  it('the worker keeps the rows of the version shown and logged (no stale overwrite)', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { store, logs } = setup(V1, gate);
    await store.open('f');
    // Today (09/2026) → v2, rows fetched at once.
    await until(() => store.getSnapshot().refs.status === 'ok');
    // 05/2026 → v1, whose rows hang; then back to 09/2026 (v2 already in memory).
    store.setParam('ky', '2026-05');
    await until(() => store.getSnapshot().refs.status === 'loading');
    store.setParam('ky', '2026-09');
    await until(() => store.getSnapshot().refs.status === 'ok');
    expect(store.getSnapshot().refs.tables[0]!.version?.id).toBe(V2);
    // The slow answer arrives late: it must not replace what the worker holds.
    open();
    await new Promise((r) => setTimeout(r, 30));
    expect(engine.sent.at(-1)).toEqual([V2]);
    expect(store.getSnapshot().refs.tables[0]!.version?.id).toBe(V2);
    await store.run();
    expect(store.getSnapshot().run.status).toBe('done');
    expect(store.getSnapshot().run.summary!.sheets[0]!.rowCount).toBe(3);
    await until(() => logs.length === 1);
    expect(logs[0]!.ref_versions).toEqual({ DM_CN: V2 });
  });

  it('Run is refused while the versions of a new period are loading', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { store, logs } = setup(V1, gate);
    await store.open('f');
    await until(() => store.getSnapshot().refs.status === 'ok');
    store.setParam('ky', '2026-05');
    await until(() => store.getSnapshot().refs.status === 'loading');
    await store.run();
    expect(store.getSnapshot().run.status).toBe('idle');
    open();
    await until(() => store.getSnapshot().refs.status === 'ok');
    expect(store.getSnapshot().refs.tables[0]!.version?.id).toBe(V1);
    expect(engine.sent.at(-1)).toEqual([V1]);
    await store.run();
    expect(store.getSnapshot().run.summary!.sheets[0]!.rowCount).toBe(1);
    await until(() => logs.length === 1);
    expect(logs[0]!.ref_versions).toEqual({ DM_CN: V1 });
  });
});

describe('castRefValue: lossless only (AC-RT-15 b)', () => {
  it('refuses texts with group separators or several readings', () => {
    for (const t of ['1,500', '1.500,5', '1 500', '1,5', '50%', '1e3', '0x10', 'Infinity', 'NaN']) {
      expect(castRefValue(t, 'decimal').ok, t).toBe(false);
      expect(castRefValue(t, 'integer').ok, t).toBe(false);
    }
  });
  it('decimal → integer only when the fraction is zero', () => {
    expect(castRefValue('12.5', 'integer').ok).toBe(false);
    expect(castRefValue('-0.0001', 'integer').ok).toBe(false);
    expect(castRefValue('7.0', 'integer')).toEqual({ ok: true, value: 7 });
  });
  it('integers beyond the safe range are refused (no rounding)', () => {
    expect(castRefValue(2 ** 53 + 2, 'integer').ok).toBe(false);
    expect(castRefValue(2 ** 53 + 2, 'decimal').ok).toBe(false);
    expect(castRefValue(0.1, 'decimal').ok).toBe(false);
  });
  it('dates: impossible days and non-standard shapes are refused', () => {
    for (const t of [
      '2026-02-29',
      '29/02/2026',
      '2026/01/05',
      '05-01-2026',
      '46000',
      '2026-01-05T00:00',
    ])
      expect(castRefValue(t, 'date').ok, t).toBe(false);
    expect(castRefValue('2028-02-29', 'date')).toEqual({ ok: true, value: '2028-02-29' });
    expect(castRefValue(46000, 'date').ok).toBe(false);
  });
});

describe('KNOWN BUG', () => {
  // A text column holding "1.000" (Vietnamese: one thousand) changed to integer becomes 1: the
  // dot may be a thousands separator, so the text has two readings (MEMORY 2026-10-26 08:59) and
  // must not be converted silently.
  it.fails('text "1.000" is not silently converted to the integer 1', () => {
    expect(castRefValue('1.000', 'integer').ok).toBe(false);
  });
});
