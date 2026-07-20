// customConstants modifier (T-906, docs/07 D-034, docs/tasks/phase-9/PICKS.md "NEW — broad
// customizable constants / custom game system"). The broad, curated-but-EXTENSIBLE "custom game"
// tunable-constants modifier: every field of `CustomConstantsConfig` (packages/shared/src/types.ts)
// is OPTIONAL, and an absent field leaves that constant at its base/expansion-resolved default —
// so with the modifier off, or with every field left unset, base/5–6/Seafarers/Cities & Knights +
// every sim + the RK-13 oracle stay byte-identical (only an explicitly-set field changes anything).
//
// Two archetypes this modifier mixes, both already established by T-901's proof modifiers:
//   - Pure constant-OVERRIDE fields (`customTargetVp.ts`'s archetype): productionMultiplier,
//     roadBuildingCount, yearOfPlentyCount, startingResources, discardHandLimit, bankPerResource,
//     costs — each folds into `ModuleConstants` (modules/types.ts) and is read at ONE base call
//     site (see each field's doc comment there for the exact seam).
//   - `costs` needs one extra step other overrides don't: `ModuleConstants.costs`, once set, must
//     be a COMPLETE 4-key table (`resolveConstants`'s generic fold, modules/index.ts, replaces the
//     WHOLE field — never a partial merge, same reason `devDeckAdditions` exists as its own
//     additive-only field instead of folding into `devDeck` directly). So this module fills any
//     item the host didn't override from the base `COSTS` right here, once, at module-build time —
//     `resolveConstants` itself stays generic and un-special-cased.
//
// Adding a new tunable later is exactly the five steps `CustomConstantsConfig`'s header documents:
// (1) one optional config field, (2) fold it into `ModuleConstants`, (3) read it at its one base
// call site, (4) one bound in `validateCustomConstantsConfig` below, (5) one input in the client's
// custom-game params panel (apps/client/src/options/OptionsPanel.tsx).
//
// Composition / documented simplifications:
//   - `productionMultiplier` hooks `rules/production.ts`'s `computeProduction` (read by base
//     `phases/roll.ts` AND the `combine2sAnd12s` modifier's extra pass) — it does NOT reach Cities
//     & Knights' own commodity-adjusted city yield (`modules/citiesKnights/commodities.ts`
//     recomputes production from scratch under C&K rules), the same documented simplification
//     `combine2sAnd12s.ts`'s header already carries for the identical reason.
//   - `discardHandLimit` sets the BASE 7-discard limit both base `phases/roll.ts` and Cities &
//     Knights' Alchemist re-roll (`modules/citiesKnights/index.ts`) read; C&K's own per-wall bonus
//     (C9.2) is not currently wired to adjust the effective limit at all (a pre-existing gap, not
//     something this task's seam needs to preserve or fix — see that module's `walls.ts` header).
//   - `roadBuildingCount` is read by BOTH the base Road Building sub-phase (`phases/devCards.ts`)
//     and the Seafarers ship-aware variant (`modules/seafarers/roadBuilding.ts`), so it composes
//     with Seafarers for free.
//   - `yearOfPlentyCount` beyond 2 needs the `extra` picks the `playYearOfPlenty` Action's optional
//     field carries (docs/03 §4) — see `phases/devCards.ts`'s `playYearOfPlenty` for the exact
//     validation (`BAD_YOP_COUNT`). The bots (`sim/bot.ts`/`ai/candidates.ts`) only ever propose
//     the base 2-pick shape, so they simply never play Year of Plenty once a host configures a
//     different count — a soft AI-quality degradation flagged in the T-906 report, not a rule bug
//     (mirrors "The Helpers of Hexhaven" Priest/Architect degrading gracefully in a C&K game).
//   - No `incompatibleWith`: every tunable is a resolved-constant seam a base/expansion handler
//     already reads generically, so nothing here can conflict with an expansion the way Event Cards
//     (replaces the dice) conflicts with Cities & Knights' event die.

import { BANK_PER_RESOURCE, COSTS, EXT56_BANK_PER_RESOURCE, LIMITLESS_CAP, PIECES_PER_PLAYER } from '@hexhaven/shared';
import type { CustomConstantsConfig, GameConfig, ResourceType } from '@hexhaven/shared';
import type { EngineError } from '../../reduce.js';
import type { ModuleConstants, RuleModule } from '../types.js';

