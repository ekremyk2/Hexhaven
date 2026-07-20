// Victory points & the win-check hook (R13).

import type { GameState, ImprovementTrack, Seat } from '@hexhaven/shared';
import { citiesKnightsExt } from './modules/citiesKnights/state.js';
import { fishPointsVpFor, goldPointsVpFor, spicePointsVpFor } from './modules/explorersPirates/goldFishSpice.js';
import { EP_SCENARIO_CONFIG, isEPScenarioId } from './modules/explorersPirates/index.js';
import { lairPointsVpFor } from './modules/explorersPirates/pirateLairs.js';
import { harborSettlementVpFor } from './modules/explorersPirates/settling.js';
import { epExt, isExplorersPiratesState } from './modules/explorersPirates/state.js';
import { harbormasterExt } from './modules/modifiers/harbormaster.js';
import { islandChitVp } from './modules/seafarers/chits.js';
import { clothVp as seafarersClothVp, isClothForHexhavenState } from './modules/seafarers/cloth.js';
import { isPirateIslandsState, lairVp as seafarersLairVp } from './modules/seafarers/lairs.js';
import { isWondersOfHexhavenState, wonderComplete, wonderVp as seafarersWonderVp } from './modules/seafarers/wonder.js';
import { barbarianAttackVpFor } from './modules/tradersBarbarians/barbarianAttack.js';
import { caravansVpFor } from './modules/tradersBarbarians/caravans.js';
import { tradersBarbariansMainVpFor } from './modules/tradersBarbarians/main.js';
import { riversVpFor } from './modules/tradersBarbarians/rivers.js';
import {
  isBarbarianAttackState,
  isCaravansState,
  isRiversState,
  isTradersBarbariansMainState,
  oldBootHolder,
} from './modules/tradersBarbarians/state.js';

const IMPROVEMENT_TRACKS: readonly ImprovementTrack[] = ['trade', 'politics', 'science'];

/**
 * T-1113 (§EP1.3/§EP11, ⚠ VERIFY): is the Pirate Lairs mission actually ON for `state`'s own
 * scenario? `false` outside a live E&P game or for a scenario whose `EP_SCENARIO_CONFIG` entry has
 * `missions.pirateLairs` off (Land Ho!, Fish for Hexhaven, Spices for Hexhaven) — pirate lairs themselves
 * are created UNCONDITIONALLY by exploration reveals in every shipped scenario (a `'pirate'` tile
 * sits in every scenario's shared `EP_EXPLORATION_TILES`, exploration.ts), so `lairPointsVp` below is
 * gated on THIS flag (not merely on `isExplorersPiratesState`) to keep Land Ho!/Fish/Spice from
 * incidentally scoring lair VP should a future bot/player ever land a crew there — mirrors
 * `epSpiceMissionActive`'s own gating discipline in sim/bot.ts.
 */
function epPirateLairsMissionActive(state: GameState): boolean {
  const scenario = epExt(state)?.scenario;
  return scenario !== undefined && isEPScenarioId(scenario) && EP_SCENARIO_CONFIG[scenario].missions.pirateLairs;
}

/**
 * R13.1 victory-point breakdown for one seat. Included in the `gameWon` event — that is the
 * moment hidden VP cards are revealed (R9.8/R13.2).
 */
