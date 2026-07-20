// Cities & Knights knights (T-803, docs/rules/cities-knights-rules.md C7) + the robber-lock-gated
// knight "chase the robber" action (C7.4/C10.2). Mirrors the base build-piece handlers (phases/
// main.ts) for cost/afford plumbing, and phases/robber.ts's steal pipeline for chaseRobber.

import { CK_KNIGHT_CAP } from '@hexhaven/shared';
import type { EngineErrorCode, GameEvent, GameState, HexId, Knight, KnightLevel, Seat, VertexId } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { knightActivated, knightBuilt, knightDisplaced, knightMoved, knightPromoted, robberMoved } from '../../events.js';
import { geometryForState, resolveConstants } from '../index.js';
import { resolveSteal, stealCandidatesForHex } from '../../phases/robber.js';
import { canAfford, payToBank } from '../../rules/afford.js';
import { ownRoadAt } from '../../rules/connectivity.js';
import { isVertexOccupied } from '../../rules/placement.js';
import { citiesKnightsExt } from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/** The per-LEVEL knight cap in effect for `state` (T-906, docs/07 D-034
 *  `customConstants.maxKnightsPerLevel`) — the base `CK_KNIGHT_CAP[level]` (2 for every level)
 *  unless overridden uniformly across all three levels (`Infinity` for a limitless config). Absent
 *  ⇒ `CK_KNIGHT_CAP[level]` unchanged (RK-13). */
function resolvedKnightCap(state: GameState, level: KnightLevel): number {
  return resolveConstants(state.config).maxKnightsPerLevel ?? CK_KNIGHT_CAP[level];
}

/** C7.2 costs (to the bank) — not in the base `COSTS` table (that's resource-only pieces). */
const KNIGHT_BUILD_COST = { wool: 1, ore: 1 } as const;
const KNIGHT_ACTIVATE_COST = { grain: 1 } as const;
const KNIGHT_PROMOTE_COST = { wool: 1, ore: 1 } as const;

/** Exported for T-804's progress-card effects (Deserter/Intrigue) that need to locate/check knights
 *  by vertex without duplicating this lookup. */
export function findKnight(
  ck: NonNullable<ReturnType<typeof citiesKnightsExt>>,
  seat: Seat,
  vertex: VertexId
): Knight | undefined {
  return ck.knights[seat]?.find((k) => k.vertex === vertex);
}

export function anyKnightAt(ck: NonNullable<ReturnType<typeof citiesKnightsExt>>, vertex: VertexId): boolean {
  return ck.knights.some((list) => list.some((k) => k.vertex === vertex));
}

/** An opponent (not `seat`) holds a settlement/city on `vertex`. Local re-implementation of
 *  connectivity.ts's private `opponentBuildingOn` (not exported there). */
function opponentBuildingAt(state: GameState, seat: Seat, vertex: VertexId): boolean {
  return state.players.some((p) => p.seat !== seat && (p.settlements.includes(vertex) || p.cities.includes(vertex)));
}

/**
 * C7.1/C7.4: every vertex reachable from `from` by walking the seat's OWN road edges, any number of
 * hops (distance rule N/A) — "may pass through intersections holding your own pieces" (C7.4), but
 * an opponent's settlement/city blocks passage through (and landing on) that vertex, mirroring
 * `rules/connectivity.ts`'s road-connectivity rule. `from` itself is never included in the result.
 */
function reachableVertices(state: GameState, seat: Seat, from: VertexId): Set<VertexId> {
  const geometry = geometryForState(state);
  const player = state.players[seat];
  const roadSet = new Set(player?.roads ?? []);
  const seen = new Set<VertexId>([from]);
  const reachable = new Set<VertexId>();
  const queue: VertexId[] = [from];

  while (queue.length > 0) {
    const v = queue.shift()!;
    const vert = geometry.vertices[v];
    if (!vert) continue;
    for (let i = 0; i < vert.edges.length; i++) {
      const edge = vert.edges[i]!;
      if (!roadSet.has(edge)) continue;
      const n = vert.neighbors[i]!;
      if (seen.has(n)) continue;
      seen.add(n);
      if (opponentBuildingAt(state, seat, n)) continue; // blocked pass-through/landing
      reachable.add(n);
      queue.push(n);
    }
  }
  return reachable;
}

