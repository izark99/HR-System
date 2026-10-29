import { inputPortsOf, nodeSpec, outputPortsOf, type DefaultTexts } from './catalog';

/**
 * Designer document (spec §8, §15.3): the flow definition being edited, plus canvas data
 * (`ui.positions`, `ui.notes`). Pure functions only (unit-tested): every edit returns a new
 * document, so undo/redo is a stack of documents.
 *
 * Slots, params and node configs are kept as plain JSON (what the forms produce) and validated by
 * the engine's design check, not here: a draft may be saved while it still has problems.
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = Record<string, unknown>;

export interface DNode {
  id: string;
  type: string;
  label?: string;
  config: JsonObject;
}

export interface DEdge {
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
}

export type XY = [number, number];

export interface DNote {
  id: string;
  text: string;
  position: XY;
  size?: XY;
}

export interface DesignerDoc {
  params: JsonObject[];
  inputSlots: JsonObject[];
  nodes: DNode[];
  edges: DEdge[];
  positions: Record<string, XY>;
  notes: DNote[];
  /** Other `ui` keys of the stored definition, kept as they are. */
  uiExtra: JsonObject;
}

export const EMPTY_DOC: DesignerDoc = {
  params: [],
  inputSlots: [],
  nodes: [],
  edges: [],
  positions: {},
  notes: [],
  uiExtra: {},
};

const isObj = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const objects = (v: unknown): JsonObject[] => (Array.isArray(v) ? v.filter(isObj) : []);

function xy(v: unknown): XY | undefined {
  return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number')
    ? [v[0] as number, v[1] as number]
    : undefined;
}

export function edgeId(e: DEdge): string {
  return `${e.from}.${e.fromPort}>${e.to}.${e.toPort}`;
}

/** Stored definition → document. Edge ports left out (single-port nodes) are filled in. */
export function fromDefinition(def: unknown): DesignerDoc {
  const src = isObj(def) ? def : {};
  const nodes: DNode[] = objects(src.nodes).map((n) => ({
    id: typeof n.id === 'string' ? n.id : '',
    type: typeof n.type === 'string' ? n.type : '',
    ...(typeof n.label === 'string' ? { label: n.label } : {}),
    config: isObj(n.config) ? structuredClone(n.config) : {},
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: DEdge[] = [];
  for (const e of objects(src.edges)) {
    if (typeof e.from !== 'string' || typeof e.to !== 'string') continue;
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    const outs = from ? outputPortsOf(from.type) : [];
    const ins = to ? inputPortsOf(to.type, to.config) : [];
    const fromPort =
      typeof e.fromPort === 'string' ? e.fromPort : outs.length === 1 ? outs[0]!.name : '';
    const toPort = typeof e.toPort === 'string' ? e.toPort : ins.length === 1 ? ins[0]!.name : '';
    edges.push({ from: e.from, fromPort, to: e.to, toPort });
  }
  const ui = isObj(src.ui) ? src.ui : {};
  const positions: Record<string, XY> = {};
  if (isObj(ui.positions)) {
    for (const [id, p] of Object.entries(ui.positions)) {
      const v = xy(p);
      if (v) positions[id] = v;
    }
  }
  const notes: DNote[] = objects(ui.notes).flatMap((n) => {
    const position = xy(n.position);
    if (typeof n.id !== 'string' || !position) return [];
    const size = xy(n.size);
    return [
      {
        id: n.id,
        text: typeof n.text === 'string' ? n.text : '',
        position,
        ...(size ? { size } : {}),
      },
    ];
  });
  const uiExtra = Object.fromEntries(
    Object.entries(ui).filter(([k]) => k !== 'positions' && k !== 'notes'),
  );
  const doc: DesignerDoc = {
    params: structuredClone(objects(src.params)),
    inputSlots: structuredClone(objects(src.inputSlots)),
    nodes,
    edges,
    positions,
    notes,
    uiExtra: structuredClone(uiExtra),
  };
  // Nodes without a stored position (e.g. an imported JSON) are placed by the auto-layout.
  if (nodes.some((n) => !positions[n.id])) {
    const laid = autoLayout(doc);
    for (const n of nodes) positions[n.id] ??= laid[n.id]!;
  }
  return doc;
}

/** Document → flow definition JSON (what is saved / exported). */
export function toDefinition(doc: DesignerDoc): JsonObject {
  const positions: Record<string, XY> = {};
  for (const n of doc.nodes) {
    const p = doc.positions[n.id];
    if (p) positions[n.id] = [Math.round(p[0]), Math.round(p[1])];
  }
  return {
    schemaVersion: 1,
    params: doc.params,
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      ...(n.label !== undefined && n.label !== '' ? { label: n.label } : {}),
      config: n.config,
    })),
    edges: doc.edges.map((e) => ({ ...e })),
    inputSlots: doc.inputSlots,
    ui: {
      ...doc.uiExtra,
      positions,
      ...(doc.notes.length > 0
        ? {
            notes: doc.notes.map((n) => ({
              id: n.id,
              text: n.text,
              position: [Math.round(n.position[0]), Math.round(n.position[1])],
              ...(n.size ? { size: n.size } : {}),
            })),
          }
        : {}),
    },
  };
}

