/**
 * RunStore (main-thread wizard state) with the engine worker replaced by an in-process stand-in:
 * - "real" mode wraps an actual EngineSession (same code the worker runs) on the fixtures;
 * - "scripted" mode lets a test decide when each worker call settles (cancel, stale answers).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineSession } from '../../../engine/session';
import type {
  LoadFlowResult,
  ParamValues,
  RunOutcome,
  SlotValidation,
  UploadFile,
} from '../../../engine/protocol';
import { readiness } from '../readiness';
import type { RunLogInsert } from '../../../lib/database.types';
import type { FlowSource } from '../flow-source';
import type { RunLogger } from '../run-log';

const FIXTURES = resolve(import.meta.dirname, '../../../../../../fixtures/payroll-timesheet');
const flowJson: unknown = JSON.parse(readFileSync(join(FIXTURES, 'flow.json'), 'utf8'));

interface FakeApi {
  loadFlow: (raw: unknown) => Promise<LoadFlowResult>;
  setSlotFiles: (
    slot: string,
    files: UploadFile[],
    version?: number,
  ) => Promise<SlotValidation | null>;
  run: (params: ParamValues, onProgress?: unknown) => Promise<RunOutcome>;
  cancel: () => Promise<void>;
}

/** Each EngineClient instance = one "worker". `factory` builds its api. */
const engine = vi.hoisted(() => ({
  factory: null as null | (() => unknown),
  instances: [] as { api: unknown; restarts: number }[],
}));

vi.mock('../engine-client', () => {
  class EngineClient {
    api: unknown;
    constructor() {
      this.api = engine.factory!();
      engine.instances.push({ api: this.api, restarts: 0 });
    }
    run(params: unknown, onProgress: unknown) {
      return (this.api as FakeApi).run(params as ParamValues, onProgress);
    }
    restart() {
      engine.instances[engine.instances.length - 1]!.restarts++;
      this.api = engine.factory!();
      engine.instances.push({ api: this.api, restarts: 0 });
    }
    dispose() {}
  }
  return { EngineClient };
});

const { RunStore } = await import('../run-store');

const source: FlowSource = {
  list: () => Promise.resolve([]),
  get: (code) =>
    Promise.resolve(
      code === 'payroll-timesheet'
        ? {
            summary: {
              code,
              name: 'Đối chiếu',
              description: '',
              category: 'Lương & công',
              inputCount: 2,
            },
            definition: flowJson,
          }
        : null,
    ),
};

function fixtureFiles(prefix: string): File[] {
  return readdirSync(FIXTURES)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.xlsx'))
    .sort()
    .map((name) => new File([readFileSync(join(FIXTURES, name))], name));
}

/** Resolve when `pred` holds (store updates are async: worker calls are promises). */
async function until(pred: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timeout waiting for store state');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function realApi(): FakeApi {
  const s = new EngineSession('vi');
  return {
    loadFlow: (raw) => Promise.resolve(s.loadFlow(raw)),
    setSlotFiles: (k, f, v) => s.setSlotFiles(k, f, v),
    run: (p, cb) => s.run(p, cb as never),
    cancel: () => Promise.resolve(s.cancel()),
  };
}

afterEach(() => {
  engine.instances.length = 0;
});

