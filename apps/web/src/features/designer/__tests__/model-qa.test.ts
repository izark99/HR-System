import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addNode,
  addNote,
  autoLayout,
  columnUsages,
  commit,
  connect,
  copySelection,
  createsCycle,
  edgeId,
  fromDefinition,
  history,
  nodeHeight,
  NODE_WIDTH,
  paramUsages,
  paste,
  redo,
  removeElements,
  toDefinition,
  undo,
  updateNode,
  type DEdge,
  type DesignerDoc,
} from '../model';

/** QA (R3): graph operations, paste, history and key usages beyond model.test.ts. Fake config. */
const FLOW = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../../../fixtures/payroll-timesheet/flow.json'),
    'utf8',
  ),
) as Record<string, unknown>;
const TEXTS = { sheetName: 'Sheet1', previewTitle: 'Xem trước', firstSlot: 'bang_luong' };
const blank = () => fromDefinition({ schemaVersion: 1, nodes: [] });

function ok(r: ReturnType<typeof connect>): DesignerDoc {
  if (!r.ok) throw new Error(`connect refused: ${r.problem}`);
  return r.doc;
}

describe('graph: fan-out, duplicates, deleted ends', () => {
  it('one output port may feed several input ports (fan-out), each input port only once', () => {
    let d = fromDefinition(FLOW);
    const a = addNode(d, 'transform.sort', [0, 0], TEXTS);
    const b = addNode(a.doc, 'transform.sort', [0, 0], TEXTS);
    d = b.doc;
    d = ok(connect(d, { from: 'in_luong', fromPort: 'table', to: a.id, toPort: 'in' }));
    d = ok(connect(d, { from: 'in_luong', fromPort: 'table', to: b.id, toPort: 'in' }));
    expect(d.edges.filter((e) => e.from === 'in_luong')).toHaveLength(3);
    // The exact same edge again is the "port taken" case, not a silent duplicate.
    expect(connect(d, { from: 'in_luong', fromPort: 'table', to: a.id, toPort: 'in' })).toEqual({
      ok: false,
      problem: 'portTaken',
    });
  });

  it('a node that was deleted cannot be a connect endpoint (stale drag)', () => {
    const d = removeElements(fromDefinition(FLOW), { nodes: ['cmp'] });
    expect(connect(d, { from: 'in_luong', fromPort: 'table', to: 'cmp', toPort: 'left' })).toEqual({
      ok: false,
      problem: 'unknownPort',
    });
  });

  it('after a port disappears (union inputCount 3 -> 2) its edge is gone and the port can be reused', () => {
    let d = blank();
    const u = addNode(d, 'transform.union', [0, 0], TEXTS);
    const i1 = addNode(u.doc, 'input.excel', [0, 0], TEXTS);
    d = i1.doc;
    d = updateNode(d, u.id, { config: { inputCount: 3 } });
    d = ok(connect(d, { from: i1.id, fromPort: 'table', to: u.id, toPort: 'in_3' }));
    d = updateNode(d, u.id, { config: { inputCount: 2 } });
    expect(d.edges).toEqual([]);
    d = updateNode(d, u.id, { config: { inputCount: 3 } });
    expect(connect(d, { from: i1.id, fromPort: 'table', to: u.id, toPort: 'in_3' }).ok).toBe(true);
  });

  it('cycle detection on a diamond and a long path; self loop; unrelated branches are fine', () => {
    const e = (from: string, to: string): DEdge => ({ from, fromPort: 'out', to, toPort: 'in' });
    const diamond = [e('a', 'b'), e('a', 'c'), e('b', 'd'), e('c', 'd')];
    expect(createsCycle(diamond, 'd', 'a')).toBe(true);
    expect(createsCycle(diamond, 'b', 'c')).toBe(false);
    expect(createsCycle(diamond, 'a', 'a')).toBe(true);
    const long = Array.from({ length: 5000 }, (_, i) => e(`n${i}`, `n${i + 1}`));
    expect(createsCycle(long, 'n5000', 'n0')).toBe(true);
    expect(createsCycle(long, 'n0', 'n5000')).toBe(false);
  });

  it('removing a node and undoing restores its edges and position', () => {
    const d = fromDefinition(FLOW);
    let h = history(d);
    h = commit(h, removeElements(h.present, { nodes: ['cmp'] }));
    expect(h.present.edges.some((x) => x.from === 'cmp' || x.to === 'cmp')).toBe(false);
    h = undo(h);
    expect(h.present).toEqual(d);
    h = redo(h);
    expect(h.present.nodes.map((n) => n.id)).not.toContain('cmp');
  });

  it('removing nothing returns the same object (no phantom undo step)', () => {
    const d = fromDefinition(FLOW);
    expect(removeElements(d, {})).toBe(d);
    const h = history(d);
    expect(commit(h, removeElements(d, { nodes: [] })).past).toHaveLength(0);
  });

  it('removing an edge by id leaves its nodes and the other edges', () => {
    const d = fromDefinition(FLOW);
    const target = d.edges.find((x) => x.to === 'cmp' && x.toPort === 'left')!;
    const r = removeElements(d, { edges: [edgeId(target)] });
    expect(r.nodes).toHaveLength(d.nodes.length);
    expect(r.edges).toHaveLength(d.edges.length - 1);
  });
});