export interface VpBreakdown {
  /** 1 VP each. */
  settlements: number;
  /** 2 VP each. */
  cities: number;
  /** 2 or 0 — read from `state.awards` (maintained by T-110), never recomputed here. */
  longestRoad: 0 | 2;
  /** 2 or 0 — read from `state.awards` (maintained by T-111). */
  largestArmy: 0 | 2;
  /** 1 VP each; counted even on the purchase turn (R9.8). */
  vpCards: number;
  /** Seafarers small-island bonus VP (S10.6): `smallIslandVp` per distinct settled island. Public
   *  (chits sit on the board); always 0 in a base / fiveSix game. */
  islandChits: number;
  /**
   * Cities & Knights metropolis bonus (C1.3/C4.6, T-802): +2 VP per metropolis held, ON TOP of
   * that city's own 2 (so a metropolis city is worth 4 total). Present ONLY in a C&K game — the
   * key is omitted entirely (not just 0) for base/fiveSix/seafarers, so `computeVp`'s return shape
   * is byte-for-byte unchanged there (RK-13 bit-identity for any test asserting the exact shape).
   */
  metropolises?: number;
  /**
   * Cities & Knights Defender of Hexhaven (C1.3/C8.5, T-803): +1 VP per successful defense this seat
   * was the sole highest-defense player for. Present ONLY in a C&K game, omitted otherwise (same
   * bit-identity discipline as `metropolises`).
   */
  defenderOfHexhaven?: number;
  /**
   * Cities & Knights Merchant (C1.3/C6.5, T-804): +1 VP while this seat holds the merchant piece
   * (`ext.citiesKnights.merchant.owner === seat`). Present ONLY in a C&K game, omitted otherwise.
   */
  merchant?: number;
  /**
   * Harbormaster modifier award (T-906, docs/07 D-034): +2 VP while this seat holds it
   * (`ext.harbormaster.holder === seat`). Present ONLY when the modifier is enabled (`ext.harbormaster`
   * is set), omitted otherwise (same bit-identity discipline as `metropolises`/`merchant`).
   */
  harbormaster?: number;
  /**
   * Rivers Wealthiest Settler (T-1003, §TB3.4): +1 VP while this seat SOLELY holds the most gold
   * coins (ties -> nobody). Present ONLY in a rivers game, omitted otherwise (same bit-identity
   * discipline as `metropolises`/`harbormaster`).
   */
  riversWealthiest?: number;
  /**
   * Rivers Poorest Settler (T-1003, §TB3.4): -2 VP while this seat is tied for the FEWEST gold
   * coins (every tied-lowest seat counts, no sole-leader requirement). Present ONLY in a rivers
   * game, omitted otherwise.
   */
  riversPoorest?: number;
  /**
   * Caravans "between two camels" (T-1004, §TB4.3): +1 VP per settlement/city this seat owns that
   * sits at a vertex touching two camel-carrying route edges. Present ONLY in a caravans game,
   * omitted otherwise (same bit-identity discipline as `metropolises`/`harbormaster`).
   */
  caravansVp?: number;
  /**
   * Barbarian Attack captured barbarians (T-1005, §TB5): floor(capturedBarbarians / 2) VP — "½ VP
   * each" (⚠ VERIFY the rounding). Present ONLY in a barbarianAttack game, omitted otherwise (same
   * bit-identity discipline as `metropolises`/`harbormaster`/`caravansVp`).
   */
  barbarianAttackVp?: number;
  /**
   * The main scenario delivery VP (T-1006, §TB6.3): +1 VP per completed trade-hex delivery. Present
   * ONLY in the tradersBarbarians-scenario game, omitted otherwise (same bit-identity discipline as
   * `caravansVp`/`barbarianAttackVp`).
   */
  tradersBarbariansMainVp?: number;
  /**
   * Explorers & Pirates harbor settlements (T-1104, §EP4.2): +2 VP per harbor settlement held —
   * E&P's city-analogue (E&P has no cities to score; `settlements`/`cities` above stay accurate as
   * base fields regardless). Present ONLY in an E&P game, omitted otherwise (same bit-identity
   * discipline as `metropolises`/`harbormaster`/`tradersBarbariansMainVp`).
   */
  harborSettlementsVp?: number;
  /**
   * Explorers & Pirates Pirate Lairs mission (T-1105, §EP7.2): VP earned from CAPTURED lairs, split
   * 1 VP per crew this seat personally landed on each captured lair (this task's own v1 DECISION —
   * `modules/explorersPirates/pirateLairs.ts`'s own header). Present ONLY in an E&P game, omitted
   * otherwise (same bit-identity discipline as `harborSettlementsVp`).
   */
  lairPointsVp?: number;
  /**
   * Explorers & Pirates gold economy (T-1106, §EP6.2): VP from `shipGold` (`GOLD_PER_VP` gold -> 1
   * VP each). Present ONLY in an E&P game, omitted otherwise (same bit-identity discipline as
   * `lairPointsVp`).
   */
  goldPointsVp?: number;
  /**
   * Explorers & Pirates Fish for Hexhaven mission (T-1106, §EP8): VP from `deliverFish`
   * (`FISH_VP_PER_DELIVERY` each, this task's own v1 flat-amount DECISION —
   * `modules/explorersPirates/goldFishSpice.ts`'s own header). Present ONLY in an E&P game, omitted
   * otherwise.
   */
  fishPointsVp?: number;
  /**
   * Explorers & Pirates Spices for Hexhaven mission (T-1106, §EP9): VP from `deliverSpice`
   * (`SPICE_VP_PER_DELIVERY` each, same v1 flat-amount DECISION as `fishPointsVp`). Present ONLY in
   * an E&P game, omitted otherwise.
   */
  spicePointsVp?: number;
  /**
   * "Cloth for Hexhaven" (T-757, Seafarers 5-6 extension): `floor(cloth / 2)` — every 2 cloth tokens
   * (`ext.seafarers.cloth`, granted on a village hex's number roll) are worth 1 VP. Present ONLY in a
   * Cloth for Hexhaven game, omitted otherwise (same bit-identity discipline as `metropolises`/
   * `harbormaster`/`caravansVp`/etc — `ext.seafarers.cloth` is absent for every other scenario, so
   * this key never even appears there).
   */
  clothVp?: number;
  /**
   * "The Pirate Islands" (T-758, Seafarers 5-6 extension): `LAIR_VP` per captured pirate lair
   * (`ext.seafarers.lairs`, granted the first time a seat's ship/settlement touches one). Present
   * ONLY in a Pirate Islands game, omitted otherwise (same bit-identity discipline as `clothVp` —
   * `ext.seafarers.lairs` is absent for every other scenario, so this key never even appears there).
   */
  lairVp?: number;
  /**
   * "The Wonders of Hexhaven" (T-759, Seafarers 5-6 extension, FINAL scenario): 1 VP per completed
   * wonder stage (`ext.seafarers.wonder`, `modules/seafarers/wonder.ts`'s `wonderVp` — ⚠ VERIFY,
   * see that file's header). Present ONLY in a Wonders of Hexhaven game, omitted otherwise (same
   * bit-identity discipline as `clothVp`/`lairVp` — `ext.seafarers.wonder` is absent for every other
   * scenario, so this key never even appears there). Completing every stage is a SEPARATE alternate
   * win (`checkWin` below), not expressed through this counted VP alone.
   */
  wonderVp?: number;
  total: number;
}

