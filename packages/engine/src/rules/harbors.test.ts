import { describe, it, expect } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { EdgeId, GameState, HarborType, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { playerHarbors, tradeRate } from './harbors.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

interface Place {
  seat: Seat;
  settlements?: number[];
  cities?: number[];
}

/** A `main`-shaped state with a hand-picked `board.harbors` map and player buildings. */
function harborState(opts: { harbors?: Record<EdgeId, HarborType>; place?: Place[] } = {}): GameState {
  const g = createGame({ ...CONFIG, seed: 'harbors' });
  const players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    return {
      ...p,
      settlements: (pl.settlements ?? []).map((n) => n as VertexId),
      cities: (pl.cities ?? []).map((n) => n as VertexId),
    };
  });
  return { ...g, players, board: { ...g.board, harbors: opts.harbors ?? {} } };
}

// Two arbitrary-but-fixed edges from the frozen base GEOMETRY, used as harbor spots regardless
// of whether they're really among the 9 official ones — only the endpoint/ownership logic is
// under test here.
const BRICK_EDGE = GEOMETRY.edges[0]!;
const GENERIC_EDGE = GEOMETRY.edges[GEOMETRY.edges.length - 1]!;

describe('tradeRate / playerHarbors (R8.2, R1.3)', () => {
  it('no harbors on the board → base 4:1 for every resource, even sitting on a would-be spot', () => {
    const s = harborState({ place: [{ seat: 0, settlements: [BRICK_EDGE.a] }] });
    expect(tradeRate(s, 0, 'brick')).toBe(4);
    expect(tradeRate(s, 0, 'ore')).toBe(4);
    expect(playerHarbors(s, 0)).toEqual([]);
  });

  it('a generic harbor grants 3:1 for every resource', () => {
    const s = harborState({
      harbors: { [GENERIC_EDGE.id]: 'generic' },
      place: [{ seat: 0, settlements: [GENERIC_EDGE.a] }],
    });
    expect(tradeRate(s, 0, 'brick')).toBe(3);
    expect(tradeRate(s, 0, 'wool')).toBe(3);
    expect(playerHarbors(s, 0)).toEqual(['generic']);
  });

  it('a specific brick harbor grants 2:1 for brick only; other resources fall to base 4:1', () => {
    const s = harborState({
      harbors: { [BRICK_EDGE.id]: 'brick' },
      place: [{ seat: 0, settlements: [BRICK_EDGE.a] }],
    });
    expect(tradeRate(s, 0, 'brick')).toBe(2);
    expect(tradeRate(s, 0, 'lumber')).toBe(4);
    expect(tradeRate(s, 0, 'ore')).toBe(4);
  });

  it('a building on either endpoint of the harbor edge grants the rate (settlement or city)', () => {
    const onA = harborState({
      harbors: { [BRICK_EDGE.id]: 'brick' },
      place: [{ seat: 0, settlements: [BRICK_EDGE.a] }],
    });
    const onB = harborState({
      harbors: { [BRICK_EDGE.id]: 'brick' },
      place: [{ seat: 0, cities: [BRICK_EDGE.b] }], // a city counts too
    });
    expect(tradeRate(onA, 0, 'brick')).toBe(2);
    expect(tradeRate(onB, 0, 'brick')).toBe(2);
  });

  it("an opponent's building on the harbor edge does not grant YOU the rate (each their own)", () => {
    const s = harborState({
      harbors: { [BRICK_EDGE.id]: 'brick' },
      place: [{ seat: 1, settlements: [BRICK_EDGE.a] }], // seat 1 sits on the harbor, not seat 0
    });
    expect(tradeRate(s, 0, 'brick')).toBe(4); // seat 0 gets nothing from it
    expect(tradeRate(s, 1, 'brick')).toBe(2); // seat 1 correctly does
    expect(playerHarbors(s, 0)).toEqual([]);
  });

  it('playerHarbors aggregates multiple harbors and tradeRate picks the specific one over generic', () => {
    const s = harborState({
      harbors: { [BRICK_EDGE.id]: 'brick', [GENERIC_EDGE.id]: 'generic' },
      place: [{ seat: 0, settlements: [BRICK_EDGE.a, GENERIC_EDGE.a] }],
    });
    expect([...playerHarbors(s, 0)].sort()).toEqual(['brick', 'generic']);
    expect(tradeRate(s, 0, 'brick')).toBe(2); // specific beats generic
    expect(tradeRate(s, 0, 'wool')).toBe(3); // falls back to generic
  });
});
