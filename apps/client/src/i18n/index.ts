// i18next init (T-306 §1). Resources are bundled statically at build time via plain JSON
// imports — there is NO http backend, because the primary deployment target is a private/offline
// LAN server (docs/02 §9) and the client must work without reaching anywhere else.
//
// Language is picked up from localStorage first, then the browser's `navigator.language`, and
// every explicit switch (via <LanguageSwitcher/>) is written back to localStorage under
// `hexhaven.lang` by the detector plugin itself — no manual persistence code needed here.
//
// NOTE for test authors: this module touches `window`/`navigator` (via the language detector) the
// moment it's imported, so it only ever runs in the browser bundle. Tests that need the resource
// JSON (parity guard, plural/interpolation checks) import the `en`/`tr` files directly instead of
// importing this module — see `src/i18n/parity.test.ts` and `src/i18n/i18n.test.ts`.
import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import enCardMods from './en/cardMods.json';
import enCitiesKnights from './en/citiesKnights.json';
import enCommon from './en/common.json';
import enDevcards from './en/devcards.json';
import enEndgame from './en/endgame.json';
import enErrors from './en/errors.json';
import enExplorersPirates from './en/explorersPirates.json';
import enGame from './en/game.json';
import enHelpers from './en/helpers.json';
import enLobby from './en/lobby.json';
import enLog from './en/log.json';
import enRobber from './en/robber.json';
import enThemes from './en/themes.json';
import enTrade from './en/trade.json';
import enTradersBarbarians from './en/tradersBarbarians.json';
import trCardMods from './tr/cardMods.json';
import trCitiesKnights from './tr/citiesKnights.json';
import trCommon from './tr/common.json';
import trDevcards from './tr/devcards.json';
import trEndgame from './tr/endgame.json';
import trErrors from './tr/errors.json';
import trExplorersPirates from './tr/explorersPirates.json';
import trGame from './tr/game.json';
import trHelpers from './tr/helpers.json';
import trLobby from './tr/lobby.json';
import trLog from './tr/log.json';
import trRobber from './tr/robber.json';
import trThemes from './tr/themes.json';
import trTrade from './tr/trade.json';
import trTradersBarbarians from './tr/tradersBarbarians.json';

/** UI areas map 1:1 to resource files (T-306 §2) — keep in sync with `src/i18n/{en,tr}/*.json`.
 * `trade`/`robber`/`devcards`/`endgame` are dedicated namespaces so the parallel UI tasks
 * (T-404/T-405/T-406/T-408) each own a separate file (no shared game.json contention). `themes`
 * (T-907, cosmetic themes) is registered the same way — a display-only setting, not a `ModifierId`. */
// `cardMods`/`helpers` (Phase-9 play-UI follow-up): dedicated namespaces for the two modifiers'
// in-game play surfaces, same one-namespace-per-UI-area discipline as `devcards`/`citiesKnights`.
export const NAMESPACES = ['common', 'lobby', 'game', 'trade', 'robber', 'devcards', 'endgame', 'log', 'errors', 'citiesKnights', 'themes', 'cardMods', 'helpers', 'tradersBarbarians', 'explorersPirates'] as const;
export type Namespace = (typeof NAMESPACES)[number];

/** Languages this build ships. The key-parity guard (`parity.test.ts`) enforces that every
 * namespace defines the same non-empty keys across all of these. */
export const SUPPORTED_LANGUAGES = ['en', 'tr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** localStorage key the language detector persists the user's choice under (T-306 §1). */
export const LANGUAGE_STORAGE_KEY = 'hexhaven.lang';

const resources = {
  en: { common: enCommon, lobby: enLobby, game: enGame, trade: enTrade, robber: enRobber, devcards: enDevcards, endgame: enEndgame, log: enLog, errors: enErrors, citiesKnights: enCitiesKnights, themes: enThemes, cardMods: enCardMods, helpers: enHelpers, tradersBarbarians: enTradersBarbarians, explorersPirates: enExplorersPirates },
  tr: { common: trCommon, lobby: trLobby, game: trGame, trade: trTrade, robber: trRobber, devcards: trDevcards, endgame: trEndgame, log: trLog, errors: trErrors, citiesKnights: trCitiesKnights, themes: trThemes, cardMods: trCardMods, helpers: trHelpers, tradersBarbarians: trTradersBarbarians, explorersPirates: trExplorersPirates },
} satisfies Record<SupportedLanguage, Record<Namespace, unknown>>;

void i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    ns: NAMESPACES,
    defaultNS: 'common',
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    load: 'languageOnly', // "tr-TR"/"en-US" from navigator.language still resolve to "tr"/"en"
    interpolation: { escapeValue: false }, // React already escapes; avoid double-escaping
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    },
  });

export default i18next;
