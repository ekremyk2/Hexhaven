// Tests for the 6 curated new dev-card types (T-904). Exercises `playCardModCard` directly on
// crafted states (testCraft.ts) — NOT through `resolveModules`/the real `Action` union/menu, per
// the task's parallel-safe isolation (this modifier isn't registered anywhere yet).

import { describe, expect, it } from 'vitest';
import type { GameEvent, HexId } from '@hexhaven/shared';
import { playCardModCard } from './newCards.js';
import type { PlayCardModCardAction } from './types.js';
import { craft, h } from './testCraft.js';

function code(res: ReturnType<typeof playCardModCard>): string | null {
  return res.ok ? null : res.error.code;
}

function findEvent<T extends GameEvent['type']>(
  events: readonly GameEvent[],
  type: T
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

const play = (state: ReturnType<typeof craft>, seat: 0 | 1, action: PlayCardModCardAction) =>
  playCardModCard(state, seat, action);

describe('playCardModCard: common guard reuse (beginPlay, R9.3/R9.4)', () => {
  it('CARD_NOT_HELD when the seat holds none of the named card', () => {
    const s = craft({ place: [{ seat: 0 }] });
    expect(code(play(s, 0, { type: 'playCardModCard', card: 'bumperCrop' }))).toBe('CARD_NOT_HELD');
  });

  it('DEV_ALREADY_PLAYED when a dev card was already played this turn', () => {
    const s = craft({
      devPlayed: true,
      place: [{ seat: 0, devCards: [{ type: 'bumperCrop' as never, boughtOnTurn: 1 }] }],
    });
    expect(code(play(s, 0, { type: 'playCardModCard', card: 'bumperCrop' }))).toBe('DEV_ALREADY_PLAYED');
  });

  it('DEV_BOUGHT_THIS_TURN when the only held copy was bought this same turn', () => {
    const s = craft({
      turnNumber: 5,
      place: [{ seat: 0, devCards: [{ type: 'bumperCrop' as never, boughtOnTurn: 5 }] }],
    });
    expect(code(play(s, 0, { type: 'playCardModCard', card: 'bumperCrop' }))).toBe('DEV_BOUGHT_THIS_TURN');
  });
});

describe('bumperCrop', () => {
  it('gains 1 of every resource type from the bank and consumes the card', () => {
    const s = craft({ place: [{ seat: 0, devCards: [{ type: 'bumperCrop' as never, boughtOnTurn: 1 }] }] });
    const res = play(s, 0, { type: 'playCardModCard', card: 'bumperCrop' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources).toEqual({ brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 });
    expect(res.state.bank.brick).toBe(s.bank.brick - 1);
    expect(res.state.players[0]!.devCards).toEqual([]);
    expect(res.state.turn.devPlayed).toBe(true);
    expect(findEvent(res.events, 'production')).toMatchObject({
      gains: [{ seat: 0, resources: { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 } }],
      shortages: [],
    });
    expect(findEvent(res.events, 'devPlayed')).toMatchObject({ seat: 0, card: 'bumperCrop' });
  });

  it('skips a resource the bank cannot supply and reports it as a shortage', () => {
    const s = craft({
      bank: { ore: 0 },
      place: [{ seat: 0, devCards: [{ type: 'bumperCrop' as never, boughtOnTurn: 1 }] }],
    });
    const res = play(s, 0, { type: 'playCardModCard', card: 'bumperCrop' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.ore).toBe(0);
    expect(res.state.players[0]!.resources.brick).toBe(1);
    expect(findEvent(res.events, 'production')).toMatchObject({ shortages: ['ore'] });
  });
});

describe("merchantsBoon", () => {
  it('trades 2 of `give` for 1 of `receive` at the bank', () => {
    const s = craft({
      place: [{ seat: 0, hand: { brick: 2 }, devCards: [{ type: 'merchantsBoon' as never, boughtOnTurn: 1 }] }],
    });
    const res = play(s, 0, { type: 'playCardModCard', card: 'merchantsBoon', give: 'brick', receive: 'ore' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.brick).toBe(0);
    expect(res.state.players[0]!.resources.ore).toBe(1);
    expect(res.state.bank.brick).toBe(s.bank.brick + 2);
    expect(res.state.bank.ore).toBe(s.bank.ore - 1);
    expect(findEvent(res.events, 'bankTraded')).toMatchObject({ seat: 0, gave: { brick: 2 }, got: { ore: 1 }, rate: 2 });
  });

  it('CANT_AFFORD when fewer than 2 of `give` are held', () => {
    const s = craft({
      place: [{ seat: 0, hand: { brick: 1 }, devCards: [{ type: 'merchantsBoon' as never, boughtOnTurn: 1 }] }],
    });
    expect(
      code(play(s, 0, { type: 'playCardModCard', card: 'merchantsBoon', give: 'brick', receive: 'ore' }))
    ).toBe('CANT_AFFORD');
  });

  it('BANK_EMPTY when the bank has none of `receive`', () => {
    const s = craft({
      bank: { ore: 0 },
      place: [{ seat: 0, hand: { brick: 2 }, devCards: [{ type: 'merchantsBoon' as never, boughtOnTurn: 1 }] }],
    });
    expect(
      code(play(s, 0, { type: 'playCardModCard', card: 'merchantsBoon', give: 'brick', receive: 'ore' }))
    ).toBe('BANK_EMPTY');
  });

  it('BAD_CARD_TARGET when give and receive are the same resource', () => {
    const s = craft({
      place: [{ seat: 0, hand: { brick: 2 }, devCards: [{ type: 'merchantsBoon' as never, boughtOnTurn: 1 }] }],
    });
    expect(
      code(play(s, 0, { type: 'playCardModCard', card: 'merchantsBoon', give: 'brick', receive: 'brick' }))
    ).toBe('BAD_CARD_TARGET');
  });
});

describe('roadToll', () => {
  it('every other seat holding >=1 of the named resource gives exactly 1 (capped)', () => {
    const s = craft({
      place: [
        { seat: 0, devCards: [{ type: 'roadToll' as never, boughtOnTurn: 1 }] },
        { seat: 1, hand: { wool: 3 } },
        { seat: 2, hand: { wool: 0 } },
        { seat: 3, hand: { wool: 1 } },
      ],
    });
    const res = play(s, 0, { type: 'playCardModCard', card: 'roadToll', resource: 'wool' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.wool).toBe(2); // 1 from seat 1, 1 from seat 3
    expect(res.state.players[1]!.resources.wool).toBe(2); // capped at 1 taken, not all 3
    expect(res.state.players[2]!.resources.wool).toBe(0);
    expect(res.state.players[3]!.resources.wool).toBe(0);
    expect(findEvent(res.events, 'monopolyResolved')).toMatchObject({
      seat: 0,
      resource: 'wool',
      taken: [
        { seat: 1, count: 1 },
        { seat: 2, count: 0 },
        { seat: 3, count: 1 },
      ],
    });
  });

  it('BAD_CARD_TARGET when no resource is named', () => {
    const s = craft({ place: [{ seat: 0, devCards: [{ type: 'roadToll' as never, boughtOnTurn: 1 }] }] });
    expect(code(play(s, 0, { type: 'playCardModCard', card: 'roadToll' }))).toBe('BAD_CARD_TARGET');
  });
});

describe('trailblazer', () => {
  it('builds exactly 1 free road with no connectivity requirement', () => {
    const edge = h(0).edges[0]!;
    const s = craft({ place: [{ seat: 0, devCards: [{ type: 'trailblazer' as never, boughtOnTurn: 1 }] }] });
    const res = play(s, 0, { type: 'playCardModCard', card: 'trailblazer', edge });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.roads).toEqual([edge]);
    expect(res.state.players[0]!.piecesLeft.roads).toBe(14);
    expect(findEvent(res.events, 'built')).toMatchObject({ seat: 0, piece: 'road', location: edge });
  });

  it('OCCUPIED when the edge already holds a road', () => {
    const edge = h(0).edges[0]!;
    const s = craft({
      place: [
        { seat: 0, devCards: [{ type: 'trailblazer' as never, boughtOnTurn: 1 }] },
        { seat: 1, roads: [edge] },
      ],
    });
    expect(code(play(s, 0, { type: 'playCardModCard', card: 'trailblazer', edge }))).toBe('OCCUPIED');
  });

  it('NO_PIECES_LEFT when the seat has no road pieces left', () => {
    const edge = h(0).edges[0]!;
    const s = craft({
      place: [
        {
          seat: 0,
          devCards: [{ type: 'trailblazer' as never, boughtOnTurn: 1 }],
          piecesLeft: { roads: 0, settlements: 5, cities: 4 },
        },
      ],
    });
    expect(code(play(s, 0, { type: 'playCardModCard', card: 'trailblazer', edge }))).toBe('NO_PIECES_LEFT');
  });
});

describe('windfall', () => {
  it('draws the top 2 dev-deck cards into hand for free', () => {
    const s = craft({
      devDeck: ['knight', 'monopoly', 'yearOfPlenty'],
      place: [{ seat: 0, devCards: [{ type: 'windfall' as never, boughtOnTurn: 1 }] }],
    });
    const res = play(s, 0, { type: 'playCardModCard', card: 'windfall' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.devCards).toEqual([
      { type: 'knight', boughtOnTurn: 5 },
      { type: 'monopoly', boughtOnTurn: 5 },
    ]);
    expect(res.state.devDeck).toEqual(['yearOfPlenty']);
  });

  it('draws fewer if the deck runs short, and is a no-op on an empty deck', () => {
    const s = craft({
      devDeck: [],
      place: [{ seat: 0, devCards: [{ type: 'windfall' as never, boughtOnTurn: 1 }] }],
    });
    const res = play(s, 0, { type: 'playCardModCard', card: 'windfall' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.devCards).toEqual([]);
  });
});

describe('highwayman', () => {
  it('relocates the robber with no steal at all', () => {
    const s = craft({
      robber: 0,
      place: [
        { seat: 0, devCards: [{ type: 'highwayman' as never, boughtOnTurn: 1 }] },
        { seat: 1, settlements: [h(5).vertices[0]!], hand: { brick: 2 } },
      ],
    });
    const res = play(s, 0, { type: 'playCardModCard', card: 'highwayman', hex: 5 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.board.robber).toBe(5);
    expect(res.state.players[1]!.resources.brick).toBe(2); // untouched — no steal
    expect(findEvent(res.events, 'robberMoved')).toMatchObject({ seat: 0, hex: 5 });
    expect(findEvent(res.events, 'stolen')).toBeUndefined();
  });

  it('ROBBER_SAME_HEX when targeting the robber\'s current hex', () => {
    const s = craft({
      robber: 5,
      place: [{ seat: 0, devCards: [{ type: 'highwayman' as never, boughtOnTurn: 1 }] }],
    });
    expect(code(play(s, 0, { type: 'playCardModCard', card: 'highwayman', hex: 5 as HexId }))).toBe(
      'ROBBER_SAME_HEX'
    );
  });
});
