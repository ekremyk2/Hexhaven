// Test-only i18n bootstrap for the T-805 Cities & Knights board-piece tests — mirrors
// `robber/testI18n.ts`'s rationale exactly (own copy because that file only loads the `robber`
// namespace and lives outside this task's file allowlist): inits the default i18next singleton
// with just the `citiesKnights` namespace's real copy so `renderToStaticMarkup` renders actual
// strings instead of raw keys, without pulling in `src/i18n/index.ts` (that module wires
// `i18next-browser-languagedetector`, which touches `window`/`navigator` at import time — fatal
// under vitest's `node` environment).
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCitiesKnights from '../i18n/en/citiesKnights.json';

let initialized: Promise<unknown> | null = null;

export function initTestI18n(): Promise<unknown> {
  initialized ??= i18next.use(initReactI18next).init({
    resources: { en: { citiesKnights: enCitiesKnights } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['citiesKnights'],
    defaultNS: 'citiesKnights',
    interpolation: { escapeValue: false },
  });
  return initialized;
}
