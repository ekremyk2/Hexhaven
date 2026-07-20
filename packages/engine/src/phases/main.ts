// The main phase (R4 step 2): build roads/settlements/cities, maritime bank trades (R8.2),
// domestic trading (R8.1: offer/respond/confirm/cancel), and development cards (R9: buy + the
// four play actions — phases/devCards.ts). Registered as the `main` handler.

import { addBundles, bundleTotal, hasAtLeast, subtractBundles } from '@hexhaven/shared';
import type {
  EdgeId,
  EngineErrorCode,
  GameEvent,
  GameState,
  ResourceBundle,
  ResourceType,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import type { EngineResult, PhaseHandler } from '../reduce.js';
import {
  bankTraded,
  built,
  tradeCancelled,
  tradeCompleted,
  tradeOffered,
  tradeResponded,
} from '../events.js';
import { costsForState, geometryForState } from '../modules/index.js';
import { canAfford, payToBank } from '../rules/afford.js';
import { canPlaceRoad, isRoadConnected, ownRoadOrShipAt } from '../rules/connectivity.js';
import { tradeRate } from '../rules/harbors.js';
import { isEdgeOccupied, isVertexOccupied } from '../rules/placement.js';
import { updateAwards } from '../rules/awards.js';
import {
  buyDevCard,
  playKnight,
  playMonopoly,
  playRoadBuilding,
  playYearOfPlenty,
} from './devCards.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/**
 * Common tail for every build: recompute awards (stub until T-110/T-111) and cancel any open
 * domestic trade offer (ER-11). `next` is the state with the piece already placed and paid.
 */
function finishBuild(next: GameState, builtEvent: GameEvent): EngineResult {
  const awarded = updateAwards(next);
  let state = awarded.state;
  const events: GameEvent[] = [builtEvent, ...awarded.events];
  if (state.trade != null) {
    state = { ...state, trade: null };
    events.push(tradeCancelled());
  }
  return { ok: true, state, events };
}

function buildRoad(state: GameState, seat: Seat, edge: EdgeId): EngineResult {
  if (!geometryForState(state).edges[edge]) return fail('BAD_LOCATION', `edge ${edge} is off the board`);
  if (isEdgeOccupied(state, edge)) return fail('OCCUPIED', `edge ${edge} already has a road`);
  const player = state.players[seat]!;
  if (player.piecesLeft.roads <= 0) return fail('NO_PIECES_LEFT', 'no road pieces left');
  if (!isRoadConnected(state, seat, edge)) {
    return fail('NOT_CONNECTED', `edge ${edge} does not connect to your network (R7.2)`);
  }
  const costs = costsForState(state);
  if (!canAfford(player, costs.road)) return fail('CANT_AFFORD', 'cannot afford a road');

  const { players, bank } = payToBank(state, seat, costs.road);
  const placed = players.map((p) =>
    p.seat === seat
      ? { ...p, roads: [...p.roads, edge], piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads - 1 } }
      : p
  );
  return finishBuild({ ...state, players: placed, bank }, built(seat, 'road', edge));
}

function buildSettlement(state: GameState, seat: Seat, vertex: VertexId): EngineResult {
  const vert = geometryForState(state).vertices[vertex];
  if (!vert) return fail('BAD_LOCATION', `vertex ${vertex} is off the board`);
  if (isVertexOccupied(state, vertex)) return fail('OCCUPIED', `vertex ${vertex} already has a building`);
  if (vert.neighbors.some((nb) => isVertexOccupied(state, nb))) {
    return fail('DISTANCE_RULE', `vertex ${vertex} is adjacent to a building (R7.3)`);
  }
  if (!ownRoadOrShipAt(state, seat, vertex)) {
    return fail('NOT_CONNECTED', 'a settlement must touch one of your roads or ships (R7.3/S4.3)');
  }
  const player = state.players[seat]!;
  if (player.piecesLeft.settlements <= 0) return fail('NO_PIECES_LEFT', 'no settlement pieces left');
  const costs = costsForState(state);
  if (!canAfford(player, costs.settlement)) return fail('CANT_AFFORD', 'cannot afford a settlement');

  const { players, bank } = payToBank(state, seat, costs.settlement);
  const placed = players.map((p) =>
    p.seat === seat
      ? {
          ...p,
          settlements: [...p.settlements, vertex],
          piecesLeft: { ...p.piecesLeft, settlements: p.piecesLeft.settlements - 1 },
        }
      : p
  );
  return finishBuild({ ...state, players: placed, bank }, built(seat, 'settlement', vertex));
}

