// beginnerLayout.ts — the HEXHAVEN "beginner" fixed board layout (R2.6, ER-12, D-015/D-016).
//
// STATUS (T-607): the OFFICIAL printed beginner board. Terrain + number tokens (`BEGINNER_HEXES`)
// and harbor types + order (`BEGINNER_HARBORS`) were transcribed hex-by-hex and harbor-by-harbor
// from the base-game rulebook "Starting Map for Beginners — Illustration A" (page 3), as recorded in
// `docs/rules/preset-boards-RESEARCH.md` Section A (confidence HIGH). This is the real printed board,
// not a balanced placeholder. `BEGINNER_HEXES` was already correct at T-606; T-607 only reordered
// `BEGINNER_HARBORS` to the printed arrangement (same multiset).
// What is verified here and asserted by tests:
//   - terrain multiset === the base game's `TERRAIN_COUNTS` (4 forest/pasture/fields, 3 hills/
//     mountains, 1 desert),
//   - number-token multiset === the base game's `TOKEN_SPIRAL` (one each of 2/12, two each of the
//     rest, no 7),
//   - harbor multiset === the base game's `HARBOR_MIX` (4 generic + one 2:1 per resource),
//   - exactly one desert (robber starts there, `token: null`),
//   - R2.5 legality: no two hexes carrying a 6 or 8 are adjacent.
// The layout is a legal, balanced, FIXED board (identical every game, zero RNG consumed) — the point
// of the beginner option. The only residual imprecision is the exact coast edge of the two bottom
// *generic* 3:1 harbors (±1 edge, gameplay-immaterial per D-016; see research A.2's ±1 note); every
// specific 2:1 harbor and all terrain/tokens are exact.
//
// Beginner is base-19 only: no verified 30-hex fixed layout exists, so `boardGen` rejects
// `board: 'beginner'` when the fiveSix module is active (the client also hides the option there).
//
// Hex ids are assigned by `buildGeometry` (docs/03 §1.2: hexes sorted by (r, q), index = HexId),
// NOT by printed diagram order. For the base radius-2 hexagon this makes the printed rows map to
// HexId ranges as: top row (r=-2) → 0,1,2 · row (r=-1) → 3,4,5,6 · middle (r=0) → 7,8,9,10,11 ·
// row (r=1) → 12,13,14,15 · bottom (r=2) → 16,17,18, left-to-right within each row.

import type {
  BoardGeometry,
  EdgeId,
  GameState,
  HarborType,
  HexId,
  HexTile,
  TerrainType,
} from '@hexhaven/shared';
import type { ModuleBoardParams } from './modules/types.js';

/** One hex of the beginner board: its printed terrain + number token (null only for the desert). */
interface BeginnerHexRow {
  terrain: TerrainType;
  token: number | null;
}

/**
 * The 19 hexes of the beginner board, indexed by HexId (0…18). A fixed, balanced arrangement whose
 * terrain and token multisets match the base game exactly (asserted in tests); see the file header
 * for the verification stance (D-016-style flag). Rows below are grouped by the printed 3-4-5-4-3
 * layout for readability.
 */
const BEGINNER_HEXES: readonly BeginnerHexRow[] = [
  // top row (r = -2): HexId 0,1,2
  { terrain: 'mountains', token: 10 },
  { terrain: 'pasture', token: 2 },
  { terrain: 'forest', token: 9 },
  // row (r = -1): HexId 3,4,5,6
  { terrain: 'fields', token: 12 },
  { terrain: 'hills', token: 6 },
  { terrain: 'pasture', token: 4 },
  { terrain: 'hills', token: 10 },
  // middle row (r = 0): HexId 7,8,9,10,11 — HexId 9 is the central desert
  { terrain: 'fields', token: 9 },
  { terrain: 'forest', token: 11 },
  { terrain: 'desert', token: null },
  { terrain: 'forest', token: 3 },
  { terrain: 'mountains', token: 8 },
  // row (r = 1): HexId 12,13,14,15
  { terrain: 'forest', token: 8 },
  { terrain: 'mountains', token: 3 },
  { terrain: 'fields', token: 4 },
  { terrain: 'pasture', token: 5 },
  // bottom row (r = 2): HexId 16,17,18
  { terrain: 'hills', token: 5 },
  { terrain: 'fields', token: 6 },
  { terrain: 'pasture', token: 11 },
];

/**
 * The beginner harbor types, in `GEOMETRY.harborSpots` order (entry i is the harbor on the coast
 * edge `harborSpots[i]`). This is the OFFICIAL printed arrangement (research A.2): reading the ship
 * icons around Illustration A clockwise from the top-left generic gives
 * generic · grain · ore · generic · wool · generic · generic · brick · lumber. Multiset matches
 * `HARBOR_MIX` (4 generic + one 2:1 per resource); only the two bottom generics are ±1 edge (D-016).
 */
