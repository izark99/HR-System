import * as Comlink from 'comlink';
import type { ParamValues, RunOutcome, RunProgressEvent } from '../../engine/protocol';
import type { EngineApi } from '../../engine/worker';
import { beginEngineWork } from '../auth/idle/activity';

/** Rejection of calls still pending on a worker that was terminated (hard cancel). */
export class EngineRestartedError extends Error {
  constructor() {
    super('engine worker restarted');
    this.name = 'EngineRestartedError';
  }
}

/**
 * The worker died (uncaught error, out of memory, unreadable message). Pending calls reject with
 * this, later calls too until `restart()`; callers show the generic engineCrashed message.
 */
export class EngineCrashedError extends Error {
  constructor() {
    super('engine worker crashed');
    this.name = 'EngineCrashedError';
  }
}

/** Minimal Worker surface (lets tests plug in a MessagePort-backed fake). */
export type WorkerLike = Comlink.Endpoint & { terminate(): void };

function spawnWorker(): WorkerLike {
  return new Worker(new URL('../../engine/worker.ts', import.meta.url), {
    type: 'module',
    name: 'hrflow-engine',
  });
}

type Api = Comlink.Remote<EngineApi>;

/** Every live client, so a forced sign-out can terminate all workers (spec §6.1). */
const liveClients = new Set<EngineClient>();

/** Terminate every engine worker (files, results and samples in their memory are dropped). */
export function disposeAllEngines(): void {
  for (const client of [...liveClients]) client.dispose();
}

/**
 * Main-thread handle on the engine worker. The worker module (engine + SheetJS + ExcelJS) is a
 * separate chunk loaded only when the first flow is opened.
 *
 * Every call through `api` is tracked: on `restart()`/`dispose()` the ones still pending are
 * rejected with `EngineRestartedError` (a terminated worker would otherwise leave them pending
 * forever) and open progress ports are closed. A pending call also counts as engine work for the
 * auto sign-out (the idle countdown is paused meanwhile).
 */
export class EngineClient {
  private worker!: WorkerLike;
  private remote!: Api;
  private readonly pending = new Set<(err: Error) => void>();
  private readonly ports = new Set<MessagePort>();
  private crashed = false;
  readonly api: Api;

  constructor(private readonly createWorker: () => WorkerLike = spawnWorker) {
    this.spawn();
    liveClients.add(this);
    this.api = new Proxy({} as Api, {
      get: (_target, prop) => {
        // `then` must stay undefined or the handle would look like a promise when returned/awaited.
        if (typeof prop !== 'string' || prop === 'then') return undefined;
        return (...args: unknown[]) =>
          this.track(() =>
            (Reflect.get(this.remote, prop) as (...a: unknown[]) => unknown)(...args),
          );
      },
    });
  }

  private spawn(): void {
    const worker = this.createWorker();
    this.worker = worker;
    this.crashed = false;
    this.remote = Comlink.wrap<EngineApi>(worker);
    // Without this a dead worker would leave every pending call (and the engine-busy pause of
    // the auto sign-out) hanging forever. Accepted trade-off (reviewer MINOR): `error` also fires
    // for an uncaught error that did NOT kill the worker; we still treat it as a crash (pending
    // calls fail, the run page restarts the worker). Conservative: a worker in an unknown state
    // is never reused for the User's data.
    const onDeath = () => {
      if (this.worker !== worker) return; // an old, already replaced worker
      this.crashed = true;
      this.abandonPending(new EngineCrashedError());
    };
    worker.addEventListener('error', onDeath);
    worker.addEventListener('messageerror', onDeath);
  }

  private abandonPending(err: Error): void {
    for (const port of [...this.ports]) this.closePort(port);
    const abandoned = [...this.pending];
    this.pending.clear();
    for (const reject of abandoned) reject(err);
  }

  private track<T>(call: () => T | PromiseLike<T>): Promise<T> {
    if (this.crashed) return Promise.reject(new EngineCrashedError());
    return new Promise<T>((resolve, reject) => {
      const endWork = beginEngineWork();
      const abandon = (err: Error) => {
        endWork();
        reject(err);
      };
      this.pending.add(abandon);
      Promise.resolve()
        .then(call)
        .then(
          (v) => {
            this.pending.delete(abandon);
            endWork();
            resolve(v);
          },
          (e: unknown) => {
            this.pending.delete(abandon);
            endWork();
            reject(e instanceof Error ? e : new Error(String(e)));
          },
        );
    });
  }

  /** Run the flow; progress events arrive on a dedicated port closed when the run settles. */
  async run(params: ParamValues, onProgress: (e: RunProgressEvent) => void): Promise<RunOutcome> {
    const { port1, port2 } = new MessageChannel();
    this.ports.add(port1);
    port1.onmessage = (ev: MessageEvent<RunProgressEvent>) => onProgress(ev.data);
    try {
      return await this.api.run(params, Comlink.transfer(port2, [port2]));
    } finally {
      this.closePort(port1);
    }
  }

  private closePort(port: MessagePort): void {
    port.onmessage = null;
    port.close();
    this.ports.delete(port);
  }

  private shutdown(): void {
    this.abandonPending(new EngineRestartedError());
    this.remote[Comlink.releaseProxy]();
    this.worker.terminate();
  }

  /**
   * Hard stop (spec §13: cancel = terminate the worker). Pending calls on the old worker are
   * rejected; callers must re-send flow + files to the fresh worker.
   */
  restart(): void {
    this.shutdown();
    this.spawn();
  }

  dispose(): void {
    if (!liveClients.delete(this)) return;
    this.shutdown();
  }
}
