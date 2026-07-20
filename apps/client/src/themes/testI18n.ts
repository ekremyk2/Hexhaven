// Test-only i18n bootstrap for the T-907 theme tests — mirrors `board/testI18n.ts`'s rationale
// exactly (its own copy, scoped to just the `themes` namespace): inits the default i18next
// singleton with the `themes` namespace's real English copy so `renderToStaticMarkup` renders
// actual strings instead of raw keys, without pulling in `src/i18n/index.ts` (that module wires
// `i18next-browser-languagedetector`, which touches `window`/`navigator` at import time — fatal
// under vitest's `node` environment, see vitest.config.ts).
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enThemes from '../i18n/en/themes.json';

let initialized: Promise<unknown> | null = null;

export function initTestI18n(): Promise<unknown> {
  initialized ??= i18next.use(initReactI18next).init({
    resources: { en: { themes: enThemes } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['themes'],
    defaultNS: 'themes',
    interpolation: { escapeValue: false },
  });
  return initialized;
}
