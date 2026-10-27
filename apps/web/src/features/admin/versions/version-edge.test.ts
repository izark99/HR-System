/**
 * Edge cases of the version diff (spec §14.3) and validity ranges (§14.1, §14.4) that the
 * acceptance tests in version-diff.test.ts do not reach. Fake configs only.
 */
import { describe, expect, it } from 'vitest';
import { diffDefinitions, jsonLines, sideBySide } from './version-diff';
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

const v = (
  n: number,
  from: string | null,
  to: string | null,
  status: RangeVersion['status'] = 'published',
): RangeVersion => ({ id: `v${n}`, versionNo: n, status, effectiveFrom: from, effectiveTo: to });

const node = (id: string, config: Record<string, unknown> = {}, extra = {}) => ({
  id,
  type: 'transform.select',
  label: id,
  config,
  ...extra,
});

describe('diff: node identity (rename vs id change)', () => {
  it('a label rename keeps the id: one changed node, only the label field', () => {
    const d = diffDefinitions(
      { nodes: [node('a', { x: 1 })] },
      { nodes: [{ ...node('a', { x: 1 }), label: 'Tên mới' }] },
    );
    expect(d.nodes).toHaveLength(1);
    expect(d.nodes[0]).toMatchObject({ key: 'a', kind: 'changed', fields: ['label'] });
    expect(d.nodes[0]!.label).toBe('Tên mới');
  });

  it('an id change is a removal plus an addition (identity is the id, spec §14.3)', () => {
    const d = diffDefinitions({ nodes: [node('a', { x: 1 })] }, { nodes: [node('b', { x: 1 })] });
    expect(d.nodes.map((n) => [n.key, n.kind]).sort()).toEqual([
      ['a', 'removed'],
      ['b', 'added'],
    ]);
  });

  it('a type change is reported as field "type" (plus config when it changed too)', () => {
    const d = diffDefinitions(
      { nodes: [node('a', { x: 1 })] },
      { nodes: [{ ...node('a', { x: 2 }), type: 'transform.filter' }] },
    );
    expect(d.nodes[0]!.fields).toEqual(['type', 'config']);
  });

  it('node order, config key order and node-level extras (position) are not changes', () => {
    const d = diffDefinitions(
      { nodes: [node('a', { p: 1, q: { y: 2, z: 3 } }), node('b')] },
      {
        nodes: [
          node('b', {}, { position: { x: 5, y: 5 } }),
          node('a', { q: { z: 3, y: 2 }, p: 1 }, { position: { x: 9, y: 9 } }),
        ],
      },
    );
    expect(d.identical).toBe(true);
  });

  it('missing config, null config and {} are the same thing', () => {
    const d = diffDefinitions(
      { nodes: [{ id: 'a', type: 't', label: 'a' }] },
      { nodes: [{ id: 'a', type: 't', label: 'a', config: null }] },
    );
    expect(d.nodes).toEqual([]);
  });

  it('array order inside a config IS a change (column order matters to the result)', () => {
    const d = diffDefinitions(
      { nodes: [node('a', { cols: ['x', 'y'] })] },
      { nodes: [node('a', { cols: ['y', 'x'] })] },
    );
    expect(d.nodes[0]!.kind).toBe('changed');
    expect(d.nodes[0]!.rows!.some((r) => r.left?.change === 'removed')).toBe(true);
  });
});

describe('diff: edges', () => {
  it('reordered edges and a missing port equal to a null port are unchanged', () => {
    const d = diffDefinitions(
      {
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', fromPort: 'out', to: 'c', toPort: 'left' },
        ],
      },
      {
        edges: [
          { from: 'b', fromPort: 'out', to: 'c', toPort: 'left' },
          { from: 'a', fromPort: null, to: 'b', toPort: null },
        ],
      },
    );
    expect(d.edges).toEqual([]);
    expect(d.identical).toBe(true);
  });

  it('rewiring only the target port is one removed and one added connection', () => {
    const d = diffDefinitions(
      { edges: [{ from: 'a', to: 'c', toPort: 'left' }] },
      { edges: [{ from: 'a', to: 'c', toPort: 'right' }] },
    );
    expect(d.edges.map((e) => [e.kind, e.toPort])).toEqual([
      ['added', 'right'],
      ['removed', 'left'],
    ]);
  });

  it('duplicate edges collapse; malformed edges are ignored, not thrown on', () => {
    const d = diffDefinitions(
      { edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }, 42, { from: 'a' }, null] },
      { edges: [{ from: 'a', to: 'b' }] },
    );
    expect(d.edges).toEqual([]);
  });

  it('a node deletion that drops its edges lists the edges as removed too', () => {
    const d = diffDefinitions(
      { nodes: [node('a'), node('b')], edges: [{ from: 'a', to: 'b' }] },
      { nodes: [node('a')], edges: [] },
    );
    expect(d.nodes.map((n) => [n.key, n.kind])).toEqual([['b', 'removed']]);
    expect(d.edges).toMatchObject([{ kind: 'removed', from: 'a', to: 'b' }]);
  });
});

