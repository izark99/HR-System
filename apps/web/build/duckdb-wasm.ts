import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import type { DuckDbManifest } from '../src/engine/duckdb/manifest';

/**
 * Self-hosting DuckDB-WASM on Cloudflare Pages (spec §13.1, AC-B3-01).
 *
 * `duckdb-eh.wasm` (~34 MB) is larger than the 25 MiB per-file limit of Cloudflare Pages, so the
 * build splits it into parts of at most PART_BYTES and writes `duckdb/duckdb-manifest.json`
 * ({ version, totalBytes, sha256, parts: [{ file, bytes, sha256 }] }). The same manifest is
 * embedded in the engine worker through `virtual:duckdb-manifest`. Part paths contain the version
 * and checksum, so a new DuckDB never mixes with cached parts of an old one.
 *
 * After the build, every file in the output directory must be below 25 MiB (the build fails
 * otherwise). `vite dev` serves the parts from memory.
 */

const require = createRequire(import.meta.url);
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const PART_BYTES = 20 * 1024 * 1024;
const VIRTUAL_ID = 'virtual:duckdb-manifest';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
export const MANIFEST_FILE = 'duckdb/duckdb-manifest.json';

/** Absolute path of DuckDB-WASM's `dist/` directory. */
export const DUCKDB_DIST = dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-eh.wasm'));

interface Split {
  manifest: DuckDbManifest;
  parts: { file: string; data: Buffer }[];
}

let cached: Split | null = null;

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export function splitDuckDbWasm(): Split {
  if (cached) return cached;
  const wasm = readFileSync(join(DUCKDB_DIST, 'duckdb-eh.wasm'));
  const pkg = JSON.parse(readFileSync(join(DUCKDB_DIST, '..', 'package.json'), 'utf8')) as {
    version: string;
  };
  const total = sha256(wasm);
  const dir = `duckdb/${pkg.version}-${total.slice(0, 12)}`;
  const parts: Split['parts'] = [];
  for (let i = 0, offset = 0; offset < wasm.length; i++, offset += PART_BYTES) {
    parts.push({
      file: `${dir}/duckdb-eh.wasm.part${i}`,
      data: wasm.subarray(offset, offset + PART_BYTES),
    });
  }
  cached = {
    manifest: {
      version: pkg.version,
      totalBytes: wasm.length,
      sha256: total,
      parts: parts.map((p) => ({ file: p.file, bytes: p.data.length, sha256: sha256(p.data) })),
    },
    parts,
  };
  return cached;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** Resolves `virtual:duckdb-manifest` (needed by the main and the worker build). */
export function duckDbManifestModule(): Plugin {
  return {
    name: 'hrflow:duckdb-manifest',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      return `export default ${JSON.stringify(splitDuckDbWasm().manifest)};`;
    },
  };
}

/** Emits the parts + manifest, serves them in dev, checks the output file sizes. */
export function duckDbWasm(): Plugin[] {
  let config: ResolvedConfig;
  return [
    duckDbManifestModule(),
    {
      name: 'hrflow:duckdb-wasm',
      configResolved(c) {
        config = c;
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
          const split = path.startsWith('duckdb/') ? splitDuckDbWasm() : null;
          if (path === MANIFEST_FILE && split) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(split.manifest));
            return;
          }
          const part = split?.parts.find((p) => p.file === path);
          if (!part) return next();
          res.setHeader('Content-Type', 'application/octet-stream');
          res.end(part.data);
        });
      },
      generateBundle() {
        const split = splitDuckDbWasm();
        for (const part of split.parts) {
          this.emitFile({ type: 'asset', fileName: part.file, source: part.data });
        }
        this.emitFile({
          type: 'asset',
          fileName: MANIFEST_FILE,
          source: `${JSON.stringify(split.manifest, null, 2)}\n`,
        });
      },
      closeBundle() {
        if (config.command !== 'build') return;
        const outDir = resolve(config.root, config.build.outDir);
        const tooBig = walk(outDir).filter((f) => statSync(f).size >= MAX_FILE_BYTES);
        if (tooBig.length > 0) {
          throw new Error(
            `Files of 25 MiB or more cannot be deployed to Cloudflare Pages: ${tooBig
              .map((f) => relative(outDir, f))
              .join(', ')}`,
          );
        }
      },
    },
  ];
}
