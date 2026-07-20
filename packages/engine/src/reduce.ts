// The engine dispatcher (docs/02 §4): guards → phase routing → win check → stateVersion bump.
// Pure: never mutates the input state; game-rule violations come back as coded errors, never
// throws (docs/05 §2 — `throw` is reserved for `BUG:` programmer errors).

import type { Action, EngineErrorCode, GameEvent, GameState, Phase, Seat } from '@hexhaven/shared';
import { gameWon } from './events.js';
import { activeModules } from './modules/index.js';
import type { RuleModule } from './modules/index.js';
import { roadBuildingHandler } from './phases/devCards.js';
import { mainHandler } from './phases/main.js';
import { discardHandler, moveRobberHandler, stealHandler } from './phases/robber.js';
import { rollHandler } from './phases/roll.js';
import { setupHandler } from './phases/setup.js';
import { handleEndTurn } from './turn.js';
import { checkWin, computeVp } from './vp.js';

/** Coded engine error (docs/03 §4 list). `message` is a dev diagnostic — clients render by code. */
export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export type EngineResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: EngineError };

/**
 * A phase's action handler. Input is pre-guarded by `reduce`: the game is not ended, and the
 * actor is the turn owner unless the action is `discard`/`respondTrade` (whose handlers must
 * validate seat eligibility themselves). Handlers return the post-action state WITHOUT touching
 * `stateVersion` — the dispatcher owns that bump.
 */
export type PhaseHandler = (state: GameState, seat: Seat, action: Action) => EngineResult;

export function ok(state: GameState, events: GameEvent[]): EngineResult {
  return { ok: true, state, events };
}

