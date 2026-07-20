// The Wizard (T-902's ONE reference hex piece, docs/tasks/modifiers-RESEARCH.md Bucket A,
// docs/tasks/phase-9/PICKS.md "Wizard = adjacent settlements +1 resource on that hex's roll"): a
// purely BENEFICIAL production piece — no block, no steal, no on-move effect at all (`onMove` is
// deliberately absent). Placed on any hex (fish hexes included, per the research); while it sits
// there, every settlement/city adjacent to that hex — ANY owner, opponents included — gets +1 of
// that hex's resource each time the hex's own number is rolled, ON TOP of whatever base production
// (rules/production.ts) that hex already pays out that same roll (R5 is never blocked or replaced —
// the Wizard doesn't occupy the hex the way the robber does).
//
// This is the framework's proof of the `onProduction` hook (types.ts) end-to-end; T-903's Trader/
// Robin Hood/Banker/Poaching implement the other hook points (`onMove`/`tradeRateFor`) the same way.

import { TERRAIN_RESOURCE } from '@hexhaven/shared';
import type { GameState, Seat } from '@hexhaven/shared';
import { hexPieceProduction } from '../../../events.js';
import { geometryForState } from '../../index.js';
import { pieceByKind } from './state.js';
import type { HexPieceHookResult, HexPieceKind } from './types.js';

/**
 * The Wizard's production top-up for a resolved roll. Flat +1 per adjacent settlement/city (not
 * scaled by city count — PICKS.md's "adjacent settlements +1 resource", a flat blessing rather than
 * a doubled one) to EVERY owner with a building on one of the Wizard hex's vertices. Respects R5.3's
 * bank-shortage spirit (in the same "insufficient supply protects nobody's fairness" sense
 * `computeProduction` enforces, though not its exact branching — every owner's demand here is
 * always exactly 1, never a city's scaled 2, so there is no partial-grant case to mirror): the bank
 * can cover every entitled owner (`available >= perSeat.size`) -> everyone gets +1; otherwise ->
 * nobody gets the Wizard bonus this roll, whether that's one owner facing an empty bank or several
 * owners the bank can't fully cover. Returns `null` when there's nothing to do (wrong token, desert/
 * sea-proxy hex, no adjacent buildings at all, or the shortage case) so `index.ts`'s `afterAction`
 * hook can skip emitting a no-op event.
 */
function wizardProduction(state: GameState, total: number): HexPieceHookResult | null {
  const piece = pieceByKind(state, 'wizard');
  if (!piece) return null;
  const tile = state.board.hexes[piece.hex];
  if (!tile || tile.token !== total) return null;
  const res = TERRAIN_RESOURCE[tile.terrain];
  if (res == null) return null; // desert (or a Seafarers sea/gold base-terrain proxy) never has a token
  const geomHex = geometryForState(state).hexes[piece.hex];
  if (!geomHex) return null;

  const perSeat = new Map<Seat, number>();
  for (const v of geomHex.vertices) {
    for (const p of state.players) {
      if (p.settlements.includes(v) || p.cities.includes(v)) perSeat.set(p.seat, 1);
    }
  }
  if (perSeat.size === 0) return null;

  const available = state.bank[res];
  if (perSeat.size > available) return null; // R5.3-style shortage: nobody gets the Wizard bonus this roll
  const granted = [...perSeat.entries()].map(([seat, amount]) => ({ seat, amount }));

  const bank = { ...state.bank };
  const players = state.players.map((p) => {
    const gain = granted.find((g) => g.seat === p.seat);
    if (!gain) return p;
    bank[res] -= gain.amount;
    return { ...p, resources: { ...p.resources, [res]: p.resources[res] + gain.amount } };
  });

  return {
    state: { ...state, players, bank },
    events: [hexPieceProduction('wizard', piece.hex, res, granted)],
  };
}

export const wizardKind: HexPieceKind = {
  id: 'wizard',
  onProduction: wizardProduction,
};
