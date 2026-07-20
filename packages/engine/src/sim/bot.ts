// T-112: the random-legal-move bot. `randomBot(state, seat, rng)` builds the full set of
// currently-legal actions for `seat` (driven entirely by legal.ts's summaries, never by
// reinventing legality checks) and picks uniformly at random among them, threading `rng` through
// every draw exactly like the engine itself (docs/03 §6) — this file is inside packages/engine, so
// `Math.random` is both wrong and lint-banned here.
//
// One deliberate bias (task requirement 1): in the `main` phase, when at least one build/buy is
// legal and affordable, 70% of decisions are restricted to that build/buy set rather than the full
// action list (which always also contains `endTurn`). Undirected uniform-random play stalls for
// thousands of actions cycling bankTrade/endTurn without ever converging on 10 VP; this nudge keeps
// games finishing well under I10's 4,000-action cap while the bot stays otherwise "dumb" (no
// lookahead, no heuristics beyond this single knob).
//
// `seat` is not always `state.turn.player`: `discard` (R6.1) and `respondTrade` (R8.1) are the two
// action types reduce.ts lets a non-owner submit — sim/runGame.ts's `nextActor` decides who acts
// next turn-by-turn and calls this function for that seat.
//
// T-807 (Cities & Knights): every C&K candidate builder below is gated behind
// `isCitiesKnightsState` — a base/fiveSix/seafarers game never reaches any of this code, so RK-13
// and the fiveSix/seafarers sims stay byte-identical. C&K REPLACES the base dev-card subsystem
// (C11.1), so `buyDevCard`/`devCardCandidates` are suppressed entirely for a C&K game (the base
// dev deck is still shuffled at `createGame` for module-generic reasons, but `buyDevCard` always
// fails DEV_CARDS_DISABLED there — the bot must never propose it, or `simulate` throws "BUG: sim
// bot proposed an illegal action"). Progress cards (C6) are the dev-card-shaped replacement,
// offered via `progressCardCandidates`; only the subset of the 25 card NAMES whose legality this
// file can determine WITHOUT duplicating each card's full effect logic are auto-played (task
// allowance: "the cards a bot can sensibly auto-play") — every card in the C6.5 catalog IS covered
// below (none omitted), each guarded by the same precondition its effect function itself checks
// (progressCards.ts), so a generated candidate is never rejected as illegal.

