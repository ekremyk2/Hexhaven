// Barrel for the T-901 modifier framework (docs/07 D-034). `modules/index.ts`'s `resolveModules`
// is the only internal consumer; `modifierAvailability` is also re-exported from the engine's
// public API (`@hexhaven/engine`) for the client's Modifiers menu (apps/client/src/options/
// OptionsPanel.tsx) and `MODIFIER_IDS`/`MODIFIERS` for the server's lobby validation
// (apps/server/src/lobby.ts).

export { combine2sAnd12sModule } from './combine2sAnd12s.js';
export { customTargetVpModule } from './customTargetVp.js';
export {
  drawEventCard,
  ensureEventCardsExt,
  eventCardsExt,
  eventCardsModule,
  EVENT_DECK_COMPOSITION,
} from './eventCards.js';
export type { EventCardsExt } from './eventCards.js';
export { friendlyRobberModule } from './friendlyRobber.js';
export { harbormasterExt, harbormasterModule, updateHarbormaster } from './harbormaster.js';
export {
  ensureHexPiecesExt,
  hexPiecesExt,
  hexPiecesModule,
  HEX_PIECE_KIND_IDS,
  HEX_PIECE_KINDS,
  pieceByKind,
} from './hexPieces/index.js';
export type { HexPieceHookResult, HexPieceKind } from './hexPieces/index.js';
export { playDevSameTurnModule } from './playDevSameTurn.js';
export {
  enabledModifierIds,
  MODIFIER_IDS,
  MODIFIERS,
  modifierAvailability,
  resolveModifierModules,
} from './registry.js';
export type { ModifierAvailability, ModifierIncompatibility, ModifierRegistryEntry } from './types.js';