const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const COST_ITEMS = ['road', 'settlement', 'city', 'devCard'] as const;

// Sane upper bounds (docs/07 D-034 "validate ranges... reject invalid config with a coded error").
// Generous enough to cover any plausible house rule, tight enough to catch a fat-fingered config
// (e.g. a client bug sending `1e9`) before it reaches `createGame`/a running sim.
const MAX_MULTIPLIER = 10;
const MAX_ROAD_BUILDING_COUNT = 10;
const MAX_YOP_COUNT = 10;
const MAX_HAND_LIMIT = 50;
const MAX_BANK_PER_RESOURCE = 999;
const MAX_COST_ITEM_AMOUNT = 99;
// Limits (docs/07 D-034 "limits + winnability"). `MAX_PIECE_CAP` comfortably exceeds even the
// fiveSix 30-hex board's vertex count (84), so it never clips a legitimate house-rule bump; the
// C&K caps get their own tighter bounds since 2 is the official figure and even a generous house
// rule has no reason to go far past it.
const MAX_TARGET_VP = 999;
const MAX_PIECE_CAP = 200;
const MAX_WALL_CAP = 20;
const MAX_KNIGHT_CAP = 20;
const MAX_PROGRESS_HAND_CAP = 50;

/**
 * Per-field valid bounds for the `customConstants` modifier, exported so the lobby UI (ModifiersDialog)
 * can clamp inputs to the SAME limits `validateCustomConstantsConfig` enforces — preventing a
 * MODIFIER_INVALID_CONFIG round-trip instead of only reporting it after the fact — and show each
 * field's range inline (playtest: "modifiers should limit for no errors if possible; mention limits").
 * `startingResources`' effective per-resource max is additionally capped at `bankPerResource /
 * playerCount` (the bank-supply rule), computed in the UI since it depends on the live player count.
 * These are the single source of truth for the bounds the validators above check.
 */
export const CUSTOM_CONSTANTS_BOUNDS = {
  productionMultiplier: { min: 1, max: MAX_MULTIPLIER },
  roadBuildingCount: { min: 1, max: MAX_ROAD_BUILDING_COUNT },
  yearOfPlentyCount: { min: 1, max: MAX_YOP_COUNT },
  discardHandLimit: { min: 1, max: MAX_HAND_LIMIT },
  bankPerResource: { min: 1, max: MAX_BANK_PER_RESOURCE },
  costItem: { min: 1, max: MAX_COST_ITEM_AMOUNT },
  startingResource: { min: 0, max: MAX_BANK_PER_RESOURCE },
  targetVp: { min: 1, max: MAX_TARGET_VP },
  maxSettlements: { min: 1, max: MAX_PIECE_CAP },
  maxCities: { min: 1, max: MAX_PIECE_CAP },
  maxRoads: { min: 1, max: MAX_PIECE_CAP },
  maxCityWalls: { min: 1, max: MAX_WALL_CAP },
  maxKnightsPerLevel: { min: 1, max: MAX_KNIGHT_CAP },
  maxProgressCards: { min: 1, max: MAX_PROGRESS_HAND_CAP },
} as const;

function invalid(message: string): EngineError {
  return { code: 'MODIFIER_INVALID_CONFIG', message: `customConstants: ${message}` };
}

function isPositiveIntInRange(n: number, max: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= max;
}

/** A limit field is valid when absent (checked by the caller before this runs), `null` (the
 *  "limitless" sentinel — docs/07 D-034), or a positive integer within `max`. */
function isValidLimit(n: number | null, max: number): boolean {
  return n === null || isPositiveIntInRange(n, max);
}

/** Resolve one limit field to the number `ModuleConstants` stores: `undefined` (leave `constants`
 *  untouched — the caller only invokes this once it knows the field IS set), `null` → `Infinity`
 *  (limitless), else the configured cap itself. */
function resolveLimit(n: number | null): number {
  // `null` (limitless) → a large FINITE cap, NOT Infinity: Infinity does not survive JSON over the
  // wire (becomes null → client reads "max, can't build" while server-side bots on the in-memory
  // value build fine). LIMITLESS_CAP serializes cleanly and is effectively unlimited (board-capped).
  return n === null ? LIMITLESS_CAP : n;
}