describe('RunStore with the real engine session', () => {
  beforeEach(() => {
    engine.factory = realApi;
  });

  it('opens, validates the fixtures, runs and reports 63/9/3/3', async () => {
    const store = new RunStore(source);
    await store.open('payroll-timesheet');
    const s0 = store.getSnapshot();
    expect(s0.load).toBe('ready');
    expect(readiness(s0)).toMatchObject({
      canRun: false,
      missingSlots: ['bang_luong', 'cham_cong'],
    });

    store.setParam('ky_luong', '2026-09');
    store.addFiles('bang_luong', fixtureFiles('bang_luong_'));
    store.addFiles('cham_cong', fixtureFiles('cham_cong_'));
    await until(() => readiness(store.getSnapshot()).canRun);
    expect(readiness(store.getSnapshot())).toMatchObject({ errors: 0, warnings: 0, skipped: 3 });

    await store.run();
    const run = store.getSnapshot().run;
    expect(run.status).toBe('done');
    expect(run.summary?.compare).toMatchObject({
      matched: 63,
      mismatched: 9,
      onlyLeft: 3,
      onlyRight: 3,
    });
    expect(run.nodes.every((n) => n.status === 'done')).toBe(true);
    expect(run.params).toEqual({ ky_luong: '2026-09' });
  });

  it('unknown flow code → notFound; reopening the same code is a no-op', async () => {
    const store = new RunStore(source);
    await store.open('nope');
    expect(store.getSnapshot().load).toBe('notFound');
    await store.open('payroll-timesheet');
    const before = store.getSnapshot();
    await store.open('payroll-timesheet');
    expect(store.getSnapshot()).toBe(before);
  });

  it('invalid flow definition → load "invalid" with problems', async () => {
    const bad: FlowSource = {
      ...source,
      get: (code) =>
        Promise.resolve({
          summary: { code, name: 'x', description: '', category: '', inputCount: 0 },
          definition: { schemaVersion: 1, nodes: 'oops' },
        }),
    };
    const store = new RunStore(bad);
    await store.open('x');
    expect(store.getSnapshot().load).toBe('invalid');
    expect(store.getSnapshot().problems.length).toBeGreaterThan(0);
  });

  it('same file name replaces the earlier file; removing a file clears the old result', async () => {
    const store = new RunStore(source);
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2026-09');
    store.addFiles('bang_luong', fixtureFiles('bang_luong_'));
    store.addFiles('cham_cong', fixtureFiles('cham_cong_'));
    await until(() => readiness(store.getSnapshot()).canRun);
    const firstIds = store.getSnapshot().slots.bang_luong!.files.map((f) => f.id);

    store.addFiles('bang_luong', fixtureFiles('bang_luong_CN01'));
    const files = store.getSnapshot().slots.bang_luong!.files;
    expect(files.map((f) => f.file.name)).toEqual([
      'bang_luong_CN02_092026.xlsx',
      'bang_luong_CN03_092026.xlsx',
      'bang_luong_CN01_092026.xlsx',
    ]);
    expect(files[2]!.id).not.toBe(firstIds[0]);
    await until(() => readiness(store.getSnapshot()).canRun);

    await store.run();
    expect(store.getSnapshot().run.status).toBe('done');
    store.removeFile('bang_luong', files[0]!.id);
    expect(store.getSnapshot().run.status).toBe('idle');
    expect(store.getSnapshot().run.summary).toBeNull();
    await until(() => !store.getSnapshot().slots.bang_luong!.validating);
    expect(store.getSnapshot().slots.bang_luong!.validation?.rowCount).toBe(50);
  });

  it('resetRun keeps files and validation', async () => {
    const store = new RunStore(source);
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2026-09');
    store.addFiles('bang_luong', fixtureFiles('bang_luong_'));
    store.addFiles('cham_cong', fixtureFiles('cham_cong_'));
    await until(() => readiness(store.getSnapshot()).canRun);
    await store.run();
    store.resetRun();
    const s = store.getSnapshot();
    expect(s.run.status).toBe('idle');
    expect(s.slots.bang_luong!.files).toHaveLength(3);
    expect(readiness(s).canRun).toBe(true);
  });
});