describe('definition round trip keeps what is wrong so the Admin can fix it', () => {
  it('duplicate node ids, dangling edges and unknown node types are not dropped on save', () => {
    const def = {
      schemaVersion: 1,
      nodes: [
        { id: 'a', type: 'transform.sort', config: { by: [] } },
        { id: 'a', type: 'transform.sort', config: { by: [] } },
        { id: 'z', type: 'transform.future', config: { x: 1 } },
      ],
      edges: [{ from: 'ghost', fromPort: 'out', to: 'a', toPort: 'in' }],
    };
    const out = toDefinition(fromDefinition(def));
    expect((out.nodes as unknown[]).length).toBe(3);
    expect(out.edges).toEqual(def.edges);
    expect((out.nodes as { config: unknown }[])[2]!.config).toEqual({ x: 1 });
  });

  it('an empty draft round-trips (saving an empty flow is allowed)', () => {
    const out = toDefinition(fromDefinition({ schemaVersion: 1, nodes: [] }));
    expect(out).toMatchObject({
      schemaVersion: 1,
      nodes: [],
      edges: [],
      params: [],
      inputSlots: [],
    });
  });

  it('non-object definitions become an empty document, not a crash', () => {
    for (const bad of [null, undefined, 'x', 42, [], { nodes: 'x', edges: 7, ui: 'y' }]) {
      expect(toDefinition(fromDefinition(bad)).nodes).toEqual([]);
    }
  });

  it('positions of deleted nodes are not kept in the saved ui', () => {
    const d = removeElements(fromDefinition(FLOW), { nodes: ['out'] });
    expect(Object.keys((toDefinition(d).ui as { positions: object }).positions)).not.toContain(
      'out',
    );
  });
});

