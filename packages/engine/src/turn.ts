// Turn helpers: rotation, roll/main guards, and the endTurn action (R4; ER-7).
// The type-only import from reduce.js is erased at compile time — the emitted JS has no
// import cycle (reduce.js runtime-imports this module, never the other way around).

import type { GameEvent, GameState, Seat } from '@hexhaven/shared';
import type { EngineError, EngineResult } from './reduce.js';
import { tradeCancelled, turnEnded } from './events.js';

/**
 * Pass the dice clockwise (R4 step 3): next seat, `turn.number` + 1, per-turn flags reset
 * (`rolled`/`roll`/`devPlayed`), phase → `preRoll`. Any open trade offer dies with the turn —
 * an offer never outlives its owner's turn (R8.1; ER-11 auto-cancel).
 */
export function advanceTurn(state: GameState): GameState {
  const next = ((state.turn.player + 1) % state.config.playerCount) as Seat;
  return {
    ...state,
    turn: {
      number: state.turn.number + 1,
      player: next,
      rolled: false,
      roll: null,
      devPlayed: false,
    },
    phase: { kind: 'preRoll' },
    trade: null,
  };
}

/** ER-7 guard: the mandatory roll must have happened this turn. */
export function requireRolled(state: GameState): EngineError | null {
  return state.turn.rolled
    ? null
    : { code: 'MUST_ROLL_FIRST', message: 'the dice must be rolled first this turn (ER-7)' };
}

/** Guard: only legal during the main phase (R4 step 2). */
export function requireMain(state: GameState): EngineError | null {
  return state.phase.kind === 'main'
    ? null
    : { code: 'WRONG_PHASE', message: `requires the main phase, current phase: ${state.phase.kind}` };
}

/**
 * The `endTurn` action (owned by T-102, dispatched by `reduce` for every phase):
 * - `preRoll`: the mandatory roll is still owed → `MUST_ROLL_FIRST` (ER-7);
 * - `main`: rotate via `advanceTurn`, emit `turnEnded`;
 * - anywhere else (setup, discard, moveRobber, steal, roadBuilding): `WRONG_PHASE`.
 * The dispatcher has already verified the actor is the turn owner.
 */
export function handleEndTurn(state: GameState): EngineResult {
  if (state.phase.kind === 'preRoll') {
    const owed = requireRolled(state);
    if (owed) return { ok: false, error: owed };
  }
  if (state.phase.kind !== 'main') {
    return {
      ok: false,
      error: {
        code: 'WRONG_PHASE',
        message: `cannot end the turn during phase ${state.phase.kind}`,
      },
    };
  }
  // Defensive: unreachable in practice (main implies rolled), but keeps ER-7 airtight if a
  // future phase module ever enters `main` without a roll.
  const owed = requireRolled(state);
  if (owed) return { ok: false, error: owed };

  const ending = state.turn.player;
  // ER-11: an open domestic offer never outlives its owner's turn. advanceTurn (below) already
  // clears `trade`; also emit the cancellation event, same as the build/bankTrade auto-cancels
  // in phases/main.ts, so clients/log see it.
  const hadOpenOffer = state.trade != null;
  const next = advanceTurn(state);
  const events: GameEvent[] = [turnEnded(ending, next.turn.player)];
  if (hadOpenOffer) events.push(tradeCancelled());
  return { ok: true, state: next, events };
}
