/**
 * Engine Web Worker (spec §13). All Excel parsing, validation, the DAG run and the .xlsx export
 * happen here; the main thread only holds `File` handles and renders the summaries and row pages
 * this worker returns. No network access and no logging of cell values.
 */
import * as Comlink from 'comlink';
import type { DuckDbProvider } from './duckdb/base';
import type { FileDownload, ParamValues, RowQuery, RunProgressEvent, UploadFile } from './protocol';
import { createEngineTranslator } from './core/i18n';
import { checkDesign } from './design';
import { PreviewSession } from './preview';
import { EngineSession } from './session';

/** DuckDB-WASM is a separate chunk, fetched only when a flow has a DuckDB node (spec §13.1). */
const duck: DuckDbProvider = async (onProgress) =>
  (await import('./duckdb/browser')).browserDuckDb(onProgress);

const session = new EngineSession('vi', { duck });
const designT = createEngineTranslator('vi');
/** Designer samples (spec §13.3): RAM of this worker only. */
const preview = new PreviewSession(designT, duck);

function transferable(file: FileDownload): FileDownload {
  return Comlink.transfer(file, [file.data]);
}

const api = {
  loadFlow: (raw: unknown) => session.loadFlow(raw),
  /** Designer / publish check: every problem + inferred columns (no data, spec §13.2). */
  checkDesign: (raw: unknown) => checkDesign(raw, { t: designT, duck }),
  previewSetSamples: (slotKey: string, files: UploadFile[], slot: unknown) =>
    preview.setSampleFiles(slotKey, files, slot),
  previewValidate: (slotKey: string, slot: unknown) => preview.validate(slotKey, slot),
  previewRun: (raw: unknown, nodeId: string, params: ParamValues) =>
    preview.preview(raw, nodeId, params),
  setSlotFiles: (slotKey: string, files: UploadFile[], version: number) =>
    session.setSlotFiles(slotKey, files, version),
  /** Progress goes over a port owned by the caller (closed by both sides when the run ends). */
  run: async (params: ParamValues, progress?: MessagePort) => {
    try {
      return await session.run(
        params,
        progress ? (e: RunProgressEvent) => progress.postMessage(e) : undefined,
      );
    } finally {
      progress?.close();
    }
  },
  cancel: () => session.cancel(),
  getRows: (sheetId: string, query: RowQuery) => session.getRows(sheetId, query),
  getFilterOptions: (sheetId: string) => session.getFilterOptions(sheetId),
  getArtifact: (index: number) => transferable(session.getArtifact(index)),
  validationReportFile: async () => transferable(await session.validationReportFile()),
};

export type EngineApi = typeof api;

Comlink.expose(api);