/**
 * C7.1/C7.2: build a basic (level 1) knight, inactive, at a vertex connected to the seat's OWN road
 * network (distance rule does NOT apply — a knight may sit right next to another building). Unlike
 * `moveKnight`'s transitive `reachableVertices`, C7.1's connectivity for a fresh placement mirrors
 * settlement-style single-touch connectivity (the vertex simply touches one of the seat's roads) —
 * documented simplification consistent with how buildSettlement checks connectivity (rules/
 * connectivity.ts's `ownRoadAt`), since there is no existing knight to walk a path FROM yet.
 * One knight per vertex (C7.1); an opponent's building on the vertex blocks placement.
 */
export function buildKnight(state: GameState, seat: Seat, vertex: VertexId): EngineResult {
  const ck = citiesKnightsExt(state);
  if (!ck) return fail('WRONG_PHASE', 'buildKnight is only legal in a Cities & Knights game');

  const geometry = geometryForState(state);
  if (!geometry.vertices[vertex]) return fail('BAD_LOCATION', `vertex ${vertex} is off the board`);
  if (anyKnightAt(ck, vertex)) return fail('OCCUPIED', `vertex ${vertex} already holds a knight (C7.1)`);
  if (opponentBuildingAt(state, seat, vertex)) {
    return fail('BAD_LOCATION', `vertex ${vertex} holds an opponent's building`);
  }
  if (!ownRoadAt(state, seat, vertex)) {
    return fail('NOT_CONNECTED', `vertex ${vertex} is not connected to seat ${seat}'s road network (C7.1)`);
  }

  const basicCap = resolvedKnightCap(state, 1);
  const basicCount = (ck.knights[seat] ?? []).filter((k) => k.level === 1).length;
  if (basicCount >= basicCap) {
    return fail('KNIGHT_CAP', `seat ${seat} already has ${basicCap} basic knights on the board (C7.1)`);
  }

  const player = state.players[seat]!;
  if (!canAfford(player, KNIGHT_BUILD_COST)) {
    return fail('CANT_AFFORD', 'building a knight costs 1 wool + 1 ore (C7.2)');
  }

  const { players, bank } = payToBank(state, seat, KNIGHT_BUILD_COST);
  const knight: Knight = { vertex, level: 1, active: false };
  const knights = ck.knights.map((list, i) => (i === seat ? [...list, knight] : list));

  return {
    ok: true,
    state: { ...state, players, bank, ext: { ...state.ext, citiesKnights: { ...ck, knights } } },
    events: [knightBuilt(seat, vertex, 1)],
  };
}

/**
 * C7.2: flip an inactive knight to active for 1 grain. `free` (T-804, Warlord C6.5: "activate all
 * your knights free") skips the cost/afford check entirely — same validation otherwise.
 */
export function activateKnight(state: GameState, seat: Seat, vertex: VertexId, free = false): EngineResult {
  const ck = citiesKnightsExt(state);
  if (!ck) return fail('WRONG_PHASE', 'activateKnight is only legal in a Cities & Knights game');

  const knight = findKnight(ck, seat, vertex);
  if (!knight) return fail('KNIGHT_NOT_FOUND', `seat ${seat} has no knight at vertex ${vertex}`);
  if (knight.active) return fail('KNIGHT_ALREADY_ACTIVE', `the knight at vertex ${vertex} is already active`);

  const player = state.players[seat]!;
  if (!free && !canAfford(player, KNIGHT_ACTIVATE_COST)) {
    return fail('CANT_AFFORD', 'activating a knight costs 1 grain (C7.2)');
  }

  const paid = free ? { players: state.players, bank: state.bank } : payToBank(state, seat, KNIGHT_ACTIVATE_COST);
  const knights = ck.knights.map((list, i) =>
    i === seat ? list.map((k) => (k.vertex === vertex ? { ...k, active: true } : k)) : list
  );

  return {
    ok: true,
    state: { ...state, players: paid.players, bank: paid.bank, ext: { ...state.ext, citiesKnights: { ...ck, knights } } },
    events: [knightActivated(seat, vertex)],
  };
}

