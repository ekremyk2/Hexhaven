// Cities & Knights action-control logic (T-806 Priority 2): pure enablement/reason helpers for the
// buy/build buttons, mirroring `controls/actionBarLogic.ts`'s split exactly — a presentational
// component only ever calls into this module, never re-derives legality itself. Every helper treats
// `view` as a full `GameState` for legal-target enumeration (same documented WIRE workaround
// `store/uiMode.ts`/`actionBarLogic.ts` use: legal-move enumeration is about the ACTING seat's own
// choices, which redaction never hides from that seat).
import {
  chaseRobberKnights,
  displaceableKnights,
  legalKnightVertices,
  movableKnights,
  TRACK_COMMODITY,
  wallEligibleCities,
} from '@hexhaven/engine';
import type { GameState, PlayerView } from '@hexhaven/engine';
import { ckImprovementCost } from '@hexhaven/shared';
import type { Commodity, ImprovementTrack, Seat } from '@hexhaven/shared';
import { ckOf, promotableKnightVertices } from './ckHelpers';

export type CkControlReason =
  | 'cantAfford'
  | 'noCityOwned'
  | 'maxLevel'
  | 'noLegalTargets'
  | 'notMainPhase'
  | 'notYourTurn'
  | 'robberLocked'
  // Specific per-action "no legal target" reasons (playtest fix: a bare "no legal targets right
  // now" reads as broken/mysterious for knight actions with an obvious physical requirement — each
  // of these names exactly what's missing, mirroring the engine's own gate for that action).
  | 'noKnightSpot'
  | 'noInactiveKnight'
  | 'noPromotableKnight'
  | 'noMovableKnight'
  | 'noDisplaceableKnight'
  | 'noKnightNextToRobber'
  | 'noEligibleCity';

export interface CkControlState {
  enabled: boolean;
  reason?: CkControlReason;
  /** Only set alongside `reason: 'cantAfford'` — what's short and by how much. */
  missing?: { type: Commodity | 'brick' | 'wool' | 'ore' | 'grain'; need: number; have: number };
}

const ENABLED: CkControlState = { enabled: true };

const KNIGHT_BUILD_COST = { wool: 1, ore: 1 } as const;
const KNIGHT_ACTIVATE_COST = { grain: 1 } as const;
const KNIGHT_PROMOTE_COST = { wool: 1, ore: 1 } as const;
const WALL_COST = { brick: 2 } as const;

/** Improvement track buy button (C4.2/C4.3): not in `main` -> `notMainPhase`; no city ->
 *  `noCityOwned`; already level 5 -> `maxLevel`; can't afford the next level's commodity cost ->
 *  `cantAfford`; else enabled. */
export function computeImprovementState(view: PlayerView, seat: Seat, track: ImprovementTrack): CkControlState {
  const state = view as unknown as GameState;
  const ck = ckOf(view);
  if (!ck) return { enabled: false };
  // Turn ownership first (mirrors devCardLogic.ts's computeDevPlayState): every action gated by this
  // module is turn-owner-only (B-27/B-28 fix — `phase.kind === 'main'` alone is true for every
  // viewer during the turn owner's main phase, not just the owner).
  if (state.turn.player !== seat) return { enabled: false, reason: 'notYourTurn' };
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notMainPhase' };
  const player = state.players[seat];
  if (!player || player.cities.length === 0) return { enabled: false, reason: 'noCityOwned' };
  const level = ck.improvements[seat]?.[track] ?? 0;
  if (level >= 5) return { enabled: false, reason: 'maxLevel' };
  const cost = ckImprovementCost((level + 1) as 1 | 2 | 3 | 4 | 5);
  const commodity = TRACK_COMMODITY[track];
  const have = ck.commodities[seat]?.[commodity] ?? 0;
  if (have < cost) {
    return { enabled: false, reason: 'cantAfford', missing: { type: commodity, need: cost, have } };
  }
  return ENABLED;
}

/** Build-knight button (C7.1/C7.2): not in `main` -> `notMainPhase`; no legal vertex (cap or no
 *  connectivity) -> `noKnightSpot`; can't afford 1 wool + 1 ore -> `cantAfford`; else enabled.
 *  Legal-target supply is checked BEFORE affordability, mirroring `computeBuildShipState`. */
export function computeBuildKnightState(view: PlayerView, seat: Seat): CkControlState {
  const state = view as unknown as GameState;
  if (!ckOf(view)) return { enabled: false };
  if (state.turn.player !== seat) return { enabled: false, reason: 'notYourTurn' };
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notMainPhase' };
  if (legalKnightVertices(state, seat).length === 0) return { enabled: false, reason: 'noKnightSpot' };
  const player = state.players[seat]!;
  if (player.resources.wool < KNIGHT_BUILD_COST.wool) {
    return { enabled: false, reason: 'cantAfford', missing: { type: 'wool', need: KNIGHT_BUILD_COST.wool, have: player.resources.wool } };
  }
  if (player.resources.ore < KNIGHT_BUILD_COST.ore) {
    return { enabled: false, reason: 'cantAfford', missing: { type: 'ore', need: KNIGHT_BUILD_COST.ore, have: player.resources.ore } };
  }
  return ENABLED;
}

