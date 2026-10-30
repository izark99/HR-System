import { FlowDefinitionSchema, type DataType, type FlowDefinitionInput } from '@hrflow/flow-schema';
import { z } from 'zod';
import { isDecimal } from '../core/decimal';
import { runFlow, type RunFlowOptions, type RunFlowResult } from '../core/executor';
import { createEngineTranslator } from '../core/i18n';
import type { AnyNodePlugin, TsNodePlugin } from '../core/plugin';
import type { Table, Value } from '../core/types';
import { nodePlugins } from '../nodes';
import { nodeDuckDb } from './duckdb-node';
import { asTable } from './helpers';

export const t = createEngineTranslator('vi');

/** Test-only source node: `{ type: 'test.table', config: { name } }` outputs `tables[name]`. */
function sourcePlugin(tables: Record<string, Table>): TsNodePlugin<{ name: string }> {
  return {
    type: 'test.table',
    configSchema: z.strictObject({ name: z.string() }),
    inputs: [],
    outputs: [{ name: 'out', required: false }],
    inferSchema: (c) => ({ out: tables[c.name]!.columns }),
    execute: (c) => ({ out: tables[c.name]! }),
  };
}

/** Build a table from column specs and row arrays. */
export function table(columns: [key: string, type: DataType][], rows: Value[][]): Table {
  return asTable({
    columns: columns.map(([key, type]) => ({ key, type, title: key.toUpperCase() })),
    rows: rows.map((r) => Object.fromEntries(columns.map(([key], i) => [key, r[i] ?? null]))),
  });
}

/** Rows as arrays of plain values (decimals as strings) in column order. */
export function rowsOf(
  tbl: Table | undefined,
  keys?: string[],
): (string | number | boolean | null)[][] {
  if (!tbl) throw new Error('no table');
  const cols = keys ?? tbl.columns.map((c) => c.key);
  return tbl.rows.map((r) =>
    cols.map((k) => {
      const v = r[k];
      if (v === undefined || v === null) return null;
      return isDecimal(v) ? v.toString() : v;
    }),
  );
}

export interface NodeSpec {
  id: string;
  type: string;
  config?: Record<string, unknown>;
  label?: string;
}

/**
 * Run a flow over in-memory tables. `sources` become `test.table` nodes with the same id; every
 * node in `nodes` is collected so its output can be inspected.
 */
export async function runWith(
  sources: Record<string, Table>,
  nodes: NodeSpec[],
  edges: FlowDefinitionInput['edges'],
  options: Partial<RunFlowOptions> & {
    paramDefs?: FlowDefinitionInput['params'];
    /** Extra test-only plugins next to the registry and `test.table`. */
    extraPlugins?: Record<string, AnyNodePlugin>;
  } = {},
): Promise<RunFlowResult> {
  const { paramDefs, extraPlugins, ...rest } = options;
  const flow = FlowDefinitionSchema.parse({
    schemaVersion: 1,
    params: paramDefs ?? [],
    nodes: [
      ...Object.keys(sources).map((id) => ({ id, type: 'test.table', config: { name: id } })),
      ...nodes.map((n) => ({ config: {}, ...n })),
    ],
    edges,
  });
  return runFlow(flow, {
    t,
    duck: nodeDuckDb,
    plugins: { ...nodePlugins, 'test.table': sourcePlugin(sources), ...extraPlugins },
    collect: nodes.map((n) => n.id),
    ...rest,
  });
}

/** Run a single node `n` fed by the given sources on the given ports. */
export async function runNode(
  type: string,
  config: Record<string, unknown>,
  inputs: Record<string, Table>,
  options: Parameters<typeof runWith>[3] = {},
): Promise<RunFlowResult & { out: Record<string, Table> }> {
  const sources: Record<string, Table> = {};
  const edges: FlowDefinitionInput['edges'] = [];
  for (const [port, tbl] of Object.entries(inputs)) {
    const id = `src_${port}`;
    sources[id] = tbl;
    edges.push({ from: id, to: 'n', toPort: port });
  }
  const result = await runWith(sources, [{ id: 'n', type, config }], edges, options);
  return { ...result, out: result.outputs.n ?? {} };
}
