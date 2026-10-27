/**
 * `duckdb-manifest.json` (spec §13.1): the self-hosted `duckdb-eh.wasm` split into parts below
 * Cloudflare Pages' 25 MiB file limit. Written by the build (apps/web/build/duckdb-wasm.ts) and
 * embedded in the engine worker bundle, so the worker always checks the parts of its own build.
 */
export interface DuckDbManifest {
  /** `@duckdb/duckdb-wasm` package version. */
  version: string;
  totalBytes: number;
  /** SHA-256 (hex) of the whole .wasm. */
  sha256: string;
  /** In order; `file` is relative to the app base URL. */
  parts: { file: string; bytes: number; sha256: string }[];
}
