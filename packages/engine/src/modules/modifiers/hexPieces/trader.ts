// The Trader (T-903, docs/tasks/modifiers-RESEARCH.md Bucket A "Trader", docs/tasks/phase-9/
// PICKS.md "Trader = 3:1 port to adjacent settlements/cities; placer draws 1"): a robber-replacement
// piece with TWO effects, neither of which blocks or steals:
//
//  1. `tradeRateFor` — while it sits on a hex, it acts as a 3:1 BANK PORT for that hex's resource,
//     for ANY seat (opponents included, per the research doc) with a settlement/city adjacent to it —
//     regardless of that seat's own harbors. Wired into `bankTrade` via `index.ts`'s
//     `interceptAction` (mirrors the Captain helper's discounted-rate reroute,
//     modules/modifiers/helpers/index.ts): only takes over when the Trader's 3:1 beats the seat's own
//     harbor-derived rate (rules/harbors.ts's `tradeRate`), so a seat with their OWN 2:1 harbor for
//     that resource keeps using it — the Trader is a floor, not a forced downgrade.
//  2. `onMove` — the piece's mover draws 1 card of the resource of the hex it just moved TO (the
//     research doc's "the placing player draws 1"). No draw when the destination hex has no resource
//     (desert, or a Seafarers sea/gold base-terrain proxy) or the bank is empty for it — a documented
//     simplification mirroring the Wizard's own bank-shortage tolerance (wizard.ts).
import { TERRAIN_RESOURCE } from '@hexhaven/shared';
import type { GameState, HexId, ResourceType, Seat } from '@hexhaven/shared';
import { hexPieceProduction } from '../../../events.js';
import { geometryForState } from '../../index.js';
import { pieceByKind } from './state.js';
import type { HexPieceHookResult, HexPieceKind } from './types.js';

/** Whether `seat` owns a settlement/city on any vertex of `hex` (adjacency, not harbor-based —
 *  distinct from `rules/harbors.ts`'s edge-based harbor ownership). */
function seatAdjacentToHex(state: GameState, seat: Seat, hex: HexId): boolean {
  const geomHex = geometryForState(state).hexes[hex];
  if (!geomHex) return false;
  const player = state.players[seat];
  if (!player) return false;
  return geomHex.vertices.some((v) => player.settlements.includes(v) || player.cities.includes(v));
}

/** The Trader's 3:1 bank-port grant (T-903): `null` unless `seat` is adjacent to the Trader's hex
 *  AND `give` is exactly that hex's resource. */
function traderTradeRateFor(state: GameState, seat: Seat, give: ResourceType): 2 | 3 | null {
  const piece = pieceByKind(state, 'trader');
  if (!piece) return null;
  const tile = state.board.hexes[piece.hex];
  if (!tile) return null;
  const res = TERRAIN_RESOURCE[tile.terrain];
  if (res == null || res !== give) return null;
  return seatAdjacentToHex(state, seat, piece.hex) ? 3 : null;
}

/** The Trader's draw-on-move (T-903): 1 card of `to`'s resource for the mover, bank permitting. */
function traderOnMove(state: GameState, seat: Seat, to: HexId): HexPieceHookResult {
  const tile = state.board.hexes[to];
  const res = tile ? TERRAIN_RESOURCE[tile.terrain] : undefined;
  if (res == null) return { state, events: [] }; // desert/sea/gold proxy: nothing to draw
  if (state.bank[res] <= 0) return { state, events: [] }; // bank empty: no draw (documented simplification)

  const bank = { ...state.bank, [res]: state.bank[res] - 1 };
  const players = state.players.map((p) =>
    p.seat === seat ? { ...p, resources: { ...p.resources, [res]: p.resources[res] + 1 } } : p
  );
  return {
    state: { ...state, players, bank },
    events: [hexPieceProduction('trader', to, res, [{ seat, amount: 1 }])],
  };
}

export const traderKind: HexPieceKind = {
  id: 'trader',
  onMove: traderOnMove,
  tradeRateFor: traderTradeRateFor,
};
