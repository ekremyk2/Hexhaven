// `state.ext.hexPieces` lifecycle unit tests (T-902): lazy placement, the per-kind lookup/update
// primitives. Mirrors `modifiers/helpers/state.test.ts`'s shape one level down.

import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState, HexId } from '@hexhaven/shared';
import { createGame } from '../../../createGame.js';
import { ensureHexPiecesExt, hexPiecesExt, pieceByKind, withPieceHex } from './state.js';
import { HEX_PIECE_KINDS } from './registry.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'hexpieces-state-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

function base(): GameState {
  return createGame({ ...CONFIG });
}

describe('hexPiecesExt / ensureHexPiecesExt', () => {
  it('is undefined before ensureHexPiecesExt has run', () => {
    expect(hexPiecesExt(base())).toBeUndefined();
  });

  it('places every enabled kind on the robber hex by default (docs/tasks/phase-9/PICKS.md)', () => {
    const state = base();
    const ensured = ensureHexPiecesExt(state, ['wizard'], HEX_PIECE_KINDS);
    expect(hexPiecesExt(ensured)).toEqual({ pieces: [{ kind: 'wizard', hex: state.board.robber }] });
  });

  it('is a no-op (same reference) once ext.hexPieces already exists', () => {
    const state = base();
    const once = ensureHexPiecesExt(state, ['wizard'], HEX_PIECE_KINDS);
    const twice = ensureHexPiecesExt(once, ['wizard'], HEX_PIECE_KINDS);
    expect(twice).toBe(once);
  });

  it('places nothing when no kind is enabled (an empty selection, defensive)', () => {
    const ensured = ensureHexPiecesExt(base(), [], HEX_PIECE_KINDS);
    expect(hexPiecesExt(ensured)).toEqual({ pieces: [] });
  });
});

describe('pieceByKind / withPieceHex', () => {
  it('pieceByKind finds the active instance of an enabled kind', () => {
    const state = base();
    const ensured = ensureHexPiecesExt(state, ['wizard'], HEX_PIECE_KINDS);
    expect(pieceByKind(ensured, 'wizard')).toEqual({ kind: 'wizard', hex: state.board.robber });
  });

  it('pieceByKind is undefined for a kind that was never enabled', () => {
    const ensured = ensureHexPiecesExt(base(), [], HEX_PIECE_KINDS);
    expect(pieceByKind(ensured, 'wizard')).toBeUndefined();
  });

  it('withPieceHex relocates the named kind, leaving other pieces (and the reference) untouched otherwise', () => {
    const state = base();
    const ensured = ensureHexPiecesExt(state, ['wizard'], HEX_PIECE_KINDS);
    const otherHex = (ensured.board.robber === 0 ? 1 : 0) as HexId;
    const moved = withPieceHex(ensured, 'wizard', otherHex);
    expect(pieceByKind(moved, 'wizard')).toEqual({ kind: 'wizard', hex: otherHex });
    expect(moved).not.toBe(ensured);
  });

  it('withPieceHex is a no-op when ext.hexPieces does not exist yet', () => {
    const state = base();
    expect(withPieceHex(state, 'wizard', 3 as HexId)).toBe(state);
  });
});
