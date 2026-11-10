import { z } from 'zod';
import { IdentifierSchema } from './common';
import { InputSlotSchema } from './input-slot';

/** Flow definition (spec §8). Node configs are validated by each node plugin, not here. */

export const FlowParamSchema = z.strictObject({
  key: IdentifierSchema,
  label: z.string().min(1),
  type: z.enum(['string', 'number', 'date', 'month', 'boolean', 'select']),
  required: z.boolean().default(false),
  /**
   * Whether the value is written to run_logs. Unset = by type: month/date/select/boolean/number
   * are logged, free-text `string` params are not (they may hold personal data) unless the Admin
   * sets `log: true`. `false` = sensitive, never logged.
   */
  log: z.boolean().optional(),
  isAsOfDate: z.boolean().optional(),
  options: z
    .union([
      z.array(z.strictObject({ value: z.string(), label: z.string() })),
      z.strictObject({
        fromRefTable: z.string().min(1),
        valueColumn: z.string().min(1),
        labelColumn: z.string().min(1),
      }),
    ])
    .optional(),
});
export type FlowParam = z.infer<typeof FlowParamSchema>;

export const FlowNodeSchema = z.strictObject({
  id: IdentifierSchema,
  /** Plugin type, e.g. "input.excel", "control.compare". */
  type: z.string().regex(/^[a-z]+\.[a-zA-Z]+$/),
  label: z.string().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type FlowNode = z.infer<typeof FlowNodeSchema>;

export const FlowEdgeSchema = z.strictObject({
  from: IdentifierSchema,
  fromPort: z.string().min(1).optional(),
  to: IdentifierSchema,
  toPort: z.string().min(1).optional(),
});
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    params: z.array(FlowParamSchema).default([]),
    nodes: z.array(FlowNodeSchema).min(1),
    edges: z.array(FlowEdgeSchema).default([]),
    inputSlots: z.array(InputSlotSchema).default([]),
    /** Canvas-only data; ignored by the engine. */
    ui: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((flow, ctx) => {
    const ids = new Set<string>();
    flow.nodes.forEach((n, i) => {
      if (ids.has(n.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'id'],
          message: `duplicate node id "${n.id}"`,
        });
      }
      ids.add(n.id);
    });
    flow.edges.forEach((e, i) => {
      for (const end of ['from', 'to'] as const) {
        if (!ids.has(e[end])) {
          ctx.addIssue({
            code: 'custom',
            path: ['edges', i, end],
            message: `unknown node "${e[end]}"`,
          });
        }
      }
    });
    const slotKeys = flow.inputSlots.map((s) => s.key);
    const dupSlot = slotKeys.find((k, i) => slotKeys.indexOf(k) !== i);
    if (dupSlot) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputSlots'],
        message: `duplicate slot "${dupSlot}"`,
      });
    }
    if (
      findCycle(
        flow.nodes.map((n) => n.id),
        flow.edges,
      )
    ) {
      ctx.addIssue({ code: 'custom', path: ['edges'], message: 'flow graph must be acyclic' });
    }
  });
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;
export type FlowDefinitionInput = z.input<typeof FlowDefinitionSchema>;

/** Kahn's algorithm; returns true when the graph has a cycle. */
export function findCycle(nodeIds: string[], edges: { from: string; to: string }[]): boolean {
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const next = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) {
    if (!indegree.has(e.from) || !indegree.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    next.get(e.from)?.push(e.to);
  }
  const queue = nodeIds.filter((id) => indegree.get(id) === 0);
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const to of next.get(id) ?? []) {
      const d = (indegree.get(to) ?? 0) - 1;
      indegree.set(to, d);
      if (d === 0) queue.push(to);
    }
  }
  return visited !== nodeIds.length;
}
