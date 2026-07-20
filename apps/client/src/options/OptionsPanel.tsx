// Game-options panel (T-401 requirement 2, docs/10 §1, D-025/D-026): player count, expansion
// toggles and the turn-timers toggle that feed `lobby.create`'s `config: RoomConfig`. Unshipped
// expansions render visible-but-disabled with a "coming soon" badge — flipping one entry in
// `SHIPPED_EXPANSIONS` is the only change a later wave (W1/W2/W3) needs here.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomConstantsConfig, GameConfig, HexPieceKindId, ModifierId, ResourceType, RoomConfig } from '@hexhaven/shared';
import {
  boardModeForExpansions,
  boardPresetsForMode,
  COSTS,
  getBoardPreset,
  isFiveSixOnlyScenario,
  LIMITLESS_CAP,
  TARGET_VP,
} from '@hexhaven/shared';
import { EP_SCENARIO_SUPPORTS_56, isConfigWinnable, TB_SCENARIO_SUPPORTS_56 } from '@hexhaven/engine';
import type { EPScenarioId, TBScenarioId, WinnabilityCheck } from '@hexhaven/engine';
import { Badge, Button, Panel, SegmentedControl } from '../ui';
import { BoardPresetPicker } from './BoardPresetPicker';
import { ModifiersDialog } from './ModifiersDialog';

/** Single source of truth for "is this expansion shipped yet" (D-026). All false until W1/W2/W3
 * land — flip one line per wave, nothing else in this file (or the server's mirrored
 * `expansionUnavailable` check in apps/server/src/lobby.ts) needs to change. */
export const SHIPPED_EXPANSIONS = {
  fiveSix: true, // W1 shipped (T-601/T-602/T-603) — the 5–6 toggle is now active.
  seafarers: true, // W2 shipped (T-702/T-703/T-704/T-705) — "Heading for New Shores" is playable.
  citiesKnights: true, // W3 shipped (T-802..T-806); also combinable with Seafarers (the official combined game).
  tradersBarbarians: true, // Phase 10 (T-1002…T-1006) — all five T&B scenarios are now playable.
  explorersPirates: true, // Phase 11 (T-1108); T-1161 widened the picker — all five E&P scenarios are now playable.
} as const satisfies Record<ExpansionKey, boolean>;

/** Every T&B scenario id, rulebook order (docs/rules/traders-barbarians-rules.md TB1.1) — mirrors
 *  the engine's own `TB_SCENARIO_IDS` (packages/engine/src/modules/tradersBarbarians/index.ts) as a
 *  small local literal so this file doesn't need an `@hexhaven/engine` import just for a 5-id list (the
 *  engine module is still the authority — `SHIPPED_TB_SCENARIOS`/`isTBScenarioId` there is what the
 *  server/engine actually gate on; this list only drives the picker's display order). */
export const TB_SCENARIOS = [
  'fishermen',
  'rivers',
  'caravans',
  'barbarianAttack',
  'tradersBarbarians',
] as const;
export type TBScenario = (typeof TB_SCENARIOS)[number];

/** The default T&B scenario a fresh `tradersBarbarians` config selects — mirrors
 *  `DEFAULT_SEAFARERS_SCENARIO` above (first in rulebook order). */
export const DEFAULT_TB_SCENARIO: TBScenario = 'fishermen';

/** Whether a T&B scenario id supports the 5–6 player extension (Phase 10B, T-1050) — defers to the
 *  engine's own `TB_SCENARIO_SUPPORTS_56` (the authority the server/engine actually gate on) rather
 *  than duplicating the flag list here; an unknown id (never reached via the picker, which only ever
 *  offers `TB_SCENARIOS`) is treated as NOT 5–6-capable, matching `isFiveSixOnlyScenario`'s "unknown
 *  ids gate closed" convention. */
function tbScenarioSupports56(scenario: string): boolean {
  return (TB_SCENARIOS as readonly string[]).includes(scenario)
    ? TB_SCENARIO_SUPPORTS_56[scenario as TBScenarioId]
    : false;
}

/** The T&B scenario currently selected, or the default when T&B is off/unset. */
export function selectedTBScenario(config: RoomConfig): string {
  return config.expansions.tradersBarbarians ? config.expansions.tradersBarbarians.scenario : DEFAULT_TB_SCENARIO;
}

/** Returns `config` with the T&B scenario set. Only meaningful while `tradersBarbarians` is on —
 *  the picker for it is only rendered in that state (mirrors `withScenario` above).
 *
 * T-1050 (Phase 10B): unlike Seafarers' 5-6-ONLY scenarios (which BUMP the count up), no T&B
 * scenario is 5–6-only — some (today: `fishermen`) merely ALSO support it. So switching to a
 * scenario that does NOT support 5–6 while fiveSix is currently on must fall back to the base board
 * (fiveSix off, player count clamped to 4) — the opposite direction of `withScenario`'s bump, same
 * fix-up discipline as `withExpansionToggled`'s player-count clamp below. */
export function withTBScenario(config: RoomConfig, scenario: string): RoomConfig {
  const next: RoomConfig = { ...config, expansions: { ...config.expansions, tradersBarbarians: { scenario } } };
  if (tbScenarioSupports56(scenario) || !next.expansions.fiveSix) return next;
  const playerCount = next.playerCount > 4 ? 4 : next.playerCount;
  return { ...next, playerCount, expansions: { ...next.expansions, fiveSix: false } };
}

/** Every SHIPPED Explorers & Pirates scenario id, in rulebook/build order (intro → full campaign) —
 *  mirrors `TB_SCENARIOS` above. All five now ship (T-1161, Phase 11B): the engine's own
 *  `SHIPPED_EP_SCENARIOS` (packages/engine/src/modules/explorersPirates/state.ts) is still the
 *  authority (the server rejects anything not in it with `EXPANSION_NOT_AVAILABLE`), this list only
 *  drives the picker's display order — it is NOT a second copy of that gate. `landHo` stays first
 *  (the `DEFAULT_EP_SCENARIO` a fresh config selects). */
export const EP_SCENARIOS = ['landHo', 'fishForHexhaven', 'spicesForHexhaven', 'pirateLairs', 'fullCampaign'] as const;
export type EPScenario = (typeof EP_SCENARIOS)[number];

/** The default E&P scenario a fresh `explorersPirates` config selects — the intro scenario, first in
 *  build order (mirrors `DEFAULT_TB_SCENARIO`). */
export const DEFAULT_EP_SCENARIO: EPScenario = 'landHo';

/** Whether an E&P scenario id supports the 5–6 player extension (Phase 11B, T-1150) — defers to the
 *  engine's own `EP_SCENARIO_SUPPORTS_56` (the authority the server/engine actually gate on), mirrors
 *  `tbScenarioSupports56` exactly. An unknown id (never reached via the picker, which only ever offers
 *  `EP_SCENARIOS`) is treated as NOT 5–6-capable. */
function epScenarioSupports56(scenario: string): boolean {
  return (EP_SCENARIOS as readonly string[]).includes(scenario)
    ? EP_SCENARIO_SUPPORTS_56[scenario as EPScenarioId]
    : false;
}

/** The E&P scenario currently selected, or the default when E&P is off/unset. */
export function selectedEPScenario(config: RoomConfig): string {
  return config.expansions.explorersPirates ? config.expansions.explorersPirates.scenario : DEFAULT_EP_SCENARIO;
}

