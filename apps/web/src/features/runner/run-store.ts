import type { FlowDefinition } from '@hrflow/flow-schema';
import type {
  EngineErrorInfo,
  FilterOption,
  ParamValues,
  RowQuery,
  RowPage,
  RunProgressEvent,
  RunSummary,
  SlotValidation,
} from '../../engine/protocol';
import { saveFile } from '../../lib/download';
import { Comlink, EngineClient } from './engine-client';
import type { FlowSource, FlowSummary } from './flow-source';

/**
 * State of the run wizard for the open flow. Files stay as `File` handles on the main thread
 * (needed to re-send them after a hard cancel); their content is only ever read in the worker.
 */

export interface SlotFile {
  id: number;
  file: File;
}

export interface SlotState {
  files: SlotFile[];
  validating: boolean;
  validation: SlotValidation | null;
  failed: boolean;
}

export interface NodeProgress {
  id: string;
  type: string;
  label: string;
  status: 'pending' | 'running' | 'done';
  rows: Record<string, number> | null;
  durationMs: number | null;
}

export type RunStatus = 'idle' | 'running' | 'cancelling' | 'done' | 'failed' | 'cancelled';

export interface RunState {
  status: RunStatus;
  nodes: NodeProgress[];
  error: EngineErrorInfo | null;
  summary: RunSummary | null;
  /** Params used by the run (the form may change afterwards). */
  params: ParamValues;
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'notFound' | 'invalid';

export interface SessionState {
  code: string | null;
  load: LoadStatus;
  problems: string[];
  summary: FlowSummary | null;
  flow: FlowDefinition | null;
  params: ParamValues;
  slots: Record<string, SlotState>;
  run: RunState;
  /** Re-sending files to a fresh worker after a hard cancel. */
  restoring: boolean;
}

const IDLE_RUN: RunState = { status: 'idle', nodes: [], error: null, summary: null, params: {} };

const INITIAL: SessionState = {
  code: null,
  load: 'idle',
  problems: [],
  summary: null,
  flow: null,
  params: {},
  slots: {},
  run: IDLE_RUN,
  restoring: false,
};

/** Grace period for a cooperative cancel before the worker is terminated. */
const CANCEL_GRACE_MS = 400;

export class RunStore {
  private state: SessionState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private client: EngineClient | null = null;
  private definition: unknown = null;
  private nextFileId = 1;
  /** Bumped by every open/run/restart; late worker answers with an old token are dropped. */
  private token = 0;
  private readonly slotVersions = new Map<string, number>();

  constructor(readonly source: FlowSource) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionState => this.state;

  private set(update: (s: SessionState) => SessionState): void {
    this.state = update(this.state);
    for (const l of this.listeners) l();
  }

  private patchSlot(key: string, patch: Partial<SlotState>): void {
    this.set((s) => {
      const slot = s.slots[key];
      return slot ? { ...s, slots: { ...s.slots, [key]: { ...slot, ...patch } } } : s;
    });
  }

  private engine(): EngineClient {
    this.client ??= new EngineClient();
    return this.client;
  }

  async open(code: string): Promise<void> {
    if (this.state.code === code && this.state.load !== 'idle') return;
    const token = ++this.token;
    this.set(() => ({ ...INITIAL, code, load: 'loading' }));
    const loaded = await this.source.get(code);
    if (token !== this.token) return;
    if (!loaded) {
      this.set((s) => ({ ...s, load: 'notFound' }));
      return;
    }
    this.definition = loaded.definition;
    const result = await this.engine().api.loadFlow(loaded.definition);
    if (token !== this.token) return;
    if (!result.ok) {
      this.set((s) => ({
        ...s,
        load: 'invalid',
        summary: loaded.summary,
        problems: result.problems,
      }));
      return;
    }
    const slots: Record<string, SlotState> = {};
    for (const slot of result.flow.inputSlots) {
      slots[slot.key] = { files: [], validating: false, validation: null, failed: false };
    }
    this.set((s) => ({
      ...s,
      load: 'ready',
      summary: loaded.summary,
      flow: result.flow,
      slots,
      params: Object.fromEntries(result.flow.params.map((p) => [p.key, ''])),
    }));
  }

  setParam(key: string, value: string): void {
    this.set((s) => ({ ...s, params: { ...s.params, [key]: value } }));
  }

  addFiles(slotKey: string, files: readonly File[]): void {
    const slot = this.state.slots[slotKey];
    if (!slot || files.length === 0) return;
    const multiple = this.state.flow?.inputSlots.find((s) => s.key === slotKey)?.multiple.enabled;
    // Same name = the User re-picked a corrected file: replace it.
    const incoming = files.map((file) => ({ id: this.nextFileId++, file }));
    const names = new Set(files.map((f) => f.name));
    const kept = multiple ? slot.files.filter((f) => !names.has(f.file.name)) : [];
    this.patchSlot(slotKey, { files: [...kept, ...(multiple ? incoming : incoming.slice(-1))] });
    this.filesChanged(slotKey);
  }

