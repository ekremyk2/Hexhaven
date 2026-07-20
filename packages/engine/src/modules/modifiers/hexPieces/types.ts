// The hex-piece KIND interface (T-902, docs/07 D-034, docs/tasks/modifiers-RESEARCH.md "Design
// pattern: multiple coexisting hex-pieces"). This is the ONE extension point T-903's five pieces
// (Trader, Wizard, Robin Hood, Banker, Poaching) plug into — a new kind is (1) one `HexPieceKindId`
// literal (packages/shared/src/types.ts), (2) one `HexPieceKind` object here implementing only the
// hooks it needs, (3) one entry in `HEX_PIECE_KINDS`/`HEX_PIECE_KIND_IDS` (registry.ts), (4) one
// i18n name/description, (5) one zod enum member (`HexPieceKindIdSchema`, protocol/actions.ts).
// Nothing else in the framework (state.ts/index.ts) ever special-cases a kind by name.

import type { GameEvent, GameState, HexId, HexPieceKindId, ResourceType, Seat } from '@hexhaven/shared';

/** A hook's result: the (possibly-changed) state plus any extra events it produced. Every hook
 *  below returns this shape so the framework can fold it into the transition uniformly. */
export interface HexPieceHookResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * One hex-piece kind's full behavior. Every member is OPTIONAL — a piece implements only the hooks
 * its rule actually needs (the reference Wizard implements only `onProduction`); the framework
 * (index.ts/state.ts) never assumes a hook exists.
 */
export interface HexPieceKind {
  id: HexPieceKindId;

  /**
   * Deterministic starting hex for this piece the moment the modifier lazily initializes
   * `ext.hexPieces` (docs/tasks/phase-9/PICKS.md "each enabled piece starts on the desert with the
   * robber, or a deterministic default hex"). Absent -> defaults to the robber's current hex
   * (`ensureHexPiecesExt`, state.ts) — every piece shipped so far (just the Wizard) uses the
   * default; a future kind can override this for a different deterministic start.
   */
  startHex?(state: GameState): HexId;

  /**
   * Fires once the framework has ALREADY moved this piece's `hex` field to `to` (the `moveHexPiece`
   * intercept, index.ts) — a piece's own on-move effect: a bank draw (Poaching), a redirected steal
   * (Robin Hood), or nothing at all (the reference Wizard has no on-move effect — only a production
   * effect below). Must never move ANY piece itself (the framework already did) or touch the phase
   * transition (the framework returns `moveRobber` to `main`/`preRoll` uniformly for every kind,
   * mirroring `moveRobberHandler`'s own return-phase logic). Absent -> no on-move effect.
   */
  onMove?(state: GameState, seat: Seat, to: HexId): HexPieceHookResult;

  /**
   * Production hook (the Wizard's effect, docs/tasks/modifiers-RESEARCH.md Bucket A): fires once
   * per resolved (non-7) dice roll, from `phaseHooks.afterAction` intercepting `rollDice`, AFTER the
   * base production (`rules/production.ts`) has already resolved for every ordinary hex — this is a
   * strictly ADDITIVE top-up, never a replacement (R5 untouched). `state` is the post-base-
   * production state; `roll` is the rolled total. Return a replacement state + extra events, or
   * `null` for no effect this roll (e.g. the piece's own hex's token doesn't match `roll`, or no
   * settlement/city sits adjacent to it). Absent -> no production effect.
   */
  onProduction?(state: GameState, roll: number): HexPieceHookResult | null;

  /**
   * Trade-rate hook (T-903 "Trader"): the bank rate this piece's hex grants `seat` for `give`, when
   * `seat` owns a settlement/city adjacent to the piece's own hex — `null` for no override (either
   * the piece grants no such rate at all, or `seat` isn't adjacent / `give` isn't the piece's hex's
   * resource). Absent -> no trade-rate effect. Not consulted by anything in THIS task (the Wizard
   * doesn't implement it) — defined now so T-903's Trader is a clean drop-in against an already-
   * wired hook point rather than a framework change.
   */
  tradeRateFor?(state: GameState, seat: Seat, give: ResourceType): 2 | 3 | null;
}
