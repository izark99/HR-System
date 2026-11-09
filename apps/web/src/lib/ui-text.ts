import i18next from 'i18next';
import type { Supabase } from './supabase';
import { sameVars } from './text-vars';

/**
 * Texts edited by Admins (spec §33 AC-TX-05), by `<namespace>:<path>`. Loaded once at start-up
 * (also before sign-in) and applied to i18next; a namespace loaded later (e.g. `designer`) gets
 * its texts when it loads (`applyTextOverrides`), the engine worker through `textOverrides`.
 * Interface wording only, never data; nothing here is logged.
 */
const edited = new Map<string, string>();
/** Default text of every key changed in i18next, to put it back. */
const defaults = new Map<string, string>();
let generation = 0;

/** Changes on every edit (the engine client re-sends the texts to its worker). */
export const textGeneration = (): number => generation;

/** Edited texts of the given namespaces. */
export function textOverrides(namespaces: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of edited) if (namespaces.includes(k.split(':')[0]!)) out[k] = v;
  return out;
}

function put(key: string): void {
  const i = key.indexOf(':');
  const ns = key.slice(0, i);
  const path = key.slice(i + 1);
  if (!i18next.hasResourceBundle('vi', ns)) return;
  const base: unknown = defaults.get(key) ?? i18next.getResource('vi', ns, path);
  // A key no longer in the code is ignored, so is a text whose variables no longer match.
  if (typeof base !== 'string') return;
  defaults.set(key, base);
  const v = edited.get(key);
  i18next.addResource('vi', ns, path, v !== undefined && sameVars(v, base) ? v : base, {
    silent: true,
  });
}

/** Set edited texts (null: back to the default) and re-render the screens. */
export function setTextOverrides(entries: [string, string | null][]): void {
  for (const [k, v] of entries) {
    if (v === null) edited.delete(k);
    else edited.set(k, v);
    put(k);
  }
  generation++;
  i18next.emit('languageChanged', i18next.language);
}

/** Apply the edited texts of a namespace that has just been added to i18next. */
export function applyTextOverrides(ns: string): void {
  for (const k of edited.keys()) if (k.startsWith(`${ns}:`)) put(k);
}

/**
 * Load the edited texts; resolves when they are applied, on failure (defaults stay) or after
 * `waitMs` (a late answer is still applied).
 */
export function loadTextOverrides(sb: Supabase, waitMs = 1500): Promise<unknown> {
  const load = sb
    .from('ui_text_overrides')
    .select('key, value')
    .not('value', 'is', null)
    .then(
      ({ data }) => data && setTextOverrides(data.map((r) => [r.key, r.value])),
      () => undefined,
    );
  return Promise.race([load, new Promise((r) => setTimeout(r, waitMs))]);
}
