// Board-preset registry (T-607, research `docs/rules/preset-boards-RESEARCH.md` §C.3 + §D).
//
// A single, mode-keyed catalog of every board a player can pick, so the base / 5–6 / (later)
// Seafarers pickers are one generic list instead of ad-hoc toggles. Each `BoardPreset` is PURE DATA:
// the picker renders it, and the engine builds the selected one from its `id` (which is what
// `GameConfig.board` stores). Only presets whose layout is CONFIRMED and encoded today are
// `available: true` (selectable); everything else in the catalog is `available: false` — shown
// "coming soon"/disabled, exactly like an unshipped expansion (research §D availability flags).
//
// Back-compat: the two buildable base ids are the historical `'random'` / `'beginner'` values, so an
// absent or `'random'` `config.board` still means the random generator and the RK-13 oracle stays
// bit-identical. T-705 adds selectable Seafarers scenarios by flipping their `available` flag (and
// widening `BuildableBoardPresetId`) — the picker component reused as-is, just filtered to
// `mode: 'seafarers'`.

import type { ScenarioId } from './scenario.js';
import { isScenarioId } from './scenario.js';
import type { GameConfig } from './types.js';

/** Which game module a board belongs to. Extensible: T-705 lights up `'seafarers'`; the C&K / T&B
 *  entries in research §D.4/§D.5 would add their own modes later. */
export type BoardMode = 'base' | 'fiveSix' | 'seafarers' | 'citiesKnights' | 'tradersBarbarians';

/** How a preset's board is produced: `random` = the seeded generator (R2), `fixed` = a full encoded
 *  layout (e.g. the beginner board), `scenario` = a Seafarers-style scenario frame (points at a
 *  `Scenario` record). */
export type BoardPresetKind = 'random' | 'fixed' | 'scenario';

/** The board-preset ids the ENGINE can build today. `GameConfig.board` holds one of these; every
 *  other catalog entry is `available: false` and can never reach the engine. Widened by T-705 as
 *  Seafarers scenarios become buildable. */
export type BuildableBoardPresetId = GameConfig['board'];

/** One entry in the picker's menu. `labelKey`/`descriptionKey` are namespace-qualified i18n keys
 *  (`lobby:…`) so any component — the lobby OptionsPanel or the hot-seat setup bar — can translate
 *  them without owning the copy. */
export interface BoardPreset {
  /** Stored in `config.board` when selectable; unique WITHIN a mode (the same `'random'` id appears
   *  in both `base` and `fiveSix` — the mode is implied by `config.expansions`). */
  id: string;
  mode: BoardMode;
  kind: BoardPresetKind;
  /** Player counts this preset supports (for display/gating). */
  players: readonly (3 | 4 | 5 | 6)[];
  /** i18n key for the short name (both en + tr). */
  labelKey: string;
  /** i18n key for the one-line description (both en + tr). */
  descriptionKey: string;
  /** `true` = layout confirmed + encoded → selectable now. `false` = catalog-only ("coming soon"). */
  available: boolean;
  /** For `kind: 'scenario'` — the `Scenario` record this preset points at (T-705 renders/builds it). */
  scenarioId?: ScenarioId;
}

/**
 * The catalog. Order within a mode is the picker's display order (the buildable default first).
 *
 * - base: `random` (generator) + `beginner` (fixed, research §A) — both confirmed/selectable.
 * - fiveSix: `random` (generator, selectable) + `5-6 New Players` (fixed, research §D.2) — the
 *   latter is CATALOG-ONLY: the research confirms a diagram exists (p.5) but did NOT extract the
 *   hex-by-hex layout, so it stays "coming soon" until traced (availability honesty, requirement 4).
 * - seafarers: the scenario presets (research §D.3) — catalog-only until T-705 encodes their frames;
 *   they point at the `Scenario` records already shipped in `scenario.ts`.
 */
