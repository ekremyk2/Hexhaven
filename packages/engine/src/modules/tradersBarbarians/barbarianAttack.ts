// Barbarian Attack (T-1005, docs/rules/traders-barbarians-rules.md §TB5). ⚠ HIGH-UNCERTAINTY
// SCENARIO — §TB5.2 flags the WHOLE clause ⚠ VERIFY; every numeric/threshold constant below is
// named so a rulebook-accurate correction later is a one-line change (same discipline
// cities-knights-rules.md used for its own two flagged constants). This is the T&B (non-C&K)
// barbarian model (§TB5.1) — completely separate from Cities & Knights' barbarian-ship track (C8):
// no C&K code is reused, and every T&B knight action/event NAME is deliberately distinct from C&K's
// own knight vocabulary (buildKnight/moveKnight/knightBuilt/knightMoved/barbarianAdvanced/…) so the
// two systems can never collide inside the same `Action`/`GameEvent` tag (TB8.1 also forbids
// combining T&B with C&K in the first place, so this never actually happens at runtime — cheap
// insurance regardless).
//
// v1 model (provisional — treat every constant below as a ⚠ VERIFY placeholder):
//  - A SINGLE wave of `BARBARIAN_START_HEXES` (⚠ VERIFY) barbarians spawns once at `createGame` and
//    is NEVER replenished. The task's "sim MUST terminate" requirement is satisfied structurally (a
//    strictly-shrinking barbarian list, each one eventually captured/pillaged-away/dispersed) rather
//    than via a bounded spawn-wave counter — simpler, and more obviously terminating.
//  - Barbarians advance one hex per `rollDice` (⚠ VERIFY trigger) toward the board's center hex,
//    along a fixed precomputed `BARBARIAN_NEXT_HEX` path (BFS-shortest, deterministic tie-break).
//  - At each hex a barbarian occupies after moving, active T&B knights adjacent (sitting on one of
//    that hex's 6 boundary edges) are checked against the barbarian count there:
//      * outnumbering knights DRIVE THE BARBARIANS OFF — the lowest-edge-id `barbarianCount` of the
//        participating knights each capture 1 barbarian (`capturedBarbarians++`); any further
//        participating knights (once the barbarian count is exhausted) earn `BARBARIAN_GOLD`
//        instead ("or +3 gold if none left to capture"); every participating knight deactivates.
//      * otherwise, if the hex carries a settlement/city, it's PILLAGED (city -> settlement,
//        settlement -> removed, mirroring Cities & Knights' own C8.6 downgrade bookkeeping) and any
//        knight present (active or not — it failed to stop the attack either way) is DESTROYED,
//        owner compensated `KNIGHT_LOSS_GOLD`;
//      * otherwise the barbarian survives to advance again next roll, UNLESS it has already reached
//        the center hex (nothing left to pillage there), in which case it disperses harmlessly.
//  - Recruiting a knight costs `KNIGHT_COST`, placed on any of the seat's own unoccupied
//    road-network edges (⚠ VERIFY "castle-edge" placement — v1: any own-network edge, R7.2's
//    `isRoadConnected`, reused rather than reinvented).
//  - Moving an ACTIVE knight travels up to `KNIGHT_MOVE_RANGE` edge-hops for free, or up to
//    `KNIGHT_MOVE_EXTENDED_RANGE` for `KNIGHT_MOVE_EXTEND_COST_GRAIN` grain (once per turn-owner
//    rotation, `knightMovedThisTurn`) — moving deactivates the knight.
//  - ⚠ VERIFY / v1 ADDITION not in the task's literal text: a seat's own knights reactivate at the
//    START of THAT SEAT'S OWN turn (folded into the `rollDice` hook below). Without SOME
//    reactivation, "moving deactivates it" would make a moved knight permanently unable to ever
//    defend again, which can't be the intent of a scenario about knights intercepting barbarians —
//    see the task's Implementation notes for the full reasoning.
//
// T-1052 (5–6, Phase 10B): the ring/center/march-path geometry below and the knight recruit/move
// edge lookups are now parameterized on the RESOLVED `BoardGeometry` (base 19-hex, or the 30-hex
// `GEOMETRY_EXT56` for a fiveSix game) instead of always the module-load base `GEOMETRY` — mirrors
// T-1050/T-1051's fishing-grounds/river-edge rework. The center hex + next-hex march map are
// computed ONCE at `createGame` (`barbarianGeometryFor`, reference-equality short-circuit to the
// base module constants below for 3–4p, RK-13-byte-identical) and stored in new PUBLIC
// `ext.tradersBarbarians.barbarianCenterHex`/`barbarianNextHex` fields; `applyBarbarianAdvance`
// reads THOSE rather than the module constants directly. The knight recruit-edge enumeration/
// move-range BFS, by contrast, need the board's full edge/vertex graph (not just barbarian-specific
// derived data) — those call `geometryForState`/`geometryForConfig` at read time instead (mirrors
// fishermen.ts's `geometryForState(next).hexes[ext.lakeHex]` lookup; not a real import cycle since
// `geometryForState` is only ever CALLED inside a handler body, never touched at module-load time —
// fishermen.ts already imports it the same way).

