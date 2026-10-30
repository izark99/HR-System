import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodePlugins } from '../../../engine/nodes';
import { NODE_TYPES } from '../catalog';
import {
  addNode,
  addNote,
  autoLayout,
  columnUsages,
  commit,
  connect,
  copySelection,
  edgeId,
  fromDefinition,
  history,
  HISTORY_LIMIT,
  moveElements,
  nodeHeight,
  NODE_WIDTH,
  paramUsages,
  paste,
  redo,
  removeElements,
  slotUsages,
  sqlWords,
  toDefinition,
  undo,
  updateNode,
  updateNote,
  type DesignerDoc,
} from '../model';

const FLOW = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../../../fixtures/payroll-timesheet/flow.json'),
    'utf8',
  ),
) as Record<string, unknown>;
const TEXTS = { sheetName: 'Sheet1', previewTitle: 'Xem trước', firstSlot: 'bang_luong' };

describe('catalog', () => {
  it('covers every engine plugin with the same ports for the default config', () => {
    expect(NODE_TYPES.map((s) => s.type).sort()).toEqual(Object.keys(nodePlugins).sort());
    for (const spec of NODE_TYPES) {
      const plugin = nodePlugins[spec.type]!;
      const parsed = plugin.configSchema.safeParse(spec.defaults(TEXTS));
      const config: unknown = parsed.success ? (parsed.data as unknown) : spec.defaults(TEXTS);
      const engineIn = plugin.inputPorts?.(config) ?? plugin.inputs;
      expect(spec.inputs(spec.defaults(TEXTS)), spec.type).toEqual(engineIn);
      expect(spec.outputs, spec.type).toEqual(plugin.outputs);
    }
  });

  it('dynamic ports follow the config like the plugins do', () => {
    const union = NODE_TYPES.find((s) => s.type === 'transform.union')!;
    const cfg = { inputCount: 4 };
    expect(union.inputs(cfg)).toEqual(nodePlugins['transform.union']!.inputPorts!(cfg));
    const excel = NODE_TYPES.find((s) => s.type === 'output.excel')!;
    const sheets = {
      sheets: [
        { name: 'A', port: 'x' },
        { name: 'B', port: 'y' },
        { name: 'C', port: 'x' },
      ],
    };
    expect(excel.inputs(sheets)).toEqual(nodePlugins['output.excel']!.inputPorts!(sheets as never));
  });
});

describe('definition round trip', () => {
  it('fromDefinition → toDefinition keeps the business content and fills edge ports', () => {
    const doc = fromDefinition(FLOW);
    const out = toDefinition(doc);
    expect(out.nodes).toEqual(FLOW.nodes);
    expect(out.inputSlots).toEqual(FLOW.inputSlots);
    expect(out.params).toEqual(FLOW.params);
    expect(out.edges).toContainEqual({
      from: 'in_luong',
      fromPort: 'table',
      to: 'cmp',
      toPort: 'left',
    });
    expect(Object.keys((out.ui as { positions: object }).positions).sort()).toEqual(
      ['cmp', 'in_cc', 'in_luong', 'out'].sort(),
    );
    // Stable: a second round trip changes nothing.
    expect(toDefinition(fromDefinition(out))).toEqual(out);
  });

  it('keeps notes and unknown ui keys; drops broken notes', () => {
    const doc = fromDefinition({
      schemaVersion: 1,
      nodes: [],
      ui: {
        zoom: 2,
        notes: [{ id: 'note_1', text: 'Ghi chú', position: [1, 2] }, { id: 'bad' }],
      },
    });
    expect(doc.notes).toEqual([{ id: 'note_1', text: 'Ghi chú', position: [1, 2] }]);
    expect(toDefinition(doc).ui).toEqual({
      zoom: 2,
      positions: {},
      notes: [{ id: 'note_1', text: 'Ghi chú', position: [1, 2] }],
    });
  });
});

function blank(): DesignerDoc {
  return fromDefinition({ schemaVersion: 1, nodes: [] });
}

