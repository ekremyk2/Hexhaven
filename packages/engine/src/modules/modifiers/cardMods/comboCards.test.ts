// Tests for the 5 curated combined card plays (T-904). Exercises `playCardModCombo` directly on
// crafted states (testCraft.ts) — NOT through `resolveModules`/the real `Action` union/menu, per
// the task's parallel-safe isolation (this modifier isn't registered anywhere yet).

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { GameEvent, HexId, VertexId } from '@hexhaven/shared';
import { playCardModCombo } from './comboCards.js';
import type { PlayCardModComboAction } from './types.js';
import { craft, h } from './testCraft.js';

function code(res: ReturnType<typeof playCardModCombo>): string | null {
  return res.ok ? null : res.error.code;
}

function findEvent<T extends GameEvent['type']>(
  events: readonly GameEvent[],
  type: T
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

const play = (state: ReturnType<typeof craft>, seat: 0 | 1, action: PlayCardModComboAction) =>
  playCardModCombo(state, seat, action);

// An interior vertex (3 edges) with plenty of room, used as seat 0's "home base" settlement for the
// road-placing combos (rideByNight/monorail) — same choice `phases/devCards.test.ts`'s Road
// Building tests make for the identical reason.
const HOME_V = GEOMETRY.vertices.find((v) => v.edges.length === 3)!.id as VertexId;
const HOME_EDGES = GEOMETRY.vertices[HOME_V]!.edges;

describe('rideByNight (Knight + Road Building, 1 free road)', () => {
  it('consumes both cards, builds 1 free road, moves the robber, and resolves a single steal', () => {
    const s = craft({
      robber: 0,
      place: [
        {
          seat: 0,
          settlements: [HOME_V],
          devCards: [
            { type: 'knight', boughtOnTurn: 1 },
            { type: 'roadBuilding', boughtOnTurn: 1 },
          ],
        },
        { seat: 1, settlements: [h(5).vertices[0]!], hand: { brick: 2 } },
      ],
    });
    const res = play(s, 0, {
      type: 'playCardModCombo',
      combo: 'rideByNight',
      edge: HOME_EDGES[0]!,
      hex: 5 as HexId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.devCards).toEqual([]);
    expect(res.state.players[0]!.roads).toEqual([HOME_EDGES[0]]);
    expect(res.state.players[0]!.playedKnights).toBe(1);
    expect(res.state.turn.devPlayed).toBe(true);
    expect(res.state.board.robber).toBe(5);
    expect(findEvent(res.events, 'built')).toMatchObject({ seat: 0, piece: 'road', location: HOME_EDGES[0] });
    expect(findEvent(res.events, 'robberMoved')).toMatchObject({ seat: 0, hex: 5 });
    expect(findEvent(res.events, 'stolen')).toMatchObject({ from: 1, to: 0 });
    expect(findEvent(res.events, 'devPlayed')).toMatchObject({ seat: 0, card: 'rideByNight' });
  });

  it('propagates the component-card guard (CARD_NOT_HELD) when no Knight is held', () => {
    const s = craft({
      place: [{ seat: 0, settlements: [HOME_V], devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }] }],
    });
    expect(
      code(play(s, 0, { type: 'playCardModCombo', combo: 'rideByNight', edge: HOME_EDGES[0]!, hex: 5 as HexId }))
    ).toBe('CARD_NOT_HELD');
  });

  it('BAD_LOCATION when the edge is not connected to seat 0\'s network', () => {
    const disconnected = GEOMETRY.edges.find((e) => !HOME_EDGES.includes(e.id))!.id;
    const s = craft({
      place: [
        {
          seat: 0,
          settlements: [HOME_V],
          devCards: [
            { type: 'knight', boughtOnTurn: 1 },
            { type: 'roadBuilding', boughtOnTurn: 1 },
          ],
        },
      ],
    });
    expect(
      code(play(s, 0, { type: 'playCardModCombo', combo: 'rideByNight', edge: disconnected, hex: 5 as HexId }))
    ).toBe('BAD_LOCATION');
  });
});