import { GEOMETRY } from '@hexhaven/shared';
import type {
  Action,
  BoardGeometry,
  EdgeId,
  EngineErrorCode,
  GameEvent,
  GameState,
  HexId,
  PlayerState,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import {
  tbBarbarianCombatResolved,
  tbBarbarianDispersed,
  tbBarbarianPillaged,
  tbBarbariansAdvanced,
  tbKnightMoved,
  tbKnightRecruited,
} from '../../events.js';
import { canAfford, payToBank } from '../../rules/afford.js';
import { updateAwards } from '../../rules/awards.js';
import { isRoadConnected } from '../../rules/connectivity.js';
import { geometryForState } from '../index.js';
import { isBarbarianAttackState, tbExt, withTbExt } from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

// ---- Fixed data (§TB5.2, ⚠ VERIFY EVERY constant against the physical rulebook) -----------------

/** §TB5.2 ⚠ VERIFY: recruiting a new knight's resource cost. */
export const KNIGHT_COST: Readonly<{ grain: number; wool: number; ore: number }> = {
  grain: 1,
  wool: 1,
  ore: 1,
};

/** §TB5.2 ⚠ VERIFY: free knight-move range, in edge-adjacency hops ("up to 3 paths"). */
export const KNIGHT_MOVE_RANGE = 3;

/** §TB5.2 ⚠ VERIFY: the once-per-turn extended range ("+2 more"), i.e. `KNIGHT_MOVE_RANGE + 2`. */
export const KNIGHT_MOVE_EXTENDED_RANGE = KNIGHT_MOVE_RANGE + 2;

/** §TB5.2 ⚠ VERIFY: grain cost for the once-per-turn extended knight move. */
export const KNIGHT_MOVE_EXTEND_COST_GRAIN = 1;

/** §TB5.2 ⚠ VERIFY: gold awarded when a participating (winning) knight has no barbarian left to
 *  actually capture ("or +3 gold if none left to capture"). */
export const BARBARIAN_GOLD = 3;

/** §TB5.2 ⚠ VERIFY: gold awarded to a knight's owner when it is destroyed in a failed defense. */
export const KNIGHT_LOSS_GOLD = 3;

/** §TB5 ⚠ VERIFY: captured barbarians contribute floor(n / this) VP each ("½ VP each"). */
export const CAPTURED_VP_DIVISOR = 2;

/** §TB5.2 ⚠ VERIFY: how many barbarians spawn in the single starting wave at 3–4p (v1: no respawn).
 *  A module-load constant, unchanged since T-1005 (RK-13) — `barbarianWaveSizeFor` below scales it
 *  up for 5–6p. */
const BARBARIAN_WAVE_SIZE = 3;

/**
 * T-1052 (5–6) ⚠ VERIFY (no rulebook scaling guidance either way — the sim is the arbiter, see
 * sim/tradersBarbariansBarbarianAttack56.test.ts): 3–4p keeps the original `BARBARIAN_WAVE_SIZE`
 * (byte-identical, RK-13). A fiveSix game plays the bigger 30-hex `GEOMETRY_EXT56` board with up to
 * 6 seats each able to recruit knights, so a still-3-piece wave would be trivially swamped —
 * scaling +1 barbarian per seat beyond 4 (5p -> 4, 6p -> 5) keeps the threat "beatable but real"
 * without needing a respawn mechanism.
 */
export function barbarianWaveSizeFor(playerCount: number): number {
  return playerCount <= 4 ? BARBARIAN_WAVE_SIZE : BARBARIAN_WAVE_SIZE + (playerCount - 4);
}

// ---- Hex-adjacency / center / advance-path geometry ------------------------------------------------
// T-1052 (5–6): parameterized on `BoardGeometry` (mirrors state.ts's rivers rework, T-1051) instead
// of always the module-load base `GEOMETRY`. `barbarianGeometryFor` below reference-equality
// short-circuits to the base module constants for a 3–4p game (byte-identical, RK-13); a fiveSix
// game recomputes fresh against `GEOMETRY_EXT56`.

/** Axial "ring distance" from a board's own center (q=0, r=0) — 0 at the center, growing outward.
 *  For any of the engine's board geometries (base 19-hex OR the 30-hex `GEOMETRY_EXT56`), (q=0,r=0)
 *  is the UNIQUE hex at distance 0 (verified for `GEOMETRY_EXT56`'s asymmetric 3-4-5-6-5-4-3 row
 *  profile too — its ring sizes are 1/6/12/11 rather than the base board's 1/6/12, but still a
 *  single minimum), so this metric generalizes without any board-size-specific code. */
function hexDistance(hex: { q: number; r: number }): number {
  return Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r));
}

