import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCommon from './locales/en/common.json';
import enEngine from './locales/en/engine.json';
import viCommon from './locales/vi/common.json';
import viEngine from './locales/vi/engine.json';

export const resources = {
  vi: { common: viCommon, engine: viEngine },
  en: { common: enCommon, engine: enEngine },
} as const;

void i18next.use(initReactI18next).init({
  resources,
  lng: 'vi',
  fallbackLng: 'vi',
  ns: ['common', 'engine'],
  defaultNS: 'common',
  // React already escapes output.
  interpolation: { escapeValue: false },
});

export default i18next;
