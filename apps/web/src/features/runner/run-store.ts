import type { FlowDefinition } from '@hrflow/flow-schema';
import {
  ENGINE_CRASHED_KEY,
  type EngineErrorInfo,
  type FilterOption,
  type LoadFlowResult,
  type ParamValues,
  type RowQuery,
  type RowPage,
  type RunProgressEvent,
  type RunSummary,
  type SlotValidation,
} from '../../engine/protocol';
import type { RunLogStatus } from '../../lib/database.types';
import { saveFile } from '../../lib/download';
import { EngineClient } from './engine-client';
import { asOfFromParams, todayIso } from './as-of';
import type { FlowSource, FlowSummary, FlowVersionInfo, LoadedFlow } from './flow-source';
import { buildRunLog, type RunLogger } from './run-log';

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

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'notFound' | 'invalid' | 'error';

/**
 * Version resolution for the as-of date (spec §14.2). `none`: no published version is effective
 * on that date (Run blocked); `error`: the server could not be asked (Run blocked, retry).
 */
export type VersionCheck = 'ok' | 'resolving' | 'none' | 'error';

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
  /** The fresh worker could not be prepared after a hard cancel; the User must retry. */
  restoreFailed: boolean;
  /** As-of date (YYYY-MM-DD) the version was resolved for. */
  asOf: string;
  /** Version in use (null for bundled flows). */
  version: FlowVersionInfo | null;
  versionCheck: VersionCheck;
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
  restoreFailed: false,
  asOf: '',
  version: null,
  versionCheck: 'ok',
};

/**
 * Generic message for unexpected failures (worker crashed / call rejected). The raw exception is
 * never stored: this state feeds the run log, which must stay metadata only.
 */
const ENGINE_CRASHED: EngineErrorInfo = { messageKey: ENGINE_CRASHED_KEY, params: {} };

export interface RunStoreOptions {
  /** Metadata-only run logging (Supabase); absent for bundled flows. */
  logger?: RunLogger | null;
  /** Today as YYYY-MM-DD (injectable for tests). */
  today?: () => string;
}

/** What a run needs for its log entry, captured when it starts. */
interface RunRecord {
  token: number;
  startedAt: number;
  versionId: string | null;
  flow: FlowDefinition;
  params: ParamValues;
  slots: { key: string; files: { name: string; size: number }[]; rows: number | null }[];
  logged: boolean;
}

/** Grace period for a cooperative cancel before the worker is terminated. */
const CANCEL_GRACE_MS = 400;

export class RunStore {
  private state: SessionState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private client: EngineClient | null = null;
  private definition: unknown = null;
  /**
   * Id of the version whose definition is actually loaded in the worker. `state.version` is what
   * the UI shows; the two can differ (e.g. after a period without any version), so reload
   * decisions and the run log use this one.
   */
  private loadedVersionId: string | null = null;
  /** As-of date whose version could not be applied while a run was in progress. */
  private deferredAsOf: string | null = null;
  private nextFileId = 1;
  /** Bumped by every open/run/restart; late worker answers with an old token are dropped. */
  private token = 0;
  private readonly slotVersions = new Map<string, number>();
  /** Bumped by every version resolution; late answers are dropped. */
  private versionToken = 0;
  private currentRun: RunRecord | null = null;
  private readonly logger: RunLogger | null;
  private readonly today: () => string;

