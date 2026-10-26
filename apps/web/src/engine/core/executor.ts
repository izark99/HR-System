import type { FlowDefinition, FlowNode, FlowParam } from '@hrflow/flow-schema';
import {
  readSlot as readSlotFiles,
  type SlotReadResult,
  type SourceFile,
} from '../io/excel-reader';
import { nodePlugins } from '../nodes';
import type { AnyNodePlugin, NodeOutputs, PortDef } from './plugin';
import {
  EngineError,
  type ParamValue,
  type RunArtifact,
  type RunServices,
  type Translate,
} from './types';

/**
 * DAG executor (spec §13): plan (resolve plugins, configs and ports, topological sort), then run
 * node by node, reporting progress. Data never leaves the process; progress events carry only
 * counts and timings.
 */

export interface PortLink {
  /** Input port of this node. */
  port: string;
  from: string;
  fromPort: string;
}

export interface PlannedNode {
  node: FlowNode;
  plugin: AnyNodePlugin;
  /** Config parsed by the plugin's Zod schema (defaults applied). */
  config: unknown;
  inputs: PortLink[];
  outputPorts: PortDef[];
}

export type RunProgressEvent =
  | {
      type: 'run-started';
      nodes: { id: string; type: string; label: string | undefined }[];
    }
  | { type: 'node-started'; nodeId: string; index: number; total: number }
  | {
      type: 'node-finished';
      nodeId: string;
      index: number;
      total: number;
      /** Row count per output port. */
      rows: Record<string, number>;
      durationMs: number;
    };

export interface NodeRunStats {
  nodeId: string;
  type: string;
  rows: Record<string, number>;
  durationMs: number;
}

export interface RunFlowOptions {
  t: Translate;
  params?: Readonly<Record<string, ParamValue>>;
  /** Files per input slot key. Ignored when `readSlot` is given. */
  files?: Readonly<Record<string, readonly SourceFile[]>>;
  /** Custom slot reader, e.g. one that serves results cached by the validation step. */
  readSlot?: (slotKey: string) => SlotReadResult | Promise<SlotReadResult>;
  plugins?: Readonly<Record<string, AnyNodePlugin>>;
  signal?: AbortSignal;
  onProgress?: (event: RunProgressEvent) => void;
}

export interface RunFlowResult {
  /** Output tables per node id and port. */
  outputs: Record<string, NodeOutputs>;
  artifacts: RunArtifact[];
  nodes: NodeRunStats[];
  durationMs: number;
}

export const CANCELLED_KEY = 'executor.error.cancelled';

export function isCancelled(err: unknown): boolean {
  return err instanceof EngineError && err.messageKey === CANCELLED_KEY;
}

function fail(key: string, params: Record<string, unknown>, nodeId?: string): never {
  throw new EngineError(key, params, nodeId);
}

/**
 * Resolve every node (plugin + validated config + ports) and order them topologically.
 * Throws an `EngineError` with the offending node id for unknown types, invalid configs,
 * unknown/ambiguous/doubly connected ports, unconnected required ports and cycles.
 */
export function planFlow(
  flow: FlowDefinition,
  plugins: Readonly<Record<string, AnyNodePlugin>> = nodePlugins,
): PlannedNode[] {
  const planned = new Map<string, PlannedNode>();
  const inputPorts = new Map<string, PortDef[]>();

  for (const node of flow.nodes) {
    if (planned.has(node.id)) fail('executor.error.duplicateNode', { node: node.id }, node.id);
    const plugin = plugins[node.type];
    if (!plugin) fail('executor.error.unknownNodeType', { type: node.type }, node.id);
    const parsed = plugin.configSchema.safeParse(node.config);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      fail(
        'executor.error.invalidConfig',
        { node: node.label ?? node.id, path: first?.path.join('.') ?? '' },
        node.id,
      );
    }
    const config: unknown = parsed.data;
    try {
      plugin.checkConfig?.(config, flow);
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      fail(err.messageKey, { node: node.label ?? node.id, ...err.params }, node.id);
    }
    inputPorts.set(node.id, plugin.inputPorts?.(config) ?? plugin.inputs);
    planned.set(node.id, { node, plugin, config, inputs: [], outputPorts: plugin.outputs });
  }

  const resolvePort = (ports: PortDef[], requested: string | undefined, nodeId: string): string => {
    if (requested === undefined) {
      if (ports.length !== 1) fail('executor.error.ambiguousPort', { node: nodeId }, nodeId);
      return ports[0]!.name;
    }
    if (!ports.some((p) => p.name === requested)) {
      fail('executor.error.unknownPort', { node: nodeId, port: requested }, nodeId);
    }
    return requested;
  };

  for (const edge of flow.edges) {
    const from = planned.get(edge.from);
    const to = planned.get(edge.to);
    if (!from) fail('executor.error.unknownNode', { node: edge.from }, edge.from);
    if (!to) fail('executor.error.unknownNode', { node: edge.to }, edge.to);
    const fromPort = resolvePort(from.outputPorts, edge.fromPort, from.node.id);
    const port = resolvePort(inputPorts.get(to.node.id)!, edge.toPort, to.node.id);
    if (to.inputs.some((l) => l.port === port)) {
      fail('executor.error.portConnectedTwice', { node: to.node.id, port }, to.node.id);
    }
    to.inputs.push({ port, from: from.node.id, fromPort });
  }

  for (const p of planned.values()) {
    for (const port of inputPorts.get(p.node.id)!) {
      if (port.required && !p.inputs.some((l) => l.port === port.name)) {
        fail('executor.error.missingPort', { node: p.node.id, port: port.name }, p.node.id);
      }
    }
  }

  return topoSort([...planned.values()]);
}