/** Hex-to-hex adjacency in `geometry` (two hexes are adjacent iff they share an edge, i.e. that
 *  edge's `.hexes` has both). */
function computeHexAdjacency(geometry: BoardGeometry): HexId[][] {
  const adjacency: HexId[][] = geometry.hexes.map(() => []);
  for (const edge of geometry.edges) {
    if (edge.hexes.length === 2) {
      const a = edge.hexes[0]!;
      const b = edge.hexes[1]!;
      adjacency[a]!.push(b);
      adjacency[b]!.push(a);
    }
  }
  return adjacency;
}

/** `geometry`'s center hex (q=0, r=0) — the single hex at ring-distance 0. */
function computeBarbarianCenterHex(geometry: BoardGeometry): HexId {
  const center = geometry.hexes.find((h) => hexDistance(h) === 0);
  if (!center) throw new Error('BUG: barbarianAttack found no center hex in the geometry');
  return center.id;
}

/**
 * Each non-center hex's next hop toward `geometry`'s center: the adjacent hex exactly one ring
 * closer, smallest hex id when more than one qualifies (deterministic tie-break, mirrors
 * state.ts's extreme-vertex tie-break). The center hex has no entry (nothing further to advance
 * to). Well-defined for every hex in either board geometry: `GEOMETRY_EXT56`'s dist<=2 core is
 * literally the base 19-hex hexagon (same q/r subgraph), and every dist-3 outlier hex (the 11-hex
 * "bulge" unique to the 30-hex board) has been verified to border at least one dist-2 hex.
 */
function computeBarbarianNextHex(geometry: BoardGeometry): ReadonlyMap<HexId, HexId> {
  const adjacency = computeHexAdjacency(geometry);
  const next = new Map<HexId, HexId>();
  for (const hex of geometry.hexes) {
    const dist = hexDistance(hex);
    if (dist === 0) continue;
    const candidates = (adjacency[hex.id] ?? [])
      .filter((n) => hexDistance(geometry.hexes[n]!) === dist - 1)
      .sort((a, b) => a - b);
    if (candidates.length > 0) next.set(hex.id, candidates[0]!);
  }
  return next;
}

/**
 * §TB5.2 ⚠ VERIFY exact starting positions — an approximate-but-reasonable v1 simplification
 * (mirrors fishermen's fishing-ground / caravans' route-edge precedent): `waveSize` OUTERMOST-ring
 * hexes (the ring at `geometry`'s own MAXIMUM hex-distance — dist 2 on the base 19-hex board, dist 3
 * on the 30-hex `GEOMETRY_EXT56`, T-1052 ⚠ VERIFY no 5–6 diagram exists either), evenly spaced by
 * ascending hex id. Never random (pure function of `geometry`), so no `rng` draw is needed.
 */
function computeBarbarianStartHexes(geometry: BoardGeometry, waveSize: number): HexId[] {
  const maxDist = Math.max(...geometry.hexes.map((h) => hexDistance(h)));
  const outerRing = geometry.hexes
    .filter((h) => hexDistance(h) === maxDist)
    .map((h) => h.id)
    .sort((a, b) => a - b);
  if (outerRing.length === 0) return [];
  const step = Math.max(1, Math.floor(outerRing.length / waveSize));
  const out: HexId[] = [];
  for (let i = 0; i < outerRing.length && out.length < waveSize; i += step) {
    out.push(outerRing[i]!);
  }
  return out;
}

/** The base 3–4p board's center hex — a module-load constant, byte-identical to before T-1052
 *  (RK-13). Still directly importable for any base-board-only caller (client/tests). */
export const BARBARIAN_CENTER_HEX: HexId = computeBarbarianCenterHex(GEOMETRY);

/** The base 3–4p board's next-hex march map — a module-load constant, byte-identical to before
 *  T-1052 (RK-13). See `BARBARIAN_CENTER_HEX`'s header comment above. */
export const BARBARIAN_NEXT_HEX: ReadonlyMap<HexId, HexId> = computeBarbarianNextHex(GEOMETRY);

/** The base 3–4p board's starting barbarian wave (`BARBARIAN_WAVE_SIZE` pieces) — a module-load
 *  constant, byte-identical to before T-1052 (RK-13). See `BARBARIAN_CENTER_HEX`'s header comment
 *  above. */
export const BARBARIAN_START_HEXES: readonly HexId[] = computeBarbarianStartHexes(GEOMETRY, BARBARIAN_WAVE_SIZE);

