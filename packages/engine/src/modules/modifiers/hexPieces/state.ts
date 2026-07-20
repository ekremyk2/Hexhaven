// `state.ext.hexPieces` lifecycle helpers (T-902): lazy init (placement at game start) + the
// per-kind lookup/update primitives `index.ts`'s `moveHexPiece` intercept and the piece kinds'
// hooks (wizard.ts) both use. All pure — every function returns a NEW state (or the SAME reference
// when nothing changed), never mutates `state`. Mirrors `modifiers/helpers/state.ts`'s shape.

import type { GameState, HexId, HexPieceInstance, HexPieceKindId, Seat } from '@hexhaven/shared';
import type { HexPieceKind } from './types.js';

/** Reads `state.ext.hexPieces`, or `undefined` before `ensureHexPiecesExt` has run once (or when
 *  the modifier is inactive — this module is simply never in `activeModules`, so nothing calls it). */
export function hexPiecesExt(state: GameState): { pieces: HexPieceInstance[] } | undefined {
  return state.ext?.hexPieces;
}

function withHexPiecesExt(state: GameState, ext: { pieces: HexPieceInstance[] }): GameState {
  return { ...state, ext: { ...state.ext, hexPieces: ext } };
}

/**
 * Lazily places every ENABLED kind the first time this modifier's `afterAction` hook ever sees
 * `state` — the config-gate substitute for a dedicated `initState` hook, which `RuleModule`
 * (modules/types.ts) doesn't define (mirrors `helpers`/`eventCards`). Each kind lands on its own
 * `startHex` override, or the robber's current hex when it has none (docs/tasks/phase-9/PICKS.md
 * "each enabled piece starts on the desert with the robber"). A no-op (same reference) once
 * `ext.hexPieces` already exists.
 */
export function ensureHexPiecesExt(
  state: GameState,
  enabled: readonly HexPieceKindId[],
  kinds: Readonly<Record<HexPieceKindId, HexPieceKind>>
): GameState {
  if (hexPiecesExt(state)) return state;
  const pieces: HexPieceInstance[] = enabled.map((kind) => ({
    kind,
    hex: kinds[kind].startHex?.(state) ?? state.board.robber,
  }));
  return withHexPiecesExt(state, { pieces });
}

/** The active instance of `kind`, or `undefined` when it isn't currently enabled (or the modifier
 *  is inactive). */
export function pieceByKind(state: GameState, kind: HexPieceKindId): HexPieceInstance | undefined {
  return hexPiecesExt(state)?.pieces.find((p) => p.kind === kind);
}

/**
 * Returns `state` with `kind`'s piece relocated to `hex` — a no-op (same reference) if `kind`
 * isn't currently active. Only ever called AFTER the caller has already validated the move
 * (index.ts's `moveHexPiece`); never validates itself.
 *
 * `owner` (T-903, `HexPieceInstance.owner`) is OPTIONAL and, when supplied, is stamped onto the
 * piece alongside its new `hex` — `index.ts`'s `moveHexPieceAction` always passes the mover's seat
 * here (a generic, kind-agnostic "whoever moved this piece last" record; only the Banker's
 * `onProduction` actually reads it). Omitting `owner` entirely (as the T-902 framework tests do)
 * leaves any existing `owner` field untouched rather than clearing it.
 */
export function withPieceHex(state: GameState, kind: HexPieceKindId, hex: HexId, owner?: Seat): GameState {
  const ext = hexPiecesExt(state);
  if (!ext) return state;
  const pieces = ext.pieces.map((p) => {
    if (p.kind !== kind) return p;
    return owner === undefined ? { ...p, hex } : { ...p, hex, owner };
  });
  return withHexPiecesExt(state, { pieces });
}