describe('copy / paste', () => {
  it('pasting into a document where the source nodes were deleted still works', () => {
    const d = fromDefinition(FLOW);
    const clip = copySelection(d, ['in_luong', 'cmp'])!;
    const gone = removeElements(d, { nodes: ['in_luong', 'cmp'] });
    const p = paste(gone, clip);
    expect(p.doc.nodes.map((n) => n.id)).toContain('input_1');
    expect(p.doc.edges.some((e) => e.from === 'input_1' && e.to === 'compare_1')).toBe(true);
  });

  it('mutating the paste does not touch the clipboard or the source (deep copy)', () => {
    const d = fromDefinition(FLOW);
    const clip = copySelection(d, ['cmp'])!;
    const p = paste(d, clip);
    const copy = p.doc.nodes.find((n) => n.id === p.nodeIds[0])!;
    (copy.config as { keys: unknown[] }).keys.length = 0;
    expect(
      (d.nodes.find((n) => n.id === 'cmp')!.config as { keys: unknown[] }).keys.length,
    ).toBeGreaterThan(0);
    expect(clip.nodes[0]!.config).toEqual(d.nodes.find((n) => n.id === 'cmp')!.config);
  });

  it('copy of nothing is null; notes alone can be copied; edges to unselected nodes are not carried', () => {
    const d = fromDefinition(FLOW);
    expect(copySelection(d, [], [])).toBeNull();
    const n = addNote(d, [1, 2], 'hi');
    const c = copySelection(n.doc, [], [n.id])!;
    expect(c.nodes).toEqual([]);
    expect(paste(n.doc, c).doc.notes).toHaveLength(2);
    expect(copySelection(d, ['cmp'])!.edges).toEqual([]);
  });

  it('a pasted node id never collides with an existing node or note id', () => {
    let d = blank();
    d = addNote(d, [0, 0]).doc; // note_1
    d = addNode(d, 'transform.sort', [0, 0], TEXTS).doc; // sort_1
    const clip = copySelection(d, ['sort_1'], ['note_1'])!;
    const p = paste(paste(d, clip).doc, clip);
    const ids = [...p.doc.nodes.map((n) => n.id), ...p.doc.notes.map((n) => n.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('history across forms', () => {
  it('param edits and slot edits are separate steps; undo walks back through both', () => {
    let h = history(fromDefinition(FLOW));
    h = commit(h, { ...h.present, params: [...h.present.params, { key: 'x' }] }, 'params', 0);
    h = commit(h, { ...h.present, inputSlots: [] }, 'slots:remove', 5000);
    h = undo(h);
    expect(h.present.inputSlots).toHaveLength(2);
    expect(h.present.params).toHaveLength(2);
    h = undo(h);
    expect(h.present.params).toHaveLength(1);
  });

  it('an edit with a new key after typing starts a new step even within the merge window', () => {
    let h = history(blank());
    const a = addNode(h.present, 'transform.sort', [0, 0], TEXTS);
    h = commit(h, a.doc);
    h = commit(h, updateNode(h.present, a.id, { label: 'A' }), `${a.id}:label`, 0);
    h = commit(h, updateNode(h.present, a.id, { config: { by: [] } }), `${a.id}:by`, 100);
    expect(h.past).toHaveLength(3);
  });

  it('typing resumes as a new step after an undo (no merge into a redo-able state)', () => {
    let h = history(blank());
    const a = addNode(h.present, 'transform.sort', [0, 0], TEXTS);
    h = commit(h, a.doc);
    h = commit(h, updateNode(h.present, a.id, { label: 'A' }), 'k', 0);
    h = undo(h);
    h = commit(h, updateNode(h.present, a.id, { label: 'B' }), 'k', 50);
    expect(h.future).toEqual([]);
    expect(h.present.nodes[0]!.label).toBe('B');
    expect(undo(h).present.nodes[0]!.label).toBeUndefined();
  });

  it('documents: two discrete "add" commits with the same key within 1.2 s share one undo step', () => {
    // ConfigPanel.tsx uses the fixed key 'slots:add' (and ParamsForm 'params') for discrete actions.
    let h = history(blank());
    const withSlot = (d: DesignerDoc, k: string): DesignerDoc => ({
      ...d,
      inputSlots: [...d.inputSlots, { key: k }],
    });
    h = commit(h, withSlot(h.present, 'a'), undefined, 0);
    h = commit(h, withSlot(h.present, 'b'), 'slots:add', 100);
    h = commit(h, withSlot(h.present, 'c'), 'slots:add', 200);
    // Documented behaviour of the model: the 2nd and 3rd adds merged. One undo removes both.
    expect(undo(h).present.inputSlots).toHaveLength(1);
  });
});

describe('key usages', () => {
  const sqlDoc = () => {
    const d = fromDefinition(FLOW);
    const n = addNode(d, 'code.sql', [0, 0], TEXTS);
    return {
      id: n.id,
      doc: {
        ...updateNode(n.doc, n.id, {
          config: { inputs: [{ port: 'a' }], sql: 'SELECT ma_nv FROM a WHERE x = $ky_luong' },
        }),
        edges: [...n.doc.edges, { from: 'in_luong', fromPort: 'table', to: n.id, toPort: 'a' }],
      },
    };
  };

  describe('KNOWN BUG (remove it.fails once fixed)', () => {
    // model.ts paramUsages: new RegExp(`\\$${key}...`) without escaping the key.
    it.fails(
      'paramUsages with regex metacharacters in the key neither throws nor finds anything',
      () => {
        const { doc } = sqlDoc();
        for (const key of ['so_ngay(', '[', 'a+', '\\', '*', '(?<', '$']) {
          expect(paramUsages(doc, key), key).toEqual([]);
        }
      },
    );
    it.fails('a "." in the key is literal: key "a.b" does not match $axb', () => {
      const { doc, id } = sqlDoc();
      const d = updateNode(doc, id, {
        config: { inputs: [{ port: 'a' }], sql: 'SELECT $axb AS x FROM a' },
      });
      expect(paramUsages(d, 'a.b')).toEqual([]);
    });
    // columnUsages only looks for the key as a whole config value; a column named inside the SQL
    // text of a downstream code.sql node is not listed, so the rename warning (AC-B3-37) misses it.
    it.fails(
      'columnUsages lists a downstream code.sql node that names the column in its SQL',
      () => {
        const { doc, id } = sqlDoc();
        expect(columnUsages(doc, 'bang_luong', 'ma_nv').map((n) => n.id)).toContain(id);
      },
    );
  });

  it('paramUsages: $ky is not $ky_luong; {key} in a file name; { param } values', () => {
    const { doc } = sqlDoc();
    expect(paramUsages(doc, 'ky')).toEqual([]);
    expect(paramUsages(doc, 'ky_luong').map((n) => n.id)).toContain('out');
  });
});

describe('autoLayout on awkward graphs', () => {
  const overlap = (d: DesignerDoc, pos: Record<string, [number, number]>) => {
    const boxes = d.nodes.map((n) => ({
      x: pos[n.id]![0],
      y: pos[n.id]![1],
      w: NODE_WIDTH,
      h: nodeHeight(n),
    }));
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true;
      }
    }
    return false;
  };

  it('a draft loaded with a cycle is laid out without hanging or overlapping', () => {
    const d = fromDefinition({
      schemaVersion: 1,
      nodes: [
        { id: 'a', type: 'transform.sort', config: { by: [] } },
        { id: 'b', type: 'transform.sort', config: { by: [] } },
        { id: 'c', type: 'transform.sort', config: { by: [] } },
      ],
      edges: [
        { from: 'a', fromPort: 'out', to: 'b', toPort: 'in' },
        { from: 'b', fromPort: 'out', to: 'c', toPort: 'in' },
        { from: 'c', fromPort: 'out', to: 'a', toPort: 'in' },
      ],
    });
    const pos = autoLayout(d);
    expect(Object.keys(pos).sort()).toEqual(['a', 'b', 'c']);
    expect(overlap(d, pos)).toBe(false);
  });

  it('300 nodes (wide fan-out + a 100-deep chain) are laid out without overlap, within 2 s', () => {
    let d = blank();
    const first = addNode(d, 'input.excel', [0, 0], TEXTS);
    d = first.doc;
    for (let i = 0; i < 200; i++) {
      const n = addNode(d, 'transform.sort', [0, 0], TEXTS);
      d = ok(connect(n.doc, { from: first.id, fromPort: 'table', to: n.id, toPort: 'in' }));
    }
    let prev = first.id;
    let prevPort = 'table';
    for (let i = 0; i < 99; i++) {
      const n = addNode(d, 'transform.filter', [0, 0], TEXTS);
      d = ok(connect(n.doc, { from: prev, fromPort: prevPort, to: n.id, toPort: 'in' }));
      prev = n.id;
      prevPort = 'out';
    }
    const t0 = performance.now();
    const pos = autoLayout(d);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(overlap(d, pos)).toBe(false);
  });

  it('an isolated node and an empty document', () => {
    expect(autoLayout(blank())).toEqual({});
    const one = addNode(blank(), 'input.excel', [0, 0], TEXTS).doc;
    expect(Object.keys(autoLayout(one))).toEqual(['input_1']);
  });
});
