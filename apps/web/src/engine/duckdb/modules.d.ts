/** Build-time modules of the DuckDB runtime (see apps/web/build/duckdb-wasm.ts). */

declare module 'virtual:duckdb-manifest' {
  /** Same shape as `DuckDbManifest` (./manifest.ts); ambient modules cannot import relatively. */
  const manifest: {
    version: string;
    totalBytes: number;
    sha256: string;
    parts: { file: string; bytes: number; sha256: string }[];
  };
  export default manifest;
}

/**
 * DuckDB-WASM's synchronous browser bindings (`dist/duckdb-browser-blocking.mjs`). The package
 * does not export this file, so Vite aliases it; the API matches the exported types.
 */
declare module '@hrflow/duckdb-browser-blocking' {
  import type {
    DuckDBBindings,
    DuckDBBundles,
    DuckDBRuntime,
    Logger,
  } from '@duckdb/duckdb-wasm/blocking';
  export function createDuckDB(
    bundles: DuckDBBundles,
    logger: Logger,
    runtime: DuckDBRuntime,
  ): Promise<DuckDBBindings>;
  export const BROWSER_RUNTIME: DuckDBRuntime;
  export class VoidLogger implements Logger {
    log(): void;
  }
}
