// Board generator (docs/03 §1, R2, T-101): builds the terrain/token/harbor/robber layout for a
// new game, deterministically from the threaded rng state (docs/03 §6). Structured entirely
// around resolved geometry/layout data (hex count, spiral order, harbor spots) and module board
// params (terrain/token/harbor multisets) — no literal 19/54/72 here — so the 5–6 module reuses
// this with GEOMETRY_EXT56 + its own multisets (docs/10 §3).

import type {
  BoardGeometry,
  EdgeId,
  GameConfig,
  GameState,
  HarborType,
  HexId,
  HexTile,
  TerrainType,
} from '@hexhaven/shared';
import { buildBeginnerBoard } from './beginnerLayout.js';
import { geometryForConfig, resolveBoardParams } from './modules/index.js';
import { shuffle } from './rng.js';

/** The board-shaping slice of a config; `expansions` is optional so base callers can omit it.
 *  `playerCount` is only consulted for module boards that vary by it (seafarers scenarios), and a
 *  seafarers game never routes through here (createGame calls generateScenarioBoard directly) — so a
 *  base/fiveSix default is harmless. */
type BoardConfig = Pick<GameConfig, 'board' | 'tokenMethod'> & {
  expansions?: GameConfig['expansions'];
  playerCount?: GameConfig['playerCount'];
};

const NO_EXPANSIONS: GameConfig['expansions'] = {
  fiveSix: false,
  seafarers: false,
  citiesKnights: false,
};

/**
 * Hex-to-hex adjacency for a geometry: two hexes are adjacent iff they share an edge (an edge with
 * 2 bordering hexes). Computed from `geometry.edges` — GEOMETRY doesn't publish this directly
 * (edges/vertices are the primitive tables, docs/03 §1.3).
 */
function hexNeighbors(geometry: BoardGeometry): HexId[][] {
  const out: HexId[][] = geometry.hexes.map(() => []);
  for (const edge of geometry.edges) {
    if (edge.hexes.length !== 2) continue; // coastal edge — only one side is on-board
    const [a, b] = edge.hexes as [HexId, HexId];
    const listA = out[a];
    const listB = out[b];
    if (!listA || !listB) throw new Error(`BUG: edge ${edge.id} references an out-of-range hex`);
    listA.push(b);
    listB.push(a);
  }
  return out;
}

function isRedToken(token: number | null): boolean {
  return token === 6 || token === 8; // R2.5: the two "red" high-probability numbers
}

/** R2.5 legality check: true if any two adjacent hexes both carry a 6 or 8. */
function hasAdjacentRedConflict(hexes: readonly HexTile[], neighbors: readonly HexId[][]): boolean {
  for (let hexId = 0; hexId < hexes.length; hexId++) {
    const tile = hexes[hexId];
    if (!tile || !isRedToken(tile.token)) continue;
    const list = neighbors[hexId];
    if (!list) throw new Error(`BUG: no neighbor list for hex ${hexId}`);
    for (const n of list) {
      const neighborTile = hexes[n];
      if (neighborTile && isRedToken(neighborTile.token)) return true;
    }
  }
  return false;
}

/** The terrain multiset (R1.2) for the resolved board as a flat bag, ready to shuffle. */
function terrainBag(counts: Readonly<Record<TerrainType, number>>): TerrainType[] {
  const bag: TerrainType[] = [];
  for (const terrain of Object.keys(counts) as TerrainType[]) {
    const count = counts[terrain];
    for (let i = 0; i < count; i++) bag.push(terrain);
  }
  return bag;
}

/** R2.3: walk the official spiral, skipping deserts, assigning `tokenSpiral` values in order. */
function assignTokensSpiral(
  hexes: HexTile[],
  spiralOrder: readonly HexId[],
  tokenSpiral: readonly number[]
): void {
  let i = 0;
  for (const hexId of spiralOrder) {
    const tile = hexes[hexId];
    if (!tile) throw new Error(`BUG: spiral hex ${hexId} is outside the board`);
    if (tile.terrain === 'desert') continue; // R2.3: deserts are skipped and get no token
    const token = tokenSpiral[i];
    if (token === undefined) throw new Error('BUG: token spiral exhausted before the board');
    tile.token = token;
    i += 1;
  }
}

// R2.5: cap on redraw attempts before giving up. Never expected to trigger in practice — asserted
// by a many-seed test in boardGen.test.ts, not by any analytic bound.
const MAX_SHUFFLED_TOKEN_ATTEMPTS = 1000;

/**
 * R2.5 ("shuffled" token method): randomly assign the token bag to the non-desert hexes,
 * redrawing until no two hexes carrying 6 or 8 are adjacent. Mutates `hexes` in place — always a
 * freshly built local array here, never the caller's state. Returns the advanced rng state.
 */