/**
 * Range/shape validation (T-906) — called by `registry.ts`'s `resolveModifierModules` BEFORE
 * `customConstantsModule` ever builds the `RuleModule`, so a bad config is rejected outright
 * (`MODIFIER_INVALID_CONFIG`) rather than silently clamped or partially applied. `full.playerCount`/
 * `full.expansions.fiveSix` resolve the bank-supply default `startingResources` is cross-checked
 * against (the same figure `resolveConstants`'s own `bankPerResource` default uses).
 */
export function validateCustomConstantsConfig(
  config: CustomConstantsConfig,
  full: Pick<GameConfig, 'playerCount' | 'expansions'>
): EngineError | null {
  if (config.productionMultiplier !== undefined && !isPositiveIntInRange(config.productionMultiplier, MAX_MULTIPLIER)) {
    return invalid(`productionMultiplier must be an integer from 1 to ${MAX_MULTIPLIER}`);
  }
  if (
    config.roadBuildingCount !== undefined &&
    !isPositiveIntInRange(config.roadBuildingCount, MAX_ROAD_BUILDING_COUNT)
  ) {
    return invalid(`roadBuildingCount must be an integer from 1 to ${MAX_ROAD_BUILDING_COUNT}`);
  }
  if (config.yearOfPlentyCount !== undefined && !isPositiveIntInRange(config.yearOfPlentyCount, MAX_YOP_COUNT)) {
    return invalid(`yearOfPlentyCount must be an integer from 1 to ${MAX_YOP_COUNT}`);
  }
  if (config.discardHandLimit !== undefined && !isPositiveIntInRange(config.discardHandLimit, MAX_HAND_LIMIT)) {
    return invalid(`discardHandLimit must be an integer from 1 to ${MAX_HAND_LIMIT}`);
  }
  if (
    config.bankPerResource !== undefined &&
    !isPositiveIntInRange(config.bankPerResource, MAX_BANK_PER_RESOURCE)
  ) {
    return invalid(`bankPerResource must be an integer from 1 to ${MAX_BANK_PER_RESOURCE}`);
  }

  if (config.costs) {
    for (const item of COST_ITEMS) {
      const bundle = config.costs[item];
      if (!bundle) continue;
      for (const res of RESOURCE_TYPES) {
        const amt = bundle[res];
        if (amt === undefined) continue;
        if (!Number.isInteger(amt) || amt < 1 || amt > MAX_COST_ITEM_AMOUNT) {
          return invalid(`costs.${item}.${res} must be an integer from 1 to ${MAX_COST_ITEM_AMOUNT}`);
        }
      }
    }
  }

  if (config.startingResources) {
    const bankPerResource =
      config.bankPerResource ?? (full.expansions.fiveSix ? EXT56_BANK_PER_RESOURCE : BANK_PER_RESOURCE);
    for (const res of RESOURCE_TYPES) {
      const amt = config.startingResources[res];
      if (amt === undefined) continue;
      if (!Number.isInteger(amt) || amt < 0) {
        return invalid(`startingResources.${res} must be a non-negative integer`);
      }
      if (amt * full.playerCount > bankPerResource) {
        return invalid(
          `startingResources.${res} (${amt}) x ${full.playerCount} players exceeds the bank supply (${bankPerResource})`
        );
      }
    }
  }

  // Limits (docs/07 D-034 "limits + winnability") — each is a positive int within its own bound, OR
  // the `null` limitless sentinel; `undefined` (absent) is left alone entirely.
  if (config.targetVp !== undefined && !isValidLimit(config.targetVp, MAX_TARGET_VP)) {
    return invalid(`targetVp must be an integer from 1 to ${MAX_TARGET_VP}, or null for an endless game`);
  }
  if (config.maxSettlements !== undefined && !isValidLimit(config.maxSettlements, MAX_PIECE_CAP)) {
    return invalid(`maxSettlements must be an integer from 1 to ${MAX_PIECE_CAP}, or null for unlimited`);
  }
  if (config.maxCities !== undefined && !isValidLimit(config.maxCities, MAX_PIECE_CAP)) {
    return invalid(`maxCities must be an integer from 1 to ${MAX_PIECE_CAP}, or null for unlimited`);
  }
  if (config.maxRoads !== undefined && !isValidLimit(config.maxRoads, MAX_PIECE_CAP)) {
    return invalid(`maxRoads must be an integer from 1 to ${MAX_PIECE_CAP}, or null for unlimited`);
  }
  if (config.maxCityWalls !== undefined && !isValidLimit(config.maxCityWalls, MAX_WALL_CAP)) {
    return invalid(`maxCityWalls must be an integer from 1 to ${MAX_WALL_CAP}, or null for unlimited`);
  }
  if (config.maxKnightsPerLevel !== undefined && !isValidLimit(config.maxKnightsPerLevel, MAX_KNIGHT_CAP)) {
    return invalid(`maxKnightsPerLevel must be an integer from 1 to ${MAX_KNIGHT_CAP}, or null for unlimited`);
  }
  if (config.maxProgressCards !== undefined && !isValidLimit(config.maxProgressCards, MAX_PROGRESS_HAND_CAP)) {
    return invalid(`maxProgressCards must be an integer from 1 to ${MAX_PROGRESS_HAND_CAP}, or null for unlimited`);
  }

  return null;
}

