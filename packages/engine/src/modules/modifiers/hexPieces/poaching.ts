// Poaching (T-903, docs/tasks/modifiers-RESEARCH.md Bucket A "Poaching / Farming Robber",
// docs/tasks/phase-9/PICKS.md "Poaching = draw from bank"): purely an `onMove` effect — the mover
// draws 1 card of the resource of the hex the piece just moved TO, bank permitting. The research
// doc frames this as "move to an UNSETTLED hex and draw" (rewarding a friendly early placement), but
// since this piece is a separate coexisting hex piece rather than the robber itself (which stays
// completely untouched by this modifier), there is no "blocks the hex" side-effect to gate the draw
// on — this task's simplification (documented, matches PICKS.md's one-line brief) is an
// unconditional draw of the destination hex's resource, identical in shape to the Trader's own
// draw-on-move (trader.ts) minus the ongoing 3:1 port effect.
import { TERRAIN_RESOURCE } from '@hexhaven/shared';
import type { GameState, HexId, Seat } from '@hexhaven/shared';
import { hexPieceProduction } from '../../../events.js';
import type { HexPieceHookResult, HexPieceKind } from './types.js';

function poachingOnMove(state: GameState, seat: Seat, to: HexId): HexPieceHookResult {
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
    events: [hexPieceProduction('poaching', to, res, [{ seat, amount: 1 }])],
  };
}

export const poachingKind: HexPieceKind = {
  id: 'poaching',
  onMove: poachingOnMove,
};
