/**
 * Diff of two flow definitions (spec §14.3), computed in the browser on the `definition` JSON
 * (flow configuration only, never personal data). Pure functions, no React.
 *
 * - nodes by `id`: added / removed / changed (`type`, `label` or `config`);
 * - edges as connections `from.fromPort -> to.toPort`: added / removed;
 * - params and inputSlots by `key`: added / removed / changed;
 * - `ui` (positions, sticky notes) is ignored; other top-level fields are reported by name.
 * A changed item carries a side-by-side line view of both JSON versions (keys sorted, multi-line
 * strings such as `code.sql` SQL shown one line per row).
 *
 * Definitions are read defensively (`unknown`): an old or invalid version still diffs.
 */

export type ChangeKind = 'added' | 'removed' | 'changed';

export interface DiffLine {
  text: string;
  /** `removed` only on the left side, `added` only on the right side. */
  change: 'same' | 'removed' | 'added';
}

/** One aligned row of the side-by-side view; null = no line on that side. */
export interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

export interface ItemDiff {
  key: string;
  kind: ChangeKind;
  /** Node `type` (nodes only), for display. */
  type?: string;
  /** Display label of the item (node label, param/slot label) of the newer side. */
  label?: string;
  /** Changed fields of a changed node: subset of type / label / config. */
  fields?: string[];
  /** Side-by-side lines, for changed items. */
  rows?: SideBySideRow[];
}

export interface EdgeRef {
  from: string;
  fromPort: string | null;
  to: string;
  toPort: string | null;
}

export interface EdgeDiff extends EdgeRef {
  kind: 'added' | 'removed';
}

export interface FlowDiff {
  nodes: ItemDiff[];
  edges: EdgeDiff[];
  params: ItemDiff[];
  inputSlots: ItemDiff[];
  /** Other top-level fields (e.g. schemaVersion) that differ; `ui` never appears. */
  other: string[];
  /** Nothing but `ui` differs (spec §14.3: "giống nhau về nội dung xử lý"). */
  identical: boolean;
}

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** JSON with object keys sorted at every level and LF line endings (stable comparison). */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * Canonical form used for both comparison and display: object keys sorted, and line endings in
 * strings normalized to LF (a CRLF-only difference, e.g. SQL pasted from Windows, is not a change).
 */
function sortKeys(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n');
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    const out: Rec = {};
    for (const k of Object.keys(value).sort()) {
      if (value[k] !== undefined) out[k] = sortKeys(value[k]);
    }
    return out;
  }
  return value;
}

const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

/**
 * Pretty-printed lines of a JSON value with sorted keys, 2-space indent. A string containing line
 * breaks is shown as a block (`"""` … `"""`) with one row per line so a changed SQL line is
 * highlighted on its own. Display only (not valid JSON).
 */
export function jsonLines(value: unknown): string[] {
  const lines: string[] = [];
  write(sortKeys(value), 0, '', '', lines);
  return lines;
}

function write(value: unknown, depth: number, prefix: string, suffix: string, out: string[]) {
  const pad = '  '.repeat(depth);
  // Strings are LF-normalized by sortKeys().
  if (typeof value === 'string' && value.includes('\n')) {
    out.push(`${pad}${prefix}"""`);
    for (const line of value.split('\n')) out.push(`${pad}  ${line}`);
    out.push(`${pad}"""${suffix}`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push(`${pad}${prefix}[]${suffix}`);
      return;
    }
    out.push(`${pad}${prefix}[`);
    value.forEach((v, i) => write(v, depth + 1, '', i < value.length - 1 ? ',' : '', out));
    out.push(`${pad}]${suffix}`);
    return;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      out.push(`${pad}${prefix}{}${suffix}`);
      return;
    }
    out.push(`${pad}${prefix}{`);
    keys.forEach((k, i) =>
      write(value[k], depth + 1, `${JSON.stringify(k)}: `, i < keys.length - 1 ? ',' : '', out),
    );
    out.push(`${pad}}${suffix}`);
    return;
  }
  out.push(`${pad}${prefix}${JSON.stringify(value) ?? 'null'}${suffix}`);
}

/** Above this many cells the LCS table is skipped (row-by-row comparison instead). */
const LCS_LIMIT = 4_000_000;

