import {
  FlowDefinitionSchema,
  FlowEdgeSchema,
  FlowNodeSchema,
  FlowParamSchema,
  InputSlotSchema,
  migrateFlowDefinition,
  type FlowDefinition,
  type FlowEdge,
  type FlowNode,
  type FlowParam,
  type InputSlot,
} from '@hrflow/flow-schema';
import type { ZodError } from 'zod';
import type { DuckDbProvider } from './duckdb/base';
import type { AnyNodePlugin, PortDef } from './core/plugin';
import { EngineError, type ColumnDef, type Translate } from './core/types';
import { nodePlugins } from './nodes';
import type { ColumnInfo } from './protocol';

/**
 * Design-time check of a flow (spec §13.2, §15.3 "Kiểm tra realtime", §14.4 publish check): the
 * same rules as `planFlow` + `checkConfig` + `inferSchema` + plugin warnings, but collecting every
 * problem instead of stopping at the first one, and returning the inferred columns of every node
 * port (for the column dropdowns of the Designer forms). No data is involved.
 *
 * Rules on top of the engine's: at least one node, at most one `isAsOfDate` param (month/date),
 * unique param keys. A node whose upstream failed is `blocked` (no cascade of errors, §13.2).
 */

export type DesignSeverity = 'error' | 'warning';

export interface DesignIssue {
  severity: DesignSeverity;
  /** Engine i18n key (`locales/vi/engine.json`). */
  messageKey: string;
  params: Record<string, unknown>;
  /** Localized text (engine namespace). */
  text: string;
  nodeId?: string;
  /** Field inside the node config / slot / param, dot separated (e.g. `metrics.0.left`). */
  path?: string;
  /** Index of the input slot (slot-form issues). */
  slotIndex?: number;
  /** Index of the param (params-form issues). */
  paramIndex?: number;
}

export type DesignNodeStatus = 'ok' | 'error' | 'blocked';

export interface DesignNodeInfo {
  status: DesignNodeStatus;
  /** Columns arriving on each connected input port (absent: upstream unknown). */
  inputs: Record<string, ColumnInfo[]>;
  /** Columns of each output port (null: unknown because of an error here or upstream). */
  outputs: Record<string, ColumnInfo[]> | null;
}

export interface DesignCheckResult {
  issues: DesignIssue[];
  nodes: Record<string, DesignNodeInfo>;
  errorCount: number;
  warningCount: number;
}

export interface DesignCheckOptions {
  t: Translate;
  duck?: DuckDbProvider;
  plugins?: Readonly<Record<string, AnyNodePlugin>>;
}

function toInfo(c: ColumnDef): ColumnInfo {
  return { key: c.key, title: c.title ?? c.key, type: c.type };
}

function toDef(c: ColumnInfo): ColumnDef {
  return { key: c.key, title: c.title, type: c.type };
}

/** Slot-form issue key for a Zod issue path (cross-field rules get their own message). */
function slotIssueKey(path: (string | number)[]): string {
  const p = path.join('.');
  if (p === 'dataStartRow') return 'design.slot.dataStartRow';
  if (p === 'multiple') return 'design.slot.minMaxFiles';
  if (/^columns\.\d+\.defaultValue$/.test(p)) return 'design.slot.defaultValue';
  if (/^columns\.\d+\.key$/.test(p)) return 'design.slot.columnKey';
  if (p === 'key') return 'design.slot.key';
  if (/^columns\.\d+\.rules\.\d+/.test(p)) return 'design.slot.rule';
  if (p === 'columns') return 'design.slot.columns';
  if (/^columns\.\d+\.aliases/.test(p)) return 'design.slot.aliases';
  if (/^columns\.\d+\.dateFormats/.test(p)) return 'design.slot.dateFormats';
  if (p.startsWith('skipRows')) return 'design.slot.skipRows';
  return 'design.slot.invalidField';
}

function zodPaths(error: ZodError): (string | number)[][] {
  return error.issues.map((i) => i.path.filter((x): x is string | number => typeof x !== 'symbol'));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const arrayOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Nodes that lie on a cycle (reachable from themselves). */
function nodesOnCycles(ids: string[], edges: readonly FlowEdge[]): Set<string> {
  const next = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) next.get(e.from)?.push(e.to);
  const out = new Set<string>();
  for (const start of ids) {
    const seen = new Set<string>();
    const stack = [...(next.get(start) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === start) {
        out.add(start);
        break;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) ?? []));
    }
  }
  return out;
}

