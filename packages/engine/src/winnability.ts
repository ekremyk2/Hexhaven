// winnability.ts — pre-game winnability calculator (docs/07 D-034 "limits + winnability", the
// B-26-adjacent bugfix this closes: a host who set targetVp above what the configured piece caps/
// awards could ever deliver had no way to discover the game would soft-lock — reaching a score
// like 10/13 with every piece on the board, every award claimed, and no path to more VP). Computes
// an UPPER BOUND on the victory points any SINGLE player could ever reach under a `GameConfig`
// (its expansion + modifiers + `customConstants` limits), so the lobby/hot-seat options UI can warn
// BEFORE the game starts.
//
// Pure, deterministic, side-effect-free: no board is generated and no `GameState` is built — every
// input is `resolveConstants`/the Seafarers scenario lookups, all pure functions over `GameConfig`.

import type { GameConfig } from '@hexhaven/shared';
import { LIMITLESS_CAP } from '@hexhaven/shared';
import { resolveConstants } from './modules/index.js';

/** A resolved limit/target is "limitless" when it's at/above the finite sentinel `LIMITLESS_CAP`
 *  (`resolveLimit(null)` — customConstants.ts; a large finite cap, since Infinity can't cross JSON).
 *  Any real configured cap is far below this, so the threshold unambiguously means "limitless". */
function isLimitless(n: number): boolean {
  return n >= LIMITLESS_CAP;
}
import { scenarioBoardFor, scenarioFor } from './modules/seafarers/index.js';

/**
 * The upper-bound VP breakdown `maxAchievableVp` computes, one field per source (docs/07 D-034).
 * Every field is itself an upper bound "ignoring board-spot limits" (the task's own scoping) — e.g.
 * `buildings` assumes every settlement/city piece in the per-player supply gets placed somewhere,
 * never checking whether the actual board has that many legal vertices free.
 */
export interface MaxVpBreakdown {
  /** `maxCities * 2 + maxSettlements * 1` from the resolved per-player piece supply
   *  (`resolveConstants(config).piecesPerPlayer`) — Infinity-aware: a limitless settlement/city cap
   *  (T-906 `customConstants.maxSettlements`/`maxCities` set to `null`) makes this component (and so
   *  the whole total) `Infinity`, which `maxAchievableVp` reports as `'unbounded'`. */
  buildings: number;
  /** Longest Road, +2 — available in EVERY mode (base/5–6/Seafarers/Cities & Knights alike; C&K
   *  does NOT remove it, only Largest Army, C11.2 — `vp.ts`'s `computeVp` has no C&K guard on
   *  `longestRoad` either). */
  longestRoad: number;
  /** Largest Army, +2 — base/5–6/Seafarers only. REMOVED in Cities & Knights (C11.2: knights are
   *  board pieces built/promoted directly, not a played-count stat, so there is no Largest Army
   *  award to claim there — mirrors `vp.ts`'s `!ck &&` exclusion). */
  largestArmy: number;
  /** Hidden victory-point development cards, up to the resolved dev deck's `victoryPoint` count
   *  (base/fiveSix both 5 by default; a `cardMods`/`customConstants` config could change the
   *  resolved deck composition). Always 0 in Cities & Knights (C11.1: the base dev deck is replaced
   *  entirely by progress cards there). */
  devCardVp: number;
  /** Cities & Knights metropolis bonus (C1.3/C4.6): +2 VP each, at most 3 (one per improvement
   *  track — trade/politics/science, `ext.citiesKnights.metropolis`). 0 outside a Cities & Knights
   *  game. */
  metropolises: number;
  /** Cities & Knights Printer + Constitution progress cards (C1.3/C6.3/C6.5): each is a revealed
   *  +1 VP the instant it is drawn (never enters a hand) — a flat +2 when both are reachable. 0
   *  outside a Cities & Knights game. */
  progressCardVp: number;
  /** The `harbormaster` modifier's held +2 VP award (docs/07 D-034), when enabled. 0 otherwise. */
  harbormaster: number;
}

export interface WinnabilityResult {
  /** The summed upper bound, or `'unbounded'` when any contributing source is configured limitless
   *  (resolves to `Infinity` — docs/07 D-034's "limitless" sentinel), so no finite ceiling exists. */
  max: number | 'unbounded';
  breakdown: MaxVpBreakdown;
  /**
   * Non-blocking caveats about VP sources this bound deliberately EXCLUDES because they are
   * open-ended/repeatable rather than a fixed per-game cap (docs/07 D-034: "simplest correct: if
   * Defender is reachable, note the practical max is soft") — Cities & Knights' Defender of Hexhaven
   * (C1.3/C8.5, +1 VP per successful barbarian defense, uncapped over an arbitrarily long game) and
   * Seafarers' small-island chits (S10.6, count depends on the scenario's actual island layout, not
   * a config constant). One entry per applicable caveat, as a stable identifier the CALLER
   * translates (this module emits no display strings, docs/05 §7 — i18n is a client concern). A
   * config `isConfigWinnable` flags UNWINNABLE is genuinely unwinnable regardless of these notes; a
   * config flagged winnable might in practice have an even HIGHER practical ceiling than `max`
   * states, thanks to these excluded sources.
   */
  notes: readonly WinnabilityNote[];
}

/** Stable identifiers for `WinnabilityResult.notes` (docs/05 §7: engine emits data, never display
 *  strings — the client maps these to i18n keys, mirroring how event types map to log-panel copy). */
export type WinnabilityNote = 'citiesKnightsDefenderUncapped' | 'seafarersIslandChitsUncounted';

