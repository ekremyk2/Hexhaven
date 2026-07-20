// Test-only i18n bootstrap for src/trade/**'s test suite — mirrors `hud/testI18n.ts`'s rationale
// (not this session's file to edit; own allowlist is `src/trade/**`) exactly: components here call
// `useTranslation` directly, so `renderToStaticMarkup` needs a real initialized i18next instance to
// render actual copy instead of raw keys, and it deliberately is NOT `src/i18n/index.ts` (that wires
// `i18next-browser-languagedetector`, which touches `window`/`navigator` at import time — fatal
// under vitest's `node` environment).
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enTrade from '../i18n/en/trade.json';
import enGame from '../i18n/en/game.json';
import enLog from '../i18n/en/log.json';

let initialized: Promise<unknown> | null = null;

export function initTradeTestI18n(): Promise<unknown> {
  initialized ??= i18next.use(initReactI18next).init({
    resources: { en: { trade: enTrade, game: enGame, log: enLog } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['trade', 'game', 'log'],
    defaultNS: 'trade',
    interpolation: { escapeValue: false },
  });
  return initialized;
}
