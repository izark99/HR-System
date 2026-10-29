import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import designer from '../../../locales/vi/designer.json';
import { NODE_GROUPS, NODE_TYPES, typeKey } from '../catalog';

const DIR = resolve(import.meta.dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '__tests__') return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

function lookup(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], designer);
}

describe('designer i18n', () => {
  it('every static key used by the Designer exists in vi/designer.json', () => {
    const keys = new Set<string>();
    for (const f of files(DIR)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
        keys.add(m[1]!);
      }
    }
    expect(keys.size).toBeGreaterThan(100);
    expect([...keys].filter((k) => typeof lookup(k) !== 'string')).toEqual([]);
  });

  it('dynamic keys: every node type, group, filter op, aggregation, type has a text', () => {
    const dynamic = [
      ...NODE_TYPES.flatMap((s) => [
        `types.node.${typeKey(s.type)}`,
        `palette.desc.${typeKey(s.type)}`,
      ]),
      ...NODE_GROUPS.map((g) => `palette.groups.${g}`),
      ...['self', 'cycle', 'portTaken', 'unknownPort'].map((p) => `canvas.connect.${p}`),
      ...['string', 'integer', 'decimal', 'boolean', 'date', 'datetime'].flatMap((x) => [
        `types.${x}`,
        `node.filter.valueHint.${x}`,
        `slot.col.defaultHint.${x}`,
      ]),
      ...['params', 'slots'].map((x) => `panel.tabs.${x}`),
    ];
    expect(dynamic.filter((k) => typeof lookup(k) !== 'string')).toEqual([]);
  });

  it('no symbols that the font may lack (spec §25.4)', () => {
    expect(JSON.stringify(designer)).not.toMatch(/[≤≥→×−]/);
  });
});
