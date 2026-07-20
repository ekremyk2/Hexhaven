// T-1008: `tbHelpers.ts`'s pure lookups, exercised over a real `redact(createGame(...), seat)`
// PlayerView (never hand-faked) so the T&B ext shape matches exactly what the client receives —
// mirrors `citiesKnights/ckHelpers.test.ts`'s own convention.
import { describe, expect, it } from 'vitest';
import { createGame, redact } from '@hexhaven/engine';
import type { GameConfig, GameState, Seat } from '@hexhaven/shared';
import {
  isBarbarianAttackGame,
  isCaravansGame,
  isFishermenGame,
  isRiversGame,
  isTradersBarbariansGame,
  isTradersBarbariansMainGame,
  oldBootPassTargets,
  ownActiveKnightEdges,
  ownWagons,
  publicVpInTbView,
  tbOf,
  tradeHexKindByHex,
} from './tbHelpers';

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;

const BASE_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'tb-helpers-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

function tbConfig(scenario: string): GameConfig {
  return { ...BASE_CONFIG, expansions: { ...BASE_CONFIG.expansions, tradersBarbarians: { scenario } } };
}

describe('isTradersBarbariansGame / tbOf / scenario guards', () => {
  it('is false/undefined for a base game', () => {
    const view = redact(createGame(BASE_CONFIG), SEAT0);
    expect(isTradersBarbariansGame(view)).toBe(false);
    expect(tbOf(view)).toBeUndefined();
  });

  it('is true/defined, with the right scenario guard, for each of the 5 scenarios', () => {
    for (const scenario of ['fishermen', 'rivers', 'caravans', 'barbarianAttack', 'tradersBarbarians']) {
      const view = redact(createGame(tbConfig(scenario)), SEAT0);
      expect(isTradersBarbariansGame(view)).toBe(true);
      expect(tbOf(view)?.scenario).toBe(scenario);
      expect(isFishermenGame(view)).toBe(scenario === 'fishermen');
      expect(isRiversGame(view)).toBe(scenario === 'rivers');
      expect(isCaravansGame(view)).toBe(scenario === 'caravans');
      expect(isBarbarianAttackGame(view)).toBe(scenario === 'barbarianAttack');
      expect(isTradersBarbariansMainGame(view)).toBe(scenario === 'tradersBarbarians');
    }
  });
});

describe('publicVpInTbView', () => {
  it('counts settlements/cities/awards only (public data)', () => {
    const state = createGame(tbConfig('fishermen'));
    const withPieces: GameState = {
      ...state,
      players: state.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [1, 2, 3] as never } : p)),
      awards: { ...state.awards, longestRoad: { holder: SEAT0, length: 5 } },
    };
    const view = redact(withPieces, SEAT1);
    expect(publicVpInTbView(view, SEAT0)).toBe(3 + 2); // 3 settlements + longest road
  });
});

describe('oldBootPassTargets (§TB2.5)', () => {
  it('empty outside a fishermen game', () => {
    const view = redact(createGame(tbConfig('rivers')), SEAT0);
    expect(oldBootPassTargets(view, SEAT0)).toEqual([]);
  });

  it('empty for a non-holder even in a fishermen game', () => {
    const state = createGame(tbConfig('fishermen'));
    const withBoot: GameState = { ...state, ext: { ...state.ext, tradersBarbarians: { ...state.ext!.tradersBarbarians!, oldBoot: SEAT1 } } };
    const view = redact(withBoot, SEAT0);
    expect(oldBootPassTargets(view, SEAT0)).toEqual([]);
  });

  it('offers only seats the holder is trailing or tied with, never a seat strictly behind the holder', () => {
    const state = createGame(tbConfig('fishermen'));
    const withBoot: GameState = {
      ...state,
      players: state.players.map((p) => {
        if (p.seat === SEAT0) return { ...p, settlements: [1] as never }; // holder: 1 VP
        if (p.seat === 1) return { ...p, settlements: [2, 3] as never }; // ahead: 2 VP (trailing -> legal)
        if (p.seat === 2) return { ...p, settlements: [4] as never }; // tied: 1 VP (legal)
        return p; // seat 3: 0 VP, BEHIND the holder — never a legal target
      }),
      ext: { ...state.ext, tradersBarbarians: { ...state.ext!.tradersBarbarians!, oldBoot: SEAT0 } },
    };
    const view = redact(withBoot, SEAT0);
    expect(oldBootPassTargets(view, SEAT0).sort()).toEqual([1, 2]);
  });
});

describe('ownActiveKnightEdges (barbarianAttack, §TB5.2)', () => {
  it('only the seat\'s own ACTIVE knight edges', () => {
    const state = createGame(tbConfig('barbarianAttack'));
    const ext = state.ext!.tradersBarbarians!;
    const withKnights: GameState = {
      ...state,
      ext: {
        ...state.ext,
        tradersBarbarians: {
          ...ext,
          knights: [
            { seat: SEAT0, edge: 1 as never, active: true },
            { seat: SEAT0, edge: 2 as never, active: false },
            { seat: SEAT1, edge: 3 as never, active: true },
          ],
        },
      },
    };
    const view = redact(withKnights, SEAT0);
    expect(ownActiveKnightEdges(view, SEAT0)).toEqual([1]);
  });
});

describe('ownWagons (the main scenario, §TB6.2)', () => {
  it('tags each of the seat\'s own wagons with its array INDEX', () => {
    const state = createGame(tbConfig('tradersBarbarians'));
    const ext = state.ext!.tradersBarbarians!;
    const withWagons: GameState = {
      ...state,
      ext: {
        ...state.ext,
        tradersBarbarians: {
          ...ext,
          wagons: [
            { seat: SEAT1, at: 5 as never, cargo: null },
            { seat: SEAT0, at: 6 as never, cargo: 'sand' },
            { seat: SEAT0, at: 7 as never, cargo: null },
          ],
        },
      },
    };
    const view = redact(withWagons, SEAT0);
    expect(ownWagons(view, SEAT0)).toEqual([
      { index: 1, at: 6, cargo: 'sand' },
      { index: 2, at: 7, cargo: null },
    ]);
  });
});

describe('tradeHexKindByHex (the main scenario, §TB6.1)', () => {
  it('maps every fixed trade hex to its kind', () => {
    const view = redact(createGame(tbConfig('tradersBarbarians')), SEAT0);
    const map = tradeHexKindByHex(view);
    expect(map.size).toBe(3);
    expect(new Set(map.values())).toEqual(new Set(['quarry', 'glassworks', 'castle']));
  });

  it('empty outside the main scenario', () => {
    const view = redact(createGame(tbConfig('fishermen')), SEAT0);
    expect(tradeHexKindByHex(view).size).toBe(0);
  });
});