/**
 * A node that lies on a cycle. Every remaining node still has a remaining predecessor, so walking
 * predecessors must revisit a node; the first revisited node is on the cycle (nodes merely
 * downstream of a cycle are never revisited).
 */
function nodeOnCycle(indegree: Map<string, Set<string>>, start: string): string {
  const seen = new Set<string>();
  let current = start;
  while (!seen.has(current)) {
    seen.add(current);
    current = indegree.get(current)!.values().next().value!;
  }
  return current;
}

/** Kahn's algorithm; ties keep the order of `flow.nodes` so runs are deterministic. */
function topoSort(nodes: PlannedNode[]): PlannedNode[] {
  const indegree = new Map(nodes.map((n) => [n.node.id, new Set(n.inputs.map((l) => l.from))]));
  const order: PlannedNode[] = [];
  const remaining = [...nodes];
  while (remaining.length > 0) {
    const i = remaining.findIndex((n) => indegree.get(n.node.id)!.size === 0);
    if (i < 0) {
      const node = nodeOnCycle(indegree, remaining[0]!.node.id);
      fail('executor.error.cycle', { node }, node);
    }
    const [next] = remaining.splice(i, 1);
    order.push(next!);
    for (const deps of indegree.values()) deps.delete(next!.node.id);
  }
  return order;
}

/** Check required params and value formats. Returns the first problem as an EngineError. */
export function checkParams(
  defs: readonly FlowParam[],
  params: Readonly<Record<string, ParamValue>>,
): EngineError | null {
  for (const def of defs) {
    const v = params[def.key];
    const blank = v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    if (blank) {
      if (def.required)
        return new EngineError('executor.error.paramRequired', { param: def.label });
      continue;
    }
    const s = String(v);
    const ok =
      def.type === 'month'
        ? /^\d{4}-(0[1-9]|1[0-2])$/.test(s)
        : def.type === 'date'
          ? /^\d{4}-\d{2}-\d{2}$/.test(s)
          : def.type === 'number'
            ? typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(s)
            : true;
    if (!ok) return new EngineError('executor.error.paramInvalid', { param: def.label });
  }
  return null;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EngineError(CANCELLED_KEY);
}

/** Resolve with `work`, or reject as soon as `signal` aborts (the work itself is abandoned). */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new EngineError(CANCELLED_KEY));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function attachNode(err: unknown, node: FlowNode): EngineError {
  if (err instanceof EngineError) {
    return err.nodeId ? err : new EngineError(err.messageKey, err.params, node.id);
  }
  // Raw exception text is deliberately dropped: it may quote cell values, and EngineErrorInfo is
  // what the UI shows and what a future run log (metadata only, spec §7.1) would record.
  return new EngineError('executor.error.nodeFailed', { node: node.label ?? node.id }, node.id);
}

/** Plan and run a flow. Rejects with an `EngineError` (node id attached) on failure or cancel. */
export async function runFlow(
  flow: FlowDefinition,
  options: RunFlowOptions,
): Promise<RunFlowResult> {
  const started = now();
  const { signal, onProgress } = options;
  const params = options.params ?? {};
  const plan = planFlow(flow, options.plugins ?? nodePlugins);
  const paramError = checkParams(flow.params, params);
  if (paramError) throw paramError;

  const slotCache = new Map<string, SlotReadResult>();
  const readSlot =
    options.readSlot ??
    ((slotKey: string): SlotReadResult => {
      let cached = slotCache.get(slotKey);
      if (!cached) {
        const slot = flow.inputSlots.find((s) => s.key === slotKey);
        if (!slot) throw new EngineError('executor.error.unknownSlot', { slot: slotKey });
        cached = readSlotFiles(slot, options.files?.[slotKey] ?? []);
        slotCache.set(slotKey, cached);
      }
      return cached;
    });

  const outputs: Record<string, NodeOutputs> = {};
  const artifacts: RunArtifact[] = [];
  const stats: NodeRunStats[] = [];
  onProgress?.({
    type: 'run-started',
    nodes: plan.map((p) => ({ id: p.node.id, type: p.node.type, label: p.node.label })),
  });

  for (const [index, step] of plan.entries()) {
    throwIfAborted(signal);
    const { node, plugin } = step;
    onProgress?.({ type: 'node-started', nodeId: node.id, index, total: plan.length });
    const t0 = now();

    const inputs: NodeOutputs = {};
    for (const link of step.inputs) {
      const table = outputs[link.from]?.[link.fromPort];
      if (!table) {
        fail('executor.error.missingInput', { node: node.id, port: link.port }, node.id);
      }
      inputs[link.port] = table;
    }
    const run: RunServices = {
      nodeId: node.id,
      params,
      readSlot,
      signal,
      emitArtifact: (a) => artifacts.push({ ...a, nodeId: node.id }),
    };

    let result: NodeOutputs;
    try {
      // Promise.resolve().then(): a synchronous throw inside execute also becomes a rejection.
      result = await raceAbort(
        Promise.resolve().then(() =>
          plugin.execute(step.config, inputs, { t: options.t, flow, run }),
        ),
        signal,
      );
    } catch (err) {
      if (isCancelled(err)) throw err;
      throw attachNode(err, node);
    }
    throwIfAborted(signal);

    outputs[node.id] = result;
    const rows = Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.rows.length]));
    const durationMs = now() - t0;
    stats.push({ nodeId: node.id, type: node.type, rows, durationMs });
    onProgress?.({
      type: 'node-finished',
      nodeId: node.id,
      index,
      total: plan.length,
      rows,
      durationMs,
    });
  }

  return { outputs, artifacts, nodes: stats, durationMs: now() - started };
}