/**
 * C7.2/C7.3: promote a knight one level for 1 wool + 1 ore. basic->strong is always legal; strong-
 * >mighty requires Politics-L3 Fortress (C4.5). Legal regardless of active/inactive (C7.3: "may be
 * built, promoted, and activated across turns"). `free` (T-804, Smith C6.5: "promote up to 2 of
 * your knights one level free") skips the cost/afford check — the Fortress/cap gates still apply.
 */
export function promoteKnight(state: GameState, seat: Seat, vertex: VertexId, free = false): EngineResult {
  const ck = citiesKnightsExt(state);
  if (!ck) return fail('WRONG_PHASE', 'promoteKnight is only legal in a Cities & Knights game');

  const knight = findKnight(ck, seat, vertex);
  if (!knight) return fail('KNIGHT_NOT_FOUND', `seat ${seat} has no knight at vertex ${vertex}`);
  if (knight.level >= 3) return fail('KNIGHT_MAX_LEVEL', 'a mighty knight cannot be promoted further (C7.1)');

  const nextLevel = (knight.level + 1) as KnightLevel;
  if (nextLevel === 3 && (ck.improvements[seat]?.politics ?? 0) < 3) {
    return fail('FORTRESS_REQUIRED', 'strong->mighty requires Politics-L3 Fortress (C4.5/C7.3)');
  }

  const nextCap = resolvedKnightCap(state, nextLevel);
  const countAtNext = (ck.knights[seat] ?? []).filter((k) => k.level === nextLevel).length;
  if (countAtNext >= nextCap) {
    return fail('KNIGHT_CAP', `seat ${seat} already has ${nextCap} knights at level ${nextLevel} (C7.1)`);
  }

  const player = state.players[seat]!;
  if (!free && !canAfford(player, KNIGHT_PROMOTE_COST)) {
    return fail('CANT_AFFORD', 'promoting a knight costs 1 wool + 1 ore (C7.2)');
  }

  const paid = free ? { players: state.players, bank: state.bank } : payToBank(state, seat, KNIGHT_PROMOTE_COST);
  const knights = ck.knights.map((list, i) =>
    i === seat ? list.map((k) => (k.vertex === vertex ? { ...k, level: nextLevel } : k)) : list
  );

  return {
    ok: true,
    state: { ...state, players: paid.players, bank: paid.bank, ext: { ...state.ext, citiesKnights: { ...ck, knights } } },
    events: [knightPromoted(seat, vertex, nextLevel)],
  };
}

/** C7.4: move an ACTIVE knight to another vertex reachable over the seat's own road network (may
 *  pass through the seat's own pieces); deactivates the knight. The target must hold no knight. */
export function moveKnight(state: GameState, seat: Seat, from: VertexId, to: VertexId): EngineResult {
  const ck = citiesKnightsExt(state);
  if (!ck) return fail('WRONG_PHASE', 'moveKnight is only legal in a Cities & Knights game');

  const knight = findKnight(ck, seat, from);
  if (!knight) return fail('KNIGHT_NOT_FOUND', `seat ${seat} has no knight at vertex ${from}`);
  if (!knight.active) return fail('KNIGHT_INACTIVE', `the knight at vertex ${from} is not active (C7.4)`);
  if (anyKnightAt(ck, to)) return fail('OCCUPIED', `vertex ${to} already holds a knight`);
  if (opponentBuildingAt(state, seat, to)) return fail('BAD_LOCATION', `vertex ${to} holds an opponent's building`);
  if (!reachableVertices(state, seat, from).has(to)) {
    return fail('NOT_CONNECTED', `vertex ${to} is not reachable from ${from} over seat ${seat}'s roads (C7.4)`);
  }

  const knights = ck.knights.map((list, i) =>
    i === seat ? list.map((k) => (k.vertex === from ? { ...k, vertex: to, active: false } : k)) : list
  );

  return {
    ok: true,
    state: { ...state, ext: { ...state.ext, citiesKnights: { ...ck, knights } } },
    events: [knightMoved(seat, from, to)],
  };
}

