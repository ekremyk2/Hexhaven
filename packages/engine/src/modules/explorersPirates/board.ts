// Explorers & Pirates — the "Land Ho!" scenario board (T-1102 test board, promoted to the REAL v1
// frame by T-1107, docs/rules/explorers-pirates-rules.md §EP2). ⚠ VERIFY: this is NOT a bespoke
// three-island, much-larger-than-base authored frame (EP2.1/EP2.2 describe one) — T-1107 reuses this
// smaller, already-valid stand-in rather than author a new large geometry, given the scope/effort
// trade-off (an approximate-but-valid coastline is the task's own explicit allowance, "like the
// seafarers board's MEDIUM confidence"). The base 19-hex `GEOMETRY`'s 7 INNER hexes (ring-distance
// <= 1 from the center) become the home island, its 12 OUTER-ring hexes (ring-distance 2) become the
// explorable fog — a real, valid `buildGeometry` coastline (literally the standard base frame) with
// genuine sea routes for ships to sail. `createGame` calls this directly for a `landHo` config
// (createGame.ts's E&P branch); `resolveBoardParams`/`resolveConstants` (modules/index.ts) expose its
// fixed 6-token home-island multiset so the sim's I8 invariant can still cross-check it.
//
// Mirrors seafarers/board.ts's "terrain PROXY" discipline: `board.hexes[i].terrain` stores a base
// `TerrainType` (sea -> desert, never produces) so untouched base render/production code keeps
// working; the AUTHORITATIVE per-hex classification lives in the returned `seaMap` (this module's
// analogue of `ext.seafarers.hexTerrain`), aligned to `GEOMETRY.hexes` by HexId.
//
// T-1150 (Phase 11B, §EP1.2/§EP2, ⚠ VERIFY liberally — no E&P rulebook images on record for a 5–6
// frame): `buildLandHoBoard56` below is a SEPARATE, bigger board builder for the 5–6 player extension
// — E&P (unlike Traders & Barbarians, T-1050) has its OWN scenario board rather than reusing the
// shared 30-hex `GEOMETRY_EXT56`, so 5–6 needs its own bigger frame instead. Built from a fresh
// radius-3 hexagon layout (37 hexes) via the same `buildGeometry` the base/EXT56 layouts use (own
// `BoardLayout` authored HERE, not in packages/shared — this module owns its board, mirrors how
// `buildLandHoBoardV0` already keeps its geometry choice local rather than adding a shared constant):
// the inner 19 hexes (ring-distance <= 2, EXACTLY the base board's own hex count/shape) become the
// home island — reuses the base game's own `TERRAIN_COUNTS`/`TOKEN_SPIRAL` multisets directly (a
// defensible "same island size/composition as a normal 4p board, just for more starting seats" v1
// reading, ⚠ VERIFY against any real 5–6 Land Ho! frame) — while the outer 18 hexes (ring-distance
// == 3) become a bigger open-sea exploration ring (vs the 3–4 board's 12). `buildLandHoBoardV0`
// itself is UNTOUCHED (byte-identical, RK-13) — both now delegate to the shared `buildLandHoBoardOn`
// helper below, parameterized on geometry/terrain/token inputs, so the two board sizes can't drift
// out of sync with each other's shuffle/robber/seaMap logic.

import { GEOMETRY, TOKEN_SPIRAL, buildGeometry } from '@hexhaven/shared';
import type {
  BoardGeometry,
  BoardLayout,
  GameState,
  HexId,
  HexTile,
  ScenarioTerrain,
  TerrainType,
} from '@hexhaven/shared';
import { shuffle } from '../../rng.js';

/**
 * ⚠ VERIFY v1 approximation: 6 land terrains + 1 desert on the 7-hex home island — a scaled-down
 * version of the base 19-hex terrain multiset (docs/03 §1 `TERRAIN_COUNTS`). The real Land Ho!
 * terrain supply is T-1107's to author from the physical rulebook/mission guide.
 */
export const LAND_HO_V0_TERRAINS: readonly TerrainType[] = [
  'hills',
  'forest',
  'forest',
  'pasture',
  'fields',
  'mountains',
  'desert',
];

/**
 * ⚠ VERIFY v1 approximation: number tokens for the 6 non-desert home-island hexes. No 6/8-adjacency
 * check (unlike the base game's real `createGame` placement rule, docs/03 §1) — a "good enough for
 * ship-engine tests" v1 simplification; the real Land Ho! token layout is T-1107's job.
 */