  constructor(
    readonly source: FlowSource,
    options: RunStoreOptions = {},
  ) {
    this.logger = options.logger ?? null;
    this.today = options.today ?? (() => todayIso());
  }

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
    if (this.state.code === code && this.state.load !== 'idle' && this.state.load !== 'error') {
      return;
    }
    const token = ++this.token;
    ++this.versionToken;
    const asOf = this.today();
    this.set(() => ({ ...INITIAL, code, load: 'loading', asOf }));
    let loaded: LoadedFlow | null;
    try {
      loaded = await this.source.get(code, asOf);
    } catch {
      if (token === this.token) this.set((s) => ({ ...s, load: 'error' }));
      return;
    }
    if (token !== this.token) return;
    if (!loaded) {
      this.set((s) => ({ ...s, load: 'notFound' }));
      return;
    }
    await this.applyDefinition(loaded, token, {});
  }

  /**
   * Load a definition into the worker and (re)build the wizard state. Files of slots that still
   * exist are kept and re-validated against the new definition; params keep their values.
   */
  private async applyDefinition(
    loaded: LoadedFlow,
    token: number,
    keep: { params?: ParamValues; slots?: Record<string, SlotState> },
  ): Promise<void> {
    this.definition = loaded.definition;
    // Unknown until the worker accepts it.
    this.loadedVersionId = null;
    let result: LoadFlowResult;
    try {
      result = await this.engine().api.loadFlow(loaded.definition);
    } catch {
      if (token === this.token) this.set((s) => ({ ...s, load: 'error' }));
      return;
    }
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
      slots[slot.key] = {
        files: keep.slots?.[slot.key]?.files ?? [],
        validating: false,
        validation: null,
        failed: false,
      };
    }
    const version = loaded.version ?? null;
    this.loadedVersionId = version?.id ?? null;
    this.set((s) => ({
      ...s,
      load: 'ready',
      summary: loaded.summary,
      flow: result.flow,
      slots,
      params: Object.fromEntries(
        result.flow.params.map((p) => [p.key, keep.params?.[p.key] ?? '']),
      ),
      version,
      versionCheck: !version || version.applies ? 'ok' : 'none',
      run: IDLE_RUN,
    }));
    for (const [key, slot] of Object.entries(slots)) {
      if (slot.files.length > 0) void this.validateSlot(key);
    }
  }

  setParam(key: string, value: string): void {
    this.set((s) => ({ ...s, params: { ...s.params, [key]: value } }));
    const { flow, version, asOf } = this.state;
    if (!flow || !version) return;
    const next = asOfFromParams(flow.params, this.state.params, this.today());
    if (next !== asOf || this.state.versionCheck === 'error') void this.resolveVersion(next);
  }

  /** Retry after a failed version lookup. */
  retryVersion(): void {
    if (this.state.versionCheck === 'error') void this.resolveVersion(this.state.asOf);
  }

  /**
   * Re-resolve the published version for a new as-of date (the period param changed). A
   * different effective version replaces the definition in the worker; files are kept.
   */
  private async resolveVersion(asOf: string): Promise<void> {
    const code = this.state.code;
    if (!code) return;
    const vToken = ++this.versionToken;
    const token = this.token;
    this.set((s) => ({ ...s, asOf, versionCheck: 'resolving' }));
    let loaded: LoadedFlow | null;
    try {
      loaded = await this.source.get(code, asOf);
    } catch {
      loaded = null;
    }
    if (vToken !== this.versionToken || token !== this.token) return;
    const next = loaded?.version;
    if (!loaded || !next) {
      this.set((s) => ({ ...s, versionCheck: 'error' }));
      return;
    }
    if (!next.applies) {
      // `version` keeps describing the loaded definition: the server answers with a version that
      // does not apply, and treating it as loaded would skip the reload later (stale definition).
      this.deferredAsOf = null;
      this.set((s) => ({ ...s, versionCheck: 'none' }));
      return;
    }
    if (next.id === this.loadedVersionId) {
      this.deferredAsOf = null;
      this.set((s) => ({ ...s, versionCheck: 'ok', version: next }));
      return;
    }
    if (this.isBusy()) {
      // Cannot swap the definition under a running flow: resolve again once the run settles.
      this.deferredAsOf = asOf;
      return;
    }
    this.deferredAsOf = null;
    // Another version applies: reload it (drops in-flight answers of the old definition).
    const reload = ++this.token;
    this.set((s) => ({ ...s, versionCheck: 'resolving' }));
    await this.applyDefinition(loaded, reload, {
      params: this.state.params,
      slots: this.state.slots,
    });
  }

  private isBusy(): boolean {
    return this.state.run.status === 'running' || this.state.run.status === 'cancelling';
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

  /** Resolves false only when the worker call itself failed (crash), not for invalid files. */
  private async validateSlot(slotKey: string): Promise<boolean> {
    const slot = this.state.slots[slotKey];
    if (!slot) return true;
    // The worker gets the same version and commits only the latest one (calls overlap while file
    // bytes are read), so worker cache and UI agree on which files the slot holds.
    const version = (this.slotVersions.get(slotKey) ?? 0) + 1;
    this.slotVersions.set(slotKey, version);
    const token = this.token;
    const current = () => token === this.token && this.slotVersions.get(slotKey) === version;
    const uploads = slot.files.map((f) => ({ name: f.file.name, blob: f.file }));
    this.patchSlot(slotKey, {
      validating: uploads.length > 0,
      failed: false,
      ...(uploads.length === 0 ? { validation: null } : {}),
    });
    try {
      const validation = await this.engine().api.setSlotFiles(slotKey, uploads, version);
      if (!current() || uploads.length === 0) return true;
      // null = superseded inside the worker; the newer call will report.
      if (validation) this.patchSlot(slotKey, { validating: false, validation });
      return true;
    } catch {
      if (!current()) return false;
      this.patchSlot(slotKey, { validating: false, validation: null, failed: uploads.length > 0 });
      return false;
    }
  }

  async run(): Promise<void> {
    const flow = this.state.flow;
    if (!flow || this.state.run.status === 'running' || this.state.run.status === 'cancelling') {
      return;
    }
    if (this.state.versionCheck !== 'ok') return;
    if ((this.state.version?.id ?? null) !== this.loadedVersionId) return;
    const token = ++this.token;
    const params = { ...this.state.params };
    this.currentRun = {
      token,
      startedAt: Date.now(),
      // What the worker computes with, not what the callout says.
      versionId: this.loadedVersionId,
      flow,
      params,
      slots: flow.inputSlots.map((slot) => {
        const st = this.state.slots[slot.key];
        return {
          key: slot.key,
          files: (st?.files ?? []).map((f) => ({ name: f.file.name, size: f.file.size })),
          rows: st?.validation?.rowCount ?? null,
        };
      }),
      logged: false,
    };
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
      const outcome = await this.engine().run(params, onProgress);
      if (token !== this.token) return;
      this.set((s) => ({
        ...s,
        run: outcome.ok
          ? { ...s.run, status: 'done', summary: outcome.summary }
          : { ...s.run, status: outcome.cancelled ? 'cancelled' : 'failed', error: outcome.error },
      }));
      if (outcome.ok) this.logRun(token, 'succeeded', outcome.summary, null);
      else this.logRun(token, outcome.cancelled ? 'cancelled' : 'failed', null, outcome.error);
    } catch {
      if (token !== this.token) return;
      this.set((s) => ({
        ...s,
        run: {
          ...s.run,
          status: 'failed',
          error: ENGINE_CRASHED,
        },
      }));
      this.logRun(token, 'failed', null, ENGINE_CRASHED);
    }
    this.resolveDeferred();
  }

  /** A period change made during a run is applied once the run has settled. */
  private resolveDeferred(): void {
    const asOf = this.deferredAsOf;
    if (asOf === null || this.isBusy()) return;
    this.deferredAsOf = null;
    void this.resolveVersion(asOf);
  }

  /**
   * Fire-and-forget, at most once per run. Hashing or network failures are swallowed: logging
   * must never break or delay the run (spec §13 step 7).
   */
  private logRun(
    token: number,
    status: RunLogStatus,
    summary: RunSummary | null,
    error: EngineErrorInfo | null,
  ): void {
    const run = this.currentRun;
    if (!this.logger || !run || run.token !== token || run.logged || !run.versionId) return;
    run.logged = true;
    const logger = this.logger;
    void buildRunLog({
      flowVersionId: run.versionId,
      flowParams: run.flow.params,
      params: run.params,
      slots: run.slots,
      status,
      durationMs: summary?.durationMs ?? Date.now() - run.startedAt,
      summary,
      error,
    })
      .then((entry) => logger.logRun(entry))
      .catch(() => undefined);
  }

  /** Cooperative cancel first; if the worker is stuck in synchronous work, terminate it. */
  async cancel(): Promise<void> {
    if (this.state.run.status !== 'running') return;
    const token = this.token;
    this.set((s) => ({ ...s, run: { ...s.run, status: 'cancelling' } }));
    // A dead worker may reject; the grace timer below handles it.
    this.engine()
      .api.cancel()
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, CANCEL_GRACE_MS));
    // Re-read: the run may have settled (as cancelled) during the grace period.
    const status: RunStatus = this.getSnapshot().run.status;
    if (token !== this.token || status !== 'cancelling') return;

    this.set((s) => ({ ...s, run: { ...s.run, status: 'cancelled' } }));
    this.logRun(token, 'cancelled', null, null);
    await this.restartEngine();
    this.resolveDeferred();
  }

  /** After a failed restore: try again on a fresh worker. */
  async retryRestore(): Promise<void> {
    if (!this.state.restoreFailed || this.state.restoring) return;
    await this.restartEngine();
  }

  /**
   * Terminate the worker and re-send the flow and files to a fresh one. Never rejects: a failure
   * ends in `restoreFailed` (shown with a retry button), and `restoring` is always reset.
   */
  private async restartEngine(): Promise<void> {
    const token = ++this.token;
    this.engine().restart();
    this.set((s) => ({ ...s, restoring: true, restoreFailed: false }));
    let ok = false;
    try {
      const loaded = await this.engine().api.loadFlow(this.definition);
      if (token !== this.token) return;
      if (!loaded.ok) return;
      // A slot whose re-validation call failed (worker crashed again) is not restored either.
      const results = await Promise.all(
        Object.keys(this.state.slots).map((k) => this.validateSlot(k)),
      );
      ok = results.every(Boolean);
    } catch {
      // ok stays false
    } finally {
      if (token === this.token) this.set((s) => ({ ...s, restoring: false, restoreFailed: !ok }));
    }
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
