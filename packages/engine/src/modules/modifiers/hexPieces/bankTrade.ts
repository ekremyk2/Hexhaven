// Wires the Trader's `tradeRateFor` hook (T-903, types.ts) into `bankTrade` WITHOUT touching
// `phases/main.ts` — mirrors the Captain helper ability's exact same pattern one modifier over
// (`modules/modifiers/helpers/actions.ts`'s `captainBankTrade`, reused via `index.ts`'s
// `interceptAction`): duplicate the base `bankTrade` shape with a caller-supplied rate, and only
// take over when that rate BEATS what the seat's own harbors already grant (`rules/harbors.ts`'s
// `tradeRate`) — a seat with a better/equal harbor rate keeps using the untouched base handler, so
// this is a floor the Trader adds, never a forced downgrade. `null` (falling through to normal
// routing) whenever no active kind's `tradeRateFor` beats the harbor rate, INCLUDING when the
// `hexPieces` modifier is off (`enabled` empty) — base/RK-13 bit-identical.
import type { EngineResult } from '../../../reduce.js';
import { err } from '../../../reduce.js';
import { bankTraded, tradeCancelled } from '../../../events.js';
import { tradeRate } from '../../../rules/harbors.js';
import type { GameEvent, GameState, HexPieceKindId, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import { HEX_PIECE_KINDS } from './registry.js';

/** The best (lowest) rate any enabled kind's `tradeRateFor` confers to `seat` for `give`, or `null`
 *  if none applies. */
function bestPieceRate(
  state: GameState,
  seat: Seat,
  give: ResourceType,
  enabled: readonly HexPieceKindId[]
): 2 | 3 | null {
  let best: 2 | 3 | null = null;
  for (const kind of enabled) {
    const rate = HEX_PIECE_KINDS[kind].tradeRateFor?.(state, seat, give);
    if (rate != null && (best == null || rate < best)) best = rate;
  }
  return best;
}

/** Duplicates `phases/main.ts`'s `bankTrade` shape/validation with a caller-supplied `rate` instead
 *  of the harbor-derived one (mirrors `helpers/actions.ts`'s `captainBankTrade`). */
function tradeAtRate(state: GameState, seat: Seat, give: ResourceType, receive: ResourceType, rate: 2 | 3): EngineResult {
  const player = state.players[seat]!;
  if (player.resources[give] < rate) {
    return err(
      'CANT_AFFORD',
      `trading ${give} needs ${rate} cards at the Trader's rate, seat ${seat} holds ${player.resources[give]}`
    );
  }
  if (state.bank[receive] < 1) return err('BANK_EMPTY', `the bank has no ${receive} left`);

  const bank = { ...state.bank };
  bank[give] += rate;
  bank[receive] -= 1;
  const players = state.players.map((p) => {
    if (p.seat !== seat) return p;
    const resources = { ...p.resources };
    resources[give] -= rate;
    resources[receive] += 1;
    return { ...p, resources };
  });

  const gave: ResourceBundle = { [give]: rate };
  const got: ResourceBundle = { [receive]: 1 };
  let next: GameState = { ...state, players, bank };
  const events: GameEvent[] = [bankTraded(seat, gave, got, rate)];
  if (next.trade != null) {
    next = { ...next, trade: null };
    events.push(tradeCancelled());
  }
  return { ok: true, state: next, events };
}

/**
 * `index.ts`'s `interceptAction` reroutes a `bankTrade` here first; `null` falls through to the
 * base handler (rules/harbors.ts's harbor-derived rate applies unchanged).
 */
export function hexPieceBankTrade(
  state: GameState,
  seat: Seat,
  give: ResourceType,
  receive: ResourceType,
  enabled: readonly HexPieceKindId[]
): EngineResult | null {
  if (give === receive) return null; // let the base handler reject with its own BAD_TRADE message
  const pieceRate = bestPieceRate(state, seat, give, enabled);
  if (pieceRate == null) return null;
  const harborRate = tradeRate(state, seat, give);
  if (pieceRate >= harborRate) return null; // the seat's own harbor is at least as good — base owns it
  return tradeAtRate(state, seat, give, receive, pieceRate);
}
