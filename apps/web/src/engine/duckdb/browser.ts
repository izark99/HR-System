import manifest from 'virtual:duckdb-manifest';
import { BROWSER_RUNTIME, createDuckDB, VoidLogger } from '@hrflow/duckdb-browser-blocking';
import { EngineError } from '../core/types';
import { DuckDb, type DuckDbProvider } from './db';
import { loadWasmBytes } from './loader';

/**
 * DuckDB inside the engine worker (spec §13.1). Loaded lazily (this module is a separate chunk,
 * imported only when a flow has a DuckDB node). The verified .wasm is handed to DuckDB through a
 * local `blob:` URL created here and revoked as soon as instantiation finishes; CSP `connect-src`
 * allows `blob:` for exactly this.
 */

/** A CSP-blocked or broken module makes DuckDB's instantiation hang instead of failing. */
const INSTANTIATE_TIMEOUT_MS = 120_000;

let pending: Promise<DuckDb> | null = null;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new EngineError('duckdb.error.loadFailed')), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        reject(new EngineError('duckdb.error.loadFailed'));
      },
    );
  });
}

async function open(onProgress?: Parameters<DuckDbProvider>[0]): Promise<DuckDb> {
  const bytes = await loadWasmBytes(
    manifest,
    {
      fetch: (url) => fetch(url, { credentials: 'same-origin' }),
      caches: typeof caches === 'undefined' ? undefined : caches,
      baseUrl: new URL(import.meta.env.BASE_URL, self.location.origin).href,
    },
    onProgress,
  );
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/wasm' }));
  try {
    const bundle = { mainModule: url, mainWorker: '' };
    const bindings = await withTimeout(
      (async () => {
        const b = await createDuckDB(
          { mvp: bundle, eh: bundle },
          new VoidLogger(),
          BROWSER_RUNTIME,
        );
        await b.instantiate(() => undefined);
        return b;
      })(),
      INSTANTIATE_TIMEOUT_MS,
    );
    try {
      return new DuckDb(bindings);
    } catch {
      throw new EngineError('duckdb.error.loadFailed');
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One DuckDB per worker; a failed load can be retried by the next run. */
export const browserDuckDb: DuckDbProvider = (onProgress) => {
  pending ??= open(onProgress).catch((err: unknown) => {
    pending = null;
    throw err;
  });
  return pending;
};