/** Fills any cost item the host didn't override from the base `COSTS` (see this file's header —
 *  `ModuleConstants.costs`, once set, must be the complete 4-key table). */
function resolveCostsOverride(
  overrides: NonNullable<CustomConstantsConfig['costs']>
): ModuleConstants['costs'] {
  return {
    road: overrides.road ?? COSTS.road,
    settlement: overrides.settlement ?? COSTS.settlement,
    city: overrides.city ?? COSTS.city,
    devCard: overrides.devCard ?? COSTS.devCard,
  };
}

export function customConstantsModule(config: CustomConstantsConfig): RuleModule {
  const constants: Partial<ModuleConstants> = {};
  if (config.productionMultiplier !== undefined) constants.productionMultiplier = config.productionMultiplier;
  if (config.roadBuildingCount !== undefined) constants.roadBuildingCount = config.roadBuildingCount;
  if (config.yearOfPlentyCount !== undefined) constants.yearOfPlentyCount = config.yearOfPlentyCount;
  if (config.startingResources !== undefined) constants.startingResources = config.startingResources;
  if (config.discardHandLimit !== undefined) constants.discardHandLimit = config.discardHandLimit;
  if (config.bankPerResource !== undefined) constants.bankPerResource = config.bankPerResource;
  if (config.costs !== undefined) constants.costs = resolveCostsOverride(config.costs);

  // Limits (docs/07 D-034 "limits + winnability"). `targetVp`/`maxCityWalls`/`maxKnightsPerLevel`/
  // `maxProgressCards` fold straight into `ModuleConstants`' matching (already-`number`, Infinity-
  // capable) fields — `resolveLimit` is the one place `null` becomes `Infinity`.
  if (config.targetVp !== undefined) constants.targetVp = resolveLimit(config.targetVp);
  if (config.maxCityWalls !== undefined) constants.maxCityWalls = resolveLimit(config.maxCityWalls);
  if (config.maxKnightsPerLevel !== undefined) constants.maxKnightsPerLevel = resolveLimit(config.maxKnightsPerLevel);
  if (config.maxProgressCards !== undefined) constants.maxProgressCards = resolveLimit(config.maxProgressCards);

  // maxSettlements/maxCities/maxRoads fold into the WHOLE `piecesPerPlayer` object (same "fill any
  // unset item from the base constant" discipline `resolveCostsOverride` uses above — no active
  // module currently varies `piecesPerPlayer` by expansion, mirroring `COSTS`, so reading the
  // literal `PIECES_PER_PLAYER` base here is safe for every expansion, not just base).
  if (config.maxSettlements !== undefined || config.maxCities !== undefined || config.maxRoads !== undefined) {
    constants.piecesPerPlayer = {
      roads: config.maxRoads !== undefined ? resolveLimit(config.maxRoads) : PIECES_PER_PLAYER.roads,
      settlements:
        config.maxSettlements !== undefined ? resolveLimit(config.maxSettlements) : PIECES_PER_PLAYER.settlements,
      cities: config.maxCities !== undefined ? resolveLimit(config.maxCities) : PIECES_PER_PLAYER.cities,
    };
  }

  return { id: 'customConstants', constants };
}
