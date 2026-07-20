// helpersLogic.ts — pure view -> UI-decision logic for "The Helpers of Hexhaven" modifier's HUD
// (Phase-9 play-UI follow-up, docs/tasks/FOLLOWUPS.md; engine: `packages/engine/src/modules/
// modifiers/helpers/**`, T-905). Mirrors `citiesKnights/ckHelpers.ts`'s split exactly: one file of
// store-agnostic lookups over the redacted `PlayerView`, so `HelpersHud.tsx`/`HelperDialogs.tsx`
// stay presentational.
//
// `view.ext.helpers` only exists once this task's `redact.ts` fix ships (it was never surfaced to
// the client before — see that fix's own header comment for why) — every function here degrades to
// "nothing to show" when it's absent, so a base/other-modifier game is completely unaffected (RK-13).
//
// Target enumeration follows the same "documented v1: computed client-side from public view fields,
// engine validates authoritatively" discipline `cardMods/cardModLogic.ts` uses (Explorer's `to`/
// Mendicant's edge reuse that file's `legalRoadEdgesAnyPhase`; Robber Bride reuses its
// `seatsAdjacentToHex`). Two helpers take a deliberately looser gate than perfect precision would
// need, documented at each: Explorer's `from` list is every one of the seat's own roads (not
// filtered for "is this actually a dead-end" — that graph check lives in `actions.ts`'s private
// `isTerminalRoad`, not exported) and Merchant's target list doesn't pre-check whether an opponent
// actually holds the demanded resource (hidden information) — both mirror Cities & Knights'
// `ProgressCardDialogs.tsx` precedent of "list what's plausible, let the engine reject the rest".
import type { OwnPlayerView, PlayerView } from '@hexhaven/engine';
import { legalCityVertices, legalSettlementVertices } from '@hexhaven/engine';
import type { EdgeId, GameState, HelperId, ResourceType, Seat, VertexId } from '@hexhaven/shared';
import { publicVpInView } from '../citiesKnights/ckHelpers';
import { legalRoadEdgesAnyPhase, seatsAdjacentToHex } from '../cardMods/cardModLogic';

export type HelpersView = NonNullable<NonNullable<PlayerView['ext']>['helpers']>;

/** The public `ext.helpers` block, or `undefined` outside a game with this modifier active. */
export function helpersOf(view: PlayerView): HelpersView | undefined {
  return view.ext?.helpers;
}

/** `seat`'s current helper assignment, or `null` before their first deal / outside the modifier. */
export function assignmentOf(view: PlayerView, seat: Seat): HelpersView['bySeat'][number] {
  return helpersOf(view)?.bySeat[seat] ?? null;
}

export type HelperUseReason =
  | 'notYourTurn'
  | 'wrongPhase'
  | 'alreadyUsed'
  | 'justAcquired'
  | 'notEligible'
  | 'noLegalTargets'
  | 'cantAfford';

export interface HelperUseState {
  playable: boolean;
  reason?: HelperUseReason;
  /** Only set alongside `reason: 'cantAfford'` (coordinator follow-up, mirrors
   *  `ckActionLogic.ts`'s `CkControlState`): what's short and by how much. */
  missing?: { type: string; need: number; have: number };
}

/**
 * The common gate every `useHelper` action shares (mirrors `state.ts`'s `canUseHelper` exactly:
 * held + not used this rotation + not acquired this same turn) PLUS the two engine-side turn/phase
 * rules the client also needs to reflect: only Mayor may fire on another seat's turn (`index.ts`'s
 * `isActorAllowed` carve-out), and no helper fires during a 5-6 Special Building Phase.
 */
function commonBlockReason(view: PlayerView, seat: Seat, helper: HelperId): HelperUseReason | null {
  const ext = helpersOf(view);
  const held = ext?.bySeat[seat];
  if (!ext || !held || held.id !== helper) return 'notEligible';
  if (view.phase.kind === 'specialBuild') return 'wrongPhase';
  if (helper !== 'mayor' && view.turn.player !== seat) return 'notYourTurn';
  if (ext.usedThisTurn[seat]) return 'alreadyUsed';
  if (held.acquiredTurn === view.turn.number) return 'justAcquired';
  return null;
}

