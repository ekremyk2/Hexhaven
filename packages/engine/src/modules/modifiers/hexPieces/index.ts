// Multi-piece hex framework (T-902, docs/07 D-034, docs/tasks/modifiers-RESEARCH.md "Design
// pattern: multiple coexisting hex-pieces"). Generalizes the single `state.robber` into a
// collection of typed movable hex pieces (`state.ext.hexPieces`) that COEXIST alongside it — the
// base robber, `rules/robber.ts`/`phases/robber.ts`, and the Seafarers pirate are all left
// completely untouched (additive layer, RK-13-safe). This module contributes exactly two things:
//
//  1. `moveHexPiece` (docs/03 §4 Action union): move-any. While the `moveRobber` sub-phase is open
//     (the base engine enters it exactly as before, on a rolled 7 or a played Knight), the mover may
//     submit `moveHexPiece{piece,hex}` INSTEAD of the base `moveRobber{hex}` action. Whichever one
//     they submit first consumes the ENTIRE sub-phase: this handler returns the phase to
//     `main`/`preRoll` the same way `moveRobberHandler` does (phases/robber.ts), so a second attempt
//     (either action) lands `WRONG_PHASE` — "exactly one piece move per trigger" falls out of the
//     phase machine itself, no separate counter needed. The base `moveRobber` action is NEVER
//     intercepted by this module (`interceptAction` only ever matches `action.type ===
//     'moveHexPiece'`), so with the modifier off (or even on, if the mover picks the robber) the
//     base robber flow is bit-for-bit unchanged.
//  2. Lazy placement + the production hook. `ext.hexPieces` is created the first time this module's
//     `afterAction` ever sees a state (the same `initState`-hook substitute `helpers`/`eventCards`
//     use) and, on every resolved (non-7) `rollDice`, each enabled kind's `onProduction` hook runs
//     AFTER the base production has already been applied.
//
// Cities & Knights robber-lock (C10.1/C10.2): while locked, no piece may move either (docs/07
// D-034) — checked directly against `citiesKnightsExt(state).robberLocked` (C&K's own
// `interceptAction` only ever matches `moveRobber`/`chaseRobber`/the progress-card actions, never
// this module's brand-new `moveHexPiece`, so it would fall through to normal routing otherwise).
// This check is DEFENSIVE in the same sense `modules/citiesKnights/index.ts`'s own comment makes for
// the base robber: in normal play a rolled 7 never reaches `moveRobber` at all while locked (C&K's
// `afterAction` redirects it straight back to `main`), so `moveHexPiece` naturally can't be
// submitted during that window either — this guard only matters against a misbehaving/adversarial
// client that submits it anyway.
//
// FUTURE (explicitly NOT done here, per the task brief): the Seafarers pirate (`modules/seafarers/
// pirate.ts`, `state.ext.seafarers.pirate`) is architecturally a second robber-like piece that
// already coexists with the land robber — a natural fit for eventually becoming a `HexPieceKind`
// instance of this same framework instead of its own bespoke `movePirate` action/state slot. That
// unification is a real future refactor (it would touch `phases/robber.ts`'s moveRobber sub-phase
// wiring, the Seafarers module, and the client's pirate UI), not attempted by this task — this
// framework was built standalone precisely so the Seafarers pirate keeps working completely
// unmodified today (RK-13/composes-with-Seafarers, verified by this module's own tests).
//
// T-903 additions (Trader/Robin Hood/Banker/Poaching, docs/tasks/phase-9/PICKS.md) needed exactly
// two small, backward-compatible widenings of this framework rather than new mechanisms:
//  - `moveHexPieceAction` now stamps the mover's seat as `HexPieceInstance.owner` on every move
//    (generic, kind-agnostic — only the Banker's `onProduction` reads it; `state.ts`'s
//    `withPieceHex` treats the new `owner` parameter as optional so T-902's own tests, which never
//    pass one, are unaffected).
//  - `interceptAction` also recognizes `bankTrade` (bankTrade.ts), rerouting to a piece's
//    `tradeRateFor` grant (the Trader) when it beats the seat's own harbor rate — `null` otherwise,
//    falling through to the untouched base `bankTrade` handler.

