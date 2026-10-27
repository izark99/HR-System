import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CACHE_PREFIX, cacheName, loadWasmBytes } from '../duckdb/loader';
import type { DuckDbManifest } from '../duckdb/manifest';

/**
 * QA edge cases of the self-hosted DuckDB loader (spec §13.1, AC-B3-02..04): whole-file checksum,
 * size lies, network failures, Cache Storage that is missing / throws / is full, partial caches.
 */

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const wasm = new Uint8Array(Array.from({ length: 1000 }, (_, i) => (i * 13 + 5) % 256));
const parts = [wasm.slice(0, 300), wasm.slice(300, 700), wasm.slice(700)];
const manifest: DuckDbManifest = {
  version: '9.9.9',
  totalBytes: wasm.length,
  sha256: sha(wasm),
  parts: parts.map((p, i) => ({
    file: `duckdb/v/duckdb-eh.wasm.part${i}`,
    bytes: p.length,
    sha256: sha(p),
  })),
};
const BASE = 'https://app.example/';

function memoryCaches(
  opts: { putThrows?: boolean; openThrows?: boolean; keysThrows?: boolean } = {},
) {
  const stores = new Map<string, Map<string, ArrayBuffer>>();
  const storage = {
    keys: () =>
      opts.keysThrows ? Promise.reject(new Error('denied')) : Promise.resolve([...stores.keys()]),
    delete: (n: string) => Promise.resolve(stores.delete(n)),
    open: (n: string) => {
      if (opts.openThrows) return Promise.reject(new Error('SecurityError'));
      let s = stores.get(n);
      if (!s) stores.set(n, (s = new Map<string, ArrayBuffer>()));
      const store = s;
      return Promise.resolve({
        match: (u: string) =>
          Promise.resolve(store.has(u) ? new Response(store.get(u)!.slice(0)) : undefined),
        put: async (u: string, r: Response) => {
          if (opts.putThrows) throw new Error('QuotaExceededError');
          store.set(u, await r.arrayBuffer());
        },
      });
    },
  };
  return { storage: storage as unknown as CacheStorage, stores };
}
const serve = (map: (i: number) => Uint8Array | Response = (i) => parts[i]!) =>
  vi.fn((url: string) => {
    const r = map(Number(/part(\d+)$/.exec(url)![1]));
    return Promise.resolve(r instanceof Response ? r : new Response(r.slice()));
  });

describe('loadWasmBytes: edge cases', () => {
  it('all parts valid but the whole-file checksum in the manifest is wrong → loadFailed (twice fetched, nothing cached)', async () => {
    const bad = { ...manifest, sha256: sha(new Uint8Array(3)) };
    const { storage, stores } = memoryCaches();
    const fetch = serve();
    await expect(
      loadWasmBytes(bad, { fetch, caches: storage, baseUrl: BASE }),
    ).rejects.toMatchObject({
      messageKey: 'duckdb.error.loadFailed',
    });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(stores.has(cacheName(bad))).toBe(false);
  });

  it('a part with the right hash but a manifest that lies about its size is refused', async () => {
    const lie: DuckDbManifest = {
      ...manifest,
      parts: manifest.parts.map((p, i) => (i === 1 ? { ...p, bytes: p.bytes + 1 } : p)),
    };
    await expect(loadWasmBytes(lie, { fetch: serve(), baseUrl: BASE })).rejects.toMatchObject({
      messageKey: 'duckdb.error.loadFailed',
    });
  });

  it('totalBytes smaller than the parts (overflowing the output buffer) is refused, not truncated', async () => {
    const small: DuckDbManifest = { ...manifest, totalBytes: 500 };
    await expect(loadWasmBytes(small, { fetch: serve(), baseUrl: BASE })).rejects.toMatchObject({
      messageKey: 'duckdb.error.loadFailed',
    });
  });

  it('a network error (fetch rejects) on the first attempt is retried and succeeds', async () => {
    let n = 0;
    const fetch = vi.fn((url: string) => {
      n++;
      if (n === 2) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(new Response(parts[Number(/part(\d+)$/.exec(url)![1])]!.slice()));
    });
    const bytes = await loadWasmBytes(manifest, { fetch, baseUrl: BASE });
    expect(Buffer.from(bytes).equals(Buffer.from(wasm))).toBe(true);
  });

  it('an HTML error page served with status 200 (SPA fallback) fails the checksum', async () => {
    const fetch = serve(() => new Response('<!doctype html><title>app</title>', { status: 200 }));
    await expect(loadWasmBytes(manifest, { fetch, baseUrl: BASE })).rejects.toMatchObject({
      messageKey: 'duckdb.error.loadFailed',
    });
  });

  it('no Cache Storage at all: works, just uncached', async () => {
    const bytes = await loadWasmBytes(manifest, {
      fetch: serve(),
      caches: undefined,
      baseUrl: BASE,
    });
    expect(bytes.length).toBe(1000);
  });

  it('Cache Storage that throws on keys/open/put still lets the load succeed', async () => {
    for (const opts of [{ keysThrows: true }, { openThrows: true }, { putThrows: true }]) {
      const { storage } = memoryCaches(opts);
      const bytes = await loadWasmBytes(manifest, {
        fetch: serve(),
        caches: storage,
        baseUrl: BASE,
      });
      expect(Buffer.from(bytes).equals(Buffer.from(wasm)), JSON.stringify(opts)).toBe(true);
    }
  });

  it('a cache holding only some parts is completed from the network; caches of other apps are kept', async () => {
    const { storage, stores } = memoryCaches();
    stores.set('someone-elses', new Map());
    stores.set(`${CACHE_PREFIX}0.0.1-stale`, new Map([['x', new ArrayBuffer(8)]]));
    const first = serve();
    await loadWasmBytes(manifest, { fetch: first, caches: storage, baseUrl: BASE });
    stores.get(cacheName(manifest))!.delete(`${BASE}${manifest.parts[2]!.file}`);
    const second = serve();
    const bytes = await loadWasmBytes(manifest, { fetch: second, caches: storage, baseUrl: BASE });
    expect(second).toHaveBeenCalledTimes(1);
    expect(bytes.length).toBe(1000);
    expect([...stores.keys()].sort()).toEqual([cacheName(manifest), 'someone-elses'].sort());
  });

  it('a cached part of the right length but wrong content → one clean re-download, cache repaired', async () => {
    const { storage, stores } = memoryCaches();
    await loadWasmBytes(manifest, { fetch: serve(), caches: storage, baseUrl: BASE });
    const poisoned = new Uint8Array(parts[0]!.length).fill(7);
    stores.get(cacheName(manifest))!.set(`${BASE}${manifest.parts[0]!.file}`, poisoned.buffer);
    const fetch = serve();
    await loadWasmBytes(manifest, { fetch, caches: storage, baseUrl: BASE });
    expect(fetch).toHaveBeenCalledTimes(3);
    const third = serve();
    await loadWasmBytes(manifest, { fetch: third, caches: storage, baseUrl: BASE });
    expect(third).not.toHaveBeenCalled();
  });

  it('progress is monotonic, ends at totalBytes and is reported again on a retry', async () => {
    const seen: number[] = [];
    let first = true;
    const fetch = serve((i) => {
      if (first && i === 2) {
        first = false;
        return new Uint8Array(5);
      }
      return parts[i]!;
    });
    await loadWasmBytes(manifest, { fetch, baseUrl: BASE }, (p) => {
      expect(p.totalBytes).toBe(1000);
      seen.push(p.loadedBytes);
    });
    expect(seen).toEqual([0, 300, 700, 0, 300, 700, 1000]);
  });
});
