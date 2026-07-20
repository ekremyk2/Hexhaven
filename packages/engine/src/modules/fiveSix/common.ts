// Shared helpers for the 5–6 extension's two extra-build rules (X12): reading the selected turn
// rule / the active partial-turn marker off the state, and enumerating the legal actions of a
// special-build turn. Kept in one place so the engine's bots (sim/bot.ts, ai/candidates.ts) and the
// phase handlers agree on exactly what an SBP builder may do — the module owns this, base legal.ts
// stays phase-gated to `main` and untouched.

import type { Action, GameConfig, GameState, Seat } from '@hexhaven/shared';
import { costsForState, geometryForState } from '../index.js';
import { canAfford } from '../../rules/afford.js';
import { canPlaceRoad, ownRoadAt } from '../../rules/connectivity.js';
import { isVertexOccupied, satisfiesDistanceRule } from '../../rules/placement.js';
import { citiesKnightsExt, isCitiesKnightsState } from '../citiesKnights/state.js';
import { anyKnightAt } from '../citiesKnights/knights.js';

export type FiveSixTurnRule = 'sbp' | 'pairedPlayers';

/** The selected extra-build rule (X12). Defaults to the 2015 SBP; `pairedPlayers` is the 2022
 *  revision. Only meaningful when `expansions.fiveSix` is on — callers gate on that first. */
export function fiveSixTurnRule(config: GameConfig): FiveSixTurnRule {
  return config.variants?.fiveSixTurnRule ?? 'sbp';
}

export interface PartialTurn {
  builder: Seat;
  resumeFrom: Seat;
}

/** The active Paired-Players partial turn, or `null` when none is in progress. */
export function partialTurnOf(state: GameState): PartialTurn | null {
  return state.ext?.fiveSix?.partialTurn ?? null;
}

/**
 * Every action `seat` may legally submit during an SBP special-build turn (X12): build a road /
 * settlement / city they can afford and legally place, buy a development card, or pass. Deliberately
 * enumerates the same target sets the base build handlers validate (occupancy/distance/connectivity/
 * affordability) so a bot never proposes an illegal move — trading and dev-card PLAYS are absent by
 * design (SBP forbids both).
 */
export function legalSpecialBuildActions(state: GameState, seat: Seat): Action[] {
  const out: Action[] = [{ type: 'passSpecialBuild' }];
  const p = state.players[seat];
  if (!p) return out;
  const geom = geometryForState(state);
  const costs = costsForState(state);
  // C&K (C7.1): a knight sits ON an intersection and blocks settlement building there — the base
  // occupancy check (settlements/cities only) doesn't know about knights, so consult the C&K ext.
  const ck = citiesKnightsExt(state);

  if (p.piecesLeft.roads > 0 && canAfford(p, costs.road)) {
    for (const e of geom.edges) {
      if (canPlaceRoad(state, seat, e.id)) out.push({ type: 'buildRoad', edge: e.id });
    }
  }
  if (p.piecesLeft.settlements > 0 && canAfford(p, costs.settlement)) {
    for (const v of geom.vertices) {
      if (
        !isVertexOccupied(state, v.id) &&
        satisfiesDistanceRule(state, v.id) &&
        ownRoadAt(state, seat, v.id) &&
        !(ck && anyKnightAt(ck, v.id))
      ) {
        out.push({ type: 'buildSettlement', vertex: v.id });
      }
    }
  }
  if (p.piecesLeft.cities > 0 && canAfford(p, costs.city)) {
    for (const v of p.settlements) out.push({ type: 'buildCity', vertex: v });
  }
  // Cities & Knights has no dev deck — progress cards replace it (C11.1), and the engine rejects
  // `buyDevCard` outright there. In a fiveSix + C&K game the base deck is still shuffled at
  // createGame (so `devDeck.length > 0`), so gate on the game type, not just the deck, or the SBP
  // would offer a buy the engine then refuses (DEV_CARDS_DISABLED).
  if (!isCitiesKnightsState(state) && state.devDeck.length > 0 && canAfford(p, costs.devCard)) {
    out.push({ type: 'buyDevCard' });
  }

  return out;
}
