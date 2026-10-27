/** Version diff (spec §14.3, AC-B3-71..73) and validity ranges (§14.1, §14.4). Fake configs only. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffDefinitions, jsonLines, sideBySide, stableStringify } from './version-diff';
import {
  findGaps,
  findOverlap,
  isEffectiveOn,
  newGaps,
  openPreviousVersion,
  previousDay,
  simulatePublish,
  type RangeVersion,
} from './version-ranges';

type Def = {
  nodes: { id: string; type: string; label?: string; config: Record<string, unknown> }[];
  edges: { from: string; fromPort?: string; to: string; toPort?: string }[];
  inputSlots: { key: string; label: string }[];
  params: { key: string; label: string }[];
  ui?: unknown;
};

const FLOW = resolve(import.meta.dirname, '../../../../../../fixtures/payroll-timesheet/flow.json');
const base = (): Def => JSON.parse(readFileSync(FLOW, 'utf8')) as Def;

describe('diffDefinitions', () => {
  it('AC-B3-71: added filter, removed/added edges, OT tolerance 1 -> 5, renamed slot label', () => {
    const v1 = base();
    const v2 = base();
    v2.nodes.push({
      id: 'loc_cn',
      type: 'transform.filter',
      label: 'Lọc chi nhánh',
      config: { match: 'all', conditions: [] },
    });
    v2.edges = v2.edges.filter((e) => !(e.from === 'in_luong' && e.to === 'cmp'));
    v2.edges.push(
      { from: 'in_luong', to: 'loc_cn' },
      { from: 'loc_cn', to: 'cmp', toPort: 'left' },
    );
    const cmp = v2.nodes.find((n) => n.id === 'cmp')!;
    (cmp.config.metrics as { left: string; tolerance: string }[]).find(
      (m) => m.left === 'ot',
    )!.tolerance = '5';
    v2.inputSlots[0]!.label = 'Bảng lương các chi nhánh';

    const d = diffDefinitions(v1, v2);
    expect(d.identical).toBe(false);
    expect(d.nodes.map((n) => [n.key, n.kind])).toEqual([
      ['cmp', 'changed'],
      ['loc_cn', 'added'],
    ]);
    const changed = d.nodes[0]!;
    expect(changed.fields).toEqual(['config']);
    const marked = changed.rows!.filter(
      (r) => r.left?.change !== 'same' || r.right?.change !== 'same',
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]!.left?.change).toBe('removed');
    expect(marked[0]!.left?.text).toContain('"tolerance": "1"');
    expect(marked[0]!.right?.change).toBe('added');
    expect(marked[0]!.right?.text).toContain('"tolerance": "5"');
    // Context lines are shared on both sides.
    expect(
      changed.rows!.some((r) => r.left?.text.includes('"left": "ot"') && r.left.change === 'same'),
    ).toBe(true);

    expect(d.edges).toEqual([
      { kind: 'added', from: 'in_luong', fromPort: null, to: 'loc_cn', toPort: null },
      { kind: 'added', from: 'loc_cn', fromPort: null, to: 'cmp', toPort: 'left' },
      { kind: 'removed', from: 'in_luong', fromPort: null, to: 'cmp', toPort: 'left' },
    ]);
    expect(d.inputSlots.map((s) => [s.key, s.kind, s.label])).toEqual([
      ['bang_luong', 'changed', 'Bảng lương các chi nhánh'],
    ]);
    expect(d.params).toEqual([]);
    expect(d.other).toEqual([]);
  });

  it('AC-B3-72: only ui (positions, sticky notes) differs → identical', () => {
    const v1 = base();
    v1.ui = { positions: { cmp: { x: 1, y: 2 } } };
    const v2 = base();
    v2.ui = { positions: { cmp: { x: 300, y: 40 } }, notes: [{ id: 'n1', text: 'Ghi chú' }] };
    // Same content with keys in another order is not a change either.
    v2.nodes = v2.nodes.map((n) => ({
      config: n.config,
      type: n.type,
      id: n.id,
      ...(n.label ? { label: n.label } : {}),
    }));
    const d = diffDefinitions(v1, v2);
    expect(d.identical).toBe(true);
  });

  it('AC-B3-73: code.sql SQL is shown line by line; only the changed line is marked', () => {
    const sql1 = 'SELECT ma_nv,\n  cong\nFROM luong\nWHERE cong > 0';
    const sql2 = 'SELECT ma_nv,\n  cong\nFROM luong\nWHERE cong >= 1';
    const def = (sql: string) => ({
      schemaVersion: 1,
      nodes: [{ id: 'q', type: 'code.sql', config: { sql } }],
    });
    const [node] = diffDefinitions(def(sql1), def(sql2)).nodes;
    expect(node!.kind).toBe('changed');
    const texts = node!.rows!.map((r) => r.left?.text.trim());
    expect(texts).toContain('FROM luong');
    const changed = node!.rows!.filter((r) => r.left?.change === 'removed');
    expect(changed.map((r) => [r.left!.text.trim(), r.right!.text.trim()])).toEqual([
      ['WHERE cong > 0', 'WHERE cong >= 1'],
    ]);
  });

  it('removed node / param, changed type and label, other top-level fields', () => {
    const a = {
      schemaVersion: 1,
      nodes: [
        { id: 'x', type: 'transform.sort', config: {} },
        { id: 'y', type: 'transform.select', config: {} },
      ],
      params: [{ key: 'p', label: 'P' }],
    };
    const b = {
      schemaVersion: 2,
      nodes: [{ id: 'x', type: 'transform.dedupe', label: 'Lọc trùng', config: {} }],
    };
    const d = diffDefinitions(a, b);
    expect(d.nodes.map((n) => [n.key, n.kind, n.fields ?? null])).toEqual([
      ['x', 'changed', ['type', 'label']],
      ['y', 'removed', null],
    ]);
    expect(d.params.map((p) => [p.key, p.kind])).toEqual([['p', 'removed']]);
    expect(d.other).toEqual(['schemaVersion']);
  });

  it('tolerates invalid definitions', () => {
    expect(diffDefinitions(null, { nodes: 'x' }).identical).toBe(true);
    expect(diffDefinitions({ nodes: [1, { type: 'a.b' }] }, {}).nodes).toHaveLength(1);
  });
});

describe('json lines and side-by-side', () => {
  it('sorts keys at every level and is stable', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(jsonLines({ b: [1, 2], a: {} })).toEqual([
      '{',
      '  "a": {},',
      '  "b": [',
      '    1,',
      '    2',
      '  ]',
      '}',
    ]);
  });

  it('pairs replaced blocks row by row and pads the shorter side', () => {
    const rows = sideBySide(['a', 'b', 'c'], ['a', 'x', 'y', 'c']);
    expect(rows).toEqual([
      { left: { text: 'a', change: 'same' }, right: { text: 'a', change: 'same' } },
      { left: { text: 'b', change: 'removed' }, right: { text: 'x', change: 'added' } },
      { left: null, right: { text: 'y', change: 'added' } },
      { left: { text: 'c', change: 'same' }, right: { text: 'c', change: 'same' } },
    ]);
  });
});

describe('version ranges', () => {
  const v = (
    versionNo: number,
    effectiveFrom: string | null,
    effectiveTo: string | null,
    status: RangeVersion['status'] = 'published',
  ): RangeVersion => ({ id: `v${versionNo}`, versionNo, status, effectiveFrom, effectiveTo });

  it('effective today: [from, to) of published versions only', () => {
    expect(isEffectiveOn(v(1, '2026-01-01', '2026-10-01'), '2026-09-30')).toBe(true);
    expect(isEffectiveOn(v(1, '2026-01-01', '2026-10-01'), '2026-10-01')).toBe(false);
    expect(isEffectiveOn(v(1, '2026-01-01', null, 'retired'), '2026-05-01')).toBe(false);
  });

  it('gaps between versions and after a closed last version; retired/draft ignored', () => {
    const list = [
      v(1, '2026-01-01', '2026-03-01'),
      v(2, '2026-04-01', '2026-06-01'),
      v(3, '2026-06-01', '2026-08-01', 'retired'),
      v(4, null, null, 'draft'),
    ];
    expect(findGaps(list)).toEqual([
      { from: '2026-03-01', to: '2026-04-01' },
      { from: '2026-06-01', to: null },
    ]);
    expect(findGaps([v(1, '2026-01-01', null)])).toEqual([]);
    expect(previousDay('2026-04-01')).toBe('2026-03-31');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
  });

  it('AC-B3-63/65: publish preview closes the open version; a gap it creates is reported', () => {
    const list = [v(1, '2026-01-01', null), v(2, null, null, 'draft')];
    expect(openPreviousVersion(list, '2026-10-01')?.id).toBe('v1');
    expect(openPreviousVersion(list, '2025-10-01')).toBeUndefined();
    const closed = simulatePublish(list, 'v2', '2026-10-01', null, true);
    expect(closed.map((x) => [x.status, x.effectiveFrom, x.effectiveTo])).toEqual([
      ['published', '2026-01-01', '2026-10-01'],
      ['published', '2026-10-01', null],
    ]);
    expect(newGaps(list, closed)).toEqual([]);

    const gapped = [v(1, '2026-01-01', '2026-03-01'), v(2, null, null, 'draft')];
    expect(newGaps(gapped, simulatePublish(gapped, 'v2', '2026-04-01', null, false))).toEqual([
      { from: '2026-03-01', to: '2026-04-01' },
    ]);
  });

  it('AC-B3-64: overlap is found and names the version', () => {
    const list = [v(1, '2026-01-01', null), v(2, null, null, 'draft')];
    expect(findOverlap(list, '2026-10-01', null)?.versionNo).toBe(1);
    expect(findOverlap([v(1, '2026-01-01', '2026-10-01')], '2026-10-01', null)).toBeUndefined();
    expect(
      findOverlap([v(1, '2026-05-01', '2026-06-01')], '2026-01-01', '2026-05-01'),
    ).toBeUndefined();
    expect(findOverlap([v(1, '2026-05-01', null)], '2026-05-01', null, 'v1')).toBeUndefined();
  });
});
