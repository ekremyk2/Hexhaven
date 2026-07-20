// devCardLogic.ts — pure view -> UI-decision logic for the dev-cards panel (T-406). Kept separate
// from DevCardsPanel.tsx for the same reason controls/actionBarLogic.ts is split from ActionBar.tsx
// (docs/12): effects/store hooks don't run under `renderToStaticMarkup` (this workspace's test
// render), so everything worth asserting on lives here as plain functions over a `PlayerView`.
//
// WIRE: T-204 note (matches actionBarLogic.ts/robberLogic.ts precedent): `computeDevPlayState`
// casts the redacted `PlayerView` to a full engine `GameState` to reuse `playableDevCards`
// (legal.ts) — legal-move enumeration is inherently about the ACTING seat's own choices, which
// redaction is not expected to hide from that seat.
import { playableDevCards } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import { hasAtLeast } from '@hexhaven/shared';
import type { AnyDevCardId, GameState, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';

export type PlayableDevCardType = 'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';

/** Display/iteration order used everywhere in this panel — knights first (most commonly held and
 * played), Victory Point last (never played, R9.8). */
export const PLAYABLE_TYPES: readonly PlayableDevCardType[] = [
  'knight',
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
];

/** Every reason a "Play" button can be disabled (task requirement 1's tooltip copy: "Bought this
 * turn" R9.4, "Already played a card" R9.3, "Not your turn", "No road pieces" ER-5, "Bank empty"
 * ER-6). `wrongPhase`/`cardNotHeld` cover the two cases the task doesn't enumerate but the engine
 * can still produce (a sub-phase mid-resolution; a type not currently held at all). */
export type DevPlayReason =
  | 'notYourTurn'
  | 'wrongPhase'
  | 'alreadyPlayed'
  | 'boughtThisTurn'
  | 'cannotPlay'
  | 'bankEmpty'
  | 'cardNotHeld';

export interface DevPlayState {
  playable: boolean;
  reason?: DevPlayReason;
}

/** R4.1: the four "play" actions are legal in BOTH `preRoll` and `main` — never gate on "hasn't
 * rolled yet" (task requirement 1 explicitly calls this out: "ensure preRoll plays work!"). */
const PLAY_PHASES = new Set(['preRoll', 'main']);

/**
 * Requirement 1: playability of `type` for `seat` right now. Turn ownership and phase are checked
 * HERE (not by `playableDevCards`, which is deliberately phase/turn-agnostic — see legal.ts's own
 * doc comment) because the reduce.ts pre-guard rejects a non-owner's action, and phases/roll.ts +
 * phases/main.ts are the only two routers that wire these actions at all (any other phase would
 * fail WRONG_PHASE before ever reaching devCards.ts's own guards).
 */
export function computeDevPlayState(view: PlayerView, seat: Seat, type: PlayableDevCardType): DevPlayState {
  if (view.turn.player !== seat) return { playable: false, reason: 'notYourTurn' };
  if (!PLAY_PHASES.has(view.phase.kind)) return { playable: false, reason: 'wrongPhase' };

  // WIRE: T-204 — see this module's header note.
  const state = view as unknown as GameState;
  const result = playableDevCards(state, seat)[type];
  if (result.playable) return { playable: true };

  switch (result.reason) {
    case 'DEV_ALREADY_PLAYED':
      return { playable: false, reason: 'alreadyPlayed' };
    case 'DEV_BOUGHT_THIS_TURN':
      return { playable: false, reason: 'boughtThisTurn' };
    case 'CANNOT_PLAY':
      return { playable: false, reason: 'cannotPlay' };
    case 'BANK_EMPTY':
      return { playable: false, reason: 'bankEmpty' };
    case 'CARD_NOT_HELD':
    default:
      return { playable: false, reason: 'cardNotHeld' };
  }
}

export interface DevCardGroup {
  type: AnyDevCardId;
  count: number;
  /** True when EVERY held instance of this type was bought this turn (R9.4/R9.8's "NEW" badge),
   * matching `hud/Hand.tsx`'s per-instance NEW check folded to the group level. */
  isNew: boolean;
}

// T-904 (cardMods modifier): the 6 curated new dev-card types are appended after the base 5 — this
// panel groups/displays them (i18n keys added to devcards.json) but has no Play button for them yet
// (PLAYABLE_TYPES above stays the base 4); a targeting-dialog UI for them is a follow-up task.
const DISPLAY_ORDER: readonly AnyDevCardId[] = [
  'knight',
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
  'victoryPoint',
  'bumperCrop',
  'merchantsBoon',
  'roadToll',
  'trailblazer',
  'windfall',
  'highwayman',
];

/**
 * Groups the viewer's own hand by card type — one row per type, not per instance. Play-eligibility
 * (`commonPlayBlockReason`, legal.ts) is inherently per-TYPE, not per-copy: the engine doesn't ask
 * which specific copy to spend (`beginPlay` picks any playable one), so a per-instance button would
 * either lie (one copy "playable", an identical one not) or invent a choice that doesn't exist.
 */
export function groupDevCards(
  own: { devCards: { type: AnyDevCardId; boughtOnTurn: number }[] },
  turnNumber: number,
): DevCardGroup[] {
  const groups: DevCardGroup[] = [];
  for (const type of DISPLAY_ORDER) {
    const cards = own.devCards.filter((c) => c.type === type);
    if (cards.length === 0) continue;
    groups.push({ type, count: cards.length, isNew: cards.every((c) => c.boughtOnTurn === turnNumber) });
  }
  return groups;
}

export interface RoadBuildingBannerState {
  // Normally 1|2 (R9.6/ER-5's base 2-road allowance) but widens to any positive integer under the
  // `customConstants` modifier's `roadBuildingCount` tunable (T-906, docs/07 D-034) — mirrors
  // `Phase`'s `roadBuilding.remaining` field (packages/shared/src/types.ts).
  remaining: number;
}

/**
 * Requirement 3: the Road Building progress banner's data — `null` outside the sub-phase, or when
 * it isn't the mover's own decision (mirrors `robberLogic.ts`'s `shouldAutoEnterMovingRobber`). The
 * `roadBuilding` phase only ever carries `remaining` (no original total is stored anywhere in
 * `GameState`), so the banner counts DOWN ("N more free roads"), not "1 of N" — a deliberate
 * deviation from the task file's literal example text; see this task's Implementation notes.
 */
export function computeRoadBuildingBanner(view: PlayerView, seat: Seat): RoadBuildingBannerState | null {
  if (view.phase.kind !== 'roadBuilding' || view.turn.player !== seat) return null;
  return { remaining: view.phase.remaining };
}

/** ER-6 (task requirement 4): is the FIRST Year of Plenty pick currently bank-blocked? */
export function yopFirstPickDisabled(bank: Record<ResourceType, number>, candidate: ResourceType): boolean {
  return bank[candidate] < 1;
}

/** ER-6: is the SECOND pick blocked, given the first pick `firstPick` (`null` = not chosen yet)?
 * Picking the same type twice needs 2 of it in the bank, not 1. */
export function yopSecondPickDisabled(
  bank: Record<ResourceType, number>,
  firstPick: ResourceType | null,
  candidate: ResourceType,
): boolean {
  const need = candidate === firstPick ? 2 : 1;
  return bank[candidate] < need;
}

/** ER-6: may the confirm button fire — both picked, and the bank can actually supply both (reuses
 * the engine's own `hasAtLeast` rather than re-deriving the same arithmetic a second way). */
export function yopCanConfirm(bank: Record<ResourceType, number>, a: ResourceType | null, b: ResourceType | null): boolean {
  if (a == null || b == null) return false;
  const need: ResourceBundle = {};
  need[a] = (need[a] ?? 0) + 1;
  need[b] = (need[b] ?? 0) + 1;
  return hasAtLeast(bank, need);
}

// ---------------------------------------------------------------------------------------------
// Phase-9 play-UI follow-up (docs/tasks/FOLLOWUPS.md "Year-of-Plenty count > 2"): the engine has
// supported an N-resource Year of Plenty since T-906 (`customConstants.yearOfPlentyCount`, the
// `playYearOfPlenty` action's `extra` field), but this dialog only ever exposed the base 2 picks.
// These generalize `yopFirstPickDisabled`/`yopSecondPickDisabled`/`yopCanConfirm` above (kept
// unchanged, still exercised directly by `devCardLogic.test.ts`, and still what the dialog uses
// for the base 2-pick case) to an arbitrary pick COUNT, so the same "same type twice needs 2 in the
// bank" arithmetic holds for any number of picks, not just exactly 2.
// ---------------------------------------------------------------------------------------------

/** The effective Year of Plenty pick count for this game: the base 2 (R9.7) unless the
 *  `customConstants` modifier overrides it (T-906). Base/every-other-modifier game: always 2. */
export function resolveYearOfPlentyCount(view: PlayerView): number {
  return view.config.modifiers?.customConstants?.yearOfPlentyCount ?? 2;
}

/** The effective Road Building free-road count for this game: the base 2 (R9.6) unless the
 *  `customConstants` modifier overrides it (T-906, `roadBuildingCount`). Used to keep the card's
 *  DESCRIPTION honest ("Build N roads") — the engine already honors the override at play time. */
export function resolveRoadBuildingCount(view: PlayerView): number {
  return view.config.modifiers?.customConstants?.roadBuildingCount ?? 2;
}

/** ER-6, generalized to N picks: is `candidate` bank-blocked as the pick at `index`, given the
 *  OTHER picks already made (`picks[index]` itself is ignored)? Picking a type K times total needs
 *  K of it in the bank, not 1 — mirrors `yopSecondPickDisabled`'s reasoning for any pick count. */
export function yopPickDisabledAt(bank: Record<ResourceType, number>, picks: readonly (ResourceType | null)[], index: number, candidate: ResourceType): boolean {
  const alreadyPicked = picks.filter((r, i) => i !== index && r === candidate).length;
  return bank[candidate] < alreadyPicked + 1;
}

/** ER-6, generalized: may the confirm button fire — every pick made, and the bank can supply the
 *  full multiset (reuses `hasAtLeast`, same discipline as `yopCanConfirm`). */
export function yopCanConfirmN(bank: Record<ResourceType, number>, picks: readonly (ResourceType | null)[]): boolean {
  if (picks.some((r) => r == null)) return false;
  const need: ResourceBundle = {};
  for (const r of picks) need[r as ResourceType] = (need[r as ResourceType] ?? 0) + 1;
  return hasAtLeast(bank, need);
}