describe('nightOfPlenty (Knight + Year of Plenty, 1 resource)', () => {
  it('consumes both cards, grants 1 resource, and moves the robber (0 candidates)', () => {
    const s = craft({
      robber: 0,
      place: [
        {
          seat: 0,
          devCards: [
            { type: 'knight', boughtOnTurn: 1 },
            { type: 'yearOfPlenty', boughtOnTurn: 1 },
          ],
        },
      ],
    });
    const res = play(s, 0, { type: 'playCardModCombo', combo: 'nightOfPlenty', resource: 'ore', hex: 5 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.ore).toBe(1);
    expect(res.state.players[0]!.devCards).toEqual([]);
    expect(res.state.players[0]!.playedKnights).toBe(1);
    expect(res.state.board.robber).toBe(5);
    expect(res.state.bank.ore).toBe(s.bank.ore - 1);
    expect(findEvent(res.events, 'production')).toMatchObject({ gains: [{ seat: 0, resources: { ore: 1 } }] });
  });

  it('BANK_EMPTY when the bank has none of the named resource', () => {
    const s = craft({
      bank: { ore: 0 },
      place: [
        {
          seat: 0,
          devCards: [
            { type: 'knight', boughtOnTurn: 1 },
            { type: 'yearOfPlenty', boughtOnTurn: 1 },
          ],
        },
      ],
    });
    expect(
      code(play(s, 0, { type: 'playCardModCombo', combo: 'nightOfPlenty', resource: 'ore', hex: 5 as HexId }))
    ).toBe('BANK_EMPTY');
  });
});

describe('monorail (Monopoly + Road Building, wood+brick monopoly)', () => {
  it('consumes both cards, takes all lumber+brick from every opponent, and builds 2 free roads', () => {
    const s = craft({
      place: [
        {
          seat: 0,
          settlements: [HOME_V],
          devCards: [
            { type: 'monopoly', boughtOnTurn: 1 },
            { type: 'roadBuilding', boughtOnTurn: 1 },
          ],
        },
        { seat: 1, hand: { lumber: 3, brick: 1, wool: 2 } },
        { seat: 2, hand: { lumber: 0, brick: 2 } },
      ],
    });
    const res = play(s, 0, {
      type: 'playCardModCombo',
      combo: 'monorail',
      edges: [HOME_EDGES[0]!, HOME_EDGES[1]!],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.lumber).toBe(3);
    expect(res.state.players[0]!.resources.brick).toBe(3);
    expect(res.state.players[1]!.resources.lumber).toBe(0);
    expect(res.state.players[1]!.resources.brick).toBe(0);
    expect(res.state.players[1]!.resources.wool).toBe(2); // untouched
    expect(res.state.players[2]!.resources.brick).toBe(0);
    expect(res.state.players[0]!.roads.sort()).toEqual([HOME_EDGES[0], HOME_EDGES[1]].sort());
    expect(res.state.players[0]!.devCards).toEqual([]);
    expect(findEvent(res.events, 'monopolyResolved')).toBeTruthy();
  });

  it('BAD_CARD_TARGET when the edges count is not 1 or 2', () => {
    const s = craft({
      place: [
        {
          seat: 0,
          settlements: [HOME_V],
          devCards: [
            { type: 'monopoly', boughtOnTurn: 1 },
            { type: 'roadBuilding', boughtOnTurn: 1 },
          ],
        },
      ],
    });
    expect(code(play(s, 0, { type: 'playCardModCombo', combo: 'monorail', edges: [] }))).toBe('BAD_CARD_TARGET');
  });
});

describe('megaKnight (2 Knights, steal a dev card at random)', () => {
  it('consumes 2 Knights and moves a random dev card from the target to the actor', () => {
    const s = craft({
      place: [
        {
          seat: 0,
          devCards: [
            { type: 'knight', boughtOnTurn: 1 },
            { type: 'knight', boughtOnTurn: 1 },
          ],
        },
        { seat: 1, devCards: [{ type: 'monopoly', boughtOnTurn: 1 }] },
      ],
    });
    const res = play(s, 0, { type: 'playCardModCombo', combo: 'megaKnight', targetSeat: 1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.devCards).toEqual([{ type: 'monopoly', boughtOnTurn: 1 }]);
    expect(res.state.players[1]!.devCards).toEqual([]);
    expect(res.state.players[0]!.playedKnights).toBe(2);
    expect(res.state.turn.devPlayed).toBe(true);
  });

  it('CARD_NOT_HELD when fewer than 2 playable Knights are held', () => {
    const s = craft({
      place: [
        { seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 1 }] },
        { seat: 1, devCards: [{ type: 'monopoly', boughtOnTurn: 1 }] },
      ],
    });
    expect(code(play(s, 0, { type: 'playCardModCombo', combo: 'megaKnight', targetSeat: 1 }))).toBe('CARD_NOT_HELD');
  });

  it('NOT_A_CANDIDATE when the target holds no dev cards', () => {
    const s = craft({
      place: [
        {
          seat: 0,
          devCards: [
            { type: 'knight', boughtOnTurn: 1 },
            { type: 'knight', boughtOnTurn: 1 },
          ],
        },
        { seat: 1, devCards: [] },
      ],
    });
    expect(code(play(s, 0, { type: 'playCardModCombo', combo: 'megaKnight', targetSeat: 1 }))).toBe(
      'NOT_A_CANDIDATE'
    );
  });
});

describe('superSettle (discard a Victory Point card to build a city)', () => {
  it('upgrades a settlement to a city without paying the ore+grain cost', () => {
    const s = craft({
      place: [
        {
          seat: 0,
          settlements: [HOME_V],
          devCards: [{ type: 'victoryPoint', boughtOnTurn: 1 }],
        },
      ],
    });
    const res = play(s, 0, { type: 'playCardModCombo', combo: 'superSettle', vertex: HOME_V });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.settlements).toEqual([]);
    expect(res.state.players[0]!.cities).toEqual([HOME_V]);
    expect(res.state.players[0]!.devCards).toEqual([]);
    expect(res.state.players[0]!.resources).toEqual(s.players[0]!.resources); // no cost paid
    expect(res.state.turn.devPlayed).toBe(false); // VP cards are exempt from R9.3 (R9.8)
    expect(findEvent(res.events, 'built')).toMatchObject({ seat: 0, piece: 'city', location: HOME_V });
  });

  it('CARD_NOT_HELD when no Victory Point card is held', () => {
    const s = craft({ place: [{ seat: 0, settlements: [HOME_V] }] });
    expect(code(play(s, 0, { type: 'playCardModCombo', combo: 'superSettle', vertex: HOME_V }))).toBe(
      'CARD_NOT_HELD'
    );
  });

  it('BAD_LOCATION when the vertex is not one of the seat\'s own settlements', () => {
    const s = craft({
      place: [{ seat: 0, devCards: [{ type: 'victoryPoint', boughtOnTurn: 1 }] }],
    });
    expect(code(play(s, 0, { type: 'playCardModCombo', combo: 'superSettle', vertex: HOME_V }))).toBe(
      'BAD_LOCATION'
    );
  });
});
