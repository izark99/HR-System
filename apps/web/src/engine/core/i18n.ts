import i18next from 'i18next';
import enEngine from '../../locales/en/engine.json';
import viEngine from '../../locales/vi/engine.json';
import viEngineFields from '../../locales/vi/engine-fields.json';
import type { Translate } from './types';

/**
 * Standalone translator for the engine (runs in a worker, no React).
 * Keys are relative to the `engine` namespace, e.g. "validation.columnMissing".
 */
export function createEngineTranslator(lng: 'vi' | 'en' = 'vi'): Translate {
  const instance = i18next.createInstance();
  void instance.init({
    lng,
    fallbackLng: 'vi',
    // `engineFields`: form labels for design-check messages (worker only, not in the app entry).
    ns: ['engine', 'engineFields'],
    defaultNS: 'engine',
    resources: {
      vi: { engine: viEngine, engineFields: viEngineFields },
      en: { engine: enEngine },
    },
    // Output goes to Excel/plain text, not HTML.
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return (key, params) => instance.t(key, params ?? {});
}
