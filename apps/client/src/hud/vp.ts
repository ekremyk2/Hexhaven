// R13.1 VP breakdown computed straight from a redacted `PlayerView` (T-402): unlike
// `@hexhaven/engine`'s `publicVp`/`ownVp` (T-111, `legal.ts`), which take a full `GameState` and are
// meant for server-side use, the HUD only ever holds a `PlayerView` — so this recomputes the same
// formula (settlements ·1, cities ·2, LR ·2, LA ·2, own hidden VP cards ·1) from the shapes
// `PlayerView.players` entries actually expose. `computePublicVp` works for ANY seat (settlements/
// cities/awards are public); `computeOwnVp` additionally counts hidden VP cards and must only ever
// be called with the viewer's own full entry (never leak another seat's hidden VP count, R13.2).
import { EP_HARBOR_SETTLEMENT_VP } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import type { ImprovementTrack, Seat } from '@hexhaven/shared';
import { GEOMETRY, getScenario } from '@hexhaven/shared';
import { ckOf } from '../citiesKnights/ckHelpers';

const IMPROVEMENT_TRACKS: readonly ImprovementTrack[] = ['trade', 'politics', 'science'];

export interface PublicVpBreakdown {
  settlements: number;
  cities: number;
  longestRoad: 0 | 2;
  largestArmy: 0 | 2;
  total: number;
}

export interface OwnVpBreakdown extends PublicVpBreakdown {
  vpCards: number;
  totalWithHidden: number;
}

interface PublicPieces {
  seat: Seat;
  settlements: unknown[];
  cities: unknown[];
}

export function computePublicVp(entry: PublicPieces, awards: PlayerView['awards']): PublicVpBreakdown {
  const settlements = entry.settlements.length;
  const cities = entry.cities.length;
  const longestRoad = awards.longestRoad.holder === entry.seat ? 2 : 0;
  const largestArmy = awards.largestArmy.holder === entry.seat ? 2 : 0;
  return {
    settlements,
    cities,
    longestRoad,
    largestArmy,
    total: settlements + cities * 2 + longestRoad + largestArmy,
  };
}

interface OwnPieces extends PublicPieces {
  devCards: { type: string }[];
}

export function computeOwnVp(own: OwnPieces, awards: PlayerView['awards']): OwnVpBreakdown {
  const pub = computePublicVp(own, awards);
  const vpCards = own.devCards.filter((c) => c.type === 'victoryPoint').length;
  return { ...pub, vpCards, totalWithHidden: pub.total + vpCards };
}

/**
 * Seafarers small-island bonus VP for `seat` (S10.6): `chits × scenario.smallIslandVp`. Island chits
 * are fully PUBLIC (on-board settlements), so this is added to every seat's shown VP total — matching
 * the engine's authoritative breakdown, which already folds chits in. Returns 0 for a base game, a
 * seat with no chits, or an unknown scenario id. Tolerates a partial `config`/`ext` (both may be
 * absent on crafted views), so callers can add it unconditionally.
 */
/**
 * VP sources the engine's `computeVp` folds in beyond settlements/cities/awards/hidden-VP-cards —
 * the harbormaster MODIFIER (+2 to its holder, docs/07 D-034) and, in a Cities & Knights game, each
 * metropolis held (+2, C4.6), Defender-of-Hexhaven cards (`defenderVp`, C8.5) and the merchant piece
 * (+1, C6.5). MUST mirror packages/engine/src/vp.ts exactly, because that engine total is what drives
 * the win check (R13.2): omitting these made a harbormaster holder WIN at a true 15 VP while the
 * scoreboard/VpWidget still read 13 (user-reported "won at 13, target 15"). Reads only PUBLIC
 * `view.ext` blocks, so it is correct for every seat. (Printer/Constitution are deliberately NOT
 * added here — the engine's `computeVp` does not count them either; that mismatch is tracked
 * separately so display and win-trigger stay in lockstep.)
 */
