// Shared test-only i18n bootstrap for src/hud/**'s test suite. HUD components call
// `useTranslation` directly (unlike src/ui/**'s primitives, which take pre-translated strings) so
// their tests need a real, initialized i18next instance for `renderToStaticMarkup` to render
// actual copy instead of raw keys. This inits the DEFAULT `i18next` singleton via
// `initReactI18next` — `useTranslation()` falls back to that default instance when no
// `<I18nextProvider>` is present, which is exactly the case under `renderToStaticMarkup` here (no
// provider, matching how `src/ui/primitives.test.ts` renders with no providers at all).
//
// Deliberately NOT the app's real `src/i18n/index.ts`: that module wires
// `i18next-browser-languagedetector`, which touches `window`/`navigator` at import time and is
// fatal under vitest's `node` environment (see `src/i18n/parity.test.ts`'s note on the same issue).
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCitiesKnights from '../i18n/en/citiesKnights.json';
import enGame from '../i18n/en/game.json';
import enLog from '../i18n/en/log.json';
import enThemes from '../i18n/en/themes.json';
import enTradersBarbarians from '../i18n/en/tradersBarbarians.json';

let initialized: Promise<unknown> | null = null;

export function initTestI18n(): Promise<unknown> {
  initialized ??= i18next.use(initReactI18next).init({
    resources: {
      en: {
        game: enGame,
        log: enLog,
        themes: enThemes,
        citiesKnights: enCitiesKnights,
        tradersBarbarians: enTradersBarbarians,
      },
    },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['game', 'log', 'themes', 'citiesKnights', 'tradersBarbarians'],
    defaultNS: 'game',
    interpolation: { escapeValue: false },
  });
  return initialized;
}
