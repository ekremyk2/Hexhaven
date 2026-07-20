// T-404 requirement 5: rate display matrix + ER-4 inline-block logic, at the pure-function layer
// (mirrors `controls/actionBarLogic.test.ts`'s split from its render-layer sibling).
import { describe, expect, it } from 'vitest';
import { createGame, redact } from '@hexhaven/engine';
import { GEOMETRY } from '@hexhaven/shared';
import type { GameConfig, GameState, Seat } from '@hexhaven/shared';
import { bankRateOptions, respondingSeats, validateOffer } from './rates';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'trade-rates-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const SEAT0 = 0 as Seat;

// Two arbitrary-but-fixed edges from the frozen base GEOMETRY (mirrors engine `rules/harbors.test.ts`'s
// own fixture) — only the endpoint/ownership plumbing is under test here, not the random board's
// real harbor mix.
const BRICK_EDGE = GEOMETRY.edges[0]!;
const GENERIC_EDGE = GEOMETRY.edges[GEOMETRY.edges.length - 1]!;

describe('bankRateOptions (task requirement 1: rate display matrix)', () => {
  it('is 4:1 for every resource with no harbor at all', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) =>
      p.seat === SEAT0 ? { ...p, resources: { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 } } : p
    );
    const state: GameState = { ...g, players, board: { ...g.board, harbors: {} } };
    const view = redact(state, SEAT0);
    const options = bankRateOptions(view, SEAT0);
    for (const resource of ['brick', 'lumber', 'wool', 'grain', 'ore'] as const) {
      expect(options[resource].rate).toBe(4);
      expect(options[resource].affordable).toBe(true);
    }
  });

  it('flags a resource unaffordable when the seat holds fewer than the rate', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, resources: { brick: 3, lumber: 0, wool: 0, grain: 0, ore: 0 } } : p));
    const state: GameState = { ...g, players, board: { ...g.board, harbors: {} } };
    const view = redact(state, SEAT0);
    const options = bankRateOptions(view, SEAT0);
    expect(options.brick.rate).toBe(4);
    expect(options.brick.affordable).toBe(false); // holds 3, needs 4
  });

  it('flags a resource bankEmpty when the bank has none left, independent of rate/affordability', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, resources: { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 } } : p));
    const state: GameState = { ...g, players, bank: { ...g.bank, ore: 0 }, board: { ...g.board, harbors: {} } };
    const view = redact(state, SEAT0);
    const options = bankRateOptions(view, SEAT0);
    expect(options.ore.bankEmpty).toBe(true);
    expect(options.brick.bankEmpty).toBe(false);
  });

  it('drops to 2:1 with a resource-specific harbor', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) =>
      p.seat === SEAT0
        ? { ...p, settlements: [BRICK_EDGE.a], resources: { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 } }
        : p
    ) as GameState['players'];
    const state: GameState = {
      ...g,
      players,
      board: { ...g.board, harbors: { [BRICK_EDGE.id]: 'brick' } as GameState['board']['harbors'] },
    };
    const view = redact(state, SEAT0);
    const options = bankRateOptions(view, SEAT0);
    expect(options.brick.rate).toBe(2);
    expect(options.lumber.rate).toBe(4);
  });

  it('falls to 3:1 under a generic harbor for every other resource', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) =>
      p.seat === SEAT0
        ? { ...p, settlements: [GENERIC_EDGE.a], resources: { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 } }
        : p
    ) as GameState['players'];
    const state: GameState = {
      ...g,
      players,
      board: { ...g.board, harbors: { [GENERIC_EDGE.id]: 'generic' } as GameState['board']['harbors'] },
    };
    const view = redact(state, SEAT0);
    const options = bankRateOptions(view, SEAT0);
    expect(options.brick.rate).toBe(3);
    expect(options.ore.rate).toBe(3);
  });
});

describe('validateOffer (ER-4 inline blocks, task requirement 2)', () => {
  const hand = { brick: 2, lumber: 0, wool: 1, grain: 0, ore: 0 };

  it('blocks an empty give side', () => {
    expect(validateOffer({}, { wool: 1 }, hand)).toBe('emptyGive');
  });

  it('blocks an empty receive side', () => {
    expect(validateOffer({ brick: 1 }, {}, hand)).toBe('emptyReceive');
  });

  it('blocks overlapping resource types between give and receive', () => {
    expect(validateOffer({ brick: 1, wool: 1 }, { wool: 1, grain: 1 }, hand)).toBe('overlap');
  });

  it("blocks when the offerer doesn't hold enough of the give side", () => {
    expect(validateOffer({ brick: 3 }, { wool: 1 }, hand)).toBe('cantAfford');
  });

  it('is legal (null) for a well-formed, affordable, non-overlapping offer', () => {
    expect(validateOffer({ brick: 1 }, { grain: 1 }, hand)).toBeNull();
  });
});

describe('respondingSeats', () => {
  it('lists every seat other than the owner, in seat order', () => {
    const g = createGame(CONFIG);
    const view = redact(g, SEAT0);
    expect(respondingSeats(view, SEAT0)).toEqual([1, 2, 3]);
  });
});
