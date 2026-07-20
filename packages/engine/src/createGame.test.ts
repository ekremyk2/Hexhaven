import { describe, expect, it } from 'vitest';
import {
  BANK_PER_RESOURCE,
  DEV_DECK,
  GEOMETRY,
  HARBOR_MIX,
  PIECES_PER_PLAYER,
  TARGET_VP,
  TERRAIN_COUNTS,
  TOKEN_SPIRAL,
} from '@hexhaven/shared';
import type { GameConfig, TerrainType } from '@hexhaven/shared';
import { createGame, validateConfig } from './createGame.js';
import { hashSeed } from './rng.js';

function cfg(over: Partial<GameConfig> = {}): GameConfig {
  return {
    playerCount: 4,
    targetVp: TARGET_VP,
    seed: 'x',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    ...over,
  };
}

function expectExpansionRejected(config: GameConfig): void {
  expect(validateConfig(config)?.code).toBe('EXPANSION_NOT_AVAILABLE');
  try {
    createGame(config);
    throw new Error('createGame should have thrown');
  } catch (e) {
    expect((e as { code?: unknown }).code).toBe('EXPANSION_NOT_AVAILABLE');
  }
}

describe('config validation (docs/10 §1, D-026)', () => {
  it('accepts the base 3- and 4-player configs', () => {
    expect(validateConfig(cfg())).toBeNull();
    expect(validateConfig(cfg({ playerCount: 3 }))).toBeNull();
  });

  it('rejects an unknown seafarers scenario id with EXPANSION_NOT_AVAILABLE', () => {
    expectExpansionRejected(
      cfg({
        expansions: { fiveSix: false, seafarers: { scenario: 'newShores' }, citiesKnights: false },
      })
    );
  });

  // T-802: citiesKnights now ACTIVATES the module instead of being rejected (the config gate was
  // removed) — see modules/seafarers.test.ts's neighboring "citiesKnights" describe block and
  // modules/citiesKnights/t802.test.ts for the fuller createGame behavior. It stays hidden from
  // users at the client/lobby layer (SHIPPED_EXPANSIONS.citiesKnights / expansionUnavailable).
  it('accepts citiesKnights (T-802, engine-live but client-hidden)', () => {
    expect(
      validateConfig(cfg({ expansions: { fiveSix: false, seafarers: false, citiesKnights: true } }))
    ).toBeNull();
  });

  it('accepts the fiveSix module (T-601, W1 shipped) at 4, 5, and 6 players', () => {
    const fiveSix = { fiveSix: true, seafarers: false, citiesKnights: false } as const;
    expect(validateConfig(cfg({ expansions: fiveSix }))).toBeNull();
    expect(validateConfig(cfg({ playerCount: 5, expansions: fiveSix }))).toBeNull();
    expect(validateConfig(cfg({ playerCount: 6, expansions: fiveSix }))).toBeNull();
  });

  it('rejects playerCount 5 and 6 without the fiveSix module (D-025)', () => {
    expectExpansionRejected(cfg({ playerCount: 5 }));
    expectExpansionRejected(cfg({ playerCount: 6 }));
  });
});

describe('determinism (D-004, I9)', () => {
  it('identical config ⇒ deeply equal state', () => {
    expect(createGame(cfg())).toEqual(createGame(cfg()));
  });

  it('different seeds ⇒ different shuffles', () => {
    const a = createGame(cfg({ seed: 'x' }));
    const b = createGame(cfg({ seed: 'y' }));
    expect(a.devDeck).not.toEqual(b.devDeck);
  });

  it('threads the rng: state.rng has advanced past hashSeed(seed)', () => {
    const g = createGame(cfg());
    expect(g.rng).not.toBe(hashSeed('x'));
  });
});

describe('dev deck (R1.2, R9.1)', () => {
  it('holds exactly 25 cards with the official composition', () => {
    const deck = createGame(cfg()).devDeck;
    expect(deck).toHaveLength(25);
    const counts: Partial<Record<string, number>> = {};
    for (const card of deck) counts[card] = (counts[card] ?? 0) + 1;
    expect(counts).toEqual(DEV_DECK);
    expect(DEV_DECK).toEqual({
      knight: 14,
      roadBuilding: 2,
      yearOfPlenty: 2,
      monopoly: 2,
      victoryPoint: 5,
    });
  });
});