/** Scripted worker: every call is a deferred the test settles. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
}

interface Script {
  api: FakeApi;
  runs: ReturnType<typeof deferred<RunOutcome>>[];
  validations: { slot: string; names: string[]; d: ReturnType<typeof deferred<SlotValidation>> }[];
  cancels: number;
  loads: number;
}

function scriptedApi(scripts: Script[]): () => FakeApi {
  return () => {
    const real = new EngineSession('vi');
    const sc: Script = {
      runs: [],
      validations: [],
      cancels: 0,
      loads: 0,
      api: {
        loadFlow: (raw) => {
          sc.loads++;
          return Promise.resolve(real.loadFlow(raw));
        },
        setSlotFiles: (slot, files) => {
          const d = deferred<SlotValidation>();
          sc.validations.push({ slot, names: files.map((f) => f.name), d });
          return d.promise;
        },
        run: () => {
          const d = deferred<RunOutcome>();
          sc.runs.push(d);
          return d.promise;
        },
        cancel: () => {
          sc.cancels++;
          return Promise.resolve();
        },
      },
    };
    scripts.push(sc);
    return sc.api;
  };
}

const okReport = (slotKey: string, rows: number): SlotValidation => ({
  slotKey,
  rowCount: rows,
  report: {
    issues: [],
    errorCount: 0,
    warningCount: 0,
    skippedRows: [],
    files: [],
  },
});

describe('RunStore with a scripted worker', () => {
  let scripts: Script[];
  beforeEach(() => {
    scripts = [];
    engine.factory = scriptedApi(scripts);
  });

  async function readyStore() {
    const store = new RunStore(source);
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2026-09');
    store.addFiles('bang_luong', [new File(['a'], 'a.xlsx')]);
    store.addFiles('cham_cong', [new File(['b'], 'b.xlsx')]);
    for (const v of scripts[0]!.validations) v.d.resolve(okReport(v.slot, 1));
    await until(() => readiness(store.getSnapshot()).canRun);
    return store;
  }

  it('a stale validation answer (older file set) does not overwrite the newer one', async () => {
    const store = new RunStore(source);
    await store.open('payroll-timesheet');
    store.addFiles('bang_luong', [new File(['a'], 'old.xlsx')]);
    store.addFiles('bang_luong', [new File(['b'], 'new.xlsx')]);
    const [older, newer] = scripts[0]!.validations;
    expect(newer!.names).toEqual(['old.xlsx', 'new.xlsx']);
    newer!.d.resolve(okReport('bang_luong', 2));
    await until(() => !store.getSnapshot().slots.bang_luong!.validating);
    older!.d.resolve(okReport('bang_luong', 99));
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getSnapshot().slots.bang_luong!.validation?.rowCount).toBe(2);
  });

  it('cooperative cancel: the run settles as cancelled within the grace period, no restart', async () => {
    const store = await readyStore();
    const running = store.run();
    expect(store.getSnapshot().run.status).toBe('running');
    const cancelling = store.cancel();
    expect(store.getSnapshot().run.status).toBe('cancelling');
    expect(scripts[0]!.cancels).toBe(1);
    scripts[0]!.runs[0]!.resolve({
      ok: false,
      cancelled: true,
      error: { messageKey: 'executor.error.cancelled', params: {} },
    });
    await running;
    await cancelling;
    expect(store.getSnapshot().run.status).toBe('cancelled');
    expect(engine.instances).toHaveLength(1);
    expect(store.getSnapshot().restoring).toBe(false);
    expect(readiness(store.getSnapshot()).canRun).toBe(true);
  });

  it('stuck worker: terminated after the grace period, flow + files re-sent, late answer ignored', async () => {
    const store = await readyStore();
    void store.run();
    const cancelling = store.cancel();
    await until(() => engine.instances.length === 2, 3_000);
    expect(store.getSnapshot().run.status).toBe('cancelled');
    expect(store.getSnapshot().restoring).toBe(true);
    expect(readiness(store.getSnapshot()).canRun).toBe(false);

    // The old worker's run "finishes" late: must not flip the state to done.
    scripts[0]!.runs[0]!.resolve({ ok: true, summary: {} as never });

    await until(() => scripts[1]!.validations.length === 2);
    expect(scripts[1]!.loads).toBe(1);
    expect(scripts[1]!.validations.map((v) => v.names)).toEqual([['a.xlsx'], ['b.xlsx']]);
    for (const v of scripts[1]!.validations) v.d.resolve(okReport(v.slot, 1));
    await cancelling;
    const s = store.getSnapshot();
    expect(s.restoring).toBe(false);
    expect(s.run.status).toBe('cancelled');
    expect(readiness(s).canRun).toBe(true);

    // A new run goes to the new worker and completes.
    const again = store.run();
    expect(scripts[1]!.runs).toHaveLength(1);
    scripts[1]!.runs[0]!.resolve({ ok: true, summary: { compare: null } as never });
    await again;
    expect(store.getSnapshot().run.status).toBe('done');
  });

  it('cancel is ignored when nothing runs; run is ignored while running', async () => {
    const store = await readyStore();
    await store.cancel();
    expect(scripts[0]!.cancels).toBe(0);
    void store.run();
    void store.run();
    expect(scripts[0]!.runs).toHaveLength(1);
  });

  it('worker crash during run → failed with the generic engineCrashed message, no raw text', async () => {
    const store = await readyStore();
    scripts[0]!.api.run = () => Promise.reject(new Error('worker died NV00001'));
    await store.run();
    expect(store.getSnapshot().run.status).toBe('failed');
    expect(store.getSnapshot().run.error).toEqual({
      messageKey: 'executor.error.engineCrashed',
      params: {},
    });
    expect(JSON.stringify(store.getSnapshot())).not.toContain('worker died');
  });

  it('setSlotFiles rejection marks the slot failed and counts as an error', async () => {
    const store = new RunStore(source);
    await store.open('payroll-timesheet');
    scripts[0]!.api.setSlotFiles = () => Promise.reject(new Error('read failed'));
    store.addFiles('bang_luong', [new File(['x'], 'x.xlsx')]);
    await until(() => store.getSnapshot().slots.bang_luong!.failed);
    expect(readiness(store.getSnapshot()).errors).toBe(1);
  });

  it('files changed while running do not reset the running state', async () => {
    const store = await readyStore();
    void store.run();
    store.addFiles('bang_luong', [new File(['c'], 'c.xlsx')]);
    expect(store.getSnapshot().run.status).toBe('running');
  });
});

describe('RunStore: overlapping slot updates (worker cache must match the UI)', () => {
  beforeEach(() => {
    engine.factory = realApi;
  });

  /** A File whose bytes become readable only when `release()` is called. */
  function slowFile(from: File) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const file = new (class extends File {
      override arrayBuffer() {
        return gate.then(() => from.arrayBuffer());
      }
    })([from], from.name);
    return { file, release };
  }

  it('add (slow) then remove: the late read does not resurrect the removed file in the worker', async () => {
    const store = new RunStore(source);
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2026-09');
    store.addFiles('cham_cong', fixtureFiles('cham_cong_'));
    const slow = slowFile(fixtureFiles('bang_luong_CN01')[0]!);
    store.addFiles('bang_luong', [slow.file]);
    const id = store.getSnapshot().slots.bang_luong!.files[0]!.id;
    store.removeFile('bang_luong', id);
    await until(() => !store.getSnapshot().slots.cham_cong!.validating);
    slow.release();
    await new Promise((r) => setTimeout(r, 50));

    const s = store.getSnapshot();
    expect(s.slots.bang_luong!.files).toEqual([]);
    expect(s.slots.bang_luong!.validation).toBeNull();
    // The worker must agree: running directly on it fails on the empty payroll slot.
    const api = engine.instances[0]!.api as FakeApi;
    const outcome = await api.run({ ky_luong: '2026-09' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.nodeId).toBe('in_luong');
  });

  it('replace (slow old set, fast new set): the newer files win in UI and worker', async () => {
    const store = new RunStore(source);
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2026-09');
    store.addFiles('cham_cong', fixtureFiles('cham_cong_'));
    const slow = slowFile(fixtureFiles('bang_luong_CN01')[0]!);
    store.addFiles('bang_luong', [slow.file]); // v1: CN01 only (slow)
    store.addFiles('bang_luong', fixtureFiles('bang_luong_C')); // v2: CN01 (replaced) + CN02 + CN03
    await until(() => readiness(store.getSnapshot()).canRun);
    expect(store.getSnapshot().slots.bang_luong!.validation?.rowCount).toBe(75);
    slow.release();
    await new Promise((r) => setTimeout(r, 50));
    expect(store.getSnapshot().slots.bang_luong!.validation?.rowCount).toBe(75);
    await store.run();
    expect(store.getSnapshot().run.summary?.inputs[0]).toMatchObject({ rows: 75 });
  });
});