export function computeExtraVp(view: PlayerView, seat: Seat): number {
  let vp = 0;
  if (view.ext?.harbormaster?.holder === seat) vp += 2;
  const ck = ckOf(view);
  if (ck) {
    for (const track of IMPROVEMENT_TRACKS) if (ck.metropolis[track] === seat) vp += 2;
    vp += ck.defenderVp[seat] ?? 0;
    if (ck.merchant?.owner === seat) vp += 1;
  }
  vp += tbExtraVp(view, seat);
  return vp;
}

/**
 * Traders & Barbarians VP sources (T-1008), mirroring `packages/engine/src/vp.ts`'s `computeVp`
 * exactly (same B-38-class lesson `computeExtraVp`'s header comment already flags: display MUST
 * match the engine total that actually drives the win check, R13.2). Recomputed straight from the
 * fully-public `ext.tradersBarbarians` fields (coins/camels/capturedBarbarians/deliveries all ride
 * through unredacted, §TB8.4) rather than calling the engine's own `riversVpFor`/`caravansVpFor`/
 * `barbarianAttackVpFor`/`tradersBarbariansMainVpFor` — those take a full `GameState` and read
 * `state.players[seat].settlements/cities`, which a redacted `PlayerView` DOES expose for every seat
 * (public pieces), so the WIRE cast those engine helpers rely on elsewhere would work here too; this
 * file already has its OWN `GEOMETRY`-free formulas for rivers/barbarianAttack (no board geometry
 * needed) and only needs geometry for caravans' "between two camels" check, which is intentionally
 * NOT duplicated here — see `caravansHudVp` below for why that one DOES need the cast.
 */
function tbExtraVp(view: PlayerView, seat: Seat): number {
  const tb = view.ext?.tradersBarbarians;
  if (!tb) return 0;
  let vp = 0;
  if (tb.scenario === 'rivers' && tb.coins) {
    const coins = tb.coins;
    const maxCoins = Math.max(...coins);
    if (maxCoins > 0) {
      const mine = coins[seat] ?? 0;
      const minCoins = Math.min(...coins);
      const leaders = coins.filter((c) => c === maxCoins).length;
      if (leaders === 1 && mine === maxCoins) vp += 1;
      if (mine === minCoins) vp -= 2;
    }
  }
  if (tb.scenario === 'barbarianAttack') {
    vp += Math.floor((tb.capturedBarbarians?.[seat] ?? 0) / 2);
  }
  if (tb.scenario === 'tradersBarbarians') {
    vp += tb.deliveries?.[seat] ?? 0;
  }
  return vp;
}

/**
 * Caravans "between two camels" VP (§TB4.3): +1 per settlement/city `seat` owns that sits at a
 * vertex touching two DISTINCT camel-carrying route edges — the ONE T&B VP source that needs board
 * GEOMETRY (unlike the flat coin/capture/delivery tallies `tbExtraVp` folds in above), so it's kept
 * as its own function the caller (Scoreboard) adds in separately rather than baked into
 * `computeExtraVp` (which several callers use without ever importing `GEOMETRY`).
 */
export function caravansHudVp(view: PlayerView, seat: Seat): number {
  const tb = view.ext?.tradersBarbarians;
  if (!tb || tb.scenario !== 'caravans') return 0;
  const camels = tb.camels ?? [];
  if (camels.length < 2) return 0;
  const camelSet = new Set(camels);
  const player = view.players.find((p) => p.seat === seat);
  if (!player) return 0;
  let vp = 0;
  for (const v of [...player.settlements, ...player.cities]) {
    const vert = GEOMETRY.vertices[v];
    if (!vert) continue;
    const hits = vert.edges.filter((e) => camelSet.has(e));
    if (hits.length >= 2) vp += 1;
  }
  return vp;
}

/**
 * Fishermen Old Boot catch-up (T-1008, §TB2.5): the boot's holder needs +1 VP over the base target
 * to win — mirrors the engine's `winTargetFor` (packages/engine/src/vp.ts) exactly. A dynamic per-
 * seat win THRESHOLD, not an extra counted VP, so this is deliberately separate from
 * `computeExtraVp`/`tbExtraVp` above (which only ever adjust the numerator, never the target).
 */