import { CK_COMMODITY_SUPPLY, CK_KNIGHT_CAP, ckImprovementCost, hasAtLeast } from '@hexhaven/shared';
import type { Action, Commodity, EdgeId, GameState, HexId, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import { canAfford } from '../rules/afford.js';
import { canPlaceRoad } from '../rules/connectivity.js';
import { isVertexOccupied, satisfiesDistanceRule } from '../rules/placement.js';
import { costsForState, resolveConstants } from '../modules/index.js';
import { legalSpecialBuildActions, partialTurnOf } from '../modules/fiveSix/common.js';
import { geometryForState } from '../modules/index.js';
import { canPlayRoadBuildingSeafarers } from '../modules/seafarers/roadBuilding.js';
import {
  EP_CREW_COST,
  EP_HARBOR_COST,
  EP_MAX_SHIPS_PER_SEAT,
  EP_SCENARIO_CONFIG,
  EP_SETTLER_COST,
  EP_SHIP_COST,
  GOLD_PER_VP,
  SHIP_CARGO_CAP,
  SPICE_TRADE_COST_GOLD,
  councilVertexOf,
  crewSupplyOf,
  epExt,
  epGoldOf,
  epShipMoveTargets,
  epShipPlacementError,
  fishShoalsOf,
  harborSettlementsOf,
  isEPScenarioId,
  isExplorersPiratesState,
  isSeaEdge,
  movableEPShips,
  pirateLairsOf,
  settlerSupplyOf,
  shipsOfSeat,
  unexploredOf,
  vertexTouchesDiscoveredLand,
  villagesOf,
} from '../modules/explorersPirates/index.js';
import {
  chaseRobberHexTargets,
  chaseRobberKnights,
  citiesKnightsExt,
  diplomatOpenRoads,
  displaceableKnights,
  intrigueTargets,
  isCitiesKnightsState,
  knightDisplaceTargets,
  knightMoveTargets,
  knightPlacementVertices,
  legalKnightVertices,
  merchantHexes,
  movableKnights,
  wallEligibleCities,
} from '../modules/citiesKnights/index.js';
import { stealCandidatesForHex } from '../phases/robber.js';
import { nextRand, pickIndex } from '../rng.js';
import { computeVp } from '../vp.js';
import {
  FISH_EXCHANGE_COST,
  KNIGHT_COST,
  RIVERS_BRIDGE_COST,
  TB_COMMODITIES,
  coinsOf,
  fishOf,
  isBarbarianAttackState,
  isFishermenState,
  isRiversState,
  isTradersBarbariansMainState,
  knightsOf,
  legalKnightMoveTargets,
  legalKnightRecruitEdges,
  legalWagonDestinations,
  oldBootHolder,
  riversCoinTradeRate,
  tbCommoditiesOf,
  tradeHexesOf,
  wagonsOf,
} from '../modules/tradersBarbarians/index.js';
import {
  bankTradeOptions,
  buildAffordability,
  canBuildShip,
  goldPickCount,
  legalBridgeEdges,
  legalCamelEdges,
  legalCityVertices,
  legalFreeRoadEdges,
  legalFreeShipEdges,
  legalPirateHexes,
  legalRoadEdges,
  legalRobberHexes,
  legalSettlementVertices,
  legalSetupRoads,
  legalSetupSettlements,
  legalShipEdges,
  movableShips,
  playableDevCards,
  shipMoveTargets,
  tradeOfferSummary,
} from '../legal.js';

const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const COMMODITY_TYPES: readonly Commodity[] = ['paper', 'cloth', 'coin'];
const IMPROVEMENT_TRACKS: readonly ('trade' | 'politics' | 'science')[] = ['trade', 'politics', 'science'];

function isCommodityType(v: ResourceType | Commodity): v is Commodity {
  return v === 'paper' || v === 'cloth' || v === 'coin';
}

export interface BotDecision {
  action: Action;
  rng: number;
}

function pick(rng: number, actions: readonly Action[]): BotDecision {
  if (actions.length === 0) {
    throw new Error('BUG: randomBot had no legal action to choose from');
  }
  const draw = pickIndex(rng, actions.length);
  return { action: actions[draw.value]!, rng: draw.state };
}

/** A biased coin flip: `true` with probability `p`, threading `rng`. */
function chance(rng: number, p: number): { hit: boolean; rng: number } {
  const r = nextRand(rng);
  return { hit: r.value < p, rng: r.state };
}

/** All (a, b) pairs the bank can currently supply for Year of Plenty (ER-6), a === b included.
 *  T-906 (docs/07 D-034 `customConstants.yearOfPlentyCount`): see `ai/candidates.ts`'s twin — this
 *  bot only ever proposes the base 2-pick shape, so it stops proposing Year of Plenty entirely once
 *  a host configures a different count (soft AI-quality degradation, not a rule bug). */
function yearOfPlentyCandidates(state: GameState): Action[] {
  if ((resolveConstants(state.config).yearOfPlentyCount ?? 2) !== 2) return [];
  const out: Action[] = [];
  for (const a of RESOURCE_TYPES) {
    for (const b of RESOURCE_TYPES) {
      const need: ResourceBundle = {};
      need[a] = (need[a] ?? 0) + 1;
      need[b] = (need[b] ?? 0) + 1;
      if (hasAtLeast(state.bank, need)) out.push({ type: 'playYearOfPlenty', a, b });
    }
  }
  return out;
}

/** The four "play" dev-card actions legal for `seat` right now (R4.1: same set in preRoll and main). */
function devCardCandidates(state: GameState, seat: Seat): Action[] {
  const dp = playableDevCards(state, seat);
  const out: Action[] = [];
  if (dp.knight.playable) out.push({ type: 'playKnight' });
  if (dp.roadBuilding.playable) out.push({ type: 'playRoadBuilding' });
  if (dp.yearOfPlenty.playable) out.push(...yearOfPlentyCandidates(state));
  if (dp.monopoly.playable) {
    for (const resource of RESOURCE_TYPES) out.push({ type: 'playMonopoly', resource });
  }
  return out;
}

/** Every maritime trade (R8.2) `seat` can currently afford and the bank can currently supply. */
function bankTradeCandidates(state: GameState, seat: Seat): Action[] {
  const options = bankTradeOptions(state, seat);
  const out: Action[] = [];
  for (const give of RESOURCE_TYPES) {
    if (!options[give].affordable) continue;
    for (const receive of RESOURCE_TYPES) {
      if (receive === give || state.bank[receive] < 1) continue;
      out.push({ type: 'bankTrade', give, receive });
    }
  }
  return out;
}

/** One representative domestic offer (R8.1/ER-4): give 1 of the first held resource, ask for 1 of
 * a different type. Only ever added as a single candidate among many main-phase options, so it
 * doesn't need its own internal randomness — it just needs to be a LEGAL offer when one is held. */
function offerTradeCandidate(state: GameState, seat: Seat): Action | null {
  const player = state.players[seat];
  if (!player) return null;
  const give = RESOURCE_TYPES.find((r) => player.resources[r] > 0);
  if (give === undefined) return null;
  const receive = RESOURCE_TYPES.find((r) => r !== give);
  if (receive === undefined) return null;
  const giveBundle: ResourceBundle = { [give]: 1 };
  const receiveBundle: ResourceBundle = { [receive]: 1 };
  return { type: 'offerTrade', give: giveBundle, receive: receiveBundle };
}

// ---------------------------------------------------------------------------------------------
// Cities & Knights (T-807): candidate builders for every C&K action, gated on
// `isCitiesKnightsState`. Each mirrors the corresponding handler's own precondition checks
// (buildImprovement/improvements.ts, knights.ts, walls.ts, progressCards.ts) using the exported
// legal-target enumerators wherever one exists, so every generated candidate is legal by
// construction — never a dry-run against `reduce`.
// ---------------------------------------------------------------------------------------------

/** C4.1-4.3: every track `seat` can afford to advance one level right now (owns >=1 city, level
 *  <5, holds enough of the track's commodity). */
function buildImprovementCandidates(state: GameState, seat: Seat): Action[] {
  const ck = citiesKnightsExt(state);
  const player = state.players[seat];
  if (!ck || !player || player.cities.length === 0) return [];
  const out: Action[] = [];
  for (const track of IMPROVEMENT_TRACKS) {
    const level = ck.improvements[seat]![track];
    if (level >= 5) continue;
    const commodity = track === 'trade' ? 'cloth' : track === 'politics' ? 'coin' : 'paper';
    const cost = ckImprovementCost((level + 1) as 1 | 2 | 3 | 4 | 5);
    if (ck.commodities[seat]![commodity] >= cost) out.push({ type: 'buildImprovement', track });
  }
  return out;
}

/** C4.5 Trading House: every commodity bank trade `seat` can currently afford/the bank can supply
 *  (2:1 with Trading House — trade improvement >=3 — else the base 4:1). */
function commodityBankTradeCandidates(state: GameState, seat: Seat): Action[] {
  const ck = citiesKnightsExt(state);
  if (!ck) return [];
  const rate = (ck.improvements[seat]?.trade ?? 0) >= 3 ? 2 : 4;
  const out: Action[] = [];
  for (const give of COMMODITY_TYPES) {
    if (ck.commodities[seat]![give] < rate) continue;
    for (const receive of [...RESOURCE_TYPES, ...COMMODITY_TYPES]) {
      if ((receive as string) === (give as string)) continue;
      if (isCommodityType(receive)) {
        const total = ck.commodities.reduce((sum, c) => sum + c[receive], 0);
        if (total >= CK_COMMODITY_SUPPLY) continue;
      } else if (state.bank[receive] < 1) {
        continue;
      }
      out.push({ type: 'commodityBankTrade', give, receive });
    }
  }
  return out;
}

/** C7.1/C7.2: legal + affordable new basic-knight placements. */
function buildKnightCandidates(state: GameState, seat: Seat): Action[] {
  const player = state.players[seat];
  if (!player || !canAfford(player, { wool: 1, ore: 1 })) return [];
  return legalKnightVertices(state, seat).map((vertex) => ({ type: 'buildKnight', vertex }) as Action);
}

/** C7.2: legal + affordable knight activations (1 grain). */
function activateKnightCandidates(state: GameState, seat: Seat): Action[] {
  const ck = citiesKnightsExt(state);
  const player = state.players[seat];
  if (!ck || !player || !canAfford(player, { grain: 1 })) return [];
  return (ck.knights[seat] ?? [])
    .filter((k) => !k.active)
    .map((k) => ({ type: 'activateKnight', vertex: k.vertex }) as Action);
}

/** C7.2/C7.3: legal + affordable knight promotions (1 wool + 1 ore; strong->mighty needs
 *  Politics-L3 Fortress; per-level cap respected). */
function promoteKnightCandidates(state: GameState, seat: Seat): Action[] {
  const ck = citiesKnightsExt(state);
  const player = state.players[seat];
  if (!ck || !player || !canAfford(player, { wool: 1, ore: 1 })) return [];
  const knights = ck.knights[seat] ?? [];
  const out: Action[] = [];
  for (const k of knights) {
    if (k.level >= 3) continue;
    const nextLevel = k.level + 1;
    if (nextLevel === 3 && (ck.improvements[seat]?.politics ?? 0) < 3) continue;
    const countAtNext = knights.filter((o) => o.level === nextLevel).length;
    if (countAtNext >= CK_KNIGHT_CAP[nextLevel as 1 | 2 | 3]) continue;
    out.push({ type: 'promoteKnight', vertex: k.vertex });
  }
  return out;
}

/** C7.4: every legal (from, to) knight move for `seat`'s currently-active, movable knights. */
function moveKnightCandidates(state: GameState, seat: Seat): Action[] {
  const out: Action[] = [];
  for (const from of movableKnights(state, seat)) {
    for (const to of knightMoveTargets(state, seat, from)) out.push({ type: 'moveKnight', from, to });
  }
  return out;
}

/** C7.4: every legal knight displacement for `seat`'s active knights. */
function knightDisplaceCandidates(state: GameState, seat: Seat): Action[] {
  const out: Action[] = [];
  for (const from of displaceableKnights(state, seat)) {
    for (const to of knightDisplaceTargets(state, seat, from)) out.push({ type: 'knightDisplace', from, to });
  }
  return out;
}

/** C9.1: every legal + affordable city-wall build (2 brick; <=3 per player, one per city). */
function buildCityWallCandidates(state: GameState, seat: Seat): Action[] {
  const player = state.players[seat];
  if (!player || !canAfford(player, { brick: 2 })) return [];
  return wallEligibleCities(state, seat).map((vertex) => ({ type: 'buildCityWall', vertex }) as Action);
}

/** C7.4/C10.2: every legal `chaseRobber` (knight, destination hex[, stealFrom]) combination —
 *  only ever non-empty once the robber is unlocked (after the first barbarian attack, C10.1). */
function chaseRobberCandidates(state: GameState, seat: Seat): Action[] {
  const knights = chaseRobberKnights(state, seat);
  if (knights.length === 0) return [];
  const hexes = chaseRobberHexTargets(state);
  const out: Action[] = [];
  for (const knightVertex of knights) {
    for (const toHex of hexes) {
      const candidates = stealCandidatesForHex(state, toHex);
      if (candidates.length <= 1) {
        out.push({ type: 'chaseRobber', knightVertex, toHex });
      } else {
        for (const stealFrom of candidates) out.push({ type: 'chaseRobber', knightVertex, toHex, stealFrom });
      }
    }
  }
  return out;
}

/** C6.5 Alchemist: every (yellow, red) forced-die pair, playable only in `preRoll` before rolling. */
function alchemistCandidates(state: GameState, seat: Seat): Action[] {
  const ck = citiesKnightsExt(state);
  if (!ck || state.phase.kind !== 'preRoll' || state.turn.rolled) return [];
  if (!(ck.progressHand[seat] ?? []).includes('alchemist')) return [];
  const out: Action[] = [];
  for (let yellowDie = 1; yellowDie <= 6; yellowDie++) {
    for (let redDie = 1; redDie <= 6; redDie++) {
      out.push({ type: 'playProgressCard', card: 'alchemist', yellowDie, redDie });
    }
  }
  return out;
}

/**
 * C6.4/C6.5: every progress card in `seat`'s hand this file can construct a GUARANTEED-legal play
 * for, main phase only (Alchemist is handled separately in `preRollAction` — it's the sole
 * before-the-roll exception, C6.4). Every one of the 25 catalog names is covered (none silently
 * dropped): the "sensibly auto-play" cards with no meaningful target (irrigation/mining/smith/
 * warlord/saboteur/wedding) are always offered once held (their effects never fail without a
 * target — progressCards.ts); every targeted card re-checks exactly the precondition its own
 * effect function checks, using the same exported legal-target enumerators the client UI uses.
 */
function progressCardCandidates(state: GameState, seat: Seat): Action[] {
  const ck = citiesKnightsExt(state);
  const player = state.players[seat];
  if (!ck || !player) return [];
  const out: Action[] = [];

  for (const card of ck.progressHand[seat] ?? []) {
    switch (card) {
      case 'crane': {
        if (player.cities.length === 0) break;
        for (const track of IMPROVEMENT_TRACKS) {
          const level = ck.improvements[seat]![track];
          if (level >= 5) continue;
          const commodity = track === 'trade' ? 'cloth' : track === 'politics' ? 'coin' : 'paper';
          // C6.5 Crane: 1 fewer commodity than normal, floored at 1 (improvements.ts's `discount`).
          const discounted = Math.max(1, ckImprovementCost((level + 1) as 1 | 2 | 3 | 4 | 5) - 1);
          if (ck.commodities[seat]![commodity] >= discounted) out.push({ type: 'playProgressCard', card, track });
        }
        break;
      }
      case 'engineer': {
        for (const vertex of wallEligibleCities(state, seat)) out.push({ type: 'playProgressCard', card, vertex });
        break;
      }
      case 'inventor': {
        const numbered: HexId[] = [];
        state.board.hexes.forEach((h, i) => {
          if (h.token !== null && h.token !== 6 && h.token !== 8) numbered.push(i as HexId);
        });
        if (numbered.length >= 2) {
          out.push({ type: 'playProgressCard', card, hexA: numbered[0]!, hexB: numbered[1]! });
        }
        break;
      }
      case 'irrigation':
      case 'mining':
      case 'saboteur':
      case 'warlord':
      case 'wedding':
      case 'smith':
        out.push({ type: 'playProgressCard', card });
        break;
      case 'medicine': {
        if (player.settlements.length > 0 && player.piecesLeft.cities > 0 && canAfford(player, { ore: 2, grain: 1 })) {
          out.push({ type: 'playProgressCard', card, vertex: player.settlements[0]! });
        }
        break;
      }
      case 'roadBuilding': {
        // Mirror the engine's gate (effectRoadBuilding): in a Seafarers game a free piece may be a
        // ship and a sea route is ship-only (S3.2), so a road-only check would offer the card when
        // only a sea edge is "legal" as a road — the engine now rejects that, so gate identically.
        const playable =
          state.ext?.seafarers !== undefined
            ? canPlayRoadBuildingSeafarers(state, seat)
            : player.piecesLeft.roads > 0 &&
              geometryForState(state).edges.some((e) => canPlaceRoad(state, seat, e.id));
        if (playable) out.push({ type: 'playProgressCard', card });
        break;
      }
      case 'merchant': {
        for (const hex of merchantHexes(state, seat)) out.push({ type: 'playProgressCard', card, hex });
        break;
      }
      case 'merchantFleet': {
        for (const give of [...RESOURCE_TYPES, ...COMMODITY_TYPES]) {
          const held = isCommodityType(give) ? ck.commodities[seat]![give] : player.resources[give];
          if (held < 2) continue;
          for (const receive of [...RESOURCE_TYPES, ...COMMODITY_TYPES]) {
            if ((receive as string) === (give as string)) continue;
            if (isCommodityType(receive)) {
              const total = ck.commodities.reduce((sum, c) => sum + c[receive], 0);
              if (total >= CK_COMMODITY_SUPPLY) continue;
            } else if (state.bank[receive] < 1) {
              continue;
            }
            out.push({ type: 'playProgressCard', card, give, receive });
          }
        }
        break;
      }
      case 'commercialHarbor': {
        // Always legal to PLAY (the effect only transacts where both sides can afford it, and is
        // a no-op otherwise — progressCards.ts's effectCommercialHarbor never fails past having
        // both fields set), so any (resource, commodity) pair is a guaranteed-legal candidate.
        for (const resource of RESOURCE_TYPES) {
          for (const commodity of COMMODITY_TYPES) out.push({ type: 'playProgressCard', card, resource, commodity });
        }
        break;
      }
      case 'masterMerchant': {
        const myVp = computeVp(state, seat).total;
        for (const p of state.players) {
          if (p.seat !== seat && computeVp(state, p.seat).total > myVp) {
            out.push({ type: 'playProgressCard', card, targetSeat: p.seat });
          }
        }
        break;
      }
      case 'resourceMonopoly': {
        for (const resource of RESOURCE_TYPES) out.push({ type: 'playProgressCard', card, resource });
        break;
      }
      case 'commodityMonopoly': {
        for (const commodity of COMMODITY_TYPES) out.push({ type: 'playProgressCard', card, commodity });
        break;
      }
      case 'bishop': {
        if (ck.robberLocked) break;
        for (const hex of geometryForState(state).hexes) {
          if (hex.id !== state.board.robber) out.push({ type: 'playProgressCard', card, hex: hex.id });
        }
        break;
      }
      case 'deserter': {
        const placements = knightPlacementVertices(state, seat).slice(0, 3);
        if (placements.length === 0) break;
        for (const p of state.players) {
          if (p.seat === seat) continue;
          for (const k of ck.knights[p.seat] ?? []) {
            const countAtLevel = (ck.knights[seat] ?? []).filter((o) => o.level === k.level).length;
            if (countAtLevel >= CK_KNIGHT_CAP[k.level]) continue;
            for (const vertex of placements) {
              out.push({ type: 'playProgressCard', card, targetSeat: p.seat, targetVertex: k.vertex, vertex });
            }
          }
        }
        break;
      }
      case 'diplomat': {
        for (const edge of diplomatOpenRoads(state)) out.push({ type: 'playProgressCard', card, edge });
        break;
      }
      case 'intrigue': {
        for (const targetVertex of intrigueTargets(state, seat)) out.push({ type: 'playProgressCard', card, targetVertex });
        break;
      }
      case 'spy': {
        for (const p of state.players) {
          if (p.seat === seat) continue;
          if ((ck.progressHand[p.seat]?.length ?? 0) > 0) {
            out.push({ type: 'playProgressCard', card, targetSeat: p.seat, targetCardIndex: 0 });
          }
        }
        break;
      }
      // alchemist: preRoll-only (handled by `alchemistCandidates`); printer/constitution: revealed
      // on draw, never enter a hand, never playable (C6.3) — both unreachable here.
      default:
        break;
    }
  }
  return out;
}

/** C9.1/C7.1/C7.3/C4.x: every C&K piece/track "growth" action `seat` can currently legally afford
 *  — folded into the base bot's `buildBuy` bucket (same 70%-bias treatment as settlements/cities/
 *  roads). `activateKnight`/`moveKnight`/`knightDisplace` are deliberately NOT here — they're pure
 *  upkeep/tactics on a knight ALREADY built (nothing new added to the board), and once any knight
 *  exists they're cheap and near-always available; folding them into the 70% bucket alongside
 *  actual growth starved `buildImprovement` (the metropolis path, C4.6) of turns almost entirely in
 *  testing (a 40-game smoke run put metropolis games at 5%, activate/move actions at 200+/game) —
 *  see `citiesKnightsOther` below, where they compete for turns instead. */
function citiesKnightsBuildBuy(state: GameState, seat: Seat): Action[] {
  if (!isCitiesKnightsState(state)) return [];
  return [
    ...buildImprovementCandidates(state, seat),
    ...buildKnightCandidates(state, seat),
    ...promoteKnightCandidates(state, seat),
    ...buildCityWallCandidates(state, seat),
  ];
}

/** C&K "other" actions (mirrors devCardCandidates/bankTradeCandidates's bucket): knight activation/
 *  moves/displaces, the robber chase, commodity bank trades, and progress-card plays. */
function citiesKnightsOther(state: GameState, seat: Seat): Action[] {
  if (!isCitiesKnightsState(state)) return [];
  return [
    ...activateKnightCandidates(state, seat),
    ...moveKnightCandidates(state, seat),
    ...knightDisplaceCandidates(state, seat),
    ...chaseRobberCandidates(state, seat),
    ...commodityBankTradeCandidates(state, seat),
    ...progressCardCandidates(state, seat),
  ];
}

// ---------------------------------------------------------------------------------------------
// Fishermen (T-1002, docs/rules/traders-barbarians-rules.md §TB2): candidate builders for
// `exchangeFish`/`passOldBoot`, gated on `isFishermenState`, empty outside a fishermen game. Each
// mirrors `exchangeFishHandler`/`passOldBootHandler`'s own precondition checks (fishermen.ts) so a
// generated candidate is always legal by construction.
// ---------------------------------------------------------------------------------------------

/** Every `exchangeFish` benefit `seat` can currently afford, expanded to every legal target where
 *  the benefit needs one ('steal'/'bankResource'/'freeRoad'). */
function fishExchangeCandidates(state: GameState, seat: Seat): Action[] {
  if (!isFishermenState(state) || state.phase.kind !== 'main') return [];
  const held = fishOf(state, seat);
  const out: Action[] = [];
  if (held >= FISH_EXCHANGE_COST.removeRobber) {
    out.push({ type: 'exchangeFish', benefit: 'removeRobber' });
  }
  if (held >= FISH_EXCHANGE_COST.steal) {
    for (const from of stealCandidatesForHex(state, state.board.robber)) {
      out.push({ type: 'exchangeFish', benefit: 'steal', from });
    }
  }
  if (held >= FISH_EXCHANGE_COST.bankResource) {
    for (const resource of RESOURCE_TYPES) {
      if (state.bank[resource] > 0) out.push({ type: 'exchangeFish', benefit: 'bankResource', resource });
    }
  }
  if (held >= FISH_EXCHANGE_COST.freeRoad && (state.players[seat]?.piecesLeft.roads ?? 0) > 0) {
    for (const edge of legalRoadEdges(state, seat)) out.push({ type: 'exchangeFish', benefit: 'freeRoad', edge });
  }
  if (held >= FISH_EXCHANGE_COST.devCard && state.devDeck.length > 0) {
    out.push({ type: 'exchangeFish', benefit: 'devCard' });
  }
  return out;
}

/** `passOldBoot`: only when `seat` holds it, to every opponent they are trailing or tied with. */
function passOldBootCandidates(state: GameState, seat: Seat): Action[] {
  if (!isFishermenState(state) || state.phase.kind !== 'main' || oldBootHolder(state) !== seat) return [];
  const myVp = computeVp(state, seat).total;
  return state.players
    .filter((p) => p.seat !== seat && computeVp(state, p.seat).total >= myVp)
    .map((p) => ({ type: 'passOldBoot', to: p.seat }) as Action);
}

// ---------------------------------------------------------------------------------------------
// Rivers (T-1003, docs/rules/traders-barbarians-rules.md §TB3): candidate builders for
// `buildBridge`/`tradeCoins`, gated on `isRiversState`, empty outside a rivers game. Each mirrors
// `buildBridgeHandler`/`tradeCoinsHandler`'s own precondition checks (rivers.ts) so a generated
// candidate is always legal by construction.
// ---------------------------------------------------------------------------------------------

/** Every legal + affordable `buildBridge` target for `seat` right now. */
function bridgeCandidates(state: GameState, seat: Seat): Action[] {
  if (!isRiversState(state)) return [];
  const player = state.players[seat];
  if (!player || !canAfford(player, RIVERS_BRIDGE_COST)) return [];
  return legalBridgeEdges(state, seat).map((edge) => ({ type: 'buildBridge', edge }) as Action);
}

/** Every `tradeCoins` the seat can currently afford at the resolved rate, one per bank-stocked
 *  resource (mirrors `bankTradeCandidates`'s shape). */
function coinTradeCandidates(state: GameState, seat: Seat): Action[] {
  if (!isRiversState(state) || state.phase.kind !== 'main') return [];
  const rate = riversCoinTradeRate(state);
  if (coinsOf(state, seat) < rate) return [];
  const out: Action[] = [];
  for (const receive of RESOURCE_TYPES) {
    if (state.bank[receive] > 0) out.push({ type: 'tradeCoins', give: rate, receive });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Barbarian Attack (T-1005, docs/rules/traders-barbarians-rules.md §TB5): candidate builders for
// `recruitKnight`/`moveBarbarianKnight`, gated on `isBarbarianAttackState`, empty outside a
// barbarianAttack game. Each mirrors `recruitKnightHandler`/`moveBarbarianKnightHandler`'s own
// precondition checks (barbarianAttack.ts) so a generated candidate is always legal by
// construction.
// ---------------------------------------------------------------------------------------------

/** Every legal + affordable `recruitKnight` target for `seat` right now. */
function knightRecruitCandidates(state: GameState, seat: Seat): Action[] {
  if (!isBarbarianAttackState(state) || state.phase.kind !== 'main') return [];
  const player = state.players[seat];
  if (!player || !canAfford(player, KNIGHT_COST)) return [];
  return legalKnightRecruitEdges(state, seat).map((edge) => ({ type: 'recruitKnight', edge }) as Action);
}

/**
 * At most ONE representative `moveBarbarianKnight` per active knight `seat` owns (mirrors
 * `offerTradeCandidate`'s "one representative offer" precedent) — `legalKnightMoveTargets` can
 * return dozens of reachable edges within `KNIGHT_MOVE_RANGE`/`KNIGHT_MOVE_EXTENDED_RANGE` hops,
 * and offering every one of them made `moveBarbarianKnight` dominate the sim bot's random choice so
 * thoroughly that games never converged within the I10 budget (an early implementation caught this
 * exact stall — see barbarianAttack.test.ts's sim gate). One candidate per knight is still enough
 * to exercise recruit/move/combat repeatedly over hundreds of simulated games.
 */
function knightMoveCandidates(state: GameState, seat: Seat): Action[] {
  if (!isBarbarianAttackState(state) || state.phase.kind !== 'main') return [];
  const out: Action[] = [];
  for (const k of knightsOf(state).filter((k) => k.seat === seat && k.active)) {
    const target = legalKnightMoveTargets(state, seat, k.edge)[0];
    if (target) out.push({ type: 'moveBarbarianKnight', from: k.edge, to: target.to, extended: target.extended });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The main scenario (T-1006, docs/rules/traders-barbarians-rules.md §TB6): candidate builders for
// `moveWagon`, gated on `isTradersBarbariansMainState`, empty outside that scenario. Mirrors
// `knightMoveCandidates`'s "one representative destination per piece" precedent (barbarianAttack.ts)
// — offering EVERY reachable vertex per wagon would dominate the random choice exactly like that
// file's own knight-move comment describes.
// ---------------------------------------------------------------------------------------------

/** Every legal stationary `moveWagon{path:[], load}` for `seat`'s wagons right now — one candidate
 *  per commodity the wagon could load, only when it sits on the seat's own settlement/city with an
 *  empty cargo slot and the seat's stock actually holds that commodity. */
function wagonLoadCandidates(state: GameState, seat: Seat): Action[] {
  if (!isTradersBarbariansMainState(state) || state.phase.kind !== 'main') return [];
  const stock = tbCommoditiesOf(state, seat);
  const player = state.players[seat];
  if (!player) return [];
  const out: Action[] = [];
  wagonsOf(state).forEach((wagon, idx) => {
    if (wagon.seat !== seat || wagon.cargo !== null) return;
    const ownsHere = player.settlements.includes(wagon.at) || player.cities.includes(wagon.at);
    if (!ownsHere) return;
    for (const commodity of TB_COMMODITIES) {
      if ((stock[commodity] ?? 0) > 0) out.push({ type: 'moveWagon', wagon: idx, path: [], load: commodity });
    }
  });
  return out;
}

/** At most ONE representative `moveWagon` move per wagon `seat` owns — prefers a destination
 *  touching a served trade hex (to actually exercise delivery), else the first reachable vertex
 *  `legalWagonDestinations` finds. `[]` outside the scenario / main phase. */
function wagonMoveCandidates(state: GameState, seat: Seat): Action[] {
  if (!isTradersBarbariansMainState(state) || state.phase.kind !== 'main') return [];
  // T-1054 (5–6): reads THIS game's resolved geometry (base or `GEOMETRY_EXT56`) rather than always
  // the base `GEOMETRY` — a hardcoded base-board lookup would silently under-serve trade-hex
  // preference on a fiveSix board (wrong/missing vertices), starving the sim's delivery rate.
  const geometry = geometryForState(state);
  const tradeHexVertices = new Set(
    tradeHexesOf(state).flatMap((th) => geometry.hexes[th.hex]?.vertices ?? [])
  );
  const out: Action[] = [];
  wagonsOf(state).forEach((wagon, idx) => {
    if (wagon.seat !== seat) return;
    const destinations = legalWagonDestinations(state, seat, idx).filter((d) => d.path.length > 0);
    if (destinations.length === 0) return;
    const preferred = destinations.find((d) => tradeHexVertices.has(d.to)) ?? destinations[0]!;
    out.push({ type: 'moveWagon', wagon: idx, path: preferred.path });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Caravans (T-1004, docs/rules/traders-barbarians-rules.md §TB4): the `caravanVote`/`placeCamel`
// sub-phase dispatcher, gated on `isCaravansState` — mirrors `discardAction`/`goldAction`'s shape
// (a phase with its own action, not the main-phase build/buy set). Every generated candidate is
// legal by construction (affordable bids only; placement only on a currently-empty route edge).
// ---------------------------------------------------------------------------------------------

/** Every affordable `caravanVote` bid `seat` could make right now, always including abstain
 *  (`{grain:0, wool:0}`) — capped at 2 of each resource so the candidate set stays small. */
function caravanVoteBidCandidates(state: GameState, seat: Seat): Action[] {
  const player = state.players[seat];
  const out: Action[] = [{ type: 'caravanVote', grain: 0, wool: 0 }];
  if (!player) return out;
  const maxGrain = Math.min(player.resources.grain, 2);
  const maxWool = Math.min(player.resources.wool, 2);
  for (let grain = 0; grain <= maxGrain; grain++) {
    for (let wool = 0; wool <= maxWool; wool++) {
      if (grain === 0 && wool === 0) continue;
      out.push({ type: 'caravanVote', grain, wool });
    }
  }
  return out;
}

function caravanVoteAction(state: GameState, seat: Seat, rng: number): BotDecision {
  if (state.phase.kind !== 'caravanVote') throw new Error('BUG: caravanVoteAction outside the caravanVote phase');
  if (state.phase.pending.length > 0) return pick(rng, caravanVoteBidCandidates(state, seat));
  // Every seat has bid and `seat` is the resolved winner (sim/runGame.ts's `nextActor` only ever
  // calls this for the winner once `pending` is empty) — place a camel on any currently-empty route.
  return pick(rng, legalCamelEdges(state).map((edge) => ({ type: 'placeCamel', edge }) as Action));
}

// ---------------------------------------------------------------------------------------------
// Explorers & Pirates — Land Ho! (T-1107, docs/rules/explorers-pirates-rules.md §EP3/§EP4): candidate
// builders for buildEPShip/moveEPShip/loadCargo('settler')/buildEPSettler/foundSettlement/
// upgradeToHarbor, gated on `isExplorersPiratesState`, empty outside an E&P game. Land Ho! uses NONE
// of the three missions (§EP11.1), so crew/lair/gold actions are still never offered here —
// settlements (1 VP) + harbor settlements (2 VP) are the only paths to Land Ho!'s 8-VP target, exactly
// the fallback the task calls for. T-1111 (Fish for Hexhaven) extends this SAME candidate set with the
// fish-mission actions below (`epFishDeliverCandidates`); T-1112 (Spices for Hexhaven) further extends it
// with the spice-mission actions (`epSpiceTradeCandidates`/`epSpiceDeliverCandidates`) — every function
// here still runs unconditionally for ANY E&P game (gated only on `isExplorersPiratesState`, never the
// scenario id), same as before; Land Ho! never seeds `fishShoals`/`villages`/`councilVertex`
// (createGame.ts), so `fishShoalsOf`/`villagesOf`/`councilVertexOf` read empty/`undefined` there and
// every new candidate below stays `[]` — Land Ho!'s own sim is unaffected by either task, and
// `fishForHexhaven`'s own sim is unaffected by T-1112 (it never seeds `villages`, so the spice candidates
// stay `[]` there too).
//
// Ship MOVEMENT is a near-free, always-legal action (no cost, and `SHIP_MOVE_RANGE` reaches dozens of
// edges) that dominated the sim bot's random choice in testing exactly like `moveBarbarianKnight`/
// domestic trades do (this file's own precedent comments) — reduced to ONE representative
// destination per ship (mirrors `knightMoveCandidates`'s "one destination per piece" precedent) and
// folded into the "other" bucket alongside base ship moves (seafarers' own `shipMoves` above), never
// the 70%-biased `buildBuy` set, so it never swallows the sim's action budget. T-1111 biases that ONE
// destination further: a ship already carrying `'fish'` cargo heads for the council (to deliver it);
// an empty ship heads for a fish shoal (to auto-haul one, `haulFishOnArrival`, goldFishSpice.ts). T-1112
// extends the SAME preference chain one step further: a ship carrying `'spice'` cargo ALSO heads for
// the council (to deliver it, same target as fish); a ship carrying neither heads for a village hex
// instead (to `tradeSpice` there next — unlike fish, spice needs a paid, dedicated action, not an
// auto-haul). All of these are `[]`/no-ops for Land Ho! (no shoals/villages/council ever seeded
// there). `seedFishSpiceV0` seeds `villages`/`councilVertex` together whenever EITHER the fish or
// spice mission is on (createGame.ts, shared with `fishShoals`) — so Fish for Hexhaven's `ext` ALSO
// carries a (seeded-but-otherwise-inert) `villages` list; every spice-specific candidate below
// (`epSpiceTradeCandidates`/`epSpiceDeliverCandidates`) and the village-heading move preference are
// therefore explicitly gated on `EP_SCENARIO_CONFIG[scenario].missions.spice` (via `epSpiceMissionActive`
// below), NOT merely on `villagesOf(state)` being non-empty — keeping the spice mission's bot behavior
// itself gated on the scenario actually enabling it, per this task's own "spice gated on
// missions.spice" requirement, and leaving Fish for Hexhaven's own sim untouched by this task.
//
// T-1113 (The Pirate Lairs) extends this SAME candidate set once more with the crew/lair-mission
// actions below (`epCrewBuildCandidates`/`epLoadCrewCandidates`/`epPlaceCrewOnLairCandidates`) — and,
// UNLIKE fish/spice's shared shoal/village seeding, pirate lairs themselves are created UNCONDITIONALLY
// by exploration reveals in EVERY shipped scenario (a `'pirate'` tile sits in every scenario's shared
// `EP_EXPLORATION_TILES`, exploration.ts) — so gating on `epPirateLairsMissionActive` below (mirrors
// `epSpiceMissionActive`'s own discipline) is the ONLY thing keeping Land Ho!/Fish for Hexhaven/Spices for
// Hexhaven's bots from ever proposing `buildEPCrew`/`loadCargo('crew')`/`placeCrewOnLair` there, even
// though a lair may well exist on their board. `epShipMoveCandidates` below gets one more preference
// step: a ship already carrying `'crew'` cargo heads for an edge touching an active lair's hex (to
// `placeCrewOnLair` there next) — gated the same way.
// ---------------------------------------------------------------------------------------------

/** T-1112: is the spice mission actually ON for `state`'s own scenario? `false` outside a live E&P
 *  game or for a scenario whose `EP_SCENARIO_CONFIG` entry has `missions.spice` off (Land Ho!, Fish
 *  for Hexhaven) — even though those scenarios' `ext` may still carry a (shared-seeded, inert) `villages`
 *  list, per this section's own header comment. */
function epSpiceMissionActive(state: GameState): boolean {
  const scenario = epExt(state)?.scenario;
  return scenario !== undefined && isEPScenarioId(scenario) && EP_SCENARIO_CONFIG[scenario].missions.spice;
}

/** T-1113: is the pirate-lairs mission actually ON for `state`'s own scenario? `false` outside a
 *  live E&P game or for a scenario whose `EP_SCENARIO_CONFIG` entry has `missions.pirateLairs` off
 *  (Land Ho!, Fish for Hexhaven, Spices for Hexhaven) — even though pirate lairs themselves are created
 *  UNCONDITIONALLY by exploration reveals in every shipped scenario (this section's own header
 *  comment). Mirrors `epSpiceMissionActive`'s exact shape. */
function epPirateLairsMissionActive(state: GameState): boolean {
  const scenario = epExt(state)?.scenario;
  return (
    scenario !== undefined && isEPScenarioId(scenario) && EP_SCENARIO_CONFIG[scenario].missions.pirateLairs
  );
}

/** EP3.1: every sea edge `seat` may currently legally build a ship on (naturally capped by
 *  `EP_MAX_SHIPS_PER_SEAT` + affordability, mirroring `canBuildShip`'s seafarers analogue). */
function epShipBuildCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  const player = state.players[seat];
  if (!player || !canAfford(player, EP_SHIP_COST)) return [];
  if (shipsOfSeat(state, seat).length >= EP_MAX_SHIPS_PER_SEAT) return [];
  const out: Action[] = [];
  for (const e of geometryForState(state).edges) {
    if (!epShipPlacementError(state, seat, e.id)) out.push({ type: 'buildEPShip', edge: e.id });
  }
  return out;
}

/** Multi-source BFS over the SEA-EDGE adjacency graph (two sea edges are "adjacent" iff they share a
 *  vertex — the EXACT SAME adjacency notion `seaEdgesWithinRange` uses for `epShipMoveTargets` itself,
 *  ships.ts) starting from every sea edge bordering ANY hex in `goalHexes`. Returns each reachable sea
 *  edge's TRUE shortest sea-route hop count to its nearest goal hex (not present in the map at all if
 *  no sea route reaches it, e.g. a landlocked pocket).
 *
 *  T-1114 (tuning the full-campaign sim): an earlier version of `epShipMoveCandidates`'s fallback
 *  picked whichever reachable target had the smallest STRAIGHT-LINE hex distance to a goal hex. That
 *  looked reasonable but was silently wrong whenever land sat between a ship and its goal: straight-
 *  line distance has no notion of the coastline actually being sailable, so two edges on either side
 *  of a spit of land could each look "closer" than the other from the OTHER's position — real ships
 *  in real full-campaign sim runs got stuck orbiting a 2-edge cluster for THOUSANDS of turns as a
 *  result, never actually closing in on the council/shoals/villages they were nominally steering
 *  toward (traced via a throwaway diagnostic harness during this task). A real graph BFS over the
 *  SAME sea-edge adjacency the engine's own movement legality already uses cannot have this failure
 *  mode: true shortest-path distance strictly decreases along any edge of an optimal path, so picking
 *  the reachable target with the smallest BFS distance is guaranteed monotonic progress (or a stable
 *  arrival) rather than a symmetric trap. */
function seaEdgeDistanceToGoals(state: GameState, goalHexes: ReadonlySet<HexId>): Map<EdgeId, number> {
  const geometry = geometryForState(state);
  const dist = new Map<EdgeId, number>();
  let frontier: EdgeId[] = [];
  for (const edge of geometry.edges) {
    if (!isSeaEdge(state, edge.id)) continue;
    if (edge.hexes.some((h) => goalHexes.has(h))) {
      dist.set(edge.id, 0);
      frontier.push(edge.id);
    }
  }
  let d = 0;
  while (frontier.length > 0) {
    const next: EdgeId[] = [];
    d += 1;
    for (const edgeId of frontier) {
      const edge = geometry.edges[edgeId];
      if (!edge) continue;
      for (const v of [edge.a, edge.b]) {
        const vert = geometry.vertices[v];
        if (!vert) continue;
        for (const adjEdge of vert.edges) {
          if (dist.has(adjEdge)) continue;
          if (!isSeaEdge(state, adjEdge)) continue;
          dist.set(adjEdge, d);
          next.push(adjEdge);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/** EP3.2/EP8/EP9 (T-1111 extends the preference order; T-1112/T-1113 extend it further; T-1114
 *  reworks the fallback — see `seaEdgeDistanceToGoals`'s own header above): at most ONE representative
 *  `moveEPShip` per movable ship `seat` owns. This ship's SINGLE current goal-hex set is resolved
 *  first, in the SAME priority order the mission tasks established: (1) already carrying `'fish'` OR
 *  `'spice'` cargo -> the council's own hexes (to `deliverFish`/`deliverSpice` next) — Land Ho! never
 *  seeds a council, so this is always empty there; (2) already carrying `'crew'` cargo, with the
 *  pirate-lairs mission actually ON (`epPirateLairsMissionActive`) -> every still-active lair's hex
 *  (to `placeCrewOnLair` next); (3) an empty ship -> the fish shoal hexes (to auto-haul one on
 *  arrival) — likewise always empty where no shoals were ever seeded; (4) if the spice mission is
 *  actually ON (`epSpiceMissionActive`, NOT merely `villagesOf` non-empty, since villages are shared-
 *  seeded alongside fish shoals per this section's own header comment) and not carrying spice -> the
 *  village hexes (to `tradeSpice` there next); (5) still-`unexplored` hexes (drives exploration/
 *  founding forward).
 *
 *  Prefers an immediately-adjacent goal hex first (a move that arrives there THIS turn); failing
 *  that, picks whichever reachable destination has the smallest TRUE sea-route distance
 *  (`seaEdgeDistanceToGoals`) to the nearest goal hex — memoized per distinct goal-set within this one
 *  call, since `seat`'s several ships often share the identical goal set (e.g. every empty ship wants
 *  the same shoals) and the BFS itself doesn't depend on which ship is asking. Falls back to
 *  `targets[0]` only when this ship has no goal at all (nothing left unexplored and no active mission
 *  goal, e.g. Land Ho!) or no reachable target has a finite distance to any goal (an unreachable
 *  pocket). `[]` outside an E&P game / main phase. */
function epShipMoveCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  const unexplored = new Set(unexploredOf(state));
  const shoals = new Set(fishShoalsOf(state));
  const villages = epSpiceMissionActive(state) ? new Set(villagesOf(state)) : new Set<HexId>();
  // T-1113: only heeded when the pirate-lairs mission is actually ON for this scenario
  // (`epPirateLairsMissionActive` — mirrors the spice `villages` gate above), even though a lair may
  // exist on the board regardless (this section's own header comment).
  const lairHexes = epPirateLairsMissionActive(state) ? new Set(pirateLairsOf(state).map((l) => l.hex)) : new Set<HexId>();
  const council = councilVertexOf(state);
  const councilVert = council !== undefined ? geometryForState(state).vertices[council] : undefined;
  const councilHexes = new Set<HexId>(councilVert?.hexes ?? []);
  const out: Action[] = [];
  const distCache = new Map<ReadonlySet<HexId>, Map<EdgeId, number>>();
  for (const from of movableEPShips(state, seat)) {
    const targets = epShipMoveTargets(state, seat, from);
    if (targets.length === 0) continue;
    const ownShip = shipsOfSeat(state, seat).find((s) => s.edge === from);
    const carryingFish = ownShip?.cargo.includes('fish') ?? false;
    const carryingSpice = ownShip?.cargo.includes('spice') ?? false;
    const carryingCrew = ownShip?.cargo.includes('crew') ?? false;

    let goals: ReadonlySet<HexId> | undefined;
    if ((carryingFish || carryingSpice) && councilHexes.size > 0) goals = councilHexes;
    else if (carryingCrew && lairHexes.size > 0) goals = lairHexes;
    else if (shoals.size > 0) goals = shoals;
    else if (villages.size > 0 && !carryingSpice) goals = villages;
    else if (unexplored.size > 0) goals = unexplored;

    let preferred: EdgeId | undefined;
    if (goals && goals.size > 0) {
      preferred = targets.find((to) => geometryForState(state).edges[to]?.hexes.some((h) => goals!.has(h)));
      if (preferred === undefined) {
        let graphDist = distCache.get(goals);
        if (!graphDist) {
          graphDist = seaEdgeDistanceToGoals(state, goals);
          distCache.set(goals, graphDist);
        }
        let bestDist = Infinity;
        for (const to of targets) {
          const d = graphDist.get(to);
          if (d !== undefined && d < bestDist) {
            bestDist = d;
            preferred = to;
          }
        }
      }
    }
    out.push({ type: 'moveEPShip', from, to: preferred ?? targets[0]! });
  }
  return out;
}

/** EP8 (Fish for Hexhaven, T-1111): every ship of `seat`'s that carries `'fish'` cargo AND sits adjacent
 *  to the council vertex may deliver it for VP — mirrors `deliverFishHandler`'s own precondition
 *  exactly (no payload; the delivery target is fixed board state, not a submitted field). `[]`
 *  outside an E&P game / main phase, or before `seedFishSpiceV0` seeded a council (e.g. Land Ho!, so
 *  this candidate is always empty there). */
function epFishDeliverCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  const council = councilVertexOf(state);
  if (council === undefined) return [];
  const vert = geometryForState(state).vertices[council];
  if (!vert) return [];
  const hasFishShip = shipsOfSeat(state, seat).some(
    (s) => s.cargo.includes('fish') && vert.edges.includes(s.edge)
  );
  return hasFishShip ? [{ type: 'deliverFish' }] : [];
}

/** EP9 (Spices for Hexhaven, T-1112): one `tradeSpice` candidate per village hex `seat` has a ship
 *  adjacent to, gated on the scenario actually having the spice mission ON (`epSpiceMissionActive`
 *  — NOT merely `villagesOf` non-empty, per this section's own header comment). For each village hex,
 *  resolves the SAME ship `tradeSpiceHandler` itself would pick — the FIRST of `seat`'s own ships (in
 *  `shipsOfSeat` order) adjacent to that hex, exactly mirroring the handler's own
 *  `ships.findIndex((s) => s.seat === seat && edge-adjacent-to-hex)` — and only proposes the trade
 *  when THAT resolved ship has cargo-bay room; a seat with two ships at the same village where the
 *  first (list-order) ship is full must NOT get a candidate for that hex just because a second ship
 *  there has room, since the handler would still resolve (and reject as `CARGO_FULL`) the first one.
 *  `[]` outside an E&P game / main phase, when the spice mission is off, or while `seat` can't afford
 *  `SPICE_TRADE_COST_GOLD`. */
function epSpiceTradeCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  if (!epSpiceMissionActive(state)) return [];
  const villages = villagesOf(state);
  if (villages.length === 0) return [];
  if (epGoldOf(state, seat) < SPICE_TRADE_COST_GOLD) return [];
  const ownShips = shipsOfSeat(state, seat);
  const geometry = geometryForState(state);
  const out: Action[] = [];
  for (const villageHex of villages) {
    const ship = ownShips.find((s) => geometry.edges[s.edge]?.hexes.includes(villageHex));
    if (ship && ship.cargo.length < SHIP_CARGO_CAP) {
      out.push({ type: 'tradeSpice', hex: villageHex });
    }
  }
  return out;
}

/** EP9 (Spices for Hexhaven, T-1112): every ship of `seat`'s that carries `'spice'` cargo AND sits
 *  adjacent to the council vertex may deliver it for VP + a `spiceBenefit` bump — mirrors
 *  `deliverSpiceHandler`'s own precondition exactly (no payload; the delivery target is fixed board
 *  state, not a submitted field), same shape as `epFishDeliverCandidates` above. `[]` outside an E&P
 *  game / main phase, or before `seedFishSpiceV0` seeded a council (e.g. Land Ho!/Fish for Hexhaven, so
 *  this candidate is always empty there). */
function epSpiceDeliverCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  const council = councilVertexOf(state);
  if (council === undefined) return [];
  const vert = geometryForState(state).vertices[council];
  if (!vert) return [];
  const hasSpiceShip = shipsOfSeat(state, seat).some(
    (s) => s.cargo.includes('spice') && vert.edges.includes(s.edge)
  );
  return hasSpiceShip ? [{ type: 'deliverSpice' }] : [];
}

/** EP7.1 (The Pirate Lairs, T-1113): build a crew whenever `seat` can afford one AND already owns at
 *  least one harbor settlement — mirrors `buildEPCrewHandler`'s own precondition exactly. Gated on
 *  `epPirateLairsMissionActive` (this section's own header) so the bot never proposes this in Land
 *  Ho!/Fish for Hexhaven/Spices for Hexhaven, even if a lair happens to exist on their board.
 *  T-1114 tuning: unlike a settler, a crew has NO cap at all in the engine (pirateLairs.ts's own
 *  header — `crewSupply` is a bare counter with nothing like `piecesLeft` behind it), so an untuned
 *  bot stockpiles crews indefinitely once a harbor settlement exists, even with every active lair
 *  already fully crewed or long since captured — pure resource waste. Discovered tuning the
 *  full-campaign sim (T-1114) the same way the `epSettlerBuildCandidates` stockpiling was: capped to
 *  only build while at least one lair is still ACTIVE (`pirateLairsOf` non-empty — a captured lair is
 *  removed from that list, pirateLairs.ts) and no unspent crew is already sitting in reserve. Harmless
 *  for Pirate Lairs' own single-mission sim (T-1113), which never needed more than one crew in flight
 *  either. Also checks that no ship of this seat ALREADY carries an unspent `'crew'` (loaded but not
 *  yet landed) — mirrors `epSettlerBuildCandidates`'s own second T-1114 finding: a crew can get stuck
 *  in transit the same way a settler can (e.g. its target lair gets captured by another seat before
 *  this one's ship arrives), and stockpiling MORE crews on top of one already stuck just strangles
 *  more of the fleet's cargo capacity for no additional chance of ever landing one. */
function epCrewBuildCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  if (!epPirateLairsMissionActive(state)) return [];
  const player = state.players[seat];
  if (!player || !canAfford(player, EP_CREW_COST)) return [];
  if (harborSettlementsOf(state, seat).length === 0) return [];
  if (pirateLairsOf(state).length === 0) return [];
  if (crewSupplyOf(state, seat) > 0) return [];
  if (shipsOfSeat(state, seat).some((s) => s.cargo.includes('crew'))) return [];
  return [{ type: 'buildEPCrew' }];
}

/** EP3.3/EP7.1 (T-1113): load a reserved crew onto one of `seat`'s own ships touching their own
 *  coastal settlement/city/harbor settlement (mirrors `epLoadSettlerCandidates`'s exact shape/
 *  precondition — `loadCargoHandler`'s own `shipTouchesOwnBuilding` check applies identically to a
 *  `'crew'` piece) with cargo room — one candidate per eligible ship. Gated on
 *  `epPirateLairsMissionActive`. */
function epLoadCrewCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  if (!epPirateLairsMissionActive(state)) return [];
  if (crewSupplyOf(state, seat) <= 0) return [];
  const out: Action[] = [];
  const geometry = geometryForState(state);
  for (const ship of shipsOfSeat(state, seat)) {
    if (ship.cargo.length >= SHIP_CARGO_CAP) continue;
    const edge = geometry.edges[ship.edge];
    if (!edge) continue;
    const ownsEnd = [edge.a, edge.b].some(
      (v) =>
        (state.players[seat]?.settlements.includes(v) ?? false) ||
        (state.players[seat]?.cities.includes(v) ?? false) ||
        harborSettlementsOf(state, seat).includes(v)
    );
    if (ownsEnd) out.push({ type: 'loadCargo', ship: ship.edge, piece: 'crew' });
  }
  return out;
}

/** EP7.2 (The Pirate Lairs, T-1113): one `placeCrewOnLair` candidate per still-active lair `seat` has
 *  a `'crew'`-carrying ship adjacent to — mirrors `placeCrewOnLairHandler`'s own precondition (a ship
 *  of the acting seat, carrying crew cargo, on an edge bordering the lair's hex); the handler itself
 *  resolves whichever of `seat`'s own eligible ships it finds first, so this candidate only needs to
 *  confirm ONE exists (same "existence check, not exact-ship resolution" shape as
 *  `epFishDeliverCandidates`/`epSpiceDeliverCandidates` above, since `placeCrewOnLair`'s action has no
 *  ship field to disambiguate). Gated on `epPirateLairsMissionActive`. */
function epPlaceCrewOnLairCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  if (!epPirateLairsMissionActive(state)) return [];
  const lairs = pirateLairsOf(state);
  if (lairs.length === 0) return [];
  const ownShips = shipsOfSeat(state, seat);
  const geometry = geometryForState(state);
  const out: Action[] = [];
  for (const lair of lairs) {
    const hasCrewShip = ownShips.some(
      (s) => s.cargo.includes('crew') && (geometry.edges[s.edge]?.hexes.includes(lair.hex) ?? false)
    );
    if (hasCrewShip) out.push({ type: 'placeCrewOnLair', hex: lair.hex });
  }
  return out;
}

/** EP4.1: build a settler whenever `seat` can afford one (a reserve piece — no board target).
 *  T-1114 tuning: `settlerSupply` has NO cap of its own (settling.ts's "build now, load later" v1
 *  model — see that file's own header), so an untuned bot happily stockpiles settler reserve forever
 *  once affordable, even after every physical settlement piece is already placed/founded
 *  (`piecesLeft.settlements === 0`, so a stockpiled settler could NEVER be founded) or while one is
 *  already sitting unspent waiting for a ship. Discovered while tuning the full-campaign sim
 *  (T-1114): with three missions competing for the same 3-ship/2-cargo-slot budget, this waste
 *  (resources burned on reserve pieces that can never be used) was starving the ships/harbor
 *  upgrades/mission cargo that actually convert into VP, and games stalled well short of the 17-VP
 *  target. Capped here (not in the engine — `buildEPSettler` itself stays exactly as legal as before,
 *  this only trims which candidates the BOT proposes) the same way `epCrewBuildCandidates` below caps
 *  crew stockpiling; harmless for every other E&P scenario (Land Ho!/Fish/Spice/Pirate Lairs), which
 *  never needed more than one settler in flight at a time either.
 *  A second T-1114 finding on the SAME sim: capping the RESERVE (`settlerSupplyOf`) alone wasn't
 *  enough — once the map fills up (every reachable, distance-rule-legal vertex already settled),
 *  `epFoundSettlementCandidates` below can permanently stop finding anywhere to found a carried
 *  settler, so it sits stuck in a ship's cargo bay FOREVER; since a load immediately zeroes the
 *  reserve again, the reserve-only cap then happily authorizes building ANOTHER settler next turn,
 *  which gets loaded onto a DIFFERENT ship and gets stuck the same way — repeat across the whole
 *  fleet until every ship has a dead settler permanently occupying half its cargo bay, strangling
 *  fish/spice/crew throughput exactly when three missions need it most. Also checks that no ship of
 *  this seat ALREADY carries an unspent `'settler'` (loaded but not yet founded) — that ship's own
 *  unresolved cargo is reason enough to hold off building a fresh one. */
function epSettlerBuildCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  const player = state.players[seat];
  if (!player || !canAfford(player, EP_SETTLER_COST)) return [];
  if (player.piecesLeft.settlements <= 0) return [];
  if (settlerSupplyOf(state, seat) > 0) return [];
  if (shipsOfSeat(state, seat).some((s) => s.cargo.includes('settler'))) return [];
  return [{ type: 'buildEPSettler' }];
}

/** EP3.3/EP4.1: load a reserved settler onto one of `seat`'s own ships touching their own coastal
 *  settlement/city/harbor settlement (v1 harbor substitute, ships.ts's own header) with cargo room —
 *  one candidate per eligible ship. */
function epLoadSettlerCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  if (settlerSupplyOf(state, seat) <= 0) return [];
  const out: Action[] = [];
  const geometry = geometryForState(state);
  for (const ship of shipsOfSeat(state, seat)) {
    if (ship.cargo.length >= SHIP_CARGO_CAP) continue;
    const edge = geometry.edges[ship.edge];
    if (!edge) continue;
    const ownsEnd = [edge.a, edge.b].some(
      (v) =>
        (state.players[seat]?.settlements.includes(v) ?? false) ||
        (state.players[seat]?.cities.includes(v) ?? false) ||
        harborSettlementsOf(state, seat).includes(v)
    );
    if (ownsEnd) out.push({ type: 'loadCargo', ship: ship.edge, piece: 'settler' });
  }
  return out;
}

/** EP4.1: every legal `foundSettlement` target — every ship of `seat`'s carrying a `'settler'` cargo
 *  unit, expanded to every distance-rule-legal, currently-unoccupied, discovered-land vertex incident
 *  to that ship's edge (mirrors `foundSettlementHandler`'s own precondition checks exactly). */
function epFoundSettlementCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  if ((state.players[seat]?.piecesLeft.settlements ?? 0) <= 0) return [];
  const out: Action[] = [];
  const seen = new Set<number>();
  const geometry = geometryForState(state);
  for (const ship of shipsOfSeat(state, seat)) {
    if (!ship.cargo.includes('settler')) continue;
    const edge = geometry.edges[ship.edge];
    if (!edge) continue;
    for (const v of [edge.a, edge.b]) {
      if (seen.has(v)) continue;
      seen.add(v);
      if (
        satisfiesDistanceRule(state, v) &&
        !isVertexOccupied(state, v) &&
        vertexTouchesDiscoveredLand(state, v)
      ) {
        out.push({ type: 'foundSettlement', vertex: v });
      }
    }
  }
  return out;
}

/** EP4.2: every one of `seat`'s own settlements affordably upgradeable to a harbor settlement. */
function epUpgradeToHarborCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  const player = state.players[seat];
  if (!player || !canAfford(player, EP_HARBOR_COST)) return [];
  return player.settlements.map((vertex) => ({ type: 'upgradeToHarbor', vertex }) as Action);
}

/** EP6.2: convert `GOLD_PER_VP` (3, ⚠ VERIFY) accumulated gold into a flat 1 VP whenever `seat` has
 *  enough — mirrors `shipGoldHandler`'s own sole precondition exactly (`shipGoldHandler`'s own header
 *  notes this is a "fee-for-effect" action with NO ship/board anchor, unlike `deliverFish`/
 *  `deliverSpice`).
 *  T-1114 finding (tuning the full-campaign sim): the sim bot never proposed `shipGold` AT ALL before
 *  this task — a genuine gap across EVERY E&P scenario (Land Ho!/Fish/Spice/Pirate Lairs too), not
 *  merely full-campaign-specific, since `goldPointsVp` (vp.ts) already counts toward EVERY E&P game's
 *  total regardless of mission flags. It mattered enormously for the full campaign specifically
 *  because gold accrues automatically every non-producing roll (`applyGoldCompensation`,
 *  index.ts's `afterAction` hook) with NO ship or location requirement at all — the ONE VP source
 *  completely immune to a ship becoming stranded (see `seaEdgeDistanceToGoals`'s own header: once
 *  enough of the board is explored, a ship can end up on an edge whose bordering hexes have ALL been
 *  revealed as real terrain, at which point `isSeaEdge` reads false for it and every edge in its
 *  reachable radius, and it can never move — or deliver its cargo — again). A full campaign's much
 *  higher 17-VP target demands enough exploration that this eventually happens to SOME ship in a
 *  meaningful fraction of games (measured empirically while tuning this task, worse at 4p than 3p —
 *  more ships collectively explore faster), so giving every seat a guaranteed, location-independent
 *  VP trickle keeps a game winnable even after losing part of its fleet to stranding. Harmless for
 *  every other E&P scenario too (an additional candidate, never a replacement — can only help
 *  convergence, never hurt it). */
function epGoldShipCandidates(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  if (epGoldOf(state, seat) < GOLD_PER_VP) return [];
  return [{ type: 'shipGold' }];
}

/** EP growth actions folded into the base bot's `buildBuy` bucket (same 70%-bias treatment as
 *  settlements/cities/roads): ship building, settlers, founding, harbor upgrades, (T-1111) delivering
 *  carried fish for VP, (T-1112) trading for + delivering spice for VP, and (T-1113) building crews /
 *  loading them / placing them on a lair. Ship MOVEMENT is deliberately excluded — see this section's
 *  own header for why it lives in the "other" bucket instead. `(T-1114) shipGold` is ALSO deliberately
 *  excluded here — see `mainAction`'s own rate-limited inclusion of it, right where `buildBuy` gets
 *  this function's own candidates folded in, for why. `[]` outside an E&P game. */
function explorersPiratesBuildBuy(state: GameState, seat: Seat): Action[] {
  if (!isExplorersPiratesState(state)) return [];
  return [
    ...epShipBuildCandidates(state, seat),
    ...epSettlerBuildCandidates(state, seat),
    ...epLoadSettlerCandidates(state, seat),
    ...epFoundSettlementCandidates(state, seat),
    ...epUpgradeToHarborCandidates(state, seat),
    ...epFishDeliverCandidates(state, seat),
    ...epSpiceTradeCandidates(state, seat),
    ...epSpiceDeliverCandidates(state, seat),
    ...epCrewBuildCandidates(state, seat),
    ...epLoadCrewCandidates(state, seat),
    ...epPlaceCrewOnLairCandidates(state, seat),
  ];
}

function setupAction(state: GameState, rng: number): BotDecision {
  if (state.phase.kind !== 'setup') throw new Error('BUG: setupAction outside the setup phase');
  if (state.phase.expect === 'settlement') {
    return pick(
      rng,
      legalSetupSettlements(state).map((vertex) => ({ type: 'placeSetupSettlement', vertex }) as Action)
    );
  }
  return pick(rng, legalSetupRoads(state).map((edge) => ({ type: 'placeSetupRoad', edge }) as Action));
}

function preRollAction(state: GameState, seat: Seat, rng: number): BotDecision {
  // C11.1: base dev cards are disabled in a C&K game (never in hand — devCardCandidates would be
  // empty anyway — but skipped explicitly for clarity); Alchemist (C6.4/C6.5) is the ONE progress
  // card playable before rolling, so it's offered here instead of in `mainAction`'s post-roll set.
  const candidates: Action[] = isCitiesKnightsState(state)
    ? [{ type: 'rollDice' }, ...alchemistCandidates(state, seat)]
    : [{ type: 'rollDice' }, ...devCardCandidates(state, seat)];
  return pick(rng, candidates);
}

function moveRobberAction(state: GameState, rng: number): BotDecision {
  // Seafarers (S8.2): the mover may relocate the robber (to land) OR the pirate (to a sea hex).
  const candidates: Action[] = [
    ...legalRobberHexes(state).map((hex) => ({ type: 'moveRobber', hex }) as Action),
    ...legalPirateHexes(state).map((hex) => ({ type: 'movePirate', hex }) as Action),
  ];
  return pick(rng, candidates);
}

function stealAction(state: GameState, rng: number): BotDecision {
  if (state.phase.kind !== 'steal') throw new Error('BUG: stealAction outside the steal phase');
  // The steal phase carries its own candidate set (robber OR pirate steal), so use it directly.
  return pick(rng, state.phase.candidates.map((from) => ({ type: 'steal', from }) as Action));
}

function roadBuildingAction(state: GameState, seat: Seat, rng: number): BotDecision {
  // legalFreeRoadEdges applies the seafarers land-edge filter (a free road can't go on a pure sea
  // route, S3.2) and the ship-aware occupancy check; in a base game it's plain canPlaceRoad.
  // Seafarers (S11.1): a free piece may also be a ship.
  const candidates: Action[] = [
    ...legalFreeRoadEdges(state, seat).map((edge) => ({ type: 'placeFreeRoad', edge }) as Action),
    ...legalFreeShipEdges(state, seat).map((edge) => ({ type: 'placeFreeShip', edge }) as Action),
  ];
  return pick(rng, candidates);
}

/** Gold sub-phase (S9/ER-S7): pick `goldPickCount` cards uniformly at random from the bank's current
 * stock, drawn without replacement — so no pick exceeds the bank and the sum matches the entitlement
 * (capped by bank availability, R5.3). */
function goldAction(state: GameState, seat: Seat, rng: number): BotDecision {
  const need = goldPickCount(state, seat);
  const pool: ResourceType[] = [];
  for (const res of RESOURCE_TYPES) for (let i = 0; i < state.bank[res]; i++) pool.push(res);
  const picks: ResourceBundle = {};
  let r = rng;
  for (let i = 0; i < need; i++) {
    const draw = pickIndex(r, pool.length);
    r = draw.state;
    const res = pool[draw.value]!;
    picks[res] = (picks[res] ?? 0) + 1;
    pool.splice(draw.value, 1);
  }
  return { action: { type: 'chooseGoldResource', picks }, rng: r };
}

/** Discard sub-phase (R6.1): a uniformly random valid discard of exactly the owed count, drawn
 * without replacement from the seat's flattened hand. */
function discardAction(state: GameState, seat: Seat, rng: number): BotDecision {
  if (state.phase.kind !== 'discard') throw new Error('BUG: discardAction outside the discard phase');
  const owed = state.phase.amounts[seat];
  const player = state.players[seat];
  if (!player) throw new Error(`BUG: discard requested for unknown seat ${seat}`);

  const pool: ResourceType[] = [];
  for (const res of RESOURCE_TYPES) {
    for (let i = 0; i < player.resources[res]; i++) pool.push(res);
  }

  const cards: ResourceBundle = {};
  let r = rng;
  for (let i = 0; i < owed; i++) {
    const draw = pickIndex(r, pool.length);
    r = draw.state;
    const res = pool[draw.value]!;
    cards[res] = (cards[res] ?? 0) + 1;
    pool.splice(draw.value, 1);
  }
  return { action: { type: 'discard', cards }, rng: r };
}

/** R8.1: a non-owner seat responds to the open offer. `accept` is only proposed when the seat
 *  actually holds the offer's `receive` cards — `respondTrade` now rejects an unfulfillable accept
 *  (B-21 confirm-safety), so an unconditional accept would be an illegal action. */
function respondTradeAction(state: GameState, seat: Seat, rng: number): BotDecision {
  if (state.trade == null) throw new Error('BUG: respondTradeAction with no open trade offer');
  const responder = state.players[seat];
  const canAccept = !!responder && hasAtLeast(responder.resources, state.trade.receive);
  return pick(
    rng,
    canAccept
      ? [
          { type: 'respondTrade', response: 'accept' },
          { type: 'respondTrade', response: 'decline' },
        ]
      : [{ type: 'respondTrade', response: 'decline' }],
  );
}

function mainAction(state: GameState, seat: Seat, rng: number): BotDecision {
  // Explorers & Pirates (T-1114 tuning, discovered on the full-campaign sim): a ship sitting ready to
  // cash in a mission action — deliver carried fish/spice for VP, trade for spice at a village, or
  // land a crew on an active lair — is a rare, precious opportunity: unlike `buildRoad`/
  // `buildSettlement`/`buildCity` below (which each contribute MANY candidate edges/vertices to
  // `buildBuy`, so get picked often by sheer count), each of these is always exactly one (or a small
  // handful) of candidates. Once folded into `buildBuy` alongside dozens of legal road/settlement/
  // city candidates (`explorersPiratesBuildBuy` below), `buildBuy`'s uniform `pick()` drowned these
  // out badly enough — especially with all three missions (and, once added, the gold economy)
  // competing for the same ships at once — that VP-scoring actions happened far too rarely to reach
  // the full campaign's 17-VP target within a generous action budget, AND (once `shipGold` needed
  // rate-limiting below) even competed away enough of Spices for Hexhaven's OWN spice-trade throughput
  // to dip its single-mission sim below its own pre-existing bar — so `epSpiceTradeCandidates` joined
  // this bucket too, not just the two deliveries and the lair-landing. Checked FIRST here, strongly
  // biased (90%) toward taking the opportunity immediately, mirrors the SAME "a small, precious set
  // must not be diluted by a much larger one" rationale the buildBuy-vs-other 70% split below already
  // established. Still folded into `buildBuy` too (via `explorersPiratesBuildBuy`) as a fallback for
  // the 10% miss case. `[]` outside a live E&P game (every candidate helper already returns `[]`
  // there), so this is a no-op for every non-E&P game.
  // T-1114: tracks whether `seat` had a fish/spice/lair scoring opportunity THIS turn — read further
  // below to additionally gate `shipGold`'s own rate-limited roll (see that roll's own header for
  // why gold needs a SECOND gate beyond a bare probability). `false` outside a live E&P game.
  let epHadScoringOpportunity = false;
  if (isExplorersPiratesState(state)) {
    const epScoringBuy: Action[] = [
      ...epFishDeliverCandidates(state, seat),
      ...epSpiceTradeCandidates(state, seat),
      ...epSpiceDeliverCandidates(state, seat),
      ...epPlaceCrewOnLairCandidates(state, seat),
      // T-1114: deliberately NOT `epGoldShipCandidates` here — gold accrues passively every non-
      // producing roll with zero ship/travel cost, so it's available FAR more often than a delivery/
      // lair-landing ever could be; giving it the SAME 90%-biased top billing as those three made it
      // dominate so heavily that full-campaign games started completing via almost pure gold-farming
      // in a few hundred actions, with fish/spice barely engaged at all (measured while tuning this
      // task: `gamesWithAFishDeliveryFraction` collapsed well below the "missions actually fire"
      // bar). Left in the regular `buildBuy` bucket only (`explorersPiratesBuildBuy`), diluted the
      // same way every other growth action already is — still fires often enough over a game's
      // length to rescue a stalled game from a stranded ship (this block's own header), without
      // crowding out genuine mission play.
    ];
    epHadScoringOpportunity = epScoringBuy.length > 0;
    if (epHadScoringOpportunity) {
      const biased = chance(rng, 0.9);
      if (biased.hit) return pick(biased.rng, epScoringBuy);
      rng = biased.rng;
    }
  }

  const buildBuy: Action[] = [];
  const afford = buildAffordability(state, seat);
  if (afford.road) buildBuy.push(...legalRoadEdges(state, seat).map((edge) => ({ type: 'buildRoad', edge }) as Action));
  if (afford.settlement) {
    buildBuy.push(
      ...legalSettlementVertices(state, seat).map((vertex) => ({ type: 'buildSettlement', vertex }) as Action)
    );
  }
  if (afford.city) {
    buildBuy.push(...legalCityVertices(state, seat).map((vertex) => ({ type: 'buildCity', vertex }) as Action));
  }
  const player = state.players[seat];
  // C11.1: buyDevCard is disabled entirely in a Cities & Knights game (progress cards replace the
  // dev deck) — never offered there, or `reduce` rejects it with DEV_CARDS_DISABLED.
  if (
    player &&
    !isCitiesKnightsState(state) &&
    state.devDeck.length > 0 &&
    canAfford(player, costsForState(state).devCard)
  ) {
    buildBuy.push({ type: 'buyDevCard' });
  }
  // Seafarers (S4): ship builds join the build/buy set so the sim's build bias drives ship play.
  if (canBuildShip(state, seat)) {
    buildBuy.push(...legalShipEdges(state, seat).map((edge) => ({ type: 'buildShip', edge }) as Action));
  }
  // Cities & Knights (T-807): improvements/knights/walls join the build/buy set (empty outside a
  // C&K game) so the sim's build bias drives C&K subsystem play the same way it drives base builds.
  buildBuy.push(...citiesKnightsBuildBuy(state, seat));
  // Rivers (T-1003): bridge builds join the build/buy set (empty outside a rivers game) so the
  // sim's build bias drives bridge play the same way it drives base builds.
  buildBuy.push(...bridgeCandidates(state, seat));
  // Barbarian Attack (T-1005): knight recruits join the build/buy set (empty outside a
  // barbarianAttack game) so the sim's build bias drives knight recruitment the same way it drives
  // base builds — the scenario's whole "knights intercept barbarians" premise needs SOME knights on
  // the board to ever exercise combat/pillage.
  buildBuy.push(...knightRecruitCandidates(state, seat));
  // The main scenario (T-1006): wagon loads/moves join the build/buy set (empty outside that
  // scenario) so the sim's build bias actually drives the trade-route economy — otherwise a wagon
  // could sit idle for an entire game and never exercise delivery/production.
  buildBuy.push(...wagonLoadCandidates(state, seat), ...wagonMoveCandidates(state, seat));
  // Explorers & Pirates Land Ho! (T-1107): ship builds/settlers/founding/harbor upgrades join the
  // build/buy set (empty outside an E&P game) — the only paths to Land Ho!'s 8-VP target.
  buildBuy.push(...explorersPiratesBuildBuy(state, seat));
  // Explorers & Pirates gold economy (T-1114): `shipGold` deliberately does NOT use a `chance()` roll
  // like `moveBarbarianKnight`/domestic-offer/`epShipMoveCandidates` do — a `chance()` draw
  // consumes/returns a new rng value on EVERY call regardless of hit or miss, so even a low flat
  // probability checked every `mainAction` call chaotically perturbed the WHOLE downstream rng stream
  // in every E&P game; measured while tuning this task, that alone was enough to knock Spices for
  // Hexhaven's OWN pre-existing single-mission sim numbers around unpredictably (T-1112's suite — no
  // fish/lair competition there, so it's maximally sensitive to any extra draw). A first attempt at a
  // rng-free gate — `movableEPShips(state, seat).length === 0` — was ALSO wrong: that's `true` for
  // the REST of any turn right after a seat's one-or-few ships have already used their single
  // per-turn move (`movedShipsThisTurn`, ships.ts), not just for a genuinely stranded fleet, so it
  // fired constantly and devastated every scenario's mission stats the same way the naive always-on
  // version did. The RIGHT rng-free signal for "genuinely stranded" is EVERY owned ship's current
  // edge having permanently stopped being a sea edge (`isSeaEdge`, ships.ts) — the actual failure mode
  // `seaEdgeDistanceToGoals`'s own header describes (enough of the board explored around a ship that
  // it can never move OR deliver its cargo again), not merely "already moved this turn". Combined
  // with `!epHadScoringOpportunity`, gold-shipping now fires ONLY when `seat` owns at least one ship
  // AND every single one of them is stranded — a state that, once reached, persists for the REST of
  // the game (a stranded ship never un-strands), so it reliably keeps converting that seat's gold into
  // VP from then on without ever touching a normal, mobile game's rng stream or candidate pool at all.
  if (isExplorersPiratesState(state) && !epHadScoringOpportunity) {
    const ownShips = shipsOfSeat(state, seat);
    const strandedShips = ownShips.filter((s) => !isSeaEdge(state, s.edge));
    if (ownShips.length > 0 && strandedShips.length === ownShips.length) {
      // Fully stranded: always offer it, no roll needed (see this block's own header).
      buildBuy.push(...epGoldShipCandidates(state, seat));
    } else {
      // T-1114 (second finding): a handful of seeds still deadlocked for hundreds of thousands of
      // actions even with the fully-stranded escape hatch above — a PARTIALLY stranded fleet (or a
      // fully mobile one stuck in some other unproductive rut this bot's heuristics don't resolve)
      // can apparently still starve just as badly. A tiny supplementary `chance()` roll (not gated on
      // any stranding at all) gives every seat SOME residual chance to convert idle gold even outside
      // the fully-stranded case — kept extremely low so it stays negligible for a normal, healthy
      // single-mission game (this rate was tuned specifically to avoid re-perturbing Spices for
      // Hexhaven's own sim numbers the way a higher flat rate did earlier in this task).
      const goldRoll = chance(rng, 0.01);
      rng = goldRoll.rng;
      if (goldRoll.hit) buildBuy.push(...epGoldShipCandidates(state, seat));
    }
  }
  // Seafarers (S7): open-ship relocations — a rarer, non-build move kept in the "other" set below.
  const shipMoves: Action[] = [];
  for (const from of movableShips(state, seat)) {
    shipMoves.push(...shipMoveTargets(state, seat, from).map((to) => ({ type: 'moveShip', from, to }) as Action));
  }

  // Paired-Players partial turn (X12): supply trade + build + ≤1 dev card + pass. NO player trades,
  // no roll, no plain endTurn (`passSpecialBuild` ends it). `phase` is `main` but `ext` marks it.
  if (partialTurnOf(state) !== null) {
    const partialOther: Action[] = [
      { type: 'passSpecialBuild' },
      ...shipMoves,
      ...bankTradeCandidates(state, seat),
      ...devCardCandidates(state, seat),
    ];
    if (buildBuy.length > 0) {
      const biased = chance(rng, 0.7);
      if (biased.hit) return pick(biased.rng, buildBuy);
      return pick(biased.rng, [...buildBuy, ...partialOther]);
    }
    return pick(rng, partialOther);
  }

  const other: Action[] = [
    { type: 'endTurn' },
    ...shipMoves,
    ...bankTradeCandidates(state, seat),
    ...devCardCandidates(state, seat),
    // Cities & Knights (T-807): knight moves/displaces, robber chase, commodity trades, progress
    // cards — empty outside a C&K game.
    ...citiesKnightsOther(state, seat),
    // Fishermen (T-1002): fish exchanges + Old Boot passes — empty outside a fishermen game.
    ...fishExchangeCandidates(state, seat),
    ...passOldBootCandidates(state, seat),
    // Rivers (T-1003): coin-for-resource trades — empty outside a rivers game.
    ...coinTradeCandidates(state, seat),
  ];
  let r = rng;
  // Barbarian Attack (T-1005): knight repositioning — empty outside a barbarianAttack game. Once a
  // seat holds ANY active knight, `moveBarbarianKnight` is available EVERY turn (knights reactivate
  // at the start of their owner's own turn, barbarianAttack.ts's `applyBarbarianAdvance`) and is
  // essentially free (the base range costs nothing) — offering it unconditionally every turn made it
  // dominate the random choice so thoroughly that games never converged within the I10 budget (same
  // failure mode `offerTradeCandidate`'s comment below describes for domestic trades). Rate-limited
  // to a rare roll, mirroring that same fix, so the recruit/move/combat loop still gets exercised
  // across many games without swallowing any single game's action budget. Gated on
  // `isBarbarianAttackState` BEFORE drawing (not just when deciding whether to push the result) —
  // an unconditional `chance()` draw here would consume an extra rng value on EVERY `mainAction` call
  // in every game, including base/other-expansion ones, silently shifting every later random pick
  // and breaking the RK-13 base-game oracle (caught by that exact regression test).
  if (isBarbarianAttackState(state)) {
    const knightMoveRoll = chance(r, 0.05);
    r = knightMoveRoll.rng;
    if (knightMoveRoll.hit) other.push(...knightMoveCandidates(state, seat));
  }
  // Explorers & Pirates Land Ho! (T-1107): ship MOVES are near-free and always legal (no cost, and
  // `SHIP_MOVE_RANGE` reaches dozens of edges) — this section's own header explains why they're
  // rate-limited here exactly like `moveBarbarianKnight`/domestic trades above/below, rather than
  // offered unconditionally. Gated on `isExplorersPiratesState` BEFORE drawing (same RK-13 rationale
  // as the barbarianAttack roll above — an unconditional draw here would shift every later pick in
  // every base/other-expansion game).
  // T-1114 tuning: bumped 0.3 -> 0.55 while tuning the full-campaign sim — with fish/spice/lairs ALL
  // competing for the same 3-ships-per-seat budget at once (vs. one mission or none for every other
  // E&P scenario), ship-move throughput at 0.3 left deliveries/crew-landings too rare to reach the
  // 17-VP target within a generous action budget (`epShipMoveCandidates`'s own T-1114 update reworked
  // WHERE ships steer; this is the complementary "how often they get a chance to move" knob). Purely
  // a rate constant — every other E&P scenario (Land Ho!/Fish/Spice/Pirate Lairs) only converges
  // faster with more ship-move opportunities, never worse; no other game ever reaches this branch
  // (`isExplorersPiratesState` gate, RK-13-safe).
  if (isExplorersPiratesState(state)) {
    const shipMoveRoll = chance(r, 0.55);
    r = shipMoveRoll.rng;
    if (shipMoveRoll.hit) other.push(...epShipMoveCandidates(state, seat));
  }
  if (state.trade == null) {
    // A domestic offer forces EVERY other seat to respond before the owner acts again (R8.1,
    // nextActor in runGame.ts) — 4-5 actions per cycle for very little progress since
    // `offerTradeCandidate` always proposes the same representative bundle. Left as an
    // always-available candidate, this bot spent >50% of a 4,000-action budget cycling
    // offer/respond/cancel on seed "sim-836" without ever reaching 10 VP (an I10 near-miss this
    // task's own bias knob doesn't cover, since it's about the build/buy-vs-endTurn split, not
    // trade churn) — so a domestic offer is only ever proposed on a rare dice roll here, keeping
    // R8.1's offer/respond/confirm/cancel path exercised over 1,000 games without dominating any
    // single game's budget.
    const roll = chance(r, 0.05);
    r = roll.rng;
    if (roll.hit) {
      const offer = offerTradeCandidate(state, seat);
      if (offer) other.push(offer);
    }
  } else {
    other.push({ type: 'cancelTrade' });
    const summary = tradeOfferSummary(state);
    if (summary) {
      for (const withSeat of summary.confirmable) other.push({ type: 'confirmTrade', with: withSeat });
    }
  }

  if (buildBuy.length > 0) {
    const biased = chance(r, 0.7);
    if (biased.hit) return pick(biased.rng, buildBuy);
    return pick(biased.rng, [...buildBuy, ...other]);
  }
  return pick(r, other);
}

/**
 * The engine's random-legal-move bot (task requirement 1). `seat` need not be `state.turn.player`
 * — `discard` and `respondTrade` are the two exceptions reduce.ts's actor guard allows, and
 * sim/runGame.ts's `nextActor` is what decides when to call this for a non-owner seat.
 */
export function randomBot(state: GameState, seat: Seat, rng: number): BotDecision {
  if (state.phase.kind === 'discard') return discardAction(state, seat, rng);
  // Seafarers gold (S9/ER-S7): a pending seat (possibly a non-owner) submits its resource choice.
  if (state.phase.kind === 'chooseGoldResource') return goldAction(state, seat, rng);
  // Caravans (T-1004, §TB4.2): a pending seat bids, or the resolved winner places a camel — both
  // possibly a non-owner, like discard/gold above.
  if (state.phase.kind === 'caravanVote') return caravanVoteAction(state, seat, rng);
  // 5–6 SBP (X12): the current builder acts although `turn.player` is the seat whose turn just
  // ended — handle before the non-owner `respondTrade` fallback below.
  if (state.phase.kind === 'specialBuild') {
    return pick(rng, legalSpecialBuildActions(state, seat));
  }
  if (seat !== state.turn.player) return respondTradeAction(state, seat, rng);

  switch (state.phase.kind) {
    case 'setup':
      return setupAction(state, rng);
    case 'preRoll':
      return preRollAction(state, seat, rng);
    case 'moveRobber':
      return moveRobberAction(state, rng);
    case 'steal':
      return stealAction(state, rng);
    case 'roadBuilding':
      return roadBuildingAction(state, seat, rng);
    case 'main':
      return mainAction(state, seat, rng);
    case 'ended':
      throw new Error('BUG: randomBot called on an ended game');
  }
}