/**
 * Seed THIS game's center hex / next-hex march map / starting wave for `initialBarbarianAttackExt`.
 * `geometry === GEOMETRY` (a 3–4p game, reference equality) AND `waveSize === BARBARIAN_WAVE_SIZE`
 * short-circuits to the base module constants above — byte-identical result, no recomputation
 * (RK-13; a 3–4p game's `waveSize` is always `BARBARIAN_WAVE_SIZE` by construction, so this branch
 * is exactly "is this a 3–4p game"). Any other geometry (a fiveSix game's `GEOMETRY_EXT56`, T-1052)
 * recomputes fresh against it. `nextHex` is returned as a plain `Record` (JSON-safe for `ext`
 * storage) rather than a `Map`.
 */
export function barbarianGeometryFor(
  geometry: BoardGeometry,
  waveSize: number
): { centerHex: HexId; nextHex: Record<HexId, HexId>; startHexes: HexId[] } {
  if (geometry === GEOMETRY && waveSize === BARBARIAN_WAVE_SIZE) {
    return {
      centerHex: BARBARIAN_CENTER_HEX,
      nextHex: Object.fromEntries(BARBARIAN_NEXT_HEX) as Record<HexId, HexId>,
      startHexes: [...BARBARIAN_START_HEXES],
    };
  }
  const centerHex = computeBarbarianCenterHex(geometry);
  const nextHex = Object.fromEntries(computeBarbarianNextHex(geometry)) as Record<HexId, HexId>;
  const startHexes = computeBarbarianStartHexes(geometry, waveSize);
  return { centerHex, nextHex, startHexes };
}

/** THIS game's center hex (§TB5.2) — falls back to the base module constant outside a
 *  barbarianAttack game / before `initialBarbarianAttackExt` seeds it (never actually reached in
 *  practice — the ext is always seeded before `applyBarbarianAdvance` ever runs). */
function centerHexOf(state: GameState): HexId {
  return tbExt(state)?.barbarianCenterHex ?? BARBARIAN_CENTER_HEX;
}

/** THIS game's next-hex march hop for `hex` (§TB5.2), or `hex` itself if it has none (the center
 *  hex, or an unreachable hex). */
function nextHexOf(state: GameState, hex: HexId): HexId {
  const map = tbExt(state)?.barbarianNextHex;
  const next = map ? map[hex] : undefined;
  return next ?? BARBARIAN_NEXT_HEX.get(hex) ?? hex;
}

// ---- Init (createGame) ---------------------------------------------------------------------------

/**
 * Seed `ext.tradersBarbarians` for a barbarianAttack game (createGame, gated on
 * `isBarbarianAttackConfig(config)`). No `rng` draw needed — the starting wave/path are pure
 * functions of `geometry` (the config's RESOLVED geometry — the base 19-hex board, or
 * `GEOMETRY_EXT56` for a fiveSix game, T-1052), not randomized per game. No board mutation either.
 */
export function initialBarbarianAttackExt(
  playerCount: number,
  geometry: BoardGeometry
): NonNullable<NonNullable<GameState['ext']>['tradersBarbarians']> {
  const waveSize = barbarianWaveSizeFor(playerCount);
  const { centerHex, nextHex, startHexes } = barbarianGeometryFor(geometry, waveSize);
  return {
    scenario: 'barbarianAttack',
    barbarians: [...startHexes],
    knights: [],
    capturedBarbarians: Array.from({ length: playerCount }, () => 0),
    gold: Array.from({ length: playerCount }, () => 0),
    knightMovedThisTurn: false,
    barbarianCenterHex: centerHex,
    barbarianNextHex: nextHex,
  };
}

// ---- Edge-adjacency BFS (moveBarbarianKnight range / legal targets) -------------------------------

/** Every edge reachable from `from` within `range` edge-adjacency hops in `geometry` (two edges are
 *  adjacent iff they share a vertex), mapped to its hop distance (0 for `from` itself). Mirrors
 *  state.ts's `bfsEdgePath` vertex-to-vertex BFS, but over the edge-adjacency graph instead. Takes
 *  `geometry` as a parameter (T-1052, 5–6) rather than always reading the base `GEOMETRY` — callers
 *  resolve it via `geometryForState`, the same discipline `applyBarbarianAdvance` below follows. */
function edgesWithinRange(geometry: BoardGeometry, from: EdgeId, range: number): Map<EdgeId, number> {
  const dist = new Map<EdgeId, number>([[from, 0]]);
  let frontier: EdgeId[] = [from];
  for (let d = 1; d <= range && frontier.length > 0; d++) {
    const nextFrontier: EdgeId[] = [];
    for (const e of frontier) {
      const edge = geometry.edges[e];
      if (!edge) continue;
      for (const v of [edge.a, edge.b]) {
        const vert = geometry.vertices[v];
        if (!vert) continue;
        for (const adjEdge of vert.edges) {
          if (dist.has(adjEdge)) continue;
          dist.set(adjEdge, d);
          nextFrontier.push(adjEdge);
        }
      }
    }
    frontier = nextFrontier;
  }
  return dist;
}

