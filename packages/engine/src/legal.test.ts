// T-111: `publicVp`/`ownVp` — the public/private VP split the HUD (and later T-204's server
// redaction) needs: public VP never reveals hidden VP-card counts (R9.8); a seat's own VP total
// legitimately includes them.

import { describe, expect, it } from 'vitest';
import type { GameState, Seat, VertexId } from '@hexhaven/shared';
import { legalFreeRoadEdges, ownVp, publicVp } from './legal.js';
import { canPlaceRoad } from './rules/connectivity.js';
import { stateWith } from './testkit.js';

function withPlayer(state: GameState, seat: Seat, patch: Partial<GameState['players'][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p)) };
}

describe('publicVp (R13.1 minus hidden VP-card count)', () => {
  it('matches the testkit base (no VP cards) — 2 settlements = 2', () => {
    const s = stateWith();
    expect(publicVp(s, 0)).toBe(2);
  });

  it('excludes hidden VP cards even though the total does include them', () => {
    const s = withPlayer(stateWith(), 0, {
      devCards: [
        { type: 'victoryPoint', boughtOnTurn: 1 },
        { type: 'victoryPoint', boughtOnTurn: 2 },
      ],
    });
    expect(publicVp(s, 0)).toBe(2); // still just the 2 settlements — VP cards hidden
    expect(ownVp(s, 0)).toBe(4); // the owner's own total DOES include them
  });

  it('reflects settlements/cities/awards identically to the private total', () => {
    const s: GameState = {
      ...withPlayer(stateWith(), 0, { settlements: [1, 2, 3] as VertexId[], cities: [10] as VertexId[] }),
      awards: { longestRoad: { holder: 0, length: 5 }, largestArmy: { holder: null, count: 0 } },
    };
    // 3 settlements + 1 city*2 + longestRoad 2 = 7, no hidden cards to strip.
    expect(publicVp(s, 0)).toBe(7);
    expect(ownVp(s, 0)).toBe(7);
  });
});

describe('legalFreeRoadEdges (Road Building sub-phase, R9.6/ER-5)', () => {
  it('returns [] outside the roadBuilding phase', () => {
    expect(legalFreeRoadEdges(stateWith(), 0)).toEqual([]);
  });

  it('offers exactly the canPlaceRoad edges while roadBuilding is active', () => {
    const s = stateWith({ phase: { kind: 'roadBuilding', remaining: 2 } });
    const edges = legalFreeRoadEdges(s, 0);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((e) => canPlaceRoad(s, 0, e))).toBe(true);
  });
});
