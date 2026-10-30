import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import viEngine from '../../locales/vi/engine.json';

const ENGINE_DIR = resolve(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '__tests__') return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function lookup(obj: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);
}

describe('engine i18n', () => {
  it('every message key referenced by the engine exists in vi/engine.json', () => {
    const keys = new Set<string>();
    for (const file of sourceFiles(ENGINE_DIR)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(
        /'((?:validation|compare|skipped|executor|report|flow|select|filter|sort|join|union|groupBy|dedupe|sql|duckdb|preview|inputExcel|design)\.[A-Za-z_.]+)'/g,
      ))
        keys.add(m[1]!);
    }
    expect(keys.size).toBeGreaterThan(20);
    const missing = [...keys].filter((k) => typeof lookup(viEngine, k) !== 'string');
    expect(missing).toEqual([]);
  });

  it('has a label for every data type', () => {
    for (const type of ['string', 'integer', 'decimal', 'boolean', 'date', 'datetime']) {
      expect(typeof lookup(viEngine, `validation.type_${type}`)).toBe('string');
    }
  });
});
