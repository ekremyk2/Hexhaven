// RuleModule — the expansion plug-in contract (docs/10 §3). The base engine stays pure and
// NEVER special-cases an expansion inline: each expansion is a `RuleModule` resolved at
// `createGame` from `GameConfig.expansions`, contributing its board layout, board-generation
// multisets, and module-tunable constants. Expansion state lives under `state.ext.<id>`; base
// fields never change meaning.
//
// T-601 establishes the pattern with the first real module (5–6 Player Extension). Later modules
// (Seafarers W2, Cities & Knights W3) add more optional members to this interface — action
// handlers, phase hooks, legal-move modifiers, VP sources, event types (docs/10 §3) — without
// changing the base engine.

import type {
  Action,
  AnyDevCardId,
  BoardGeometry,
  BoardLayout,
  GameEvent,
  GameState,
  HarborType,
  ModifierId,
  PlayerColor,
  ResourceType,
  Seat,
  TerrainType,
} from '@hexhaven/shared';
// Type-only import (erased at compile time — no runtime import cycle, same pattern phases/*.ts use).
import type { EngineResult } from '../reduce.js';

export type ExpansionId = 'fiveSix' | 'seafarers' | 'citiesKnights' | 'tradersBarbarians' | 'explorersPirates';

/** Module-tunable game constants (docs/03 §8) — resolved once at `createGame`. */
export interface ModuleConstants {
  bankPerResource: number;
  // `Partial` (T-904): the base 5/fiveSix's 5 keys are always present in practice, but widening to
  // `AnyDevCardId` means a `Record` requiring ALL 11 keys would force `DEV_DECK`/`EXT56_DEV_DECK`
  // (shared/src/constants.ts) to declare the 6 cardMods keys too — which would break their exact
  // `toEqual` test fixtures. `Partial` lets those constants stay exactly as they are.
  devDeck: Readonly<Partial<Record<AnyDevCardId, number>>>;
  piecesPerPlayer: Readonly<{ roads: number; settlements: number; cities: number }>;
  seatColors: readonly PlayerColor[];
  /**
   * Overrides the config-supplied victory-point target (docs/03 §8), the same way a Seafarers
   * scenario overrides it directly in `createGame` (S10.1) — here routed through the generic
   * module-constants path instead, since Cities & Knights' 13-VP target (C1.1) isn't tied to a
   * scenario. Absent for base/fiveSix/seafarers, so `createGame` falls back to its existing
   * scenario-or-config resolution unchanged (RK-13 bit-identity).
   */
  targetVp?: number;
  /**
   * Waives R9.4's "not bought this same turn" restriction on playing a development card (T-906,
   * docs/07 D-034 `playDevSameTurn` modifier) — the same constant-override archetype `targetVp`
   * uses. Absent/false for base/every expansion, so `phases/devCards.ts`'s dev-card play guard is
   * unchanged (RK-13 bit-identity).
   */
  allowDevCardSameTurnPlay?: boolean;
  /**
   * Additive dev-deck contributions (T-904, cardMods modifier), folded ON TOP of (never replacing)
   * `devDeck` by `resolveConstants` — the generic `Object.assign` override every other
   * `ModuleConstants` field uses would otherwise let a modifier appended after an expansion
   * (docs/07 D-034: modifiers always fold last) silently CLOBBER that expansion's own bumped
   * `devDeck` (e.g. fiveSix's 34-card composition) instead of composing with it. Summed across
   * every active module that declares it; absent for every module before T-904, so devDeck folding
   * is bit-identical when no such module is active (RK-13).
   */
  devDeckAdditions?: Readonly<Partial<Record<AnyDevCardId, number>>>;
  /**
   * `customConstants` tunables (T-906, docs/07 D-034). Every field absent for base/every expansion
   * — `resolveConstants`'s generic `Object.assign` fold only ever WHOLLY replaces a field when a
   * module sets it (never a partial merge), so `customConstantsModule` (modifiers/customConstants.ts)
   * is the one place that fills in any unset sub-key (e.g. `costs.road`) from the base default before
   * handing its `constants` object to `resolveModules` — every reader below can trust an absent field
   * means "base default" and a present one means "fully resolved", with no partial-object surprises.
   */
  /** Each producing settlement/city yields this many times its normal resource count (`rules/
   *  production.ts`'s `computeProduction`, R5.1). Absent/1 ⇒ base behavior (RK-13). */
  productionMultiplier?: number;
  /** How many free roads (or roads+ships, seafarers) Road Building grants (R9.6/S11.1). Absent ⇒
   *  the base 2 (`phases/devCards.ts`/`modules/seafarers/roadBuilding.ts`). */
  roadBuildingCount?: number;
  /** How many resources Year of Plenty grants (R9.7/ER-6). Absent ⇒ the base 2. */
  yearOfPlentyCount?: number;
  /** A resource bundle granted to EVERY player at `createGame` (R1.2), debited from the resolved
   *  bank supply so the I1 bank+hands invariant still holds. Absent ⇒ nobody starts with anything
   *  (base behavior, RK-13). */
  startingResources?: Readonly<Partial<Record<ResourceType, number>>>;
  /** The base 7-discard hand limit (R6.1) `phases/roll.ts`/`modules/citiesKnights/index.ts` read
   *  instead of the literal `DISCARD_THRESHOLD` constant. Absent ⇒ the base 7. Cities & Knights'
   *  per-wall bonus (C9.2, not yet wired independently of this task) would still add on TOP of
   *  whatever this sets, same as any other module-tunable base constant. */
  discardHandLimit?: number;
  /** Whole-table override of `COSTS` (R7.1/R9.1) — always all four keys once set (see the header
   *  note above: `customConstantsModule` fills any item the host didn't override from the base
   *  `COSTS`, so this is never a partial table). Absent ⇒ the base `COSTS` export. */
  costs?: Readonly<Record<'road' | 'settlement' | 'city' | 'devCard', Readonly<Partial<Record<ResourceType, number>>>>>;
  /**
   * Cities & Knights per-player city-wall cap (C9.1, T-906 `customConstants.maxCityWalls`, docs/07
   * D-034). Already RESOLVED to a usable number by the time it lands here — `null`/"limitless" in
   * the config is converted to `Infinity` at `customConstantsModule` (modules/modifiers/
   * customConstants.ts), so every reader (`modules/citiesKnights/walls.ts`) just does
   * `?? CK_MAX_WALLS` and never has to know about the `null` sentinel itself. Absent ⇒ the base
   * `CK_MAX_WALLS` (3), read directly by `walls.ts` (RK-13 bit-identity).
   */
  maxCityWalls?: number;
  /**
   * Cities & Knights per-LEVEL knight cap (C7.1, T-906 `customConstants.maxKnightsPerLevel`),
   * applied uniformly to basic/strong/mighty (the official cap is the same 2 for every level).
   * Same "already resolved, `Infinity` for limitless" discipline as `maxCityWalls` above. Absent ⇒
   * the base `CK_KNIGHT_CAP[level]`, read directly by `modules/citiesKnights/knights.ts`.
   */
  maxKnightsPerLevel?: number;
  /**
   * Cities & Knights progress-card hand limit (C6.3, T-906 `customConstants.maxProgressCards`) —
   * the progress-card analogue of `discardHandLimit` above. Same "already resolved" discipline.
   * Absent ⇒ the base `CK_PROGRESS_HAND_LIMIT` (4), read directly by `modules/citiesKnights/
   * progressCards.ts` and the C&K sim invariant (`sim/citiesKnightsInvariants.ts`).
   */
  maxProgressCards?: number;
}

