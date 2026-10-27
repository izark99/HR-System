/**
 * Period (as-of date) changes around a run: the version check must never stay at "resolving"
 * and the Run button must come back (HANDOFF §4.1, AC-B3-90). Complements run-store.test.ts with
 * the paths it does not cover: cooperative cancel, run failure, back-and-forth changes, a gap
 * period and a change made while the fresh worker is being restored.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineSession } from '../../../engine/session';
import type { LoadFlowResult, RunOutcome, SlotValidation } from '../../../engine/protocol';
import { readiness } from '../readiness';
import type { FlowSource } from '../flow-source';

const FIXTURES = resolve(import.meta.dirname, '../../../../../../fixtures/payroll-timesheet');
const flowJson: unknown = JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8'));

interface FakeApi {
  loadFlow: (raw: unknown) => Promise<LoadFlowResult>;
  setSlotFiles: (slot: string, files: { name: string }[]) => Promise<SlotValidation | null>;
  run: () => Promise<RunOutcome>;
  cancel: () => Promise<void>;
}

const engine = vi.hoisted(() => ({
  factory: null as null | (() => unknown),
  instances: [] as { api: unknown }[],
}));

vi.mock('../engine-client', () => {
  class EngineClient {
    api: unknown;
    constructor() {
      this.api = engine.factory!();
      engine.instances.push({ api: this.api });
    }
    run() {
      return (this.api as FakeApi).run();
    }
    restart() {
      this.api = engine.factory!();
      engine.instances.push({ api: this.api });
    }
    dispose() {}
  }
  return { EngineClient };
});

const { RunStore } = await import('../run-store');

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Script {
  runs: ReturnType<typeof deferred<RunOutcome>>[];
  validations: { slot: string; d: ReturnType<typeof deferred<SlotValidation>> }[];
  loads: number;
}

function scriptedApi(scripts: Script[]): () => FakeApi {
  return () => {
    const real = new EngineSession('vi');
    const sc: Script = { runs: [], validations: [], loads: 0 };
    scripts.push(sc);
    return {
      loadFlow: (raw) => {
        sc.loads++;
        return Promise.resolve(real.loadFlow(raw));
      },
      setSlotFiles: (slot) => {
        const d = deferred<SlotValidation>();
        sc.validations.push({ slot, d });
        return d.promise;
      },
      run: () => {
        const d = deferred<RunOutcome>();
        sc.runs.push(d);
        return d.promise;
      },
      cancel: () => Promise.resolve(),
    };
  };
}

const okReport = (slotKey: string): SlotValidation => ({
  slotKey,
  rowCount: 1,
  report: { issues: [], errorCount: 0, warningCount: 0, skippedRows: [], files: [] },
});

async function until(pred: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timeout waiting for store state');
    await new Promise((r) => setTimeout(r, 5));
  }
}

type Version = { id: string; no: number; from: string; to: string | null };
const V1: Version = { id: 'v1', no: 1, from: '2026-01-01', to: '2026-07-01' };
const V2: Version = { id: 'v2', no: 2, from: '2026-09-01', to: null };

/** v1: 2026-01..06, a gap in 2026-07/08, v2 from 2026-09. */
function gapSource(): FlowSource {
  const pick = (asOf: string) =>
    asOf >= V2.from ? V2 : asOf >= V1.from && asOf < V1.to! ? V1 : null;
  return {
    list: () => Promise.resolve([]),
    get: (code, asOf) => {
      const v = pick(asOf) ?? V2;
      const def = structuredClone(flowJson) as { inputSlots: { label: string }[] };
      def.inputSlots[0]!.label = `Bảng lương (${v.id})`;
      return Promise.resolve({
        summary: {
          code,
          name: 'Đối chiếu',
          description: '',
          category: 'Lương',
          inputCount: 2,
          versionLabel: `v${v.no}`,
        },
        definition: def,
        version: {
          id: v.id,
          versionNo: v.no,
          effectiveFrom: v.from,
          effectiveTo: v.to,
          applies: pick(asOf) !== null,
        },
      });
    },
  };
}