describe('graph edits', () => {
  it('adds nodes with unique ids and default configs', () => {
    let d = blank();
    const a = addNode(d, 'transform.filter', [0, 0], TEXTS);
    d = a.doc;
    const b = addNode(d, 'transform.filter', [10, 0], TEXTS);
    expect([a.id, b.id]).toEqual(['filter_1', 'filter_2']);
    expect(b.doc.nodes[1]!.config).toEqual({ match: 'all', conditions: [], normalizeText: true });
    expect(b.doc.positions.filter_2).toEqual([10, 0]);
  });

  it('refuses cycles, a second edge on an input port, self loops and unknown ports (AC-B3-32)', () => {
    let d = fromDefinition(FLOW);
    const s = addNode(d, 'transform.sort', [0, 0], TEXTS);
    d = s.doc;
    const c1 = connect(d, { from: 'in_luong', fromPort: 'table', to: s.id, toPort: 'in' });
    expect(c1.ok).toBe(true);
    d = c1.ok ? c1.doc : d;
    expect(connect(d, { from: 'in_cc', fromPort: 'table', to: s.id, toPort: 'in' })).toEqual({
      ok: false,
      problem: 'portTaken',
    });
    const s2 = addNode(d, 'transform.sort', [0, 0], TEXTS);
    d = s2.doc;
    const c2 = connect(d, { from: s.id, fromPort: 'out', to: s2.id, toPort: 'in' });
    d = c2.ok ? c2.doc : d;
    const s3 = addNode(d, 'transform.join', [0, 0], TEXTS);
    d = s3.doc;
    const c3 = connect(d, { from: s2.id, fromPort: 'out', to: s3.id, toPort: 'left' });
    d = c3.ok ? c3.doc : d;
    // s3 → s (s already has its input) is portTaken; join right ← s3 would be a self loop.
    expect(connect(d, { from: s3.id, fromPort: 'out', to: s3.id, toPort: 'right' })).toEqual({
      ok: false,
      problem: 'self',
    });
    const j = addNode(d, 'transform.join', [0, 0], TEXTS);
    d = j.doc;
    const c4 = connect(d, { from: s3.id, fromPort: 'out', to: j.id, toPort: 'left' });
    d = c4.ok ? c4.doc : d;
    expect(connect(d, { from: j.id, fromPort: 'out', to: s3.id, toPort: 'right' })).toEqual({
      ok: false,
      problem: 'cycle',
    });
    expect(connect(d, { from: j.id, fromPort: 'nope', to: s3.id, toPort: 'right' })).toEqual({
      ok: false,
      problem: 'unknownPort',
    });
  });

  it('removing a node removes its edges and position; edges can be removed alone', () => {
    const d = fromDefinition(FLOW);
    const r = removeElements(d, { nodes: ['cmp'] });
    expect(r.nodes.map((n) => n.id)).toEqual(['in_luong', 'in_cc', 'out']);
    expect(r.edges).toEqual([]);
    expect(r.positions.cmp).toBeUndefined();
    const e = removeElements(d, { edges: [edgeId(d.edges[0]!)] });
    expect(e.edges).toHaveLength(d.edges.length - 1);
  });

  it('updateNode drops edges of removed ports and moves renamed ones', () => {
    const d = fromDefinition(FLOW);
    const out = d.nodes.find((n) => n.id === 'out')!;
    const sheets = (out.config.sheets as { name: string; port: string }[]).slice();
    const renamed = sheets.map((s) => (s.port === 'summary' ? { ...s, port: 'tong_hop' } : s));
    const r1 = updateNode(
      d,
      'out',
      { config: { ...out.config, sheets: renamed } },
      {
        summary: 'tong_hop',
      },
    );
    expect(r1.edges.find((e) => e.fromPort === 'summary')!.toPort).toBe('tong_hop');
    const r2 = updateNode(d, 'out', { config: { ...out.config, sheets: sheets.slice(1) } });
    expect(r2.edges.some((e) => e.toPort === 'summary')).toBe(false);
    expect(r2.edges).toHaveLength(d.edges.length - 1);
    const r3 = updateNode(d, 'cmp', { label: '' });
    expect(r3.nodes.find((n) => n.id === 'cmp')!.label).toBeUndefined();
  });

  it('copy/paste keeps internal edges only, with new ids (AC-B3-43)', () => {
    const d = fromDefinition(FLOW);
    const clip = copySelection(d, ['in_luong', 'cmp'])!;
    expect(clip.edges).toEqual([
      { from: 'in_luong', fromPort: 'table', to: 'cmp', toPort: 'left' },
    ]);
    const p = paste(d, clip);
    expect(p.nodeIds).toEqual(['input_1', 'compare_1']);
    const added = p.doc.edges.slice(d.edges.length);
    expect(added).toEqual([
      { from: 'input_1', fromPort: 'table', to: 'compare_1', toPort: 'left' },
    ]);
    expect(p.doc.positions.input_1).toEqual([
      d.positions.in_luong![0] + 40,
      d.positions.in_luong![1] + 40,
    ]);
    // Pasting again gives fresh ids again.
    expect(paste(p.doc, clip).nodeIds).toEqual(['input_2', 'compare_2']);
  });

  it('notes: add, edit, move, remove; never in nodes', () => {
    const n = addNote(blank(), [5, 5], 'Ghi chú');
    let d = updateNote(n.doc, n.id, 'Sửa');
    d = moveElements(d, { [n.id]: [9, 9] });
    expect(d.notes).toEqual([{ id: 'note_1', text: 'Sửa', position: [9, 9] }]);
    expect(d.nodes).toEqual([]);
    expect(removeElements(d, { notes: [n.id] }).notes).toEqual([]);
  });
});