export const BOARD_PRESETS: readonly BoardPreset[] = [
  {
    id: 'random',
    mode: 'base',
    kind: 'random',
    players: [3, 4],
    labelKey: 'lobby:options.board.random.name',
    descriptionKey: 'lobby:options.board.random.description',
    available: true,
  },
  {
    id: 'beginner',
    mode: 'base',
    kind: 'fixed',
    players: [3, 4],
    labelKey: 'lobby:options.board.beginner.name',
    descriptionKey: 'lobby:options.board.beginner.description',
    available: true,
  },
  {
    id: 'random',
    mode: 'fiveSix',
    kind: 'random',
    players: [5, 6],
    labelKey: 'lobby:options.board.random.name',
    descriptionKey: 'lobby:options.board.random.description',
    available: true,
  },
  {
    id: 'fiveSixNewPlayers',
    mode: 'fiveSix',
    kind: 'fixed',
    players: [5, 6],
    labelKey: 'lobby:options.board.fiveSixNewPlayers.name',
    descriptionKey: 'lobby:options.board.fiveSixNewPlayers.description',
    available: false, // research §D.2: diagram confirmed, hex-by-hex layout NOT yet extracted.
  },
  {
    id: 'headingForNewShores',
    mode: 'seafarers',
    kind: 'scenario',
    // T-751: the scenario now ships boards for every player count (3/4 base box, 5/6 the Seafarers
    // 5–6 extension gated by `fiveSix`) — see scenario.ts HEADING_FOR_NEW_SHORES.boards.
    players: [3, 4, 5, 6],
    labelKey: 'lobby:options.board.headingForNewShores.name',
    descriptionKey: 'lobby:options.board.headingForNewShores.description',
    available: true, // T-705: scenario frame encoded (T-701/T-702) and playable — selectable now.
    scenarioId: 'headingForNewShores',
  },
  {
    id: 'newWorld',
    mode: 'seafarers',
    kind: 'scenario',
    // T-752: "New World" is a 5–6-ONLY scenario (no 3p/4p entries in scenario.ts NEW_WORLD.boards) —
    // the first preset whose `players` excludes 3/4, exercising the player-count filtering this task
    // adds to `boardPresetsForMode`/the OptionsPanel picker.
    players: [5, 6],
    labelKey: 'lobby:options.board.newWorld.name',
    descriptionKey: 'lobby:options.board.newWorld.description',
    available: true,
    scenarioId: 'newWorld',
  },
  {
    id: 'throughTheDesert',
    mode: 'seafarers',
    kind: 'scenario',
    // T-753: "Through the Desert" is another 5–6-ONLY scenario (no 3p/4p entries in scenario.ts
    // THROUGH_THE_DESERT.boards) — reuses the players-filtering `isFiveSixOnlyScenario` framework
    // T-752 built, no picker-logic changes needed.
    players: [5, 6],
    labelKey: 'lobby:options.board.throughTheDesert.name',
    descriptionKey: 'lobby:options.board.throughTheDesert.description',
    available: true,
    scenarioId: 'throughTheDesert',
  },
  {
    id: 'forgottenTribe',
    mode: 'seafarers',
    kind: 'scenario',
    // T-754: "The Forgotten Tribe" is another 5–6-ONLY scenario (no 3p/4p entries in scenario.ts
    // FORGOTTEN_TRIBE.boards) — reuses the players-filtering `isFiveSixOnlyScenario` framework T-752
    // built, no picker-logic changes needed.
    players: [5, 6],
    labelKey: 'lobby:options.board.forgottenTribe.name',
    descriptionKey: 'lobby:options.board.forgottenTribe.description',
    available: true,
    scenarioId: 'forgottenTribe',
  },
  {
    id: 'sixIslands',
    mode: 'seafarers',
    kind: 'scenario',
    // T-755: "The Six Islands" is another 5–6-ONLY scenario (no 3p/4p entries in scenario.ts
    // SIX_ISLANDS.boards) — reuses the players-filtering `isFiveSixOnlyScenario` framework T-752
    // built, no picker-logic changes needed.
    players: [5, 6],
    labelKey: 'lobby:options.board.sixIslands.name',
    descriptionKey: 'lobby:options.board.sixIslands.description',
    available: true,
    scenarioId: 'sixIslands',
  },
  {
    id: 'fogIslands',
    mode: 'seafarers',
    kind: 'scenario',
    // T-756: "The Fog Islands" is another 5–6-ONLY scenario (no 3p/4p entries in scenario.ts
    // FOG_ISLANDS.boards) — reuses the players-filtering `isFiveSixOnlyScenario` framework T-752
    // built, no picker-logic changes needed. NEW MECHANIC: fog exploration (facedown hexes revealed
    // by ship, engine-side in `modules/seafarers/fog.ts` — nothing about the PICKER changes for it).
    players: [5, 6],
    labelKey: 'lobby:options.board.fogIslands.name',
    descriptionKey: 'lobby:options.board.fogIslands.description',
    available: true,
    scenarioId: 'fogIslands',
  },
  {
    id: 'clothForHexhaven',
    mode: 'seafarers',
    kind: 'scenario',
    // T-757: "Cloth for Hexhaven" is another 5–6-ONLY scenario (no 3p/4p entries in scenario.ts
    // CLOTH_FOR_HEXHAVEN.boards) — reuses the players-filtering `isFiveSixOnlyScenario` framework T-752
    // built, no picker-logic changes needed. NEW MECHANIC: cloth-producing villages (engine-side in
    // `modules/seafarers/cloth.ts` — nothing about the PICKER changes for it).
    players: [5, 6],
    labelKey: 'lobby:options.board.clothForHexhaven.name',
    descriptionKey: 'lobby:options.board.clothForHexhaven.description',
    available: true,
    scenarioId: 'clothForHexhaven',
  },
  {
    id: 'pirateIslands',
    mode: 'seafarers',
    kind: 'scenario',
    // T-758: "The Pirate Islands" is another 5–6-ONLY scenario (no 3p/4p entries in scenario.ts
    // PIRATE_ISLANDS.boards) — reuses the players-filtering `isFiveSixOnlyScenario` framework T-752
    // built, no picker-logic changes needed. NEW MECHANIC: an auto-moving pirate track + capturable
    // lairs (engine-side in `modules/seafarers/pirateTrack.ts`/`lairs.ts` — nothing about the PICKER
    // changes for it).
    players: [5, 6],
    labelKey: 'lobby:options.board.pirateIslands.name',
    descriptionKey: 'lobby:options.board.pirateIslands.description',
    available: true,
    scenarioId: 'pirateIslands',
  },
  {
    id: 'wondersOfHexhaven',
    mode: 'seafarers',
    kind: 'scenario',
    // T-759: "The Wonders of Hexhaven" is the ninth (and FINAL) 5–6-ONLY seafarers scenario (no 3p/4p
    // entries in scenario.ts WONDERS_OF_HEXHAVEN.boards) — reuses the players-filtering
    // `isFiveSixOnlyScenario` framework T-752 built, no picker-logic changes needed. NEW MECHANIC:
    // build-a-wonder ALTERNATE WIN (engine-side in `modules/seafarers/wonder.ts` — nothing about the
    // PICKER changes for it).
    players: [5, 6],
    labelKey: 'lobby:options.board.wondersOfHexhaven.name',
    descriptionKey: 'lobby:options.board.wondersOfHexhaven.description',
    available: true,
    scenarioId: 'wondersOfHexhaven',
  },
];

