import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../model';
import { upstreamSignature } from '../preview-signature';

/** Stale preview warnings (R1-fix5): a node's signature covers itself and everything upstream. */

const def = (): JsonObject => ({
  schemaVersion: 1,
  params: [{ key: 'ky', label: 'Kỳ', type: 'month' }],
  inputSlots: [{ key: 's', label: 'S' }],
  nodes: [
    { id: 'in', type: 'input.excel', config: { slot: 's' } },
    { id: 'f', type: 'transform.formula', config: { columns: [{ key: 'a', formula: '=1' }] } },
    { id: 'g', type: 'transform.formula', config: { columns: [{ key: 'b', formula: '=2' }] } },
    { id: 'other', type: 'transform.select', config: { columns: [] } },
  ],
  edges: [
    { from: 'in', to: 'f' },
    { from: 'f', to: 'g' },
  ],
});

describe('upstreamSignature', () => {
  it('changes when the node, an ancestor, a slot or a param changes; not for other nodes', () => {
    const base = upstreamSignature(def(), 'g');
    const edit = (fn: (d: JsonObject & { nodes: JsonObject[] }) => void) => {
      const d = def() as JsonObject & { nodes: JsonObject[] };
      fn(d);
      return upstreamSignature(d, 'g');
    };
    expect(edit((d) => ((d.nodes[2]!.config as JsonObject).columns = []))).not.toBe(base);
    expect(edit((d) => ((d.nodes[1]!.config as JsonObject).columns = []))).not.toBe(base);
    expect(edit((d) => ((d.nodes[0]!.config as JsonObject).slot = 'x'))).not.toBe(base);
    expect(edit((d) => (d.inputSlots = []))).not.toBe(base);
    expect(edit((d) => ((d.nodes[3]!.config as JsonObject).columns = [{ from: 'a' }]))).toBe(base);
    expect(edit((d) => (d.ui = { positions: { g: [1, 2] } }))).toBe(base);
  });
});
