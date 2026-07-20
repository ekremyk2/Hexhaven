// Test-only i18n bootstrap for src/endscreen/**'s suite — mirrors robber/testI18n.ts's rationale
// exactly (own copy because `src/i18n/index.ts` wires `i18next-browser-languagedetector`, which
// touches `window`/`navigator` at import time, fatal under vitest's `node` environment): inits the
// default i18next singleton with just the `endgame`/`game` namespaces' real copy so
// `renderToStaticMarkup` renders actual strings instead of raw keys.
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enEndgame from '../i18n/en/endgame.json';
import enGame from '../i18n/en/game.json';

let initialized: Promise<unknown> | null = null;

export function initTestI18n(): Promise<unknown> {
  initialized ??= i18next.use(initReactI18next).init({
    resources: { en: { endgame: enEndgame, game: enGame } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['endgame', 'game'],
    defaultNS: 'endgame',
    interpolation: { escapeValue: false },
  });
  return initialized;
}
