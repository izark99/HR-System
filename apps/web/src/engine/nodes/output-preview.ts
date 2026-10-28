import {
  OutputExcelConfigSchema,
  OutputPreviewConfigSchema,
  type OutputPreviewConfig,
} from '@hrflow/flow-schema';
import type { TsNodePlugin } from '../core/plugin';
import { EngineError, type ColumnDef } from '../core/types';
import { configError, findColumn, IN_PORT } from './shared';

function shownColumns(config: OutputPreviewConfig, input: readonly ColumnDef[]): ColumnDef[] {
  if (!config.columns) return [...input];
  return config.columns.map((key, i) =>
    findColumn(input, key, 'preview.error.unknownColumn', `columns.${i}`),
  );
}

/**
 * `output.preview` (spec §12.1.10): a view-only tab on the Result screen. The (column-filtered,
 * truncated) table stays in the engine worker's memory; no file, no artifact, nothing leaves the
 * browser. Runs in TS.
 */
export const outputPreviewPlugin: TsNodePlugin<OutputPreviewConfig> = {
  type: 'output.preview',
  configSchema: OutputPreviewConfigSchema,
  inputs: [{ name: IN_PORT, required: true }],
  outputs: [],
  // Titles share the tab row with the sheets of output.excel (case-insensitive, like Excel).
  checkConfig(config, flow) {
    const mine = config.title.toLowerCase();
    let previews = 0;
    for (const node of flow.nodes) {
      if (node.type === 'output.preview') {
        const other = OutputPreviewConfigSchema.safeParse(node.config);
        if (other.success && other.data.title.toLowerCase() === mine) previews++;
      } else if (node.type === 'output.excel') {
        const excel = OutputExcelConfigSchema.safeParse(node.config);
        if (excel.success && excel.data.sheets.some((s) => s.name.toLowerCase() === mine)) {
          throw configError('preview.error.duplicateTitle', 'title', { title: config.title });
        }
      }
    }
    if (previews > 1) {
      throw configError('preview.error.duplicateTitle', 'title', { title: config.title });
    }
  },
  inferSchema(config, inputs) {
    shownColumns(config, inputs[IN_PORT] ?? []);
    return {};
  },
  execute(config, inputs, ctx) {
    if (!ctx.run) throw new EngineError('executor.error.noRunContext');
    const input = inputs[IN_PORT]!;
    const columns = shownColumns(config, input.columns);
    ctx.run.emitView({
      title: config.title,
      table: input.select(columns).head(config.maxRows),
      totalRows: input.rowCount,
    });
    return {};
  },
};
