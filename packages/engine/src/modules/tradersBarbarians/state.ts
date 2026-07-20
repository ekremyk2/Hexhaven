// Traders & Barbarians ext-state helpers (T-1002, docs/rules/traders-barbarians-rules.md §TB8.2).
// Mirrors modules/seafarers/state.ts: all T&B scenario data lives under `state.ext.tradersBarbarians`
// so base fields never change meaning; these thin accessors are the single read/write surface. Every
// accessor is a no-op / empty for a non-T&B (or non-fishermen) game.

import { GEOMETRY } from '@hexhaven/shared';
import type {
  BoardGeometry,
  EdgeId,
  GameConfig,
  GameState,
  HexId,
  Seat,
  TBCommodity,
  VertexId,
} from '@hexhaven/shared';

type TBExt = NonNullable<NonNullable<GameState['ext']>['tradersBarbarians']>;

/**
 * Is `config` a Fishermen-scenario game? Reads the loose config toggle directly rather than going
 * through `tradersBarbariansScenario` (modules/tradersBarbarians/index.ts) — importing that here
 * would create index.ts -> fishermen.ts -> state.ts -> index.ts cycle; `resolveModules` already
 * gates unknown/unshipped scenario ids before this module is ever active, so state.ts doesn't need
 * to re-validate the id, only compare it.
 */
export function isFishermenConfig(config: Pick<GameConfig, 'expansions'>): boolean {
  const tb = config.expansions.tradersBarbarians;
  return !!tb && tb.scenario === 'fishermen';
}

/** Is `config` a Rivers-scenario game (T-1003)? Same direct-read discipline as `isFishermenConfig`
 *  above (avoids an index.ts -> rivers.ts -> state.ts -> index.ts cycle). */
export function isRiversConfig(config: Pick<GameConfig, 'expansions'>): boolean {
  const tb = config.expansions.tradersBarbarians;
  return !!tb && tb.scenario === 'rivers';
}

/** Is `config` a Caravans-scenario game (T-1004)? Same direct-read discipline as
 *  `isFishermenConfig`/`isRiversConfig` above. */
export function isCaravansConfig(config: Pick<GameConfig, 'expansions'>): boolean {
  const tb = config.expansions.tradersBarbarians;
  return !!tb && tb.scenario === 'caravans';
}

/** Is `config` a Barbarian Attack-scenario game (T-1005)? Same direct-read discipline as
 *  `isFishermenConfig`/`isRiversConfig`/`isCaravansConfig` above. */
export function isBarbarianAttackConfig(config: Pick<GameConfig, 'expansions'>): boolean {
  const tb = config.expansions.tradersBarbarians;
  return !!tb && tb.scenario === 'barbarianAttack';
}

/** Is `config` the main-scenario game (T-1006, scenario id `'tradersBarbarians'` — same string as
 *  the expansion id, since this scenario shares its name with the whole compilation)? Same
 *  direct-read discipline as `isFishermenConfig`/`isRiversConfig`/`isCaravansConfig` above. */
export function isTradersBarbariansMainConfig(config: Pick<GameConfig, 'expansions'>): boolean {
  const tb = config.expansions.tradersBarbarians;
  return !!tb && tb.scenario === 'tradersBarbarians';
}

/** The T&B ext block, or `undefined` outside a T&B game. */
export function tbExt(state: GameState): TBExt | undefined {
  return state.ext?.tradersBarbarians;
}

/** Is `state` a live fishermen-scenario game? */
export function isFishermenState(state: GameState): boolean {
  return tbExt(state)?.scenario === 'fishermen';
}

/** Is `state` a live rivers-scenario game (T-1003)? */
export function isRiversState(state: GameState): boolean {
  return tbExt(state)?.scenario === 'rivers';
}

/** Is `state` a live caravans-scenario game (T-1004)? */
export function isCaravansState(state: GameState): boolean {
  return tbExt(state)?.scenario === 'caravans';
}

/** Is `state` a live Barbarian Attack-scenario game (T-1005)? */
export function isBarbarianAttackState(state: GameState): boolean {
  return tbExt(state)?.scenario === 'barbarianAttack';
}