/** Board-generation multisets tied to a module's board layout (R2/R1.2 for the module's shape). */
export interface ModuleBoardParams {
  terrainCounts: Readonly<Record<TerrainType, number>>;
  harborMix: readonly HarborType[];
  tokenSpiral: readonly number[];
}

/** A handler for a Phase kind the module OWNS (mirrors the base `PhaseHandler` signature). */
export type ModulePhaseHandler = (state: GameState, seat: Seat, action: Action) => EngineResult;

/** Turn-flow hooks (docs/10 §3). A module implements only the hooks it needs. */
export interface PhaseHooks {
  /**
   * Fires after a main-phase `endTurn` produced `advanced` (the base next-player `preRoll`). Return
   * a replacement transition to intercept turn advancement — e.g. inject an SBP special-build phase
   * or a Paired-Players partial turn — or `null` to keep the base advance. `prev` is the pre-endTurn
   * state (turn owner = the seat that just ended); `events` are the base `endTurn` events, which a
   * hook typically forwards plus its own.
   */
  afterTurnEnd?(
    prev: GameState,
    advanced: GameState,
    events: readonly GameEvent[]
  ): { state: GameState; events: GameEvent[] } | null;
  /**
   * Fires after EVERY successful action (routed or intercepted), before the win check, letting a
   * module post-process the transition — e.g. open the Seafarers gold sub-phase after a producing
   * roll, or grant an island VP chit after a settlement (docs/10 §3). `prev` is the pre-action state,
   * `next` the engine's post-action state, `action` what was applied, `events` the events so far.
   * Return a replacement `{ state, events }` to amend the transition, or `null` to leave it as-is.
   * Running before the win check means any VP a hook adds (island chits) counts toward THIS action's
   * win. No-op for a base game (no modules active) — base behavior stays bit-identical (RK-13).
   */
  afterAction?(
    prev: GameState,
    next: GameState,
    action: Action,
    events: readonly GameEvent[],
    actingSeat: Seat
  ): { state: GameState; events: GameEvent[] } | null;
}

