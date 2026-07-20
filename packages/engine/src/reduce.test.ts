import { afterEach, describe, expect, it } from 'vitest';
import type { EdgeId, GameEvent, GameState, Phase, Seat, VertexId } from '@hexhaven/shared';
import { PHASE_HANDLERS, ok, reduce } from './reduce.js';
import type { EngineError, EngineResult } from './reduce.js';
import { built } from './events.js';
import { deepFreeze, stateWith } from './testkit.js';

function expectOk(r: EngineResult): Extract<EngineResult, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`);
  return r;
}

function expectErr(r: EngineResult): EngineError {
  if (r.ok) throw new Error('expected an error result');
  return r.error;
}

/** Give `seat` exactly 10 VP: 3 settlements + 2 cities + 3 VP cards (R13.1). */
function withTenVp(state: GameState, seat: Seat): GameState {
  const players = state.players.map((p) =>
    p.seat === seat
      ? {
          ...p,
          settlements: [10, 20, 30] as VertexId[],
          cities: [40, 45] as VertexId[],
          devCards: [
            { type: 'victoryPoint' as const, boughtOnTurn: 2 },
            { type: 'victoryPoint' as const, boughtOnTurn: 3 },
            { type: 'victoryPoint' as const, boughtOnTurn: 4 },
          ],
        }
      : p
  );
  return { ...state, players };
}

const originalMain = PHASE_HANDLERS.main;
const originalDiscard = PHASE_HANDLERS.discard;
afterEach(() => {
  PHASE_HANDLERS.main = originalMain;
  PHASE_HANDLERS.discard = originalDiscard;
});

describe('dispatcher guards', () => {
  it('rejects every action once the game has ended (GAME_OVER)', () => {
    const s = stateWith({ phase: { kind: 'ended', winner: 2 } });
    expect(expectErr(reduce(s, 0, { type: 'endTurn' })).code).toBe('GAME_OVER');
    expect(expectErr(reduce(s, 2, { type: 'rollDice' })).code).toBe('GAME_OVER');
    expect(expectErr(reduce(s, 1, { type: 'discard', cards: { brick: 1 } })).code).toBe(
      'GAME_OVER'
    );
  });

  it('rejects non-owner actions with NOT_YOUR_TURN (R4.3)', () => {
    const s = stateWith(); // player 0's main phase
    expect(expectErr(reduce(s, 1, { type: 'buildRoad', edge: 0 as EdgeId })).code).toBe(
      'NOT_YOUR_TURN'
    );
    expect(expectErr(reduce(s, 3, { type: 'rollDice' })).code).toBe('NOT_YOUR_TURN');
    expect(expectErr(reduce(s, 2, { type: 'endTurn' })).code).toBe('NOT_YOUR_TURN');
  });

  it('lets non-owner seats submit discard and respondTrade (R6.1, R8.1)', () => {
    const s = stateWith();
    // discard has no handler outside the `discard` sub-phase → WRONG_PHASE here (main phase) —
    // the point is the actor guard does NOT say NOT_YOUR_TURN for a non-owner seat.
    expect(expectErr(reduce(s, 1, { type: 'discard', cards: { brick: 1 } })).code).toBe(
      'WRONG_PHASE'
    );
    // respondTrade IS handled in `main` (T-108); with no open offer it correctly answers
    // NO_OPEN_OFFER (R8.1) — still proof the actor guard let seat 3 through, not NOT_YOUR_TURN.
    expect(expectErr(reduce(s, 3, { type: 'respondTrade', response: 'accept' })).code).toBe(
      'NO_OPEN_OFFER'
    );
  });

  it('answers WRONG_PHASE for actions the current phase has no handler for', () => {
    expect(expectErr(reduce(stateWith(), 0, { type: 'rollDice' })).code).toBe('WRONG_PHASE');
    const setup = stateWith({
      phase: { kind: 'setup', round: 1, expect: 'settlement', lastSettlement: null },
    });
    expect(
      expectErr(reduce(setup, 0, { type: 'buildSettlement', vertex: 3 as VertexId })).code
    ).toBe('WRONG_PHASE');
  });
});

describe('immutability (docs/05 §2)', () => {
  it('never mutates the input state — deep-frozen input survives ok and error paths', () => {
    const s = deepFreeze(stateWith());
    const snapshot = structuredClone(s);

    const okResult = reduce(s, 0, { type: 'endTurn' }); // would throw on any frozen write
    expect(okResult.ok).toBe(true);
    expect(s).toEqual(snapshot);

    const errResult = reduce(s, 1, { type: 'rollDice' });
    expect(errResult.ok).toBe(false);
    expect(s).toEqual(snapshot);
  });

  it('returns a new state object on success', () => {
    const s = stateWith();
    const r = expectOk(reduce(s, 0, { type: 'endTurn' }));
    expect(r.state).not.toBe(s);
  });
});

describe('stateVersion semantics (I9)', () => {
  it('increments by exactly 1 on success', () => {
    const s = stateWith(); // stateVersion 25
    expect(expectOk(reduce(s, 0, { type: 'endTurn' })).state.stateVersion).toBe(
      s.stateVersion + 1
    );
  });

  it('does not increment on error', () => {
    const s = stateWith();
    const before = s.stateVersion;
    expectErr(reduce(s, 0, { type: 'rollDice' }));
    expect(s.stateVersion).toBe(before);
  });

  it('owns the bump — a handler-tampered stateVersion is overridden', () => {
    PHASE_HANDLERS.main = (state) => ok({ ...state, stateVersion: 999 }, []);
    const s = stateWith();
    expect(expectOk(reduce(s, 0, { type: 'buyDevCard' })).state.stateVersion).toBe(
      s.stateVersion + 1
    );
  });
});

describe('win check (R13.2)', () => {
  it('a turn-owner action reaching 10 VP ends the game and emits gameWon', () => {
    // Simulated T-105 build handler: the build lifts the actor to 10 VP.
    PHASE_HANDLERS.main = (state, seat) =>
      ok(withTenVp(state, seat), [built(seat, 'settlement', 30 as VertexId)]);

    const r = expectOk(reduce(stateWith(), 0, { type: 'buildSettlement', vertex: 30 as VertexId }));
    expect(r.state.phase).toEqual({ kind: 'ended', winner: 0 });
    expect(r.events.map((e) => e.type)).toEqual(['built', 'gameWon']);
    const won = r.events.find(
      (e): e is Extract<GameEvent, { type: 'gameWon' }> => e.type === 'gameWon'
    );
    expect(won?.seat).toBe(0);
    expect((won?.vpBreakdown as { total: number }).total).toBe(10);
    expect(r.state.stateVersion).toBe(26);
  });

  it('the same VP on a non-owner action does NOT win (FAQ #16/#74)', () => {
    // Simulated T-106 discard handler that (artificially) leaves BOTH the actor and the
    // active player at 10 VP — neither may win off a non-owner's action.
    PHASE_HANDLERS.discard = (state) => ok(withTenVp(withTenVp(state, 2), 0), []);
    const discardPhase: Phase = {
      kind: 'discard',
      pending: [2],
      amounts: { 0: 0, 1: 0, 2: 4, 3: 0, 4: 0, 5: 0 },
    };
    const s = stateWith({ phase: discardPhase });

    const r = expectOk(reduce(s, 2, { type: 'discard', cards: { brick: 1 } }));
    expect(r.state.phase.kind).toBe('discard');
    expect(r.events.some((e) => e.type === 'gameWon')).toBe(false);
    expect(r.state.stateVersion).toBe(26);
  });

  it('a player already holding 10 VP wins at the start of their own turn (FAQ #16)', () => {
    // Unreachable in real play (VP never rises between own turns) but rule-correct: seat 3
    // ends the turn, seat 0 already holds 10 VP and wins the moment their turn begins.
    const s = withTenVp(stateWith({ turn: { player: 3 } }), 0);
    const r = expectOk(reduce(s, 3, { type: 'endTurn' }));
    expect(r.state.phase).toEqual({ kind: 'ended', winner: 0 });
    expect(r.events.map((e) => e.type)).toEqual(['turnEnded', 'gameWon']);
    const won = r.events.find(
      (e): e is Extract<GameEvent, { type: 'gameWon' }> => e.type === 'gameWon'
    );
    expect(won?.seat).toBe(0);
  });

  it('a turn-owner action below targetVp does not end the game', () => {
    const r = expectOk(reduce(stateWith(), 0, { type: 'endTurn' }));
    expect(r.state.phase.kind).toBe('preRoll');
    expect(r.events.some((e) => e.type === 'gameWon')).toBe(false);
  });
});