// ---- ids --------------------------------------------------------------------------------------

export function uniqueId(prefix: string, taken: ReadonlySet<string>): string {
  for (let i = 1; ; i++) {
    const id = `${prefix}_${i}`;
    if (!taken.has(id)) return id;
  }
}

function takenIds(doc: DesignerDoc): Set<string> {
  return new Set([...doc.nodes.map((n) => n.id), ...doc.notes.map((n) => n.id)]);
}

// ---- edits ------------------------------------------------------------------------------------

export function addNode(
  doc: DesignerDoc,
  type: string,
  position: XY,
  texts: DefaultTexts,
  label?: string,
): { doc: DesignerDoc; id: string } {
  const spec = nodeSpec(type);
  const id = uniqueId(spec?.idPrefix ?? 'node', takenIds(doc));
  const node: DNode = {
    id,
    type,
    ...(label ? { label } : {}),
    config: spec ? spec.defaults(texts) : {},
  };
  return {
    doc: { ...doc, nodes: [...doc.nodes, node], positions: { ...doc.positions, [id]: position } },
    id,
  };
}

export interface Removal {
  nodes?: readonly string[];
  edges?: readonly string[];
  notes?: readonly string[];
}

export function removeElements(doc: DesignerDoc, r: Removal): DesignerDoc {
  const nodes = new Set(r.nodes ?? []);
  const edges = new Set(r.edges ?? []);
  const notes = new Set(r.notes ?? []);
  if (nodes.size + edges.size + notes.size === 0) return doc;
  const positions = { ...doc.positions };
  for (const id of nodes) delete positions[id];
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !nodes.has(n.id)),
    edges: doc.edges.filter((e) => !edges.has(edgeId(e)) && !nodes.has(e.from) && !nodes.has(e.to)),
    notes: doc.notes.filter((n) => !notes.has(n.id)),
    positions,
  };
}

export function moveElements(doc: DesignerDoc, moves: Record<string, XY>): DesignerDoc {
  const positions = { ...doc.positions };
  let notes = doc.notes;
  for (const [id, p] of Object.entries(moves)) {
    if (doc.nodes.some((n) => n.id === id)) positions[id] = p;
    else notes = notes.map((n) => (n.id === id ? { ...n, position: p } : n));
  }
  return { ...doc, positions, notes };
}

export type ConnectProblem = 'self' | 'cycle' | 'portTaken' | 'unknownPort';

/** Would `from → to` close a cycle (is `from` reachable from `to`)? */
export function createsCycle(edges: readonly DEdge[], from: string, to: string): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

/** Check a new edge (spec §15.3: no cycle, one edge per input port). */
export function connectProblem(doc: DesignerDoc, e: DEdge): ConnectProblem | null {
  if (e.from === e.to) return 'self';
  const from = doc.nodes.find((n) => n.id === e.from);
  const to = doc.nodes.find((n) => n.id === e.to);
  if (!from || !to) return 'unknownPort';
  if (!outputPortsOf(from.type).some((p) => p.name === e.fromPort)) return 'unknownPort';
  if (!inputPortsOf(to.type, to.config).some((p) => p.name === e.toPort)) return 'unknownPort';
  if (doc.edges.some((x) => x.to === e.to && x.toPort === e.toPort)) return 'portTaken';
  if (createsCycle(doc.edges, e.from, e.to)) return 'cycle';
  return null;
}

export function connect(
  doc: DesignerDoc,
  e: DEdge,
): { ok: true; doc: DesignerDoc } | { ok: false; problem: ConnectProblem } {
  const problem = connectProblem(doc, e);
  if (problem) return { ok: false, problem };
  return { ok: true, doc: { ...doc, edges: [...doc.edges, { ...e }] } };
}

/**
 * Replace a node's config (and label). Edges to input ports that the change removed are dropped;
 * `renames` (old → new input port) moves edges along (e.g. a sheet's port renamed).
 */