/**
 * A single expansion (or T-901 modifier) module. All fields optional except `id`; a module
 * contributes only the hooks it needs. T-601 uses `boardLayout`/`boardGeometry`/`boardParams`/
 * `constants`; T-602 adds the extra-build rule via `phaseHandlers`/`phaseHooks`/`interceptAction`/
 * `isActorAllowed`/`winCheckSeat` (all consulted generically by `reduce` — the base engine never
 * names an expansion phase inline, so with no modules active every hook path is skipped and base
 * behavior is bit-identical, RK-13). T-901 modifiers are RuleModules too — `id` widens to
 * `ModifierId` so a modifier (e.g. `customTargetVp`) can sit in the same `RuleModule[]` that
 * `resolveModules` builds, appended after the active expansion module(s).
 */
export interface RuleModule {
  id: ExpansionId | ModifierId;
  /** Parametric board shape (docs/03 §1) — new boards are pure data, not geometry code. */
  boardLayout?: BoardLayout;
  /** Geometry built from `boardLayout`, precomputed at module load (deep-frozen). */
  boardGeometry?: BoardGeometry;
  /** Terrain/token/harbor multisets for this board (docs/10 §4). */
  boardParams?: ModuleBoardParams;
  /** Overrides folded over the base constants at `createGame` (docs/03 §8). */
  constants?: Partial<ModuleConstants>;
  /** Handlers for Phase kinds this module owns, keyed by `Phase['kind']`. `reduce` routes any phase
   *  the base `PHASE_HANDLERS` doesn't cover through here. */
  phaseHandlers?: Readonly<Record<string, ModulePhaseHandler>>;
  /** Turn-flow hooks (docs/10 §3). */
  phaseHooks?: PhaseHooks;
  /**
   * Pre-routing interception: called before `reduce` dispatches `action`. Return an `EngineResult`
   * to fully handle (or reject) the action, or `null` to fall through to normal routing. Used to
   * restrict actions inside a base phase the module has repurposed (e.g. blocking player trades and
   * redirecting the end action during a Paired-Players partial turn).
   */
  interceptAction?(state: GameState, seat: Seat, action: Action): EngineResult | null;
  /**
   * Extends the base actor guard: return `true` if `seat` may submit `action` on `state` even though
   * they are not the base turn owner (e.g. the current SBP builder). Base turn-owner/`discard`/
   * `respondTrade` rights always apply regardless — this only ADDS eligibility.
   */
  isActorAllowed?(state: GameState, seat: Seat, action: Action): boolean;
  /**
   * Overrides which seat (if any) the win-check evaluates after a transition. `prev`/`next` are the
   * pre/post-action states, `actingSeat` the actor, `baseWinSeat` the seat the base engine would
   * check (its incoming turn owner, or `null`). Return a `Seat` to win-check, or `null` to suppress
   * (e.g. no win during an SBP, but the paired "player 2" may win on their own partial turn).
   */
  winCheckSeat?(
    prev: GameState,
    next: GameState,
    actingSeat: Seat,
    baseWinSeat: Seat | null
  ): Seat | null;
}
