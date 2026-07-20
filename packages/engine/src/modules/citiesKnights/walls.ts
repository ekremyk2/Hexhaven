// Cities & Knights city walls (T-804 minimal engine support, docs/rules/cities-knights-rules.md
// C9). Full wall RENDERING is T-805 — this is just enough engine-side STATE + a build action so
// the `buildCityWall` action and the Engineer progress card (C6.5) have something to mutate.
// Deliberately does NOT touch the base discard hand-limit (C9.2's "+2 per wall" is a separate,
// not-yet-wired concern — see the T-804 report) so `phases/roll.ts`'s `DISCARD_THRESHOLD` stays
// untouched (owned by another task; RK-13/other-module bit-identity unaffected).

import { CK_MAX_WALLS } from '@hexhaven/shared';
import type { EngineErrorCode, GameState, Seat, VertexId } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { cityWallBuilt } from '../../events.js';
import { resolveConstants } from '../index.js';
import { canAfford, payToBank } from '../../rules/afford.js';
import { citiesKnightsExt } from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

const WALL_COST = { brick: 2 } as const;

/** The per-player city-wall cap in effect for `state` (T-906, docs/07 D-034
 *  `customConstants.maxCityWalls`) — the base `CK_MAX_WALLS` (3) unless overridden (`Infinity` for
 *  a limitless config). Absent ⇒ `CK_MAX_WALLS` unchanged (RK-13). */
function resolvedMaxWalls(state: GameState): number {
  return resolveConstants(state.config).maxCityWalls ?? CK_MAX_WALLS;
}

/** Client legal-target enumerator (T-806, mirrors `knights.ts`'s precedent): `seat`'s own cities
 *  that don't already carry a wall, or `[]` once `seat` is at the wall cap (mirrors
 *  `legalCityVertices`'s empty-when-out-of-pieces guard; affordability is a separate concern for
 *  the caller's button state). */
export function wallEligibleCities(state: GameState, seat: Seat): VertexId[] {
  const ck = citiesKnightsExt(state);
  if (!ck || state.phase.kind !== 'main') return [];
  const walls = ck.walls[seat] ?? [];
  if (walls.length >= resolvedMaxWalls(state)) return [];
  const player = state.players[seat];
  if (!player) return [];
  return player.cities.filter((v) => !walls.includes(v));
}

/**
 * C9.1: build a wall under one of the seat's own cities (never a settlement), 1 per city, up to
 * the resolved wall cap (T-906 `customConstants.maxCityWalls`, base `CK_MAX_WALLS`). Costs 2 brick
 * unless `free` (Engineer, C6.5).
 */
export function buildCityWall(state: GameState, seat: Seat, vertex: VertexId, free = false): EngineResult {
  const ck = citiesKnightsExt(state);
  if (!ck) return fail('WRONG_PHASE', 'buildCityWall is only legal in a Cities & Knights game');

  const player = state.players[seat]!;
  if (!player.cities.includes(vertex)) {
    return fail('BAD_LOCATION', `a city wall must be built under one of seat ${seat}'s own cities (C9.1)`);
  }
  const walls = ck.walls[seat] ?? [];
  if (walls.includes(vertex)) return fail('WALL_ALREADY_BUILT', `vertex ${vertex} already has a wall (C9.1)`);
  const maxWalls = resolvedMaxWalls(state);
  if (walls.length >= maxWalls) {
    return fail('WALL_CAP', `seat ${seat} already has ${maxWalls} city walls (C9.1)`);
  }

  if (!free && !canAfford(player, WALL_COST)) {
    return fail('CANT_AFFORD', 'a city wall costs 2 brick (C9.1)');
  }
  const paid = free ? { players: state.players, bank: state.bank } : payToBank(state, seat, WALL_COST);

  const nextWalls = ck.walls.map((w, i) => (i === seat ? [...w, vertex] : w));
  return {
    ok: true,
    state: {
      ...state,
      players: paid.players,
      bank: paid.bank,
      ext: { ...state.ext, citiesKnights: { ...ck, walls: nextWalls } },
    },
    events: [cityWallBuilt(seat, vertex)],
  };
}
