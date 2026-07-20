// Module registry & resolution (docs/10 §3). Turns a `GameConfig` into the ordered list of active
// `RuleModule`s, and resolves the module-tunable board geometry / generation params / constants
// used across the engine. This is the ONE place expansion toggles are interpreted; base engine
// code asks these resolvers for geometry/constants rather than reading base globals directly
// (docs/03 §8), so a game at 5–6 transparently uses the 30-hex board everywhere.

import {
  BANK_PER_RESOURCE,
  COSTS,
  DEV_DECK,
  GEOMETRY,
  HARBOR_MIX,
  PIECES_PER_PLAYER,
  TERRAIN_COUNTS,
  TOKEN_SPIRAL,
} from '@hexhaven/shared';
import { getScenario, isScenarioId } from '@hexhaven/shared';
import type { AnyDevCardId, BoardGeometry, GameConfig, HarborType, PlayerColor, TerrainType } from '@hexhaven/shared';
import type { EngineError } from '../reduce.js';
import { citiesKnightsModule } from './citiesKnights/index.js';
import { fiveSixModule } from './fiveSix/index.js';
import { resolveModifierModules } from './modifiers/index.js';
import { seafarersModule } from './seafarers/index.js';
import { scenarioBoardFor, scenarioGeometryFor } from './seafarers/board.js';
import {
  SHIPPED_TB_SCENARIOS,
  TB_SCENARIO_SUPPORTS_56,
  isTBScenarioId,
  tradersBarbariansModule,
} from './tradersBarbarians/index.js';
import {
  EP_SCENARIO_SUPPORTS_56,
  LAND_HO_56_GEOMETRY,
  LAND_HO_56_TERRAINS,
  LAND_HO_56_TOKENS,
  LAND_HO_V0_TERRAINS,
  LAND_HO_V0_TOKENS,
  SHIPPED_EP_SCENARIOS,
  explorersPiratesModule,
  explorersPiratesScenario,
  isEPScenarioId,
} from './explorersPirates/index.js';
import type { ModuleBoardParams, ModuleConstants, RuleModule } from './types.js';

export type { ExpansionId, ModuleBoardParams, ModuleConstants, RuleModule } from './types.js';
export { citiesKnightsModule } from './citiesKnights/index.js';
export { fiveSixModule } from './fiveSix/index.js';
// T-901 (docs/07 D-034): the modifier framework's public resolution surface, re-exported here
// alongside the expansion modules it stacks on top of.
export {
  MODIFIER_IDS,
  MODIFIERS,
  modifierAvailability,
  resolveModifierModules,
} from './modifiers/index.js';
export type { ModifierAvailability } from './modifiers/index.js';
export { seafarersModule } from './seafarers/index.js';

/** Valid `variants.fiveSixTurnRule` values (X12). */
const FIVE_SIX_TURN_RULES = ['sbp', 'pairedPlayers'] as const;

/** Base seat→color mapping (docs/03 §2 "by seat"; docs/11 §1). Green/brown unlock with fiveSix. */
const BASE_SEAT_COLORS: readonly PlayerColor[] = ['red', 'blue', 'white', 'orange'];

/**
 * Config gate (docs/10 §1/§3, D-026) → the active module list, or a coded error. A shipped
 * module's toggle is legal and contributes below; unshipped toggles and player counts that
 * require an unshipped module are rejected with `EXPANSION_NOT_AVAILABLE` (defense in depth vs a
 * modified client). Exported so `validateConfig`/the server can pre-check without try/catch.
 *
 * Takes a `Pick` rather than the full `GameConfig` (mirrors `geometryForConfig`/`resolveBoardParams`
 * below): the only fields ever read are `expansions`/`playerCount`/`variants`/`modifiers`, so the
 * server's lobby (apps/server/src/lobby.ts) can validate a `RoomConfig` — which has neither
 * `targetVp` nor `seed`/`board`/`tokenMethod` — directly, without fabricating the rest of a
 * `GameConfig`.
 */