describe('RunStore: stale replies, cancel timing and restore', () => {
  let scripts: Script[];
  beforeEach(() => {
    scripts = [];
    engine.factory = scriptedApi(scripts);
  });

  async function readyStore() {
    const store = new RunStore(source);
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2026-09');
    store.addFiles('bang_luong', [new File(['a'], 'a.xlsx')]);
    store.addFiles('cham_cong', [new File(['b'], 'b.xlsx')]);
    for (const v of scripts[0]!.validations) v.d.resolve(okReport(v.slot, 1));
    await until(() => readiness(store.getSnapshot()).canRun);
    return store;
  }

  it('passes a growing version per slot; a superseded (null) worker reply is ignored', async () => {
    const versions: (number | undefined)[] = [];
    const store = new RunStore(source);
    await store.open('payroll-timesheet');
    const api = scripts[0]!.api;
    const original = api.setSlotFiles;
    api.setSlotFiles = (slot, files, version) => {
      versions.push(version);
      return original(slot, files, version);
    };
    store.addFiles('bang_luong', [new File(['a'], 'a.xlsx')]);
    store.addFiles('bang_luong', [new File(['b'], 'b.xlsx')]);
    expect(versions).toEqual([1, 2]);
    const [older, newer] = scripts[0]!.validations;
    older!.d.resolve(null as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(store.getSnapshot().slots.bang_luong!.validating).toBe(true);
    newer!.d.resolve(okReport('bang_luong', 2));
    await until(() => !store.getSnapshot().slots.bang_luong!.validating);
    expect(store.getSnapshot().slots.bang_luong!.validation?.rowCount).toBe(2);
  });

  it('cancel pressed but the run finishes (ok) inside the grace period → done, no restart', async () => {
    const store = await readyStore();
    const running = store.run();
    const cancelling = store.cancel();
    scripts[0]!.runs[0]!.resolve({ ok: true, summary: { compare: null } as never });
    await running;
    await cancelling;
    expect(store.getSnapshot().run.status).toBe('done');
    expect(engine.instances).toHaveLength(1);
  });

  it('after the grace period: a late "cancelled" answer from the old worker changes nothing', async () => {
    const store = await readyStore();
    void store.run();
    const cancelling = store.cancel();
    await until(() => engine.instances.length === 2, 3_000);
    scripts[0]!.runs[0]!.resolve({
      ok: false,
      cancelled: true,
      error: { messageKey: 'executor.error.cancelled', params: {} },
    });
    // A late validation answer from the old worker must not touch the slot either.
    scripts[0]!.validations[0]!.d.resolve(okReport('bang_luong', 999));
    await until(() => scripts[1]!.validations.length === 2);
    for (const v of scripts[1]!.validations) v.d.resolve(okReport(v.slot, 1));
    await cancelling;
    const s = store.getSnapshot();
    expect(s.run.status).toBe('cancelled');
    expect(s.slots.bang_luong!.validation?.rowCount).toBe(1);
    expect(readiness(s).canRun).toBe(true);
  });

  it('restore failure (loadFlow rejects): restoreFailed, restoring reset, cancel() resolves; retry recovers', async () => {
    const store = await readyStore();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const base = engine.factory!;
      let n = 0;
      engine.factory = () => {
        const api = base() as FakeApi;
        if (n++ === 0) api.loadFlow = () => Promise.reject(new Error('boom'));
        return api;
      };
      void store.run();
      await expect(store.cancel()).resolves.toBeUndefined();
      let s = store.getSnapshot();
      expect(s.restoring).toBe(false);
      expect(s.restoreFailed).toBe(true);
      expect(s.run.status).toBe('cancelled');
      expect(readiness(s).canRun).toBe(false);

      const retry = store.retryRestore();
      expect(store.getSnapshot().restoring).toBe(true);
      await until(() => scripts.at(-1)!.validations.length === 2);
      for (const v of scripts.at(-1)!.validations) v.d.resolve(okReport(v.slot, 1));
      await retry;
      s = store.getSnapshot();
      expect(s.restoreFailed).toBe(false);
      expect(s.restoring).toBe(false);
      expect(readiness(s).canRun).toBe(true);
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('restore failure (flow rejected by the fresh worker) also ends in restoreFailed', async () => {
    const store = await readyStore();
    const base = engine.factory!;
    engine.factory = () => {
      const api = base() as FakeApi;
      api.loadFlow = () => Promise.resolve({ ok: false, problems: ['x'] });
      return api;
    };
    void store.run();
    await store.cancel();
    expect(store.getSnapshot()).toMatchObject({ restoring: false, restoreFailed: true });
  });

  it('cancel does not leak a rejection when the worker cancel call fails', async () => {
    const store = await readyStore();
    scripts[0]!.api.cancel = () => Promise.reject(new Error('dead'));
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const running = store.run();
      const cancelling = store.cancel();
      scripts[0]!.runs[0]!.resolve({
        ok: false,
        cancelled: true,
        error: { messageKey: 'executor.error.cancelled', params: {} },
      });
      await running;
      await cancelling;
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
      expect(store.getSnapshot().run.status).toBe('cancelled');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('RunStore: restore treats a crashed slot re-validation as restoreFailed (reviewer MINOR b)', () => {
  let scripts: Script[];
  beforeEach(() => {
    scripts = [];
    engine.factory = scriptedApi(scripts);
  });

  it('fresh worker loads the flow but setSlotFiles rejects → restoreFailed', async () => {
    const store = new RunStore(source);
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2026-09');
    store.addFiles('bang_luong', [new File(['a'], 'a.xlsx')]);
    store.addFiles('cham_cong', [new File(['b'], 'b.xlsx')]);
    for (const v of scripts[0]!.validations) v.d.resolve(okReport(v.slot, 1));
    await until(() => readiness(store.getSnapshot()).canRun);

    void store.run();
    const cancelling = store.cancel();
    await until(() => scripts.length === 2 && scripts[1]!.validations.length === 2, 3_000);
    scripts[1]!.validations[0]!.d.resolve(okReport('bang_luong', 1));
    scripts[1]!.validations[1]!.d.reject(new Error('worker crashed'));
    await cancelling;
    const s = store.getSnapshot();
    expect(s.restoreFailed).toBe(true);
    expect(s.restoring).toBe(false);
    expect(readiness(s).canRun).toBe(false);
  });
});

describe('RunStore: version by as-of date and run logging (Supabase source)', () => {
  let scripts: Script[];
  beforeEach(() => {
    scripts = [];
    engine.factory = scriptedApi(scripts);
  });

  type Version = { id: string; no: number; from: string; to: string | null };
  const V1: Version = { id: 'v1', no: 1, from: '2026-01-01', to: '2026-09-01' };
  const V2: Version = { id: 'v2', no: 2, from: '2026-09-01', to: null };

  /** Fake Supabase source: v1 until 2026-08-31, v2 from 2026-09-01; v2 renames slot labels. */
  function versionedSource(calls: string[], fail = { on: '' }): FlowSource {
    const pick = (asOf: string) => (asOf >= V2.from ? V2 : asOf >= V1.from ? V1 : null);
    return {
      list: () => Promise.resolve([]),
      get: (code, asOf) => {
        calls.push(asOf);
        if (asOf === fail.on) return Promise.reject(new Error('offline'));
        if (code !== 'payroll-timesheet') return Promise.resolve(null);
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

  it('opens with today, re-resolves when the period changes, reloads a different version and keeps files', async () => {
    const calls: string[] = [];
    const store = new RunStore(versionedSource(calls), { today: () => '2026-10-26' });
    await store.open('payroll-timesheet');
    expect(calls).toEqual(['2026-10-26']);
    expect(store.getSnapshot()).toMatchObject({ versionCheck: 'ok', version: { id: 'v2' } });

    store.addFiles('bang_luong', [new File(['a'], 'a.xlsx')]);
    for (const v of scripts[0]!.validations) v.d.resolve(okReport(v.slot, 1));

    // Same version for 09/2026: no reload.
    store.setParam('ky_luong', '2026-09');
    await until(() => store.getSnapshot().versionCheck === 'ok' && calls.length === 2);
    expect(calls[1]).toBe('2026-09-01');
    expect(scripts[0]!.loads).toBe(1);

    // 08/2026 → v1: definition reloaded in the worker, the picked file is re-validated.
    store.setParam('ky_luong', '2026-08');
    expect(store.getSnapshot().versionCheck).toBe('resolving');
    expect(readiness(store.getSnapshot()).canRun).toBe(false);
    await until(() => scripts[0]!.loads === 2);
    await until(() => scripts[0]!.validations.length === 2);
    const s = store.getSnapshot();
    expect(s.version).toMatchObject({ id: 'v1', versionNo: 1 });
    expect(s.flow?.inputSlots[0]?.label).toBe('Bảng lương (v1)');
    expect(s.params.ky_luong).toBe('2026-08');
    expect(s.slots.bang_luong!.files.map((f) => f.file.name)).toEqual(['a.xlsx']);
    expect(scripts[0]!.validations[1]!.names).toEqual(['a.xlsx']);
  });

  it('no version for the period → "none" blocks Run; network error → "error", retry recovers', async () => {
    const calls: string[] = [];
    const fail = { on: '2026-07-01' };
    const store = new RunStore(versionedSource(calls, fail), { today: () => '2026-10-26' });
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2025-03');
    await until(() => store.getSnapshot().versionCheck === 'none');
    expect(readiness(store.getSnapshot())).toMatchObject({ canRun: false, versionBlocked: true });

    store.setParam('ky_luong', '2026-07');
    await until(() => store.getSnapshot().versionCheck === 'error');
    fail.on = '';
    store.retryVersion();
    await until(() => store.getSnapshot().versionCheck === 'ok');
    expect(store.getSnapshot().version?.id).toBe('v1');
  });

  it('open() failing on the network → load "error" (not "not found"); open again retries', async () => {
    let offline = true;
    const src: FlowSource = {
      list: () => Promise.resolve([]),
      get: (code, asOf) =>
        offline ? Promise.reject(new Error('offline')) : versionedSource([]).get(code, asOf),
    };
    const store = new RunStore(src, { today: () => '2026-10-26' });
    await store.open('payroll-timesheet');
    expect(store.getSnapshot().load).toBe('error');
    offline = false;
    await store.open('payroll-timesheet');
    expect(store.getSnapshot().load).toBe('ready');
  });

  it('logs each run once with metadata only (succeeded, failed, hard-cancelled); logger failures are ignored', async () => {
    const logged: RunLogInsert[] = [];
    let failLogger = false;
    const logger: RunLogger = {
      logRun: (e) => {
        if (failLogger) return Promise.reject(new Error('insert failed'));
        logged.push(e);
        return Promise.resolve();
      },
    };
    const store = new RunStore(versionedSource([]), { logger, today: () => '2026-10-26' });
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2026-09');
    await until(() => store.getSnapshot().versionCheck === 'ok');
    store.addFiles('bang_luong', [new File(['NV00001;Nguyễn Văn A'], 'Luong_Nguyễn Văn A.xlsx')]);
    store.addFiles('cham_cong', [new File(['b'], 'cc.xlsx')]);
    for (const v of scripts[0]!.validations) v.d.resolve(okReport(v.slot, 3));
    await until(() => readiness(store.getSnapshot()).canRun);

    const r1 = store.run();
    scripts[0]!.runs[0]!.resolve({
      ok: true,
      summary: {
        durationMs: 42,
        sheets: [{ rowCount: 5 }, { rowCount: 2 }],
        compare: null,
      } as never,
    });
    await r1;
    await until(() => logged.length === 1);
    expect(logged[0]).toMatchObject({
      flow_version_id: 'v2',
      params: { ky_luong: '2026-09' },
      status: 'succeeded',
      duration_ms: 42,
      rows_out: 7,
      error_code: null,
    });
    expect(logged[0]!.inputs_meta).toEqual([
      {
        slot: 'bang_luong',
        rows: 3,
        files: [
          {
            sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
            size: new Blob(['NV00001;Nguyễn Văn A']).size,
          },
        ],
      },
      {
        slot: 'cham_cong',
        rows: 3,
        files: [{ sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string, size: 1 }],
      },
    ]);
    expect(JSON.stringify(logged)).not.toMatch(/Nguyễn|NV00001|Luong_/);

    store.resetRun();
    const r2 = store.run();
    scripts[0]!.runs[1]!.resolve({
      ok: false,
      cancelled: false,
      error: { messageKey: 'compare.error.x', params: { value: 'NV00001' }, nodeId: 'cmp' },
    });
    await r2;
    await until(() => logged.length === 2);
    expect(logged[1]).toMatchObject({
      status: 'failed',
      error_code: 'compare.error.x',
      error_node_id: 'cmp',
    });
    expect(JSON.stringify(logged[1])).not.toContain('NV00001');

    // Hard cancel: logged as cancelled exactly once, even though the old run promise rejects later.
    store.resetRun();
    void store.run();
    const cancelling = store.cancel();
    await until(() => scripts.length === 2 && scripts[1]!.validations.length === 2, 3_000);
    for (const v of scripts[1]!.validations) v.d.resolve(okReport(v.slot, 3));
    await cancelling;
    await until(() => logged.length === 3);
    expect(logged[2]).toMatchObject({ status: 'cancelled', rows_out: null });
    await new Promise((r) => setTimeout(r, 20));
    expect(logged).toHaveLength(3);

    // A failing logger never breaks the run.
    failLogger = true;
    store.resetRun();
    const r4 = store.run();
    scripts[1]!.runs[0]!.resolve({
      ok: true,
      summary: { durationMs: 1, sheets: [], compare: null } as never,
    });
    await r4;
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getSnapshot().run.status).toBe('done');
  });

  it('bundled flows (no version) are not logged', async () => {
    const logRun = vi.fn(() => Promise.resolve());
    const store = new RunStore(source, { logger: { logRun } });
    await store.open('payroll-timesheet');
    store.setParam('ky_luong', '2026-09');
    store.addFiles('bang_luong', [new File(['a'], 'a.xlsx')]);
    store.addFiles('cham_cong', [new File(['b'], 'b.xlsx')]);
    for (const v of scripts[0]!.validations) v.d.resolve(okReport(v.slot, 1));
    await until(() => readiness(store.getSnapshot()).canRun);
    const r = store.run();
    scripts[0]!.runs[0]!.resolve({
      ok: true,
      summary: { durationMs: 1, sheets: [], compare: null } as never,
    });
    await r;
    await new Promise((res) => setTimeout(res, 20));
    expect(logRun).not.toHaveBeenCalled();
  });
});
