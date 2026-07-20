// Longest Road (R11) / Longest Trade Route (Seafarers S6): the longest TRAIL in a seat's network of
// roads (base) or roads ∪ ships (Seafarers), and the award-holder recompute (R11.2 ties keep the
// current holder; R11.3 breaking & set-aside). T-110; generalized to ships in T-702.
//
// The trail search was written over an ABSTRACT typed edge set on purpose (docs/10 §5, ER-S3): in a
// seafarers game the edge set is roads ∪ ships and traversal THROUGH a vertex is allowed only if
// either both incident edges share a type (road-road or ship-ship) OR the vertex holds that player's
// settlement/city (the junction rule S5.2). In a base game a seat's edges are all roads, so the
// type-junction guard is never taken and the search is bit-identical to the pre-Seafarers code (RK-13).

import type { EdgeId, GameState, Seat, VertexId } from '@hexhaven/shared';
import { geometryForState } from '../modules/index.js';
import { shipsOf } from '../modules/seafarers/state.js';
import { bridgesOf, isCamelEdge } from '../modules/tradersBarbarians/state.js';

type EdgeKind = 'road' | 'ship';

/** True iff some OTHER seat holds a settlement/city on `v` (R11.3: own buildings never block). */
function blockedForSeat(state: GameState, seat: Seat, v: VertexId): boolean {
  return state.players.some(
    (p) => p.seat !== seat && (p.settlements.includes(v) || p.cities.includes(v))
  );
}

/** True iff `seat` holds a settlement/city on `v` (a road↔ship junction, S5.2). */
function ownBuildingOn(state: GameState, seat: Seat, v: VertexId): boolean {
  const p = state.players[seat];
  return !!p && (p.settlements.includes(v) || p.cities.includes(v));
}

/** The seat's trail edges: roads always; ships too in a seafarers game (`shipsOf` is [] otherwise);
 *  bridges too in a rivers game (`bridgesOf` is [] otherwise, T-1003, §TB3.2). Bridges are tagged
 *  `'road'` (not a third kind) — they "count as part of the road network" (§TB3.2), joining roads
 *  seamlessly with NO junction restriction, unlike the road<->ship type switch (S5.2). `weight` is 2
 *  for a road/bridge carrying a camel in a caravans game (`isCamelEdge` is always `false` outside
 *  one, T-1004, §TB4.3 "counts double for Longest Road") and 1 otherwise — the DFS below sums
 *  `weight` instead of a flat +1 per edge traversed. */
function seatTrailEdges(state: GameState, seat: Seat): { id: EdgeId; kind: EdgeKind; weight: number }[] {
  const player = state.players[seat];
  if (!player) return [];
  const out: { id: EdgeId; kind: EdgeKind; weight: number }[] = [...player.roads, ...bridgesOf(state, seat)].map(
    (id) => ({ id, kind: 'road', weight: isCamelEdge(state, id) ? 2 : 1 })
  );
  for (const id of shipsOf(state, seat)) out.push({ id, kind: 'ship', weight: 1 }); // camels never sit on ships
  return out;
}

/**
 * R11.1 / S6.2: the longest trail in `seat`'s network — each edge used at most once, intersections
 * (vertices) MAY repeat (loops are legal: a closed hexagon of 6 counts as 6, FAQ #22). R11.3: a
 * trail may not continue THROUGH a vertex holding an opponent's settlement/city — it may still END
 * there. ER-S3: it may not continue through a vertex that switches edge type (road↔ship) unless the
 * seat's own settlement/city sits there. A seat's own buildings never block.
 *
 * Implementation: DFS over an edge-used set, started from every vertex touched by the seat's edges.
 * With ≤15 roads + ≤15 ships per player and a board of max vertex degree 3 (docs/03 §1.3), the
 * search tree is small — no memoization is attempted (correctness over cleverness).
 *
 * Name kept as `longestRoadLength` (its many call sites): in a seafarers game it IS the Longest
 * Trade Route length; in a base game it is exactly the Longest Road length as before.
 */
