import { describe, expect, it } from 'vitest';
import { GEOMETRY, HARBOR_MIX, TERRAIN_COUNTS, TOKEN_SPIRAL } from '@hexhaven/shared';
import type { GameConfig, GameState, HarborType, TerrainType } from '@hexhaven/shared';
import { generateBoard } from './boardGen.js';
import { createGame } from './createGame.js';
import { hashSeed } from './rng.js';

const SPIRAL: Pick<GameConfig, 'board' | 'tokenMethod'> = {
  board: 'random',
  tokenMethod: 'spiral',
};
const SHUFFLED: Pick<GameConfig, 'board' | 'tokenMethod'> = {
  board: 'random',
  tokenMethod: 'shuffled',
};

const SEED_COUNT = 200;

function seeds(prefix: string): number[] {
  return Array.from({ length: SEED_COUNT }, (_, i) => hashSeed(`${prefix}-${i}`));
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

/** Hex adjacency from GEOMETRY (task spec): two hexes are adjacent iff they share an edge. */
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

function adjacentRedPairs(board: GameState['board']): [number, number][] {
  const red = (id: number): boolean => {
    const t = board.hexes[id]?.token;
    return t === 6 || t === 8;
  };
  const pairs: [number, number][] = [];
  for (let a = 0; a < board.hexes.length; a++) {
    if (!red(a)) continue;
    for (const b of NEIGHBORS[a] ?? []) {
      if (b > a && red(b)) pairs.push([a, b]);
    }
  }
  return pairs;
}

describe('determinism (docs/03 §6)', () => {
  it('same rng in ⇒ identical board and rng out, twice', () => {
    const rng = hashSeed('determinism');
    expect(generateBoard(rng, SPIRAL)).toEqual(generateBoard(rng, SPIRAL));
    expect(generateBoard(rng, SHUFFLED)).toEqual(generateBoard(rng, SHUFFLED));
  });

  it('advances the rng state', () => {
    const rng = hashSeed('advances');
    expect(generateBoard(rng, SPIRAL).rng).not.toBe(rng);
  });

  it('different seeds ⇒ different boards (probabilistic)', () => {
    const a = generateBoard(hashSeed('x'), SPIRAL);
    const b = generateBoard(hashSeed('y'), SPIRAL);
    expect(a.board).not.toEqual(b.board);
  });
});

describe(`board legality across ${SEED_COUNT} seeds (R1.2, R2)`, () => {
  // Cross-check the constants themselves once: 18 tokens — one each 2/12, two each of the rest,
  // no 7 (R1.2); 9 harbors — 4 generic + one 2:1 per resource (R1.2).
  it('TOKEN_SPIRAL and HARBOR_MIX match the R1.2 component inventory', () => {
    expect([...TOKEN_SPIRAL].sort((a, b) => a - b)).toEqual([
      2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
    ]);
    expect([...HARBOR_MIX].sort()).toEqual([
      'brick',
      'generic',
      'generic',
      'generic',
      'generic',
      'grain',
      'lumber',
      'ore',
      'wool',
    ]);
  });

  it('terrain multiset, tokens, desert, robber and harbors are always legal (spiral)', () => {
    for (const rng of seeds('legal-spiral')) {
      const { board } = generateBoard(rng, SPIRAL);

      // R2.1/R1.2: one full board's worth of hexes, official terrain multiset.
      expect(board.hexes).toHaveLength(GEOMETRY.hexes.length);
      expect(terrainCountsOf(board)).toEqual(TERRAIN_COUNTS);

      // R1.2/R2.3: token multiset is the 18-token set; desert is the only tokenless hex.
      expect(sortedTokensOf(board)).toEqual([...TOKEN_SPIRAL].sort((a, b) => a - b));
      const desert = board.hexes.filter((h) => h.terrain === 'desert');
      expect(desert).toHaveLength(1);
      expect(desert[0]?.token).toBeNull();
      expect(board.hexes.filter((h) => h.token === null)).toHaveLength(1);

      // R2.4: robber starts on the desert.
      expect(board.hexes[board.robber]?.terrain).toBe('desert');

      // R2.2: harbors sit on exactly GEOMETRY.harborSpots with the 4+5 mix.
      const keys = Object.keys(board.harbors)
        .map(Number)
        .sort((a, b) => a - b);
      expect(keys).toEqual([...GEOMETRY.harborSpots].sort((a, b) => a - b));
      expect(Object.values(board.harbors).sort()).toEqual([...HARBOR_MIX].sort());
    }
  });
});

describe('spiral token method (R2.3)', () => {
  it(`walking hexSpiralOrder skipping the desert reads exactly TOKEN_SPIRAL — ${SEED_COUNT} seeds`, () => {
    for (const rng of seeds('spiral-walk')) {
      const { board } = generateBoard(rng, SPIRAL);
      const walked: number[] = [];
      for (const hexId of GEOMETRY.hexSpiralOrder) {
        const hex = board.hexes[hexId];
        if (!hex) throw new Error(`missing hex ${hexId}`);
        if (hex.terrain === 'desert') continue;
        if (hex.token === null) throw new Error(`non-desert hex ${hexId} has no token`);
        walked.push(hex.token);
      }
      expect(walked).toEqual(TOKEN_SPIRAL);
    }
  });

  // Hand-verified snapshot for hashSeed('T-101') (see T-101 Implementation notes): terrain
  // multiset matches TERRAIN_COUNTS; walking hexSpiralOrder [0,3,7,12,16,17,18,15,11,6,2,1,4,
  // 8,13,14,10,5,9] over these tokens (desert hex 10 skipped) reads exactly TOKEN_SPIRAL;
  // robber on the desert; harbors = HARBOR_MIX spread over harborSpots {0,3,9,23,38,49,61,66,70}.
  it("fixed seed 'T-101' produces exactly the hand-verified board", () => {
    const result = generateBoard(hashSeed('T-101'), SPIRAL);
    expect(result.board.hexes).toEqual([
      { terrain: 'fields', token: 5 },
      { terrain: 'forest', token: 10 },
      { terrain: 'hills', token: 8 },
      { terrain: 'mountains', token: 2 },
      { terrain: 'pasture', token: 9 },
      { terrain: 'fields', token: 3 },
      { terrain: 'pasture', token: 4 },
      { terrain: 'hills', token: 6 },
      { terrain: 'mountains', token: 4 },
      { terrain: 'pasture', token: 11 },
      { terrain: 'desert', token: null },
      { terrain: 'forest', token: 11 },
      { terrain: 'hills', token: 3 },
      { terrain: 'pasture', token: 5 },
      { terrain: 'mountains', token: 6 },
      { terrain: 'fields', token: 12 },
      { terrain: 'forest', token: 8 },
      { terrain: 'fields', token: 10 },
      { terrain: 'forest', token: 9 },
    ]);
    expect(result.board.robber).toBe(10);
    const expectedHarbors: Record<number, HarborType> = {
      0: 'grain',
      3: 'generic',
      9: 'generic',
      23: 'generic',
      38: 'wool',
      49: 'brick',
      61: 'lumber',
      66: 'generic',
      70: 'ore',
    };
    expect(result.board.harbors).toEqual(expectedHarbors);
    expect(result.rng).toBe(2783022776); // draw count is part of the deterministic contract
  });
});

describe('shuffled token method (R2.5)', () => {
  it(`never places 6/8 on adjacent hexes and keeps the token multiset — ${SEED_COUNT} seeds`, () => {
    for (const rng of seeds('shuffled')) {
      const { board } = generateBoard(rng, SHUFFLED);
      expect(adjacentRedPairs(board)).toEqual([]);
      expect(sortedTokensOf(board)).toEqual([...TOKEN_SPIRAL].sort((a, b) => a - b));
      expect(board.hexes[board.robber]?.terrain).toBe('desert');
      expect(board.hexes.filter((h) => h.token === null)).toHaveLength(1);
    }
  });

  it('actually shuffles: some seed departs from the spiral sequence', () => {
    const departs = seeds('departs').some((rng) => {
      const { board } = generateBoard(rng, SHUFFLED);
      const walked: number[] = [];
      for (const hexId of GEOMETRY.hexSpiralOrder) {
        const hex = board.hexes[hexId];
        if (hex && hex.token !== null) walked.push(hex.token);
      }
      return JSON.stringify(walked) !== JSON.stringify(TOKEN_SPIRAL);
    });
    expect(departs).toBe(true);
  });
});

describe('beginner board (R2.6, ER-12, D-015, D-016)', () => {
  // T-606: `board:'beginner'` now produces the fixed base-19 beginner board (see the full
  // multiset/legality/determinism suite in beginnerLayout.test.ts). Here we only assert boardGen's
  // own contract: it builds a valid board on the base board and rejects the 5–6 combo.
  it('builds the fixed beginner board on the base board (rng unchanged, exactly one desert)', () => {
    const rng = hashSeed('x');
    const result = generateBoard(rng, { board: 'beginner', tokenMethod: 'spiral' });
    expect(result.rng).toBe(rng); // no rng consumed for a fixed board
    const deserts = result.board.hexes.filter((h) => h.terrain === 'desert');
    expect(deserts).toHaveLength(1);
    expect(result.board.hexes[result.board.robber]?.terrain).toBe('desert');
  });

  it('rejects beginner on the 5–6 (30-hex) board with EXPANSION_NOT_AVAILABLE', () => {
    try {
      generateBoard(hashSeed('x'), {
        board: 'beginner',
        tokenMethod: 'spiral',
        expansions: { fiveSix: true, seafarers: false, citiesKnights: false },
      });
      throw new Error('generateBoard should have thrown');
    } catch (e) {
      expect((e as { code?: unknown }).code).toBe('EXPANSION_NOT_AVAILABLE');
    }
  });
});

describe('createGame wiring (WIRE: T-101)', () => {
  it('createGame consumes the generator: same seed ⇒ same board, different seeds differ', () => {
    const config: GameConfig = {
      playerCount: 4,
      targetVp: 10,
      seed: 'wire',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    };
    const a = createGame(config);
    const b = createGame(config);
    expect(a.board).toEqual(b.board);
    expect(a.board).toEqual(generateBoard(hashSeed('wire'), SPIRAL).board);
    expect(createGame({ ...config, seed: 'other' }).board).not.toEqual(a.board);
  });

  it('honors tokenMethod shuffled end-to-end', () => {
    const config: GameConfig = {
      playerCount: 4,
      targetVp: 10,
      seed: 'wire-shuffled',
      board: 'random',
      tokenMethod: 'shuffled',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    };
    const game = createGame(config);
    expect(adjacentRedPairs(game.board)).toEqual([]);
    expect(game.board).toEqual(generateBoard(hashSeed('wire-shuffled'), SHUFFLED).board);
  });
});