export function updateNode(
  doc: DesignerDoc,
  id: string,
  patch: { config?: JsonObject; label?: string },
  renames: Record<string, string> = {},
): DesignerDoc {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return doc;
  const next: DNode = { ...node };
  if (patch.config) next.config = patch.config;
  if (patch.label !== undefined) {
    if (patch.label === '') delete next.label;
    else next.label = patch.label;
  }
  let edges = doc.edges;
  if (patch.config) {
    const before = new Set(inputPortsOf(node.type, node.config).map((p) => p.name));
    const after = new Set(inputPortsOf(node.type, patch.config).map((p) => p.name));
    edges = edges.flatMap((e) => {
      if (e.to !== id) return [e];
      const renamed = renames[e.toPort];
      if (renamed !== undefined && after.has(renamed)) return [{ ...e, toPort: renamed }];
      if (before.has(e.toPort) && !after.has(e.toPort)) return [];
      return [e];
    });
  }
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? next : n)), edges };
}

export function addNote(
  doc: DesignerDoc,
  position: XY,
  text = '',
): { doc: DesignerDoc; id: string } {
  const id = uniqueId('note', takenIds(doc));
  return { doc: { ...doc, notes: [...doc.notes, { id, text, position }] }, id };
}

export function updateNote(doc: DesignerDoc, id: string, text: string): DesignerDoc {
  return { ...doc, notes: doc.notes.map((n) => (n.id === id ? { ...n, text } : n)) };
}

// ---- copy / paste -----------------------------------------------------------------------------

export interface Clip {
  nodes: DNode[];
  edges: DEdge[];
  positions: Record<string, XY>;
  notes: DNote[];
}

/** Copy nodes (with the edges between them) and notes. Configuration only, never data. */
export function copySelection(
  doc: DesignerDoc,
  nodeIds: readonly string[],
  noteIds: readonly string[] = [],
): Clip | null {
  const ids = new Set(nodeIds);
  const nodes = doc.nodes.filter((n) => ids.has(n.id));
  const notes = doc.notes.filter((n) => noteIds.includes(n.id));
  if (nodes.length + notes.length === 0) return null;
  return structuredClone({
    nodes,
    edges: doc.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
    positions: Object.fromEntries(nodes.map((n) => [n.id, doc.positions[n.id] ?? [0, 0]])),
    notes,
  });
}

/** Paste with new ids, shifted by `offset`; internal edges follow the new ids. */
export function paste(
  doc: DesignerDoc,
  clip: Clip,
  offset: XY = [40, 40],
): { doc: DesignerDoc; nodeIds: string[]; noteIds: string[] } {
  const taken = takenIds(doc);
  const map = new Map<string, string>();
  const nodes: DNode[] = clip.nodes.map((n) => {
    const id = uniqueId(nodeSpec(n.type)?.idPrefix ?? 'node', taken);
    taken.add(id);
    map.set(n.id, id);
    return { ...structuredClone(n), id };
  });
  const positions = { ...doc.positions };
  for (const n of clip.nodes) {
    const p = clip.positions[n.id] ?? [0, 0];
    positions[map.get(n.id)!] = [p[0] + offset[0], p[1] + offset[1]];
  }
  const edges = clip.edges.map((e) => ({ ...e, from: map.get(e.from)!, to: map.get(e.to)! }));
  const notes: DNote[] = clip.notes.map((n) => {
    const id = uniqueId('note', taken);
    taken.add(id);
    return {
      ...structuredClone(n),
      id,
      position: [n.position[0] + offset[0], n.position[1] + offset[1]],
    };
  });
  return {
    doc: {
      ...doc,
      nodes: [...doc.nodes, ...nodes],
      edges: [...doc.edges, ...edges],
      notes: [...doc.notes, ...notes],
      positions,
    },
    nodeIds: nodes.map((n) => n.id),
    noteIds: notes.map((n) => n.id),
  };
}

// ---- key usages (spec §15.3: renaming a key used elsewhere is warned about) -------------------

function mentions(value: unknown, key: string): boolean {
  if (value === key) return true;
  if (Array.isArray(value)) return value.some((v) => mentions(v, key));
  if (isObj(value)) return Object.values(value).some((v) => mentions(v, key));
  return false;
}

