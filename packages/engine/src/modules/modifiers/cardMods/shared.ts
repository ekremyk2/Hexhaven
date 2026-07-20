// Shared helpers for the cardMods effect functions (newCards.ts/comboCards.ts) — the small pieces
// of base-mechanic reuse every card needs: the R9.4 "not bought this turn" check (mirrors
// `phases/devCards.ts`'s private `devCardIsPlayable`, reusing the SAME `allowDevCardSameTurnPlay`
// constant seam `playDevSameTurn` sets, so a combo composes with that modifier for free), removing
// specific dev cards from a hand, and the Knight-style "move the robber, then resolve 0/1/many
// steal candidates" branch (mirrors `modules/modifiers/friendlyRobber.ts`'s `moveRobberFiltered`
// and `phases/devCards.ts`'s `playKnight` `returnTo` derivation) reused by the two combos that play
// a Knight alongside another card (rideByNight, nightOfPlenty).

import type { DevCardType, EngineErrorCode, GameEvent, GameState, HexId, PlayerState, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../../reduce.js';
import { robberMoved } from '../../../events.js';
import { geometryForState, resolveConstants } from '../../index.js';
import { resolveSteal, stealCandidatesForHex } from '../../../phases/robber.js';

export function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/** Deterministic resource enumeration order (docs/01 preamble) — used by bumperCrop's fixed-order
 *  "1 of every type" gain. */
export const RESOURCE_ORDER = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;

/**
 * R9.4's "not bought this same turn" gate for a single dev card, waived by the `playDevSameTurn`
 * modifier — same `ModuleConstants.allowDevCardSameTurnPlay` seam `phases/devCards.ts`'s (private)
 * `devCardIsPlayable` reads. Reimplemented here (rather than importing that private function)
 * against the SAME public constant so this composes with `playDevSameTurn` identically.
 */
export function isPlayable(state: GameState, boughtOnTurn: number): boolean {
  if (resolveConstants(state.config).allowDevCardSameTurnPlay) return true;
  return boughtOnTurn !== state.turn.number;
}

/** Indices in `seat`'s hand holding a playable (held + not-bought-this-turn) card of `type`. */
export function playableIndices(state: GameState, seat: Seat, type: DevCardType): number[] {
  const player = state.players[seat];
  if (!player) return [];
  const out: number[] = [];
  player.devCards.forEach((c, i) => {
    if (c.type === type && isPlayable(state, c.boughtOnTurn)) out.push(i);
  });
  return out;
}

/**
 * Removes ONE playable card per listed `type` (in order) from `seat`'s hand, returning a fresh
 * `players` array. Caller must have already verified each type has a playable copy (e.g. via
 * `commonPlayBlockReason`/`playableIndices`) — an unreachable `BUG:` throw otherwise, mirroring
 * `phases/devCards.ts`'s `beginPlay` precedent for the same "guards already proved this" shape.
 */
export function removeDevCards(state: GameState, seat: Seat, types: readonly DevCardType[]): PlayerState[] {
  const player = state.players[seat];
  if (!player) throw new Error(`BUG: removeDevCards: seat ${seat} does not exist`);
  let devCards = player.devCards.slice();
  for (const type of types) {
    const idx = devCards.findIndex((c) => c.type === type && isPlayable(state, c.boughtOnTurn));
    if (idx === -1) {
      throw new Error(`BUG: removeDevCards could not find a playable ${type} for seat ${seat} after guards passed`);
    }
    devCards = [...devCards.slice(0, idx), ...devCards.slice(idx + 1)];
  }
  return state.players.map((p) => (p.seat === seat ? { ...p, devCards } : p));
}

/**
 * Knight's own R9.5 robber half, reusable by any combo that plays a Knight alongside another card
 * (rideByNight, nightOfPlenty): move the robber to `hex`, then auto-resolve the steal for 0 or 1
 * candidates or open the base `steal` sub-phase for multiple — the exact branch shape
 * `friendlyRobber.ts`'s `moveRobberFiltered` documents, built on the same exported
 * `stealCandidatesForHex`/`resolveSteal` (phases/robber.ts). `returnTo` is derived from
 * `turn.rolled` exactly like `playKnight` (phases/devCards.ts) derives its own.
 */
export function knightRobberMove(state: GameState, seat: Seat, hex: HexId): EngineResult {
  const geometry = geometryForState(state);
  if (!geometry.hexes[hex]) return fail('BAD_LOCATION', `hex ${hex} is off the board`);
  if (hex === state.board.robber) return fail('ROBBER_SAME_HEX', 'the robber must move to a different hex (ER-8)');

  const moved: GameState = { ...state, board: { ...state.board, robber: hex } };
  const events: GameEvent[] = [robberMoved(seat, hex)];
  const returnTo: 'preRoll' | 'main' = state.turn.rolled ? 'main' : 'preRoll';
  const candidates = stealCandidatesForHex(moved, hex);

  if (candidates.length === 0) {
    return { ok: true, state: { ...moved, phase: { kind: returnTo } }, events };
  }
  if (candidates.length === 1) {
    return resolveSteal(moved, seat, candidates[0]!, returnTo, events);
  }
  return { ok: true, state: { ...moved, phase: { kind: 'steal', candidates, returnTo } }, events };
}