/**
 * Same target-VP resolution `createGame` performs (createGame.ts): a module override
 * (`customConstants.targetVp`, the narrower `customTargetVp` modifier, or Cities & Knights' own
 * 13-VP `constants.targetVp`) wins outright; otherwise a Seafarers scenario's own target (14 for
 * "Heading for New Shores") applies; otherwise the plain config value. Pure — `scenarioBoardFor`/
 * `scenarioFor` are data lookups, never board generation, so no rng/board is needed to answer this.
 */
export function effectiveTargetVp(config: GameConfig): number {
  const constants = resolveConstants(config);
  if (constants.targetVp !== undefined) return constants.targetVp;
  const scenario = scenarioFor(config);
  const scenarioBoard = scenarioBoardFor(config);
  if (scenario && scenarioBoard) return scenario.targetVp;
  return config.targetVp;
}

/**
 * The upper-bound VP any single player could ever reach under `config` (docs/07 D-034). Computed
 * entirely from `resolveConstants`/`config.expansions`/`config.modifiers` — no board or
 * `GameState` is built. See `MaxVpBreakdown`'s per-field docs for the exact formula each source
 * contributes, and `WinnabilityResult.notes` for the open-ended sources this bound excludes.
 */
export function maxAchievableVp(config: GameConfig): WinnabilityResult {
  const constants = resolveConstants(config);
  const citiesKnights = config.expansions.citiesKnights;
  const seafarers = config.expansions.seafarers !== false;
  const harbormasterOn = config.modifiers?.harbormaster !== undefined;

  const buildings = constants.piecesPerPlayer.cities * 2 + constants.piecesPerPlayer.settlements * 1;
  const longestRoad = 2;
  // C11.2: Largest Army does not exist in Cities & Knights (knights are board pieces, not a
  // played-count stat) — mirrors vp.ts's `computeVp`'s explicit `!ck &&` exclusion.
  const largestArmy = citiesKnights ? 0 : 2;
  // C11.1: the dev deck (and so its hidden victoryPoint cards) is replaced entirely by progress
  // cards in Cities & Knights.
  const devCardVp = citiesKnights ? 0 : (constants.devDeck.victoryPoint ?? 0);
  // C4.6: one metropolis per improvement track (trade/politics/science), +2 VP each.
  const metropolises = citiesKnights ? 6 : 0;
  // C6.5: Printer + Constitution are each a revealed +1 VP the instant they're drawn.
  const progressCardVp = citiesKnights ? 2 : 0;
  const harbormaster = harbormasterOn ? 2 : 0;

  const breakdown: MaxVpBreakdown = {
    buildings,
    longestRoad,
    largestArmy,
    devCardVp,
    metropolises,
    progressCardVp,
    harbormaster,
  };

  const notes: WinnabilityNote[] = [];
  if (citiesKnights) notes.push('citiesKnightsDefenderUncapped');
  if (seafarers) notes.push('seafarersIslandChitsUncounted');

  const total = buildings + longestRoad + largestArmy + devCardVp + metropolises + progressCardVp + harbormaster;
  // A limitless settlement/city cap makes `buildings` (and the total) reach the LIMITLESS_CAP
  // sentinel → no finite ceiling. (Was `Number.isFinite`, which only held while limitless === Infinity.)
  const max = isLimitless(total) ? 'unbounded' : total;
  return { max, breakdown, notes };
}

export interface WinnabilityCheck {
  /** `true` when the resolved `targetVp` is at or below `maxAchievableVp`'s bound (or the bound is
   *  `'unbounded'`) — the configuration CAN produce an automatic winner. Always `true` for an
   *  endless game (`endless` below), since there is no finite target to fail to reach. */
  winnable: boolean;
  /** `true` when the resolved `targetVp` is `Infinity` ("limitless"/endless, docs/07 D-034
   *  `customConstants.targetVp: null`) — the game never auto-ends regardless of `winnable`/
   *  `maxAchievable`. */
  endless: boolean;
  maxAchievable: number | 'unbounded';
  /** `null` when winnable/endless; else a short English fallback reason for non-UI callers (server
   *  logging) — the client renders its OWN i18n copy from `winnable`/`maxAchievable`/`endless`
   *  instead of this string (docs/05 §7: engine never produces display strings). */
  reason: string | null;
}

/**
 * Pre-game winnability check (docs/07 D-034): is `config`'s resolved `targetVp` reachable by any
 * single player under `config`'s resolved limits? Surfaces an ENDLESS game (limitless `targetVp`)
 * as its own flag rather than folding it into `winnable`/`reason` — a host who intentionally chose
 * no automatic winner isn't shown a warning, just an informational note ("Endless game — no
 * automatic winner").
 */
export function isConfigWinnable(config: GameConfig): WinnabilityCheck {
  const targetVp = effectiveTargetVp(config);
  const { max } = maxAchievableVp(config);
  // Limitless targetVp (customConstants.targetVp: null → the LIMITLESS_CAP sentinel) = endless game,
  // no automatic winner. (Was `!Number.isFinite`, valid only while limitless === Infinity.)
  if (isLimitless(targetVp)) {
    return { winnable: true, endless: true, maxAchievable: max, reason: null };
  }
  if (max === 'unbounded') {
    return { winnable: true, endless: false, maxAchievable: max, reason: null };
  }
  const winnable = targetVp <= max;
  return {
    winnable,
    endless: false,
    maxAchievable: max,
    reason: winnable ? null : `targetVp ${targetVp} exceeds the highest reachable score (~${max} VP)`,
  };
}
