// T-410 requirement 3: the evaluation function. Pure `evaluate(state, seat)` — a scalar standing
// for "how good is this position for `seat`", reused both as the search's leaf/rollout-cutoff score
// (search.ts) and as the one-ply greedy baseline's ranking function (greedyBaseline.ts). Weights are
// named constants (task's "Out of scope" note: tunable later without restructuring) rather than
// inline numbers.

import { TERRAIN_RESOURCE } from '@hexhaven/shared';
import type { BoardGeometry, GameState, ResourceType, Seat } from '@hexhaven/shared';
import { geometryForState } from '../modules/index.js';
import { hexTerrainOf } from '../modules/seafarers/index.js';
import { ownRoadAt } from '../rules/connectivity.js';
import { playerHarbors } from '../rules/harbors.js';
import { satisfiesDistanceRule } from '../rules/placement.js';
import { computeVp } from '../vp.js';

const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

/** Dice-sum -> pip weight, i.e. how many of the 36 two-die outcomes hit that total (R5.1). No
 * entry for 7 — a token never lands on 7 (R1.2), and a 7 never produces (R6.1). */
const DICE_PIPS: Readonly<Record<number, number>> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};

/** Named, independently-tunable weights (task's "Out of scope": no learned weights, but shape them
 * so they CAN be retuned without restructuring). Magnitudes are set so VP dominates (it is what
 * actually wins the game) while every other term meaningfully separates otherwise-tied positions —
 * tuned against evaluate.test.ts's hand-crafted orderings and ai/benchmark.test.ts's win rates. */
export const WEIGHTS = {
  VP: 1000,
  PRODUCTION_PIP: 18,
  RESOURCE_DIVERSITY: 10,
  PORT_GENERIC: 10,
  PORT_SPECIFIC: 20,
  LONGEST_ROAD_HELD: 150,
  LONGEST_ROAD_PROXIMITY: 18,
  LARGEST_ARMY_HELD: 150,
  LARGEST_ARMY_PROXIMITY: 40,
  HAND_CARD: 3,
  HAND_OVERFLOW_PENALTY: 12,
  DEV_CARD_HELD: 8,
  EXPANSION_SPOT: 2,
  ROBBER_ON_SELF: 45,
  ROBBER_ON_LEADER: 25,
} as const;

/** Expected resource income per roll-cycle (R5), pip-probability weighted, for every settlement (1×)
 * / city (2×) `seat` owns; the robber's current hex never pays out (R5.2). Walks the ACTIVE board's
 * geometry (`geometryForState`) rather than the base 19-hex `GEOMETRY` so Seafarers/5-6p hexes beyond
 * the base range are counted (B-27) — for a base config `geometryForState` returns the same frozen
 * `GEOMETRY` object, so base behavior (RK-13) is unchanged. */
function productionPips(
  state: GameState,
  seat: Seat,
  geometry: BoardGeometry
): { total: number; byResource: Record<ResourceType, number> } {
  const byResource: Record<ResourceType, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
  const player = state.players[seat];
  if (!player) return { total: 0, byResource };

  for (const hex of geometry.hexes) {
    if (hex.id === state.board.robber) continue;
    const tile = state.board.hexes[hex.id];
    if (!tile || tile.token == null) continue;
    const pip = DICE_PIPS[tile.token] ?? 0;
    if (pip === 0) continue;

    // Seafarers proxies sea/gold hexes to 'desert' in `state.board.hexes[].terrain` (T-702); the
    // real terrain lives in ext.seafarers.hexTerrain. `hexTerrainOf` returns undefined for a
    // base/EXT56 game, in which case the board's own terrain field is already authoritative.
    const terrain = hexTerrainOf(state, hex.id) ?? tile.terrain;
    if (terrain === 'sea') continue; // open water never produces.

    if (terrain === 'gold') {
      // S9: a gold hex pays its owner a resource of their CHOICE each time it hits — there is no
      // single ResourceType to credit. Modeled as generic production: split the pip*mult value
      // evenly across all five resource types, so it both (a) contributes to `total` production
      // and (b) credits every resource for the RESOURCE_DIVERSITY term below (a gold hex is at
      // least as flexible as owning one of each type).
      for (const v of hex.vertices) {
        const mult = player.cities.includes(v) ? 2 : player.settlements.includes(v) ? 1 : 0;
        if (mult === 0) continue;
        const share = (pip * mult) / RESOURCE_TYPES.length;
        for (const r of RESOURCE_TYPES) byResource[r] += share;
      }
      continue;
    }

    const res = TERRAIN_RESOURCE[terrain];
    if (res == null) continue;
    for (const v of hex.vertices) {
      const mult = player.cities.includes(v) ? 2 : player.settlements.includes(v) ? 1 : 0;
      if (mult > 0) byResource[res] += pip * mult;
    }
  }
  const total = RESOURCE_TYPES.reduce((sum, r) => sum + byResource[r], 0);
  return { total, byResource };
}