export const LAND_HO_V0_TOKENS: readonly number[] = [5, 6, 8, 9, 10, 3];

/** Axial ring-distance from the board center (mirrors modules/tradersBarbarians/{main,
 *  barbarianAttack}.ts's own `hexDistance` — an independent copy, per that module's own
 *  "every scenario file is self-contained" precedent). */
function hexDistance(hex: { q: number; r: number }): number {
  return Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r));
}

/**
 * Shared board-building logic for BOTH board sizes (T-1150 extraction — `buildLandHoBoardV0`/
 * `buildLandHoBoard56` are now thin callers, byte-identical to `buildLandHoBoardV0`'s own PRE-T-1150
 * body): every `geometry` hex with ring-distance <= `landRingMax` becomes home-island land (shuffled
 * across `terrains`/`tokens`), every hex beyond it becomes open sea/fog. Throws (a `BUG:` programmer
 * error, unchanged discipline) if the land-hex count doesn't match `terrains.length`.
 */
function buildLandHoBoardOn(
  rng: GameState['rng'],
  geometry: BoardGeometry,
  landRingMax: number,
  terrains: readonly TerrainType[],
  tokens: readonly number[]
): { board: GameState['board']; seaMap: ScenarioTerrain[]; rng: GameState['rng'] } {
  const landHexIds = geometry.hexes.filter((h) => hexDistance(h) <= landRingMax).map((h) => h.id);
  const seaHexIds = geometry.hexes.filter((h) => hexDistance(h) > landRingMax).map((h) => h.id);
  if (landHexIds.length !== terrains.length) {
    throw new Error(
      `BUG: buildLandHoBoardOn expected exactly ${terrains.length} inner hexes on the given geometry, found ${landHexIds.length}`
    );
  }

  const terrainShuffle = shuffle(rng, terrains);
  const shuffledTerrains = terrainShuffle.array;
  const tokenShuffle = shuffle(terrainShuffle.state, tokens);
  const shuffledTokens = tokenShuffle.array;

  const seaMap: ScenarioTerrain[] = geometry.hexes.map(() => 'sea');
  const hexes: HexTile[] = geometry.hexes.map(() => ({ terrain: 'desert' as TerrainType, token: null }));
  let robber: HexId = landHexIds[0]!;
  let tokenIdx = 0;

  landHexIds.forEach((hexId, i) => {
    const terrain = shuffledTerrains[i]!;
    seaMap[hexId] = terrain;
    if (terrain === 'desert') {
      hexes[hexId] = { terrain: 'desert', token: null };
      robber = hexId;
    } else {
      const token = shuffledTokens[tokenIdx]!;
      tokenIdx += 1;
      hexes[hexId] = { terrain, token };
    }
  });
  for (const hexId of seaHexIds) {
    seaMap[hexId] = 'sea';
    hexes[hexId] = { terrain: 'desert', token: null };
  }

  return { board: { hexes, robber, harbors: {} }, seaMap, rng: tokenShuffle.state };
}

/**
 * `buildLandHoBoardV0(rng)` (T-1102 ⚠ VERIFY minimal test board, see this file's header): the base
 * `GEOMETRY`'s inner 7 hexes (ring-distance <= 1) become a small home island; its outer 12
 * (ring-distance 2) become open sea. Terrain + tokens are SHUFFLED across the 7 land hexes via the
 * threaded `rng` (never `Math.random`, docs/05 §2) so repeated calls don't hand back an identical
 * layout; the desert hex always gets `token: null` and becomes the robber's start (R1.1). Returns
 * the resolved `board` (base-terrain PROXY: sea -> desert, never produces) alongside the
 * authoritative `seaMap` (aligned to `GEOMETRY.hexes` by HexId) and the advanced `rng` state.
 *
 * T-1150: now a thin call into `buildLandHoBoardOn` — same geometry/ring/terrain/token inputs as
 * before, so this function's own output stream is UNCHANGED (RK-13/every existing E&P 3–4 sim/test
 * byte-identical).
 */
export function buildLandHoBoardV0(
  rng: GameState['rng']
): { board: GameState['board']; seaMap: ScenarioTerrain[]; rng: GameState['rng'] } {
  return buildLandHoBoardOn(rng, GEOMETRY, 1, LAND_HO_V0_TERRAINS, LAND_HO_V0_TOKENS);
}

