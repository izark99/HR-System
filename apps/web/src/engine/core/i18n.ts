import i18next, { type i18n } from 'i18next';
import enEngine from '../../locales/en/engine.json';
import viEngine from '../../locales/vi/engine.json';
import viEngineFields from '../../locales/vi/engine-fields.json';
import { sameVars } from '../../lib/text-vars';
import type { Translate } from './types';

/** Namespaces whose texts an Admin may edit for the engine (spec §33 AC-TX-05). */
export const ENGINE_TEXT_NAMESPACES = ['engine', 'engineFields'];

let overrides: Record<string, string> = {};
let generation = 0;

/**
 * Texts edited by Admins (`<namespace>:<path>` → text), sent by the main thread when the worker
 * starts. Translators pick them up on their next call. An entry for a key that does not exist, or
 * whose variables differ from the default text, is ignored.
 */
export function setEngineTextOverrides(map: Record<string, string>): void {
  overrides = { ...map };
  generation++;
}

function build(lng: 'vi' | 'en'): i18n {
  const instance = i18next.createInstance();
  void instance.init({
    lng,
    fallbackLng: 'vi',
    // `engineFields`: form labels for design-check messages (worker only, not in the app entry).
    ns: ['engine', 'engineFields'],
    defaultNS: 'engine',
    // Copies: overrides must never change the default JSON (shared by every instance).
    resources: structuredClone({
      vi: { engine: viEngine, engineFields: viEngineFields },
      en: { engine: enEngine },
    }),
    // Output goes to Excel/plain text, not HTML.
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  for (const [key, text] of Object.entries(overrides)) {
    const i = key.indexOf(':');
    const ns = key.slice(0, i);
    const path = key.slice(i + 1);
    if (!ENGINE_TEXT_NAMESPACES.includes(ns)) continue;
    const base: unknown = instance.getResource('vi', ns, path);
    if (typeof base === 'string' && sameVars(text, base)) {
      instance.addResource('vi', ns, path, text, { silent: true });
    }
  }
  return instance;
}

/**
 * Standalone translator for the engine (runs in a worker, no React).
 * Keys are relative to the `engine` namespace, e.g. "validation.columnMissing".
 */
export function createEngineTranslator(lng: 'vi' | 'en' = 'vi'): Translate {
  let instance = build(lng);
  let built = generation;
  return (key, params) => {
    if (built !== generation) {
      instance = build(lng);
      built = generation;
    }
    return instance.t(key, params ?? {});
  };
}