/** Returns `config` with the E&P scenario set. Only meaningful while `explorersPirates` is on —
 *  the picker for it is only rendered in that state (mirrors `withTBScenario` above).
 *
 * T-1150 (Phase 11B): mirrors `withTBScenario`'s own fix-up — switching to a scenario that does NOT
 * support 5–6 while `fiveSix` is currently on falls back to the base board (fiveSix off, player count
 * clamped to 4). All five scenarios the picker now offers (T-1161) support 5–6
 * (`EP_SCENARIO_SUPPORTS_56`), so the clamp branch never actually fires today — kept as the general
 * hook a future 3–4-only E&P scenario would get for free. */
export function withEPScenario(config: RoomConfig, scenario: string): RoomConfig {
  const next: RoomConfig = { ...config, expansions: { ...config.expansions, explorersPirates: { scenario } } };
  if (epScenarioSupports56(scenario) || !next.expansions.fiveSix) return next;
  const playerCount = next.playerCount > 4 ? 4 : next.playerCount;
  return { ...next, playerCount, expansions: { ...next.expansions, fiveSix: false } };
}

/** The default Seafarers scenario a fresh seafarers config selects — the one shipped scenario today
 * ("Heading for New Shores", S10). Kept as a named constant so the toggle and the scenario picker
 * agree on the initial id. */
export const DEFAULT_SEAFARERS_SCENARIO = 'headingForNewShores';

/** The 5–6 extra-building turn rule (X12, T-602). Product default is **Paired Players**; the 2015
 * Special Building Phase is temporarily DISABLED in the picker (user 2026-07-14: too slow/clicky at
 * 6 players). The SBP engine code is kept intact so it can be re-enabled by flipping
 * `SBP_ENABLED` back to true. NOTE: the ENGINE default (`fiveSixTurnRule(config)`) is still `sbp`,
 * so the client MUST always write the rule into the config when fiveSix is on — see
 * `withExpansionToggled` (it sets `pairedPlayers` on toggle-on). */
export type FiveSixTurnRule = NonNullable<NonNullable<RoomConfig['variants']>['fiveSixTurnRule']>;
export const FIVE_SIX_TURN_RULES: readonly FiveSixTurnRule[] = ['sbp', 'pairedPlayers'];
export const SBP_ENABLED = false; // flip true to re-offer the Special Building Phase in the picker
export const DEFAULT_FIVE_SIX_TURN_RULE: FiveSixTurnRule = 'pairedPlayers';

/** The currently-selected 5–6 turn rule, defaulting to Paired Players when unset. */
export function selectedTurnRule(config: RoomConfig): FiveSixTurnRule {
  return config.variants?.fiveSixTurnRule ?? DEFAULT_FIVE_SIX_TURN_RULE;
}

/** Returns `config` with the 5–6 turn rule set (recorded under `config.variants.fiveSixTurnRule`,
 * exactly the shape the create-room payload/engine expect). */
export function withTurnRule(config: RoomConfig, rule: FiveSixTurnRule): RoomConfig {
  return { ...config, variants: { ...config.variants, fiveSixTurnRule: rule } };
}

export const DEFAULT_ROOM_TIMERS: RoomConfig['timers'] = {
  timers: false,
  turnSeconds: 120,
  decisionSeconds: 45,
};

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  playerCount: 4,
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
  board: 'random',
  timers: DEFAULT_ROOM_TIMERS,
};

/** Board-setup method (T-606). `'random'` shuffles per R2; `'beginner'` is the fixed base-19 board.
 * Only two shapes are official (base 19 / 5–6 30-hex) and only the base has a verified fixed layout,
 * so Beginner is offered ONLY when fiveSix is off. */
export type BoardChoice = NonNullable<RoomConfig['board']>;
export const BOARD_CHOICES: readonly BoardChoice[] = ['random', 'beginner'];
export const DEFAULT_BOARD: BoardChoice = 'random';

/** The selected board method, defaulting to Random when unset (back-compat with older configs). */
export function selectedBoard(config: RoomConfig): BoardChoice {
  return config.board ?? DEFAULT_BOARD;
}

/** Whether the fixed Beginner board can be chosen for this config: base-19 only (fiveSix off). */
export function beginnerAvailable(config: RoomConfig): boolean {
  return !config.expansions.fiveSix;
}

/** Returns `config` with the board method set. */
export function withBoard(config: RoomConfig, board: BoardChoice): RoomConfig {
  return { ...config, board };
}

/** The Seafarers scenario currently selected, or the default when seafarers is off/unset. */
export function selectedScenario(config: RoomConfig): string {
  return config.expansions.seafarers === false
    ? DEFAULT_SEAFARERS_SCENARIO
    : config.expansions.seafarers.scenario;
}

/** Returns `config` with the Seafarers scenario set (T-705 scenario picker). Only meaningful while
 * seafarers is on; the picker for the `seafarers` board mode drives this instead of `config.board`.
 *
 * T-752 (multi-scenario picker framework): picking a 5-6-ONLY scenario (`isFiveSixOnlyScenario`,
 * e.g. "New World") must land the config in a state the engine actually accepts — `fiveSix: true`
 * AND `playerCount` in {5, 6} — so it bumps a 3/4 selection up to 5 (never down; a host already at
 * 5 or 6 keeps their count). Picking a scenario that supports 3/4 too (e.g. "Heading for New
 * Shores") leaves `playerCount`/`fiveSix` exactly as they were — this is the general hook every
 * future 5-6-only scenario (T-753+) gets for free just by shipping `players: [5, 6]` in its
 * `BoardPreset`. */
export function withScenario(config: RoomConfig, scenario: string): RoomConfig {
  const next: RoomConfig = { ...config, expansions: { ...config.expansions, seafarers: { scenario } } };
  if (!isFiveSixOnlyScenario(scenario)) return next;
  const playerCount = next.playerCount === 5 || next.playerCount === 6 ? next.playerCount : 5;
  return { ...next, playerCount, expansions: { ...next.expansions, fiveSix: true } };
}

// --- Game-mode model (the GameModeDialog "PUBG menu", user request) -----------------------------
// The picker chooses ONE "board world" (base / Seafarers / Traders & Barbarians / Explorers &
// Pirates) — these are mutually exclusive. Cities & Knights is NOT a board world: it's a
// combinable ADD-ON (the official C&K + Seafarers game, C&K on the base board, C&K + 5–6), offered
// as a toggle when the chosen world supports it. All transitions reuse `withExpansionToggled` so the
// exact same combination guard the engine/server enforce drives the UI — this is presentation only.

/** The four mutually-exclusive board worlds the mode grid offers (C&K is an add-on, not here). */
export type GameMode = 'base' | 'seafarers' | 'tradersBarbarians' | 'explorersPirates';
export const GAME_MODES: readonly GameMode[] = ['base', 'seafarers', 'tradersBarbarians', 'explorersPirates'];

/** The board world the current config is in (C&K is orthogonal — read via `isCkAddonOn`). */
export function selectedGameMode(config: RoomConfig): GameMode {
  const e = config.expansions;
  if (e.tradersBarbarians) return 'tradersBarbarians';
  if (e.explorersPirates) return 'explorersPirates';
  if (e.seafarers !== false) return 'seafarers';
  return 'base';
}

/** Whether a mode is shipped/selectable (mirrors `SHIPPED_EXPANSIONS`; base always ships). */
export function isGameModeShipped(mode: GameMode): boolean {
  return mode === 'base' ? true : SHIPPED_EXPANSIONS[mode];
}

/** Switch board world. Seafarers/T&B/E&P go through `withExpansionToggled` (which clears the
 *  incompatible expansions per the engine guard); 'base' clears the three board-world expansions but
 *  keeps a C&K add-on + the 5–6 toggle (both base-compatible). */