// ---- recruitKnight (§TB5.2) -----------------------------------------------------------------------

/** Every legal `recruitKnight` edge for `seat` right now (client highlighting / the sim bot,
 *  mirrors `legal.ts`'s enumerator shape). `[]` outside a barbarianAttack game / the main phase.
 *  Reads `geometryForState(state)` (T-1052, 5–6) rather than always the base `GEOMETRY` — works
 *  the same whether `state` is the engine's own full `GameState` (the sim bot) or a client's
 *  redacted `PlayerView` cast to one (`config` rides through redaction unchanged either way). */
export function legalKnightRecruitEdges(state: GameState, seat: Seat): EdgeId[] {
  if (state.phase.kind !== 'main' || !isBarbarianAttackState(state)) return [];
  const occupied = new Set((tbExt(state)?.knights ?? []).map((k) => k.edge));
  const geometry = geometryForState(state);
  return geometry.edges.filter((e) => !occupied.has(e.id) && isRoadConnected(state, seat, e.id)).map((e) => e.id);
}

/**
 * `recruitKnight` (§TB5.2, ⚠ VERIFY "castle-edge" placement — v1: any own-network edge): legal on
 * an edge unoccupied by another knight, connected to the seat's own road network (R7.2's
 * `isRoadConnected`, reused rather than reinvented — same discipline `buildBridge` follows).
 */
export function recruitKnightHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'recruitKnight' }>
): EngineResult {
  if (state.phase.kind !== 'main') {
    return fail('WRONG_PHASE', 'knights may only be recruited in the main phase (§TB5.2)');
  }
  const ext = tbExt(state);
  if (!ext) throw new Error('BUG: barbarianAttack ext missing in recruitKnightHandler');
  const edge = action.edge;
  if ((ext.knights ?? []).some((k) => k.edge === edge)) {
    return fail('OCCUPIED', `edge ${edge} already carries a knight (§TB5.2)`);
  }
  const player = state.players[seat];
  if (!player) throw new Error(`BUG: recruitKnight from unknown seat ${seat}`);
  if (!isRoadConnected(state, seat, edge)) {
    return fail('NOT_CONNECTED', `edge ${edge} does not touch your network (R7.2/§TB5.2)`);
  }
  if (!canAfford(player, KNIGHT_COST)) return fail('CANT_AFFORD', 'cannot afford a knight (§TB5.2)');

  const { players, bank } = payToBank(state, seat, KNIGHT_COST);
  const knights = [...(ext.knights ?? []), { seat, edge, active: true }];
  const nextState = withTbExt({ ...state, players, bank }, { ...ext, knights });
  return { ok: true, state: nextState, events: [tbKnightRecruited(seat, edge)] };
}

// ---- moveBarbarianKnight (§TB5.2) ------------------------------------------------------------------

/** Every legal `moveBarbarianKnight` target from `from` for `seat` right now, each tagged with
 *  whether it requires the once-per-turn paid extension (client highlighting / the sim bot). `[]`
 *  outside a barbarianAttack game, when `from` isn't `seat`'s own ACTIVE knight, or the extension is
 *  needed but already spent/unaffordable this turn-owner rotation. */
export function legalKnightMoveTargets(
  state: GameState,
  seat: Seat,
  from: EdgeId
): { to: EdgeId; extended: boolean }[] {
  if (!isBarbarianAttackState(state)) return [];
  const ext = tbExt(state);
  const knights = ext?.knights ?? [];
  const knight = knights.find((k) => k.seat === seat && k.edge === from);
  if (!knight || !knight.active) return [];

  const occupied = new Set(knights.map((k) => k.edge));
  const player = state.players[seat];
  const canExtend =
    !(ext?.knightMovedThisTurn ?? false) &&
    !!player &&
    player.resources.grain >= KNIGHT_MOVE_EXTEND_COST_GRAIN;
  const maxRange = canExtend ? KNIGHT_MOVE_EXTENDED_RANGE : KNIGHT_MOVE_RANGE;

  const out: { to: EdgeId; extended: boolean }[] = [];
  for (const [edge, dist] of edgesWithinRange(geometryForState(state), from, maxRange)) {
    if (dist === 0 || occupied.has(edge)) continue;
    out.push({ to: edge, extended: dist > KNIGHT_MOVE_RANGE });
  }
  return out;
}

/**
 * `moveBarbarianKnight` (§TB5.2): moves an ACTIVE knight up to `KNIGHT_MOVE_RANGE` edge-adjacency
 * hops for free, or up to `KNIGHT_MOVE_EXTENDED_RANGE` for `KNIGHT_MOVE_EXTEND_COST_GRAIN` grain
 * (`extended: true`, once per turn-owner rotation — `knightMovedThisTurn`). Moving deactivates the
 * knight regardless (⚠ VERIFY / see barbarianAttack.ts's header comment on the v1 reactivation-
 * timing addition this implies).
 */