function ownPlayer(view: PlayerView, seat: Seat): OwnPlayerView | undefined {
  return view.players.find((p): p is OwnPlayerView => p.seat === seat && 'devCards' in p);
}

/**
 * Full playability of `helper` for `seat` right now: the common gate above, plus each helper's own
 * extra phase/eligibility rule (mirrors `actions.ts`'s per-function guards) and, where a dead-end
 * dialog is otherwise possible, a target-availability check (same discipline as
 * `cardModLogic.ts`'s `computeCardModCardPlayState`/`computeComboPlayState`).
 */
export function helperUseState(view: PlayerView, seat: Seat, helper: HelperId): HelperUseState {
  const common = commonBlockReason(view, seat, helper);
  if (common) return { playable: false, reason: common };

  switch (helper) {
    case 'mayor': {
      const eligible = helpersOf(view)?.mayorEligible[seat] ?? false;
      return eligible ? { playable: true } : { playable: false, reason: 'notEligible' };
    }
    case 'general':
      // Fully reactive (no `useHelper` variant exists for General) — never shown with a Use button.
      return { playable: false, reason: 'notEligible' };
    case 'explorer': {
      const own = ownPlayer(view, seat);
      return own && own.roads.length > 0 ? { playable: true } : { playable: false, reason: 'noLegalTargets' };
    }
    case 'mendicant': {
      const own = ownPlayer(view, seat);
      if (!own || own.piecesLeft.roads <= 0) return { playable: false, reason: 'noLegalTargets' };
      return legalRoadEdgesAnyPhase(view, seat).length > 0 ? { playable: true } : { playable: false, reason: 'noLegalTargets' };
    }
    case 'robberBride':
      return view.phase.kind === 'preRoll' || view.phase.kind === 'main' ? { playable: true } : { playable: false, reason: 'wrongPhase' };
    case 'merchant': {
      const anyOpponents = view.players.some((p) => p.seat !== seat);
      return anyOpponents ? { playable: true } : { playable: false, reason: 'noLegalTargets' };
    }
    case 'captain':
      return view.phase.kind === 'main' ? { playable: true } : { playable: false, reason: 'wrongPhase' };
    case 'noblewoman': {
      if (view.phase.kind !== 'main') return { playable: false, reason: 'wrongPhase' };
      return noblewomanTargets(view, seat).length > 0 ? { playable: true } : { playable: false, reason: 'noLegalTargets' };
    }
    case 'architect': {
      if (view.phase.kind !== 'main') return { playable: false, reason: 'wrongPhase' };
      return view.devDeckCount > 0 ? { playable: true } : { playable: false, reason: 'noLegalTargets' };
    }
    case 'priest': {
      if (view.phase.kind !== 'main') return { playable: false, reason: 'wrongPhase' };
      const own = ownPlayer(view, seat);
      if (!own || !own.devCards.some((c) => c.type === 'knight')) return { playable: false, reason: 'noLegalTargets' };
      const hasSettlementSpot = legalSettlementVertices(view as unknown as GameState, seat).length > 0;
      const hasCitySpot = own.settlements.length > 0 && own.piecesLeft.cities > 0;
      return hasSettlementSpot || hasCitySpot ? { playable: true } : { playable: false, reason: 'noLegalTargets' };
    }
    default: {
      const exhaustive: never = helper;
      return exhaustive;
    }
  }
}

/**
 * Board-click targeting follow-up: Priest's build choice is split into two dedicated board-pick
 * modes (settlement vertex / city vertex) instead of one dialog with a build-kind radio row, so each
 * gets its own gate — the common `helperUseState('priest')` check (holds Knight, phase, common
 * gate) PLUS this build kind's own target list AND its FIXED reduced cost (`usePriest`'s exact
 * values, C6.5-style discipline per the coordinator's Medicine follow-up): settlement = 1 brick + 1
 * lumber; city = 2 ore + 1 grain.
 */
