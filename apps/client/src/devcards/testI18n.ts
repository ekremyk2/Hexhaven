// Test-only i18n bootstrap for src/devcards/**'s test suite — mirrors `trade/testI18n.ts`'s
// rationale exactly: components here call `useTranslation` directly, so `renderToStaticMarkup`
// needs a real initialized i18next instance to render actual copy instead of raw keys, and this
// deliberately is NOT `src/i18n/index.ts` (that wires `i18next-browser-languagedetector`, which
// touches `window`/`navigator` at import time — fatal under vitest's `node` environment).
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enDevcards from '../i18n/en/devcards.json';
import enGame from '../i18n/en/game.json';

let initialized: Promise<unknown> | null = null;

export function initDevcardsTestI18n(): Promise<unknown> {
  initialized ??= i18next.use(initReactI18next).init({
    resources: { en: { devcards: enDevcards, game: enGame } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['devcards', 'game'],
    defaultNS: 'devcards',
    interpolation: { escapeValue: false },
  });
  return initialized;
}