export function moveBarbarianKnightHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'moveBarbarianKnight' }>
): EngineResult {
  if (state.phase.kind !== 'main') {
    return fail('WRONG_PHASE', 'knights may only move in the main phase (§TB5.2)');
  }
  const ext = tbExt(state);
  if (!ext) throw new Error('BUG: barbarianAttack ext missing in moveBarbarianKnightHandler');
  if (action.from === action.to) {
    return fail('BAD_LOCATION', 'moveBarbarianKnight must name a different edge (§TB5.2)');
  }
  const knights = ext.knights ?? [];
  const idx = knights.findIndex((k) => k.seat === seat && k.edge === action.from);
  if (idx < 0) return fail('KNIGHT_NOT_FOUND', `seat ${seat} has no knight on edge ${action.from} (§TB5.2)`);
  const knight = knights[idx]!;
  if (!knight.active) return fail('KNIGHT_INACTIVE', `the knight on edge ${action.from} is inactive (§TB5.2)`);
  if (knights.some((k) => k.edge === action.to)) {
    return fail('OCCUPIED', `edge ${action.to} already carries a knight`);
  }

  const wantsExtended = action.extended === true;
  if (wantsExtended && (ext.knightMovedThisTurn ?? false)) {
    return fail(
      'KNIGHT_MOVE_EXTEND_UNAVAILABLE',
      'the +2-path knight-move extension was already used this turn (§TB5.2)'
    );
  }
  const range = wantsExtended ? KNIGHT_MOVE_EXTENDED_RANGE : KNIGHT_MOVE_RANGE;
  const dist = edgesWithinRange(geometryForState(state), action.from, range).get(action.to);
  if (dist === undefined) {
    return fail(
      'KNIGHT_MOVE_TOO_FAR',
      `edge ${action.to} is more than ${range} path(s) from ${action.from} (§TB5.2)`
    );
  }

  const player = state.players[seat];
  const grainCost = wantsExtended ? KNIGHT_MOVE_EXTEND_COST_GRAIN : 0;
  if (grainCost > 0 && (!player || !canAfford(player, { grain: grainCost }))) {
    return fail('CANT_AFFORD', 'cannot afford the +2-path knight-move extension (1 grain, §TB5.2)');
  }

  let nextState = state;
  if (grainCost > 0) {
    const { players, bank } = payToBank(state, seat, { grain: grainCost });
    nextState = { ...state, players, bank };
  }
  const nextKnights = knights.map((k, i) => (i === idx ? { ...k, edge: action.to, active: false } : k));
  const withKnights = withTbExt(nextState, {
    ...ext,
    knights: nextKnights,
    knightMovedThisTurn: wantsExtended ? true : (ext.knightMovedThisTurn ?? false),
  });
  return { ok: true, state: withKnights, events: [tbKnightMoved(seat, action.from, action.to, wantsExtended)] };
}

/** §TB5.2: reset the once-per-turn extended-move flag on every `endTurn` in a barbarianAttack game.
 *  `null` when there's nothing to reset (outside the scenario, or already unused this rotation). */
export function applyBarbarianAttackTurnReset(
  next: GameState,
  events: readonly GameEvent[]
): { state: GameState; events: GameEvent[] } | null {
  const ext = tbExt(next);
  if (!ext || ext.scenario !== 'barbarianAttack') return null;
  if (!(ext.knightMovedThisTurn ?? false)) return null;
  return { state: withTbExt(next, { ...ext, knightMovedThisTurn: false }), events: [...events] };
}

/**
 * A pillaged SETTLEMENT is removed outright (§TB5.2 "settlement -> removed") rather than
 * downgraded in place — unlike a city->settlement downgrade, the vertex loses its ONLY building,
 * which can strand any of the seat's roads that only reached the rest of their network THROUGH
 * that vertex (I5 connectivity, invariants.ts's `checkI5Connectivity`). Re-derive the seat's
 * reachable road set from scratch (BFS from their remaining settlements/cities, same algorithm I5
 * itself uses) and return any now-unreachable roads to `piecesLeft.roads` — a coherent "the
 * destroyed settlement's dangling roads are gone too" extension, not a rules invention so much as
 * the necessary bookkeeping a removal (rather than a downgrade) requires. Takes `geometry` as a
 * parameter (T-1052, 5–6) rather than always reading the base `GEOMETRY`.
 */