export function resolveModules(
  config: Pick<GameConfig, 'expansions' | 'playerCount' | 'variants' | 'modifiers'>
): { ok: true; modules: RuleModule[] } | { ok: false; error: EngineError } {
  const modules: RuleModule[] = [];

  // Expansion-combination guard (docs/10 §3 "single-expansion only" relaxation). Vetted combos only:
  //  - any SINGLE expansion;
  //  - Seafarers + Cities & Knights (3–4p, the official combined game, sim-verified);
  //  - the 5–6 player extension + Cities & Knights (5–6p) — the official C&K 5–6 extension reuses the
  //    base 5–6 board (GEOMETRY_EXT56), which we already have, so no new board is needed.
  // NOT allowed: the 5–6 extension + Seafarers — that needs the dedicated 5–6 Seafarers SCENARIO
  // boards (new geometry we don't ship), so reject it (and thus all three at once) rather than build
  // an incoherent board. Defense in depth: the client picker enforces the same policy.
  if (config.expansions.fiveSix && config.expansions.seafarers !== false) {
    // Phase 7B: the 5–6 player extension + Seafarers is a 5/6-PLAYER game on a shipped Seafarers 5–6
    // scenario — one whose board data includes this player count. (A 3/4 Seafarers game never enables
    // the 5–6 extension.) Until such a scenario ships, every fiveSix+seafarers combo still rejects
    // here (the 3/4-only intro board has no 5/6 entry).
    const sc = getScenario(config.expansions.seafarers.scenario);
    const pc = config.playerCount as 3 | 4 | 5 | 6;
    if ((pc !== 5 && pc !== 6) || !sc || !sc.boards[pc]) {
      return {
        ok: false,
        error: {
          code: 'EXPANSION_NOT_AVAILABLE',
          message:
            'the 5–6 player extension + Seafarers requires a shipped 5–6 Seafarers scenario board',
        },
      };
    }
  }

  // Seafarers (W2): the scenario foundation ships (T-701), so the toggle now RESOLVES to the module
  // rather than being rejected outright — but the scenario id must be one we actually ship (an
  // unknown id can never resolve to board data). Ship gameplay itself is still empty (T-702+), and
  // the client keeps Seafarers "coming soon" until T-705 flips `SHIPPED_EXPANSIONS.seafarers`.
  if (config.expansions.seafarers !== false) {
    if (!isScenarioId(config.expansions.seafarers.scenario)) {
      return {
        ok: false,
        error: {
          code: 'EXPANSION_NOT_AVAILABLE',
          message: `unknown seafarers scenario '${config.expansions.seafarers.scenario}'`,
        },
      };
    }
    modules.push(seafarersModule);
  }
  // Cities & Knights (W3, T-802): the module now activates when the config toggle is set. It is
  // deliberately NOT exposed in the client's expansion picker yet (`SHIPPED_EXPANSIONS.citiesKnights`
  // stays `false`, apps/client/src/options/OptionsPanel.tsx) and the lobby independently rejects it
  // (`expansionUnavailable`, apps/server/src/lobby.ts) — so this only makes the ENGINE able to run a
  // C&K game when a config constructs one directly (tests, later T-806 UI), never via the live lobby.
  if (config.expansions.citiesKnights) {
    modules.push(citiesKnightsModule);
  }

  if (config.expansions.fiveSix) {
    // The extra-build turn rule (X12) is only meaningful with fiveSix ON — validate it here (defense
    // in depth vs a modified client; the zod protocol rejects it earlier). When fiveSix is OFF the
    // field is inert and never inspected (base bit-identity, RK-13).
    const rule = config.variants?.fiveSixTurnRule;
    if (rule !== undefined && !(FIVE_SIX_TURN_RULES as readonly string[]).includes(rule)) {
      return {
        ok: false,
        error: {
          code: 'EXPANSION_NOT_AVAILABLE',
          message: `unknown fiveSix turn rule '${String(rule)}' (expected 'sbp' or 'pairedPlayers')`,
        },
      };
    }
    modules.push(fiveSixModule);
  }

  // Traders & Barbarians (W4, T-1001 skeleton, docs/rules/traders-barbarians-rules.md §TB1/§TB8.1).
  // Standalone only for now: reject any combination with Seafarers/C&K (a specific combo is enabled
  // only once built + tested, like B-60/B-61), and reject any scenario not yet in the shipped set
  // (empty at T-1001 → every T&B selection is "coming soon" until T-1002 lands Fishermen).
  if (config.expansions.tradersBarbarians) {
    if (config.expansions.seafarers !== false || config.expansions.citiesKnights) {
      return {
        ok: false,
        error: {
          code: 'EXPANSION_NOT_AVAILABLE',
          message: 'Traders & Barbarians cannot yet be combined with another expansion',
        },
      };
    }
    const scenario = config.expansions.tradersBarbarians.scenario;
    if (!isTBScenarioId(scenario) || !SHIPPED_TB_SCENARIOS.has(scenario)) {
      return {
        ok: false,
        error: {
          code: 'EXPANSION_NOT_AVAILABLE',
          message: `Traders & Barbarians scenario '${scenario}' is not available yet`,
        },
      };
    }
    // Phase 10B (T-1050): T&B plays on the BASE board (no scenario frame, TB1.2), so 5–6 support is
    // purely a player-count/board question, not a new board frame — allow `fiveSix` ON exactly when
    // the SELECTED scenario declares 5–6 support (`TB_SCENARIO_SUPPORTS_56`), mirroring the
    // Seafarers T-750 board-presence gate but keyed on a per-scenario capability flag (T&B has no
    // per-scenario board data to check presence against). `fiveSix` also requires playerCount 5/6
    // here (mirrors the seafarers+fiveSix gate above) — a fiveSix+T&B+3/4p combo never occurs from
    // the client, but this rejects it outright as defense in depth. Every other scenario (fiveSix
    // off) still plays 3–4p only, exactly as before (RK-13: no scenario's 3–4p behavior changes).
    if (config.expansions.fiveSix) {
      const pc = config.playerCount;
      if ((pc !== 5 && pc !== 6) || !TB_SCENARIO_SUPPORTS_56[scenario]) {
        return {
          ok: false,
          error: {
            code: 'EXPANSION_NOT_AVAILABLE',
            message: `Traders & Barbarians scenario '${scenario}' does not yet support the 5–6 player extension`,
          },
        };
      }
    }
    modules.push(tradersBarbariansModule);
  }

  // Explorers & Pirates (W5, T-1101 skeleton, docs/rules/explorers-pirates-rules.md §EP1/§EP12.1).
  // Standalone: reject combination with Seafarers/C&K/T&B (still true after T-1150). Reject any
  // scenario not yet in the shipped set (empty at T-1101 → every E&P selection is "coming soon" until
  // T-1107 lands Land Ho!).
  if (config.expansions.explorersPirates) {
    if (
      config.expansions.seafarers !== false ||
      config.expansions.citiesKnights ||
      config.expansions.tradersBarbarians
    ) {
      return {
        ok: false,
        error: {
          code: 'EXPANSION_NOT_AVAILABLE',
          message: 'Explorers & Pirates cannot yet be combined with another expansion',
        },
      };
    }
    const scenario = config.expansions.explorersPirates.scenario;
    if (!isEPScenarioId(scenario) || !SHIPPED_EP_SCENARIOS.has(scenario)) {
      return {
        ok: false,
        error: {
          code: 'EXPANSION_NOT_AVAILABLE',
          message: `Explorers & Pirates scenario '${scenario}' is not available yet`,
        },
      };
    }
    // T-1150 (Phase 11B): unlike T&B (which plays on the shared BASE board, T-1050), E&P has its own
    // scenario board — so 5–6 support is gated on BOTH the player count AND the selected scenario
    // declaring 5–6 support (`EP_SCENARIO_SUPPORTS_56`, mirrors `TB_SCENARIO_SUPPORTS_56`'s own gate
    // exactly, just keyed to E&P's own bigger-board capability instead of a base-board pass-through).
    // Today only `landHo` declares support (this task builds ITS bigger frame + proves it with a sim);
    // the other four scenarios stay 3–4p-only until T-1152 extends them.
    if (config.expansions.fiveSix) {
      const pc = config.playerCount;
      if ((pc !== 5 && pc !== 6) || !EP_SCENARIO_SUPPORTS_56[scenario]) {
        return {
          ok: false,
          error: {
            code: 'EXPANSION_NOT_AVAILABLE',
            message: `Explorers & Pirates scenario '${scenario}' does not yet support the 5–6 player extension`,
          },
        };
      }
    }
    modules.push(explorersPiratesModule);
  }

  // 5|6 players require the fiveSix extension (docs/10 §2, D-025).
  if ((config.playerCount === 5 || config.playerCount === 6) && !config.expansions.fiveSix) {
    return {
      ok: false,
      error: {
        code: 'EXPANSION_NOT_AVAILABLE',
        message: '5–6 players require the fiveSix extension (D-025)',
      },
    };
  }

  // T-901 (docs/07 D-034): modifiers STACK on top of whichever expansion(s) are active — appended
  // AFTER every expansion module above, in the fixed `MODIFIER_IDS` order (registry.ts), so their
  // `constants`/hooks fold/run last (customTargetVp overrides even Cities & Knights' own 13-VP
  // target). Rejects an incompatible combination with `MODIFIER_INCOMPATIBLE` before any of them
  // are appended. A config with no `modifiers` set resolves `[]` here, so base/expansion-only
  // behavior is unchanged (RK-13).
  const modifierResult = resolveModifierModules(config);
  if (!modifierResult.ok) return modifierResult;
  modules.push(...modifierResult.modules);

  return { ok: true, modules };
}