function buildCity(state: GameState, seat: Seat, vertex: VertexId): EngineResult {
  const player = state.players[seat]!;
  if (!player.settlements.includes(vertex)) {
    return fail('BAD_LOCATION', 'a city must replace one of your own settlements (R7.4)');
  }
  if (player.piecesLeft.cities <= 0) return fail('NO_PIECES_LEFT', 'no city pieces left');
  const costs = costsForState(state);
  if (!canAfford(player, costs.city)) return fail('CANT_AFFORD', 'cannot afford a city');

  const { players, bank } = payToBank(state, seat, costs.city);
  const placed = players.map((p) =>
    p.seat === seat
      ? {
          ...p,
          settlements: p.settlements.filter((s) => s !== vertex),
          cities: [...p.cities, vertex],
          // R7.5: the replaced settlement returns to supply.
          piecesLeft: {
            ...p.piecesLeft,
            settlements: p.piecesLeft.settlements + 1,
            cities: p.piecesLeft.cities - 1,
          },
        }
      : p
  );
  return finishBuild({ ...state, players: placed, bank }, built(seat, 'city', vertex));
}

/**
 * R8.2 maritime trade: `rate`× `give` → bank, 1× `receive` → player, rate auto-computed from the
 * seat's harbors (rules/harbors.ts). No per-turn limit (multiple maritime trades are allowed).
 */
function bankTrade(state: GameState, seat: Seat, give: ResourceType, receive: ResourceType): EngineResult {
  if (give === receive) {
    return fail('BAD_TRADE', 'give and receive must be different resources (R8.2)');
  }
  const player = state.players[seat]!;
  const rate = tradeRate(state, seat, give);
  if (player.resources[give] < rate) {
    return fail(
      'CANT_AFFORD',
      `trading ${give} needs ${rate} cards at this rate, seat ${seat} holds ${player.resources[give]}`
    );
  }
  if (state.bank[receive] < 1) return fail('BANK_EMPTY', `the bank has no ${receive} left`);

  const bank = { ...state.bank };
  bank[give] += rate;
  bank[receive] -= 1;
  const players = state.players.map((p) => {
    if (p.seat !== seat) return p;
    const resources = { ...p.resources };
    resources[give] -= rate;
    resources[receive] += 1;
    return { ...p, resources };
  });

  const gave: ResourceBundle = {};
  gave[give] = rate;
  const got: ResourceBundle = {};
  got[receive] = 1;

  let next: GameState = { ...state, players, bank };
  const events: GameEvent[] = [bankTraded(seat, gave, got, rate)];
  // ER-11: like a build, a bank trade cancels any open domestic offer.
  if (next.trade != null) {
    next = { ...next, trade: null };
    events.push(tradeCancelled());
  }
  return { ok: true, state: next, events };
}

/**
 * R8.1/ER-4 domestic trade offer: turn owner only (dispatcher-guaranteed — `offerTrade` is not in
 * the actor-guard exemption list in reduce.ts). Both bundles must be non-empty and share no
 * resource type; the offerer must currently hold `give`. A previously open offer is replaced: its
 * implicit cancellation is emitted before the new `tradeOffered`.
 */
