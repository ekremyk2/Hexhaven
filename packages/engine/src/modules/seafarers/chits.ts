// Seafarers small-island victory-point chits (T-703, docs/rules/seafarers-rules.md §S10.6). The FIRST
// time a player builds a settlement on a given small island, they earn `scenario.smallIslandVp` (2)
// bonus VP for that island — once per distinct island, regardless of who else has settled it. The
// earned island ids are tracked under `state.ext.seafarers.islandChits[seat]` and surfaced in the VP
// breakdown (public — the chits sit on the board).
//
// Wired through the seafarers module's `afterAction` hook (index.ts): after any settlement placement
// it checks whether the vertex sits on a not-yet-earned small island and, if so, records the chit and
// emits an `islandSettled` event.
//
// T-754 ("The Forgotten Tribe"): a scenario may define an OPTIONAL `islandRewards` table (island id ->
// VP) that REPLACES the flat `smallIslandVp` for islands present in it — `islandRewardVp` resolves the
// per-island amount (falling back to `smallIslandVp` for any island the table doesn't cover). Reuses
// the existing `islandSettled` event with the resolved amount; NO new event/action/phase/error code.
// Every scenario without `islandRewards` (Heading for New Shores/New World/Through the Desert) resolves
// to exactly `scenario.smallIslandVp` here, so this is byte-for-byte unchanged for them.

import type { GameEvent, GameState, Scenario, Seat, VertexId } from '@hexhaven/shared';
import { islandSettled } from '../../events.js';
import { geometryForState } from '../index.js';
import { islandOfHex, scenarioFor } from './board.js';
import { islandChitsOf } from './state.js';

/**
 * The small-island group id vertex `v` sits on (S10.6), or `null` for a main-island / open-ocean
 * vertex or a base game. A small island's hexes never share a vertex with another island (they are
 * separated by sea), so a vertex maps to at most one island — the first small-island hex it touches.
 */
export function islandOfVertex(state: GameState, v: VertexId): number | null {
  const vert = geometryForState(state).vertices[v];
  if (!vert) return null;
  for (const h of vert.hexes) {
    const island = islandOfHex(state.config, h);
    if (island !== null) return island;
  }
  return null;
}

/** The VP a scenario grants for the FIRST settlement on `island`: `scenario.islandRewards[island]`
 *  when the scenario defines that table and lists `island`, else the flat `scenario.smallIslandVp`
 *  (T-754). Every scenario without `islandRewards` resolves here to exactly `smallIslandVp`. */
export function islandRewardVp(scenario: Scenario, island: number): number {
  return scenario.islandRewards?.[island] ?? scenario.smallIslandVp;
}

/** S10.6 bonus VP for `seat`: the sum of each earned small island's reward (T-754's per-island table
 *  when the scenario defines one; otherwise `smallIslandVp` per distinct earned island, unchanged).
 *  0 for a base game. */
export function islandChitVp(state: GameState, seat: Seat): number {
  const scenario = scenarioFor(state.config);
  if (!scenario) return 0;
  return islandChitsOf(state, seat).reduce((sum, island) => sum + islandRewardVp(scenario, island), 0);
}

/**
 * If `seat`'s newly-placed settlement at `vertex` sits on a small island they have not settled before,
 * record the chit under `ext.seafarers.islandChits` and return the updated state + an `islandSettled`
 * event. Returns `null` when there is nothing to grant (main-island vertex, already-earned island, or
 * a base game). Idempotent per island: a second settlement on the same island grants nothing.
 */
export function grantIslandChit(
  state: GameState,
  seat: Seat,
  vertex: VertexId
): { state: GameState; events: GameEvent[] } | null {
  const ext = state.ext?.seafarers;
  const scenario = scenarioFor(state.config);
  if (!ext || !scenario) return null;
  const island = islandOfVertex(state, vertex);
  if (island === null) return null;
  if (ext.islandChits[seat]?.includes(island)) return null; // already earned (S10.6: once per island)

  const islandChits = ext.islandChits.map((list, s) => (s === seat ? [...list, island] : list));
  const next: GameState = { ...state, ext: { ...state.ext, seafarers: { ...ext, islandChits } } };
  return { state: next, events: [islandSettled(seat, island, islandRewardVp(scenario, island))] };
}