/** The presets offered for a game mode, in display order (used to drive the picker). Pass
 *  `playerCount` (T-752) to ALSO filter out presets whose `players` array excludes it — e.g. "New
 *  World" (`players: [5, 6]`) must not be offered at 3/4 players. Omitting `playerCount` keeps the
 *  old mode-only behaviour (every caller that doesn't yet care about per-count gating, e.g. the
 *  hot-seat setup bar, is unaffected). */
export function boardPresetsForMode(mode: BoardMode, playerCount?: 3 | 4 | 5 | 6): BoardPreset[] {
  return BOARD_PRESETS.filter(
    (p) => p.mode === mode && (playerCount === undefined || p.players.includes(playerCount)),
  );
}

/** Look up a preset by mode + id (ids are unique within a mode). */
export function getBoardPreset(mode: BoardMode, id: string): BoardPreset | undefined {
  return BOARD_PRESETS.find((p) => p.mode === mode && p.id === id);
}

/** The active board mode implied by the expansion toggles (base vs 5–6 vs Seafarers). Seafarers wins
 *  when its scenario is set, then 5–6, else the base board. */
export function boardModeForExpansions(expansions: GameConfig['expansions']): BoardMode {
  if (expansions.seafarers !== false) return 'seafarers';
  if (expansions.fiveSix) return 'fiveSix';
  return 'base';
}

/** Whether `id` is a preset the engine can build today (i.e. a value `config.board` may legally
 *  hold). Guards the wire/server boundary against a catalog-only ("coming soon") id. */
export function isBuildableBoardPresetId(id: string): id is BuildableBoardPresetId {
  return BOARD_PRESETS.some((p) => p.available && p.id === id && p.kind !== 'scenario');
}

/** Type-guard convenience for scenario presets that reference a shipped `Scenario` record. */
export function boardPresetScenario(preset: BoardPreset): ScenarioId | undefined {
  return preset.scenarioId !== undefined && isScenarioId(preset.scenarioId) ? preset.scenarioId : undefined;
}

/**
 * Whether a shipped Seafarers scenario id is 5–6-ONLY (its preset's `players` excludes 3 and 4) —
 * e.g. "New World" (T-752). The reusable hook for the OptionsPanel's fiveSix↔playerCount↔scenario
 * invariant (`withScenario`/`withPlayerCount`/`withExpansionToggled`): every future scenario shipped
 * with `players: [5, 6]` gets the same "picking it forces fiveSix + bumps the count" / "leaving 5-6
 * resets it back to the default scenario" fix-up automatically, driven by this catalog lookup — none
 * of it is hardcoded to `newWorld`. Unknown/catalog-less ids are treated as NOT 5–6-only (`false`),
 * matching `isScenarioId`'s "unknown ids gate closed" convention.
 */
export function isFiveSixOnlyScenario(scenarioId: string): boolean {
  const preset = getBoardPreset('seafarers', scenarioId);
  return !!preset && !preset.players.includes(3) && !preset.players.includes(4);
}