function offerTrade(
  state: GameState,
  seat: Seat,
  give: ResourceBundle,
  receive: ResourceBundle
): EngineResult {
  if (bundleTotal(give) === 0 || bundleTotal(receive) === 0) {
    return fail('BAD_TRADE', 'a trade must both give and receive at least one card (R8.1/FAQ #68)');
  }
  const sharesType = (Object.keys(give) as ResourceType[]).some(
    (res) => (give[res] ?? 0) > 0 && (receive[res] ?? 0) > 0
  );
  if (sharesType) {
    return fail('BAD_TRADE', 'give and receive must not share a resource type (ER-4)');
  }
  const player = state.players[seat]!;
  if (!hasAtLeast(player.resources, give)) {
    return fail('CANT_AFFORD', `seat ${seat} does not hold the offered cards`);
  }

  const events: GameEvent[] = [];
  if (state.trade != null) events.push(tradeCancelled()); // replaces any previous open offer
  events.push(tradeOffered(seat, give, receive));

  // Mark that a domestic offer was made this turn (turn.ts's `advanceTurn` clears it). Bots read
  // this to offer at most once per turn — the loop guard that lets bot-initiated trades be safe
  // (BUGS.md B-21). Humans aren't capped by this (the client lets them re-offer freely).
  return {
    ok: true,
    state: { ...state, turn: { ...state.turn, offeredThisTurn: true }, trade: { give, receive, responses: {} } },
    events,
  };
}

/**
 * R8.1 response to the open offer: legal for any non-owner seat while an offer is open (the
 * active player and any seat that isn't a real player in this game both fall through to
 * `NO_OPEN_OFFER`, per the task ruling). Idempotent — a later response overwrites an earlier one
 * (e.g. decline → accept) — and hands are NOT verified here: `confirmTrade` re-verifies at
 * execution time, since a responder may spend cards between accepting and being confirmed.
 */
function respondTrade(state: GameState, seat: Seat, response: 'accept' | 'decline'): EngineResult {
  if (state.trade == null) {
    return fail('NO_OPEN_OFFER', 'there is no open trade offer to respond to');
  }
  if (seat === state.turn.player || !state.players[seat]) {
    return fail('NO_OPEN_OFFER', `seat ${seat} cannot respond to this offer (R8.1)`);
  }
  // Accepting REQUIRES currently holding the offer's `receive` cards (B-21 confirm-safety): with this
  // guard, any `accepted` response is guaranteed fulfillable, so the offerer (esp. a bot, which can't
  // see opponents' exact hands from its redacted view) can confirm ANY accepter without the trade
  // dead-ending. Declining is always allowed. `confirmTrade` still re-verifies as belt-and-suspenders.
  if (response === 'accept' && !hasAtLeast(state.players[seat]!.resources, state.trade.receive)) {
    return fail('CANT_AFFORD', `seat ${seat} cannot accept — it does not hold the requested cards`);
  }

  const responded: 'accepted' | 'declined' = response === 'accept' ? 'accepted' : 'declined';
  const trade = { ...state.trade, responses: { ...state.trade.responses, [seat]: responded } };
  return { ok: true, state: { ...state, trade }, events: [tradeResponded(seat, responded)] };
}

/**
 * R8.1 completion: owner only. `with` must have accepted (`NOT_A_CANDIDATE` otherwise — this also
 * covers an unresponded or nonexistent seat, since `responses[with]` can only be 'accepted' for a
 * seat `respondTrade` actually let record one). Both hands are re-verified — either side may have
 * spent cards since the offer opened / was accepted — and on failure the offer stays open so the
 * owner can confirm a different accepter instead.
 */