/** Is `state` a live main-scenario game (T-1006)? */
export function isTradersBarbariansMainState(state: GameState): boolean {
  return tbExt(state)?.scenario === 'tradersBarbarians';
}

/** Replace the T&B ext block on `state` immutably (spread-copy only that branch). */
export function withTbExt(state: GameState, next: TBExt): GameState {
  return { ...state, ext: { ...state.ext, tradersBarbarians: next } };
}

/** A seat's total fish (§TB2.3) — 0 outside a fishermen game / before any has been drawn. */
export function fishOf(state: GameState, seat: Seat): number {
  return tbExt(state)?.fish?.[seat] ?? 0;
}

/** The Old Boot's current holder (§TB2.5, public), or `null` while unclaimed / outside a fishermen
 *  game. */
export function oldBootHolder(state: GameState): Seat | null {
  return tbExt(state)?.oldBoot ?? null;
}

/** The Lake hex (§TB2.1/§TB2.6) — the board's desert hex repurposed as the Lake. `undefined` outside
 *  a fishermen game. */
export function lakeHexOf(state: GameState): HexId | undefined {
  return tbExt(state)?.lakeHex;
}

/** The fishing-ground water tiles (§TB2.1), or `[]` outside a fishermen game. */
export function fishingGroundsOf(
  state: GameState
): readonly { token: number; vertices: readonly VertexId[] }[] {
  return tbExt(state)?.fishingGrounds ?? [];
}

/** The face-down fish-token draw pile (§TB2.2), index 0 = next draw, or `[]` outside a fishermen
 *  game. */
export function fishStackOf(state: GameState): readonly number[] {
  return tbExt(state)?.fishStack ?? [];
}

// ---------------------------------------------------------------------------------------------
// Rivers (T-1003, docs/rules/traders-barbarians-rules.md §TB3) — thin accessors, mirroring the
// fishermen ones above. Every accessor is a no-op / empty for a non-rivers game.
// ---------------------------------------------------------------------------------------------

/** A seat's total gold coins (§TB3.1) — 0 outside a rivers game / before any has been earned. */
export function coinsOf(state: GameState, seat: Seat): number {
  return tbExt(state)?.coins?.[seat] ?? 0;
}

/** A seat's bridge edges (§TB3.2), or `[]` outside a rivers game. */
export function bridgesOf(state: GameState, seat: Seat): readonly EdgeId[] {
  return tbExt(state)?.bridges?.[seat] ?? [];
}

/** Does ANY seat already hold a bridge on `edge`? (One bridge per river edge, §TB3.2.) */
export function isBridgeOccupied(state: GameState, edge: EdgeId): boolean {
  return !!tbExt(state)?.bridges?.some((list) => list.includes(edge));
}

/** How many `tradeCoins` trades have happened this turn-owner rotation (§TB3.3) — 0 outside a
 *  rivers game / at the start of a turn. */