function assignTokensShuffled(
  rng: number,
  hexes: HexTile[],
  neighbors: readonly HexId[][],
  tokenSpiral: readonly number[]
): number {
  const nonDesertIds: HexId[] = [];
  hexes.forEach((tile, id) => {
    if (tile.terrain !== 'desert') nonDesertIds.push(id as HexId);
  });
  if (nonDesertIds.length !== tokenSpiral.length) {
    throw new Error(
      `BUG: ${nonDesertIds.length} non-desert hexes but ${tokenSpiral.length} tokens`
    );
  }

  let s = rng;
  for (let attempt = 0; attempt < MAX_SHUFFLED_TOKEN_ATTEMPTS; attempt++) {
    const draw = shuffle(s, [...tokenSpiral]);
    s = draw.state;
    nonDesertIds.forEach((hexId, i) => {
      const tile = hexes[hexId];
      const token = draw.array[i];
      if (!tile || token === undefined) throw new Error(`BUG: token/hex mismatch at index ${i}`);
      tile.token = token;
    });
    if (!hasAdjacentRedConflict(hexes, neighbors)) return s;
  }
  throw new Error(
    `BUG: shuffled token placement could not satisfy the no-adjacent-6/8 rule (R2.5) in ` +
      `${MAX_SHUFFLED_TOKEN_ATTEMPTS} attempts`
  );
}

/**
 * Generate a legal board (docs/03 §1, R2) from the threaded rng state. Pure and deterministic:
 * identical `rng` + `config` ⇒ identical output. Order of business: resolve geometry + multisets
 * from the config's modules → shuffle terrain onto HexIds (R2.1) → robber/desert follow (R2.4) →
 * place tokens per `tokenMethod` (R2.3 or R2.5) → shuffle harbors onto the fixed spots (R2.2).
 */
export function generateBoard(
  rng: number,
  config: BoardConfig
): { rng: number; board: GameState['board'] } {
  const expansions = config.expansions ?? NO_EXPANSIONS;
  const playerCount = config.playerCount ?? 4;
  const geometry = geometryForConfig({ expansions, playerCount });
  const params = resolveBoardParams({ expansions, playerCount });

  if (config.board === 'beginner') {
    // R2.6/ER-12/D-015/D-016 (T-606): a fixed, deterministic, gameplay-valid beginner board. Only
    // defined for the base 19-hex board — there is no verified 30-hex fixed layout, so a fiveSix
    // game may not request it (defense in depth; the client hides the option there). No rng is
    // consumed for a fixed board, so the caller's rng passes straight through unchanged.
    if (expansions.fiveSix) {
      throw Object.assign(
        new Error(
          'EXPANSION_NOT_AVAILABLE: the beginner board is only available on the base 19-hex ' +
            'board, not the 5–6 (30-hex) board — use config.board = "random" with fiveSix'
        ),
        { code: 'EXPANSION_NOT_AVAILABLE' }
      );
    }
    return { rng, board: buildBeginnerBoard(geometry, params) };
  }

  // R2.1: shuffle the terrain multiset onto HexIds (Fisher–Yates via rng.ts).
  const terrainDraw = shuffle(rng, terrainBag(params.terrainCounts));
  if (terrainDraw.array.length !== geometry.hexes.length) {
    throw new Error(
      `BUG: terrain bag has ${terrainDraw.array.length} tiles but the board has ` +
        `${geometry.hexes.length} hexes`
    );
  }
  const hexes: HexTile[] = terrainDraw.array.map((terrain) => ({ terrain, token: null }));
  let s = terrainDraw.state;

  // R2.4: the robber starts on a desert — the first one the terrain shuffle produced.
  const desertId = hexes.findIndex((h) => h.terrain === 'desert');
  if (desertId < 0) throw new Error('BUG: terrain shuffle produced a board with no desert hex');
  const robber = desertId as HexId;

  if (config.tokenMethod === 'shuffled') {
    s = assignTokensShuffled(s, hexes, hexNeighbors(geometry), params.tokenSpiral); // R2.5
  } else {
    assignTokensSpiral(hexes, geometry.hexSpiralOrder, params.tokenSpiral); // R2.3 (default)
  }

  // R2.2: shuffle the harbor mix onto the fixed harbor spots.
  const harborDraw = shuffle(s, [...params.harborMix]);
  s = harborDraw.state;
  if (harborDraw.array.length !== geometry.harborSpots.length) {
    throw new Error(
      `BUG: harbor mix has ${harborDraw.array.length} entries but the board has ` +
        `${geometry.harborSpots.length} harbor spots`
    );
  }
  const harbors: Record<EdgeId, HarborType> = {};
  geometry.harborSpots.forEach((edge, i) => {
    const type = harborDraw.array[i];
    if (type === undefined) throw new Error(`BUG: no harbor type at harborSpots index ${i}`);
    harbors[edge] = type;
  });

  return { rng: s, board: { hexes, robber, harbors } };
}
