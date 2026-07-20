// Pure view -> "what should the robber UX show" logic (T-405). Kept separate from
// `RobberOverlay.tsx`'s store wiring for the same reason `controls/actionBarLogic.ts` is split
// from `ActionBar.tsx`: effects/store hooks don't run under `renderToStaticMarkup` (this
// workspace's test render, see `docs/12`), so anything worth asserting on lives here as a plain
// function over a `PlayerView`.
//
// WIRE: T-204 note (matches `store/uiMode.ts`/`controls/actionBarLogic.ts`): `PlayerView` here is
// the real redacted type from `@hexhaven/engine` (T-204 landed engine-side), not the wire-level
// `unknown` placeholder in `packages/shared/src/protocol/messages.ts`.
import { goldPickCount } from '@hexhaven/engine';
import type { GameState, PlayerView } from '@hexhaven/engine';
import type { HexPieceKindId, ResourceType, Seat } from '@hexhaven/shared';

const ZERO_HAND: Record<ResourceType, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };

function isOwnEntry(entry: PlayerView['players'][number]): entry is Extract<PlayerView['players'][number], { resources: unknown }> {
  return 'resources' in entry;
}

export interface DiscardModalState {
  open: boolean;
  required: number;
  hand: Record<ResourceType, number>;
}

/** Requirement 1: the blocking discard modal is for the VIEWER only, and only while their own seat
 * is still in `phase.pending` (R6.1/ER-2 — other pending seats resolve independently). */
export function computeDiscardModalState(view: PlayerView): DiscardModalState {
  const mySeat = view.me;
  if (view.phase.kind !== 'discard' || !view.phase.pending.includes(mySeat)) {
    return { open: false, required: 0, hand: ZERO_HAND };
  }
  const own = view.players.find((p) => p.seat === mySeat);
  const hand = own && isOwnEntry(own) ? own.resources : ZERO_HAND;
  return { open: true, required: view.phase.amounts[mySeat] ?? 0, hand };
}

/** Requirement 1's "waiting for X, Y to discard…" bar: the OTHER seats still owed a discard, shown
 * only to viewers who don't themselves owe one (they get the modal instead). `null` means "don't
 * render the bar at all" (not in the discard phase, or the viewer is one of the pending seats). */
export function pendingDiscardSeats(view: PlayerView): Seat[] | null {
  if (view.phase.kind !== 'discard') return null;
  if (view.phase.pending.includes(view.me)) return null;
  return view.phase.pending;
}

/** Requirement 2: silently enter the T-304 `movingRobber` hex mode — no button, mirrors
 * `actionBarLogic.ts`'s `autoSetupMode` for setup placement. Only ever true for the robber's mover
 * (`turn.player`, enforced identically by the engine's `moveRobberHandler`). */
export function shouldAutoEnterMovingRobber(view: PlayerView): boolean {
  return view.phase.kind === 'moveRobber' && view.turn.player === view.me;
}

/** T-705 (S8): a Seafarers game lets the mover relocate the PIRATE (a sea hex) instead of the robber
 * on a 7 / Knight. True only during the mover's own `moveRobber` sub-phase in a seafarers game, so
 * the overlay can offer the robber-or-pirate choice; a base game never shows it. */
export function isSeafarersRobberMove(view: PlayerView): boolean {
  return (
    shouldAutoEnterMovingRobber(view) &&
    (view as unknown as { ext?: { seafarers?: unknown } }).ext?.seafarers != null
  );
}

/** T-902 (multi-piece hex framework, docs/07 D-034): a game with the `hexPieces` modifier active
 * lets the mover relocate an active hex piece instead of the robber on a 7 / Knight. True only
 * during the mover's own `moveRobber` sub-phase while at least one hex piece is active; a base
 * game (or one without the modifier) never shows it. */
export function isHexPiecesMove(view: PlayerView): boolean {
  return shouldAutoEnterMovingRobber(view) && activeHexPieceKinds(view).length > 0;
}

/** T-903: every hex-piece KIND currently active this game (any subset of the 5 declared kinds,
 *  `HexPieceKindId`, packages/shared/src/types.ts), in whatever order `state.ext.hexPieces.pieces`
 *  holds them (the engine's own `HEX_PIECE_KIND_IDS` fixed order — stable across a game). Empty
 *  while the `hexPieces` modifier is off. */
export function activeHexPieceKinds(view: PlayerView): HexPieceKindId[] {
  return (
    (view as unknown as { ext?: { hexPieces?: { pieces: { kind: HexPieceKindId }[] } } }).ext?.hexPieces?.pieces ?? []
  ).map((p) => p.kind);
}

/** T-903: every board-target the MOVER may choose to relocate this 7/Knight — the base robber,
 *  the Seafarers pirate (if the game has one), and every currently active hex-piece kind, in that
 *  order. A base game with neither Seafarers nor hexPieces active returns just `['robber']` (no
 *  chooser is shown in that case — see `RobberOverlay.tsx`). */
export type MoveTarget = 'robber' | 'pirate' | HexPieceKindId;

export function movableTargets(view: PlayerView): MoveTarget[] {
  const targets: MoveTarget[] = ['robber'];
  if (isSeafarersRobberMove(view)) targets.push('pirate');
  targets.push(...activeHexPieceKinds(view));
  return targets;
}

export interface GoldDialogState {
  open: boolean;
  /** How many free resources the viewer must pick — their entitlement capped by the bank (S9.3). */
  required: number;
  /** The bank's current stock, so each resource can be capped at what remains (R5.3/S9.3). */
  bank: Record<ResourceType, number>;
}

/** T-705 gold fields (S9/ER-S7): the blocking picker is for the VIEWER only, and only while their own
 * seat still owes a gold choice — mirrors `computeDiscardModalState`. `required` is the bank-capped
 * pick count; the dialog caps each resource at the bank's stock. */
export function computeGoldDialogState(view: PlayerView): GoldDialogState {
  const mySeat = view.me;
  if (view.phase.kind !== 'chooseGoldResource' || !view.phase.pending.includes(mySeat)) {
    return { open: false, required: 0, bank: ZERO_HAND };
  }
  const required = goldPickCount(view as unknown as GameState, mySeat);
  return { open: true, required, bank: view.bank };
}

export interface StealCandidateInfo {
  seat: Seat;
  resourceCount: number;
}

/** Requirement 3: candidates for the `steal` phase's owner — counts only (never types), matching
 * `OtherPlayerView`'s redaction. `null` when it isn't the viewer's steal choice to make (the
 * engine only ever enters `steal` with >=2 candidates, ER-3 auto-resolves 0/1, so a non-null
 * result here is always non-empty). */
export function computeStealCandidates(view: PlayerView): StealCandidateInfo[] | null {
  if (view.phase.kind !== 'steal' || view.turn.player !== view.me) return null;
  return view.phase.candidates.map((seat) => {
    const entry = view.players.find((p) => p.seat === seat);
    const resourceCount = entry && !isOwnEntry(entry) ? entry.resourceCount : 0;
    return { seat, resourceCount };
  });
}