export function tbWinTargetBonus(view: PlayerView, seat: Seat): number {
  return view.ext?.tradersBarbarians?.scenario === 'fishermen' && view.ext.tradersBarbarians.oldBoot === seat
    ? 1
    : 0;
}

export function computeIslandChitVp(view: PlayerView, seat: Seat): number {
  const sea = view.config.expansions?.seafarers;
  const chits = view.ext?.seafarers?.islandChits?.[seat];
  if (!sea || !chits || chits.length === 0) return 0;
  const scenario = getScenario(sea.scenario);
  return scenario ? chits.length * scenario.smallIslandVp : 0;
}

/**
 * "Cloth for Hexhaven" (T-757) VP: `floor(cloth / 2)` — mirrors the engine's `clothVp` exactly
 * (`packages/engine/src/modules/seafarers/cloth.ts`). Cloth counts are fully PUBLIC (they sit on the
 * board, mirror `islandChits` above), so this is correct for every seat. Returns 0 for a base game, a
 * seat with no cloth, or any scenario other than Cloth for Hexhaven (`ext.seafarers.cloth` absent).
 */
export function computeClothVp(view: PlayerView, seat: Seat): number {
  const cloth = view.ext?.seafarers?.cloth?.[seat];
  return cloth ? Math.floor(cloth / 2) : 0;
}

/** The Pirate Islands (T-758) LAIR_VP — mirrors the engine's own constant
 *  (`packages/engine/src/modules/seafarers/lairs.ts`) exactly. */
const LAIR_VP = 1;

/**
 * "The Pirate Islands" (T-758) VP: `lairs.length * LAIR_VP` — mirrors the engine's `lairVp` exactly.
 * Captured lairs are fully PUBLIC (they sit on the board, mirror `islandChits`/`cloth` above), so
 * this is correct for every seat. Returns 0 for a base game, a seat with no captures, or any scenario
 * other than Pirate Islands (`ext.seafarers.lairs` absent).
 */
export function computeLairVp(view: PlayerView, seat: Seat): number {
  const lairs = view.ext?.seafarers?.lairs?.[seat];
  return lairs ? lairs.length * LAIR_VP : 0;
}

/**
 * "The Wonders of Hexhaven" (T-759) VP: 1 VP per completed wonder stage — mirrors the engine's
 * `wonderVp` exactly (`packages/engine/src/modules/seafarers/wonder.ts`). Wonder progress is fully
 * PUBLIC (it sits on the board, mirrors `islandChits`/`cloth`/`lairs` above), so this is correct for
 * every seat. Returns 0 for a base game, a seat with no progress, or any scenario other than Wonders
 * of Hexhaven (`ext.seafarers.wonder` absent).
 */
export function computeWonderVp(view: PlayerView, seat: Seat): number {
  return view.ext?.seafarers?.wonder?.[seat] ?? 0;
}

// ---- Explorers & Pirates mission point tracks (T-1155, §EP6.2/§EP7.2/§EP8/§EP9) --------------------
//
// Unlike the seafarers cloth/lair/wonder VP above (whose engine formula this file must recompute
// from raw public board state), `fishPoints`/`spicePoints`/`lairPoints`/`goldPoints` are ALREADY the
// exact VP amounts `vp.ts`'s `computeVp` folds in (see `redact.ts`'s field comments on
// `PlayerView['ext']['explorersPirates']`) — so each getter below is a plain safe lookup, never a
// formula to keep in sync. Every scenario gate (which track is even meaningful) lives in
// `explorersPirates/epHelpers.ts`'s `isFishMissionActive`/`isSpiceMissionActive`/
// `isPirateLairsMissionActive`/`isAnyEpMissionActive` — this file only supplies the NUMBERS, the
// caller (Scoreboard) decides visibility from those predicates, exactly like `ck`/`tbCoins` above
// gate their own columns/badges.