/**
 * The board geometry a config plays on. fiveSix → the 30-hex `GEOMETRY_EXT56`; otherwise the base
 * 19-hex `GEOMETRY` (the SAME frozen object as before, so base behavior is bit-identical). When
 * more layouts ship (Seafarers scenarios key on `config.expansions.seafarers.scenario`) this
 * resolver generalizes to the active module's `boardGeometry`.
 *
 * T-1150 (Phase 11B): a shipped E&P scenario checked BEFORE the generic fiveSix branch — E&P has its
 * OWN board (unlike T&B, which reuses `GEOMETRY_EXT56` via the generic branch below untouched) — so a
 * `fiveSix` E&P config resolves the bigger `LAND_HO_56_GEOMETRY` (37 hexes) instead. A 3–4 E&P config
 * (fiveSix off) falls through exactly as before this task: `LAND_HO_V0_TERRAINS`'s home island reuses
 * base `GEOMETRY` (RK-13 — this branch returns the literal same value the old code path did, just via
 * an explicit check instead of always falling to the bottom `return GEOMETRY`). A 5–6 combo whose
 * scenario does NOT support it (`EP_SCENARIO_SUPPORTS_56`) never reaches this resolver at all —
 * `resolveModules`/`validateConfig` reject it first — so no extra guard is needed here.
 */
