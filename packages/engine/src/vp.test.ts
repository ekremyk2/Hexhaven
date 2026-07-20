import { describe, expect, it } from 'vitest';
import type { GameState, Seat, VertexId } from '@hexhaven/shared';
import { checkWin, computeVp } from './vp.js';
import { stateWith } from './testkit.js';

/** Replace one player's holdings without touching the others. */
function withPlayer(
  state: GameState,
  seat: Seat,
  patch: Partial<GameState['players'][number]>
): GameState {
  return {
    ...state,
    players: state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p)),
  };
}

describe('computeVp (R13.1)', () => {
  it('counts the testkit base correctly: 2 settlements = 2 VP', () => {
    const s = stateWith();
    expect(computeVp(s, 0).total).toBe(2);
    expect(computeVp(s, 0)).toEqual({
      settlements: 2,
      cities: 0,
      longestRoad: 0,
      largestArmy: 0,
      vpCards: 0,
      islandChits: 0,
      total: 2,
    });
  });

  it('scores settlements ·1, cities ·2, VP cards ·1 — knights and played knights score 0', () => {
    const s = withPlayer(stateWith(), 0, {
      settlements: [1, 2, 3] as VertexId[],
      cities: [10, 11] as VertexId[],
      devCards: [
        { type: 'victoryPoint', boughtOnTurn: 2 },
        { type: 'victoryPoint', boughtOnTurn: 3 },
        { type: 'knight', boughtOnTurn: 2 },
      ],
      playedKnights: 5,
    });
    expect(computeVp(s, 0)).toEqual({
      settlements: 3,
      cities: 2,
      longestRoad: 0,
      largestArmy: 0,
      vpCards: 2,
      islandChits: 0,
      total: 9,
    });
  });

  it('reads award VP from state.awards, not from a recomputation', () => {
    // Awards granted while the player holds NO roads and NO played knights: the values must
    // still count — T-110/T-111 own maintaining state.awards, vp.ts only reads it.
    const s: GameState = {
      ...withPlayer(stateWith(), 0, { settlements: [], roads: [], playedKnights: 0 }),
      awards: {
        longestRoad: { holder: 0, length: 6 },
        largestArmy: { holder: 0, count: 3 },
      },
    };
    expect(computeVp(s, 0)).toEqual({
      settlements: 0,
      cities: 0,
      longestRoad: 2,
      largestArmy: 2,
      vpCards: 0,
      islandChits: 0,
      total: 4,
    });
    expect(computeVp(s, 1).longestRoad).toBe(0);
    expect(computeVp(s, 1).largestArmy).toBe(0);
  });

  it('throws BUG: for a seat with no player', () => {
    expect(() => computeVp(stateWith(), 5)).toThrow(/^BUG:/);
  });
});

describe('checkWin (R13.2)', () => {
  it('returns the same reference when the active player is below targetVp', () => {
    const s = stateWith();
    expect(checkWin(s)).toBe(s);
  });

  it('flips to ended when the active player reaches exactly targetVp', () => {
    // 2 settlements + 4 cities = 10 VP.
    const s = withPlayer(stateWith(), 0, {
      settlements: [1, 2] as VertexId[],
      cities: [10, 11, 12, 13] as VertexId[],
    });
    expect(checkWin(s).phase).toEqual({ kind: 'ended', winner: 0 });
  });

  it('reads targetVp from the config (module-tunable, docs/03 §8)', () => {
    const five = withPlayer(stateWith({ config: { targetVp: 5 } }), 0, {
      settlements: [1, 2, 3, 4, 5] as VertexId[],
    });
    expect(checkWin(five).phase).toEqual({ kind: 'ended', winner: 0 });
    // The same 5 VP with the base target of 10 does not win.
    const ten = withPlayer(stateWith(), 0, { settlements: [1, 2, 3, 4, 5] as VertexId[] });
    expect(checkWin(ten)).toBe(ten);
  });

  it('ignores non-active players however rich they are', () => {
    const s = withPlayer(stateWith(), 1, {
      settlements: [1, 2] as VertexId[],
      cities: [10, 11, 12, 13] as VertexId[],
    });
    expect(checkWin(s)).toBe(s); // player 0 is active with 2 VP
  });

  it('counts VP cards bought this very turn (R9.8)', () => {
    const base = stateWith();
    const s = withPlayer(base, 0, {
      devCards: Array.from({ length: 8 }, () => ({
        type: 'victoryPoint' as const,
        boughtOnTurn: base.turn.number, // bought right now — still counts for the win
      })),
    }); // 2 settlements + 8 VP cards = 10
    expect(checkWin(s).phase).toEqual({ kind: 'ended', winner: 0 });
  });

  it('leaves an already-ended state untouched', () => {
    const s = stateWith({ phase: { kind: 'ended', winner: 3 } });
    expect(checkWin(s)).toBe(s);
  });
});