describe('key usages (AC-B3-37)', () => {
  it('lists nodes using a slot, a slot column, a param', () => {
    const d = fromDefinition(FLOW);
    expect(slotUsages(d, 'bang_luong').map((n) => n.id)).toEqual(['in_luong']);
    expect(columnUsages(d, 'cham_cong', 'ma_nv').map((n) => n.id)).toEqual(['cmp']);
    expect(columnUsages(d, 'cham_cong', 'khong_co').map((n) => n.id)).toEqual([]);
    expect(paramUsages(d, 'ky_luong').map((n) => n.id)).toEqual(['out']);
    const sql = addNode(d, 'code.sql', [0, 0], TEXTS);
    const withSql = updateNode(sql.doc, sql.id, {
      config: { inputs: [{ port: 'a' }], sql: 'SELECT * FROM a WHERE x = $ky_luong' },
    });
    expect(paramUsages(withSql, 'ky_luong').map((n) => n.id)).toEqual(['out', sql.id]);
    expect(paramUsages(withSql, 'ky')).toEqual([]);
  });
});

describe('sqlWords', () => {
  it('finds identifiers, quoted names; skips strings, comments, params', () => {
    const w = sqlWords(
      `SELECT Ma_NV, "Họ tên", 'cong' AS x -- ot\n/* phep */ FROM t WHERE y = $khong_luong`,
    );
    expect(w.has('ma_nv')).toBe(true);
    expect(w.has('Họ tên')).toBe(true);
    for (const k of ['cong', 'ot', 'phep', 'khong_luong']) expect(w.has(k), k).toBe(false);
  });
});

describe('history (AC-B3-42)', () => {
  it('undo/redo step through commits; a new commit clears redo', () => {
    let h = history(blank());
    const a = addNode(h.present, 'transform.sort', [0, 0], TEXTS);
    h = commit(h, a.doc);
    h = commit(h, moveElements(h.present, { [a.id]: [50, 50] }));
    h = undo(h);
    expect(h.present.positions[a.id]).toEqual([0, 0]);
    h = redo(h);
    expect(h.present.positions[a.id]).toEqual([50, 50]);
    h = undo(undo(h));
    expect(h.present.nodes).toEqual([]);
    expect(undo(h)).toBe(h);
    h = commit(h, addNote(h.present, [0, 0]).doc);
    expect(h.future).toEqual([]);
  });

  it('typing in one field merges into one step; other keys do not', () => {
    let h = history(blank());
    const a = addNode(h.present, 'transform.sort', [0, 0], TEXTS);
    h = commit(h, a.doc, undefined, 0);
    for (const [i, label] of ['a', 'ab', 'abc'].entries()) {
      h = commit(h, updateNode(h.present, a.id, { label }), 'label', 100 + i * 100);
    }
    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.present.nodes[0]!.label).toBeUndefined();
  });

  it(`keeps at least 100 steps (limit ${HISTORY_LIMIT})`, () => {
    let h = history(blank());
    for (let i = 0; i < 250; i++) h = commit(h, addNote(h.present, [i, i]).doc);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < 150; i++) h = undo(h);
    expect(h.present.notes).toHaveLength(100);
  });
});

describe('autoLayout (AC-B3-44)', () => {
  it('places nodes left to right by dependency without overlaps', () => {
    const d = fromDefinition(FLOW);
    const pos = autoLayout(d);
    expect(pos.in_luong![0]).toBeLessThan(pos.cmp![0]);
    expect(pos.cmp![0]).toBeLessThan(pos.out![0]);
    expect(pos.in_luong![0]).toBe(pos.in_cc![0]);
    const boxes = d.nodes.map((n) => ({
      x: pos[n.id]![0],
      y: pos[n.id]![1],
      w: NODE_WIDTH,
      h: nodeHeight(n),
    }));
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });
});