describe('RunStore: period change around a run', () => {
  let scripts: Script[];
  beforeEach(() => {
    scripts = [];
    engine.factory = scriptedApi(scripts);
  });
  afterEach(() => {
    engine.instances.length = 0;
  });

  async function readyStore() {
    const store = new RunStore(gapSource(), { today: () => '2026-10-26' });
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2026-10');
    store.addFiles('bang_luong', [new File(['a'], 'a.xlsx')]);
    store.addFiles('cham_cong', [new File(['b'], 'b.xlsx')]);
    for (const v of scripts[0]!.validations) v.d.resolve(okReport(v.slot));
    await until(() => readiness(store.getSnapshot()).canRun);
    expect(store.getSnapshot().version?.id).toBe('v2');
    return store;
  }

  it('cooperative cancel after a period change: the older version is loaded once the run settles', async () => {
    const store = await readyStore();
    const running = store.run();
    store.setParam('ky_luong', '2026-03');
    await new Promise((r) => setTimeout(r, 20));
    expect(scripts[0]!.loads).toBe(1);
    const cancelling = store.cancel();
    scripts[0]!.runs[0]!.resolve({
      ok: false,
      cancelled: true,
      error: { messageKey: 'executor.error.cancelled', params: {} },
    });
    await running;
    await cancelling;
    await until(() => store.getSnapshot().version?.id === 'v1');
    expect(store.getSnapshot().versionCheck).toBe('ok');
    expect(store.getSnapshot().flow?.inputSlots[0]?.label).toBe('Bảng lương (v1)');
  });

  it('a run that fails after a period change: the version check is not left at "resolving"', async () => {
    const store = await readyStore();
    const running = store.run();
    store.setParam('ky_luong', '2026-03');
    scripts[0]!.runs[0]!.resolve({
      ok: false,
      error: { messageKey: 'executor.error.generic', params: {} },
    } as RunOutcome);
    await running;
    await until(() => store.getSnapshot().versionCheck !== 'resolving');
    await until(() => store.getSnapshot().version?.id === 'v1');
    expect(store.getSnapshot().versionCheck).toBe('ok');
  });

  it('back and forth during a run (10 -> 03 -> 10): nothing is reloaded, check ends "ok" on v2', async () => {
    const store = await readyStore();
    const running = store.run();
    store.setParam('ky_luong', '2026-03');
    store.setParam('ky_luong', '2026-10');
    scripts[0]!.runs[0]!.resolve({ ok: true, summary: { compare: null } as never });
    await running;
    await until(() => store.getSnapshot().versionCheck === 'ok');
    expect(scripts[0]!.loads).toBe(1);
    expect(store.getSnapshot().version?.id).toBe('v2');
    expect(store.getSnapshot().asOf).toBe('2026-10-01');
  });

  it('a change into a gap during a run ends "none" (Run blocked) after the run, not "resolving"', async () => {
    const store = await readyStore();
    const running = store.run();
    store.setParam('ky_luong', '2026-08');
    scripts[0]!.runs[0]!.resolve({ ok: true, summary: { compare: null } as never });
    await running;
    await until(() => store.getSnapshot().versionCheck === 'none');
    expect(readiness(store.getSnapshot())).toMatchObject({ canRun: false, versionBlocked: true });
    // Moving out of the gap into a period of the loaded version re-enables Run.
    store.setParam('ky_luong', '2026-10');
    await until(() => store.getSnapshot().versionCheck === 'ok');
    expect(readiness(store.getSnapshot()).canRun).toBe(true);
  });
});

// run-store.ts restartEngine(): `restoring` is reset only `if (token === this.token)`, but a version
// switch caused by a period change during the restore (applyDefinition does ++this.token) makes the
// restore's token stale, so `restoring` stays true and Run stays disabled until the page reloads.
describe('KNOWN BUG (remove it.fails once fixed)', () => {
  let scripts: Script[];
  beforeEach(() => {
    scripts = [];
    engine.factory = scriptedApi(scripts);
  });
  afterEach(() => {
    engine.instances.length = 0;
  });

  async function readyStore() {
    const store = new RunStore(gapSource(), { today: () => '2026-10-26' });
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2026-10');
    store.addFiles('bang_luong', [new File(['a'], 'a.xlsx')]);
    store.addFiles('cham_cong', [new File(['b'], 'b.xlsx')]);
    for (const v of scripts[0]!.validations) v.d.resolve(okReport(v.slot));
    await until(() => readiness(store.getSnapshot()).canRun);
    return store;
  }

  it.fails(
    'a period change while the fresh worker is being restored ends consistent and runnable',
    async () => {
      const store = await readyStore();
      void store.run();
      const cancelling = store.cancel();
      await until(() => engine.instances.length === 2, 3_000);
      expect(store.getSnapshot().restoring).toBe(true);
      store.setParam('ky_luong', '2026-03'); // during restore
      await until(() => scripts[1]!.validations.length >= 2);
      for (const v of scripts[1]!.validations) v.d.resolve(okReport(v.slot));
      await cancelling;
      await until(() => store.getSnapshot().versionCheck === 'ok', 5_000);
      // Settle any re-validation the version switch started on whichever worker is current.
      const live = scripts[scripts.length - 1]!;
      await until(() => {
        for (const v of live.validations) v.d.resolve(okReport(v.slot));
        return readiness(store.getSnapshot()).canRun;
      }, 5_000).catch((e: unknown) => {
        const x = store.getSnapshot();
        throw new Error(
          `${String(e)} :: ${JSON.stringify({ vc: x.versionCheck, v: x.version?.id, restoring: x.restoring, rf: x.restoreFailed, run: x.run.status, canRun: readiness(x) })}`,
        );
      });
      expect(store.getSnapshot().version?.id).toBe('v1');
      expect(store.getSnapshot().asOf).toBe('2026-03-01');
    },
  );
});