export function geometryForConfig(
  config: Pick<GameConfig, 'expansions' | 'playerCount'>
): BoardGeometry {
  // Seafarers: the scenario frame (3p/4p differ), built once per (scenario, playerCount) — T-702.
  const scenarioGeo = scenarioGeometryFor(config);
  if (scenarioGeo) return scenarioGeo;
  const epScenario = explorersPiratesScenario(config);
  if (epScenario !== null && SHIPPED_EP_SCENARIOS.has(epScenario)) {
    return config.expansions.fiveSix ? LAND_HO_56_GEOMETRY : GEOMETRY;
  }
  if (config.expansions.fiveSix && fiveSixModule.boardGeometry) return fiveSixModule.boardGeometry;
  return GEOMETRY;
}

/** Convenience over `geometryForConfig` for the common `state.config` call site. */
export function geometryForState(state: { config: GameConfig }): BoardGeometry {
  return geometryForConfig(state.config);
}

/**
 * Resolve the module-tunable constants (docs/03 §8): base constants with each active module's
 * `constants` folded over them, in registry order. With no expansions this returns exactly the
 * base constants — so `createGame` for a base game is unchanged.
 */
export function resolveConstants(config: GameConfig): ModuleConstants {
  const resolved: ModuleConstants = {
    bankPerResource: BANK_PER_RESOURCE,
    devDeck: DEV_DECK,
    piecesPerPlayer: PIECES_PER_PLAYER,
    seatColors: BASE_SEAT_COLORS,
  };
  const active = resolveModules(config);
  if (!active.ok) return resolved; // caller (validateConfig) surfaces the error first
  for (const m of active.modules) {
    if (m.constants) Object.assign(resolved, m.constants);
  }
  // T-904 (cardMods modifier): additive dev-deck contributions fold AFTER every override above, so
  // they compose ON TOP of whatever devDeck composition the active expansion(s) chose instead of
  // clobbering it (see `ModuleConstants.devDeckAdditions`'s header comment). Generic over any
  // module declaring the field — no module-identity special-casing (docs/10 §3).
  for (const m of active.modules) {
    const additions = m.constants?.devDeckAdditions;
    if (!additions) continue;
    const devDeck: Partial<Record<AnyDevCardId, number>> = { ...resolved.devDeck };
    for (const key of Object.keys(additions) as AnyDevCardId[]) {
      devDeck[key] = (devDeck[key] ?? 0) + (additions[key] ?? 0);
    }
    resolved.devDeck = devDeck;
  }
  return resolved;
}

/**
 * The resolved build-costs table (T-906, docs/07 D-034 `customConstants.costs`) — `COSTS` unless a
 * module overrides it (`customConstantsModule`, modules/modifiers/customConstants.ts, always
 * supplies the complete 4-key table when it does — see `ModuleConstants.costs`'s header). A thin
 * convenience over `resolveConstants(config).costs` for the many call sites that need only this one
 * field (legal.ts, phases/main.ts, phases/devCards.ts, the AI/bots, the fiveSix SBP enumerator, the
 * Helpers modifier's Mendicant/Architect cost substitutions).
 */