describe('diff: params, input slots, other fields', () => {
  it('params and slots are matched by key: a changed key is remove + add, a changed label is changed', () => {
    const d = diffDefinitions(
      {
        params: [
          { key: 'ky', label: 'Kỳ', type: 'month' },
          { key: 'gone', label: 'G' },
        ],
        inputSlots: [{ key: 's1', label: 'Lương', columns: [{ key: 'ma', type: 'text' }] }],
      },
      {
        params: [
          { key: 'ky', label: 'Kỳ lương', type: 'month' },
          { key: 'new', label: 'N' },
        ],
        inputSlots: [{ key: 's1', label: 'Lương', columns: [{ key: 'ma', type: 'number' }] }],
      },
    );
    expect(d.params.map((p) => [p.key, p.kind])).toEqual([
      ['ky', 'changed'],
      ['new', 'added'],
      ['gone', 'removed'],
    ]);
    expect(d.inputSlots).toHaveLength(1);
    const marked = d.inputSlots[0]!.rows!.filter((r) => r.left?.change === 'removed');
    expect(marked.map((r) => r.left!.text.trim())).toEqual(['"type": "text"']);
    expect(marked).toHaveLength(1);
  });

  it('only ui differs, including nested ui keys, absent vs present ui: identical', () => {
    expect(
      diffDefinitions({ nodes: [node('a')] }, { nodes: [node('a')], ui: { notes: [{ id: 1 }] } })
        .identical,
    ).toBe(true);
  });

  it('schemaVersion (not ui) is reported in `other` and breaks "identical"', () => {
    const d = diffDefinitions({ schemaVersion: 1, nodes: [] }, { schemaVersion: 2, nodes: [] });
    expect(d.other).toEqual(['schemaVersion']);
    expect(d.identical).toBe(false);
  });

  it('garbage in both sides (null, string, array) is identical and does not throw', () => {
    expect(diffDefinitions(null, 'x').identical).toBe(true);
    expect(diffDefinitions([], undefined).identical).toBe(true);
    expect(diffDefinitions({ nodes: 'oops' }, { nodes: [node('a')] }).nodes[0]!.kind).toBe('added');
  });
});

describe('diff: multi-line strings and side-by-side', () => {
  const sql = (s: string) => ({ nodes: [node('q', { sql: s })] });

  it('a changed middle line of SQL is the only marked row; unchanged lines stay aligned', () => {
    const d = diffDefinitions(
      sql('select a\nfrom t\nwhere x = 1\norder by a'),
      sql('select a\nfrom t\nwhere x = 2\norder by a'),
    );
    const rows = d.nodes[0]!.rows!;
    const marked = rows.filter((r) => r.left?.change !== 'same' || r.right?.change !== 'same');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.left!.text.trim()).toBe('where x = 1');
    expect(marked[0]!.right!.text.trim()).toBe('where x = 2');
  });

  it('inserted and deleted SQL lines get one-sided rows', () => {
    const d = diffDefinitions(sql('a\nb\nc'), sql('a\nc\nd'));
    const rows = d.nodes[0]!.rows!;
    expect(rows.some((r) => r.left?.change === 'removed' && r.left.text.trim() === 'b')).toBe(true);
    expect(rows.some((r) => r.right?.change === 'added' && r.right.text.trim() === 'd')).toBe(true);
  });

  it('a trailing-newline-only change is visible (a marked row)', () => {
    const d = diffDefinitions(sql('select 1'), sql('select 1\n'));
    // single-line vs block: at minimum the item is changed and has marked rows
    expect(d.nodes[0]!.kind).toBe('changed');
    expect(d.nodes[0]!.rows!.some((r) => r.right?.change === 'added')).toBe(true);
  });

  it('special characters, quotes and unicode survive in the line view unescaped by HTML rules', () => {
    const lines = jsonLines({ sql: "select 'x'; --\n\"Mã NV\" <> '' and a < 1" });
    expect(lines.join('\n')).toContain(`"Mã NV" <> '' and a < 1`);
  });

  it('jsonLines handles empty containers, null and primitives', () => {
    expect(jsonLines({ a: [], b: {}, c: null, d: 0, e: '' })).toEqual([
      '{',
      '  "a": [],',
      '  "b": {},',
      '  "c": null,',
      '  "d": 0,',
      '  "e": ""',
      '}',
    ]);
    expect(jsonLines(undefined)).toEqual(['null']);
  });

  it('side-by-side of identical and empty inputs', () => {
    expect(sideBySide([], [])).toEqual([]);
    expect(sideBySide(['a'], ['a'])).toEqual([
      { left: { text: 'a', change: 'same' }, right: { text: 'a', change: 'same' } },
    ]);
    const r = sideBySide([], ['a', 'b']);
    expect(r.every((x) => x.left === null && x.right?.change === 'added')).toBe(true);
  });

  it('a 1,500-line SQL with one changed line stays fast and marks exactly that line', () => {
    const lines = Array.from({ length: 1500 }, (_, i) => `select ${i}`);
    const changed = [...lines];
    changed[700] = 'select changed';
    const t0 = performance.now();
    const d = diffDefinitions(sql(lines.join('\n')), sql(changed.join('\n')));
    expect(performance.now() - t0).toBeLessThan(3000);
    const marked = d.nodes[0]!.rows!.filter(
      (r) => r.left?.change !== 'same' || r.right?.change !== 'same',
    );
    expect(marked).toHaveLength(1);
  });
});