/** Activate-knight button (C7.2): legal target = any inactive knight; afford = 1 grain. */
export function computeActivateKnightState(view: PlayerView, seat: Seat): CkControlState {
  const state = view as unknown as GameState;
  const ck = ckOf(view);
  if (!ck) return { enabled: false };
  if (state.turn.player !== seat) return { enabled: false, reason: 'notYourTurn' };
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notMainPhase' };
  const hasInactive = (ck.knights[seat] ?? []).some((k) => !k.active);
  if (!hasInactive) return { enabled: false, reason: 'noInactiveKnight' };
  const player = state.players[seat]!;
  if (player.resources.grain < KNIGHT_ACTIVATE_COST.grain) {
    return { enabled: false, reason: 'cantAfford', missing: { type: 'grain', need: KNIGHT_ACTIVATE_COST.grain, have: player.resources.grain } };
  }
  return ENABLED;
}

/** Promote-knight button (C7.2/C7.3): legal target = any knight below max level (Fortress-gated for
 *  strong->mighty) AND whose target level isn't already at the C7.1 cap (`CK_KNIGHT_CAP`); afford =
 *  1 wool + 1 ore. Bug fix: this used to only check `level < 3` + Fortress, so it enabled Promote
 *  (and offered a board target) even when every slot at the next level was full — the engine's
 *  `promoteKnight` then rejected with `KNIGHT_CAP`, a mystery "you're at the upper limit" toast for
 *  something the UI had just said was legal. Delegates to `promotableKnightVertices` (ckHelpers.ts)
 *  so the button gate and the board-highlight targets can never disagree (B-28 lesson: offer must
 *  equal engine legality). */
export function computePromoteKnightState(view: PlayerView, seat: Seat): CkControlState {
  const state = view as unknown as GameState;
  const ck = ckOf(view);
  if (!ck) return { enabled: false };
  if (state.turn.player !== seat) return { enabled: false, reason: 'notYourTurn' };
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notMainPhase' };
  if (promotableKnightVertices(ck, seat).length === 0) return { enabled: false, reason: 'noPromotableKnight' };
  const player = state.players[seat]!;
  if (player.resources.wool < KNIGHT_PROMOTE_COST.wool || player.resources.ore < KNIGHT_PROMOTE_COST.ore) {
    return {
      enabled: false,
      reason: 'cantAfford',
      missing: { type: 'wool', need: KNIGHT_PROMOTE_COST.wool, have: player.resources.wool },
    };
  }
  return ENABLED;
}

/** Move-knight button (C7.4): legal iff at least one active knight has a legal destination
 *  (B-28-style guard — `movableKnights` already only offers those). No cost. */
export function computeMoveKnightState(view: PlayerView, seat: Seat): CkControlState {
  const state = view as unknown as GameState;
  if (!ckOf(view)) return { enabled: false };
  if (state.turn.player !== seat) return { enabled: false, reason: 'notYourTurn' };
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notMainPhase' };
  return movableKnights(state, seat).length === 0 ? { enabled: false, reason: 'noMovableKnight' } : ENABLED;
}

/** Displace-knight button (C7.4): legal iff at least one active knight has a legal (strictly weaker
 *  opponent) target. No cost. */
export function computeDisplaceKnightState(view: PlayerView, seat: Seat): CkControlState {
  const state = view as unknown as GameState;
  if (!ckOf(view)) return { enabled: false };
  if (state.turn.player !== seat) return { enabled: false, reason: 'notYourTurn' };
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notMainPhase' };
  return displaceableKnights(state, seat).length === 0 ? { enabled: false, reason: 'noDisplaceableKnight' } : ENABLED;
}

/** Chase-the-robber button (C7.4/C10.2): robber must be unlocked (past the first attack) AND at
 *  least one active knight sits adjacent to it. No cost. */
export function computeChaseRobberState(view: PlayerView, seat: Seat): CkControlState {
  const state = view as unknown as GameState;
  const ck = ckOf(view);
  if (!ck) return { enabled: false };
  if (state.turn.player !== seat) return { enabled: false, reason: 'notYourTurn' };
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notMainPhase' };
  if (ck.robberLocked) return { enabled: false, reason: 'robberLocked' };
  return chaseRobberKnights(state, seat).length === 0 ? { enabled: false, reason: 'noKnightNextToRobber' } : ENABLED;
}

/** Build-city-wall button (C9.1): legal target = an unwalled city, under the `CK_MAX_WALLS` cap
 *  (`wallEligibleCities` already encodes both); afford = 2 brick. */
export function computeBuildWallState(view: PlayerView, seat: Seat): CkControlState {
  const state = view as unknown as GameState;
  if (!ckOf(view)) return { enabled: false };
  if (state.turn.player !== seat) return { enabled: false, reason: 'notYourTurn' };
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notMainPhase' };
  if (wallEligibleCities(state, seat).length === 0) return { enabled: false, reason: 'noEligibleCity' };
  const player = state.players[seat]!;
  if (player.resources.brick < WALL_COST.brick) {
    return { enabled: false, reason: 'cantAfford', missing: { type: 'brick', need: WALL_COST.brick, have: player.resources.brick } };
  }
  return ENABLED;
}