// ---------------------------------------------------------------------------------------------------
// T-1150 (Phase 11B): the 5–6 player extension board — see this file's header for the design.
// ---------------------------------------------------------------------------------------------------

/** A radius-3 hexagon (37 hexes: 1 + 6 + 12 + 18, ring-distances 0–3) — the 5–6 Land Ho! frame's raw
 *  coordinate list, built the same way `BASE_LAYOUT`'s own `hexagonHexes(2)` is (packages/shared/src/
 *  geometry.ts) but kept local to this module (E&P owns its board, not packages/shared). */
function landHo56Hexes(): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let q = -3; q <= 3; q++) {
    for (let r = -3; r <= 3; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 3) out.push({ q, r });
    }
  }
  return out;
}

/** ⚠ VERIFY (no E&P rulebook images on record for a 5–6 frame): no harbors in the v1 5–6 Land Ho!
 *  board either (mirrors the 3–4 board, `resolveBoardParams`'s `harborMix: []`) — `harborCoastIndices`
 *  is empty. `spiralStart` is unused by `buildLandHoBoardOn` (tokens shuffle directly onto land hex
 *  ids, not via the spiral) but `buildGeometry` still requires a valid on-layout hex; reuses the same
 *  top-right-corner convention `EXT56_LAYOUT` picked. */
const LAND_HO_56_LAYOUT: BoardLayout = {
  hexes: landHo56Hexes(),
  harborCoastIndices: [],
  spiralStart: { q: 3, r: -3 },
};

/** The 5–6 Land Ho! board geometry (37 hexes), built once at module load — mirrors `GEOMETRY`/
 *  `GEOMETRY_EXT56`'s own "frozen, built-once" convention (packages/shared/src/geometry.ts). */
export const LAND_HO_56_GEOMETRY: BoardGeometry = buildGeometry(LAND_HO_56_LAYOUT);

/**
 * ⚠ VERIFY (this task's own v1 DECISION, no rulebook source): the 5–6 home island is 19 hexes
 * (ring-distance <= 2 on `LAND_HO_56_GEOMETRY`) — reuses the BASE game's own `TERRAIN_COUNTS`
 * multiset (3 hills / 4 forest / 4 pasture / 4 fields / 3 mountains / 1 desert) directly, on the
 * reading that a bigger 5–6 home island is "the same size/composition as a normal 4-player board,
 * just seating more players" rather than an invented new ratio.
 */
export const LAND_HO_56_TERRAINS: readonly TerrainType[] = [
  'hills',
  'hills',
  'hills',
  'forest',
  'forest',
  'forest',
  'forest',
  'pasture',
  'pasture',
  'pasture',
  'pasture',
  'fields',
  'fields',
  'fields',
  'fields',
  'mountains',
  'mountains',
  'mountains',
  'desert',
];

/** ⚠ VERIFY (mirrors `LAND_HO_56_TERRAINS`): the 18 number tokens for the 5–6 home island's 18
 *  non-desert hexes — reuses the BASE game's own `TOKEN_SPIRAL` multiset directly (same "same size as
 *  a normal 4p board" reading as the terrain multiset above). No 6/8-adjacency check, same allowance
 *  as `LAND_HO_V0_TOKENS`. */
export const LAND_HO_56_TOKENS: readonly number[] = TOKEN_SPIRAL;

/**
 * `buildLandHoBoard56(rng)` (T-1150, ⚠ VERIFY liberally — see this file's header): the 5–6 player
 * extension's bigger Land Ho! frame — `LAND_HO_56_GEOMETRY`'s inner 19 hexes (ring-distance <= 2)
 * become the home island, its outer 18 (ring-distance 3) become the open-sea exploration ring (vs the
 * 3–4 board's 7 home/12 sea). Mirrors `buildLandHoBoardV0` exactly otherwise (same shuffle/robber/
 * seaMap discipline, via the shared `buildLandHoBoardOn` helper).
 */
export function buildLandHoBoard56(
  rng: GameState['rng']
): { board: GameState['board']; seaMap: ScenarioTerrain[]; rng: GameState['rng'] } {
  return buildLandHoBoardOn(rng, LAND_HO_56_GEOMETRY, 2, LAND_HO_56_TERRAINS, LAND_HO_56_TOKENS);
}
