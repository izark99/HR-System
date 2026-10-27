import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DUCKDB_DIST, MAX_FILE_BYTES, splitDuckDbWasm } from '../../../build/duckdb-wasm';

/** Build split of duckdb-eh.wasm (spec §13.1, AC-B3-01) and the CSP in _headers (AC-B3-02b). */

describe('DuckDB .wasm split', () => {
  it('parts are < 25 MiB, checksummed, and reassemble to the original', () => {
    const { manifest, parts } = splitDuckDbWasm();
    const wasm = readFileSync(join(DUCKDB_DIST, 'duckdb-eh.wasm'));
    expect(parts.length).toBeGreaterThan(1);
    expect(manifest.totalBytes).toBe(wasm.length);
    expect(manifest.sha256).toBe(createHash('sha256').update(wasm).digest('hex'));
    for (const [i, p] of parts.entries()) {
      expect(p.data.length).toBeLessThan(MAX_FILE_BYTES);
      expect(manifest.parts[i]).toEqual({
        file: p.file,
        bytes: p.data.length,
        sha256: createHash('sha256').update(p.data).digest('hex'),
      });
      expect(p.file).toMatch(
        new RegExp(`^duckdb/${manifest.version}-[0-9a-f]{12}/duckdb-eh\\.wasm\\.part${i}$`),
      );
    }
    expect(Buffer.concat(parts.map((p) => p.data)).equals(wasm)).toBe(true);
  });
});

describe('Content-Security-Policy in public/_headers', () => {
  const headers = readFileSync(resolve(import.meta.dirname, '../../../public/_headers'), 'utf8');
  const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)![1]!;
  const directives = Object.fromEntries(
    csp.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name!, values];
    }),
  );
  const supabase = 'rzakjtgvbyxqsmbpcomw.supabase.co';

  it('matches spec §17', () => {
    expect(directives['default-src']).toEqual(["'self'"]);
    expect(directives['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(directives['worker-src']).toEqual(["'self'", 'blob:']);
    expect(directives['connect-src']).toEqual([
      "'self'",
      `https://${supabase}`,
      `wss://${supabase}`,
      'blob:',
    ]);
    expect(directives['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives['font-src']).toEqual(["'self'"]);
    expect(directives['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(directives['object-src']).toEqual(["'none'"]);
    expect(directives['base-uri']).toEqual(["'self'"]);
    expect(directives['form-action']).toEqual(["'self'"]);
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
    expect(directives['script-src']).not.toContain("'unsafe-inline'");
  });
});
