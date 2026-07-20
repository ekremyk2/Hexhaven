// The modifier registry + resolution (T-901, docs/07 D-034, docs/tasks/phase-9/PICKS.md). Mirrors
// `modules/index.ts`'s expansion resolution one layer up: turns `config.modifiers` into the
// ordered `RuleModule[]` `resolveModules` appends after the active expansion module(s), enforcing
// the compatibility matrix along the way. `modifierAvailability` is the pure, side-effect-free
// twin the client's Modifiers menu calls to grey out invalid choices before the player even submits.

import type { GameConfig, ModifierId } from '@hexhaven/shared';
import type { EngineError } from '../../reduce.js';
import { cardModsModule } from './cardMods/index.js';
import { combine2sAnd12sModule } from './combine2sAnd12s.js';
import { customConstantsModule, validateCustomConstantsConfig } from './customConstants.js';
import { customTargetVpModule } from './customTargetVp.js';
import { eventCardsModule } from './eventCards.js';
import { friendlyRobberModule } from './friendlyRobber.js';
import { harbormasterModule } from './harbormaster.js';
import { helpersModule } from './helpers/index.js';
import { hexPiecesModule, validateHexPiecesConfig } from './hexPieces/index.js';
import { hiddenSetupNumbersModule } from './hiddenSetupNumbers.js';
import { playDevSameTurnModule } from './playDevSameTurn.js';
import { shuffleNumbersModule } from './shuffleNumbers.js';
import type { ModifierAvailability, ModifierRegistry } from './types.js';
import type { ExpansionId, RuleModule } from '../types.js';

/**
 * Every declared `ModifierId`, in the FIXED order `resolveModules` appends them — deterministic
 * regardless of `config.modifiers` key insertion order (docs/03 §3 D-004 determinism). A new
 * modifier adds its id here (and to the `ModifierId` union, packages/shared/src/types.ts) exactly
 * once. Wave A-1 (T-903a/906) adds `friendlyRobber`, `playDevSameTurn`, `harbormaster`.
 */
export const MODIFIER_IDS: readonly ModifierId[] = [
  'customTargetVp',
  'combine2sAnd12s',
  'eventCards',
  'friendlyRobber',
  'playDevSameTurn',
  'harbormaster',
  'cardMods',
  'helpers',
  'customConstants',
  'hexPieces',
  'shuffleNumbers',
  'hiddenSetupNumbers',
];

/**
 * The modifier registry: one entry per `ModifierId`.
 */