  removeFile(slotKey: string, id: number): void {
    const slot = this.state.slots[slotKey];
    if (!slot) return;
    this.patchSlot(slotKey, { files: slot.files.filter((f) => f.id !== id) });
    this.filesChanged(slotKey);
  }

  /** New files invalidate the previous result. */
  private filesChanged(slotKey: string): void {
    if (this.state.run.status !== 'running' && this.state.run.status !== 'cancelling') {
      this.set((s) => ({ ...s, run: IDLE_RUN }));
    }
    void this.validateSlot(slotKey);
  }

  private async validateSlot(slotKey: string): Promise<void> {
    const slot = this.state.slots[slotKey];
    if (!slot) return;
    const version = (this.slotVersions.get(slotKey) ?? 0) + 1;
    this.slotVersions.set(slotKey, version);
    const token = this.token;
    if (slot.files.length === 0) {
      this.patchSlot(slotKey, { validating: false, validation: null, failed: false });
      await this.engine().api.setSlotFiles(slotKey, []);
      return;
    }
    this.patchSlot(slotKey, { validating: true, failed: false });
    try {
      const validation = await this.engine().api.setSlotFiles(
        slotKey,
        slot.files.map((f) => ({ name: f.file.name, blob: f.file })),
      );
      if (token !== this.token || this.slotVersions.get(slotKey) !== version) return;
      this.patchSlot(slotKey, { validating: false, validation });
    } catch {
      if (token !== this.token || this.slotVersions.get(slotKey) !== version) return;
      this.patchSlot(slotKey, { validating: false, validation: null, failed: true });
    }
  }

  async run(): Promise<void> {
    const flow = this.state.flow;
    if (!flow || this.state.run.status === 'running' || this.state.run.status === 'cancelling') {
      return;
    }
    const token = ++this.token;
    const params = { ...this.state.params };
    const nodes: NodeProgress[] = flow.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label ?? n.id,
      status: 'pending',
      rows: null,
      durationMs: null,
    }));
    this.set((s) => ({
      ...s,
      run: { status: 'running', nodes, error: null, summary: null, params },
    }));

    const onProgress = (e: RunProgressEvent) => {
      if (token !== this.token || e.type === 'run-started') return;
      this.set((s) => ({
        ...s,
        run: {
          ...s.run,
          nodes: s.run.nodes.map((n) =>
            n.id !== e.nodeId
              ? n
              : e.type === 'node-started'
                ? { ...n, status: 'running' }
                : { ...n, status: 'done', rows: e.rows, durationMs: e.durationMs },
          ),
        },
      }));
    };

    try {
      const outcome = await this.engine().api.run(params, Comlink.proxy(onProgress));
      if (token !== this.token) return;
      this.set((s) => ({
        ...s,
        run: outcome.ok
          ? { ...s.run, status: 'done', summary: outcome.summary }
          : { ...s.run, status: outcome.cancelled ? 'cancelled' : 'failed', error: outcome.error },
      }));
    } catch {
      if (token !== this.token) return;
      this.set((s) => ({
        ...s,
        run: {
          ...s.run,
          status: 'failed',
          error: { messageKey: 'executor.error.nodeFailed', params: { node: '', message: '' } },
        },
      }));
    }
  }

  /** Cooperative cancel first; if the worker is stuck in synchronous work, terminate it. */
  async cancel(): Promise<void> {
    if (this.state.run.status !== 'running') return;
    const token = this.token;
    this.set((s) => ({ ...s, run: { ...s.run, status: 'cancelling' } }));
    void this.engine().api.cancel();
    await new Promise((r) => setTimeout(r, CANCEL_GRACE_MS));
    // Re-read: the run may have settled (as cancelled) during the grace period.
    const status: RunStatus = this.getSnapshot().run.status;
    if (token !== this.token || status !== 'cancelling') return;

    this.token++;
    this.engine().restart();
    this.set((s) => ({ ...s, run: { ...s.run, status: 'cancelled' }, restoring: true }));
    await this.restore();
  }

  /** Re-send the flow and files to a fresh worker (after a hard cancel). */
  private async restore(): Promise<void> {
    const token = this.token;
    await this.engine().api.loadFlow(this.definition);
    await Promise.all(Object.keys(this.state.slots).map((k) => this.validateSlot(k)));
    if (token === this.token) this.set((s) => ({ ...s, restoring: false }));
  }

  /** Back to the wizard (files and validation are kept). */
  resetRun(): void {
    if (this.state.run.status === 'running' || this.state.run.status === 'cancelling') return;
    this.set((s) => ({ ...s, run: IDLE_RUN }));
  }

  getRows(sheetId: string, query: RowQuery): Promise<RowPage> {
    return this.engine().api.getRows(sheetId, query);
  }

  getFilterOptions(sheetId: string): Promise<FilterOption[]> {
    return this.engine().api.getFilterOptions(sheetId);
  }

  async downloadArtifact(index: number): Promise<void> {
    saveFile(await this.engine().api.getArtifact(index));
  }

  async downloadValidationReport(): Promise<void> {
    saveFile(await this.engine().api.validationReportFile());
  }
}
