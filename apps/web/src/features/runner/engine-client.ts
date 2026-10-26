import * as Comlink from 'comlink';
import type { EngineApi } from '../../engine/worker';

/**
 * Main-thread handle on the engine worker. The worker module (engine + SheetJS + ExcelJS) is a
 * separate chunk loaded only when the first flow is opened.
 */
export class EngineClient {
  private worker!: Worker;
  private remote!: Comlink.Remote<EngineApi>;

  constructor() {
    this.spawn();
  }

  private spawn(): void {
    this.worker = new Worker(new URL('../../engine/worker.ts', import.meta.url), {
      type: 'module',
      name: 'hrflow-engine',
    });
    this.remote = Comlink.wrap<EngineApi>(this.worker);
  }

  get api(): Comlink.Remote<EngineApi> {
    return this.remote;
  }

  /**
   * Hard stop (spec §13: cancel = terminate the worker). Pending calls on the old worker never
   * settle; callers must ignore them and re-send flow + files to the fresh worker.
   */
  restart(): void {
    this.remote[Comlink.releaseProxy]();
    this.worker.terminate();
    this.spawn();
  }

  dispose(): void {
    this.remote[Comlink.releaseProxy]();
    this.worker.terminate();
  }
}

export { Comlink };
