// Independent cross-check for rules/longestRoad.ts's `longestRoadLength` (R11.1/R11.3). Used by
// T-112's I6 invariant check to catch a bug either implementation might share if they were built
// the same way. T-110.
//
// Deliberately a DIFFERENT algorithm/shape than `longestRoadLength`:
//  - `longestRoadLength` builds a vertex adjacency Map once, then DFS's forward-only from every
//    vertex touched by the seat's roads (single-ended growth, many start points).
//  - This file never builds an adjacency map: it keeps the seat's roads as a flat array and, for
//    every seed edge, grows a path from BOTH ends by linearly re-scanning the whole array for an
//    attachable edge at each step (two-ended growth, one start point per seed edge). It also
//    re-derives the R11.3 blocking predicate independently rather than importing the one in
//    longestRoad.ts, so a bug in that predicate can't hide from the cross-check.
//
// Complexity: with ≤15 roads (PIECES_PER_PLAYER.roads) and a board of max vertex degree 3
// (docs/03 §1.3), real branching per step is tiny (≤2, since one incident edge is the one just
// arrived on) — exponential-looking recursion but bounded to a few thousand nodes worst case.

import type { GameState, Seat, VertexId } from '@hexhaven/shared';
import { geometryForState } from '../modules/index.js';

/** True iff some OTHER seat holds a settlement/city on `v` — re-derived, not imported, on purpose. */
function isOpponentBuilding(state: GameState, seat: Seat, v: VertexId): boolean {
  for (const p of state.players) {
    if (p.seat === seat) continue;
    if (p.settlements.includes(v) || p.cities.includes(v)) return true;
  }
  return false;
}

/**
 * Brute-force longest trail in `seat`'s road subgraph — same rules as `longestRoadLength`
 * (R11.1: each edge used at most once, vertices may repeat/loop; R11.3: may not continue THROUGH
 * an opponent-owned vertex, may still end there), computed by a structurally different search.
 */
export function longestRoadBruteForce(state: GameState, seat: Seat): number {
  const player = state.players[seat];
  if (!player || player.roads.length === 0) return 0;

  const n = player.roads.length;
  if (n > 15) {
    // Defensive: PIECES_PER_PLAYER.roads caps every seat at 15; this search is only sized for that.
    throw new Error(`BUG: brute-force longest road is capped at 15 edges, got ${n}`);
  }

  const geometry = geometryForState(state);
  const edges = player.roads.map((edgeId) => {
    const e = geometry.edges[edgeId];
    if (!e) throw new Error(`BUG: seat ${seat} has a road on unknown edge ${edgeId}`);
    return { a: e.a, b: e.b };
  });

  const used = new Array<boolean>(n).fill(false);
  let best = 0;

  // Grows a path with two open ends (`front`, `back`) by re-scanning the full edge array at every
  // step — no adjacency structure — for any unused edge attachable at either end. Passing THROUGH
  // an end is only blocked once we try to extend past it (matches R11.3: ending there is fine).
  function grow(front: VertexId, back: VertexId, length: number): void {
    if (length > best) best = length;
    const frontOpen = !isOpponentBuilding(state, seat, front);
    const backOpen = !isOpponentBuilding(state, seat, back);
    if (!frontOpen && !backOpen) return;

    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const e = edges[i]!;
      if (frontOpen && (e.a === front || e.b === front)) {
        const newFront = e.a === front ? e.b : e.a;
        used[i] = true;
        grow(newFront, back, length + 1);
        used[i] = false;
      }
      if (backOpen && (e.a === back || e.b === back)) {
        const newBack = e.a === back ? e.b : e.a;
        used[i] = true;
        grow(front, newBack, length + 1);
        used[i] = false;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const e = edges[i]!;
    used[i] = true;
    grow(e.a, e.b, 1);
    used[i] = false;
  }

  return best;
}
