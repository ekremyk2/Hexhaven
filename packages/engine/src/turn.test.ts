import { describe, expect, it } from 'vitest';
import type { GameState, Phase, Seat } from '@hexhaven/shared';
import { createGame } from './createGame.js';
import { advanceTurn, handleEndTurn, requireMain, requireRolled } from './turn.js';
import { reduce } from './reduce.js';
import type { EngineError, EngineResult } from './reduce.js';
import { stateWith } from './testkit.js';

function expectOk(r: EngineResult): Extract<EngineResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r;
}

function expectErr(r: EngineResult): EngineError {
  if (r.ok) throw new Error('expected an error result');
  return r.error;
}

describe('advanceTurn', () => {
  it('moves to the next seat, bumps turn.number, resets flags, phase → preRoll', () => {
    const s = stateWith({
      turn: { player: 2, devPlayed: true },
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    const next = advanceTurn(s);
    expect(next.turn).toEqual({
      number: s.turn.number + 1,
      player: 3,
      rolled: false,
      roll: null,
      devPlayed: false,
    });
    expect(next.phase).toEqual({ kind: 'preRoll' });
    expect(next.trade).toBeNull(); // R8.1/ER-11: an offer never outlives its owner's turn
  });

  it('wraps from the last seat to seat 0', () => {
    expect(advanceTurn(stateWith({ turn: { player: 3 } })).turn.player).toBe(0);
  });

  it('respects config.playerCount for 3-player games', () => {
    const g = createGame({
      playerCount: 3,
      targetVp: 10,
      seed: 'threep',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    });
    const s: GameState = {
      ...g,
      phase: { kind: 'main' },
      turn: { ...g.turn, player: 2 as Seat, rolled: true, roll: [3, 3] },
    };
    expect(advanceTurn(s).turn.player).toBe(0);
  });
});

describe('endTurn through the dispatcher', () => {
  it('rotates through all 4 seats with a turnEnded event each time', () => {
    for (let seat = 0; seat < 4; seat++) {
      const s = stateWith({ turn: { player: seat as Seat } });
      const r = expectOk(reduce(s, seat as Seat, { type: 'endTurn' }));
      const expectedNext = ((seat + 1) % 4) as Seat;
      expect(r.state.turn.player).toBe(expectedNext);
      expect(r.state.turn.number).toBe(s.turn.number + 1);
      expect(r.state.phase).toEqual({ kind: 'preRoll' });
      expect(r.events).toEqual([{ type: 'turnEnded', seat, next: expectedNext }]);
    }
  });

  it('resets the per-turn flags and clears an open trade', () => {
    const s = stateWith({
      turn: { devPlayed: true, roll: [6, 1] },
      trade: { give: { ore: 2 }, receive: { grain: 1 }, responses: { 1: 'accepted' } },
    });
    const r = expectOk(reduce(s, 0, { type: 'endTurn' }));
    expect(r.state.turn.rolled).toBe(false);
    expect(r.state.turn.roll).toBeNull();
    expect(r.state.turn.devPlayed).toBe(false);
    expect(r.state.trade).toBeNull();
  });

  it('enforces the mandatory roll: endTurn in preRoll → MUST_ROLL_FIRST (ER-7)', () => {
    const s = stateWith({ phase: { kind: 'preRoll' }, turn: { rolled: false, roll: null } });
    expect(expectErr(reduce(s, 0, { type: 'endTurn' })).code).toBe('MUST_ROLL_FIRST');
  });

  it('rejects endTurn in every non-main, non-preRoll phase with WRONG_PHASE', () => {
    const phases: Phase[] = [
      { kind: 'setup', round: 2, expect: 'road', lastSettlement: null },
      { kind: 'discard', pending: [1], amounts: { 0: 0, 1: 4, 2: 0, 3: 0, 4: 0, 5: 0 } },
      { kind: 'moveRobber', returnTo: 'main' },
      { kind: 'steal', candidates: [1, 2], returnTo: 'main' },
      { kind: 'roadBuilding', remaining: 2 },
    ];
    for (const phase of phases) {
      const s = stateWith({ phase });
      expect(expectErr(reduce(s, 0, { type: 'endTurn' })).code).toBe('WRONG_PHASE');
    }
  });
});

describe('guards', () => {
  it('requireRolled: null once rolled, MUST_ROLL_FIRST before', () => {
    expect(requireRolled(stateWith())).toBeNull();
    const s = stateWith({ phase: { kind: 'preRoll' }, turn: { rolled: false, roll: null } });
    expect(requireRolled(s)?.code).toBe('MUST_ROLL_FIRST');
  });

  it('requireMain: null in main, WRONG_PHASE elsewhere', () => {
    expect(requireMain(stateWith())).toBeNull();
    expect(requireMain(stateWith({ phase: { kind: 'preRoll' } }))?.code).toBe('WRONG_PHASE');
  });

  it('handleEndTurn is defensive about an unrolled main phase (ER-7)', () => {
    const s = stateWith({ turn: { rolled: false, roll: null } }); // main, artificially unrolled
    expect(expectErr(handleEndTurn(s)).code).toBe('MUST_ROLL_FIRST');
  });
});