import type { Action, GameEvent, GameState, HexPieceKindId, Seat } from '@hexhaven/shared';
import type { EngineError, EngineResult } from '../../../reduce.js';
import { err } from '../../../reduce.js';
import { hexPieceMoved } from '../../../events.js';
import { citiesKnightsExt } from '../../citiesKnights/state.js';
import { geometryForState } from '../../index.js';
import type { RuleModule } from '../../types.js';
import { hexPieceBankTrade } from './bankTrade.js';
import { HEX_PIECE_KIND_IDS, HEX_PIECE_KINDS } from './registry.js';
import { ensureHexPiecesExt, pieceByKind, withPieceHex } from './state.js';

export type { HexPieceHookResult, HexPieceKind } from './types.js';
export { HEX_PIECE_KIND_IDS, HEX_PIECE_KINDS } from './registry.js';
export { ensureHexPiecesExt, hexPiecesExt, pieceByKind, withPieceHex } from './state.js';

/** Mirrors `phases/robber.ts`'s private `returnPhase` — where the `moveRobber` sub-phase lands once
 *  a move (of ANY piece, robber included) fully resolves. */
function returnPhase(returnTo: 'preRoll' | 'main') {
  return returnTo === 'preRoll' ? ({ kind: 'preRoll' } as const) : ({ kind: 'main' } as const);
}

/**
 * `moveHexPiece` (docs/03 §4): `null` for anything else, falling through to normal routing — the
 * base `moveRobber` action is never touched by this function. Defensively re-runs
 * `ensureHexPiecesExt` on entry (idempotent, same as `afterAction`'s own call) rather than assuming
 * placement already happened: `moveRobber` can legally be the very first action `interceptAction`
 * ever sees this modifier active for (e.g. a hand-built test state, or a Knight played before any
 * other action this game) — `afterAction` only fires AFTER the base handler already ran, so this
 * intercept can't rely on it having placed anything yet.
 */
function moveHexPieceAction(
  state: GameState,
  seat: Seat,
  action: Action,
  enabled: readonly HexPieceKindId[]
): EngineResult | null {
  if (action.type !== 'moveHexPiece') return null;
  if (state.phase.kind !== 'moveRobber') {
    return err('WRONG_PHASE', 'moveHexPiece is only legal while moving the robber (docs/07 D-034)');
  }
  const phase = state.phase;
  // C10.1/C10.2 (docs/07 D-034): see this file's header note on why this is defensive.
  if (citiesKnightsExt(state)?.robberLocked) {
    return err(
      'ROBBER_LOCKED',
      'the robber (and every hex piece) is locked until the first barbarian attack (C10.1)'
    );
  }
  const ensured = ensureHexPiecesExt(state, enabled, HEX_PIECE_KINDS);
  const piece = pieceByKind(ensured, action.piece);
  if (!piece) {
    return err('HEX_PIECE_NOT_FOUND', `hex piece '${action.piece}' is not active in this game`);
  }
  if (!geometryForState(ensured).hexes[action.hex]) {
    return err('BAD_LOCATION', `hex ${action.hex} is off the board`);
  }
  if (action.hex === piece.hex) {
    return err('HEX_PIECE_SAME_HEX', `hex piece '${action.piece}' must move to a different hex`);
  }

  // T-903: stamp the mover as this piece's owner (generic, kind-agnostic — see `HexPieceInstance.
  // owner`'s doc comment, packages/shared/src/types.ts); only the Banker's `onProduction` reads it.
  const moved = withPieceHex(ensured, action.piece, action.hex, seat);
  const events: GameEvent[] = [hexPieceMoved(seat, action.piece, action.hex)];
  const kind = HEX_PIECE_KINDS[action.piece];
  const onMoveResult = kind.onMove ? kind.onMove(moved, seat, action.hex) : { state: moved, events: [] as GameEvent[] };

  return {
    ok: true,
    state: { ...onMoveResult.state, phase: returnPhase(phase.returnTo) },
    events: [...events, ...onMoveResult.events],
  };
}

