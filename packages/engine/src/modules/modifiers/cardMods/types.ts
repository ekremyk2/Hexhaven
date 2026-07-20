// Local types for the `cardMods` modifier (T-904, docs/tasks/modifiers-cards-RESEARCH.md D1c/D1b).
// PM WIRING (done): `CardModDevCardId`/`CardModComboId`/`PlayCardModCardAction`/
// `PlayCardModComboAction` now live in packages/shared/src/types.ts (the real `Action`/
// `AnyDevCardId` unions) — re-exported here so every sibling file in this folder keeps importing
// from `./types.js` unchanged. `CardModAction`/`CardModsConfig` stay as local convenience aliases.

export type {
  CardModDevCardId,
  CardModComboId,
  PlayCardModCardAction,
  PlayCardModComboAction,
} from '@hexhaven/shared';
import type { PlayCardModCardAction, PlayCardModComboAction } from '@hexhaven/shared';

export type CardModAction = PlayCardModCardAction | PlayCardModComboAction;

/** Param-less enable flag — mirrors `ModifierConfigMap`'s other `true`-valued entries. */
export type CardModsConfig = true;