/** Line diff (LCS) aligned into side-by-side rows; replaced blocks are paired row by row. */
export function sideBySide(before: string[], after: string[]): SideBySideRow[] {
  type Op = { op: 'same' | 'del' | 'ins'; text: string };
  const ops: Op[] = [];
  // Common prefix / suffix first: a local edit in a very long text stays local even when the
  // middle part is too large for the LCS table.
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endA = before.length;
  let endB = after.length;
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) {
    endA--;
    endB--;
  }
  for (let i = 0; i < start; i++) ops.push({ op: 'same', text: before[i]! });
  const a = before.slice(start, endA);
  const b = after.slice(start, endB);
  const n = a.length;
  const m = b.length;
  if (n * m > LCS_LIMIT) {
    // Still too large: whole middle block replaced (rare: thousands of scattered changes).
    for (const text of a) ops.push({ op: 'del', text });
    for (const text of b) ops.push({ op: 'ins', text });
  } else {
    // lcs[i][j] = LCS length of a[i:] and b[j:]
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i]![j] =
          a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) {
        ops.push({ op: 'same', text: a[i]! });
        i++;
        j++;
      } else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
        ops.push({ op: 'ins', text: b[j]! });
        j++;
      } else {
        ops.push({ op: 'del', text: a[i]! });
        i++;
      }
    }
  }
  for (let i = endA; i < before.length; i++) ops.push({ op: 'same', text: before[i]! });

  const rows: SideBySideRow[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k]!;
    if (op.op === 'same') {
      rows.push({
        left: { text: op.text, change: 'same' },
        right: { text: op.text, change: 'same' },
      });
      k++;
      continue;
    }
    const dels: string[] = [];
    const ins: string[] = [];
    while (k < ops.length && ops[k]!.op !== 'same') {
      const o = ops[k]!;
      (o.op === 'del' ? dels : ins).push(o.text);
      k++;
    }
    for (let r = 0; r < Math.max(dels.length, ins.length); r++) {
      const d = dels[r];
      const a = ins[r];
      rows.push({
        left: d === undefined ? null : { text: d, change: 'removed' },
        right: a === undefined ? null : { text: a, change: 'added' },
      });
    }
  }
  return rows;
}

function byKey(list: unknown, field: 'id' | 'key'): Map<string, Rec> {
  const map = new Map<string, Rec>();
  asArray(list).forEach((item, i) => {
    if (!isRecord(item)) return;
    const k = str(item[field]) ?? `#${i}`;
    if (!map.has(k)) map.set(k, item);
  });
  return map;
}

/** Keyed list diff, in the order of the newer list (removed items last, in older order). */
function diffKeyed(
  before: unknown,
  after: unknown,
  field: 'id' | 'key',
  project: (item: Rec) => unknown,
  describe: (item: Rec) => Pick<ItemDiff, 'type' | 'label'>,
  fieldsOf?: (a: Rec, b: Rec) => string[],
): ItemDiff[] {
  const old = byKey(before, field);
  const neu = byKey(after, field);
  const out: ItemDiff[] = [];
  for (const [k, item] of neu) {
    const prev = old.get(k);
    if (!prev) {
      out.push({ key: k, kind: 'added', ...describe(item) });
      continue;
    }
    const a = project(prev);
    const b = project(item);
    if (same(a, b)) continue;
    out.push({
      key: k,
      kind: 'changed',
      ...describe(item),
      ...(fieldsOf ? { fields: fieldsOf(prev, item) } : {}),
      rows: sideBySide(jsonLines(a), jsonLines(b)),
    });
  }
  for (const [k, item] of old) {
    if (!neu.has(k)) out.push({ key: k, kind: 'removed', ...describe(item) });
  }
  return out;
}

const NODE_FIELDS = ['type', 'label', 'config'] as const;

function nodeView(n: Rec): Rec {
  return { type: n.type, label: n.label, config: isRecord(n.config) ? n.config : {} };
}

function edgeRef(e: unknown): EdgeRef | null {
  if (!isRecord(e)) return null;
  const from = str(e.from);
  const to = str(e.to);
  if (!from || !to) return null;
  return { from, fromPort: str(e.fromPort) ?? null, to, toPort: str(e.toPort) ?? null };
}

const edgeId = (e: EdgeRef) =>
  `${e.from}\u0000${e.fromPort ?? ''}\u0000${e.to}\u0000${e.toPort ?? ''}`;

function diffEdges(before: unknown, after: unknown): EdgeDiff[] {
  const collect = (list: unknown) => {
    const map = new Map<string, EdgeRef>();
    for (const e of asArray(list)) {
      const ref = edgeRef(e);
      if (ref) map.set(edgeId(ref), ref);
    }
    return map;
  };
  const old = collect(before);
  const neu = collect(after);
  const out: EdgeDiff[] = [];
  for (const [id, e] of neu) if (!old.has(id)) out.push({ ...e, kind: 'added' });
  for (const [id, e] of old) if (!neu.has(id)) out.push({ ...e, kind: 'removed' });
  return out;
}

const KNOWN_TOP = new Set(['nodes', 'edges', 'params', 'inputSlots', 'ui']);

export function diffDefinitions(before: unknown, after: unknown): FlowDiff {
  const a = isRecord(before) ? before : {};
  const b = isRecord(after) ? after : {};
  const nodes = diffKeyed(
    a.nodes,
    b.nodes,
    'id',
    nodeView,
    (n) => ({ ...(str(n.type) ? { type: str(n.type) } : {}), ...labelOf(n) }),
    (x, y) => NODE_FIELDS.filter((f) => !same(nodeView(x)[f], nodeView(y)[f])),
  );
  const params = diffKeyed(a.params, b.params, 'key', (p) => p, labelOf);
  const inputSlots = diffKeyed(a.inputSlots, b.inputSlots, 'key', (s) => s, labelOf);
  const edges = diffEdges(a.edges, b.edges);
  const other = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => !KNOWN_TOP.has(k) && !same(a[k], b[k]))
    .sort();
  return {
    nodes,
    edges,
    params,
    inputSlots,
    other,
    identical: nodes.length + edges.length + params.length + inputSlots.length + other.length === 0,
  };
}

function labelOf(item: Rec): { label?: string } {
  const l = str(item.label);
  return l && l.trim() ? { label: l.trim() } : {};
}
