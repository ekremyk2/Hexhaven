// Maritime trade: harbor lookups & the bank trade rate (R8.2, R1.3). A player benefits from a
// harbor if they have a settlement/city on EITHER endpoint of that harbor's edge — proximity to
// the coastal hex itself is irrelevant.

import type { EdgeId, GameState, HarborType, ResourceType, Seat, VertexId } from '@hexhaven/shared';
import { geometryForState } from '../modules/index.js';

function ownsBuildingAt(state: GameState, seat: Seat, vertex: VertexId): boolean {
  const p = state.players[seat];
  return !!p && (p.settlements.includes(vertex) || p.cities.includes(vertex));
}

/**
 * Every harbor type the seat currently benefits from (R1.3), deduped. Feeds `tradeRate` below
 * and the trade dialog's harbor badges (T-404).
 */
export function playerHarbors(state: GameState, seat: Seat): HarborType[] {
  const found = new Set<HarborType>();
  const geometry = geometryForState(state);
  // `Object.keys` (not `Object.entries`) because `board.harbors` is keyed by the branded numeric
  // EdgeId — the same pattern boardGen.test.ts/createGame.test.ts use to walk it.
  for (const key of Object.keys(state.board.harbors)) {
    const edgeId = Number(key) as EdgeId;
    // noUncheckedIndexedAccess forces these checks even though `edgeId` always round-trips back
    // to a key that exists in this same `board.harbors` object.
    const type = state.board.harbors[edgeId];
    const edge = geometry.edges[edgeId];
    if (type === undefined || !edge) continue;
    if (ownsBuildingAt(state, seat, edge.a) || ownsBuildingAt(state, seat, edge.b)) {
      found.add(type);
    }
  }
  return [...found];
}

/**
 * R8.2 maritime trade rate for giving `give`: 2:1 with that resource's own harbor, else 3:1 with
 * any generic harbor, else the base 4:1 (no harbor needed).
 */
export function tradeRate(state: GameState, seat: Seat, give: ResourceType): 2 | 3 | 4 {
  const harbors = playerHarbors(state, seat);
  if (harbors.includes(give)) return 2;
  if (harbors.includes('generic')) return 3;
  return 4;
}