/**
 * C7.4: an ACTIVE knight displaces a strictly weaker opponent knight sitting on a vertex reachable
 * over the seat's own road network. The displaced knight relocates to an adjacent vertex that is
 * empty, unoccupied by any knight, and connected to ITS OWNER's own road network — the lowest
 * VertexId among such candidates, deterministically (the official rule leaves the choice to that
 * knight's owner; auto-picked here per the task's "model minimally/auto" allowance) — or is removed
 * if no such vertex exists (C7.4). The mover deactivates; the displaced knight's active flag is
 * untouched (it didn't act).
 */
export function knightDisplace(state: GameState, seat: Seat, from: VertexId, to: VertexId): EngineResult {
  const ck = citiesKnightsExt(state);
  if (!ck) return fail('WRONG_PHASE', 'knightDisplace is only legal in a Cities & Knights game');

  const knight = findKnight(ck, seat, from);
  if (!knight) return fail('KNIGHT_NOT_FOUND', `seat ${seat} has no knight at vertex ${from}`);
  if (!knight.active) return fail('KNIGHT_INACTIVE', `the knight at vertex ${from} is not active (C7.4)`);
  if (!reachableVertices(state, seat, from).has(to)) {
    return fail('NOT_CONNECTED', `vertex ${to} is not reachable from ${from} over seat ${seat}'s roads (C7.4)`);
  }

  let targetSeat: Seat | undefined;
  let targetKnight: Knight | undefined;
  for (const p of state.players) {
    if (p.seat === seat) continue;
    const k = findKnight(ck, p.seat, to);
    if (k) {
      targetSeat = p.seat;
      targetKnight = k;
      break;
    }
  }
  if (targetKnight === undefined || targetSeat === undefined) {
    return fail('KNIGHT_NOT_FOUND', `vertex ${to} holds no opponent knight to displace`);
  }
  if (targetKnight.level >= knight.level) {
    return fail('NOT_STRONGER', 'displacement requires a strictly weaker opponent knight (C7.4)');
  }

  const geometry = geometryForState(state);
  const vert = geometry.vertices[to]!;
  const candidates = [...vert.neighbors]
    .filter((n) => !isVertexOccupied(state, n) && !anyKnightAt(ck, n) && ownRoadAt(state, targetSeat!, n))
    .sort((a, b) => a - b);
  const displacedTo = candidates[0] ?? null;

  const knights = ck.knights.map((list, i) => {
    if (i === seat) {
      return list.map((k) => (k.vertex === from ? { ...k, vertex: to, active: false } : k));
    }
    if (i === targetSeat) {
      return displacedTo !== null
        ? list.map((k) => (k.vertex === to ? { ...k, vertex: displacedTo } : k))
        : list.filter((k) => k.vertex !== to);
    }
    return list;
  });

  return {
    ok: true,
    state: { ...state, ext: { ...state.ext, citiesKnights: { ...ck, knights } } },
    events: [knightDisplaced(seat, from, to, targetSeat, displacedTo)],
  };
}

// ---------------------------------------------------------------------------------------------
// Client legal-target enumerators (T-806, mirrors legal.ts's `legalShipEdges`/`movableShips`
// precedent — including the B-28 lesson: only offer a SOURCE that has >=1 legal destination, so
// the UI never highlights a knight/vertex that would immediately dead-end). Pure lookups over
// public state (everything here rides `view.ext.citiesKnights`, which is fully public per
// redact.ts) — mirror each action handler's validation MINUS the cost/affordability check (that
// split matches `legalRoadEdges` vs `buildAffordability` elsewhere: piece-cap/occupancy/
// connectivity gates the target list, affordability is a separate concern for the caller's button
// state, e.g. `computeBuildKnightState`-style helpers in the client).
// ---------------------------------------------------------------------------------------------

/** C7.1: vertices where `seat` may build a NEW basic knight right now — connected to their own road
 *  network, unoccupied by any knight, not an opponent's building, and under the basic-knight cap
 *  (empty when at cap, mirroring `legalCityVertices`'s empty-when-out-of-pieces guard). */
export function legalKnightVertices(state: GameState, seat: Seat): VertexId[] {
  const ck = citiesKnightsExt(state);
  if (!ck || state.phase.kind !== 'main') return [];
  const basicCount = (ck.knights[seat] ?? []).filter((k) => k.level === 1).length;
  if (basicCount >= resolvedKnightCap(state, 1)) return [];
  return geometryForState(state)
    .vertices.filter(
      (v) => !anyKnightAt(ck, v.id) && !opponentBuildingAt(state, seat, v.id) && ownRoadAt(state, seat, v.id)
    )
    .map((v) => v.id);
}

