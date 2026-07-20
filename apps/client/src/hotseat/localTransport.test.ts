// T-305 requirement 6 tests.
//
// 1. "transport parity": a scripted 40-action game driven through `localTransport` must land the
//    store in exactly the same state a hand-rolled "server" (reduce + redact/redactEvent, fed
//    through `applyServerMessage` exactly like the real ws path does) would produce.
// 2. "bot-until terminates": `runBotUntilSeat` (src/hotseat/bot.ts) always stops — either because
//    the target seat is back in control, or because a guard condition tripped — never loops
//    unboundedly.
// 3. "repro bundle replays to an identical stateVersion": `exportBundle()` -> `replayBundle()`
//    reproduces the same `stateVersion` a fresh transport reaches from the same actions.
import { describe, expect, it } from 'vitest';
import { createGame, legalSetupRoads, legalSetupSettlements, reduce, redact, redactEvent, simulate } from '@hexhaven/engine';
import { stateWith } from '@hexhaven/engine/testkit';
import type { Action, GameState, Seat, ServerMessage } from '@hexhaven/shared';
import { createRootStore } from '../store';
import { runBotUntilSeat } from './bot';
import { computeActiveSeat, createLocalTransport } from './localTransport';

const BASE_CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

describe('localTransport: transport parity (requirement 6)', () => {
  it('produces the same store states as the equivalent hand-rolled server messages over 40 actions', () => {
    const seed = 'hotseat-parity-1';
    const prefix = simulate(seed).log.slice(0, 40);
    expect(prefix.length).toBe(40);

    // Path A: drive the actions through localTransport, exactly as HotseatPage does.
    const storeA = createRootStore();
    const transport = createLocalTransport({ seed, tokenMethod: 'spiral' });
    transport.onUpdate((msg) => storeA.getState().applyServerMessage(msg));
    transport.start();
    for (const { action } of prefix) transport.send(action);

    // Path B: a hand-rolled "server" — reduce + redact/redactEvent fed through the exact same
    // `game.started`/`game.events` envelope shapes the real ws client would deliver.
    const storeB = createRootStore();
    let state: GameState = createGame({ ...BASE_CONFIG, seed });
    let viewedSeat: Seat = computeActiveSeat(state);
    storeB.getState().applyServerMessage({ v: 1, type: 'game.started', payload: redact(state, viewedSeat) });

    for (const { seat, action } of prefix) {
      const result = reduce(state, seat, action);
      if (!result.ok) throw new Error(`fixture setup: unexpected reduce failure at seat ${seat}: ${result.error.code}`);
      state = result.state;
      viewedSeat = computeActiveSeat(state);
      const msg: ServerMessage = {
        v: 1,
        type: 'game.events',
        payload: {
          events: result.events.map((e) => redactEvent(e, viewedSeat)),
          stateVersion: state.stateVersion,
          view: redact(state, viewedSeat),
        },
      };
      storeB.getState().applyServerMessage(msg);
    }

    expect(storeA.getState().game.view).toEqual(storeB.getState().game.view);
    expect(storeA.getState().game.events).toEqual(storeB.getState().game.events);
    expect(transport.getGameState().stateVersion).toBe(state.stateVersion);
  });
});

describe('bot.ts: runBotUntilSeat terminates (requirement 6)', () => {
  it('stops once control returns to the target seat, without hitting the safety cap', () => {
    const transport = createLocalTransport({ seed: 'hotseat-bot-until-1', tokenMethod: 'spiral' });

    // Drive seat 0's own opening settlement + road manually so the loop below starts from a state
    // where seats 1-3 (and then 3-1 in the snake draft's reverse leg) are the ones left to act.
    const afterSettlement = firstLegalSetupAction(transport.getGameState());
    transport.send(afterSettlement);
    const afterRoad = firstLegalSetupAction(transport.getGameState());
    transport.send(afterRoad);
    expect(computeActiveSeat(transport.getGameState())).not.toBe(0);

    const result = runBotUntilSeat(transport, 0 as Seat, 200);

    expect(result.reason).toBe('reachedSeat');
    expect(result.steps).toBeGreaterThan(0);
    expect(result.steps).toBeLessThan(200);
    expect(computeActiveSeat(transport.getGameState())).toBe(0);
  });
});

