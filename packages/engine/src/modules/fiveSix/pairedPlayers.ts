// 2022 HEXHAVEN Studio "Paired Players" (X12, docs/rules/fivesix-rules.md). The 2015 SBP is REPLACED:
// each turn "player 1" (the active seat) takes a full turn; then "player 2" — the third player to
// the left of player 1 — takes a PARTIAL turn: trade with the SUPPLY only (maritime/bank), build,
// and play ≤1 development card (even a VP card, so player 2 CAN win). Both markers advance left each
// round, so player 2 is always `(player1 + 3) mod n`.
//
// Model (requirement 11 — "turn-owner + restricted-action state"): the partial turn makes player 2
// the `turn.player` with `phase: 'main'`, and records `ext.fiveSix.partialTurn = { builder,
// resumeFrom }`. Making player 2 the turn owner lets ALL base owner-gated machinery work unchanged —
// build (T-105), bank trade (T-107), buy + play dev cards incl. the Knight → robber pipeline
// (T-106/T-109), and the base win check (so player 2 wins normally). The ONLY additions are the
// restriction (no player trades, no roll) and the custom turn-end (resume rotation from player 1),
// both enforced by `pairedInterceptAction`.
//
// Win timing (requirement 10): player 1's full turn resolves entirely BEFORE the partial turn — if
// player 1 hits 10 VP during their turn the base win check ends the game there, and the partial turn
// never starts. So when both would reach 10 "the same round", player 1 wins first, for free.

import type { EngineErrorCode, GameEvent, GameState, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { pairedBuildEnded, pairedBuildStarted } from '../../events.js';
import type { PartialTurn } from './common.js';
import { partialTurnOf } from './common.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/**
 * `phaseHooks.afterTurnEnd` for Paired Players: on a main-phase `endTurn`, instead of advancing to
 * the next player, start player 2's partial turn. `prev.turn.player` is player 1 (the ender);
 * player 2 = `(player1 + 3) mod n`. turn.rolled stays true (player 2 never rolls) and devPlayed
 * resets to false (player 2 gets their own single dev-card allowance).
 */
export function pairedAfterTurnEnd(
  prev: GameState,
  _advanced: GameState,
  events: readonly GameEvent[]
): { state: GameState; events: GameEvent[] } | null {
  const n = prev.config.playerCount;
  const p1 = prev.turn.player;
  const builder = ((p1 + 3) % n) as Seat;
  if (builder === p1) return null; // degenerate (n ≤ 3): no distinct paired player → normal advance

  const state: GameState = {
    ...prev,
    turn: { ...prev.turn, player: builder, devPlayed: false },
    phase: { kind: 'main' },
    trade: null,
    ext: { ...prev.ext, fiveSix: { ...prev.ext?.fiveSix, partialTurn: { builder, resumeFrom: p1 } } },
  };
  return { state, events: [...events, pairedBuildStarted(builder)] };
}

/**
 * `interceptAction` for Paired Players. Active only while a partial turn is in progress and the
 * phase is `main` (the Knight → robber sub-phases handle themselves). For the partial-turn builder:
 * blocks player-to-player trading and rolling (`WRONG_PHASE`, X12's restricted matrix), and treats
 * `endTurn`/`passSpecialBuild` as "end the partial turn". Everything else (build, bank/supply trade,
 * buy + play ≤1 dev card) falls through (`null`) to the base `main` handler.
 */
export function pairedInterceptAction(
  state: GameState,
  seat: Seat,
  action: { type: string }
): EngineResult | null {
  const pt = partialTurnOf(state);
  if (!pt) return null;
  if (state.phase.kind !== 'main') return null;
  if (seat !== pt.builder) return null;

  switch (action.type) {
    case 'offerTrade':
    case 'respondTrade':
    case 'confirmTrade':
    case 'cancelTrade':
      return fail('WRONG_PHASE', 'player trading is not allowed during a Paired-Players partial turn (X12)');
    case 'rollDice':
      return fail('WRONG_PHASE', 'the paired player does not roll (X12)');
    case 'endTurn':
    case 'passSpecialBuild':
      return endPartialTurn(state, seat, pt);
    default:
      return null; // build / buildCity / bankTrade (supply) / buyDevCard / play* → base main handler
  }
}

/** End the partial turn: resume normal rotation from player 1 (`resumeFrom + 1`) at `preRoll`, and
 *  clear the partial-turn marker. */
function endPartialTurn(state: GameState, seat: Seat, pt: PartialTurn): EngineResult {
  const n = state.config.playerCount;
  const next = ((pt.resumeFrom + 1) % n) as Seat;
  const advanced: GameState = {
    ...state,
    turn: { number: state.turn.number + 1, player: next, rolled: false, roll: null, devPlayed: false },
    phase: { kind: 'preRoll' },
    trade: null,
    ext: { ...state.ext, fiveSix: { ...state.ext?.fiveSix, partialTurn: null } },
  };
  return { ok: true, state: advanced, events: [pairedBuildEnded(seat)] };
}
