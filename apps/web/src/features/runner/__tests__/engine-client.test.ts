/**
 * EngineClient with a MessagePort-backed fake worker (Comlink on both ends, no real Worker):
 * pending calls are rejected on restart, progress arrives on an owned port that is closed.
 */
import * as Comlink from 'comlink';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunOutcome, RunProgressEvent } from '../../../engine/protocol';
import { isEngineBusy } from '../../auth/idle/activity';
import {
  disposeAllEngines,
  EngineClient,
  EngineCrashedError,
  EngineRestartedError,
  type WorkerLike,
} from '../engine-client';

interface FakeWorker {
  /** Settle the pending `run` of this worker. */
  finishRun: (o: RunOutcome) => void;
  progress: MessagePort | null;
  terminated: boolean;
}

const workers: FakeWorker[] = [];
const clients: EngineClient[] = [];

function fakeWorker(): WorkerLike {
  const { port1, port2 } = new MessageChannel();
  const state: FakeWorker = { finishRun: () => undefined, progress: null, terminated: false };
  workers.push(state);
  Comlink.expose(
    {
      loadFlow: () => new Promise(() => undefined), // never settles (stuck worker)
      cancel: () => undefined,
      run: (_params: unknown, progress?: MessagePort) =>
        new Promise<RunOutcome>((resolve) => {
          state.progress = progress ?? null;
          state.finishRun = (o) => {
            progress?.close();
            resolve(o);
          };
        }),
    },
    port2,
  );
  const ep = port1 as unknown as Comlink.Endpoint;
  return Object.assign(ep, {
    terminate: () => {
      state.terminated = true;
      port1.close();
      port2.close();
    },
  });
}

function client(): EngineClient {
  const c = new EngineClient(fakeWorker);
  clients.push(c);
  return c;
}

afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
  workers.length = 0;
});

const until = async (pred: () => boolean) => {
  const end = Date.now() + 2_000;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('EngineClient', () => {
  it('rejects calls still pending on the old worker when it is restarted', async () => {
    const c = client();
    const pending = c.api.loadFlow({});
    c.restart();
    await expect(pending).rejects.toBeInstanceOf(EngineRestartedError);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });

  it('dispose also rejects pending calls', async () => {
    const c = new EngineClient(fakeWorker);
    const pending = c.api.loadFlow({});
    c.dispose();
    await expect(pending).rejects.toBeInstanceOf(EngineRestartedError);
  });

  it('delivers progress on a dedicated port and resolves the run', async () => {
    const c = client();
    const events: RunProgressEvent[] = [];
    const run = c.run({}, (e) => events.push(e));
    await until(() => workers[0]!.progress !== null);
    workers[0]!.progress!.postMessage({ type: 'node-started', nodeId: 'a', index: 0, total: 1 });
    await until(() => events.length === 1);
    workers[0]!.finishRun({
      ok: false,
      cancelled: true,
      error: { messageKey: 'executor.error.cancelled', params: {} },
    });
    await expect(run).resolves.toMatchObject({ ok: false, cancelled: true });
    expect(events).toEqual([{ type: 'node-started', nodeId: 'a', index: 0, total: 1 }]);
  });

  it('on restart the pending run rejects and late progress is not delivered', async () => {
    const c = client();
    const events: RunProgressEvent[] = [];
    const run = c.run({}, (e) => events.push(e));
    await until(() => workers[0]!.progress !== null);
    const oldPort = workers[0]!.progress!;
    c.restart();
    await expect(run).rejects.toBeInstanceOf(EngineRestartedError);
    oldPort.postMessage({ type: 'node-started', nodeId: 'late', index: 0, total: 1 });
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual([]);
  });

  it('a pending call counts as engine work (idle countdown paused) until it settles or is abandoned', async () => {
    const c = client();
    expect(isEngineBusy()).toBe(false);
    const run = c.run({}, () => undefined);
    await until(() => workers[0]!.progress !== null);
    expect(isEngineBusy()).toBe(true);
    workers[0]!.finishRun({ ok: true, summary: {} as never });
    await run;
    expect(isEngineBusy()).toBe(false);

    const stuck = c.api.loadFlow({});
    expect(isEngineBusy()).toBe(true);
    c.restart();
    await expect(stuck).rejects.toBeInstanceOf(EngineRestartedError);
    expect(isEngineBusy()).toBe(false);
  });

  it('disposeAllEngines terminates every live worker (forced sign-out)', async () => {
    const a = client();
    client();
    const pending = a.api.loadFlow({});
    disposeAllEngines();
    await expect(pending).rejects.toBeInstanceOf(EngineRestartedError);
    expect(workers.every((w) => w.terminated)).toBe(true);
    expect(isEngineBusy()).toBe(false);
  });

  it('the api handle is not thenable (safe to return from async functions)', async () => {
    const c = client();
    expect((c.api as unknown as { then?: unknown }).then).toBeUndefined();
    const same = await Promise.resolve(c.api);
    expect(same).toBe(c.api);
  });
});

// Fixed (was KNOWN BUG): a worker that dies (uncaught error / out of memory) raises `error` on the
// Worker; pending calls used to never settle, so the engine counted as busy forever and the
// 8-hour auto sign-out (paused while the engine is busy) never happened.
describe('fixed bugs (were KNOWN BUGS): dead worker', () => {
  it('a worker `error` event rejects pending calls and releases the idle pause', async () => {
    let endpoint!: MessagePort;
    const c = new EngineClient(() => {
      const w = fakeWorker();
      endpoint = w as unknown as MessagePort;
      return w;
    });
    clients.push(c);
    const call = c.api.loadFlow({}).then(
      () => 'resolved',
      () => 'rejected',
    );
    await until(() => isEngineBusy());
    endpoint.dispatchEvent(new Event('error'));
    const outcome = await Promise.race([
      call,
      new Promise((r) => setTimeout(() => r('still pending'), 300)),
    ]);
    expect(outcome).toBe('rejected');
    expect(isEngineBusy()).toBe(false);
  });

  it('after a crash later calls fail fast with EngineCrashedError; restart() recovers', async () => {
    let endpoint!: MessagePort;
    const c = new EngineClient(() => {
      const w = fakeWorker();
      endpoint = w as unknown as MessagePort;
      return w;
    });
    clients.push(c);
    const pending = c.api.loadFlow({});
    endpoint.dispatchEvent(new Event('messageerror'));
    await expect(pending).rejects.toBeInstanceOf(EngineCrashedError);
    await expect(c.api.cancel()).rejects.toBeInstanceOf(EngineCrashedError);
    expect(isEngineBusy()).toBe(false);
    c.restart();
    await expect(c.api.cancel()).resolves.toBeUndefined();
  });
});