describe('localTransport: board setup wiring (T-606)', () => {
  it('builds the fixed Beginner board when board:"beginner" is chosen (base 4-player)', () => {
    const transport = createLocalTransport({ seed: 'beg-1', board: 'beginner' });
    expect(transport.getBoard()).toBe('beginner');
    const board = transport.getGameState().config.board;
    expect(board).toBe('beginner');
    // Deterministic: a different seed yields the identical fixed board.
    const other = createLocalTransport({ seed: 'beg-2', board: 'beginner' });
    expect(other.getGameState().board).toEqual(transport.getGameState().board);
  });

  it('forces Random at 5–6 players (Beginner is base-19 only)', () => {
    const transport = createLocalTransport({ seed: 'beg-56', board: 'beginner', playerCount: 5 });
    expect(transport.getGameState().config.board).toBe('random');
  });

  it('carries the board choice through export/replay round-trips', () => {
    const transport = createLocalTransport({ seed: 'beg-rt', board: 'beginner' });
    const bundle = transport.exportBundle();
    expect(bundle.board).toBe('beginner');
    const fresh = createLocalTransport({ seed: 'x' });
    fresh.replayBundle(bundle);
    expect(fresh.getBoard()).toBe('beginner');
  });
});

describe('computeActiveSeat: caravanVote (§TB4.2, T-1004, B-caravan-vote-bots)', () => {
  it('returns the first still-pending bidder, never turn.player once they have already bid', () => {
    // turn.player (0) already bid (no longer in `pending`) — the old fallback (`return
    // state.turn.player`) would strand the vote here forever since seat 0 can never bid again.
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: { kind: 'caravanVote', builder: 0 as Seat, pending: [1, 2, 3] as Seat[], bids: { 0: 0 }, winner: null },
    });
    expect(computeActiveSeat(state)).toBe(1);
  });

  it('returns the resolved winner once every seat has bid (pending empty), even when winner ≠ turn.player', () => {
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: {
        kind: 'caravanVote',
        builder: 0 as Seat,
        pending: [] as Seat[],
        bids: { 0: 0, 1: 2, 2: 0, 3: 0 },
        winner: 1 as Seat,
      },
    });
    expect(computeActiveSeat(state)).toBe(1);
  });
});

describe('localTransport: repro bundle replay (requirement 6)', () => {
  it('replays to an identical stateVersion', () => {
    const transport = createLocalTransport({ seed: 'hotseat-repro-1', tokenMethod: 'spiral' });
    // Play a modest prefix of a real bot-driven game so the bundle covers a handful of phases.
    const seat0Settlement = firstLegalSetupAction(transport.getGameState());
    transport.send(seat0Settlement);
    const seat0Road = firstLegalSetupAction(transport.getGameState());
    transport.send(seat0Road);
    runBotUntilSeat(transport, 0 as Seat, 200);

    const bundle = transport.exportBundle();
    expect(bundle.actions.length).toBeGreaterThan(0);

    const fresh = createLocalTransport({ seed: 'irrelevant-will-be-overwritten' });
    const result = fresh.replayBundle(bundle);

    expect(result).toEqual({ ok: true, stateVersion: transport.getGameState().stateVersion });
    expect(fresh.getGameState().stateVersion).toBe(transport.getGameState().stateVersion);
  });
});

/** Setup-phase helper: the first legal settlement (or road, whichever `phase.expect` calls for)
 * for the current turn owner — just enough to advance the snake draft deterministically without
 * pulling in the client's own `bot.ts` (kept independent so this fixture doesn't accidentally rely
 * on the very module a later test also exercises). Uses the same public `legal.ts` enumerators
 * `@hexhaven/engine` exports, not a brute-force scan. */
function firstLegalSetupAction(state: GameState): Action {
  if (state.phase.kind !== 'setup') throw new Error('BUG: fixture helper called outside setup');
  if (state.phase.expect === 'settlement') {
    const vertex = legalSetupSettlements(state)[0];
    if (vertex === undefined) throw new Error('BUG: no legal setup settlement');
    return { type: 'placeSetupSettlement', vertex };
  }
  const edge = legalSetupRoads(state)[0];
  if (edge === undefined) throw new Error('BUG: no legal setup road');
  return { type: 'placeSetupRoad', edge };
}