/** C7.4: `seat`'s ACTIVE knights that have >=1 legal move destination right now (B-28 lesson: a
 *  knight with no legal destination is never offered as a movable source). */
export function movableKnights(state: GameState, seat: Seat): VertexId[] {
  const ck = citiesKnightsExt(state);
  if (!ck || state.phase.kind !== 'main') return [];
  return (ck.knights[seat] ?? [])
    .filter((k) => k.active && knightMoveTargets(state, seat, k.vertex).length > 0)
    .map((k) => k.vertex);
}

/** C7.4: legal `moveKnight` destinations from `from` — every vertex `reachableVertices` reaches
 *  (own road network, may pass through own pieces) that holds no knight. Empty if `from` doesn't
 *  hold `seat`'s own ACTIVE knight. */
export function knightMoveTargets(state: GameState, seat: Seat, from: VertexId): VertexId[] {
  const ck = citiesKnightsExt(state);
  if (!ck || state.phase.kind !== 'main') return [];
  const knight = findKnight(ck, seat, from);
  if (!knight || !knight.active) return [];
  return [...reachableVertices(state, seat, from)].filter((v) => !anyKnightAt(ck, v));
}

/** C7.4: `seat`'s ACTIVE knights that have >=1 legal displace target right now (same B-28-style
 *  guard as `movableKnights`). */
export function displaceableKnights(state: GameState, seat: Seat): VertexId[] {
  const ck = citiesKnightsExt(state);
  if (!ck || state.phase.kind !== 'main') return [];
  return (ck.knights[seat] ?? [])
    .filter((k) => k.active && knightDisplaceTargets(state, seat, k.vertex).length > 0)
    .map((k) => k.vertex);
}

/** C7.4: legal `knightDisplace` targets from `from` — road-reachable vertices holding a STRICTLY
 *  weaker opponent knight. Empty if `from` doesn't hold `seat`'s own ACTIVE knight. */
export function knightDisplaceTargets(state: GameState, seat: Seat, from: VertexId): VertexId[] {
  const ck = citiesKnightsExt(state);
  if (!ck || state.phase.kind !== 'main') return [];
  const knight = findKnight(ck, seat, from);
  if (!knight || !knight.active) return [];
  const reachable = reachableVertices(state, seat, from);
  const targets: VertexId[] = [];
  for (const v of reachable) {
    for (const p of state.players) {
      if (p.seat === seat) continue;
      const opponentKnight = findKnight(ck, p.seat, v);
      if (opponentKnight && opponentKnight.level < knight.level) {
        targets.push(v);
        break;
      }
    }
  }
  return targets;
}

/** Deserter (C6.5, T-806): vertices where `seat` may place their replacement knight — road-connected,
 *  empty of any knight, not an opponent's building. Unlike `legalKnightVertices` this does NOT gate
 *  on the basic-knight cap (Deserter places a knight of the removed knight's OWN level, so the
 *  per-level cap is the deserter handler's concern, checked there against the specific level). */
export function knightPlacementVertices(state: GameState, seat: Seat): VertexId[] {
  const ck = citiesKnightsExt(state);
  if (!ck) return [];
  return geometryForState(state)
    .vertices.filter(
      (v) => !anyKnightAt(ck, v.id) && !opponentBuildingAt(state, seat, v.id) && ownRoadAt(state, seat, v.id)
    )
    .map((v) => v.id);
}

/** Intrigue (C6.5, T-806): opponent-knight vertices sitting on `seat`'s own road network — the legal
 *  Intrigue displacement targets (the strength rule is ignored, C7.4, so any opponent knight on your
 *  road qualifies). Empty outside a C&K game. */
export function intrigueTargets(state: GameState, seat: Seat): VertexId[] {
  const ck = citiesKnightsExt(state);
  if (!ck) return [];
  const out: VertexId[] = [];
  for (const p of state.players) {
    if (p.seat === seat) continue;
    for (const k of ck.knights[p.seat] ?? []) {
      if (ownRoadAt(state, seat, k.vertex)) out.push(k.vertex);
    }
  }
  return out;
}