export function withGameMode(config: RoomConfig, mode: GameMode): RoomConfig {
  if (mode === 'seafarers') return withExpansionToggled(config, 'seafarers', true);
  if (mode === 'tradersBarbarians') return withExpansionToggled(config, 'tradersBarbarians', true);
  if (mode === 'explorersPirates') return withExpansionToggled(config, 'explorersPirates', true);
  let next = config;
  if (next.expansions.seafarers !== false) next = withExpansionToggled(next, 'seafarers', false);
  if (next.expansions.tradersBarbarians) next = withExpansionToggled(next, 'tradersBarbarians', false);
  if (next.expansions.explorersPirates) next = withExpansionToggled(next, 'explorersPirates', false);
  return next;
}

/** Cities & Knights is offerable as an add-on only on the base board or Seafarers (T&B/E&P are
 *  standalone). Mirrors what `withExpansionToggled` would allow. */
export function isCkAddonAvailable(config: RoomConfig): boolean {
  if (!SHIPPED_EXPANSIONS.citiesKnights) return false;
  const mode = selectedGameMode(config);
  return mode === 'base' || mode === 'seafarers';
}

/** Whether the C&K add-on is currently on. */
export function isCkAddonOn(config: RoomConfig): boolean {
  return config.expansions.citiesKnights;
}

/** Toggle the C&K add-on (reuses the tested guard). */
export function withCkAddon(config: RoomConfig, on: boolean): RoomConfig {
  return withExpansionToggled(config, 'citiesKnights', on);
}

/** i18n keys describing the current game-mode selection, for the Home "game mode" field. `nameKey`
 *  is the board world; `detailKey` is the selected scenario/board (undefined for none). */
export function gameModeSummary(config: RoomConfig): { nameKey: string; detailKey?: string } {
  const mode = selectedGameMode(config);
  if (mode === 'seafarers') {
    return {
      nameKey: 'lobby:options.expansions.seafarers.name',
      detailKey: getBoardPreset('seafarers', selectedScenario(config))?.labelKey,
    };
  }
  if (mode === 'tradersBarbarians') {
    return {
      nameKey: 'lobby:options.expansions.tradersBarbarians.name',
      detailKey: `lobby:options.tbScenario.${selectedTBScenario(config)}.name`,
    };
  }
  if (mode === 'explorersPirates') {
    return {
      nameKey: 'lobby:options.expansions.explorersPirates.name',
      detailKey: `lobby:options.epScenario.${selectedEPScenario(config)}.name`,
    };
  }
  return { nameKey: 'lobby:options.gameMode.base.name', detailKey: `lobby:options.board.${selectedBoard(config)}.name` };
}

/** How many modifiers (house rules) are currently on — drives the Home "Modifiers · N" button. */
export function countEnabledModifiers(config: RoomConfig): number {
  return MODIFIER_KEYS.filter((key) => isModifierOn(config, key)).length;
}

export type ExpansionKey = 'fiveSix' | 'seafarers' | 'citiesKnights' | 'tradersBarbarians' | 'explorersPirates';
const EXPANSION_KEYS: ExpansionKey[] = [
  'fiveSix',
  'seafarers',
  'citiesKnights',
  'tradersBarbarians',
  'explorersPirates',
];

export function isExpansionOn(config: RoomConfig, key: ExpansionKey): boolean {
  if (key === 'seafarers') return config.expansions.seafarers !== false;
  if (key === 'tradersBarbarians') return !!config.expansions.tradersBarbarians;
  if (key === 'explorersPirates') return !!config.expansions.explorersPirates;
  return config.expansions[key];
}

/** Returns `config` with `key` flipped on/off, keeping the selection internally consistent with the
 * engine's expansion-combination guard. Cities & Knights combines with EITHER Seafarers (3–4p, the
 * official combined game) OR the 5–6 extension (5–6p, on the base 5–6 board — the C&K 5–6 extension
 * reuses it). Seafarers + the 5–6 extension used to be flatly forbidden (no 5–6 Seafarers boards
 * shipped) — T-751 ships 5/6-player boards for "Heading for New Shores", so that combo is now allowed
 * SPECIFICALLY at 5/6 players (mirrors the engine/server gate: `resolveModules`/`expansionUnavailable`
 * accept fiveSix+seafarers iff the selected scenario has a `boards[playerCount]` entry AND playerCount
 * is 5 or 6). Turning Seafarers on at 3/4 players still clears fiveSix (the base 3/4 box never uses
 * the 5–6 extension); turning fiveSix on always clears a 3/4-player seafarers selection (the reverse
 * transition never starts from 5/6 players — see the player-count invariant below). Traders &
 * Barbarians (docs/rules/traders-barbarians-rules.md TB8.1) is standalone from Seafarers/C&K/E&P —
 * turning it on always clears those, and turning any of THOSE on always clears `tradersBarbarians` —
 * but T-1050 (Phase 10B) allows it to ALSO combine with the 5–6 extension when the selected scenario
 * declares support (`TB_SCENARIO_SUPPORTS_56`; as of T-1054, all five shipped scenarios do); no T&B
 * scenario is 5–6-ONLY, so
 * (unlike Seafarers' "New World") a 3/4-player pick is always valid too. Explorers & Pirates
 * (docs/rules/explorers-pirates-rules.md EP1.2) is standalone from Seafarers/C&K/T&B — same discipline
 * exactly, mirrored in both directions with `tradersBarbarians` (turning one on clears the other, and
 * clears fiveSix/seafarers/citiesKnights too) — but T-1150 (Phase 11B) allows it ALSO to combine with
 * the 5–6 extension when the selected scenario declares support (`EP_SCENARIO_SUPPORTS_56`; today only
 * `landHo`, the sole scenario the picker offers). Player count is then clamped: 5/6 require the 5–6
 * extension; Explorers & Pirates is 3–4p OR 5–6p when its scenario supports it (T-1150), mirrors
 * Traders & Barbarians' own 3–4p-OR-5–6p-when-supported clamp (T-1050); Seafarers is 3–4p OR 5–6p
 * (T-751) — neither is clamped down here
 * while fiveSix is on (see `withPlayerCount` for the reverse — setting the player count directly). */
