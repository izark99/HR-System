import type { ZodType } from 'zod';
import type { ColumnDef, EngineContext, Table } from './types';

export interface PortDef {
  name: string;
  required: boolean;
}

/**
 * Node plugin contract (spec §12). Each node type provides a config schema, port definitions,
 * output schema inference (for the Designer) and an executor.
 *
 * `execute` is the pure-TS implementation. A DuckDB-backed node will additionally provide
 * `compile` (returning SQL) and the planner will prefer it; the inputs/outputs stay `Table`s
 * at the boundary so callers do not change.
 */
export interface NodePlugin<Config> {
  type: string;
  configSchema: ZodType<Config, unknown>;
  inputs: PortDef[];
  outputs: PortDef[];
  inferSchema(
    config: Config,
    inputs: Record<string, ColumnDef[]>,
    ctx: EngineContext,
  ): Record<string, ColumnDef[]>;
  execute(config: Config, inputs: Record<string, Table>, ctx: EngineContext): Record<string, Table>;
}
