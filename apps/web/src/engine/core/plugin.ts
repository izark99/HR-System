import type { ZodType } from 'zod';
import type { ColumnDef, EngineContext, Table } from './types';

export interface PortDef {
  name: string;
  required: boolean;
}

export type NodeOutputs = Record<string, Table>;

/**
 * Node plugin contract (spec §12). Each node type provides a config schema, port definitions,
 * output schema inference (for the Designer) and an executor.
 *
 * `execute` is the pure-TS implementation (sync or async). A DuckDB-backed node will additionally
 * provide `compile` (returning SQL) and the planner will prefer it; the inputs/outputs stay
 * `Table`s at the boundary so callers do not change.
 */
export interface NodePlugin<
  Config,
  Result extends NodeOutputs | Promise<NodeOutputs> = NodeOutputs | Promise<NodeOutputs>,
> {
  type: string;
  configSchema: ZodType<Config, unknown>;
  inputs: PortDef[];
  outputs: PortDef[];
  /** Ports that depend on the config (e.g. one input port per sheet of `output.excel`). */
  inputPorts?(config: Config): PortDef[];
  inferSchema(
    config: Config,
    inputs: Record<string, ColumnDef[]>,
    ctx: EngineContext,
  ): Record<string, ColumnDef[]>;
  execute(config: Config, inputs: Record<string, Table>, ctx: EngineContext): Result;
}

// The registry stores plugins with heterogeneous configs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNodePlugin = NodePlugin<any>;