const BEGINNER_HARBORS: readonly HarborType[] = [
  'generic',
  'grain',
  'ore',
  'generic',
  'wool',
  'generic',
  'generic',
  'brick',
  'lumber',
];

/** Multiset (value → count) of a list, for order-independent equality checks. */
function tally<T extends string | number>(items: Iterable<T>): Map<T, number> {
  const out = new Map<T, number>();
  for (const item of items) out.set(item, (out.get(item) ?? 0) + 1);
  return out;
}

function multisetsEqual<T extends string | number>(a: Map<T, number>, b: Map<T, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Hex-to-hex adjacency (shared edge) for legality checks — mirrors boardGen's `hexNeighbors`. */
function hexNeighbors(geometry: BoardGeometry): HexId[][] {
  const out: HexId[][] = geometry.hexes.map(() => []);
  for (const edge of geometry.edges) {
    if (edge.hexes.length !== 2) continue;
    const [a, b] = edge.hexes as [HexId, HexId];
    out[a]?.push(b);
    out[b]?.push(a);
  }
  return out;
}

/**
 * Build the fixed beginner board (R2.6). Pure and deterministic — no rng consumed, identical output
 * every call. Validates the two tables above against the resolved board params (`geometry`,
 * `params`) so a data typo or a mismatched (e.g. 5–6) param set fails loudly rather than producing
 * an illegal board. Only valid for the base 19-hex board; the caller (boardGen) gates fiveSix out.
 */
export function buildBeginnerBoard(
  geometry: BoardGeometry,
  params: ModuleBoardParams
): GameState['board'] {
  if (geometry.hexes.length !== BEGINNER_HEXES.length) {
    throw new Error(
      `BUG: beginner layout has ${BEGINNER_HEXES.length} hexes but geometry has ` +
        `${geometry.hexes.length} — beginner is defined for the base 19-hex board only`
    );
  }

  const hexes: HexTile[] = BEGINNER_HEXES.map((row) => ({ terrain: row.terrain, token: row.token }));

  // Terrain multiset must equal the resolved terrain counts (R1.2).
  const terrainTally = tally(hexes.map((h) => h.terrain));
  const expectedTerrain = new Map<TerrainType, number>(
    Object.entries(params.terrainCounts) as [TerrainType, number][]
  );
  if (!multisetsEqual(terrainTally, expectedTerrain)) {
    throw new Error('BUG: beginner terrain multiset does not match the resolved terrain counts');
  }

  // Exactly one desert (with no token); every other hex carries a token.
  const desertIds = hexes.flatMap((h, i) => (h.terrain === 'desert' ? [i as HexId] : []));
  if (desertIds.length !== 1) {
    throw new Error(`BUG: beginner layout must have exactly one desert, found ${desertIds.length}`);
  }
  const robber = desertIds[0]!;
  for (let i = 0; i < hexes.length; i++) {
    const tile = hexes[i]!;
    if (tile.terrain === 'desert' ? tile.token !== null : tile.token === null) {
      throw new Error(`BUG: beginner hex ${i} token/desert mismatch`);
    }
  }

  // Token multiset (non-desert) must equal the resolved spiral multiset (R2.3 pieces).
  const tokenTally = tally(hexes.map((h) => h.token).filter((t): t is number => t !== null));
  if (!multisetsEqual(tokenTally, tally(params.tokenSpiral))) {
    throw new Error('BUG: beginner token multiset does not match the resolved token multiset');
  }

  // R2.5: no two adjacent hexes both carry a 6 or 8.
  const neighbors = hexNeighbors(geometry);
  const isRed = (t: number | null): boolean => t === 6 || t === 8;
  for (let id = 0; id < hexes.length; id++) {
    if (!isRed(hexes[id]!.token)) continue;
    for (const n of neighbors[id] ?? []) {
      if (isRed(hexes[n]?.token ?? null)) {
        throw new Error(`BUG: beginner layout has adjacent red tokens at hexes ${id} and ${n}`);
      }
    }
  }

  // Harbor multiset must equal the resolved harbor mix, one per fixed harbor spot (R2.2 positions).
  if (BEGINNER_HARBORS.length !== geometry.harborSpots.length) {
    throw new Error(
      `BUG: beginner has ${BEGINNER_HARBORS.length} harbors but geometry has ` +
        `${geometry.harborSpots.length} spots`
    );
  }
  if (!multisetsEqual(tally(BEGINNER_HARBORS), tally(params.harborMix))) {
    throw new Error('BUG: beginner harbor multiset does not match the resolved harbor mix');
  }
  const harbors: Record<EdgeId, HarborType> = {};
  geometry.harborSpots.forEach((edge, i) => {
    harbors[edge] = BEGINNER_HARBORS[i]!;
  });

  return { hexes, robber, harbors };
}

// Exported for this file's own tests (multiset/legality assertions mirror boardGen.test.ts).
export { BEGINNER_HEXES, BEGINNER_HARBORS };