function confirmTrade(state: GameState, seat: Seat, withSeat: Seat): EngineResult {
  const trade = state.trade;
  if (trade == null) return fail('NO_OPEN_OFFER', 'there is no open trade offer to confirm');
  if (trade.responses[withSeat] !== 'accepted') {
    return fail('NOT_A_CANDIDATE', `seat ${withSeat} has not accepted the open offer`);
  }
  const owner = state.players[seat]!;
  const partner = state.players[withSeat];
  if (!partner) throw new Error(`BUG: confirmTrade accepter seat ${withSeat} does not exist`);
  if (!hasAtLeast(owner.resources, trade.give) || !hasAtLeast(partner.resources, trade.receive)) {
    return fail('CANT_AFFORD', 'one side no longer holds the traded cards; the offer stays open');
  }

  const players = state.players.map((p) => {
    if (p.seat === seat) return { ...p, resources: swapHand(p.resources, trade.give, trade.receive) };
    if (p.seat === withSeat) return { ...p, resources: swapHand(p.resources, trade.receive, trade.give) };
    return p;
  });

  return {
    ok: true,
    state: { ...state, players, trade: null },
    events: [tradeCompleted(seat, withSeat, trade.give, trade.receive)],
  };
}

/** R8.1 explicit cancel: owner only (dispatcher-guaranteed). */
function cancelTrade(state: GameState): EngineResult {
  if (state.trade == null) return fail('NO_OPEN_OFFER', 'there is no open trade offer to cancel');
  return { ok: true, state: { ...state, trade: null }, events: [tradeCancelled()] };
}

/**
 * Apply a give/gain delta to a full hand via the shared bundle helpers, then refill any resource
 * `subtractBundles`/`addBundles` dropped to `undefined` after hitting exactly 0 — those helpers
 * operate on the sparse `ResourceBundle` shape, but `PlayerState.resources` is always a complete
 * `Record<ResourceType, number>`.
 */
function swapHand(
  resources: Record<ResourceType, number>,
  give: ResourceBundle,
  gain: ResourceBundle
): Record<ResourceType, number> {
  const merged = addBundles(subtractBundles(resources, give), gain);
  return {
    brick: merged.brick ?? 0,
    lumber: merged.lumber ?? 0,
    wool: merged.wool ?? 0,
    grain: merged.grain ?? 0,
    ore: merged.ore ?? 0,
  };
}

export const mainHandler: PhaseHandler = (state, seat, action): EngineResult => {
  switch (action.type) {
    case 'buildRoad':
      return buildRoad(state, seat, action.edge);
    case 'buildSettlement':
      return buildSettlement(state, seat, action.vertex);
    case 'buildCity':
      return buildCity(state, seat, action.vertex);
    case 'bankTrade':
      return bankTrade(state, seat, action.give, action.receive);
    case 'offerTrade':
      return offerTrade(state, seat, action.give, action.receive);
    case 'respondTrade':
      return respondTrade(state, seat, action.response);
    case 'confirmTrade':
      return confirmTrade(state, seat, action.with);
    case 'cancelTrade':
      return cancelTrade(state);
    case 'buyDevCard':
      return buyDevCard(state, seat);
    case 'playKnight':
      return playKnight(state, seat);
    case 'playRoadBuilding':
      return playRoadBuilding(state, seat);
    case 'playYearOfPlenty':
      return playYearOfPlenty(state, seat, action.a, action.b, action.extra);
    case 'playMonopoly':
      return playMonopoly(state, seat, action.resource);
    // `placeFreeRoad` is only legal inside the `roadBuilding` sub-phase (phases/devCards.ts),
    // never here — an attempt during `main` correctly falls through to WRONG_PHASE below.
    default:
      return fail('WRONG_PHASE', `action ${action.type} is not available in the main phase yet`);
  }
};

// Re-export for legal.ts / Road Building (T-109).
export { canPlaceRoad };

// Reused verbatim by the 5–6 module's extra-build phases (T-602, X12): the SBP special-build turn
// and the Paired-Players partial turn both build/buy through THESE exact handlers (costs,
// validation, awards recalc) — no duplicated build logic. They are phase-agnostic (they never read
// `state.phase`), so the module can call them from its own phase without any change here.
export { buildRoad, buildSettlement, buildCity, bankTrade };
