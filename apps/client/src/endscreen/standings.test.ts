import { redact, events as ev } from '@hexhaven/engine';
import type { VpBreakdown } from '@hexhaven/engine';
import type { GameState, Seat, VertexId } from '@hexhaven/shared';
import { describe, expect, it } from 'vitest';
import { baseState } from './testFixtures';
import { buildStandings, findWonBreakdown } from './standings';

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;
const SEAT2 = 2 as Seat;
const SEAT3 = 3 as Seat;

function makeBreakdown(overrides: Partial<VpBreakdown> = {}): VpBreakdown {
  return { settlements: 2, cities: 2, longestRoad: 2, largestArmy: 0, vpCards: 1, islandChits: 0, total: 9, ...overrides };
}

/** A `gameWon`-ended `GameState`: seat 1 wins with 2 settlements + 1 city + Longest Road + 1
 * hidden VP card (10 total); every other seat gets a small, purely public pile. */
function endedState(): GameState {
  const g = baseState();
  const players = g.players.map((p) => {
    if (p.seat === SEAT0) return { ...p, settlements: [1, 2] as VertexId[] }; // 2 VP, public
    if (p.seat === SEAT1) {
      return {
        ...p,
        settlements: [3, 4] as VertexId[], // 2
        cities: [5] as VertexId[], // 2
        devCards: [{ type: 'victoryPoint' as const, boughtOnTurn: 3 }], // 1 hidden
      };
    }
    if (p.seat === SEAT2) return { ...p, settlements: [6] as VertexId[] }; // 1 VP, public
    return { ...p, settlements: [7] as VertexId[] }; // seat 3: 1 VP, public
  });
  return {
    ...g,
    players,
    awards: { longestRoad: { holder: SEAT1, length: 6 }, largestArmy: { holder: null, count: 0 } },
    phase: { kind: 'ended', winner: SEAT1 },
  };
}

describe('findWonBreakdown', () => {
  it('finds the vpBreakdown on the most recent gameWon event', () => {
    const breakdown = makeBreakdown();
    const found = findWonBreakdown([
      { type: 'diceRolled', seat: SEAT0, roll: [3, 4] },
      ev.gameWon(SEAT1, breakdown),
    ]);
    expect(found).toEqual(breakdown);
  });

  it('returns null when no gameWon event is present', () => {
    expect(findWonBreakdown([{ type: 'diceRolled', seat: SEAT0, roll: [3, 4] }])).toBeNull();
  });

  it('ignores a gameWon event whose vpBreakdown does not look like a real breakdown', () => {
    expect(findWonBreakdown([ev.gameWon(SEAT1, { total: 'not a number' })])).toBeNull();
  });
});

describe('buildStandings (T-408 requirement 1: full VP reveal for the winner only)', () => {
  it("reveals the winner's hidden VP cards from the gameWon breakdown for a non-winning viewer", () => {
    const state = endedState();
    const view = redact(state, SEAT0);
    const breakdown = makeBreakdown();

    const rows = buildStandings(view, SEAT1, breakdown);
    const winnerRow = rows.find((r) => r.seat === SEAT1)!;

    expect(winnerRow.isWinner).toBe(true);
    expect(winnerRow.isSelf).toBe(false);
    expect(winnerRow.vpCards).toBe(1); // revealed, not null
    expect(winnerRow.total).toBe(9);
  });

  it("never fabricates a non-winning opponent's hidden VP cards (stays null, public total only)", () => {
    const state = endedState();
    const view = redact(state, SEAT0);
    const rows = buildStandings(view, SEAT1, null);

    const seat2Row = rows.find((r) => r.seat === SEAT2)!;
    const seat3Row = rows.find((r) => r.seat === SEAT3)!;
    expect(seat2Row.vpCards).toBeNull();
    expect(seat3Row.vpCards).toBeNull();
    expect(seat2Row.total).toBe(1);
    expect(seat3Row.total).toBe(1);
  });

  it("always resolves the VIEWER's own row from their own full hand, win or lose", () => {
    const state = endedState();
    const view = redact(state, SEAT0); // seat 0 lost
    const rows = buildStandings(view, SEAT1, null);

    const ownRow = rows.find((r) => r.seat === SEAT0)!;
    expect(ownRow.isSelf).toBe(true);
    expect(ownRow.isWinner).toBe(false);
    expect(ownRow.vpCards).toBe(0); // known (not hidden-to-self), just happens to be zero
    expect(ownRow.total).toBe(2);
  });

  it("uses the viewer's own computed VP (not a wonBreakdown lookup) when the viewer IS the winner", () => {
    const state = endedState();
    const view = redact(state, SEAT1); // seat 1 (the winner) viewing their own screen
    const rows = buildStandings(view, SEAT1, null); // no event needed — own hand already has it

    const ownRow = rows.find((r) => r.seat === SEAT1)!;
    expect(ownRow.isSelf).toBe(true);
    expect(ownRow.isWinner).toBe(true);
    expect(ownRow.vpCards).toBe(1);
    // 2 settlements (2) + 1 city (2) + Longest Road (2) + 1 hidden VP card (1) = 7.
    expect(ownRow.total).toBe(7);
  });

  it('marks the longest-road holder from state.awards, not from the fixed board pieces alone', () => {
    const state = endedState();
    const view = redact(state, SEAT0);
    const rows = buildStandings(view, SEAT1, makeBreakdown());
    expect(rows.find((r) => r.seat === SEAT1)!.longestRoad).toBe(2);
    expect(rows.find((r) => r.seat === SEAT0)!.longestRoad).toBe(0);
  });

  it('ranks rows by (each viewer-visible) total VP descending, seat ascending on ties', () => {
    const state = endedState();
    const view = redact(state, SEAT0);
    const rows = buildStandings(view, SEAT1, makeBreakdown());
    expect(rows.map((r) => r.seat)).toEqual([SEAT1, SEAT0, SEAT2, SEAT3]);
  });
});