export function err(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/**
 * Phase routing registry — every engine task registered its handler here by replacing exactly one
 * line and importing its module (now all wired, T-102…T-109):
 *   setup → T-103 · preRoll → T-104 · discard/moveRobber/steal → T-106 ·
 *   main → T-105 (build) / T-107–T-108 (trade) / T-109 (dev cards) · roadBuilding → T-109.
 * `ended` is unreachable (GAME_OVER guard) and present only so the record is total over
 * `Phase['kind']`. Exported for those modules and for dispatcher tests; deliberately NOT
 * re-exported from the package index.
 */
export const PHASE_HANDLERS: Partial<Record<Phase['kind'], PhaseHandler>> = {
  setup: setupHandler, // T-103
  preRoll: rollHandler, // T-104 (dev-card plays added by T-109)
  discard: discardHandler, // T-106
  moveRobber: moveRobberHandler, // T-106 (also used by T-109's Knight play, returnTo:'preRoll')
  steal: stealHandler, // T-106
  roadBuilding: roadBuildingHandler, // T-109
  main: mainHandler, // T-105 (build); trade/dev actions added by T-107/T-108/T-109
  ended: (state) =>
    err(
      'GAME_OVER',
      `unreachable: ended phase is rejected before routing (winner: seat ${
        state.phase.kind === 'ended' ? state.phase.winner : '?'
      })`
    ),
  // Phase kinds the base engine doesn't own (e.g. the fiveSix module's `specialBuild`, T-602) are
  // deliberately absent here — `reduce` routes them to the active module's `phaseHandlers`.
};

/** First active module that owns a handler for `kind`, or `undefined`. */
function moduleHandlerFor(modules: RuleModule[], kind: Phase['kind']): PhaseHandler | undefined {
  for (const m of modules) {
    const handler = m.phaseHandlers?.[kind];
    if (handler) return handler;
  }
  return undefined;
}

/**
 * `reduce(state, seat, action)` — every action is dispatched as `{ seat, action }` (docs/03 §4).
 *
 * Order of business:
 *  1. `ended` rejects everything (`GAME_OVER`).
 *  2. R4.3 actor guard: only the turn owner acts, except `discard` (R6.1) and `respondTrade`
 *     (R8.1), which non-active seats may submit (`NOT_YOUR_TURN` otherwise).
 *  3. `endTurn` routes to turn.ts (phase-independent core action, ER-7); everything else routes
 *     to the phase handler registry.
 *  4. R13.2 win check after every successful action of the turn owner. It evaluates the ACTIVE
 *     player of the post-action state — for `endTurn` that is the incoming player, who wins
 *     immediately at the start of their turn if they somehow already hold `targetVp` (FAQ #16;
 *     unreachable in the base game because VP never rises between own turns).
 *  5. On success `stateVersion` becomes exactly input + 1 (I9); errors change nothing.
 */
export function reduce(state: GameState, seat: Seat, action: Action): EngineResult {
  if (state.phase.kind === 'ended') {
    return err('GAME_OVER', `the game is over (winner: seat ${state.phase.winner})`);
  }

  // Active expansion modules (empty for a base game — so every hook below is a no-op and behavior is
  // bit-identical, RK-13). The base engine never special-cases an expansion inline; it only consults
  // these generic hooks (docs/10 §3).
  const modules = activeModules(state.config);

  // R4.3 actor guard: only the turn owner acts, except `discard` (R6.1) and `respondTrade` (R8.1).
  // A module may ADD eligibility (e.g. the SBP builder, who acts while `turn.player` is someone else).
  const baseActorAllowed =
    seat === state.turn.player || action.type === 'discard' || action.type === 'respondTrade';
  if (!baseActorAllowed && !modules.some((m) => m.isActorAllowed?.(state, seat, action) ?? false)) {
    return err('NOT_YOUR_TURN', `seat ${seat} cannot act on seat ${state.turn.player}'s turn`);
  }

  // Pre-routing module interception (docs/10 §3): a module may fully handle or reject an action
  // inside a base phase it has repurposed (e.g. blocking player trades / redirecting the end action
  // during a Paired-Players partial turn). `null` from every module → normal routing.
  let intercepted: EngineResult | null = null;
  for (const m of modules) {
    const r = m.interceptAction?.(state, seat, action);
    if (r) {
      intercepted = r;
      break;
    }
  }

  let result: EngineResult;
  if (intercepted) {
    result = intercepted;
  } else if (action.type === 'endTurn') {
    result = handleEndTurn(state);
  } else {
    const handler = PHASE_HANDLERS[state.phase.kind] ?? moduleHandlerFor(modules, state.phase.kind);
    result = handler
      ? handler(state, seat, action)
      : err('WRONG_PHASE', `no handler for phase ${state.phase.kind}`);
  }

  if (!result.ok) return result;

  // `phaseHooks.afterTurnEnd`: on a real main-phase `endTurn` (not a module-intercepted one), a
  // module may replace the plain turn advance (e.g. inject an SBP / paired partial turn).
  if (!intercepted && action.type === 'endTurn' && state.phase.kind === 'main') {
    for (const m of modules) {
      const hooked = m.phaseHooks?.afterTurnEnd?.(state, result.state, result.events);
      if (hooked) {
        result = { ok: true, state: hooked.state, events: hooked.events };
        break;
      }
    }
  }

  let nextState = result.state;
  let events = result.events;

  // `phaseHooks.afterAction`: a module may post-process any successful transition before the win
  // check (docs/10 §3) — e.g. Seafarers opens the gold sub-phase after a producing roll and grants
  // island VP chits after a settlement. No-op for a base game (no modules), so behavior stays
  // bit-identical (RK-13). Runs before the win check so hook-added VP (island chits) can win.
  for (const m of modules) {
    const hooked = m.phaseHooks?.afterAction?.(state, nextState, action, events, seat);
    if (hooked) {
      nextState = hooked.state;
      events = hooked.events;
    }
  }

  // R13.2 win check. Base: the pre-action turn owner's action is checked against the POST-action
  // turn owner (so `endTurn` evaluates the incoming player — FAQ #16 start-of-turn win). Modules may
  // override which seat is eligible (SBP suppresses; Paired Players lets player 2 win) — see docs/10.
  let winSeat: Seat | null = seat === state.turn.player ? nextState.turn.player : null;
  for (const m of modules) {
    if (m.winCheckSeat) winSeat = m.winCheckSeat(state, nextState, seat, winSeat);
  }
  if (winSeat !== null) {
    const won = checkWin(nextState, winSeat);
    if (won.phase.kind === 'ended' && nextState.phase.kind !== 'ended') {
      events = [...events, gameWon(won.phase.winner, computeVp(nextState, won.phase.winner))];
      nextState = won;
    }
  }

  return {
    ok: true,
    state: { ...nextState, stateVersion: state.stateVersion + 1 },
    events,
  };
}
