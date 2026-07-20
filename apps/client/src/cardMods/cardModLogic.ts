// cardModLogic.ts — pure view -> UI-decision logic for the `cardMods` modifier's play surfaces
// (Phase-9 play-UI follow-up, docs/tasks/FOLLOWUPS.md). Split from the panel/dialog components for
// the same reason `devcards/devCardLogic.ts` is split from `DevCardsPanel.tsx` (docs/12): pure
// functions over a `PlayerView` are cheap to assert on directly, no store/render harness needed.
//
// Two families here, mirroring `packages/engine/src/modules/modifiers/cardMods/{newCards,comboCards}.ts`:
//   - the 6 curated new dev-card TYPES (mixed into the base dev-card hand, played via
//     `playCardModCard`) — gating reuses the engine's own `commonPlayBlockReason` (R9.3/R9.4), the
//     exact same guard the base 4 dev cards use, now exported from `@hexhaven/engine` for this purpose.
//   - the 5 combo "special plays" (never held in hand; each CONSUMES existing base dev cards via
//     `playCardModCombo`) — gating checks each component card's OWN `commonPlayBlockReason`.
//
// Target enumeration (trailblazer's edge, highwayman/nightOfPlenty/rideByNight's hex, rideByNight/
// monorail's road spot(s), megaKnight's opponent, superSettle's settlement): no engine enumerator
// exists for these cardMods-specific shapes (unlike Cities & Knights' `wallEligibleCities` etc.), so
// this file computes them from the redacted `PlayerView`'s already-public fields (board/geometry/
// players), the same "documented v1: computed client-side, engine validates" discipline
// `citiesKnights/ProgressCardDialogs.tsx`'s header comment describes for its own board-target lists.
import { commonPlayBlockReason, legalRoadEdges } from '@hexhaven/engine';
import type { GameState, OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { CardModComboId, CardModDevCardId, EdgeId, HexId, Seat, VertexId } from '@hexhaven/shared';
import { boardGeometryFor } from '../board/geometry';

export type CardModPlayReason =
  | 'notYourTurn'
  | 'wrongPhase'
  | 'alreadyPlayed'
  | 'boughtThisTurn'
  | 'cardNotHeld'
  | 'noLegalTargets'
  | 'cantAfford';

export interface CardModPlayState {
  playable: boolean;
  reason?: CardModPlayReason;
  /** Only set alongside `reason: 'cantAfford'` (coordinator follow-up, mirrors `ckActionLogic.ts`'s
   *  `CkControlState`): what's short and by how much. */
  missing?: { type: string; need: number; have: number };
}

/** R4.1: dev-card (and cardMods combo) plays are legal in both `preRoll` and `main` — never gate on
 *  "hasn't rolled yet" (matches `devCardLogic.ts`'s own `PLAY_PHASES`). */
const PLAY_PHASES = new Set(['preRoll', 'main']);

function mapBlockReason(reason: 'CARD_NOT_HELD' | 'DEV_ALREADY_PLAYED' | 'DEV_BOUGHT_THIS_TURN'): CardModPlayReason {
  if (reason === 'DEV_ALREADY_PLAYED') return 'alreadyPlayed';
  if (reason === 'DEV_BOUGHT_THIS_TURN') return 'boughtThisTurn';
  return 'cardNotHeld';
}

function ownPlayerOf(view: PlayerView, seat: Seat): OwnPlayerView | undefined {
  return view.players.find((p): p is OwnPlayerView => p.seat === seat && 'devCards' in p);
}

/** The 6 curated new dev-card types (T-904): base ownership/phase gate, then the same
 *  `commonPlayBlockReason` guard the base 4 dev cards use, plus a target-availability/affordability
 *  check for the two cards whose Play button must never open a dead-end dialog/board-pick
 *  (coordinator follow-up — mirrors `ckActionLogic.ts`'s `compute*State` discipline exactly):
 *  Trailblazer needs a free road PIECE left (its edge list has no supply gate of its own, unlike
 *  `legalRoadEdges`); Merchant's Boon needs ≥2 of SOME resource to ever complete its 2:1 trade (the
 *  exact give resource is chosen inside its dialog, so only the "could this possibly complete at
 *  all" gate is checkable here). */
export function computeCardModCardPlayState(view: PlayerView, seat: Seat, card: CardModDevCardId): CardModPlayState {
  if (view.turn.player !== seat) return { playable: false, reason: 'notYourTurn' };
  if (!PLAY_PHASES.has(view.phase.kind)) return { playable: false, reason: 'wrongPhase' };

  // WIRE: T-204 precedent (devCardLogic.ts/ckHelpers.ts) — legal-move enumeration is inherently
  // about the ACTING seat's own choices, which redaction never hides from that seat.
  const state = view as unknown as GameState;
  const reason = commonPlayBlockReason(state, seat, card);
  if (reason !== null) return { playable: false, reason: mapBlockReason(reason) };

  if (card === 'trailblazer') {
    const own = ownPlayerOf(view, seat);
    if (!own || own.piecesLeft.roads <= 0 || unoccupiedEdges(view).length === 0) {
      return { playable: false, reason: 'noLegalTargets' };
    }
  }
  if (card === 'merchantsBoon') {
    const own = ownPlayerOf(view, seat);
    const best = own ? Math.max(0, ...Object.values(own.resources)) : 0;
    if (best < 2) {
      return { playable: false, reason: 'cantAfford', missing: { type: 'any', need: 2, have: best } };
    }
  }
  return { playable: true };
}

/** The base dev cards each combo CONSUMES — the "combination" a player must HOLD for the special
 *  play to be possible at all. Mirrors the `need(...)`/knight-count requirements in
 *  `computeComboPlayState` below (kept as one table so the two can't drift). */
const COMBO_COMPONENTS: Record<
  CardModComboId,
  Partial<Record<'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly' | 'victoryPoint', number>>
> = {
  rideByNight: { knight: 1, roadBuilding: 1 },
  nightOfPlenty: { knight: 1, yearOfPlenty: 1 },
  monorail: { monopoly: 1, roadBuilding: 1 },
  megaKnight: { knight: 2 },
  superSettle: { victoryPoint: 1 },
};

/** Whether `own` HOLDS the component dev cards a combo consumes — the panel's VISIBILITY gate, so a
 *  special play is listed only once its combination is actually in hand (playtest: "show Ride by
 *  Night only if I have Knight and Road Building"). Ownership only — finer conditions (turn/phase/
 *  legal target/bought-this-turn) still gate the Play BUTTON via `computeComboPlayState`, so a held
 *  combo can still appear disabled with a reason. */
export function comboComponentsHeld(own: OwnPlayerView, combo: CardModComboId): boolean {
  return Object.entries(COMBO_COMPONENTS[combo]).every(
    ([type, n]) => own.devCards.filter((c) => c.type === type).length >= (n ?? 0),
  );
}

/** The 5 combo "special plays" (T-904): each combo validates its OWN component base cards via the
 *  same `commonPlayBlockReason` guard the engine's `comboCards.ts` effects call directly, plus a
 *  target-availability check so a combo whose only remaining requirement is "somewhere legal to
 *  build/steal/upgrade" never opens a dead-end dialog either. */
export function computeComboPlayState(view: PlayerView, seat: Seat, combo: CardModComboId): CardModPlayState {
  if (view.turn.player !== seat) return { playable: false, reason: 'notYourTurn' };
  if (!PLAY_PHASES.has(view.phase.kind)) return { playable: false, reason: 'wrongPhase' };
  const state = view as unknown as GameState;

  function need(type: 'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly'): CardModPlayReason | null {
    const r = commonPlayBlockReason(state, seat, type);
    return r ? mapBlockReason(r) : null;
  }

  switch (combo) {
    case 'rideByNight': {
      const reason = need('knight') ?? need('roadBuilding');
      if (reason) return { playable: false, reason };
      return legalRoadEdgesAnyPhase(view, seat).length > 0
        ? { playable: true }
        : { playable: false, reason: 'noLegalTargets' };
    }
    case 'nightOfPlenty': {
      const reason = need('knight') ?? need('yearOfPlenty');
      return reason ? { playable: false, reason } : { playable: true };
    }
    case 'monorail': {
      const reason = need('monopoly') ?? need('roadBuilding');
      if (reason) return { playable: false, reason };
      return legalRoadEdgesAnyPhase(view, seat).length > 0
        ? { playable: true }
        : { playable: false, reason: 'noLegalTargets' };
    }
    case 'megaKnight': {
      const reason = need('knight');
      if (reason) return { playable: false, reason };
      if (playableKnightCount(view, seat) < 2) return { playable: false, reason: 'cardNotHeld' };
      return megaKnightTargets(view, seat).length > 0
        ? { playable: true }
        : { playable: false, reason: 'noLegalTargets' };
    }
    case 'superSettle': {
      const own = view.players.find((p): p is OwnPlayerView => p.seat === seat && 'devCards' in p);
      if (!own || !own.devCards.some((c) => c.type === 'victoryPoint')) {
        return { playable: false, reason: 'cardNotHeld' };
      }
      return superSettleVertices(own).length > 0 ? { playable: true } : { playable: false, reason: 'noLegalTargets' };
    }
    default: {
      const exhaustive: never = combo;
      return exhaustive;
    }
  }
}

/** Mirrors `cardMods/shared.ts`'s `isPlayable`: waived by the `playDevSameTurn` modifier
 *  (`view.config.modifiers?.playDevSameTurn` is exactly `resolveConstants(...).allowDevCardSameTurnPlay`
 *  for that modifier — see `packages/engine/src/modules/modifiers/playDevSameTurn.ts`'s header). */
function isCopyPlayable(view: PlayerView, boughtOnTurn: number): boolean {
  return Boolean(view.config.modifiers?.playDevSameTurn) || boughtOnTurn !== view.turn.number;
}

/** How many of the seat's held Knight cards are individually playable right now — Mega Knight needs
 *  2 (not just "at least 1", which `commonPlayBlockReason` alone would confirm). */
function playableKnightCount(view: PlayerView, seat: Seat): number {
  const own = view.players.find((p): p is OwnPlayerView => p.seat === seat && 'devCards' in p);
  if (!own) return 0;
  return own.devCards.filter((c) => c.type === 'knight' && isCopyPlayable(view, c.boughtOnTurn)).length;
}

// ---- Target enumerators (documented v1: computed client-side from public view fields) -----------

/** Every edge on the board no seat currently occupies with a road (or, in a Seafarers game, a ship)
 *  — trailblazer's only requirement (no connectivity rule at all). */
export function unoccupiedEdges(view: PlayerView): EdgeId[] {
  const geometry = boardGeometryFor(view.config);
  const occupied = new Set<EdgeId>();
  for (const p of view.players) for (const e of p.roads) occupied.add(e);
  const ships = view.ext?.seafarers?.ships;
  if (ships) for (const list of ships) for (const e of list) occupied.add(e);
  return geometry.edges.map((e) => e.id).filter((id) => !occupied.has(id));
}

/** Every hex on the board except the robber's current one — highwayman/nightOfPlenty/rideByNight's
 *  robber-move target (no seafarers/lock restriction: the engine effect itself has none). */
export function hexChoicesExceptRobber(view: PlayerView): HexId[] {
  return view.board.hexes.map((_, id) => id as HexId).filter((id) => id !== view.board.robber);
}

/**
 * Legal free-road spots for `seat`, independent of the CURRENT phase — `legalRoadEdges` (engine,
 * exported) is deliberately `main`-only (it backs the normal build-a-road action), but a cardMods
 * combo may legally be played in `preRoll` too (R4.1). Occupancy/connectivity themselves don't
 * depend on which sub-phase is active (only the phase GATE inside `legalRoadEdges` does), so
 * forcing `phase.kind` to `'main'` for this one read-only computation is safe — documented v1
 * client-side trick rather than growing the engine's public surface with a phase-agnostic twin.
 */
export function legalRoadEdgesAnyPhase(view: PlayerView, seat: Seat): EdgeId[] {
  const state = { ...(view as unknown as GameState), phase: { kind: 'main' as const } };
  return legalRoadEdges(state, seat);
}

/** Mega Knight's legal targets: every OTHER seat holding at least 1 development card (their identity
 *  is hidden, but `devCardCount` — same public field `masterMerchantSeats`-style pickers use — is
 *  not). */
export function megaKnightTargets(view: PlayerView, seat: Seat): Seat[] {
  return view.players
    .filter((p) => p.seat !== seat)
    .filter((p) => ('devCards' in p ? p.devCards.length : p.devCardCount) > 0)
    .map((p) => p.seat);
}

/** Super-Settle's legal targets: the seat's own settlements, gated on a city piece being left in
 *  supply (mirrors `effectSuperSettle`'s own `NO_PIECES_LEFT` guard). */
export function superSettleVertices(own: OwnPlayerView): VertexId[] {
  if (own.piecesLeft.cities <= 0) return [];
  return [...own.settlements];
}

/**
 * Robber Bride-style adjacency (reused by `helpers/helpersLogic.ts` for that helper's own steal
 * target list — kept here since both need "who touches this hex" over the same public geometry/
 * board fields, and cardMods has no equivalent card, so this is a general-purpose export, not a
 * cardMods-specific one despite living in this file). Every OTHER seat with a settlement/city
 * touching `hex`, in seat order (no de-duplication needed — `Set` handles a seat with 2 touching
 * buildings on the same hex).
 */
export function seatsAdjacentToHex(view: PlayerView, hex: HexId, exclude: Seat): Seat[] {
  const geometry = boardGeometryFor(view.config);
  const h = geometry.hexes[hex];
  if (!h) return [];
  const owners = new Set<Seat>();
  for (const vid of h.vertices) {
    for (const p of view.players) {
      if (p.seat === exclude) continue;
      if (p.settlements.includes(vid) || p.cities.includes(vid)) owners.add(p.seat);
    }
  }
  return [...owners];
}