export function withExpansionToggled(config: RoomConfig, key: ExpansionKey, on: boolean): RoomConfig {
  const expansions = { ...config.expansions };
  if (key === 'seafarers') {
    expansions.seafarers = on ? { scenario: DEFAULT_SEAFARERS_SCENARIO } : false;
    // Seafarers + C&K is fine; Seafarers + T&B / Seafarers + E&P are not — clear those always.
    // Seafarers + the 5–6 extension (T-751) is now allowed, but ONLY at 5/6 players (the boards that
    // ship it) — only clear fiveSix here if the current player count couldn't use it (3/4p Seafarers
    // always plays the base 3/4 box). `config.playerCount` is read (not the still-being-built
    // `next`/`playerCount` below) because this decides what to do BEFORE the clamp further down.
    if (on) {
      if (config.playerCount !== 5 && config.playerCount !== 6) {
        expansions.fiveSix = false;
      }
      expansions.tradersBarbarians = false;
      expansions.explorersPirates = false;
    }
  } else if (key === 'citiesKnights') {
    // C&K pairs with either Seafarers or the 5–6 extension — nothing to clear, except T&B/E&P
    // (standalone only, TB8.1/EP1.2).
    expansions.citiesKnights = on;
    if (on) {
      expansions.tradersBarbarians = false;
      expansions.explorersPirates = false;
    }
  } else if (key === 'tradersBarbarians') {
    expansions.tradersBarbarians = on ? { scenario: DEFAULT_TB_SCENARIO } : false;
    // T&B is standalone only (TB8.1) — turning it on clears Seafarers/C&K/E&P always. fiveSix (T-1050,
    // Phase 10B) is only cleared here if the default scenario (fishermen) can't ride it OR the current
    // player count isn't already 5/6 (mirrors the Seafarers branch above's "only clear fiveSix if the
    // count couldn't use it" discipline) — so switching from a 5/6-player Seafarers/C&K game straight
    // into T&B's (5–6-capable) fishermen keeps the 5–6 board instead of always dropping to base.
    if (on) {
      if (!tbScenarioSupports56(DEFAULT_TB_SCENARIO) || (config.playerCount !== 5 && config.playerCount !== 6)) {
        expansions.fiveSix = false;
      }
      expansions.seafarers = false;
      expansions.citiesKnights = false;
      expansions.explorersPirates = false;
    }
  } else if (key === 'explorersPirates') {
    expansions.explorersPirates = on ? { scenario: DEFAULT_EP_SCENARIO } : false;
    // E&P is standalone only (EP1.2) — turning it on clears Seafarers/C&K/T&B always, mirroring T&B.
    // fiveSix (T-1150, Phase 11B) is only cleared here if the default scenario (landHo) can't ride it
    // OR the current player count isn't already 5/6 (mirrors the T&B branch above's "only clear
    // fiveSix if the count couldn't use it" discipline).
    if (on) {
      if (!epScenarioSupports56(DEFAULT_EP_SCENARIO) || (config.playerCount !== 5 && config.playerCount !== 6)) {
        expansions.fiveSix = false;
      }
      expansions.seafarers = false;
      expansions.citiesKnights = false;
      expansions.tradersBarbarians = false;
    }
  } else {
    expansions[key] = on;
    // The 5–6 extension + C&K is fine (base 5–6 board); 5–6 + T&B (T-1050, Phase 10B) is fine too, but
    // ONLY for a scenario that supports it (TB_SCENARIO_SUPPORTS_56) — clear T&B here otherwise. 5–6 +
    // E&P (T-1150, Phase 11B) is fine too, same discipline, keyed on EP_SCENARIO_SUPPORTS_56 instead.
    // 5–6 + Seafarers is also fine as of T-751, but this branch only ever fires with fiveSix OFF
    // (turning it ON), which per the player-count invariant below means playerCount is already <=4 —
    // a 3/4-player seafarers selection can't ride the 5–6 extension, so it's still cleared here.
    if (key === 'fiveSix' && on) {
      expansions.seafarers = false;
      if (!expansions.tradersBarbarians || !tbScenarioSupports56(expansions.tradersBarbarians.scenario)) {
        expansions.tradersBarbarians = false;
      }
      if (!expansions.explorersPirates || !epScenarioSupports56(expansions.explorersPirates.scenario)) {
        expansions.explorersPirates = false;
      }
    }
  }
  // Player-count consistency: 5/6 require the 5–6 extension. T&B is 3–4p only UNLESS its selected
  // scenario supports 5–6 (T-1050, Phase 10B — TB_SCENARIO_SUPPORTS_56); E&P is 3–4p only UNLESS ITS
  // selected scenario supports 5–6 (T-1150, Phase 11B — EP_SCENARIO_SUPPORTS_56), same discipline.
  // Seafarers is 3–4p (fiveSix off) OR 5–6p (fiveSix on, T-751) — NOT clamped down here; the
  // fiveSix-clearing above (in the seafarers/fiveSix branches) already resolves any invalid
  // combination before this point, so a surviving `expansions.fiveSix` is always the correct call.
  let playerCount = config.playerCount;
  if (!expansions.fiveSix && playerCount > 4) playerCount = 4;
  if (
    expansions.tradersBarbarians &&
    playerCount > 4 &&
    !tbScenarioSupports56(expansions.tradersBarbarians.scenario)
  ) {
    playerCount = 4;
  }
  if (
    expansions.explorersPirates &&
    playerCount > 4 &&
    !epScenarioSupports56(expansions.explorersPirates.scenario)
  ) {
    playerCount = 4;
  }
  // T-752: whichever path landed here, fiveSix may now be off while a 5-6-ONLY scenario (e.g. "New
  // World") is still selected — an invalid `fiveSix:false` + <5-6-only scenario> combo the engine
  // rejects (mirrors the same fix-up `withPlayerCount` applies from the player-count-control side).
  // Fall back to the default (all-counts) scenario in that case.
  if (expansions.seafarers !== false && !expansions.fiveSix && isFiveSixOnlyScenario(expansions.seafarers.scenario)) {
    expansions.seafarers = { scenario: DEFAULT_SEAFARERS_SCENARIO };
  }
  const next: RoomConfig = { ...config, expansions, playerCount };
  // T-606: the fixed Beginner board is base-19 only. Turning fiveSix ON drops a beginner selection
  // back to Random (there is no verified 30-hex fixed layout — the engine would reject it).
  if (key === 'fiveSix' && on && next.board === 'beginner') {
    next.board = 'random';
  }
  if (key === 'fiveSix' && on) {
    // Turning fiveSix ON pins the turn rule explicitly. The engine still DEFAULTS an absent rule to
    // SBP (which is disabled in the picker), so we must write the product default (Paired Players)
    // into the config or a create with no interaction would silently use SBP.
    next.variants = { ...next.variants, fiveSixTurnRule: DEFAULT_FIVE_SIX_TURN_RULE };
  }
  // Turning fiveSix off drops the (now-inert) turn-rule selection too, keeping the config clean —
  // the field is only meaningful while fiveSix is on (docs/10 §4, T-602). `variants` currently only
  // carries `fiveSixTurnRule`, so removing it clears the object entirely.
  if (key === 'fiveSix' && !on && next.variants?.fiveSixTurnRule != null) {
    const restVariants = { ...next.variants };
    delete restVariants.fiveSixTurnRule;
    next.variants = Object.keys(restVariants).length > 0 ? restVariants : undefined;
  }
  return next;
}

// ---- Modifiers (T-901, docs/07 D-034) --------------------------------------------------------
// The "Modifiers" multi-select menu: modifiers STACK on top of whichever expansion is selected
// above, so this section renders unconditionally (unlike the turn-rule selector, which only makes
// sense once fiveSix is on). `modifierAvailability` (from `@hexhaven/engine`, the same compatibility
// matrix `resolveModules` enforces server-side) greys out a modifier that conflicts with the
// current expansion/other-modifier selection — the client never re-derives the matrix itself.

/** Single source of truth for "is this modifier built yet" (mirrors `SHIPPED_EXPANSIONS`, D-026). */
export const SHIPPED_MODIFIERS = {
  customTargetVp: true, // T-901 proof modifier #1 (constant override).
  combine2sAnd12s: true, // T-901 proof modifier #2 (production hook).
  eventCards: true, // T-904b: event-card deck replaces the two dice.
  friendlyRobber: true, // T-903a wave A-1 (docs/07 D-034).
  playDevSameTurn: true, // T-906 wave A-1.
  harbormaster: true, // T-906 wave A-1.
  cardMods: true, // T-904: 6 curated new dev cards + 5 combo plays.
  helpers: true, // T-905: "The Helpers of Hexhaven".
  customConstants: true, // T-906: the broad "custom game" tunable-constants modifier.
  hexPieces: true, // T-902: the multi-piece hex framework (ships with its one reference piece, the Wizard).
  shuffleNumbers: true, // Board setup: randomize token positions, preserving counts.
  hiddenSetupNumbers: true, // Board setup: hide numbers until initial placement completes.
} as const satisfies Record<ModifierId, boolean>;