function pruneDisconnectedRoads(geometry: BoardGeometry, players: readonly PlayerState[], seat: Seat): PlayerState[] {
  return players.map((p) => {
    if (p.seat !== seat || p.roads.length === 0) return p;
    const buildingVertices = new Set<VertexId>([...p.settlements, ...p.cities]);
    const adjacency = new Map<VertexId, { edge: EdgeId; to: VertexId }[]>();
    const link = (from: VertexId, edge: EdgeId, to: VertexId): void => {
      const list = adjacency.get(from);
      if (list) list.push({ edge, to });
      else adjacency.set(from, [{ edge, to }]);
    };
    for (const edgeId of p.roads) {
      const e = geometry.edges[edgeId];
      if (!e) continue;
      link(e.a, edgeId, e.b);
      link(e.b, edgeId, e.a);
    }
    const visitedEdges = new Set<EdgeId>();
    const seenVertices = new Set<VertexId>(buildingVertices);
    const queue: VertexId[] = [...seenVertices];
    while (queue.length > 0) {
      const v = queue.shift()!;
      for (const { edge, to } of adjacency.get(v) ?? []) {
        visitedEdges.add(edge);
        if (!seenVertices.has(to)) {
          seenVertices.add(to);
          queue.push(to);
        }
      }
    }
    const keptRoads = p.roads.filter((e) => visitedEdges.has(e));
    const removedCount = p.roads.length - keptRoads.length;
    if (removedCount === 0) return p;
    return { ...p, roads: keptRoads, piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads + removedCount } };
  });
}

// ---- Barbarian advance + combat/pillage resolution (§TB5.2, module `phaseHooks.afterAction`) ------

/**
 * §TB5.2: on every `rollDice` in a barbarianAttack game, first reactivate `actingSeat`'s own
 * knights (⚠ VERIFY / v1 addition — see this file's header comment), then advance every surviving
 * barbarian one hex toward the center and resolve combat/pillage/dispersal at each occupied hex
 * (grouped by hex, ascending hex id, for determinism). Barbarians are removed from `barbarians`
 * whenever they're driven off, pillage, or disperse — the list can only ever shrink (no respawn),
 * which is what guarantees this mechanic terminates. `null` outside a barbarianAttack game.
 */
