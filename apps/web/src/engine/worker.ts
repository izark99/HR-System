/**
 * Engine Web Worker (spec §13). All Excel parsing, validation, the DAG run and the .xlsx export
 * happen here; the main thread only holds `File` handles and renders the summaries and row pages
 * this worker returns. No network access and no logging of cell values.
 */
import * as Comlink from 'comlink';
import type { FileDownload, ParamValues, RowQuery, RunProgressEvent, UploadFile } from './protocol';
import { EngineSession } from './session';

const session = new EngineSession('vi');

function transferable(file: FileDownload): FileDownload {
  return Comlink.transfer(file, [file.data]);
}

const api = {
  loadFlow: (raw: unknown) => session.loadFlow(raw),
  setSlotFiles: (slotKey: string, files: UploadFile[]) => session.setSlotFiles(slotKey, files),
  run: (params: ParamValues, onProgress?: (event: RunProgressEvent) => void) =>
    session.run(params, onProgress ? (e) => void onProgress(e) : undefined),
  cancel: () => session.cancel(),
  getRows: (sheetId: string, query: RowQuery) => session.getRows(sheetId, query),
  getFilterOptions: (sheetId: string) => session.getFilterOptions(sheetId),
  getArtifact: (index: number) => transferable(session.getArtifact(index)),
  validationReportFile: async () => transferable(await session.validationReportFile()),
};

export type EngineApi = typeof api;

Comlink.expose(api);
