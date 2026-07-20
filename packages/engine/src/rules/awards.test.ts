// T-111: Largest Army (R12) lifecycle and `updateAwards` composing BOTH halves (Longest Road,
// T-110, untouched; Largest Army, this task) into one recompute + `awardMoved` emission pass.

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { EdgeId, GameState, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { awardMoved } from '../events.js';
import { stateWith } from '../testkit.js';
import { updateAwards, updateLargestArmy } from './awards.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

/** A bare `main`-phase state (docs/05 §4 pattern) with NO pieces on the board at all, so a
 *  hand-picked road chain never collides with anyone's settlements — used only for the
 *  "both awards move together" composition test below (mirrors longestRoad.test.ts's `craft`). */
function bareState(roads: Partial<Record<Seat, EdgeId[]>>): GameState {
  const g = createGame({ ...CONFIG, seed: 'awards-compose' });
  const players = g.players.map((p) => ({ ...p, roads: roads[p.seat] ?? [] }));
  return { ...g, players, phase: { kind: 'main' }, turn: { ...g.turn, rolled: true } };
}

/** Backtracking search for a SIMPLE 5-edge path from `start` — no other pieces on this board, so
 *  nothing needs avoiding (mirrors the finder in longestRoad.test.ts). */
function find5Chain(start: VertexId): EdgeId[] {
  const path: VertexId[] = [start];
  const edges: EdgeId[] = [];
  function rec(): boolean {
    if (edges.length === 5) return true;
    const v = GEOMETRY.vertices[path[path.length - 1]!]!;
    for (let i = 0; i < v.neighbors.length; i++) {
      const next = v.neighbors[i]!;
      const edge = v.edges[i]!;
      if (path.includes(next)) continue;
      path.push(next);
      edges.push(edge);
      if (rec()) return true;
      path.pop();
      edges.pop();
    }
    return false;
  }
  if (!rec()) throw new Error('BUG: test setup — no 5-edge chain found from this vertex');
  return [...edges];
}

/** Set one seat's `playedKnights`, leaving everything else (incl. other seats) untouched. */
function withKnights(state: GameState, counts: Partial<Record<Seat, number>>): GameState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.seat in counts ? { ...p, playedKnights: counts[p.seat as Seat]! } : p
    ),
  };
}

describe('updateLargestArmy — award lifecycle (R12)', () => {
  it('nobody qualifies below 3 played knights', () => {
    const s = withKnights(stateWith(), { 0: 2 });
    expect(updateLargestArmy(s).awards.largestArmy).toEqual({ holder: null, count: 0 });
  });

  it('first-to-3 takes the card', () => {
    const s = withKnights(stateWith(), { 0: 3 });
    expect(updateLargestArmy(s).awards.largestArmy).toEqual({ holder: 0, count: 3 });
  });

  it('3 vs 3 keeps the current holder (ties never dislodge)', () => {
    const s = withKnights(stateWith({ awards: { largestArmy: { holder: 0, count: 3 } } }), {
      0: 3,
      1: 3,
    });
    expect(updateLargestArmy(s).awards.largestArmy).toEqual({ holder: 0, count: 3 });
  });

  it('4 steals it (strictly more required)', () => {
    const s = withKnights(stateWith({ awards: { largestArmy: { holder: 0, count: 3 } } }), {
      0: 3,
      1: 4,
    });
    expect(updateLargestArmy(s).awards.largestArmy).toEqual({ holder: 1, count: 4 });
  });

  it('the card is never set aside once claimed (unlike Longest Road)', () => {
    // Holder's own tally can only grow, but a third seat merely tying the holder must not clear it.
    const s = withKnights(stateWith({ awards: { largestArmy: { holder: 0, count: 3 } } }), {
      0: 3,
      1: 3,
      2: 3,
    });
    const next = updateLargestArmy(s);
    expect(next.awards.largestArmy.holder).toBe(0);
  });

  it('returns the SAME reference when nothing changes', () => {
    const s = withKnights(stateWith({ awards: { largestArmy: { holder: 0, count: 3 } } }), {
      0: 3,
    });
    expect(updateLargestArmy(s)).toBe(s);
  });
});

describe('updateAwards — Longest Road + Largest Army composed (T-110 + T-111)', () => {
  it('emits awardMoved for largestArmy only, leaving an unclaimed longestRoad untouched', () => {
    // The testkit base has no seat with a road chain reaching 5 — longestRoad starts (and stays)
    // unclaimed; only playing knights should move anything.
    const base = stateWith();
    expect(base.awards.longestRoad).toEqual({ holder: null, length: 0 });
    const s = withKnights(base, { 0: 3 });

    const result = updateAwards(s);
    expect(result.state.awards.largestArmy).toEqual({ holder: 0, count: 3 });
    expect(result.state.awards.longestRoad).toEqual({ holder: null, length: 0 }); // unchanged
    expect(result.events).toEqual([awardMoved('largestArmy', 0, 3)]);
  });

  it('emits both awardMoved events when a single recompute moves both awards', () => {
    // Seat 0 gets a 5-edge road chain (claims Longest Road) AND already has 3 played knights —
    // one `updateAwards` call must move both. Built on a bare, piece-free board so the chain
    // can't collide with anyone's settlements.
    const chain = find5Chain(GEOMETRY.vertices[0]!.id);
    const s = withKnights(bareState({ 0: chain }), { 0: 3 });

    const result = updateAwards(s);
    expect(result.state.awards.longestRoad).toEqual({ holder: 0, length: 5 });
    expect(result.state.awards.largestArmy).toEqual({ holder: 0, count: 3 });
    expect(result.events).toEqual(
      expect.arrayContaining([awardMoved('longestRoad', 0, 5), awardMoved('largestArmy', 0, 3)])
    );
    expect(result.events).toHaveLength(2);
  });

  it('is a no-op (same reference, no events) when neither award changes', () => {
    const s = withKnights(stateWith({ awards: { largestArmy: { holder: 0, count: 3 } } }), {
      0: 3,
    });
    const result = updateAwards(s);
    expect(result.state).toBe(s);
    expect(result.events).toEqual([]);
  });
});