/** C7.4/C10.2: `seat`'s ACTIVE knights adjacent to the robber's current hex — the legal
 *  `chaseRobber` "mover" picks. Empty while the robber is still locked (C10.1). */
export function chaseRobberKnights(state: GameState, seat: Seat): VertexId[] {
  const ck = citiesKnightsExt(state);
  if (!ck || ck.robberLocked || state.phase.kind !== 'main') return [];
  const geometry = geometryForState(state);
  return (ck.knights[seat] ?? [])
    .filter((k) => k.active && geometry.vertices[k.vertex]?.hexes.includes(state.board.robber))
    .map((k) => k.vertex);
}

/** C7.4: legal `chaseRobber` destination hexes — every hex except the robber's current one (mirrors
 *  `legalRobberHexes`, but phase-agnostic since chaseRobber is a `main`-phase action, not a
 *  `moveRobber` sub-phase pick). Empty while the robber is locked or outside a C&K game. */
export function chaseRobberHexTargets(state: GameState): HexId[] {
  const ck = citiesKnightsExt(state);
  if (!ck || ck.robberLocked || state.phase.kind !== 'main') return [];
  return geometryForState(state)
    .hexes.map((h) => h.id)
    .filter((id) => id !== state.board.robber);
}

/**
 * C7.4/C10.2: a knight adjacent to the robber's CURRENT hex moves it to `toHex` (any other hex,
 * mirroring base R6/`moveRobberHandler`) then resolves the steal exactly like the base pipeline
 * (0 candidates -> skip, 1 -> auto, >=2 -> `stealFrom` must name one). Only legal after the first
 * barbarian attack has unlocked the robber (C10.1/C10.2). Deactivates the knight.
 */
export function chaseRobber(
  state: GameState,
  seat: Seat,
  knightVertex: VertexId,
  toHex: HexId,
  stealFrom: Seat | undefined
): EngineResult {
  const ck = citiesKnightsExt(state);
  if (!ck) return fail('WRONG_PHASE', 'chaseRobber is only legal in a Cities & Knights game');
  if (ck.robberLocked) return fail('ROBBER_LOCKED', 'the robber is locked until the first barbarian attack (C10.1/C10.2)');

  const knight = findKnight(ck, seat, knightVertex);
  if (!knight) return fail('KNIGHT_NOT_FOUND', `seat ${seat} has no knight at vertex ${knightVertex}`);
  if (!knight.active) return fail('KNIGHT_INACTIVE', `the knight at vertex ${knightVertex} is not active (C7.4)`);

  const geometry = geometryForState(state);
  const vert = geometry.vertices[knightVertex];
  if (!vert) return fail('BAD_LOCATION', `vertex ${knightVertex} is off the board`);
  if (!vert.hexes.includes(state.board.robber)) {
    return fail('BAD_LOCATION', `the knight at vertex ${knightVertex} is not adjacent to the robber (C7.4)`);
  }
  if (!geometry.hexes[toHex]) return fail('BAD_LOCATION', `hex ${toHex} is off the board`);
  if (toHex === state.board.robber) return fail('ROBBER_SAME_HEX', 'the robber must move to a different hex');

  const knights = ck.knights.map((list, i) =>
    i === seat ? list.map((k) => (k.vertex === knightVertex ? { ...k, active: false } : k)) : list
  );
  const moved: GameState = {
    ...state,
    board: { ...state.board, robber: toHex },
    ext: { ...state.ext, citiesKnights: { ...ck, knights } },
  };
  const events: GameEvent[] = [robberMoved(seat, toHex)];
  const candidates = stealCandidatesForHex(moved, toHex);

  if (candidates.length === 0) return { ok: true, state: moved, events };
  if (candidates.length === 1) return resolveSteal(moved, seat, candidates[0]!, 'main', events);
  if (stealFrom === undefined || !candidates.includes(stealFrom)) {
    return fail('NOT_A_CANDIDATE', 'multiple steal candidates are adjacent; stealFrom must name one');
  }
  return resolveSteal(moved, seat, stealFrom, 'main', events);
}
