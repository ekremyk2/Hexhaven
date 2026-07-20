// T-606: the fixed Beginner board (R2.6/ER-12/D-015/D-016). Asserts it is deterministic, consumes
// no rng, matches the base multisets exactly, is legal (R2.5 no-adjacent-red, robber on desert),
// and that combining it with the 5–6 (30-hex) board is rejected. The random path is covered by
// boardGen.test.ts / the RK-13 oracle and is intentionally untouched here.
import { describe, expect, it } from 'vitest';
import { GEOMETRY, HARBOR_MIX, TERRAIN_COUNTS, TOKEN_SPIRAL } from '@hexhaven/shared';
import type { GameConfig, GameState, TerrainType } from '@hexhaven/shared';
import { BEGINNER_HARBORS, BEGINNER_HEXES } from './beginnerLayout.js';
import { generateBoard } from './boardGen.js';
import { createGame } from './createGame.js';
import { hashSeed } from './rng.js';

const BASE_EXPANSIONS: GameConfig['expansions'] = {
  fiveSix: false,
  seafarers: false,
  citiesKnights: false,
};

function beginnerConfig(seed: string): GameConfig {
  return {
    playerCount: 4,
    targetVp: 10,
    seed,
    board: 'beginner',
    tokenMethod: 'spiral',
    expansions: BASE_EXPANSIONS,
  };
}

function terrainCountsOf(board: GameState['board']): Partial<Record<TerrainType, number>> {
  const counts: Partial<Record<TerrainType, number>> = {};
  for (const hex of board.hexes) counts[hex.terrain] = (counts[hex.terrain] ?? 0) + 1;
  return counts;
}

function sortedTokensOf(board: GameState['board']): number[] {
  return board.hexes
    .map((h) => h.token)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
}

/** Hex adjacency from GEOMETRY: two hexes are adjacent iff they share an edge (mirrors boardGen). */
const NEIGHBORS: readonly (readonly number[])[] = (() => {
  const out: number[][] = GEOMETRY.hexes.map(() => []);
  for (const edge of GEOMETRY.edges) {
    if (edge.hexes.length !== 2) continue;
    const [a, b] = edge.hexes;
    if (a === undefined || b === undefined) throw new Error('unreachable: 2-hex edge');
    out[a]?.push(b);
    out[b]?.push(a);
  }
  return out;
})();

describe('beginner board — deterministic & rng-free', () => {
  it('produces byte-identical boards regardless of seed (fixed layout, no rng consumed)', () => {
    const a = createGame(beginnerConfig('alpha')).board;
    const b = createGame(beginnerConfig('totally-different-seed')).board;
    expect(a).toEqual(b);
  });

  it('generateBoard returns the caller rng unchanged (no draws for a fixed board)', () => {
    const rng = hashSeed('anything');
    const result = generateBoard(rng, { board: 'beginner', tokenMethod: 'spiral', expansions: BASE_EXPANSIONS });
    expect(result.rng).toBe(rng);
  });

  it('matches the encoded BEGINNER_HEXES table exactly (terrain + token per HexId)', () => {
    const board = createGame(beginnerConfig('x')).board;
    expect(board.hexes).toEqual(BEGINNER_HEXES.map((r) => ({ terrain: r.terrain, token: r.token })));
  });

  it('places the encoded BEGINNER_HARBORS on the fixed harbor spots', () => {
    const board = createGame(beginnerConfig('x')).board;
    GEOMETRY.harborSpots.forEach((edge, i) => {
      expect(board.harbors[edge]).toBe(BEGINNER_HARBORS[i]);
    });
    expect(Object.keys(board.harbors)).toHaveLength(GEOMETRY.harborSpots.length);
  });

  it('uses the OFFICIAL printed harbor order (research A.2 — not the old placeholder)', () => {
    // The exact clockwise reading of Illustration A's ship icons (T-607 fix).
    expect(BEGINNER_HARBORS).toEqual([
      'generic',
      'grain',
      'ore',
      'generic',
      'wool',
      'generic',
      'generic',
      'brick',
      'lumber',
    ]);
  });
});

describe('beginner board — legal & multiset-exact (identical pieces to the random game)', () => {
  const board = createGame(beginnerConfig('legal')).board;

  it('has the base terrain multiset', () => {
    expect(terrainCountsOf(board)).toEqual(TERRAIN_COUNTS);
  });

  it('has the base number-token multiset', () => {
    expect(sortedTokensOf(board)).toEqual([...TOKEN_SPIRAL].sort((a, b) => a - b));
  });

  it('has the base harbor multiset', () => {
    const got = Object.values(board.harbors).sort();
    expect(got).toEqual([...HARBOR_MIX].sort());
  });

  it('has exactly one desert and starts the robber on it (R2.4)', () => {
    const deserts = board.hexes.flatMap((h, i) => (h.terrain === 'desert' ? [i] : []));
    expect(deserts).toHaveLength(1);
    expect(board.robber).toBe(deserts[0]);
    expect(board.hexes[board.robber]?.token).toBeNull();
  });

  it('has no two adjacent hexes both carrying a 6 or 8 (R2.5)', () => {
    const isRed = (id: number): boolean => {
      const t = board.hexes[id]?.token;
      return t === 6 || t === 8;
    };
    for (let a = 0; a < board.hexes.length; a++) {
      if (!isRed(a)) continue;
      for (const b of NEIGHBORS[a] ?? []) {
        expect(isRed(b), `hexes ${a} and ${b} are both red`).toBe(false);
      }
    }
  });
});

describe('beginner board — gating', () => {
  it('is rejected on the 5–6 (30-hex) board — no verified fixed layout there', () => {
    const config: GameConfig = {
      playerCount: 5,
      targetVp: 10,
      seed: 's',
      board: 'beginner',
      tokenMethod: 'spiral',
      expansions: { fiveSix: true, seafarers: false, citiesKnights: false },
      variants: { fiveSixTurnRule: 'pairedPlayers' },
    };
    expect(() => createGame(config)).toThrow(/EXPANSION_NOT_AVAILABLE/);
  });
});