/** Count a seat's VP per R13.1: settlements ·1, cities ·2, LR ·2, LA ·2, VP cards ·1, plus the
 *  Seafarers island-chit bonus (S10.6, 0 in a base game so base VP is bit-identical) and, in a
 *  Cities & Knights game, +2 per metropolis held (C1.3/C4.6). */
export function computeVp(state: GameState, seat: Seat): VpBreakdown {
  const player = state.players[seat];
  if (!player) throw new Error(`BUG: computeVp for unknown seat ${seat}`);
  const settlements = player.settlements.length;
  const cities = player.cities.length;
  const longestRoad = state.awards.longestRoad.holder === seat ? 2 : 0;
  const vpCards = player.devCards.filter((c) => c.type === 'victoryPoint').length;
  const islandChits = islandChitVp(state, seat);
  const clothForHexhaven = isClothForHexhavenState(state);
  const clothVp = clothForHexhaven ? seafarersClothVp(state, seat) : 0;
  const pirateIslands = isPirateIslandsState(state);
  const lairVp = pirateIslands ? seafarersLairVp(state, seat) : 0;
  const wondersOfHexhaven = isWondersOfHexhavenState(state);
  const wonderVp = wondersOfHexhaven ? seafarersWonderVp(state, seat) : 0;

  const ck = citiesKnightsExt(state);
  // C11.2: Largest Army does not exist in Cities & Knights — knights are board pieces (C7), not a
  // played-count stat, so it never contributes VP here regardless of `state.awards.largestArmy`
  // (which naturally stays null anyway, since `playKnight`/`buyDevCard` are rejected in a C&K game —
  // this is the explicit, module-aware belt-and-suspenders exclusion the rule requires).
  const largestArmy = !ck && state.awards.largestArmy.holder === seat ? 2 : 0;
  const metropolises = ck ? IMPROVEMENT_TRACKS.filter((t) => ck.metropolis[t] === seat).length * 2 : 0;
  const defenderOfHexhaven = ck ? (ck.defenderVp[seat] ?? 0) : 0;
  const merchant = ck?.merchant?.owner === seat ? 1 : 0;
  const harbormasterState = harbormasterExt(state);
  const harbormaster = harbormasterState?.holder === seat ? 2 : 0;

  const rivers = isRiversState(state);
  const riversScore = rivers ? riversVpFor(state, seat) : null;
  const riversWealthiest = riversScore ? riversScore.wealthiest : 0; // 0 or 1
  const riversPoorest = riversScore?.poorest ? -2 : 0; // 0 or -2 (avoids a `0 * -2 === -0` footgun)

  const caravans = isCaravansState(state);
  const caravansVp = caravans ? caravansVpFor(state, seat) : 0;

  const barbarianAttack = isBarbarianAttackState(state);
  const barbarianAttackVp = barbarianAttack ? barbarianAttackVpFor(state, seat) : 0;

  const tradersBarbariansMain = isTradersBarbariansMainState(state);
  const tradersBarbariansMainVp = tradersBarbariansMain ? tradersBarbariansMainVpFor(state, seat) : 0;

  const explorersPirates = isExplorersPiratesState(state);
  const harborSettlementsVp = explorersPirates ? harborSettlementVpFor(state, seat) : 0;
  // T-1113: gated on the scenario's own `missions.pirateLairs` flag (see `epPirateLairsMissionActive`'s
  // own header above), not merely on `explorersPirates` — Land Ho!/Fish/Spice never score lair VP.
  const lairPointsVp = explorersPirates && epPirateLairsMissionActive(state) ? lairPointsVpFor(state, seat) : 0;
  const goldPointsVp = explorersPirates ? goldPointsVpFor(state, seat) : 0;
  const fishPointsVp = explorersPirates ? fishPointsVpFor(state, seat) : 0;
  const spicePointsVp = explorersPirates ? spicePointsVpFor(state, seat) : 0;

  const total =
    settlements +
    cities * 2 +
    longestRoad +
    largestArmy +
    vpCards +
    islandChits +
    metropolises +
    defenderOfHexhaven +
    merchant +
    harbormaster +
    riversWealthiest +
    riversPoorest +
    caravansVp +
    barbarianAttackVp +
    tradersBarbariansMainVp +
    harborSettlementsVp +
    lairPointsVp +
    goldPointsVp +
    fishPointsVp +
    spicePointsVp +
    clothVp +
    lairVp +
    wonderVp;
  return {
    settlements,
    cities,
    longestRoad,
    largestArmy,
    vpCards,
    islandChits,
    ...(ck ? { metropolises, defenderOfHexhaven, merchant } : {}),
    ...(harbormasterState ? { harbormaster } : {}),
    ...(rivers ? { riversWealthiest, riversPoorest } : {}),
    ...(caravans ? { caravansVp } : {}),
    ...(barbarianAttack ? { barbarianAttackVp } : {}),
    ...(tradersBarbariansMain ? { tradersBarbariansMainVp } : {}),
    ...(explorersPirates ? { harborSettlementsVp, lairPointsVp, goldPointsVp, fishPointsVp, spicePointsVp } : {}),
    ...(clothForHexhaven ? { clothVp } : {}),
    ...(pirateIslands ? { lairVp } : {}),
    ...(wondersOfHexhaven ? { wonderVp } : {}),
    total,
  };
}