describe('fixed bugs (were KNOWN BUGS)', () => {
  const sql = (s: string) => ({ nodes: [node('q', { sql: s })] });

  // CRLF and LF are normalized the same way for comparison and display: no change.
  it('SQL that only differs in CRLF vs LF is not reported as a change', () => {
    const d = diffDefinitions(sql('select 1\nfrom t'), sql('select 1\r\nfrom t'));
    expect(d.nodes).toEqual([]);
    expect(d.identical).toBe(true);
    // A real change next to a CRLF still marks only the changed line.
    const e = diffDefinitions(sql('select 1\r\nfrom t'), sql('select 2\nfrom t'));
    const marked = e.nodes[0]!.rows!.filter(
      (r) => r.left?.change !== 'same' || r.right?.change !== 'same',
    );
    expect(marked).toHaveLength(1);
  });

  // Common prefix/suffix are matched before the LCS limit applies.
  it('a line inserted at the top of a very large SQL (>2,000 lines) still marks only that line', () => {
    const lines = Array.from({ length: 2600 }, (_, i) => `select ${i}`);
    const rows = sideBySide(lines, ['select new', ...lines]);
    const marked = rows.filter((r) => r.left?.change !== 'same' || r.right?.change !== 'same');
    expect(marked.length).toBe(1);
    expect(rows).toHaveLength(2601);
  });
});

describe('ranges: gaps', () => {
  it('adjacent ranges (to = next from) leave no gap; unsorted input is fine', () => {
    expect(findGaps([v(2, '2026-03-01', null), v(1, '2026-01-01', '2026-03-01')])).toEqual([]);
  });

  it('one-day gap is reported exactly [to, nextFrom)', () => {
    expect(findGaps([v(1, '2026-01-01', '2026-03-01'), v(2, '2026-03-02', null)])).toEqual([
      { from: '2026-03-01', to: '2026-03-02' },
    ]);
  });

  it('retiring the middle version opens a gap between its neighbours', () => {
    const list = [
      v(1, '2026-01-01', '2026-03-01'),
      v(2, '2026-03-01', '2026-06-01', 'retired'),
      v(3, '2026-06-01', null),
    ];
    expect(findGaps(list)).toEqual([{ from: '2026-03-01', to: '2026-06-01' }]);
  });

  it('retiring the last open version opens a trailing, unbounded gap from its start', () => {
    expect(
      findGaps([v(1, '2026-01-01', '2026-03-01'), v(2, '2026-03-01', null, 'retired')]),
    ).toEqual([{ from: '2026-03-01', to: null }]);
  });

  it('no published versions at all: no gap to warn about', () => {
    expect(findGaps([])).toEqual([]);
    expect(findGaps([v(1, null, null, 'draft'), v(2, '2026-01-01', null, 'retired')])).toEqual([]);
  });

  it('a range contained in an earlier long range does not create a false gap (defensive)', () => {
    expect(
      findGaps([
        v(1, '2026-01-01', '2026-12-01'),
        v(2, '2026-03-01', '2026-04-01'),
        v(3, '2026-12-01', null),
      ]),
    ).toEqual([]);
  });

  it('previousDay crosses month, year and leap-day boundaries', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2028-03-01')).toBe('2028-02-29');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
    expect(previousDay('2026-11-01')).toBe('2026-10-31');
  });
});

describe('ranges: effective on a day (exclusive effective_to)', () => {
  it('the first day is inside, the end day is outside, the day before the start is outside', () => {
    const x = v(1, '2026-03-01', '2026-04-01');
    expect(isEffectiveOn(x, '2026-02-28')).toBe(false);
    expect(isEffectiveOn(x, '2026-03-01')).toBe(true);
    expect(isEffectiveOn(x, '2026-03-31')).toBe(true);
    expect(isEffectiveOn(x, '2026-04-01')).toBe(false);
  });
  it('open-ended is effective forever after the start; a draft never is', () => {
    expect(isEffectiveOn(v(1, '2026-03-01', null), '2099-01-01')).toBe(true);
    expect(isEffectiveOn(v(1, null, null, 'draft'), '2026-03-01')).toBe(false);
  });
});