export function longestRoadLength(state: GameState, seat: Seat): number {
  const trailEdges = seatTrailEdges(state, seat);
  if (trailEdges.length === 0) return 0;

  // Adjacency restricted to the seat's own edges: vertex -> [{edge, to, kind, weight}, ...].
  const adjacency = new Map<VertexId, { edge: EdgeId; to: VertexId; kind: EdgeKind; weight: number }[]>();
  const link = (from: VertexId, edge: EdgeId, to: VertexId, kind: EdgeKind, weight: number): void => {
    const list = adjacency.get(from);
    if (list) list.push({ edge, to, kind, weight });
    else adjacency.set(from, [{ edge, to, kind, weight }]);
  };
  const geometry = geometryForState(state);
  for (const { id, kind, weight } of trailEdges) {
    const e = geometry.edges[id];
    if (!e) throw new Error(`BUG: seat ${seat} has a ${kind} on unknown edge ${id}`);
    link(e.a, id, e.b, kind, weight);
    link(e.b, id, e.a, kind, weight);
  }

  let best = 0;
  const usedEdges = new Set<EdgeId>();

  // `inKind` is the type of the edge we ARRIVED on (null at a chosen start vertex). Starting AT a
  // blocked/junction vertex and heading outward is legal (you're choosing an endpoint); the two
  // continuation rules below apply only when passing THROUGH a vertex mid-trail.
  function dfs(vertex: VertexId, inKind: EdgeKind | null, length: number): void {
    if (length > best) best = length;
    if (inKind !== null && blockedForSeat(state, seat, vertex)) return; // R11.3: can't pass an enemy
    const junction = ownBuildingOn(state, seat, vertex); // road↔ship may switch here (S5.2)
    for (const { edge, to, kind, weight } of adjacency.get(vertex) ?? []) {
      if (usedEdges.has(edge)) continue;
      // ER-S3: road and ship do not connect except through the seat's own building.
      if (inKind !== null && inKind !== kind && !junction) continue;
      usedEdges.add(edge);
      dfs(to, kind, length + weight);
      usedEdges.delete(edge);
    }
  }

  for (const startVertex of adjacency.keys()) dfs(startVertex, null, 0);
  return best;
}

/**
 * R11.2–R11.3 recompute: run this after every road/settlement placement (main.ts / T-109 call
 * `updateAwards`, which composes this — see rules/awards.ts). Returns a NEW state with
 * `awards.longestRoad` set correctly, or the SAME reference when nothing changes.
 *
 * The key distinction the two sub-rules turn on is whether the CURRENT HOLDER's own road length
 * changed this recompute:
 *  - Unchanged (a challenger simply grew, R11.2): the holder keeps the card unless someone
 *    STRICTLY exceeds them — a tie never dislodges an incumbent.
 *  - Changed — either there is no holder yet, the holder just extended their own lead further,
 *    or (the tricky case, R11.3) an opponent's settlement just broke the holder's road: a full,
 *    from-scratch re-evaluation applies, and ONLY a sole leader at length ≥5 claims/keeps the
 *    card. If the recompute lands on zero qualifiers or a multi-way tie at the top — even one
 *    that includes the just-broken former holder — the card is **set aside** (`holder: null`)
 *    until a single player again solely holds a 5+ road. This is why a break that leaves the
 *    ex-holder tied at the new max (e.g. 6 → broken down to 5, matching another player's
 *    existing 5) still sets the card aside rather than letting them keep it: R11.2's "ties keep
 *    the holder" is about a static holder facing a growing challenger, not a holder whose own
 *    road just shrank into a tie.
 */
export function updateLongestRoad(state: GameState): GameState {
  const lengths = new Map<Seat, number>(
    state.players.map((p) => [p.seat, longestRoadLength(state, p.seat)])
  );
  const maxLen = Math.max(0, ...lengths.values());
  const current = state.awards.longestRoad;

  const holderFreshLen = current.holder !== null ? (lengths.get(current.holder) ?? 0) : null;
  const holderUnchanged = current.holder !== null && holderFreshLen === current.length;
  const challengerBeatsHolder = holderUnchanged && maxLen > current.length;

  let holder: Seat | null;
  let length: number;

  if (holderUnchanged && !challengerBeatsHolder) {
    // R11.2: the holder's own road is untouched and nobody strictly exceeds it (ties included).
    holder = current.holder;
    length = current.length;
  } else if (maxLen >= 5) {
    // R11.1/R11.3: full re-evaluation. Only a SOLE leader at the new max claims/keeps the card.
    const leaders = [...lengths.entries()].filter(([, len]) => len === maxLen);
    if (leaders.length === 1) {
      holder = leaders[0]![0];
      length = maxLen;
    } else {
      holder = null; // several tie for longest — set aside (R11.3)
      length = 0;
    }
  } else {
    holder = null; // nobody has reached 5
    length = 0;
  }

  if (holder === current.holder && length === current.length) return state;
  return { ...state, awards: { ...state.awards, longestRoad: { holder, length } } };
}