export const MODIFIERS: ModifierRegistry = {
  customTargetVp: {
    id: 'customTargetVp',
    module: (targetVp) => customTargetVpModule(targetVp),
  },
  combine2sAnd12s: {
    id: 'combine2sAnd12s',
    module: () => combine2sAnd12sModule,
  },
  // T-904b (docs/tasks/modifiers-cards-RESEARCH.md D3a): replaces the two production dice with a
  // shuffled 36-card event deck (see eventCards.ts's header). Still incompatible with Cities &
  // Knights — that expansion's own event die + colour-gated production is a second, conflicting
  // "replace the roll" mechanism (docs/tasks/phase-9/PICKS.md).
  eventCards: {
    id: 'eventCards',
    module: () => eventCardsModule,
    incompatibleWith: {
      expansions: ['citiesKnights'],
      reason: 'eventCardsVsCitiesKnights',
    },
  },
  // Wave A-1 (T-903a/906, docs/07 D-034). No `incompatibleWith` for any of the three: all compose
  // cleanly with every expansion —
  //  - `friendlyRobber` composes with Cities & Knights' robber-lock (C10.1) for free: while locked,
  //    C&K's own `interceptAction` rejects `moveRobber`/`steal` before this module's intercept ever
  //    runs (see friendlyRobber.ts's header); once unlocked, it applies normally.
  //  - `playDevSameTurn`'s constant is simply never consulted in a C&K game — C&K disables every
  //    base dev-card action outright with `DEV_CARDS_DISABLED` (see playDevSameTurn.ts's header).
  //  - `harbormaster` and Cities & Knights both add VP awards (metropolises, Defender of Hexhaven,
  //    Merchant), but each lives in its own `vp.ts` breakdown field / `ext.<id>` slot — they simply
  //    sum, no interaction to gate.
  friendlyRobber: {
    id: 'friendlyRobber',
    module: () => friendlyRobberModule,
  },
  playDevSameTurn: {
    id: 'playDevSameTurn',
    module: () => playDevSameTurnModule,
  },
  harbormaster: {
    id: 'harbormaster',
    module: () => harbormasterModule,
  },
  // T-904 (cardMods): no `incompatibleWith` — see cardMods/index.ts's header for why it composes
  // cleanly with Cities & Knights (which already disables all base dev-card actions outright).
  cardMods: {
    id: 'cardMods',
    module: () => cardModsModule,
  },
  // T-905 ("The Helpers of Hexhaven"): no `incompatibleWith` by design — Priest/Architect simply
  // become unusable in a Cities & Knights game (no base Knight dev card / dev-deck buy to fuel
  // them, docs/tasks/modifiers-helpers-RESEARCH.md), a soft, acceptable degradation rather than a
  // hard conflict (see helpers/index.ts's header).
  helpers: {
    id: 'helpers',
    module: () => helpersModule,
  },
  // T-906 (docs/07 D-034 "NEW — broad customizable constants / custom game system"): no
  // `incompatibleWith` — every tunable is either a base-constant override (composes generically,
  // folds AFTER any expansion) or a resolved-constant a base handler reads, so it layers on top of
  // whichever expansion is active rather than conflicting with one (see customConstants.ts's header
  // for the couple of documented simplifications: productionMultiplier doesn't reach Cities &
  // Knights' own commodity-adjusted city yield, same precedent `combine2sAnd12s` already set).
  customConstants: {
    id: 'customConstants',
    module: (config) => customConstantsModule(config),
    validateConfig: (config, full) => validateCustomConstantsConfig(config, full),
  },
  // T-902 (multi-piece hex framework, docs/07 D-034): no `incompatibleWith` — it never touches the
  // base `state.robber`/robber pipeline or the Seafarers pirate (a purely additive `moveHexPiece`
  // action alongside the untouched `moveRobber`), and composes with Cities & Knights' robber-lock
  // (C10) for free — see `hexPieces/index.ts`'s header for exactly how (its own `robberLocked` check,
  // mirroring `friendlyRobber`'s identical composition note above).
  hexPieces: {
    id: 'hexPieces',
    module: (config) => hexPiecesModule(config),
    validateConfig: (config) => validateHexPiecesConfig(config),
  },
  // Board-setup house rules. Both are hook-less no-op modules — their whole effect is a config gate
  // read elsewhere: `shuffleNumbers` in `createGame` (routes to the R2.5 shuffled token method),
  // `hiddenSetupNumbers` in `redact` (strips tokens from the view during setup). No `incompatibleWith`
  // — they only touch board generation / redaction, never a turn-time rule, so they compose with
  // every expansion and every other modifier. (On a Seafarers scenario board `shuffleNumbers` is a
  // no-op: that board dictates its own layout — see createGame's scenario branch.)
  shuffleNumbers: {
    id: 'shuffleNumbers',
    module: () => shuffleNumbersModule,
  },
  hiddenSetupNumbers: {
    id: 'hiddenSetupNumbers',
    module: () => hiddenSetupNumbersModule,
  },
};

/** Which expansions are active for `config` (docs/10 §3) — used only for the compatibility check
 *  below, independent of whatever `RuleModule[]` `resolveModules` has already built. */
function activeExpansionIds(config: Pick<GameConfig, 'expansions'>): ExpansionId[] {
  const ids: ExpansionId[] = [];
  if (config.expansions.fiveSix) ids.push('fiveSix');
  if (config.expansions.seafarers !== false) ids.push('seafarers');
  if (config.expansions.citiesKnights) ids.push('citiesKnights');
  return ids;
}

/** The `ModifierId`s `config.modifiers` enables, in `MODIFIER_IDS` order. A key mapped to
 *  `undefined` (never actually constructible via the typed `GameConfig`, but a defensive guard
 *  against a hand-built/deserialized config) counts as disabled, same as an absent key. */
export function enabledModifierIds(config: Pick<GameConfig, 'modifiers'>): ModifierId[] {
  const modifiers = config.modifiers;
  if (!modifiers) return [];
  return MODIFIER_IDS.filter((id) => modifiers[id] !== undefined);
}