export async function checkDesign(
  raw: unknown,
  options: DesignCheckOptions,
): Promise<DesignCheckResult> {
  const { t } = options;
  const plugins = options.plugins ?? nodePlugins;
  const issues: DesignIssue[] = [];
  const add = (
    severity: DesignSeverity,
    messageKey: string,
    params: Record<string, unknown>,
    where: Omit<DesignIssue, 'severity' | 'messageKey' | 'params' | 'text'> = {},
  ) => issues.push({ severity, messageKey, params, text: t(messageKey, params), ...where });

  const def = isRecord(raw) ? migrateFlowDefinition(raw).definition : {};
  const src = isRecord(def) ? def : {};

  // ---- params -------------------------------------------------------------------------------
  const params: FlowParam[] = [];
  const paramKeys = new Set<string>();
  let asOf = 0;
  arrayOf(src.params).forEach((p, i) => {
    const parsed = FlowParamSchema.safeParse(p);
    const label = isRecord(p) && typeof p.label === 'string' && p.label ? p.label : `#${i + 1}`;
    if (!parsed.success) {
      for (const path of zodPaths(parsed.error)) {
        const field = path.join('.');
        add(
          'error',
          'design.param.invalidField',
          { param: label, field },
          {
            paramIndex: i,
            path: field,
          },
        );
      }
      return;
    }
    const param = parsed.data;
    if (paramKeys.has(param.key)) {
      add(
        'error',
        'design.param.duplicateKey',
        { param: label, key: param.key },
        {
          paramIndex: i,
          path: 'key',
        },
      );
      return;
    }
    paramKeys.add(param.key);
    if (param.isAsOfDate) {
      if (param.type !== 'month' && param.type !== 'date') {
        add('error', 'design.param.asOfType', { param: label }, { paramIndex: i, path: 'type' });
      } else if (++asOf > 1) {
        add(
          'error',
          'design.param.multipleAsOf',
          { param: label },
          {
            paramIndex: i,
            path: 'isAsOfDate',
          },
        );
      }
    }
    if (param.type === 'select' && (!Array.isArray(param.options) || param.options.length === 0)) {
      add('error', 'design.param.noOptions', { param: label }, { paramIndex: i, path: 'options' });
    }
    params.push(param);
  });

  // ---- input slots --------------------------------------------------------------------------
  const slots: InputSlot[] = [];
  /** Slot keys present in the raw definition but invalid (their nodes are blocked). */
  const brokenSlots = new Map<string, string>();
  const slotKeys = new Set<string>();
  arrayOf(src.inputSlots).forEach((s, i) => {
    const label =
      isRecord(s) && typeof s.label === 'string' && s.label
        ? s.label
        : isRecord(s) && typeof s.key === 'string'
          ? s.key
          : `#${i + 1}`;
    const parsed = InputSlotSchema.safeParse(s);
    if (!parsed.success) {
      for (const path of zodPaths(parsed.error)) {
        const field = path.join('.');
        add('error', slotIssueKey(path), { slot: label, field }, { slotIndex: i, path: field });
      }
      if (isRecord(s) && typeof s.key === 'string') brokenSlots.set(s.key, label);
      return;
    }
    if (slotKeys.has(parsed.data.key)) {
      add(
        'error',
        'design.slot.duplicateKey',
        { slot: label, key: parsed.data.key },
        {
          slotIndex: i,
          path: 'key',
        },
      );
      return;
    }
    slotKeys.add(parsed.data.key);
    slots.push(parsed.data);
  });

  // ---- nodes and edges ----------------------------------------------------------------------
  const nodes: FlowNode[] = [];
  const nodeIds = new Set<string>();
  arrayOf(src.nodes).forEach((n) => {
    const parsed = FlowNodeSchema.safeParse(n);
    const id = isRecord(n) && typeof n.id === 'string' ? n.id : '';
    if (!parsed.success || nodeIds.has(parsed.data.id)) {
      add('error', 'executor.error.duplicateNode', { node: id }, id ? { nodeId: id } : {});
      return;
    }
    nodeIds.add(parsed.data.id);
    nodes.push(parsed.data);
  });
  if (nodes.length === 0) add('error', 'design.flow.noNodes', {});

  const edges: FlowEdge[] = [];
  for (const e of arrayOf(src.edges)) {
    const parsed = FlowEdgeSchema.safeParse(e);
    if (parsed.success && nodeIds.has(parsed.data.from) && nodeIds.has(parsed.data.to)) {
      edges.push(parsed.data);
    }
  }

  const flow: FlowDefinition = {
    schemaVersion: 1,
    params,
    nodes,
    edges,
    inputSlots: slots,
    ...(isRecord(src.ui) ? { ui: src.ui } : {}),
  };

  const result: Record<string, DesignNodeInfo> = {};
  const labelOf = (n: FlowNode) => n.label ?? n.id;
  interface Resolved {
    node: FlowNode;
    plugin: AnyNodePlugin | null;
    config: unknown;
    ok: boolean;
    inPorts: PortDef[] | null;
    outPorts: PortDef[];
    links: { port: string; from: string; fromPort: string }[];
  }
  const resolved = new Map<string, Resolved>();

  for (const node of nodes) {
    const label = labelOf(node);
    const where = { nodeId: node.id };
    const plugin = plugins[node.type] ?? null;
    const r: Resolved = {
      node,
      plugin,
      config: undefined,
      ok: true,
      inPorts: null,
      outPorts: plugin?.outputs ?? [],
      links: [],
    };
    resolved.set(node.id, r);
    if (!plugin || (!plugin.runSql && !plugin.execute)) {
      add('error', 'executor.error.unknownNodeType', { node: label, type: node.type }, where);
      r.ok = false;
      continue;
    }
    const parsed = plugin.configSchema.safeParse(node.config);
    if (!parsed.success) {
      r.ok = false;
      // Ports are still known (static, or from the raw config), so edges keep bringing the
      // upstream columns: the form of a node being configured needs them.
      try {
        r.inPorts = plugin.inputPorts ? plugin.inputPorts(node.config) : plugin.inputs;
        if (!Array.isArray(r.inPorts)) r.inPorts = plugin.inputs;
      } catch {
        r.inPorts = plugin.inputs.length > 0 ? plugin.inputs : null;
      }
      const seen = new Set<string>();
      for (const path of zodPaths(parsed.error)) {
        const field = path.join('.');
        if (seen.has(field)) continue;
        seen.add(field);
        add(
          'error',
          'executor.error.invalidConfig',
          { node: label, path: field },
          {
            ...where,
            path: field,
          },
        );
      }
      continue;
    }
    r.config = parsed.data;
    r.inPorts = plugin.inputPorts?.(r.config) ?? plugin.inputs;
    if (node.type === 'input.excel') {
      const slotKey = (r.config as { slot: string }).slot;
      const broken = brokenSlots.get(slotKey);
      if (broken !== undefined) {
        add(
          'error',
          'design.node.slotInvalid',
          { node: label, slot: broken },
          {
            ...where,
            path: 'slot',
          },
        );
        r.ok = false;
        continue;
      }
    }
    try {
      plugin.checkConfig?.(r.config, flow);
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      const path = typeof err.params.path === 'string' ? err.params.path : undefined;
      add(
        'error',
        err.messageKey,
        { ...err.params, node: label },
        {
          ...where,
          ...(path !== undefined ? { path } : {}),
        },
      );
      r.ok = false;
    }
  }

  for (const edge of edges) {
    const from = resolved.get(edge.from)!;
    const to = resolved.get(edge.to)!;
    const resolvePort = (ports: PortDef[] | null, requested: string | undefined, r: Resolved) => {
      if (!ports) return null;
      if (requested === undefined) {
        if (ports.length === 1) return ports[0]!.name;
        add(
          'error',
          'executor.error.ambiguousPort',
          { node: labelOf(r.node) },
          {
            nodeId: r.node.id,
          },
        );
        return null;
      }
      if (!ports.some((p) => p.name === requested)) {
        add(
          'error',
          'executor.error.unknownPort',
          { node: labelOf(r.node), port: requested },
          {
            nodeId: r.node.id,
          },
        );
        return null;
      }
      return requested;
    };
    const fromPort = resolvePort(from.plugin ? from.outPorts : null, edge.fromPort, from);
    const toPort = resolvePort(to.inPorts, edge.toPort, to);
    if (fromPort === null || toPort === null) {
      if (from.plugin && to.inPorts) to.ok = false;
      continue;
    }
    if (to.links.some((l) => l.port === toPort)) {
      add(
        'error',
        'executor.error.portConnectedTwice',
        { node: labelOf(to.node), port: toPort },
        {
          nodeId: to.node.id,
        },
      );
      to.ok = false;
      continue;
    }
    to.links.push({ port: toPort, from: from.node.id, fromPort });
  }

  for (const r of resolved.values()) {
    for (const port of r.inPorts ?? []) {
      if (port.required && !r.links.some((l) => l.port === port.name)) {
        add(
          'error',
          'executor.error.missingPort',
          { node: labelOf(r.node), port: port.name },
          {
            nodeId: r.node.id,
          },
        );
        r.ok = false;
      }
    }
  }

  const cyclic = nodesOnCycles(
    nodes.map((n) => n.id),
    [...resolved.values()].flatMap((r) => r.links.map((l) => ({ from: l.from, to: r.node.id }))),
  );
  for (const id of cyclic) {
    const r = resolved.get(id)!;
    add('error', 'executor.error.cycle', { node: labelOf(r.node) }, { nodeId: id });
    r.ok = false;
  }

  // ---- schema inference in topological order (nodes order breaks ties) ----------------------
  const done = new Set<string>();
  const order: Resolved[] = [];
  const pending = [...resolved.values()].filter((r) => !cyclic.has(r.node.id));
  for (const r of resolved.values()) {
    if (cyclic.has(r.node.id)) {
      done.add(r.node.id);
      result[r.node.id] = { status: 'error', inputs: {}, outputs: null };
    }
  }
  while (pending.length > 0) {
    const i = pending.findIndex((r) => r.links.every((l) => done.has(l.from)));
    if (i < 0) break;
    const [r] = pending.splice(i, 1);
    done.add(r!.node.id);
    order.push(r!);
  }

  for (const r of order) {
    const label = labelOf(r.node);
    const inputs: Record<string, ColumnInfo[]> = {};
    let blocked = false;
    for (const link of r.links) {
      const up = result[link.from];
      const cols = up?.outputs?.[link.fromPort];
      if (!cols) blocked = true;
      else inputs[link.port] = cols;
    }
    if (!r.ok || !r.plugin) {
      result[r.node.id] = { status: 'error', inputs, outputs: null };
      continue;
    }
    if (blocked) {
      result[r.node.id] = { status: 'blocked', inputs, outputs: null };
      continue;
    }
    const ctx = { t, flow, ...(options.duck ? { duck: options.duck } : {}) };
    const defs = Object.fromEntries(
      Object.entries(inputs).map(([port, cols]) => [port, cols.map(toDef)]),
    );
    try {
      const schemas = (await r.plugin.inferSchema(r.config, defs, ctx)) as Record<
        string,
        ColumnDef[]
      >;
      const outputs: Record<string, ColumnInfo[]> = {};
      for (const [port, cols] of Object.entries(schemas)) outputs[port] = cols.map(toInfo);
      result[r.node.id] = { status: 'ok', inputs, outputs };
    } catch (err) {
      const e =
        err instanceof EngineError
          ? err
          : new EngineError('executor.error.nodeFailed', { node: label });
      const path = typeof e.params.path === 'string' ? e.params.path : undefined;
      add(
        'error',
        e.messageKey,
        { ...e.params, node: label },
        {
          nodeId: r.node.id,
          ...(path !== undefined ? { path } : {}),
        },
      );
      result[r.node.id] = { status: 'error', inputs, outputs: null };
      continue;
    }
    try {
      for (const w of (await r.plugin.warnings?.(r.config, defs, ctx)) ?? []) {
        add('warning', w.messageKey, { ...w.params, node: label }, { nodeId: r.node.id });
      }
    } catch {
      // Warnings never block; a failure here was already reported by inferSchema.
    }
  }

  // The full schema must parse too (what publish and the run require); only reported when none of
  // the checks above explains the failure.
  if (!issues.some((i) => i.severity === 'error')) {
    const full = FlowDefinitionSchema.safeParse(def);
    if (!full.success) {
      for (const path of zodPaths(full.error)) {
        add('error', 'design.flow.structure', { path: path.join('.') });
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  return { issues, nodes: result, errorCount, warningCount: issues.length - errorCount };
}