export function resolveCosts(config: GameConfig): typeof COSTS {
  return resolveConstants(config).costs ?? COSTS;
}

/** `resolveCosts` for a `state.config` call site (mirrors `geometryForState` over `geometryForConfig`). */
export function costsForState(state: { config: GameConfig }): typeof COSTS {
  return resolveCosts(state.config);
}

/** Base board-generation multisets (R1.2/R2) — the fallback when no module overrides the board. */
const BASE_BOARD_PARAMS: ModuleBoardParams = {
  terrainCounts: TERRAIN_COUNTS as Record<TerrainType, number>,
  harborMix: HARBOR_MIX as readonly HarborType[],
  tokenSpiral: TOKEN_SPIRAL,
};

/** Resolve the board-generation multisets for a config (base, or an active module's override). For a
 *  seafarers scenario the multisets come from the scenario data (S10.2); `tokenSpiral` carries the
 *  scenario's number-token multiset (placed randomly, S10.4) so the I8 invariant can cross-check it. */
export function resolveBoardParams(
  config: Pick<GameConfig, 'expansions' | 'playerCount'>
): ModuleBoardParams {
  const scenarioBoard = scenarioBoardFor(config);
  if (scenarioBoard) {
    const terrainCounts: Record<TerrainType, number> = {
      hills: 0,
      forest: 0,
      pasture: 0,
      fields: 0,
      mountains: 0,
      desert: 0,
    };
    for (const h of scenarioBoard.hexes) {
      if (h.terrain !== 'sea' && h.terrain !== 'gold') terrainCounts[h.terrain] += 1;
    }
    return { terrainCounts, harborMix: scenarioBoard.harborMix, tokenSpiral: scenarioBoard.tokens };
  }
  // T-1107 (Explorers & Pirates Land Ho!), generalized by T-1111 (fishForHexhaven): the I8 invariant's
  // token-multiset cross-check needs the ACTUAL 7-hex home-island multiset `buildLandHoBoardV0` deals
  // (6 land + 1 desert, 6 tokens), not the base 19-hex spiral — the fog ring carries no tokens at all
  // (unrevealed hexes are the sea proxy, `token: null`, until `revealOnArrival` writes a real one,
  // which I8 doesn't cross-check against this static multiset). No harbors in the v1 Land Ho! board
  // (`harborMix: []`). Every E&P scenario shipped so far reuses this SAME board frame (T-1111's own
  // `EP_SCENARIO_CONFIG` framework doesn't (yet) need a per-scenario board-frame field — see
  // board.ts's header) — generalized from a `=== 'landHo'`-only check to any shipped scenario; a
  // future scenario with its own distinct board frame would need its own branch here instead.
  //
  // T-1150 (Phase 11B): `fiveSix` switches to the bigger `LAND_HO_56_TERRAINS`/`LAND_HO_56_TOKENS`
  // multiset (19-hex home island) — mirrors `geometryForConfig`'s own E&P-before-fiveSix ordering. A
  // 3–4 E&P config (fiveSix off) is completely untouched (RK-13): same `LAND_HO_V0_TERRAINS`/
  // `LAND_HO_V0_TOKENS` inputs as before this task.
  const epScenario = explorersPiratesScenario(config);
  if (epScenario !== null && SHIPPED_EP_SCENARIOS.has(epScenario)) {
    const terrainCounts: Record<TerrainType, number> = {
      hills: 0,
      forest: 0,
      pasture: 0,
      fields: 0,
      mountains: 0,
      desert: 0,
    };
    const terrains = config.expansions.fiveSix ? LAND_HO_56_TERRAINS : LAND_HO_V0_TERRAINS;
    const tokens = config.expansions.fiveSix ? LAND_HO_56_TOKENS : LAND_HO_V0_TOKENS;
    for (const t of terrains) terrainCounts[t] += 1;
    return { terrainCounts, harborMix: [], tokenSpiral: tokens };
  }
  if (config.expansions.fiveSix && fiveSixModule.boardParams) return fiveSixModule.boardParams;
  return BASE_BOARD_PARAMS;
}

/**
 * The active `RuleModule`s for a config, or `[]` when none apply (or the config is invalid — the
 * caller already validated at `createGame`). `reduce` calls this every action to consult module
 * hooks; for a base game it returns `[]`, so no hook ever runs and behavior is bit-identical (RK-13).
 */
export function activeModules(config: GameConfig): RuleModule[] {
  const resolved = resolveModules(config);
  return resolved.ok ? resolved.modules : [];
}
