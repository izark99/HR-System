/** Keyboard edge linking (AC-UI-76): targets offered by the "Nối tới…" menu. Fake flow only. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connect, fromDefinition, toDefinition, type DesignerDoc } from '../model';
import { connectTargets, edgeOf, filterTargets, sourcePorts } from '../connect-targets';

const FLOW = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../../../../fixtures/payroll-timesheet/flow.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const full = fromDefinition(FLOW);
const bare: DesignerDoc = { ...full, edges: [] };
const label = (id: string) => full.nodes.find((n) => n.id === id)?.label ?? id;
const ports = (doc: DesignerDoc, from: string, fromPort: string) =>
  connectTargets(doc, from, fromPort).map((g) => `${g.node.id}:${g.ports.join(',')}`);

describe('connect-targets', () => {
  it('source ports: one for an input node, four for the compare node', () => {
    expect(sourcePorts(full.nodes.find((n) => n.id === 'in_luong')!)).toEqual(['table']);
    expect(sourcePorts(full.nodes.find((n) => n.id === 'cmp')!)).toEqual([
      'summary',
      'mismatched',
      'only_left',
      'only_right',
    ]);
  });

  it('without edges: every input port of the other nodes, grouped by node, self left out', () => {
    expect(ports(bare, 'in_luong', 'table')).toEqual([
      'cmp:left,right',
      'out:summary,mismatched,only_left,only_right',
    ]);
  });

  it('hides ports already connected and ports that would close a cycle', () => {
    const one = connect(bare, edgeOf('in_luong', 'table', 'cmp', 'left'));
    expect(one.ok).toBe(true);
    const doc = one.ok ? one.doc : bare;
    expect(ports(doc, 'in_cc', 'table')).toEqual([
      'cmp:right',
      'out:summary,mismatched,only_left,only_right',
    ]);
    // cmp → in_luong would be a cycle, and input nodes have no input port anyway; cmp → out ok.
    const two = connect(doc, edgeOf('cmp', 'summary', 'out', 'summary'));
    const doc2 = two.ok ? two.doc : doc;
    expect(ports(doc2, 'out', 'none')).toEqual([]); // output.excel has no output port
    expect(ports(doc2, 'cmp', 'mismatched')).toEqual(['out:mismatched,only_left,only_right']);
  });

  it('a full set of menu choices rebuilds the acceptance flow exactly', () => {
    let doc = bare;
    for (const e of full.edges) {
      const offered = connectTargets(doc, e.from, e.fromPort);
      expect(offered.find((g) => g.node.id === e.to)?.ports, JSON.stringify(e)).toContain(e.toPort);
      const r = connect(doc, edgeOf(e.from, e.fromPort, e.to, e.toPort));
      expect(r.ok).toBe(true);
      if (r.ok) doc = r.doc;
    }
    expect(toDefinition(doc)).toEqual(toDefinition(full));
  });

  it('search: by node name keeps the whole group, by port keeps the matching ports', () => {
    const groups = connectTargets(bare, 'in_luong', 'table');
    const nodeLabel = (n: { id: string; label?: string }) => n.label ?? n.id;
    const portLabel = (p: string) => `Cổng vào ${p}`;
    expect(
      filterTargets(groups, 'FILE DOI', nodeLabel, portLabel).map(
        (g) => `${g.node.id}:${g.ports.join(',')}`,
      ),
    ).toEqual([`out:summary,mismatched,only_left,only_right`]);
    expect(label('out')).toBe('File đối chiếu');
    expect(
      filterTargets(groups, 'only_l', nodeLabel, portLabel).map(
        (g) => `${g.node.id}:${g.ports.join(',')}`,
      ),
    ).toEqual(['out:only_left']);
    expect(filterTargets(groups, 'cong vao rig', nodeLabel, portLabel)[0]?.ports).toEqual([
      'right',
    ]);
    expect(filterTargets(groups, '', nodeLabel, portLabel)).toEqual(groups);
    expect(filterTargets(groups, 'khong co', nodeLabel, portLabel)).toEqual([]);
  });
});