/** Fish mission (§EP8) delivery VP for `seat` — 0 outside a live E&P game or before any delivery
 *  (this number doubles as "fish delivered to the council", since `FISH_VP_PER_DELIVERY` is 1). */
export function computeEpFishVp(view: PlayerView, seat: Seat): number {
  return view.ext?.explorersPirates?.fishPoints?.[seat] ?? 0;
}

/** Spice mission (§EP9) delivery VP for `seat` — 0 outside a live E&P game or before any delivery. */
export function computeEpSpiceVp(view: PlayerView, seat: Seat): number {
  return view.ext?.explorersPirates?.spicePoints?.[seat] ?? 0;
}

/** `seat`'s spice-benefit ladder LEVEL (§EP9, `spiceBenefit`) — extra sea-route hops the ship-range
 *  reads back (`spiceShipRangeBonus`, goldFishSpice.ts), NOT itself a VP source. Shown alongside
 *  `computeEpSpiceVp` so a viewer can see the range bonus their deliveries have unlocked. */
export function epSpiceBenefitLevel(view: PlayerView, seat: Seat): number {
  return view.ext?.explorersPirates?.spiceBenefit?.[seat] ?? 0;
}

/** Pirate Lairs mission (§EP7.2) capture VP for `seat` — 0 outside a live Pirate Lairs mission or
 *  before any capture. Distinct from seafarers' own `computeLairVp` above (The Pirate Islands,
 *  different expansion/scenario, different `ext` block). */
export function computeEpLairVp(view: PlayerView, seat: Seat): number {
  return view.ext?.explorersPirates?.lairPoints?.[seat] ?? 0;
}

/** `shipGold` (§EP6.2) VP for `seat` — 0 outside a live E&P game or before any gold shipped. */
export function computeEpGoldVp(view: PlayerView, seat: Seat): number {
  return view.ext?.explorersPirates?.goldPoints?.[seat] ?? 0;
}

/**
 * Explorers & Pirates harbor-settlement VP (EP4.2): `harborSettlements[seat].length ×
 * EP_HARBOR_SETTLEMENT_VP` — mirrors the engine's own `harborSettlementVpFor` exactly
 * (`packages/engine/src/modules/explorersPirates/settling.ts`), reusing its exported constant
 * rather than a duplicated magic number (unlike the small local mirrors above, this constant is
 * already part of the engine's public re-export surface, T-1108). UNCONDITIONAL in every live E&P
 * game — not mission-gated, matching `vp.ts`'s own `harborSettlementsVp` computation exactly (a
 * harbor settlement scores in Land Ho! too, which has no missions at all).
 */
export function computeEpHarborVp(view: PlayerView, seat: Seat): number {
  const count = view.ext?.explorersPirates?.harborSettlements?.[seat]?.length ?? 0;
  return count * EP_HARBOR_SETTLEMENT_VP;
}

/** EP7.2 ⚠ VERIFY (mirrors the engine's own `LAIR_CAPTURE_CREWS`/`LAIR_CREW_VP`,
 *  `modules/explorersPirates/pirateLairs.ts`): every lair capture splits EXACTLY this many total VP
 *  among its contributors (`LAIR_CAPTURE_CREWS` crews × `LAIR_CREW_VP` 1 each). */
const EP_LAIR_CAPTURE_CREWS = 3;

/**
 * Pirate lairs CAPTURED so far, GAME-WIDE (not per-seat) — the engine keeps no separate counter for
 * this (a captured lair is simply removed from the active `pirateLairs` list), but the capture
 * invariant above means summing every seat's `lairPoints` and dividing by `EP_LAIR_CAPTURE_CREWS`
 * always recovers the exact count. Returns 0 outside a live Pirate Lairs mission.
 */
export function epCapturedLairCount(view: PlayerView): number {
  const points = view.ext?.explorersPirates?.lairPoints ?? [];
  const total = points.reduce((sum, v) => sum + v, 0);
  return Math.round(total / EP_LAIR_CAPTURE_CREWS);
}