/**
 * Fishermen Old Boot catch-up (T-1002, docs/rules/traders-barbarians-rules.md §TB2.5): the boot's
 * holder needs +1 VP over the base target to win — a dynamic per-seat win THRESHOLD, not an extra
 * counted VP (so `computeVp`'s breakdown above is untouched; only the win comparison shifts). 0
 * outside a fishermen game / for every seat that isn't the current holder (RK-13: `oldBootHolder`
 * reads `undefined` with no `ext.tradersBarbarians`, so this is always 0 there).
 */
export function winTargetFor(state: GameState, seat: Seat): number {
  const bootBonus = oldBootHolder(state) === seat ? 1 : 0;
  return state.config.targetVp + bootBonus;
}

/**
 * R13.2 win hook: if `seat` (default: the active player) has reached their resolved win target
 * (`winTargetFor` — `state.config.targetVp`, config-resolved per docs/03 §8, plus the Fishermen Old
 * Boot's +1 for its holder), flip the phase to `ended` with that winner. Returns the input state
 * unchanged (same reference) when nobody wins.
 *
 * The dispatcher calls this only after a successful action, with the seat the current phase says is
 * eligible to win — the turn owner in the base game (so winning on another player's turn is
 * impossible, FAQ #16/#74), or a module-chosen seat when an expansion phase is active (e.g. the
 * 2022 Paired-Players "player 2"). See `reduce`.
 */
export function checkWin(state: GameState, seat: Seat = state.turn.player): GameState {
  if (state.phase.kind === 'ended') return state;
  // "The Wonders of Hexhaven" (T-759) ALTERNATE WIN: completing every wonder stage wins immediately, IN
  // PARALLEL with (not instead of) the normal VP-target race below — whichever a seat reaches first.
  // STRICTLY gated on `isWondersOfHexhavenState` (`ext.seafarers.wonder` presence, absent for base + every
  // other scenario/game) — this branch is never `true` elsewhere, so the normal-VP branch beneath it
  // is byte-for-byte unchanged for every other game (RK-13; see rk13-regression.test.ts).
  if (isWondersOfHexhavenState(state) && wonderComplete(state, seat)) {
    return { ...state, phase: { kind: 'ended', winner: seat } };
  }
  if (computeVp(state, seat).total < winTargetFor(state, seat)) return state;
  return { ...state, phase: { kind: 'ended', winner: seat } };
}