/** Count of empty, distance-legal vertices touching one of `seat`'s roads (R7.3/R7.2) — a
 * phase-agnostic proxy for "how much room this seat has left to expand into" (legalSettlementVertices
 * in legal.ts gates on `phase.kind === 'main'`, which evaluate must not assume). Walks the active
 * geometry (B-27) so Seafarers/5-6p vertices beyond the base 54 are considered. */
function expansionSpots(state: GameState, seat: Seat, geometry: BoardGeometry): number {
  let count = 0;
  for (const v of geometry.vertices) {
    if (!satisfiesDistanceRule(state, v.id)) continue;
    if (!ownRoadAt(state, seat, v.id)) continue;
    count += 1;
  }
  return count;
}

/** R13.1 VP total (settlements/cities/awards/hidden VP cards) — the dominant term (the game is won
 * on this alone); production/expansion/ports/hand/dev-card/robber terms break ties and steer play
 * toward positions that will keep generating VP. */
export function evaluate(state: GameState, seat: Seat): number {
  const player = state.players[seat];
  if (!player) return -Infinity;

  let score = 0;

  // Resolved once (B-27): the active board's geometry, not the hardcoded base GEOMETRY, so
  // Seafarers/5-6p hexes and vertices beyond the base 19/54 range are seen by every term below.
  const geometry = geometryForState(state);

  score += computeVp(state, seat).total * WEIGHTS.VP;

  const production = productionPips(state, seat, geometry);
  score += production.total * WEIGHTS.PRODUCTION_PIP;
  const diversity = RESOURCE_TYPES.filter((r) => production.byResource[r] > 0).length;
  score += diversity * WEIGHTS.RESOURCE_DIVERSITY;

  for (const harbor of playerHarbors(state, seat)) {
    score += harbor === 'generic' ? WEIGHTS.PORT_GENERIC : WEIGHTS.PORT_SPECIFIC;
  }

  const lr = state.awards.longestRoad;
  if (lr.holder === seat) {
    score += WEIGHTS.LONGEST_ROAD_HELD;
  } else {
    // Proximity credit uses the seat's own built-road COUNT as a cheap proxy for its longest-trail
    // length (the real longestRoadLength recompute is DFS-based and only worth its cost for the
    // actual award holder — rules/longestRoad.ts); capped at 5 to mirror the award's own threshold.
    score += Math.min(player.roads.length, 5) * WEIGHTS.LONGEST_ROAD_PROXIMITY;
  }

  const la = state.awards.largestArmy;
  if (la.holder === seat) {
    score += WEIGHTS.LARGEST_ARMY_HELD;
  } else {
    score += Math.min(player.playedKnights, 3) * WEIGHTS.LARGEST_ARMY_PROXIMITY;
  }

  const handSize = RESOURCE_TYPES.reduce((sum, r) => sum + player.resources[r], 0);
  score += Math.min(handSize, 7) * WEIGHTS.HAND_CARD;
  if (handSize > 7) score -= (handSize - 7) * WEIGHTS.HAND_OVERFLOW_PENALTY;

  const nonVpDevCards = player.devCards.filter((c) => c.type !== 'victoryPoint').length;
  score += nonVpDevCards * WEIGHTS.DEV_CARD_HELD;

  score += expansionSpots(state, seat, geometry) * WEIGHTS.EXPANSION_SPOT;

  const robberHex = geometry.hexes[state.board.robber];
  if (robberHex) {
    const onSelf = robberHex.vertices.some((v) => player.settlements.includes(v) || player.cities.includes(v));
    if (onSelf) score -= WEIGHTS.ROBBER_ON_SELF;

    let leader = state.players[0];
    for (const p of state.players) {
      if (leader === undefined || computeVp(state, p.seat).total > computeVp(state, leader.seat).total) leader = p;
    }
    if (leader && leader.seat !== seat) {
      const onLeader = robberHex.vertices.some((v) => leader!.settlements.includes(v) || leader!.cities.includes(v));
      if (onLeader) score += WEIGHTS.ROBBER_ON_LEADER;
    }
  }

  return score;
}
