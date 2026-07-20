// 2015 Special Building Phase (X12, docs/rules/fivesix-rules.md). After each player's turn ends,
// EVERY other player — in clockwise order starting from the next player — takes a build-only
// "special build turn": build roads/settlements/cities and/or buy development cards using ONLY
// resources already in hand. No trading (domestic OR maritime), no playing development cards, no
// rolling. Nobody wins during the SBP; a ≥10-VP builder wins only when play reaches their own next
// turn (win stays own-turn-gated, R13.2/X1.1) — see the module's `winCheckSeat`.
//
// Model: a dedicated `{ kind: 'specialBuild'; builder; queue }` phase (turn.player stays the seat
// whose turn just ended). Builds/buys reuse the base T-105/T-109 handlers verbatim — they never
// read `state.phase`, so they work unchanged from here (no duplicated build logic).

import type { EngineErrorCode, GameEvent, GameState, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import type { ModulePhaseHandler } from '../types.js';
import { specialBuildPassed, specialBuildStarted } from '../../events.js';
import { advanceTurn } from '../../turn.js';
import { buildCity, buildRoad, buildSettlement } from '../../phases/main.js';
import { buyDevCard } from '../../phases/devCards.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/**
 * `phaseHooks.afterTurnEnd` for the 2015 SBP: on a main-phase `endTurn`, instead of advancing to
 * the next player's `preRoll`, enter the SBP for the OTHER seats in clockwise order from the next
 * player. `prev` is the pre-endTurn state (its `turn.player` is the seat that just ended); `events`
 * are the base `endTurn` events (turnEnded, plus any trade auto-cancel) which we forward.
 */
export function specialBuildAfterTurnEnd(
  prev: GameState,
  _advanced: GameState,
  events: readonly GameEvent[]
): { state: GameState; events: GameEvent[] } | null {
  const n = prev.config.playerCount;
  const ender = prev.turn.player;
  const order: Seat[] = [];
  for (let i = 1; i < n; i++) order.push(((ender + i) % n) as Seat);
  const [builder, ...queue] = order;
  if (builder === undefined) return null; // <2 players: no other seat to build (never at 5–6)

  // turn.player stays `ender`; the SBP is a between-turns opportunity for everyone else.
  const state: GameState = { ...prev, phase: { kind: 'specialBuild', builder, queue }, trade: null };
  return { state, events: [...events, specialBuildStarted(builder, queue)] };
}

/** Advance the SBP: hand off to the next queued builder, or (queue empty) resume normal play at the
 *  next player's `preRoll` via `advanceTurn` (turn.player is still the ender, so this rotates to
 *  ender+1 exactly as a normal turn end would have). */
function sbpPass(state: GameState, seat: Seat): EngineResult {
  if (state.phase.kind !== 'specialBuild') return fail('WRONG_PHASE', 'not in the Special Building Phase');
  const [next, ...rest] = state.phase.queue;
  if (next !== undefined) {
    return {
      ok: true,
      state: { ...state, phase: { kind: 'specialBuild', builder: next, queue: rest } },
      events: [specialBuildPassed(seat)],
    };
  }
  return { ok: true, state: advanceTurn(state), events: [specialBuildPassed(seat)] };
}

/**
 * The `specialBuild` phase handler (registered on the module). Only the current `builder` may act;
 * they may build/buy or pass. Every other action — trading (domestic/maritime), playing dev cards,
 * rolling — is rejected `WRONG_PHASE` (X12's exact blocked list). `endTurn` never reaches here (it
 * routes to turn.ts, which also returns `WRONG_PHASE` during `specialBuild`).
 */
export const specialBuildHandler: ModulePhaseHandler = (state, seat, action): EngineResult => {
  if (state.phase.kind !== 'specialBuild') return fail('WRONG_PHASE', 'not in the Special Building Phase');
  if (seat !== state.phase.builder) {
    return fail('NOT_YOUR_TURN', `seat ${seat} is not the current special builder`);
  }
  switch (action.type) {
    case 'buildRoad':
      return buildRoad(state, seat, action.edge);
    case 'buildSettlement':
      return buildSettlement(state, seat, action.vertex);
    case 'buildCity':
      return buildCity(state, seat, action.vertex);
    case 'buyDevCard':
      return buyDevCard(state, seat);
    case 'passSpecialBuild':
      return sbpPass(state, seat);
    default:
      return fail('WRONG_PHASE', `${action.type} is not allowed during the Special Building Phase (X12)`);
  }
};