export const MODIFIER_KEYS: ModifierId[] = [
  'customTargetVp',
  'combine2sAnd12s',
  'eventCards',
  'friendlyRobber',
  'playDevSameTurn',
  'harbormaster',
  'cardMods',
  'helpers',
  'customConstants',
  'hexPieces',
  'shuffleNumbers',
  'hiddenSetupNumbers',
];

/** The `hexPieces` config the GENERIC `withModifierToggled` seeds on (T-902): the one reference
 *  kind. T-903's dedicated per-kind picker (`withHexPieceKindToggled` below) is how the panel
 *  actually builds a selection now — this constant only matters if something calls the generic
 *  on/off toggle directly (kept for that path's own test coverage). */
export const DEFAULT_HEX_PIECES_CONFIG = { pieces: ['wizard'] as const };

// ---- Hex pieces per-kind multi-select (T-903, docs/tasks/phase-9/PICKS.md "each piece must be
// usable STANDALONE") ----------------------------------------------------------------------------
// Replaces the T-902 on/off toggle: the host picks ANY subset of the 5 kinds independently. An
// empty selection is equivalent to the whole `hexPieces` modifier being off (mirrors
// `withModifierToggled`'s "off clears the key" RK-13 discipline — the engine's own
// `validateHexPiecesConfig` rejects an enabled-but-empty selection, so the panel never produces one).

/** Every kind currently selected, in `HEX_PIECE_KIND_IDS` order (or empty while the modifier is off). */
export function hexPieceKinds(config: RoomConfig): readonly HexPieceKindId[] {
  return config.modifiers?.hexPieces?.pieces ?? [];
}

export function isHexPieceKindOn(config: RoomConfig, kind: HexPieceKindId): boolean {
  return hexPieceKinds(config).includes(kind);
}

/** Returns `config` with `kind` added to (or removed from) the hexPieces selection. Turning the
 *  LAST enabled kind off drops the whole `hexPieces` modifier entry — an enabled-but-empty
 *  selection is meaningless (same rule `validateHexPiecesConfig` enforces server-side). */
export function withHexPieceKindToggled(config: RoomConfig, kind: HexPieceKindId, on: boolean): RoomConfig {
  const current = hexPieceKinds(config);
  const pieces = on
    ? (current.includes(kind) ? current : [...current, kind])
    : current.filter((k) => k !== kind);
  if (pieces.length === 0) {
    const modifiers = { ...config.modifiers };
    delete modifiers.hexPieces;
    const next = Object.keys(modifiers).length > 0 ? modifiers : undefined;
    return { ...config, modifiers: next };
  }
  return { ...config, modifiers: { ...config.modifiers, hexPieces: { pieces: [...pieces] } } };
}

/** The default `customTargetVp` param the moment the toggle turns on (the host edits it from
 *  there) — distinct from the base 10 so the effect is visibly "on". */
export const DEFAULT_CUSTOM_TARGET_VP = 12;

export function isModifierOn(config: RoomConfig, id: ModifierId): boolean {
  return config.modifiers?.[id] !== undefined;
}

/** Returns `config` with `id` enabled/disabled. Turning a param-less modifier (or `eventCards`) on
 *  writes the literal `true`; turning `customTargetVp` on seeds `DEFAULT_CUSTOM_TARGET_VP` (a
 *  later `withCustomTargetVp` call edits it); turning `customConstants` on seeds the EMPTY object
 *  `{}` — unlike `customTargetVp`'s single scalar, every one of its many fields is independently
 *  optional and "absent means base default" (docs/07 D-034), so an enabled-but-untouched
 *  `customConstants` is a legitimate, harmlessly-inert state (the params panel below edits fields
 *  in from there). Turning any modifier off drops its key entirely — clearing the whole `modifiers`
 *  object once empty, so an all-off selection is byte-identical to an untouched config (RK-13 —
 *  `modifiers: {}` and `modifiers: undefined` resolve identically, packages/engine/src/modules/
 *  modifiers/registry.ts).*/
export function withModifierToggled(config: RoomConfig, id: ModifierId, on: boolean): RoomConfig {
  // A plain `Partial<Record<ModifierId, unknown>>` working copy (rather than `RoomConfig['modifiers']`
  // itself) sidesteps TS's "can't write a union-keyed mapped type through a generic `id`" limitation —
  // the cast back below is safe because every branch only ever writes the value shape `id`'s own
  // `ModifierConfigMap[id]` expects (`DEFAULT_CUSTOM_TARGET_VP`'s number for `customTargetVp`, `{}`
  // for `customConstants`, else `true`).
  const modifiers: Partial<Record<ModifierId, unknown>> = { ...config.modifiers };
  if (on) {
    modifiers[id] =
      id === 'customTargetVp'
        ? DEFAULT_CUSTOM_TARGET_VP
        : id === 'customConstants'
          ? {}
          : id === 'hexPieces'
            ? DEFAULT_HEX_PIECES_CONFIG
            : true;
  } else {
    delete modifiers[id];
  }
  const next = Object.keys(modifiers).length > 0 ? (modifiers as RoomConfig['modifiers']) : undefined;
  return { ...config, modifiers: next };
}

/** The current `customTargetVp` param, defaulting to `DEFAULT_CUSTOM_TARGET_VP` while the
 *  modifier is off (so the number input has something sane to show before the host turns it on). */
export function customTargetVpValue(config: RoomConfig): number {
  return config.modifiers?.customTargetVp ?? DEFAULT_CUSTOM_TARGET_VP;
}

/** Returns `config` with the `customTargetVp` param set — only meaningful while the modifier is
 *  already enabled (the number input that calls this is only rendered in that state). */
export function withCustomTargetVp(config: RoomConfig, targetVp: number): RoomConfig {
  if (!isModifierOn(config, 'customTargetVp')) return config;
  return { ...config, modifiers: { ...config.modifiers, customTargetVp: targetVp } };
}

/** Whether the Custom Target VP is set to "Unlimited" (endless game). Merged from the old separate
 *  `customConstants.targetVp` limit (playtest): rather than the `null` sentinel that field used
 *  (which `customTargetVp`'s wire schema doesn't allow), an unlimited target is stored as the finite
 *  `LIMITLESS_CAP` — a positive int the schema DOES accept, which the engine's winnability calc
 *  already treats as endless (`>= LIMITLESS_CAP`, packages/engine/src/winnability.ts). */
export function isCustomTargetVpLimitless(config: RoomConfig): boolean {
  return (config.modifiers?.customTargetVp ?? 0) >= LIMITLESS_CAP;
}

/** Toggles the Custom Target VP between a finite number (`DEFAULT_CUSTOM_TARGET_VP`) and Unlimited
 *  (`LIMITLESS_CAP`). Only meaningful while the modifier is enabled (mirrors `withCustomTargetVp`). */
export function withCustomTargetVpLimitless(config: RoomConfig, limitless: boolean): RoomConfig {
  if (!isModifierOn(config, 'customTargetVp')) return config;
  return {
    ...config,
    modifiers: { ...config.modifiers, customTargetVp: limitless ? LIMITLESS_CAP : DEFAULT_CUSTOM_TARGET_VP },
  };
}

// ---- Custom game (T-906, docs/07 D-034 `customConstants`) -------------------------------------
// The curated-but-extensible tunable-constants panel. Every field mirrors `CustomConstantsConfig`
// (packages/shared/src/types.ts) 1:1 and defaults to the BASE constant when unset — adding a new
// simple numeric tunable to the panel is a one-line addition to `SIMPLE_FIELDS` below.