describe('initial state shape', () => {
  const g = createGame(cfg());

  it('starts in setup round 1 expecting a settlement from player 0, stateVersion 0', () => {
    expect(g.v).toBe(1);
    expect(g.stateVersion).toBe(0);
    expect(g.phase).toEqual({ kind: 'setup', round: 1, expect: 'settlement', lastSettlement: null });
    expect(g.turn).toEqual({ number: 1, player: 0, rolled: false, roll: null, devPlayed: false });
    expect(g.trade).toBeNull();
    expect(g.awards).toEqual({
      longestRoad: { holder: null, length: 0 },
      largestArmy: { holder: null, count: 0 },
    });
  });

  it('fills the bank from the config-resolved constant (19 per resource)', () => {
    expect(g.bank).toEqual({
      brick: BANK_PER_RESOURCE,
      lumber: BANK_PER_RESOURCE,
      wool: BANK_PER_RESOURCE,
      grain: BANK_PER_RESOURCE,
      ore: BANK_PER_RESOURCE,
    });
  });

  it('seats playerCount players with base colors, full pieces and empty holdings', () => {
    expect(g.players).toHaveLength(4);
    expect(g.players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(g.players.map((p) => p.color)).toEqual(['red', 'blue', 'white', 'orange']);
    for (const p of g.players) {
      expect(p.resources).toEqual({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
      expect(p.piecesLeft).toEqual(PIECES_PER_PLAYER);
      expect(p.devCards).toEqual([]);
      expect(p.playedKnights).toBe(0);
      expect(p.roads).toEqual([]);
      expect(p.settlements).toEqual([]);
      expect(p.cities).toEqual([]);
    }
    expect(createGame(cfg({ playerCount: 3 })).players).toHaveLength(3);
  });

  it('copies the config so caller mutations cannot alias into state', () => {
    const config = cfg();
    const game = createGame(config);
    config.expansions.fiveSix = true;
    config.seed = 'tampered';
    expect(game.config.expansions.fiveSix).toBe(false);
    expect(game.config.seed).toBe('x');
  });
});

describe('stub board legality (R2 — until T-101 lands)', () => {
  const board = createGame(cfg()).board;

  it('has 19 hexes with the official terrain multiset', () => {
    expect(board.hexes).toHaveLength(19);
    const counts: Partial<Record<TerrainType, number>> = {};
    for (const hex of board.hexes) counts[hex.terrain] = (counts[hex.terrain] ?? 0) + 1;
    expect(counts).toEqual(TERRAIN_COUNTS);
  });

  it('puts the robber on the tokenless desert (R2.4)', () => {
    const desert = board.hexes[board.robber];
    expect(desert?.terrain).toBe('desert');
    expect(desert?.token).toBeNull();
    expect(board.hexes.filter((h) => h.token === null)).toHaveLength(1);
  });

  it('lays tokens along the official counterclockwise spiral, desert skipped (R2.3)', () => {
    const walked: number[] = [];
    for (const hexId of GEOMETRY.hexSpiralOrder) {
      const hex = board.hexes[hexId];
      if (!hex) throw new Error(`missing hex ${hexId}`);
      if (hex.terrain === 'desert') continue;
      if (hex.token === null) throw new Error(`non-desert hex ${hexId} has no token`);
      walked.push(hex.token);
    }
    expect(walked).toEqual(TOKEN_SPIRAL);
  });

  it('places the 9-harbor mix exactly on GEOMETRY.harborSpots', () => {
    const keys = Object.keys(board.harbors)
      .map(Number)
      .sort((a, b) => a - b);
    expect(keys).toEqual([...GEOMETRY.harborSpots].sort((a, b) => a - b));
    const values = Object.values(board.harbors).sort();
    expect(values).toEqual([...HARBOR_MIX].sort());
  });
});