export function coinTradesThisTurnOf(state: GameState): number {
  return tbExt(state)?.coinTradesThisTurn ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Caravans (T-1004, docs/rules/traders-barbarians-rules.md §TB4) — thin accessors, mirroring the
// fishermen/rivers ones above. Every accessor is a no-op / empty for a non-caravans game. Unlike
// Rivers' river edges (a load-time geometry constant, independent of board terrain), the Oasis and
// its routes depend on WHERE the desert landed on this particular board — so they live in
// `ext.tradersBarbarians` (seeded per-game by `caravans.ts`'s `initialCaravansExt`), not a module
// constant.
// ---------------------------------------------------------------------------------------------

/** The Oasis hex (§TB4.1) — the board's desert hex repurposed as the Oasis. `undefined` outside a
 *  caravans game. */
export function oasisHexOf(state: GameState): HexId | undefined {
  return tbExt(state)?.oasisHex;
}

/** The caravan-route edges a camel may sit on (§TB4.1), or `[]` outside a caravans game. */
export function routeEdgesOf(state: GameState): readonly EdgeId[] {
  return tbExt(state)?.routeEdges ?? [];
}

/** Is `edge` one of this game's caravan-route edges? Always `false` outside a caravans game. */
export function isCaravanRouteEdge(state: GameState, edge: EdgeId): boolean {
  return routeEdgesOf(state).includes(edge);
}

/** Every placed camel edge (§TB4.1-§TB4.3, public), or `[]` outside a caravans game. */
export function camelsOf(state: GameState): readonly EdgeId[] {
  return tbExt(state)?.camels ?? [];
}

/** Does a camel already sit on `edge`? Always `false` outside a caravans game. */
export function isCamelEdge(state: GameState, edge: EdgeId): boolean {
  return camelsOf(state).includes(edge);
}

// ---------------------------------------------------------------------------------------------
// Barbarian Attack (T-1005, docs/rules/traders-barbarians-rules.md §TB5) — thin accessors,
// mirroring the fishermen/rivers/caravans ones above. Every accessor is a no-op / empty for a
// non-barbarianAttack game.
// ---------------------------------------------------------------------------------------------

/** Every barbarian's current hex (§TB5.2, public — board pieces), or `[]` outside a
 *  barbarianAttack game. */
export function barbariansOf(state: GameState): readonly HexId[] {
  return tbExt(state)?.barbarians ?? [];
}

/** Every T&B knight on the board (§TB5.2, public), or `[]` outside a barbarianAttack game. */
export function knightsOf(state: GameState): readonly { seat: Seat; edge: EdgeId; active: boolean }[] {
  return tbExt(state)?.knights ?? [];
}

/** A seat's captured-barbarian count (§TB5) — 0 outside a barbarianAttack game / before any
 *  capture. */
export function capturedBarbariansOf(state: GameState, seat: Seat): number {
  return tbExt(state)?.capturedBarbarians?.[seat] ?? 0;
}

/** A seat's gold-coin count (§TB5, knight-loss/no-barbarian-left compensation) — 0 outside a
 *  barbarianAttack game / before any award. */
export function barbarianAttackGoldOf(state: GameState, seat: Seat): number {
  return tbExt(state)?.gold?.[seat] ?? 0;
}

// ---------------------------------------------------------------------------------------------
// The main scenario (T-1006, docs/rules/traders-barbarians-rules.md §TB6) — thin accessors,
// mirroring the fishermen/rivers/caravans/barbarianAttack ones above. Every accessor is a no-op /
// empty for a non-tradersBarbarians-scenario game.
// ---------------------------------------------------------------------------------------------

const EMPTY_TB_COMMODITY_STOCK: Readonly<Record<TBCommodity, number>> = {
  marble: 0,
  glass: 0,
  sand: 0,
  tools: 0,
};

/** A seat's commodity stock (§TB6.1) — all zero outside the main scenario / before any commodity
 *  has entered play. */
export function tbCommoditiesOf(state: GameState, seat: Seat): Readonly<Record<TBCommodity, number>> {
  return tbExt(state)?.commodities?.[seat] ?? EMPTY_TB_COMMODITY_STOCK;
}

/** Every wagon on the board (§TB6.2, public), or `[]` outside the main scenario. Indexed by ARRAY
 *  POSITION — `moveWagon.wagon` addresses one of these by that index (⚠ VERIFY, see the Action
 *  variant's header comment). */
export function wagonsOf(
  state: GameState
): readonly { seat: Seat; at: VertexId; cargo: TBCommodity | null }[] {
  return tbExt(state)?.wagons ?? [];
}

/** The three trade hexes (§TB6.1), or `[]` outside the main scenario. */
export function tradeHexesOf(
  state: GameState
): readonly { hex: HexId; kind: 'quarry' | 'glassworks' | 'castle' }[] {
  return tbExt(state)?.tradeHexes ?? [];
}

/** Every edge a barbarian piece currently occupies (§TB6.3), or `[]` outside the main scenario. */
export function pathBarbariansOf(state: GameState): readonly EdgeId[] {
  return tbExt(state)?.pathBarbarians ?? [];
}

/** Is `edge` currently occupied by a path barbarian? Always `false` outside the main scenario. */
export function isPathBarbarianEdge(state: GameState, edge: EdgeId): boolean {
  return pathBarbariansOf(state).includes(edge);
}

/** A seat's completed-delivery count (§TB6.3) — 0 outside the main scenario / before any delivery. */
export function deliveriesOf(state: GameState, seat: Seat): number {
  return tbExt(state)?.deliveries?.[seat] ?? 0;
}

/** A seat's gold-coin count — the generic accessor `barbarianAttackGoldOf` above reads the same
 *  shared `ext.gold` field (TB8.1: T&B scenarios are standalone, so reusing the field is safe); this
 *  alias exists so the main scenario's own files don't read a barbarian-flavored name. 0 outside a
 *  T&B game with a `gold` field / before any award. */
export function tbGoldOf(state: GameState, seat: Seat): number {
  return tbExt(state)?.gold?.[seat] ?? 0;
}

// ---------------------------------------------------------------------------------------------
// Rivers river-edge geometry (T-1003, §TB3.1; parameterized on `BoardGeometry` at T-1051, 5–6).
// Lives HERE rather than in rivers.ts (where the rest of the rivers business logic sits) for
// exactly one reason: `rules/connectivity.ts`'s `canPlaceRoad` — the base engine's single
// occupancy+connectivity gate for EVERY normal-road placement (main-phase builds, Road Building
// free roads, the Explorer helper move, the Trailblazer/Ride-by-Night cardMods combos, …) — must
// reject a river edge too (§TB3.2: only a bridge may cross one), so it needs `isRiverEdge`.
// `rivers.ts` itself imports `canPlaceRoad` (transitively, via `isRoadConnected`/
// `buildBridgeHandler`), so connectivity.ts importing FROM rivers.ts would be a real cycle;
// state.ts has zero engine-internal imports (only `@hexhaven/shared`), so it is the one leaf every
// rule module can safely import this from. `rivers.ts` re-exports these symbols so callers don't
// need to know about this split.
//
// T-1051 (5–6): a fiveSix rivers game plays on the 30-hex `GEOMETRY_EXT56` board instead of the
// base 19-hex one (mirrors T-1050's fishing-grounds rework) — river edges/shore vertices/shore
// edges are no longer a single module-load constant computed from the always-base `GEOMETRY`, but
// a function of whichever `BoardGeometry` the game actually resolved (`geometryForConfig(config)`
// at `createGame`, threaded through `initialRiversExt` in rivers.ts exactly like
// `initialFishermenExt`). The RESULT is precomputed ONCE at `createGame` time and stored in
// `ext.tradersBarbarians.riverEdges`/`riverShoreVertices`/`riverShoreEdges` (never re-derived from
// geometry mid-game, mirroring fishermen's fully-precomputed `fishingGrounds` — no module here ever
// needs `geometryForState`, avoiding a real import cycle back through modules/index.ts ->
// tradersBarbarians/index.ts -> rivers.ts -> state.ts). `isRiverEdge`/`isRiverShoreVertex`/
// `isRiverShoreEdge` below read that per-game ext data (via `state`), so callers pass `state`
// instead of relying on an implicit base-board assumption. `RIVERS_RIVER_EDGES`/
// `RIVERS_SHORE_VERTICES` stay as base-board-only module constants (computed via
// `computeRiverEdges(GEOMETRY)`/`computeShoreVertices` below, same frozen `GEOMETRY` reference as
// before T-1051) — used by `initialRiversExt`'s reference-equality short-circuit (RK-13: a 3–4p
// game's stored ext data is byte-identical to these), and still directly importable for any
// base-board-only caller (client/tests) that only ever deals with 3–4p rivers games.
// ---------------------------------------------------------------------------------------------

/** Shortest edge-trail (BFS, unweighted) from `start` to `goal` over `geometry`'s vertex graph.
 *  Throws (a `BUG:` programmer error, docs/05 §2) if no path exists — unreachable for any of the
 *  engine's board geometries (base or `GEOMETRY_EXT56`), both single connected vertex graphs. Each
 *  river is computed independently over the FULL graph (no edge-avoid set): a river spanning the
 *  island's width is itself an edge CUT of this small a mesh — removing one river's edges before
 *  searching for the other can genuinely disconnect the two rivers' endpoints, so the two searches
 *  must not interfere. Any edges the two rivers happen to share are harmlessly deduped by
 *  `computeRiverEdges` below (real rivers can share a short confluence too). */
function bfsEdgePath(geometry: BoardGeometry, start: VertexId, goal: VertexId): EdgeId[] {
  const cameFrom = new Map<VertexId, { via: EdgeId; from: VertexId }>();
  const visited = new Set<VertexId>([start]);
  const queue: VertexId[] = [start];
  let head = 0;
  while (head < queue.length) {
    const v = queue[head++]!;
    if (v === goal) break;
    const vert = geometry.vertices[v];
    if (!vert) continue;
    for (let i = 0; i < vert.edges.length; i++) {
      const edge = vert.edges[i]!;
      const to = vert.neighbors[i]!;
      if (visited.has(to)) continue;
      visited.add(to);
      cameFrom.set(to, { via: edge, from: v });
      queue.push(to);
    }
  }
  if (!visited.has(goal)) {
    throw new Error(`BUG: rivers found no connected edge path from vertex ${start} to ${goal}`);
  }
  const path: EdgeId[] = [];
  let cur = goal;
  while (cur !== start) {
    const step = cameFrom.get(cur);
    if (!step) throw new Error(`BUG: rivers path reconstruction broke at vertex ${cur}`);
    path.unshift(step.via);
    cur = step.from;
  }
  return path;
}

/** Extreme (min/max) vertex along an axis in `geometry` — used to anchor each river at a board
 *  edge. */
function extremeVertexId(geometry: BoardGeometry, axis: 'x' | 'y', direction: 1 | -1): VertexId {
  let best = geometry.vertices[0];
  if (!best) throw new Error('BUG: rivers geometry init found an empty vertex list');
  for (const v of geometry.vertices) {
    if (direction * v[axis] > direction * best[axis]) best = v;
  }
  return best.id;
}

/**
 * ⚠ VERIFY exact positions against the diagram — an approximate-but-CONNECTED river path is an
 * explicitly-allowed v1 simplification (docs/rules/traders-barbarians-rules.md, mirroring T-1002's
 * fishing-grounds precedent; the 30-hex `GEOMETRY_EXT56` 5–6 case has no rulebook diagram at all —
 * ⚠ VERIFY, T-1051). Two rivers "run across the board" (§TB3.1): each is the shortest edge-trail
 * (BFS over `geometry`'s vertex graph, `geometry.vertices[*].edges/neighbors`) between a pair of
 * roughly-opposite board-extreme vertices — one river runs the board's widest (x) axis, the other
 * its tallest (y) axis, so together they form a rough "+" crossing the island, each end anchored
 * at the coast (an extreme vertex is always on the boundary). Purely a function of `geometry` (no
 * board-size-specific code) — computed once at `createGame` time for whichever geometry the config
 * resolved (never random — the geometry is fixed for a given config, so no `rng` draw is needed).
 */
function computeRiverEdges(geometry: BoardGeometry): EdgeId[] {
  const minX = extremeVertexId(geometry, 'x', -1);
  const maxX = extremeVertexId(geometry, 'x', 1);
  const minY = extremeVertexId(geometry, 'y', -1);
  const maxY = extremeVertexId(geometry, 'y', 1);
  const riverA = bfsEdgePath(geometry, minX, maxX);
  const riverB = bfsEdgePath(geometry, minY, maxY);
  return [...new Set([...riverA, ...riverB])];
}

/** River-shore vertices (§TB3.1) for `geometry`/`riverEdges`: the endpoints of every river edge,
 *  deduped. */
function computeShoreVertices(geometry: BoardGeometry, riverEdges: readonly EdgeId[]): Set<VertexId> {
  return new Set(
    riverEdges.flatMap((id) => {
      const e = geometry.edges[id];
      if (!e) throw new Error(`BUG: river edge ${id} missing from geometry`);
      return [e.a, e.b];
    })
  );
}

/** Every edge of `geometry` incident to a `shoreVertices` member (§TB3.1) — includes the river
 *  edges themselves (their own endpoints trivially qualify), though those require a bridge rather
 *  than a normal road. Precomputed once (alongside `riverEdges`/`shoreVertices`) so `isRiverShoreEdge`
 *  never needs to re-resolve geometry at read time. */
function computeShoreEdges(geometry: BoardGeometry, shoreVertices: ReadonlySet<VertexId>): EdgeId[] {
  const result: EdgeId[] = [];
  for (const e of geometry.edges) {
    if (shoreVertices.has(e.a) || shoreVertices.has(e.b)) result.push(e.id);
  }
  return result;
}

/** The base 3–4p board's fixed river-edge set (§TB3.1) — a module-load constant, byte-identical to
 *  before T-1051 (RK-13). A fiveSix game computes its OWN edges against `GEOMETRY_EXT56` at
 *  `createGame` time instead (see `initialRiversExt`'s `geometry` parameter, rivers.ts). */
export const RIVERS_RIVER_EDGES: readonly EdgeId[] = computeRiverEdges(GEOMETRY);

/** The base 3–4p board's river-shore vertices — a module-load constant, byte-identical to before
 *  T-1051 (RK-13). See `RIVERS_RIVER_EDGES`'s header comment above. */
export const RIVERS_SHORE_VERTICES: ReadonlySet<VertexId> = computeShoreVertices(GEOMETRY, RIVERS_RIVER_EDGES);

/** The base 3–4p board's river-shore edges — a module-load constant (new name at T-1051, but the
 *  same values `isRiverShoreEdge` always computed from `RIVERS_SHORE_VERTICES` before). */
const RIVERS_SHORE_EDGES: readonly EdgeId[] = computeShoreEdges(GEOMETRY, RIVERS_SHORE_VERTICES);

/**
 * Seed the THIS-game river-edge/shore-vertex/shore-edge data for `initialRiversExt` (rivers.ts).
 * `geometry === GEOMETRY` (a 3–4p game, reference equality) short-circuits to the base module
 * constants above — byte-identical result, no recomputation (RK-13). Any other geometry (a fiveSix
 * rivers game's `GEOMETRY_EXT56`, T-1051) recomputes fresh against it.
 */
export function riverGeometryFor(geometry: BoardGeometry): {
  riverEdges: EdgeId[];
  riverShoreVertices: VertexId[];
  riverShoreEdges: EdgeId[];
} {
  if (geometry === GEOMETRY) {
    return {
      riverEdges: [...RIVERS_RIVER_EDGES],
      riverShoreVertices: [...RIVERS_SHORE_VERTICES],
      riverShoreEdges: [...RIVERS_SHORE_EDGES],
    };
  }
  const riverEdges = computeRiverEdges(geometry);
  const shoreVertices = computeShoreVertices(geometry, riverEdges);
  const riverShoreEdges = computeShoreEdges(geometry, shoreVertices);
  return { riverEdges, riverShoreVertices: [...shoreVertices], riverShoreEdges };
}

/** THIS game's river edges (§TB3.1) — `[]` outside a rivers game (before `initialRiversExt` seeds
 *  it, or in a non-rivers game entirely). */
export function riverEdgesOf(state: GameState): readonly EdgeId[] {
  return tbExt(state)?.riverEdges ?? [];
}

/** THIS game's river-shore vertices (§TB3.1) — `[]` outside a rivers game. */
export function riverShoreVerticesOf(state: GameState): readonly VertexId[] {
  return tbExt(state)?.riverShoreVertices ?? [];
}

/** THIS game's river-shore edges (§TB3.1) — `[]` outside a rivers game. */
export function riverShoreEdgesOf(state: GameState): readonly EdgeId[] {
  return tbExt(state)?.riverShoreEdges ?? [];
}

/** Is `edge` one of `state`'s river edges (§TB3.1)? Always `false` outside a rivers game. */
export function isRiverEdge(state: GameState, edge: EdgeId): boolean {
  return riverEdgesOf(state).includes(edge);
}

/** Is `vertex` one of `state`'s river-shore vertices (§TB3.1)? Always `false` outside a rivers
 *  game. */
export function isRiverShoreVertex(state: GameState, vertex: VertexId): boolean {
  return riverShoreVerticesOf(state).includes(vertex);
}

/** Is `edge` incident to one of `state`'s river-shore vertices (§TB3.1)? Includes the river edges
 *  themselves (their own endpoints trivially qualify), though those require a bridge rather than a
 *  normal road. Always `false` outside a rivers game. */
export function isRiverShoreEdge(state: GameState, edge: EdgeId): boolean {
  return riverShoreEdgesOf(state).includes(edge);
}
