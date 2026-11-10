import { InputRefTableConfigSchema, type InputRefTableConfig } from '@hrflow/flow-schema';
import type { NodeOutputs, TsNodePlugin } from '../core/plugin';
import { EngineError, type ColumnDef, type EngineContext, type RefTableDef } from '../core/types';

/** Single output port of `input.refTable`. */
export const INPUT_REF_TABLE_PORT = 'table';

function tableOf(config: InputRefTableConfig, ctx: EngineContext): RefTableDef {
  if (!ctx.refTables)
    throw new EngineError('refTable.error.catalogUnavailable', { path: 'refTable' });
  const def = ctx.refTables[config.refTable];
  if (!def) {
    throw new EngineError('refTable.error.unknownTable', {
      table: config.refTable,
      path: 'refTable',
    });
  }
  return def;
}

/**
 * `input.refTable` (spec §34 AC-RT-07): the rows of a reference table, in the version effective on
 * the run's as-of date (chosen and loaded by the main thread, `ctx.run.readRefTable`). Columns come
 * from the table definition, so the Designer knows them without any data.
 */
export const inputRefTablePlugin: TsNodePlugin<InputRefTableConfig, NodeOutputs> = {
  type: 'input.refTable',
  configSchema: InputRefTableConfigSchema,
  inputs: [],
  outputs: [{ name: INPUT_REF_TABLE_PORT, required: false }],
  inferSchema(config, _inputs, ctx) {
    const columns: ColumnDef[] = tableOf(config, ctx).columns.map((c) => ({
      key: c.key,
      type: c.type,
      title: c.title,
    }));
    return { [INPUT_REF_TABLE_PORT]: columns };
  },
  warnings(config, _inputs, ctx) {
    const def = ctx.refTables?.[config.refTable];
    return def && def.published === false
      ? [
          {
            messageKey: 'refTable.warning.noPublished',
            params: { table: def.name, path: 'refTable' },
          },
        ]
      : [];
  },
  execute(config, _inputs, ctx) {
    if (!ctx.run?.readRefTable) {
      throw new EngineError('refTable.error.notLoaded', {
        table: ctx.refTables?.[config.refTable]?.name ?? config.refTable,
      });
    }
    return { [INPUT_REF_TABLE_PORT]: ctx.run.readRefTable(config.refTable) };
  },
};