/** Availability of a single `id` given the currently active expansions/enabled modifiers — checks
 *  both `id`'s own `incompatibleWith` AND every OTHER enabled modifier's `incompatibleWith.modifiers`
 *  for a reference back to `id` (so a conflict declared on just one side of a pair still gates the
 *  other side's menu entry too). */
function singleAvailability(
  id: ModifierId,
  activeExpansions: readonly ExpansionId[],
  enabledIds: readonly ModifierId[]
): ModifierAvailability {
  const own = MODIFIERS[id].incompatibleWith;
  if (own?.expansions?.some((e) => activeExpansions.includes(e))) {
    return { available: false, reason: own.reason };
  }
  if (own?.modifiers?.some((m) => m !== id && enabledIds.includes(m))) {
    return { available: false, reason: own.reason };
  }
  for (const otherId of enabledIds) {
    if (otherId === id) continue;
    const other = MODIFIERS[otherId].incompatibleWith;
    if (other?.modifiers?.includes(id)) return { available: false, reason: other.reason };
  }
  return { available: true };
}

/**
 * Pure helper for the client's Modifiers menu (docs/07 D-034): availability of EVERY declared
 * modifier for `config`'s current expansion/modifier selection, independent of whether that
 * modifier is even enabled — an unavailable-but-not-yet-enabled entry is exactly what the menu
 * greys out. Never throws; never mutates `config`.
 */
export function modifierAvailability(
  config: Pick<GameConfig, 'expansions' | 'modifiers'>
): Record<ModifierId, ModifierAvailability> {
  const enabledIds = enabledModifierIds(config);
  const activeExpansions = activeExpansionIds(config);
  const result = {} as Record<ModifierId, ModifierAvailability>;
  for (const id of MODIFIER_IDS) result[id] = singleAvailability(id, activeExpansions, enabledIds);
  return result;
}

/**
 * Resolves `config.modifiers` to the ordered `RuleModule[]` `resolveModules` (modules/index.ts)
 * appends after the active expansion module(s), or a coded `MODIFIER_INCOMPATIBLE`/
 * `MODIFIER_INVALID_CONFIG` error if any enabled modifier's availability check or config-shape
 * `validateConfig` fails (docs/07 D-034). Both checks run for EVERY enabled modifier before any of
 * their `module` factories run, so a bad combination/config is rejected outright rather than
 * partially applied. `playerCount` (needed by `customConstants`' `startingResources` cross-check,
 * T-906) defaults to 4 for the rare caller that only has the `expansions`/`modifiers` pick — every
 * real config (lobby, `resolveModules`) always has it.
 */
export function resolveModifierModules(
  config: Pick<GameConfig, 'expansions' | 'modifiers'> & Partial<Pick<GameConfig, 'playerCount'>>
): { ok: true; modules: RuleModule[] } | { ok: false; error: EngineError } {
  const enabledIds = enabledModifierIds(config);
  const availability = modifierAvailability(config);

  for (const id of enabledIds) {
    const avail = availability[id];
    if (!avail.available) {
      return {
        ok: false,
        error: {
          code: 'MODIFIER_INCOMPATIBLE',
          message: `modifier '${id}' is incompatible with the current selection (${avail.reason ?? 'conflict'})`,
        },
      };
    }
  }

  const full = { playerCount: config.playerCount ?? 4, expansions: config.expansions };
  for (const id of enabledIds) {
    const entry = MODIFIERS[id];
    if (!entry.validateConfig) continue;
    const cfg = (config.modifiers as Record<ModifierId, unknown>)[id];
    const invalid = entry.validateConfig(cfg as never, full);
    if (invalid) return { ok: false, error: invalid };
  }

  const modules = enabledIds.map((id) => {
    const entry = MODIFIERS[id];
    // Cast is safe: `id` came from `enabledModifierIds`, which only ever returns ids present in
    // `config.modifiers` — `config.modifiers![id]` is that id's own `ModifierConfigMap[id]`.
    const cfg = (config.modifiers as Record<ModifierId, unknown>)[id];
    return entry.module(cfg as never);
  });
  return { ok: true, modules };
}
