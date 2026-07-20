// playDevSameTurn modifier tests (T-906 wave A-1, docs/07 D-034): waives R9.4's "not bought this
// same turn" restriction, and stays a no-op in a Cities & Knights game (whose own
// `DEV_CARDS_DISABLED` gate runs before this modifier's constant is ever consulted).

import { describe, expect, it } from 'vitest';
import type { DevCardType, GameConfig, GameState, ResourceType, Seat } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'play-dev-same-turn-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

interface Place {
  seat: Seat;
  hand?: Partial<Record<ResourceType, number>>;
  devCards?: { type: DevCardType; boughtOnTurn: number }[];
}

function craft(opts: {
  place?: Place[];
  turnNumber?: number;
  modifiers?: GameConfig['modifiers'];
  citiesKnights?: boolean;
} = {}): GameState {
  const g = createGame({
    ...CONFIG,
    modifiers: opts.modifiers,
    expansions: { ...CONFIG.expansions, citiesKnights: opts.citiesKnights ?? false },
  });
  const turnNumber = opts.turnNumber ?? 5;
  const players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    return {
      ...p,
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0, ...pl.hand },
      devCards: pl.devCards ?? [],
    };
  });
  return {
    ...g,
    players,
    turn: { number: turnNumber, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    phase: { kind: 'main' },
  };
}

describe('playDevSameTurn: waives R9.4 (a just-bought card is playable)', () => {
  it('WITHOUT the modifier, a Knight bought THIS turn is blocked (DEV_BOUGHT_THIS_TURN baseline)', () => {
    const state = craft({
      place: [{ seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 5 }] }],
      turnNumber: 5,
    });
    const res = reduce(state, 0, { type: 'playKnight' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('DEV_BOUGHT_THIS_TURN');
  });

  it('WITH the modifier, a Knight bought THIS turn IS playable', () => {
    const state = craft({
      place: [{ seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 5 }] }],
      turnNumber: 5,
      modifiers: { playDevSameTurn: true },
    });
    const res = reduce(state, 0, { type: 'playKnight' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase.kind).toBe('moveRobber');
    expect(res.state.turn.devPlayed).toBe(true);
    expect(res.state.players[0]!.devCards).toEqual([]);
    const played = res.events.find((e) => e.type === 'devPlayed');
    expect(played).toMatchObject({ seat: 0, card: 'knight' });
  });

  it('a card bought on a PRIOR turn is playable with or without the modifier (unaffected)', () => {
    const withoutModifier = craft({
      place: [{ seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 3 }] }],
      turnNumber: 5,
    });
    const res = reduce(withoutModifier, 0, { type: 'playKnight' });
    expect(res.ok).toBe(true);
  });

  it('still enforces DEV_ALREADY_PLAYED (one dev card per turn) even with the modifier on', () => {
    const state: GameState = {
      ...craft({
        place: [{ seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 5 }] }],
        turnNumber: 5,
        modifiers: { playDevSameTurn: true },
      }),
      turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: true },
    };
    const res = reduce(state, 0, { type: 'playKnight' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('DEV_ALREADY_PLAYED');
  });
});

describe('playDevSameTurn composes with Cities & Knights (no-op: C11.1 disables dev cards outright)', () => {
  it('playKnight is still DEV_CARDS_DISABLED in a C&K game, modifier or not', () => {
    const state = craft({
      place: [{ seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 5 }] }],
      turnNumber: 5,
      modifiers: { playDevSameTurn: true },
      citiesKnights: true,
    });
    const res = reduce(state, 0, { type: 'playKnight' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('DEV_CARDS_DISABLED');
  });
});
