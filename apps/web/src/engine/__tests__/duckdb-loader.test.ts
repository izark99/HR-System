import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CACHE_PREFIX, cacheName, loadWasmBytes } from '../duckdb/loader';
import type { DuckDbManifest } from '../duckdb/manifest';

/** Part download, checksum, cache and retry of the DuckDB .wasm (spec §13.1, AC-B3-02..04). */

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const wasm = new Uint8Array(Array.from({ length: 1000 }, (_, i) => (i * 7) % 256));
const parts = [wasm.slice(0, 400), wasm.slice(400, 800), wasm.slice(800)];
const manifest: DuckDbManifest = {
  version: '1.32.0',
  totalBytes: wasm.length,
  sha256: sha(wasm),
  parts: parts.map((p, i) => ({
    file: `duckdb/v/duckdb-eh.wasm.part${i}`,
    bytes: p.length,
    sha256: sha(p),
  })),
};
const BASE = 'https://app.example/';

/** Minimal in-memory CacheStorage. */
function fakeCaches() {
  const stores = new Map<string, Map<string, ArrayBuffer>>();
  const storage = {
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
    open: (name: string) => {
      let store = stores.get(name);
      if (!store) stores.set(name, (store = new Map<string, ArrayBuffer>()));
      const s = store;
      return Promise.resolve({
        match: (url: string) => {
          const b = s.get(url);
          return Promise.resolve(b ? new Response(b.slice(0)) : undefined);
        },
        put: async (url: string, res: Response) => {
          s.set(url, await res.arrayBuffer());
        },
      });
    },
  };
  return { storage: storage as unknown as CacheStorage, stores };
}

function server(serve: (i: number) => Uint8Array = (i) => parts[i]!) {
  return vi.fn((url: string) => {
    expect(url.startsWith(BASE)).toBe(true);
    const i = Number(/part(\d+)$/.exec(url)![1]);
    return Promise.resolve(new Response(serve(i).slice()));
  });
}

describe('loadWasmBytes', () => {
  it('AC-B3-02: downloads every part from the app origin, verifies and reassembles', async () => {
    const fetch = server();
    const progress: number[] = [];
    const bytes = await loadWasmBytes(manifest, { fetch, baseUrl: BASE }, (p) =>
      progress.push(p.loadedBytes),
    );
    expect(Buffer.from(bytes).equals(Buffer.from(wasm))).toBe(true);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(
      manifest.parts.map((p) => `${BASE}${p.file}`),
    );
    expect(progress).toEqual([0, 400, 800, 1000]);
  });

  it('AC-B3-03: the second load comes from Cache Storage; old versions are removed', async () => {
    const { storage, stores } = fakeCaches();
    stores.set(`${CACHE_PREFIX}1.0.0-old`, new Map());
    stores.set('other-app-cache', new Map());
    const first = server();
    await loadWasmBytes(manifest, { fetch: first, caches: storage, baseUrl: BASE });
    expect(first).toHaveBeenCalledTimes(3);
    expect([...stores.keys()].sort()).toEqual([cacheName(manifest), 'other-app-cache'].sort());
    const second = server();
    const bytes = await loadWasmBytes(manifest, { fetch: second, caches: storage, baseUrl: BASE });
    expect(second).not.toHaveBeenCalled();
    expect(bytes.length).toBe(wasm.length);
  });

  it('AC-B3-04: a corrupt cached part → cache cleared, one fresh download', async () => {
    const { storage, stores } = fakeCaches();
    await loadWasmBytes(manifest, { fetch: server(), caches: storage, baseUrl: BASE });
    const store = stores.get(cacheName(manifest))!;
    store.set(`${BASE}${manifest.parts[1]!.file}`, new Uint8Array(400).buffer);
    const fetch = server();
    const bytes = await loadWasmBytes(manifest, { fetch, caches: storage, baseUrl: BASE });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(Buffer.from(bytes).equals(Buffer.from(wasm))).toBe(true);
  });

  it('AC-B3-04: still wrong after the retry → duckdb.error.loadFailed, nothing cached', async () => {
    const { storage, stores } = fakeCaches();
    const fetch = server((i) => (i === 2 ? new Uint8Array(200) : parts[i]!));
    await expect(
      loadWasmBytes(manifest, { fetch, caches: storage, baseUrl: BASE }),
    ).rejects.toMatchObject({ messageKey: 'duckdb.error.loadFailed' });
    expect(fetch.mock.calls.length).toBe(6);
    expect(stores.has(cacheName(manifest))).toBe(false);
  });

  it('a failed download (HTTP error) is retried once, then loadFailed', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 404 })));
    await expect(loadWasmBytes(manifest, { fetch, baseUrl: BASE })).rejects.toMatchObject({
      messageKey: 'duckdb.error.loadFailed',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