export const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
export const COST_ITEMS = ['road', 'settlement', 'city', 'devCard'] as const;
type CostItem = (typeof COST_ITEMS)[number];

/** Base defaults the panel shows/edits against (the same figures `resolveConstants` falls back to
 *  when a field is absent — docs/07 D-034; `bankPerResource` shows the plain base 19, not fiveSix's
 *  24, since the panel doesn't know the expansion selection's resolved figure ahead of `createGame`). */
const SIMPLE_FIELD_DEFAULTS = {
  productionMultiplier: 1,
  roadBuildingCount: 2,
  yearOfPlentyCount: 2,
  discardHandLimit: 7,
  bankPerResource: 19,
} as const;
type SimpleField = keyof typeof SIMPLE_FIELD_DEFAULTS;
export const SIMPLE_FIELDS: readonly SimpleField[] = [
  'productionMultiplier',
  'roadBuildingCount',
  'yearOfPlentyCount',
  'discardHandLimit',
  'bankPerResource',
];

/** The current `customConstants` config, or `{}` while the modifier is off/untouched. */
export function customConstantsConfig(config: RoomConfig): CustomConstantsConfig {
  return config.modifiers?.customConstants ?? {};
}

// ---- Limits + winnability (docs/07 D-034 "limits + winnability") ------------------------------
// Every field below is a positive-integer-OR-limitless (`null`) tunable (packages/shared/src/
// types.ts's `CustomConstantsConfig`) — each pairs a number input with a "Limitless" toggle in the
// panel (ModifiersDialog.tsx). `targetVp` here is a SECOND, independently-settable VP-target seam
// alongside the existing `customTargetVp` modifier (whichever is enabled resolves last wins) — its
// distinguishing feature is the `null` "endless game" option `customTargetVp` doesn't offer.

const CAP_FIELD_DEFAULTS = {
  // Base default (docs/03 §2) — shown while unset, same "base figure, not fiveSix/CK's own" caveat
  // `SIMPLE_FIELD_DEFAULTS.bankPerResource` already documents (the panel doesn't know the resolved
  // expansion figure ahead of `createGame`).
  targetVp: TARGET_VP,
  maxSettlements: 5,
  maxCities: 4,
  maxRoads: 15,
  maxCityWalls: 3,
  maxKnightsPerLevel: 2,
  maxProgressCards: 4,
} as const;
type CapField = keyof typeof CAP_FIELD_DEFAULTS;
export const CAP_FIELDS: readonly CapField[] = [
  // `targetVp` intentionally omitted here — the VP target (finite OR unlimited) is now the single
  // "Custom Target VP" control (playtest: merged the two separate settings). The engine still
  // accepts customConstants.targetVp for back-compat; the menu just no longer offers it twice.
  'maxSettlements',
  'maxCities',
  'maxRoads',
  'maxCityWalls',
  'maxKnightsPerLevel',
  'maxProgressCards',
];

/** A cap field's current value: the configured number, `null` while explicitly set to limitless,
 *  or the field's base default while unset entirely. */
export function capFieldValue(config: RoomConfig, field: CapField): number | null {
  const v = customConstantsConfig(config)[field];
  return v === undefined ? CAP_FIELD_DEFAULTS[field] : v;
}

export function isCapFieldLimitless(config: RoomConfig, field: CapField): boolean {
  return customConstantsConfig(config)[field] === null;
}

/** Returns `config` with one cap field set to a finite number (implicitly clears any limitless flag
 *  — a number input and the limitless toggle are mutually exclusive states for the same field). */
export function withCapField(config: RoomConfig, field: CapField, amount: number): RoomConfig {
  return withCustomConstants(config, { [field]: amount });
}

/** Returns `config` with one cap field's Limitless toggle set. Turning limitless OFF restores the
 *  field's base default (rather than clearing the key back to "absent", which is ALSO the base
 *  default but silently loses whatever number the host had dialed in before flipping to limitless —
 *  restoring the last-shown default is simplest/most predictable for the number input to land on). */
export function withCapFieldLimitless(config: RoomConfig, field: CapField, limitless: boolean): RoomConfig {
  return withCustomConstants(config, { [field]: limitless ? null : CAP_FIELD_DEFAULTS[field] });
}

/**
 * Builds a full `GameConfig`-shaped object from the lobby's `RoomConfig`, for the pre-game
 * winnability calculator (`@hexhaven/engine`'s `isConfigWinnable`), which needs the complete
 * `GameConfig` type even though it only ever reads `expansions`/`playerCount`/`variants`/
 * `modifiers`/`targetVp` — `seed`/`tokenMethod` are irrelevant placeholders. `targetVp` mirrors the
 * server's own base default (`TARGET_VP`, apps/server/src/session.ts) since the lobby has no direct
 * `targetVp` field of its own — only the `customTargetVp`/`customConstants.targetVp` modifiers can
 * override it, and both are already resolved generically by the engine's `resolveConstants`, which
 * `isConfigWinnable` calls internally.
 */
export function gameConfigForWinnability(config: RoomConfig): GameConfig {
  return {
    playerCount: config.playerCount,
    targetVp: TARGET_VP,
    seed: 'winnability-check',
    board: config.board ?? 'random',
    tokenMethod: 'spiral',
    expansions: config.expansions,
    variants: config.variants,
    modifiers: config.modifiers,
  };
}

/** The pre-game winnability check for the CURRENT lobby selection (docs/07 D-034) — the "prominent
 *  warning before the game can start" the options panel renders when the resolved VP target
 *  exceeds the highest reachable score, or an informational note when the target is endless. */
export function winnabilityFor(config: RoomConfig): WinnabilityCheck {
  return isConfigWinnable(gameConfigForWinnability(config));
}

/** Returns `config` with `patch` merged into the `customConstants` config — only meaningful while
 *  the modifier is already enabled (mirrors `withCustomTargetVp`). */
export function withCustomConstants(config: RoomConfig, patch: CustomConstantsConfig): RoomConfig {
  if (!isModifierOn(config, 'customConstants')) return config;
  return {
    ...config,
    modifiers: { ...config.modifiers, customConstants: { ...customConstantsConfig(config), ...patch } },
  };
}

/** A simple numeric field's current value, defaulting to its base constant when unset. */
export function simpleFieldValue(config: RoomConfig, field: SimpleField): number {
  return customConstantsConfig(config)[field] ?? SIMPLE_FIELD_DEFAULTS[field];
}

/** A starting-resource amount, defaulting to 0 (no bonus) when unset. */
export function startingResourceValue(config: RoomConfig, res: ResourceType): number {
  return customConstantsConfig(config).startingResources?.[res] ?? 0;
}

/** Returns `config` with one starting-resource amount set (0 removes it from the bundle). */
export function withStartingResource(config: RoomConfig, res: ResourceType, amount: number): RoomConfig {
  const current = { ...customConstantsConfig(config).startingResources };
  if (amount > 0) current[res] = amount;
  else delete current[res];
  return withCustomConstants(config, { startingResources: current });
}

/** One cost item's per-resource amount, defaulting to the base `COSTS` table when unset. */
export function costItemValue(config: RoomConfig, item: CostItem, res: ResourceType): number {
  return customConstantsConfig(config).costs?.[item]?.[res] ?? COSTS[item][res] ?? 0;
}

