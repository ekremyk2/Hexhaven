// Pure enablement logic for the ActionBar (T-403 requirement 1/6). Mirrors `store/uiMode.ts`'s
// split: pure functions here, directly testable against `@hexhaven/engine`'s own `legal.ts`
// enumerators/`buildAffordability`/`canRollDice`, and a thin presentational `ActionBar.tsx` that
// only calls into this module (never re-derives legality itself).
//
// WIRE: T-204 — same `PlayerView`-as-`GameState` cast `store/uiMode.ts` documents: legal-move
// enumeration is inherently about the ACTING seat's own choices, which redaction is not expected
// to hide from that seat, so this treats the view as a full engine `GameState`.
import {
  buildAffordability,
  canRollDice,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  legalShipEdges,
  movableShips,
} from '@hexhaven/engine';
import type { GameState, PlayerView } from '@hexhaven/engine';
import { COSTS } from '@hexhaven/shared';
import type { Phase, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import type { UiMode } from '../store/types';

/** S4.1: a ship costs 1 lumber + 1 wool. Mirrors the engine's `SHIP_COST` (not exported from the
 * package root); kept here alongside `COSTS` so the affordability tooltip can name the shortfall. */
const SHIP_COST: ResourceBundle = { lumber: 1, wool: 1 };

export type BuildKind = 'road' | 'settlement' | 'city';

/** Which `uiMode` a build button enters (requirement 1: "clicking a build enters the T-304
 * mode"). Exported so `ActionBar.tsx` and this module's tests share one source of truth. */
export const BUILD_MODE: Record<BuildKind, UiMode> = {
  road: 'placingRoad',
  settlement: 'placingSettlement',
  city: 'placingCity',
};

const PIECE_KEY: Record<BuildKind, 'roads' | 'settlements' | 'cities'> = {
  road: 'roads',
  settlement: 'settlements',
  city: 'cities',
};

/** Every non-affordability disable reason a control can carry (requirement 1's tooltip copy:
 * "No legal spots", "Deck empty", "Max cities", …). `cantAfford` is handled separately below
 * because its tooltip needs the actual missing-resource bundle ("Need 1 brick 1 lumber"). */
export type ControlReason =
  | 'cantAfford'
  | 'noLegalTargets'
  | 'maxRoads'
  | 'maxSettlements'
  | 'maxCities'
  | 'maxShips'
  | 'shipAlreadyMoved'
  | 'deckEmpty'
  | 'notRolledYet';

export interface ControlState {
  enabled: boolean;
  reason?: ControlReason;
  /** Only set alongside `reason: 'cantAfford'` — the resources still short of the cost bundle. */
  missing?: ResourceBundle;
}

const ENABLED: ControlState = { enabled: true };

const MAX_REASON: Record<BuildKind, ControlReason> = {
  road: 'maxRoads',
  settlement: 'maxSettlements',
  city: 'maxCities',
};

function legalTargetCount(kind: BuildKind, state: GameState, seat: Seat): number {
  switch (kind) {
    case 'road':
      return legalRoadEdges(state, seat).length;
    case 'settlement':
      return legalSettlementVertices(state, seat).length;
    case 'city':
      return legalCityVertices(state, seat).length;
    default: {
      const exhaustiveCheck: never = kind;
      return exhaustiveCheck;
    }
  }
}

/** Resources in `cost` the seat is still short of, e.g. `{ brick: 1 }` when they hold 0 of the 1
 * required — the data the "Need 1 brick 1 lumber" tooltip is built from. */
function missingResources(state: GameState, seat: Seat, cost: ResourceBundle): ResourceBundle {
  const player = state.players[seat];
  const missing: ResourceBundle = {};
  for (const [res, need] of Object.entries(cost) as [ResourceType, number][]) {
    const have = player?.resources[res] ?? 0;
    if (have < need) missing[res] = need - have;
  }
  return missing;
}

/**
 * Build-button enablement (requirement 1): out of supply -> "Max X"; can't afford -> "Need …";
 * no legal targets left -> "No legal spots"; otherwise enabled. Piece supply is checked before
 * affordability so a maxed-out player sees "Max cities", not a misleading cost complaint.
 */
export function computeBuildState(kind: BuildKind, view: PlayerView, seat: Seat): ControlState {
  const state = view as unknown as GameState;
  const player = state.players[seat];
  if (!player || player.piecesLeft[PIECE_KEY[kind]] <= 0) {
    return { enabled: false, reason: MAX_REASON[kind] };
  }

  const affordability = buildAffordability(state, seat);
  if (!affordability[kind]) {
    return { enabled: false, reason: 'cantAfford', missing: missingResources(state, seat, COSTS[kind]) };
  }

  if (legalTargetCount(kind, state, seat) === 0) return { enabled: false, reason: 'noLegalTargets' };
  return ENABLED;
}

/** Roll button (R4/ER-7: mandatory, exactly once per turn) — enabled only in `preRoll` before the
 * roll has happened; no tooltip needed for the disabled state (self-explanatory: already rolled,
 * or it isn't the roll step at all). */
export function computeRollState(view: PlayerView): ControlState {
  const state = view as unknown as GameState;
  return canRollDice(state) ? ENABLED : { enabled: false };
}

/** Buy dev card (R7.1/R9.1): legal in the `main` phase and — for the 5–6 extension — during the
 * `specialBuild` phase (X12 §6: an SBP builder may buy dev cards). No `legal.ts` target-list exists
 * for it (unlike builds), so the phase check lives here; then deck stock, then affordability. */
export function computeBuyDevCardState(view: PlayerView, seat: Seat): ControlState {
  const state = view as unknown as GameState;
  if (state.phase.kind !== 'main' && state.phase.kind !== 'specialBuild') {
    return { enabled: false, reason: 'notRolledYet' };
  }
  if (view.devDeckCount <= 0) return { enabled: false, reason: 'deckEmpty' };

  const missing = missingResources(state, seat, COSTS.devCard);
  if (Object.keys(missing).length > 0) return { enabled: false, reason: 'cantAfford', missing };
  return ENABLED;
}

/** End turn (R4.3): only ever legal in the `main` phase (rolling is mandatory first, ER-7). */
export function computeEndTurnState(view: PlayerView): ControlState {
  const state = view as unknown as GameState;
  return state.phase.kind === 'main' ? ENABLED : { enabled: false, reason: 'notRolledYet' };
}

/** Clicking an already-active build button cancels back to `idle` (requirement 1: "button stays
 * active; Escape/second click cancels"); clicking a different (or inactive) one enters its mode. */
export function toggleBuildMode(current: UiMode, kind: BuildKind): UiMode {
  const mode = BUILD_MODE[kind];
  return current === mode ? 'idle' : mode;
}

// ---- Seafarers ship controls (T-705) -----------------------------------------------------------

/** Is this a Seafarers game (ships in play)? The public ship state rides `ext.seafarers` (T-702),
 * present only for a seafarers config — so its presence is the toggle for the ship action buttons. */
export function isSeafarersGame(view: PlayerView): boolean {
  return (view as unknown as GameState).ext?.seafarers != null;
}

/**
 * Build-ship button enablement (S4). Only in `main` (rolled); out of ship supply → "Max ships";
 * can't afford 1 lumber + 1 wool → "Need …"; no legal sea edge → "No legal spots"; else enabled.
 * Supply is checked before affordability so a maxed player sees "Max ships", not a cost complaint.
 */
export function computeBuildShipState(view: PlayerView, seat: Seat): ControlState {
  const state = view as unknown as GameState;
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notRolledYet' };
  const shipsLeft = state.ext?.seafarers?.shipsLeft[seat] ?? 0;
  if (shipsLeft <= 0) return { enabled: false, reason: 'maxShips' };
  const missing = missingResources(state, seat, SHIP_COST);
  if (Object.keys(missing).length > 0) return { enabled: false, reason: 'cantAfford', missing };
  if (legalShipEdges(state, seat).length === 0) return { enabled: false, reason: 'noLegalTargets' };
  return ENABLED;
}

/**
 * Move-ship button enablement (S7, ≤1/turn). Only in `main`; if a ship was already moved this turn →
 * "Already moved"; if no open ship can relocate → "No legal spots"; else enabled.
 */
export function computeMoveShipState(view: PlayerView, seat: Seat): ControlState {
  const state = view as unknown as GameState;
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notRolledYet' };
  const ext = state.ext?.seafarers;
  if (ext && ext.movedShipOnTurn === state.turn.number) {
    return { enabled: false, reason: 'shipAlreadyMoved' };
  }
  if (movableShips(state, seat).length === 0) return { enabled: false, reason: 'noLegalTargets' };
  return ENABLED;
}

/** Setup-phase auto-mode (requirement 5): which mode the acting seat's bar should silently enter,
 * or `null` outside setup. `ActionBar`'s effect drives `setMode` from this; kept pure/testable
 * separately since effects don't run under `renderToStaticMarkup` (this workspace's test render). */
export function autoSetupMode(phase: Phase): 'placingSettlement' | 'placingRoad' | null {
  if (phase.kind !== 'setup') return null;
  return phase.expect === 'settlement' ? 'placingSettlement' : 'placingRoad';
}
