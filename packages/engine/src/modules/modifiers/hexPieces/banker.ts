// The Banker (T-903, docs/tasks/modifiers-RESEARCH.md Bucket A "The Banker", docs/tasks/phase-9/
// PICKS.md "Banker = hex produces its resource for the placer"): unlike the Wizard (adjacency-based,
// benefits ANY owner adjacent to its hex) the Banker's production is OWNER-SCOPED and NOT
// adjacency-based at all — whichever seat most recently placed/moved the piece there (`piece.owner`,
// `HexPieceInstance`, packages/shared/src/types.ts) gets +1 of the hex's resource each time that
// hex's own number rolls, regardless of whether that seat (or anyone) has a building anywhere near
// it. This is the PICKS.md simplification of the research doc's fuller "robber-as-producer" sketch
// (which also gave the 7-roller a free bank draw — NOT built here; PICKS.md's one-line brief for
// this task is the authoritative, narrower scope: production only).
//
// `owner` is `undefined` until the piece is first moved (nobody has "placed" it yet at lazy
// game-start placement, `ensureHexPiecesExt`) — so a Banker that's never been moved produces for
// nobody, same "nothing to do yet" shape as the Wizard's own no-adjacent-building case.
import { TERRAIN_RESOURCE } from '@hexhaven/shared';
import type { GameState } from '@hexhaven/shared';
import { hexPieceProduction } from '../../../events.js';
import { pieceByKind } from './state.js';
import type { HexPieceHookResult, HexPieceKind } from './types.js';

function bankerProduction(state: GameState, total: number): HexPieceHookResult | null {
  const piece = pieceByKind(state, 'banker');
  if (!piece || piece.owner === undefined) return null;
  const tile = state.board.hexes[piece.hex];
  if (!tile || tile.token !== total) return null;
  const res = TERRAIN_RESOURCE[tile.terrain];
  if (res == null) return null; // desert (or a Seafarers sea/gold base-terrain proxy) never has a token
  if (state.bank[res] <= 0) return null; // R5.3-style shortage: the sole entitled owner gets nothing

  const owner = piece.owner;
  const bank = { ...state.bank, [res]: state.bank[res] - 1 };
  const players = state.players.map((p) =>
    p.seat === owner ? { ...p, resources: { ...p.resources, [res]: p.resources[res] + 1 } } : p
  );
  return {
    state: { ...state, players, bank },
    events: [hexPieceProduction('banker', piece.hex, res, [{ seat: owner, amount: 1 }])],
  };
}

export const bankerKind: HexPieceKind = {
  id: 'banker',
  onProduction: bankerProduction,
};
