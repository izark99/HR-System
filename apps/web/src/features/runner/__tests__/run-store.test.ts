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
import type { FlowSource } from '../flow-source';

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
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
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
