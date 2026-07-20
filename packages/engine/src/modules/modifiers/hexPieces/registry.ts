// The hex-piece KIND registry (T-902) — mirrors `modules/modifiers/registry.ts`'s `MODIFIER_IDS`/
// `MODIFIERS` pattern one layer down: every declared `HexPieceKindId` gets exactly one entry here.
// T-903 adds Trader/Robin Hood/Banker/Poaching by importing their module and adding one line to
// each of `HEX_PIECE_KIND_IDS`/`HEX_PIECE_KINDS` — nothing else in the framework changes.

import type { HexPieceKindId } from '@hexhaven/shared';
import { bankerKind } from './banker.js';
import { poachingKind } from './poaching.js';
import { robinHoodKind } from './robinHood.js';
import { traderKind } from './trader.js';
import { wizardKind } from './wizard.js';
import type { HexPieceKind } from './types.js';

/** Every declared `HexPieceKindId`, in a fixed order (mirrors `MODIFIER_IDS`'s determinism note) —
 *  used wherever the framework needs to iterate every POSSIBLE kind rather than just the enabled
 *  ones (placement order, production-hook iteration order). */
export const HEX_PIECE_KIND_IDS: readonly HexPieceKindId[] = [
  'wizard',
  'trader',
  'robinHood',
  'banker',
  'poaching',
];

/** The kind registry: one entry per `HexPieceKindId`. */
export const HEX_PIECE_KINDS: Readonly<Record<HexPieceKindId, HexPieceKind>> = {
  wizard: wizardKind,
  trader: traderKind,
  robinHood: robinHoodKind,
  banker: bankerKind,
  poaching: poachingKind,
};
