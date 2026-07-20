// harbormaster modifier (T-906 wave A-1, docs/07 D-034 / docs/tasks/modifiers-RESEARCH.md
// "Harbormaster", OFFICIAL Atlantis / Traders & Barbarians): a held, transferable +2 VP award for
// the seat with the most harbor-building points — settlement on a harbor vertex = 1, city = 2,
// minimum 3 points to claim, ties keep the current holder. Mirrors Longest Road / Largest Army's
// award-transfer SHAPE (`rules/awards.ts`'s `updateLongestRoad`/`updateLargestArmy`) — specifically
// the simpler Largest Army pattern (sole leader at/above the threshold claims or steals via
// strictly-more, otherwise the holder keeps it) rather than Longest Road's "break" complexity:
// nothing severs a harbor building the way an opposing settlement severs a road, so there is no
// analogous set-aside case here.
//
// State lives at `state.ext.harbormaster` (docs/10 §3 expansion-readiness — a modifier is state-
// isolated exactly like an expansion), NOT in the base `awards` object, so a non-harbormaster game
// never carries this field. Recomputed via `phaseHooks.afterAction` after EVERY action (cheap: a
// scan over harbor vertices × each seat's settlements/cities) rather than threading a call through
// every settlement/city build path (setup placements, `buildSettlement`/`buildCity`, and — in a
// Cities & Knights game — barbarian pillage demoting a city) — recomputing generically here reaches
// all of them for free without touching any base or C&K reducer.

import type { EdgeId, GameState, Seat, VertexId } from '@hexhaven/shared';
import { awardMoved } from '../../events.js';
import { geometryForState } from '../index.js';
import type { RuleModule } from '../types.js';

const CLAIM_THRESHOLD = 3;

/** Every vertex that is an endpoint of some harbor edge, deduped (in case a hand-built board ever
 *  has two harbor edges sharing a vertex — never true of the generated boards, but cheap to guard). */
function harborVertices(state: GameState): Set<VertexId> {
  const geometry = geometryForState(state);
  const vertices = new Set<VertexId>();
  for (const key of Object.keys(state.board.harbors)) {
    const edge = geometry.edges[Number(key) as EdgeId];
    if (!edge) continue;
    vertices.add(edge.a);
    vertices.add(edge.b);
  }
  return vertices;
}

/** A seat's harbor points: 1 per settlement + 2 per city sitting on a harbor vertex. */
function harborPoints(state: GameState, seat: Seat, vertices: ReadonlySet<VertexId>): number {
  const player = state.players[seat];
  if (!player) return 0;
  let points = 0;
  for (const v of player.settlements) if (vertices.has(v)) points += 1;
  for (const v of player.cities) if (vertices.has(v)) points += 2;
  return points;
}

/**
 * Recompute the Harbormaster award: the sole leader at ≥3 harbor points holds it; ties (and
 * anything below the threshold) keep the CURRENT holder — mirrors `updateLargestArmy`'s exact
 * "claim / strictly-more steals, else keep" shape (rules/awards.ts). Returns a NEW state with
 * `ext.harbormaster` set, or the SAME reference when nothing changes.
 */
export function updateHarbormaster(state: GameState): GameState {
  const vertices = harborVertices(state);
  const counts = new Map<Seat, number>(
    state.players.map((p) => [p.seat, harborPoints(state, p.seat, vertices)])
  );
  const maxPoints = Math.max(0, ...counts.values());
  const current = state.ext?.harbormaster ?? { holder: null, points: 0 };

  const holderPoints = current.holder !== null ? (counts.get(current.holder) ?? 0) : 0;

  let holder: Seat | null;
  let points: number;

  if (current.holder !== null && maxPoints <= holderPoints) {
    // Ties (and a holder whose own tally just grew) keep the incumbent.
    holder = current.holder;
    points = holderPoints;
  } else if (maxPoints >= CLAIM_THRESHOLD) {
    // Either unclaimed so far, or a challenger's tally strictly exceeds the holder's — but claiming
    // and stealing both require a SOLE leader at the new max.
    const leaders = [...counts.entries()].filter(([, c]) => c === maxPoints);
    if (leaders.length === 1) {
      holder = leaders[0]![0];
      points = maxPoints;
    } else {
      holder = current.holder;
      points = holderPoints;
    }
  } else {
    holder = null;
    points = 0;
  }

  if (holder === current.holder && points === current.points) return state;
  return { ...state, ext: { ...state.ext, harbormaster: { holder, points } } };
}

/** The harbormaster ext block, or `undefined` when the modifier is inactive (mirrors
 *  `citiesKnightsExt`, modules/citiesKnights/state.ts). */
export function harbormasterExt(state: GameState): { holder: Seat | null; points: number } | undefined {
  return state.ext?.harbormaster;
}

export const harbormasterModule: RuleModule = {
  id: 'harbormaster',
  phaseHooks: {
    afterAction(_prev, next, _action, events) {
      const updated = updateHarbormaster(next);
      if (updated === next) return null;
      const award = updated.ext!.harbormaster!;
      return {
        state: updated,
        events: [...events, awardMoved('harbormaster', award.holder, award.points)],
      };
    },
  },
};