/**
 * Returns `config` with one (item, resource) cost cell set. The engine resolves `costs.<item>` as
 * a WHOLE-BUNDLE override (modules/modifiers/customConstants.ts) — so every OTHER resource in this
 * item is snapshotted at its current effective value (base or already-customized) rather than
 * silently dropped, the same footgun-avoidance `withStartingResource`'s "0 removes" convention
 * exists for.
 */
export function withCostItemField(config: RoomConfig, item: CostItem, res: ResourceType, amount: number): RoomConfig {
  const bundle: Partial<Record<ResourceType, number>> = {};
  for (const r of RESOURCE_TYPES) {
    const v = r === res ? amount : costItemValue(config, item, r);
    if (v > 0) bundle[r] = v;
  }
  const costs = { ...customConstantsConfig(config).costs, [item]: bundle };
  return withCustomConstants(config, { costs });
}

/** Player-count options for the segmented control: 3/4 always pick-able, 5/6 disabled until the
 * `fiveSix` toggle is on (requirement 2) OR — T-751 — Seafarers is on (picking 5/6 there is valid:
 * `withPlayerCount` below turns fiveSix on to match, since "Heading for New Shores" now ships 5/6
 * boards) OR — T-1050, Phase 10B — T&B's selected scenario supports 5–6 (today: `fishermen`) OR —
 * T-1150, Phase 11B — E&P's selected scenario supports 5–6 (today: `landHo`).
 * Independent of `SHIPPED_EXPANSIONS.fiveSix` by construction — while fiveSix is unshipped its own
 * toggle stays disabled off, so 5/6 can never actually be reached; once W1 ships, this needs no
 * change at all. */
export function playerCountOptions(config: RoomConfig): { value: string; label: string; disabled: boolean }[] {
  const fiveSixReachable =
    config.expansions.fiveSix ||
    config.expansions.seafarers !== false ||
    (!!config.expansions.tradersBarbarians && tbScenarioSupports56(config.expansions.tradersBarbarians.scenario)) ||
    (!!config.expansions.explorersPirates && epScenarioSupports56(config.expansions.explorersPirates.scenario));
  return ([3, 4, 5, 6] as const).map((n) => ({
    value: String(n),
    label: String(n),
    disabled: n >= 5 && !fiveSixReachable,
  }));
}

/** Returns `config` with the player count set directly (the player-count segmented control's
 * onChange — it does NOT go through `withExpansionToggled`). While Seafarers is on, keeps the T-751
 * fiveSix invariant consistent from this side too: 5/6 players needs fiveSix ON (the Seafarers 5–6
 * boards), 3/4 needs it OFF (the base 3/4 box) — otherwise picking a count here directly could leave
 * an fiveSix+seafarers+3/4 (or the reverse) combination the engine rejects. No-op on fiveSix when
 * Seafarers is off (unrelated to this toggle in that case).
 *
 * T-752: dropping to 3/4 while a 5-6-ONLY scenario (e.g. "New World") is selected would ALSO leave
 * an invalid combo (that scenario has no 3p/4p board at all) — falls back to the default (all-counts)
 * scenario in that case, same fix-up `withExpansionToggled` applies from the expansion-toggle side.
 *
 * T-1050 (Phase 10B): T&B's fiveSix invariant is kept the SAME way, from this side too — checked
 * FIRST (before the Seafarers branch) since the two expansions are mutually exclusive: a T&B config
 * with a 5–6-capable scenario selected sets `fiveSix` to match the requested count directly (no
 * scenario fallback needed — no T&B scenario is 5–6-ONLY, so a 3/4 pick is always still valid for it).
 *
 * T-1150 (Phase 11B): E&P's fiveSix invariant is kept the SAME way too, checked alongside T&B's
 * (mutually exclusive with it and with Seafarers) — a E&P config with a 5–6-capable scenario selected
 * sets `fiveSix` to match the requested count directly. */
export function withPlayerCount(config: RoomConfig, playerCount: RoomConfig['playerCount']): RoomConfig {
  if (config.expansions.tradersBarbarians && tbScenarioSupports56(config.expansions.tradersBarbarians.scenario)) {
    const fiveSix = playerCount === 5 || playerCount === 6;
    return { ...config, playerCount, expansions: { ...config.expansions, fiveSix } };
  }
  if (config.expansions.explorersPirates && epScenarioSupports56(config.expansions.explorersPirates.scenario)) {
    const fiveSix = playerCount === 5 || playerCount === 6;
    return { ...config, playerCount, expansions: { ...config.expansions, fiveSix } };
  }
  if (config.expansions.seafarers === false) return { ...config, playerCount };
  const fiveSix = playerCount === 5 || playerCount === 6;
  const scenario =
    !fiveSix && isFiveSixOnlyScenario(config.expansions.seafarers.scenario)
      ? DEFAULT_SEAFARERS_SCENARIO
      : config.expansions.seafarers.scenario;
  return {
    ...config,
    playerCount,
    expansions: { ...config.expansions, fiveSix, seafarers: { scenario } },
  };
}

export interface OptionsPanelProps {
  value: RoomConfig;
  onChange: (next: RoomConfig) => void;
}

