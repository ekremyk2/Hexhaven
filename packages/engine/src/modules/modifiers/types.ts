// Modifier registry types (T-901, docs/07 D-034, docs/tasks/phase-9/PICKS.md). A modifier is a
// RuleModule built from its own config, registered once here so `resolveModules`
// (modules/index.ts) can stack it AFTER the active expansion module(s). This is the ONE place a
// new modifier (wave A–D: T-903a/906/905/904/902) plugs in — register an entry in `MODIFIERS`
// (registry.ts) and, if it added a `ModifierId` literal, an incompatibility if it needs one.

import type { GameConfig, ModifierConfigMap, ModifierId } from '@hexhaven/shared';
import type { EngineError } from '../../reduce.js';
import type { ExpansionId, RuleModule } from '../types.js';

/**
 * Declarative incompatibility (docs/07 D-034 "compatibility matrix"): a genuine rule conflict,
 * checked BEFORE the modifier's own `module` factory ever runs. `reason` is an i18n key fragment
 * (`lobby:options.modifiers.incompatibleReasons.<reason>`) — never a display string (engine/server
 * never produce user-facing text, docs/05 §7).
 */
export interface ModifierIncompatibility {
  /** Expansions this modifier can never combine with. */
  expansions?: readonly ExpansionId[];
  /** Other modifiers this modifier can never combine with. Checked from BOTH sides by
   *  `modifierAvailability` (registry.ts), so declaring it on either modifier is enough. */
  modifiers?: readonly ModifierId[];
  /** i18n reason-key fragment describing the conflict (docs/05 §7 — data, not display text). */
  reason: string;
}

/** One registry entry per `ModifierId` (registry.ts's `MODIFIERS`). */
export interface ModifierRegistryEntry<K extends ModifierId = ModifierId> {
  id: K;
  /** Builds this modifier's `RuleModule` from its config (docs/03 §3's `ModifierConfigMap[K]`). A
   *  param-less modifier ignores its (always-`true`) config argument. */
  module: (config: ModifierConfigMap[K]) => RuleModule;
  /** Absent = compatible with every expansion/modifier combination. */
  incompatibleWith?: ModifierIncompatibility;
  /**
   * Optional config-shape validation (T-906, docs/07 D-034 `customConstants` — the first modifier
   * to need this: range-checking its many optional numeric/bundle fields, some cross-checked
   * against `playerCount`). Runs BEFORE `module` is ever called, for every enabled modifier that
   * declares it — a coded `MODIFIER_INVALID_CONFIG` error here short-circuits `resolveModifierModules`
   * exactly like a compatibility-matrix conflict does. A param-less modifier simply omits this.
   */
  validateConfig?: (
    config: ModifierConfigMap[K],
    full: Pick<GameConfig, 'playerCount' | 'expansions'>
  ) => EngineError | null;
}

/** The full registry: exactly one entry per declared `ModifierId`. */
export type ModifierRegistry = { [K in ModifierId]: ModifierRegistryEntry<K> };

/** Per-modifier availability (docs/07 D-034): what the client's Modifiers menu greys out. */
export interface ModifierAvailability {
  available: boolean;
  /** Present iff `available` is false — the i18n reason-key fragment from the conflicting entry. */
  reason?: string;
}