export function applyBarbarianAdvance(
  next: GameState,
  events: readonly GameEvent[],
  actingSeat: Seat
): { state: GameState; events: GameEvent[] } | null {
  const ext = tbExt(next);
  if (!ext || ext.scenario !== 'barbarianAttack') return null;

  const geometry = geometryForState(next);
  let knights = (ext.knights ?? []).map((k) => (k.seat === actingSeat && !k.active ? { ...k, active: true } : k));
  const barbarians = ext.barbarians ?? [];
  if (barbarians.length === 0) {
    return { state: withTbExt(next, { ...ext, knights }), events: [...events] };
  }

  const capturedBarbarians = [...(ext.capturedBarbarians ?? [])];
  const gold = [...(ext.gold ?? [])];
  let players = next.players;
  const outEvents: GameEvent[] = [...events];

  // Step 1: each surviving barbarian steps one hex toward the center (one already AT the center has
  // no further hop and simply stays for the resolution step below). THIS game's center/next-hex map
  // (T-1052, 5–6: `ext.barbarianCenterHex`/`barbarianNextHex`, seeded at createGame from the
  // RESOLVED geometry) rather than the base module constants directly.
  const centerHex = centerHexOf(next);
  const moves: { from: HexId; to: HexId }[] = [];
  const moved = barbarians.map((hex) => {
    const to = nextHexOf(next, hex);
    if (to !== hex) moves.push({ from: hex, to });
    return to;
  });
  if (moves.length > 0) outEvents.push(tbBarbariansAdvanced(moves));

  // Step 2: resolve combat/pillage/dispersal at each occupied hex (ascending hex id, deterministic).
  const byHex = new Map<HexId, number>();
  for (const hex of moved) byHex.set(hex, (byHex.get(hex) ?? 0) + 1);

  const survivors: HexId[] = [];
  for (const hex of [...byHex.keys()].sort((a, b) => a - b)) {
    const barbarianCount = byHex.get(hex)!;
    const hexGeo = geometry.hexes[hex];
    if (!hexGeo) throw new Error(`BUG: barbarian advance found no geometry for hex ${hex}`);
    const hexEdges = new Set(hexGeo.edges);
    const defendersHere = knights.filter((k) => k.active && hexEdges.has(k.edge)).sort((a, b) => a.edge - b.edge);

    if (defendersHere.length > barbarianCount) {
      // Combat WON: barbarians driven off. Every participating knight deactivates; the first
      // `barbarianCount` (by ascending edge id) capture a barbarian each, the rest earn
      // BARBARIAN_GOLD instead (§TB5.2 "or +3 gold if none left to capture").
      const defenderEdges = new Set(defendersHere.map((k) => k.edge));
      knights = knights.map((k) => (defenderEdges.has(k.edge) ? { ...k, active: false } : k));
      const rewards: { seat: Seat; captured: boolean; gold: number }[] = defendersHere.map((k, i) => {
        if (i < barbarianCount) {
          capturedBarbarians[k.seat] = (capturedBarbarians[k.seat] ?? 0) + 1;
          return { seat: k.seat, captured: true, gold: 0 };
        }
        gold[k.seat] = (gold[k.seat] ?? 0) + BARBARIAN_GOLD;
        return { seat: k.seat, captured: false, gold: BARBARIAN_GOLD };
      });
      outEvents.push(tbBarbarianCombatResolved(hex, barbarianCount, rewards));
      continue; // barbarians here are removed — not a survivor
    }

    // Not outnumbered: look for a pillage target among this hex's vertices (ascending corner order,
    // then ascending seat) — a city needs an available settlement piece to downgrade INTO (mirrors
    // Cities & Knights' own C8.6 "no piece left" immunity, keeping I2 piece-supply conservation).
    let target: { seat: Seat; vertex: VertexId; downgraded: 'city' | 'settlement' } | null = null;
    for (const vertex of hexGeo.vertices) {
      for (const p of players) {
        if (p.cities.includes(vertex) && p.piecesLeft.settlements > 0) {
          target = { seat: p.seat, vertex, downgraded: 'city' };
          break;
        }
        if (p.settlements.includes(vertex)) {
          target = { seat: p.seat, vertex, downgraded: 'settlement' };
          break;
        }
      }
      if (target) break;
    }

    if (target) {
      const resolvedTarget = target;
      players = players.map((p) => {
        if (p.seat !== resolvedTarget.seat) return p;
        if (resolvedTarget.downgraded === 'city') {
          return {
            ...p,
            cities: p.cities.filter((v) => v !== resolvedTarget.vertex),
            settlements: [...p.settlements, resolvedTarget.vertex],
            piecesLeft: {
              ...p.piecesLeft,
              settlements: p.piecesLeft.settlements - 1,
              cities: p.piecesLeft.cities + 1,
            },
          };
        }
        return {
          ...p,
          settlements: p.settlements.filter((v) => v !== resolvedTarget.vertex),
          piecesLeft: { ...p.piecesLeft, settlements: p.piecesLeft.settlements + 1 },
        };
      });
      if (resolvedTarget.downgraded === 'settlement') {
        players = pruneDisconnectedRoads(geometry, players, resolvedTarget.seat);
      }
      // Knights present (active or not) failed to stop this pillage — destroyed, owner
      // compensated (§TB5.2 "a knight killed in a failed defense").
      const knightsLost = knights
        .filter((k) => hexEdges.has(k.edge))
        .map((k) => ({ seat: k.seat, edge: k.edge, gold: KNIGHT_LOSS_GOLD }));
      if (knightsLost.length > 0) {
        knights = knights.filter((k) => !hexEdges.has(k.edge));
        for (const lost of knightsLost) gold[lost.seat] = (gold[lost.seat] ?? 0) + KNIGHT_LOSS_GOLD;
      }
      outEvents.push(
        tbBarbarianPillaged(hex, resolvedTarget.seat, resolvedTarget.vertex, resolvedTarget.downgraded, knightsLost)
      );
      continue; // barbarian(s) consumed here
    }

    if (hex === centerHex) {
      outEvents.push(tbBarbarianDispersed(hex));
      continue; // reached the end with nothing to pillage — disperses (v1 termination rule)
    }

    // No combat, no pillage target, not yet at the center: survives to advance again next roll.
    for (let i = 0; i < barbarianCount; i++) survivors.push(hex);
  }

  // A pillaged settlement's removal can strand roads (pruned above) or otherwise change a seat's
  // board footprint — recompute Longest Road/Largest Army only when `players` actually changed
  // (mirrors buildBridge/placeCamel's own "recompute after a network-affecting change" discipline).
  let mergedState: GameState = { ...next, players };
  if (players !== next.players) {
    const awarded = updateAwards(mergedState);
    mergedState = awarded.state;
    outEvents.push(...awarded.events);
  }

  const withExt = withTbExt(mergedState, { ...ext, barbarians: survivors, knights, capturedBarbarians, gold });
  return { state: withExt, events: outEvents };
}

// ---- VP (§TB5) --------------------------------------------------------------------------------

/** floor(capturedBarbarians[seat] / CAPTURED_VP_DIVISOR) — "½ VP each" (§TB5, ⚠ VERIFY rounding).
 *  0 outside a barbarianAttack game. */
export function barbarianAttackVpFor(state: GameState, seat: Seat): number {
  if (!isBarbarianAttackState(state)) return 0;
  const captured = tbExt(state)?.capturedBarbarians?.[seat] ?? 0;
  return Math.floor(captured / CAPTURED_VP_DIVISOR);
}