/**
 * (1) Lazily creates `ext.hexPieces` on the very first action this module ever sees (placing every
 * enabled kind); (2) on a resolved (non-7) `rollDice`, runs every enabled kind's `onProduction` hook
 * in `HEX_PIECE_KIND_IDS` order, AFTER the base production has already been applied — the roll only
 * ever lands the phase in `main` when it wasn't a 7 (a 7 goes to `discard`/`moveRobber` instead, and
 * the Wizard/future pieces have nothing to do on a 7 either way).
 */
function afterAction(
  _prev: GameState,
  next: GameState,
  action: Action,
  events: readonly GameEvent[],
  enabled: readonly HexPieceKindId[]
): { state: GameState; events: GameEvent[] } | null {
  let state = ensureHexPiecesExt(next, enabled, HEX_PIECE_KINDS);
  let changed = state !== next;
  let outEvents: GameEvent[] = [...events];

  if (action.type === 'rollDice' && state.turn.roll && state.phase.kind === 'main') {
    const total = state.turn.roll[0] + state.turn.roll[1];
    for (const kindId of enabled) {
      const result = HEX_PIECE_KINDS[kindId].onProduction?.(state, total);
      if (result) {
        state = result.state;
        outEvents = [...outEvents, ...result.events];
        changed = true;
      }
    }
  }

  return changed ? { state, events: outEvents } : null;
}

/** Builds the `hexPieces` modifier's `RuleModule` from its config (`{ pieces: HexPieceKindId[] }`,
 *  registry.ts). Re-orders the enabled kinds to `HEX_PIECE_KIND_IDS`'s fixed order (mirrors
 *  `MODIFIER_IDS`'s own determinism rationale, registry.ts) so placement/production iteration order
 *  never depends on `config.modifiers.hexPieces.pieces`'s own (client-supplied) array order. */
export function hexPiecesModule(config: { pieces: readonly HexPieceKindId[] }): RuleModule {
  const enabled = HEX_PIECE_KIND_IDS.filter((id) => config.pieces.includes(id));
  return {
    id: 'hexPieces',
    // T-903: `bankTrade` is checked first (the Trader's `tradeRateFor` hook, bankTrade.ts) — falls
    // through to `moveHexPieceAction` for everything else (which itself only ever matches
    // `moveHexPiece`, `null` otherwise, and does its own defensive `ensureHexPiecesExt`). Neither
    // branch does anything when `enabled` is empty (modifier off), so base routing is untouched
    // (RK-13). Only `bankTrade` needs its OWN ensure here (so a bank trade could in principle be the
    // very first action this module ever sees) — every other action type is left to
    // `moveHexPieceAction`'s own guard, avoiding a wasted `ensureHexPiecesExt` call on every action.
    interceptAction: (state, seat, action) =>
      action.type === 'bankTrade'
        ? hexPieceBankTrade(ensureHexPiecesExt(state, enabled, HEX_PIECE_KINDS), seat, action.give, action.receive, enabled)
        : moveHexPieceAction(state, seat, action, enabled),
    phaseHooks: {
      afterAction: (prev, next, action, events) => afterAction(prev, next, action, events, enabled),
    },
  };
}

/**
 * Config-shape validation (mirrors `validateCustomConstantsConfig`'s role for `customConstants`,
 * registered in `modifiers/registry.ts`'s `MODIFIERS.hexPieces.validateConfig`): `pieces` must be
 * non-empty (an enabled-but-empty selection is meaningless — docs/tasks/phase-9/PICKS.md
 * "standalone-selectable", not "selectable and empty") and free of duplicates (each kind has
 * exactly one instance, so naming it twice can only be a client bug). Every named id is already
 * known-valid by construction — the wire schema (`HexPieceKindIdSchema`) only accepts declared
 * `HexPieceKindId` literals, so there's nothing further to range-check here.
 */
export function validateHexPiecesConfig(config: { pieces: readonly HexPieceKindId[] }): EngineError | null {
  if (config.pieces.length === 0) {
    return { code: 'MODIFIER_INVALID_CONFIG', message: 'hexPieces requires at least one enabled piece kind' };
  }
  if (new Set(config.pieces).size !== config.pieces.length) {
    return { code: 'MODIFIER_INVALID_CONFIG', message: 'hexPieces.pieces must not repeat a kind' };
  }
  return null;
}
