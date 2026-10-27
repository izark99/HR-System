import { EngineError } from '../core/types';
import type { DuckDbLoadProgress } from './base';
import type { DuckDbManifest } from './manifest';

/**
 * Download + verify + reassemble the DuckDB .wasm parts (spec §13.1, AC-B3-02..04).
 *
 * - Parts come from the app's own origin only.
 * - Every part and the whole file are checked against the manifest's SHA-256.
 * - Verified parts are kept in Cache Storage under a name keyed by version + checksum; caches of
 *   other versions are deleted. The cache only ever holds the WASM binary, never data.
 * - A bad checksum (or a failed download) clears the cache and retries once from the network;
 *   a second failure is `duckdb.error.loadFailed`.
 */

export const CACHE_PREFIX = 'hrflow-duckdb-';

export interface LoaderDeps {
  fetch: (url: string) => Promise<Response>;
  /** `caches` when available (secure contexts); absent → no caching. */
  caches?: CacheStorage | undefined;
  /** Base URL the part paths are relative to (the app origin + base path). */
  baseUrl: string;
}

export function cacheName(manifest: DuckDbManifest): string {
  return `${CACHE_PREFIX}${manifest.version}-${manifest.sha256.slice(0, 16)}`;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

class PartError extends Error {}

async function openCache(deps: LoaderDeps, name: string): Promise<Cache | null> {
  if (!deps.caches) return null;
  try {
    for (const key of await deps.caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== name) await deps.caches.delete(key);
    }
    return await deps.caches.open(name);
  } catch {
    return null;
  }
}

async function assemble(
  manifest: DuckDbManifest,
  deps: LoaderDeps,
  cache: Cache | null,
  useCache: boolean,
  onProgress?: (p: DuckDbLoadProgress) => void,
): Promise<Uint8Array> {
  const out = new Uint8Array(manifest.totalBytes);
  let offset = 0;
  onProgress?.({ loadedBytes: 0, totalBytes: manifest.totalBytes });
  for (const part of manifest.parts) {
    const url = new URL(part.file, deps.baseUrl).href;
    let buf: ArrayBuffer | null = null;
    if (cache && useCache) {
      const hit = await cache.match(url);
      if (hit) buf = await hit.arrayBuffer();
    }
    const fromCache = buf !== null;
    if (!buf) {
      const res = await deps.fetch(url);
      if (!res.ok) throw new PartError('download');
      buf = await res.arrayBuffer();
    }
    if (buf.byteLength !== part.bytes || (await sha256Hex(buf)) !== part.sha256) {
      throw new PartError('checksum');
    }
    if (cache && !fromCache) {
      await cache
        .put(url, new Response(buf, { headers: { 'Content-Type': 'application/wasm' } }))
        .catch(() => undefined);
    }
    if (offset + buf.byteLength > out.byteLength) throw new PartError('size');
    out.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
    onProgress?.({ loadedBytes: offset, totalBytes: manifest.totalBytes });
  }
  if (offset !== manifest.totalBytes || (await sha256Hex(out)) !== manifest.sha256) {
    throw new PartError('checksum');
  }
  return out;
}

/** The verified .wasm bytes. Rejects with `duckdb.error.loadFailed`. */
export async function loadWasmBytes(
  manifest: DuckDbManifest,
  deps: LoaderDeps,
  onProgress?: (p: DuckDbLoadProgress) => void,
): Promise<Uint8Array> {
  const name = cacheName(manifest);
  const cache = await openCache(deps, name);
  try {
    return await assemble(manifest, deps, cache, true, onProgress);
  } catch {
    // Wrong or partial cache content, or a broken download: start over from the network once.
    if (deps.caches) await deps.caches.delete(name).catch(() => false);
    const fresh = await openCache(deps, name);
    try {
      return await assemble(manifest, deps, fresh, false, onProgress);
    } catch {
      if (deps.caches) await deps.caches.delete(name).catch(() => false);
      throw new EngineError('duckdb.error.loadFailed');
    }
  }
}
