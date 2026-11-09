// `common` + `engine` through the entry's own import (not a second import of the JSON files, which
// would move them out of the entry chunk into a shared one: bundle budget, AC-TX-07).
import { resources } from '../../../i18n';
import viDesigner from '../../../locales/vi/designer.json';
import viEngineFields from '../../../locales/vi/engine-fields.json';
import viRefTables from '../../../locales/vi/ref-tables.json';
import viUiText from '../../../locales/vi/ui-text.json';

/**
 * Every i18n text of the app (spec §33 AC-TX-02), from the default JSON files (i18next works on
 * copies, so these stay the built-in texts). A key added to a JSON file shows up by itself.
 */
export const UI_TEXT_GROUPS = [
  'common',
  'auth',
  'flows',
  'run',
  'result',
  'admin',
  'designer',
  'functions',
  'validation',
  'runtime',
] as const;
export type UiTextGroup = (typeof UI_TEXT_GROUPS)[number];

/** Default texts by namespace (`common` is i18next's default namespace). */
export const UI_TEXT_NAMESPACES: Record<string, unknown> = {
  common: resources.vi.common,
  designer: viDesigner,
  engine: resources.vi.engine,
  engineFields: viEngineFields,
  uiText: viUiText,
  refTables: viRefTables,
};

/**
 * Key prefix → "Màn" group. The longest matching prefix wins (`common:admin.nav` before
 * `common:admin`). `common` and `engine` are listed by section so a new section must be placed
 * on purpose (unit test); the other namespaces belong to one screen as a whole.
 */
export const GROUP_PREFIXES: Record<string, UiTextGroup> = {
  // App frame, menus, screen names, shared controls.
  'common:app': 'common',
  'common:nav': 'common',
  'common:common': 'common',
  'common:config': 'common',
  'common:picker': 'common',
  'common:userMenu': 'common',
  'common:idle': 'common',
  'common:select': 'common',
  'common:admin.nav': 'common',
  'common:auth': 'auth',
  'common:flows': 'flows',
  'common:recent': 'flows',
  'common:run': 'run',
  'common:slot': 'run',
  'common:report': 'run',
  'common:result': 'result',
  'common:admin': 'admin',
  'uiText:': 'admin',
  'refTables:': 'admin',
  'designer:': 'designer',
  'designer:formula.fn': 'functions',
  'engineFields:': 'designer',
  'engine:design': 'designer',
  'engine:preview': 'designer',
  'engine:inputExcel': 'designer',
  'engine:validation': 'validation',
  'engine:skipped': 'validation',
  'engine:report': 'validation',
  'engine:flow': 'validation',
  'engine:executor': 'runtime',
  'engine:compare': 'runtime',
  'engine:select': 'runtime',
  'engine:filter': 'runtime',
  'engine:sort': 'runtime',
  'engine:join': 'runtime',
  'engine:union': 'runtime',
  'engine:groupBy': 'runtime',
  'engine:dedupe': 'runtime',
  'engine:sql': 'runtime',
  'engine:duckdb': 'runtime',
  'engine:formula': 'runtime',
};

function matches(key: string, prefix: string): boolean {
  if (prefix.endsWith(':')) return key.startsWith(prefix);
  return key === prefix || key.startsWith(`${prefix}.`);
}

/** Group of a key by the most specific prefix, or null when no prefix covers it. */
export function groupOf(key: string): UiTextGroup | null {
  let best: string | null = null;
  for (const p of Object.keys(GROUP_PREFIXES)) {
    if (matches(key, p) && (best === null || p.length > best.length)) best = p;
  }
  return best === null ? null : GROUP_PREFIXES[best]!;
}

export interface UiTextEntry {
  /** Stored key, `<namespace>:<path>`. */
  key: string;
  /** Code shown to the Admin: the path for `common`, else `<namespace>:<path>`. */
  code: string;
  group: UiTextGroup;
  /** Built-in text. */
  text: string;
}

function flatten(obj: unknown, prefix: string, out: [string, string][]): void {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push([path, v]);
    else if (v && typeof v === 'object') flatten(v, path, out);
  }
}

export function buildCatalog(
  namespaces: Record<string, unknown> = UI_TEXT_NAMESPACES,
): UiTextEntry[] {
  const list: UiTextEntry[] = [];
  for (const [ns, data] of Object.entries(namespaces)) {
    const pairs: [string, string][] = [];
    flatten(data, '', pairs);
    for (const [path, text] of pairs) {
      const key = `${ns}:${path}`;
      // A section nobody placed yet still shows (under "Chung"); the unit test flags it.
      list.push({ key, code: ns === 'common' ? path : key, group: groupOf(key) ?? 'common', text });
    }
  }
  return list;
}