export function priestBuildState(view: PlayerView, seat: Seat, build: 'settlement' | 'city'): HelperUseState {
  const base = helperUseState(view, seat, 'priest');
  if (!base.playable) return base;
  const own = ownPlayer(view, seat);
  if (!own) return { playable: false, reason: 'notEligible' };

  const targets = build === 'settlement' ? priestSettlementVertices(view, seat) : priestCityVertices(view, seat);
  if (targets.length === 0) return { playable: false, reason: 'noLegalTargets' };

  const cost: readonly (readonly [ResourceType, number])[] =
    build === 'settlement'
      ? [
          ['brick', 1],
          ['lumber', 1],
        ]
      : [
          ['ore', 2],
          ['grain', 1],
        ];
  for (const [type, need] of cost) {
    const have = own.resources[type];
    if (have < need) return { playable: false, reason: 'cantAfford', missing: { type, need, have } };
  }
  return { playable: true };
}

/** May `seat` swap their current helper for one in the display right now? Swapping needs the base
 *  actor guard (turn owner — `reduce.ts`'s pre-guard, no Mayor-style carve-out for `swapHelper`) and
 *  isn't blocked by `usedThisTurn`/`acquiredTurn` (research §3: swapping "does not spend a use"). */
export function canSwap(view: PlayerView, seat: Seat): boolean {
  if (view.phase.kind === 'specialBuild') return false;
  return view.turn.player === seat;
}

// ---- Target enumerators (documented v1, see this file's header) --------------------------------

/** Explorer's `from` choices: every one of the seat's own roads (not pre-filtered for "dead-end" —
 *  see header). */
export function explorerFromChoices(view: PlayerView, seat: Seat): EdgeId[] {
  return [...(ownPlayer(view, seat)?.roads ?? [])];
}

/** Explorer's `to` choices / Mendicant's `edge` choices: legal free-road spots, phase-independent
 *  (reuses `cardModLogic.ts`'s trick — see that function's own header for why this is safe). */
export function roadTargetChoices(view: PlayerView, seat: Seat): EdgeId[] {
  return legalRoadEdgesAnyPhase(view, seat);
}

/** Robber Bride's steal target(s): seats adjacent to the robber's CURRENT hex (the one it's about
 *  to vacate — the ability text is "take 1 resource from the hex it was on"). */
export function robberBrideTargets(view: PlayerView, seat: Seat): Seat[] {
  return seatsAdjacentToHex(view, view.board.robber, seat);
}

/** Noblewoman's legal targets: opponents with STRICTLY more public VP than `seat` (the same
 *  documented public-VP approximation `citiesKnights/ckHelpers.ts`'s `masterMerchantSeats` uses —
 *  the engine's real gate also counts each side's hidden VP cards, which a redacted view can't see
 *  for an opponent; the engine still validates `NOT_ELIGIBLE` authoritatively). */
export function noblewomanTargets(view: PlayerView, seat: Seat): Seat[] {
  const mine = publicVpInView(view, seat);
  return view.players.filter((p) => p.seat !== seat && publicVpInView(view, p.seat) > mine).map((p) => p.seat);
}

/** Priest's settlement targets (reduced-cost build, same distance/connectivity rule as a normal
 *  settlement). */
export function priestSettlementVertices(view: PlayerView, seat: Seat): VertexId[] {
  return legalSettlementVertices(view as unknown as GameState, seat);
}

/** Priest's city targets: the seat's own settlements, gated on a city piece being left in supply. */
export function priestCityVertices(view: PlayerView, seat: Seat): VertexId[] {
  const own = ownPlayer(view, seat);
  if (!own || own.piecesLeft.cities <= 0) return [];
  // `legalCityVertices` (engine, exported) is the authoritative "settlement I can upgrade" list —
  // reused rather than re-deriving `own.settlements` directly, since it already excludes any edge
  // case (e.g. a future rule) that isn't just "any of my settlements".
  return legalCityVertices(view as unknown as GameState, seat);
}
