import { InputExcelConfigSchema, type InputExcelConfig } from '@hrflow/flow-schema';
import type { NodeOutputs, NodePlugin } from '../core/plugin';
import { EngineError, type ColumnDef, type EngineContext } from '../core/types';
import { SOURCE_FILE_COLUMN } from '../io/excel-reader';

/** Single output port of `input.excel`. */
export const INPUT_EXCEL_PORT = 'table';

function findSlot(config: InputExcelConfig, ctx: EngineContext) {
  const slot = ctx.flow?.inputSlots.find((s) => s.key === config.slot);
  if (!slot) throw new EngineError('executor.error.unknownSlot', { slot: config.slot });
  return slot;
}

/**
 * `input.excel` (spec §10, §12): the table of one input slot — all files of the slot read with the
 * slot config, validated and unioned. Reading itself is delegated to `ctx.run.readSlot` so the
 * caller can reuse the result of the validation step instead of parsing the files twice.
 */
export const inputExcelPlugin: NodePlugin<InputExcelConfig, Promise<NodeOutputs>> = {
  type: 'input.excel',
  configSchema: InputExcelConfigSchema,
  inputs: [],
  outputs: [{ name: INPUT_EXCEL_PORT, required: false }],
  checkConfig(config, flow) {
    if (!flow.inputSlots.some((s) => s.key === config.slot)) {
      throw new EngineError('executor.error.nodeUnknownSlot', { slot: config.slot });
    }
  },
  inferSchema(config, _inputs, ctx) {
    const slot = findSlot(config, ctx);
    const columns: ColumnDef[] = slot.columns.map((c) => ({
      key: c.key,
      type: c.type,
      title: c.label ?? c.aliases[0] ?? c.key,
    }));
    if (slot.multiple.enabled) columns.push({ key: SOURCE_FILE_COLUMN, type: 'string' });
    return { [INPUT_EXCEL_PORT]: columns };
  },
  async execute(config, _inputs, ctx) {
    const slot = findSlot(config, ctx);
    if (!ctx.run) throw new EngineError('executor.error.noRunContext');
    const result = await ctx.run.readSlot(slot.key);
    if (result.report.errorCount > 0) {
      throw new EngineError('executor.error.inputInvalid', {
        slot: slot.label,
        count: result.report.errorCount,
      });
    }
    return { [INPUT_EXCEL_PORT]: result.table };
  },
};
