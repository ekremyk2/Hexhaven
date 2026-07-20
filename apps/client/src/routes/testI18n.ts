// Test-only i18n bootstrap for `routes/Game.tsx`'s render test (T-1160). `Game` mounts nearly every
// HUD/panel in the tree (Scoreboard, Hand, ActionBar, TradePanel, T&B/C&K/E&P HUDs+panels), each
// pulling its own namespace via `useTranslation` — so, unlike the narrower `trade/testI18n.ts`/
// `tradersBarbarians/*.render.test.ts` helpers, this one registers every namespace `src/i18n/index.ts`
// ships (en only; this suite never exercises language switching). Deliberately NOT importing
// `src/i18n/index.ts` itself: that module wires `i18next-browser-languagedetector`, which touches
// `window`/`navigator` at import time — fatal under vitest's `node` environment (same rationale
// every other `testI18n.ts` in this tree documents).
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCardMods from '../i18n/en/cardMods.json';
import enCitiesKnights from '../i18n/en/citiesKnights.json';
import enCommon from '../i18n/en/common.json';
import enDevcards from '../i18n/en/devcards.json';
import enEndgame from '../i18n/en/endgame.json';
import enErrors from '../i18n/en/errors.json';
import enExplorersPirates from '../i18n/en/explorersPirates.json';
import enGame from '../i18n/en/game.json';
import enHelpers from '../i18n/en/helpers.json';
import enLobby from '../i18n/en/lobby.json';
import enLog from '../i18n/en/log.json';
import enRobber from '../i18n/en/robber.json';
import enThemes from '../i18n/en/themes.json';
import enTrade from '../i18n/en/trade.json';
import enTradersBarbarians from '../i18n/en/tradersBarbarians.json';

let initialized: Promise<unknown> | null = null;

export function initGameTestI18n(): Promise<unknown> {
  initialized ??= i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: [
      'common',
      'lobby',
      'game',
      'trade',
      'robber',
      'devcards',
      'endgame',
      'log',
      'errors',
      'citiesKnights',
      'themes',
      'cardMods',
      'helpers',
      'tradersBarbarians',
      'explorersPirates',
    ],
    defaultNS: 'game',
    resources: {
      en: {
        common: enCommon,
        lobby: enLobby,
        game: enGame,
        trade: enTrade,
        robber: enRobber,
        devcards: enDevcards,
        endgame: enEndgame,
        log: enLog,
        errors: enErrors,
        citiesKnights: enCitiesKnights,
        themes: enThemes,
        cardMods: enCardMods,
        helpers: enHelpers,
        tradersBarbarians: enTradersBarbarians,
        explorersPirates: enExplorersPirates,
      },
    },
    interpolation: { escapeValue: false },
  });
  return initialized;
}
