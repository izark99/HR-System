import type { JsonObject } from './model';

/** Node `id` and its ancestors (config, edges) plus slots and params, as one comparable string. */
export function upstreamSignature(def: JsonObject, id: string): string {
  const obj = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v)
      ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      : [];
  const nodes = obj(def.nodes);
  const edges = obj(def.edges);
  const keep = new Set([id]);
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of edges) {
      if (e.to === cur && typeof e.from === 'string' && !keep.has(e.from)) {
        keep.add(e.from);
        stack.push(e.from);
      }
    }
  }
  return JSON.stringify({
    nodes: nodes.filter((n) => keep.has(n.id as string)).map((n) => [n.id, n.type, n.config]),
    edges: edges.filter((e) => keep.has(e.to as string)),
    inputSlots: def.inputSlots,
    params: def.params,
  });
}
