import { createDuckDB, NODE_RUNTIME, VoidLogger } from '@duckdb/duckdb-wasm/blocking';
import { createRequire } from 'node:module';
import { DuckDb, type DuckDbProvider } from '../duckdb/db';

/**
 * DuckDB for Vitest: the same package and the same `duckdb-eh.wasm` as the browser build
 * (spec §20), through the Node blocking bindings. One instance per test file.
 */
const require = createRequire(import.meta.url);

let pending: Promise<DuckDb> | null = null;

export const nodeDuckDb: DuckDbProvider = () => {
  pending ??= (async () => {
    const eh = require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm');
    const mvp = require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm');
    const bindings = await createDuckDB(
      { mvp: { mainModule: mvp, mainWorker: '' }, eh: { mainModule: eh, mainWorker: '' } },
      new VoidLogger(),
      NODE_RUNTIME,
    );
    await bindings.instantiate(() => undefined);
    return new DuckDb(bindings);
  })();
  return pending;
};