export function OptionsPanel({ value, onChange }: OptionsPanelProps) {
  const { t } = useTranslation(['lobby', 'common']);
  const [modifiersDialogOpen, setModifiersDialogOpen] = useState(false);

  const onOffOptions = [
    { value: 'on', label: t('common:ui.on') },
    { value: 'off', label: t('common:ui.off') },
  ];

  // The "Modifiers (N)" button's count — every modifier `withModifierToggled`/`withHexPieceKindToggled`
  // currently has ON (mirrors the same `isModifierOn` check the dialog's own rows use, so the count
  // never drifts from what's actually enabled).
  const enabledModifiersCount = MODIFIER_KEYS.filter((key) => isModifierOn(value, key)).length;

  // T-906 (docs/07 D-034 "limits + winnability"): recomputed every render from `value` alone — pure
  // and cheap (no board/game state built), so no memoization needed.
  const winnability = winnabilityFor(value);

  // Which board mode's presets to offer (base / 5–6 / Seafarers). Seafarers uses the SAME picker,
  // but its selection is the scenario id (stored under `expansions.seafarers.scenario`), not
  // `config.board` — so value/onChange are wired to the scenario for that mode (T-705).
  const boardMode = boardModeForExpansions(value.expansions);
  const isSeafarersMode = boardMode === 'seafarers';
  const boardSizeKey = isSeafarersMode
    ? 'lobby:options.board.size.seafarers'
    : value.expansions.fiveSix
      ? 'lobby:options.board.size.large'
      : 'lobby:options.board.size.standard';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-1 font-ui text-14 font-medium text-ink">{t('lobby:options.playerCountLabel')}</p>
        <SegmentedControl
          ariaLabel={t('lobby:options.playerCountAria')}
          options={playerCountOptions(value)}
          value={String(value.playerCount)}
          onChange={(v) => onChange(withPlayerCount(value, Number(v) as RoomConfig['playerCount']))}
        />
      </div>

      <div>
        <p className="mb-1 font-ui text-14 font-medium text-ink">{t('lobby:options.boardLabel')}</p>
        {/* T-607: the registry-driven preset picker (base / 5–6 filtered by the expansion toggles).
            Confirmed presets are selectable; catalog-only ones render "coming soon". T-752: within
            Seafarers mode ALSO filter by the current player count, so a 5-6-only scenario (e.g. "New
            World") is hidden at 3/4 players — restricted to seafarers mode only (not base/fiveSix)
            because those modes' own presets are always uniformly [3,4] or [5,6] and can go through a
            transient state (fiveSix toggled on before the player-count control is moved to 5/6) where
            filtering by the CURRENT count would empty the list entirely. */}
        <BoardPresetPicker
          ariaLabel={t('lobby:options.boardAria')}
          presets={boardPresetsForMode(boardMode, isSeafarersMode ? value.playerCount : undefined)}
          value={isSeafarersMode ? selectedScenario(value) : selectedBoard(value)}
          onChange={(id) =>
            onChange(isSeafarersMode ? withScenario(value, id) : withBoard(value, id as BoardChoice))
          }
        />
        {/* T-606 req 3: make the board SIZE the game will use legible — the 30-hex board rides the
            5–6 (fiveSix) toggle; Seafarers uses its scenario frame. */}
        <p className="mt-1 font-ui text-12 text-ink-soft">{t(boardSizeKey)}</p>
      </div>

      <div data-testid="expansions-options">
        <p className="mb-2 font-ui text-14 font-medium text-ink">{t('lobby:options.expansionsHeading')}</p>
        <div className="flex flex-col gap-2">
          {EXPANSION_KEYS.map((key) => {
            const shipped: boolean = SHIPPED_EXPANSIONS[key];
            const on = isExpansionOn(value, key);
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 rounded-card border border-panel-edge bg-panel p-2"
              >
                <div>
                  <p className="flex items-center gap-2 font-ui text-14 font-semibold text-ink">
                    <span>{t(`lobby:options.expansions.${key}.name`)}</span>
                    {!shipped ? <Badge variant="default">{t('lobby:options.comingSoonBadge')}</Badge> : null}
                  </p>
                  <p className="font-ui text-12 text-ink-soft">
                    {t(`lobby:options.expansions.${key}.description`)}
                  </p>
                </div>
                <SegmentedControl
                  ariaLabel={t(`lobby:options.expansions.${key}.name`)}
                  disabled={!shipped}
                  value={on ? 'on' : 'off'}
                  onChange={(v) => onChange(withExpansionToggled(value, key, v === 'on'))}
                  options={onOffOptions}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* The T-901 inline modifier menu now lives in a dedicated popup (ModifiersDialog) — this
          button just reports how many are currently enabled and opens it. All modifier UI (grouped
          sections, per-kind hexPieces picker, customConstants params panel) is rendered inside the
          dialog itself so it never crowds this panel. */}
      <div data-testid="modifiers-options">
        <Button
          variant="subtle"
          aria-haspopup="dialog"
          aria-label={t('lobby:options.modifiersButtonAria')}
          data-testid="modifiers-open-button"
          onClick={() => setModifiersDialogOpen(true)}
        >
          {t('lobby:options.modifiersButton', { count: enabledModifiersCount })}
        </Button>
        <ModifiersDialog
          open={modifiersDialogOpen}
          onClose={() => setModifiersDialogOpen(false)}
          value={value}
          onChange={onChange}
        />
      </div>

      {/* T-906 (docs/07 D-034 "limits + winnability"): a PROMINENT, always-visible warning — never
          hidden behind the Modifiers popup — the instant the current selection's resolved VP target
          exceeds the highest reachable score, or an informational (non-warning) note for an endless
          (limitless-target) game. Recomputed from `value` on every render — no state of its own. */}
      {!winnability.winnable ? (
        <Panel role="alert" className="border-l-4 border-l-danger" data-testid="winnability-warning">
          <p className="font-ui text-14 text-ink">
            {t('lobby:options.winnability.warning', {
              max: winnability.maxAchievable === 'unbounded' ? '?' : winnability.maxAchievable,
            })}
          </p>
        </Panel>
      ) : winnability.endless ? (
        <Panel className="border-l-4 border-l-accent" data-testid="winnability-endless-note">
          <p className="font-ui text-14 text-ink-soft">{t('lobby:options.winnability.endless')}</p>
        </Panel>
      ) : null}

      {/* Traders & Barbarians scenario sub-selector (T-1008 requirement 1, mirrors the Seafarers
          scenario picker above but as a segmented control — T&B has no board-preset frame of its own,
          every scenario plays the base board, docs/rules/traders-barbarians-rules.md TB1.2). Only
          shown once `tradersBarbarians` is toggled on. */}
      {value.expansions.tradersBarbarians ? (
        <div className="flex flex-col gap-2 rounded-card border border-panel-edge bg-panel p-2" data-testid="tb-scenario-options">
          <p className="font-ui text-14 font-medium text-ink">{t('lobby:options.tbScenario.label')}</p>
          <SegmentedControl
            ariaLabel={t('lobby:options.tbScenario.aria')}
            value={selectedTBScenario(value)}
            onChange={(v) => onChange(withTBScenario(value, v))}
            options={TB_SCENARIOS.map((scenario) => ({
              value: scenario,
              label: t(`lobby:options.tbScenario.${scenario}.name`),
            }))}
          />
          <p className="font-ui text-12 text-ink-soft">
            {t(`lobby:options.tbScenario.${selectedTBScenario(value)}.description`)}
          </p>
        </div>
      ) : null}

      {/* Explorers & Pirates scenario sub-selector (T-1108 requirement A, mirrors the T&B one above
          exactly) — all five E&P scenarios ship now (T-1161: `EP_SCENARIOS`, gated engine-side by
          `SHIPPED_EP_SCENARIOS`). Only shown once `explorersPirates` is toggled on. */}
      {value.expansions.explorersPirates ? (
        <div className="flex flex-col gap-2 rounded-card border border-panel-edge bg-panel p-2" data-testid="ep-scenario-options">
          <p className="font-ui text-14 font-medium text-ink">{t('lobby:options.epScenario.label')}</p>
          <SegmentedControl
            ariaLabel={t('lobby:options.epScenario.aria')}
            value={selectedEPScenario(value)}
            onChange={(v) => onChange(withEPScenario(value, v))}
            options={EP_SCENARIOS.map((scenario) => ({
              value: scenario,
              label: t(`lobby:options.epScenario.${scenario}.name`),
            }))}
          />
          <p className="font-ui text-12 text-ink-soft">
            {t(`lobby:options.epScenario.${selectedEPScenario(value)}.description`)}
          </p>
        </div>
      ) : null}

      {value.expansions.fiveSix ? (
        <div className="flex flex-col gap-2 rounded-card border border-panel-edge bg-panel p-2" data-testid="turn-rule-options">
          <p className="font-ui text-14 font-medium text-ink">{t('lobby:options.turnRule.label')}</p>
          <SegmentedControl
            ariaLabel={t('lobby:options.turnRule.aria')}
            value={selectedTurnRule(value)}
            onChange={(v) => onChange(withTurnRule(value, v as FiveSixTurnRule))}
            options={FIVE_SIX_TURN_RULES.map((rule) => ({
              value: rule,
              label: t(`lobby:options.turnRule.${rule}.name`),
              // SBP temporarily disabled (user 2026-07-14): too slow/clicky at 6 players.
              disabled: rule === 'sbp' && !SBP_ENABLED,
            }))}
          />
          <p className="font-ui text-12 text-ink-soft">
            {t(`lobby:options.turnRule.${selectedTurnRule(value)}.description`)}
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 rounded-card border border-panel-edge bg-panel p-2">
        <p className="font-ui text-14 font-medium text-ink">{t('lobby:options.timersLabel')}</p>
        <SegmentedControl
          ariaLabel={t('lobby:options.timersAria')}
          value={value.timers.timers ? 'on' : 'off'}
          onChange={(v) =>
            onChange({ ...value, timers: { ...DEFAULT_ROOM_TIMERS, timers: v === 'on' } })
          }
          options={onOffOptions}
        />
      </div>
    </div>
  );
}
