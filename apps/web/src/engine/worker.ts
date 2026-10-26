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
