import {
  OutputExcelConfigSchema,
  type FlowParam,
  type OutputExcelConfig,
} from '@hrflow/flow-schema';
import type { NodeOutputs, NodePlugin, PortDef } from '../core/plugin';
import { EngineError, type ParamValue } from '../core/types';
import { writeWorkbook } from '../io/excel-writer';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function ports(config: OutputExcelConfig): PortDef[] {
  return [...new Set(config.sheets.map((s) => s.port))].map((name) => ({ name, required: true }));
}

/** Param value as it appears in a file name: month "2026-09" → "092026", date → "26092026". */
function fileNamePart(param: FlowParam | undefined, value: ParamValue | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (param?.type === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(s);
    if (m) return `${m[2]}${m[1]}`;
  }
  if (param?.type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return `${m[3]}${m[2]}${m[1]}`;
  }
  return s;
}

/**
 * Resolve `{param_key}` placeholders and make the name safe for every OS. Unknown placeholders
 * become empty. Always ends with `.xlsx`.
 */
export function resolveFileName(
  template: string,
  params: Readonly<Record<string, ParamValue>>,
  defs: readonly FlowParam[] = [],
): string {
  const filled = template.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, key: string) =>
    fileNamePart(
      defs.find((d) => d.key === key),
      params[key],
    ),
  );
  // eslint-disable-next-line no-control-regex
  const safe = filled.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'output';
  return /\.xlsx$/i.test(safe) ? safe : `${safe}.xlsx`;
}

/** `output.excel` (spec §11): one sheet per configured input port, emitted as a file artifact. */
export const outputExcelPlugin: NodePlugin<OutputExcelConfig, Promise<NodeOutputs>> = {
  type: 'output.excel',
  configSchema: OutputExcelConfigSchema,
  inputs: [],
  outputs: [],
  inputPorts: ports,
  inferSchema() {
    return {};
  },
  async execute(config, inputs, ctx) {
    if (!ctx.run) throw new EngineError('executor.error.noRunContext');
    const sheets = config.sheets.map((s) => {
      const table = inputs[s.port];
      if (!table) throw new EngineError('executor.error.missingInput', { port: s.port });
      return { name: s.name, table };
    });
    const data = await writeWorkbook(sheets);
    ctx.run.emitArtifact({
      fileName: resolveFileName(config.fileName, ctx.run.params, ctx.flow?.params),
      mimeType: XLSX_MIME,
      data,
    });
    return {};
  },
};