describe('ranges: publish simulation matches the RPC (close-previous rules)', () => {
  it('closes only an OPEN published version that starts strictly before the new date', () => {
    const list = [v(1, '2026-01-01', null), v(9, null, null, 'draft')];
    expect(simulatePublish(list, 'v9', '2026-01-01', null, true)[0]!.effectiveTo).toBeNull();
    expect(simulatePublish(list, 'v9', '2026-01-02', null, true)[0]!.effectiveTo).toBe(
      '2026-01-02',
    );
    expect(simulatePublish(list, 'v9', '2026-06-01', null, false)[0]!.effectiveTo).toBeNull();
  });
  it('leaves closed, retired and draft versions alone', () => {
    const list = [
      v(1, '2026-01-01', '2026-02-01'),
      v(2, '2026-02-01', null, 'retired'),
      v(8, null, null, 'draft'),
      v(9, null, null, 'draft'),
    ];
    const out = simulatePublish(list, 'v9', '2026-09-01', null, true);
    expect(out.map((x) => x.effectiveTo)).toEqual(['2026-02-01', null, null, null]);
    expect(out[3]).toMatchObject({ status: 'published', effectiveFrom: '2026-09-01' });
    expect(out[2]!.status).toBe('draft');
  });
  it('does not mutate its input', () => {
    const list = [v(1, '2026-01-01', null), v(9, null, null, 'draft')];
    const copy = JSON.stringify(list);
    simulatePublish(list, 'v9', '2026-06-01', null, true);
    expect(JSON.stringify(list)).toBe(copy);
  });
  it('a bounded publish placed before the first version warns about the gap before it', () => {
    const list = [v(1, '2026-06-01', null), v(9, null, null, 'draft')];
    const next = simulatePublish(list, 'v9', '2026-01-01', '2026-03-01', false);
    expect(newGaps(list, next)).toEqual([{ from: '2026-03-01', to: '2026-06-01' }]);
  });
  it('a gap that already existed is not reported as new', () => {
    const list = [
      v(1, '2026-01-01', '2026-02-01'),
      v(2, '2026-04-01', null),
      v(9, null, null, 'draft'),
    ];
    const next = simulatePublish(list, 'v9', '2025-01-01', '2025-06-01', false);
    expect(newGaps(list, next).every((g) => g.from !== '2026-02-01')).toBe(true);
  });
  it('publishing a bounded version after the last open one with close creates the trailing gap', () => {
    const list = [v(1, '2026-01-01', null), v(9, null, null, 'draft')];
    const next = simulatePublish(list, 'v9', '2026-03-01', '2026-04-01', true);
    expect(newGaps(list, next)).toEqual([{ from: '2026-04-01', to: null }]);
  });
});

describe('ranges: open previous version and overlap', () => {
  it('openPreviousVersion: an empty date (form not filled) offers the open version; same-day start does not', () => {
    const list = [v(1, '2026-01-01', null)];
    expect(openPreviousVersion(list, '')?.id).toBe('v1');
    expect(openPreviousVersion(list, '2026-01-01')).toBeUndefined();
    expect(openPreviousVersion(list, '2026-01-02')?.id).toBe('v1');
    expect(
      openPreviousVersion([v(1, '2026-01-01', null, 'retired')], '2026-06-01'),
    ).toBeUndefined();
  });

  it('findOverlap: touching ranges do not overlap, one shared day does', () => {
    const list = [v(1, '2026-03-01', '2026-04-01')];
    expect(findOverlap(list, '2026-04-01', null)).toBeUndefined();
    expect(findOverlap(list, '2026-01-01', '2026-03-01')).toBeUndefined();
    expect(findOverlap(list, '2026-03-31', null)?.id).toBe('v1');
    expect(findOverlap(list, '2026-01-01', '2026-03-02')?.id).toBe('v1');
  });

  it('findOverlap ignores retired and draft versions, and the version being edited', () => {
    const list = [
      v(1, '2026-01-01', null, 'retired'),
      v(2, null, null, 'draft'),
      v(3, '2026-05-01', null),
    ];
    expect(findOverlap(list, '2026-02-01', '2026-03-01')).toBeUndefined();
    expect(findOverlap(list, '2026-06-01', null, 'v3')).toBeUndefined();
    expect(findOverlap(list, '2026-06-01', null)?.id).toBe('v3');
  });

  it('findOverlap on an enclosing range returns the first overlapping version by start date', () => {
    const list = [v(2, '2026-05-01', '2026-06-01'), v(1, '2026-02-01', '2026-03-01')];
    expect(findOverlap(list, '2026-01-01', null)?.id).toBe('v1');
  });
});