function downstream(doc: DesignerDoc, start: readonly string[]): Set<string> {
  const out = new Set<string>();
  const stack = [...start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const e of doc.edges) {
      if (e.from === id && !out.has(e.to)) {
        out.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return out;
}

/** Nodes that use a slot key (input.excel). */
export function slotUsages(doc: DesignerDoc, slotKey: string): DNode[] {
  return doc.nodes.filter((n) => n.type === 'input.excel' && n.config.slot === slotKey);
}

/** Nodes below the slot's input.excel nodes whose config mentions the column key. */
export function columnUsages(doc: DesignerDoc, slotKey: string, columnKey: string): DNode[] {
  const below = downstream(
    doc,
    slotUsages(doc, slotKey).map((n) => n.id),
  );
  return doc.nodes.filter((n) => below.has(n.id) && mentions(n.config, columnKey));
}

/** Nodes using a param: `{ param }` values, `$key` in SQL, `{key}` in a file name. */
export function paramUsages(doc: DesignerDoc, key: string): DNode[] {
  const sqlRef = new RegExp(`\\$${key}(?![a-z0-9_])`);
  return doc.nodes.filter((n) => {
    if (JSON.stringify(n.config).includes(`"param":${JSON.stringify(key)}`)) return true;
    if (typeof n.config.sql === 'string' && sqlRef.test(n.config.sql)) return true;
    return typeof n.config.fileName === 'string' && n.config.fileName.includes(`{${key}}`);
  });
}

// ---- history ------------------------------------------------------------------------------------

export const HISTORY_LIMIT = 200;
const MERGE_MS = 1200;

export interface History {
  past: DesignerDoc[];
  present: DesignerDoc;
  future: DesignerDoc[];
  /** Edits with the same key in quick succession (typing in a field) form one undo step. */
  lastKey: string | null;
  lastAt: number;
}

export function history(doc: DesignerDoc): History {
  return { past: [], present: doc, future: [], lastKey: null, lastAt: 0 };
}

export function commit(
  h: History,
  next: DesignerDoc,
  mergeKey?: string,
  now = Date.now(),
): History {
  if (next === h.present) return h;
  const merge =
    mergeKey !== undefined &&
    mergeKey === h.lastKey &&
    now - h.lastAt < MERGE_MS &&
    h.past.length > 0;
  const past = merge ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], lastKey: mergeKey ?? null, lastAt: now };
}

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev,
    future: [h.present, ...h.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function redo(h: History): History {
  const [next, ...rest] = h.future;
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: rest, lastKey: null, lastAt: 0 };
}

// ---- auto-layout --------------------------------------------------------------------------------

export const NODE_WIDTH = 260;
const LAYER_GAP = 120;
const ROW_GAP = 48;

/** Estimated rendered height (header + one row per port). */
export function nodeHeight(n: DNode): number {
  const ports = Math.max(inputPortsOf(n.type, n.config).length, outputPortsOf(n.type).length, 1);
  return 92 + ports * 26;
}

/**
 * Layered layout, left → right (spec §15.3 "Auto-layout"): layer = longest path from a source;
 * order inside a layer by the average row of the predecessors (one barycentre sweep). Nodes never
 * overlap: rows are stacked with their estimated heights. Edges on a cycle are ignored.
 */
export function autoLayout(doc: DesignerDoc, origin: XY = [80, 80]): Record<string, XY> {
  const ids = doc.nodes.map((n) => n.id);
  const edges = doc.edges.filter((e, i) => !createsCycle(doc.edges.slice(0, i), e.from, e.to));
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) preds.get(e.to)?.push(e.from);
  const layer = new Map<string, number>();
  const depth = (id: string, seen: Set<string>): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return 0;
    seen.add(id);
    const d = Math.max(-1, ...(preds.get(id) ?? []).map((p) => depth(p, seen))) + 1;
    layer.set(id, d);
    return d;
  };
  for (const id of ids) depth(id, new Set());
  const layers: string[][] = [];
  for (const id of ids) (layers[layer.get(id) ?? 0] ??= []).push(id);
  const row = new Map<string, number>();
  layers.forEach((list, li) => {
    if (li > 0) {
      const score = (id: string) => {
        const ps = (preds.get(id) ?? []).map((p) => row.get(p) ?? 0);
        return ps.length > 0 ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.MAX_SAFE_INTEGER;
      };
      list.sort((a, b) => score(a) - score(b) || ids.indexOf(a) - ids.indexOf(b));
    }
    list.forEach((id, i) => row.set(id, i));
  });
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const out: Record<string, XY> = {};
  layers.forEach((list, li) => {
    let y = origin[1];
    for (const id of list) {
      out[id] = [origin[0] + li * (NODE_WIDTH + LAYER_GAP), y];
      y += nodeHeight(byId.get(id)!) + ROW_GAP;
    }
  });
  return out;
}
