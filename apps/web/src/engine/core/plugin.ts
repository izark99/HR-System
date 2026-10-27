import type { ZodType } from 'zod';
import type { FlowDefinition } from '@hrflow/flow-schema';
import type { SqlRel } from '../duckdb/sql';
import type { SqlScope } from '../duckdb/scope';
import type { ColumnDef, EngineContext, RunServices, Table } from './types';

export interface PortDef {
  name: string;
  required: boolean;
}

export type NodeOutputs = Record<string, Table>;

/** Output schema per port. */
export type OutputSchemas = Record<string, ColumnDef[]>;

/** Data on a port while a flow runs: a TS table or a relation inside DuckDB. */
export type PortData = Table | SqlRel;

/** Design-time warning of a node (i18n key + params), e.g. `sql.warning.doubleColumn`. */
export interface NodeIssue {
  messageKey: string;
  params: Record<string, unknown>;
}

/** Context of a node that runs in DuckDB. */
export interface SqlNodeContext extends EngineContext {
  run: RunServices;
  sql: SqlScope;
}

/**
 * Node plugin contract (spec §12). Each node type provides a config schema, port definitions,
 * output schema inference (for the Designer) and an implementation:
 *
 * - `execute`: pure TypeScript over `Table`s (sync or async);
 * - `runSql`: DuckDB (spec §13.1). It usually returns lazy relations (CTEs) that the executor
 *   chains with the next DuckDB node (pushdown) and materializes only when needed; it may also
 *   return `Table`s (e.g. a step finished in TS).
 *
 * `usesDuckDb(config, inputs)` decides at run time, from the config and the actual inputs (e.g.
 * `transform.sort` on a string column runs in TS); by default a plugin with `runSql` and no
 * `execute` uses DuckDB. DuckDB is loaded the first time a node needs it.
 */
export interface NodePlugin<
  Config,
  Result extends NodeOutputs | Promise<NodeOutputs> = NodeOutputs | Promise<NodeOutputs>,
  Schemas extends OutputSchemas | Promise<OutputSchemas> = OutputSchemas,
> {
  type: string;
  configSchema: ZodType<Config, unknown>;
  inputs: PortDef[];
  outputs: PortDef[];
  /** Ports that depend on the config (e.g. one input port per sheet of `output.excel`). */
  inputPorts?(config: Config): PortDef[];
  /**
   * Plan-time checks against the rest of the flow (e.g. the referenced input slot exists). Throw an
   * `EngineError`; the planner attaches the node id.
   */
  checkConfig?(config: Config, flow: FlowDefinition): void;
  /**
   * Output columns from the input columns (no data needed, spec §13.2). Throws an `EngineError`
   * (`params.path` = config field when known) for unknown columns, wrong types, clashes. May be
   * async for nodes that need DuckDB (`code.sql`).
   */
  inferSchema(config: Config, inputs: Record<string, ColumnDef[]>, ctx: EngineContext): Schemas;
  /** Design-time warnings (shown on the node; never block a run). */
  warnings?(
    config: Config,
    inputs: Record<string, ColumnDef[]>,
    ctx: EngineContext,
  ): NodeIssue[] | Promise<NodeIssue[]>;
  execute?(config: Config, inputs: Record<string, Table>, ctx: EngineContext): Result;
  runSql?(
    config: Config,
    inputs: Record<string, SqlRel>,
    ctx: SqlNodeContext,
  ): Record<string, PortData> | Promise<Record<string, PortData>>;
  usesDuckDb?(config: Config, inputs: Record<string, PortData>): boolean;
  /** Tables on the input ports stay available after the run (output nodes read them). */
  keepInputs?: boolean;
  /** Output tables stay available after the run (e.g. compare KPIs). */
  keepOutputs?: boolean;
}

/** A plugin implemented in TS (`execute` required), e.g. `control.compare`. */
export type TsNodePlugin<
  Config,
  Result extends NodeOutputs | Promise<NodeOutputs> = NodeOutputs | Promise<NodeOutputs>,
> = NodePlugin<Config, Result> & Required<Pick<NodePlugin<Config, Result>, 'execute'>>;

// The registry stores plugins with heterogeneous configs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNodePlugin = NodePlugin<any, any, any>;

export function pluginUsesDuckDb(
  plugin: AnyNodePlugin,
  config: unknown,
  inputs: Record<string, PortData>,
): boolean {
  if (plugin.usesDuckDb) return plugin.usesDuckDb(config, inputs);
  return plugin.runSql !== undefined && plugin.execute === undefined;
}
