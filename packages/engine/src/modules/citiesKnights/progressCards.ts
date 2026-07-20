// Cities & Knights progress cards (T-804, docs/rules/cities-knights-rules.md C6). Two halves:
//   1. `resolveProgressDraw` — the C6.2 draw mechanic, called from citiesKnights/index.ts's
//      `handleRollDice` roll hook on a colour-gate event-die face (T-803's `progressGateOpened`).
//   2. `playProgressCard` — the C6.4 play action, dispatching to one effect function per of the 25
//      distinct card NAMES (C6.5). Reuses base/T-802/T-803 mechanics wherever the card effect
//      matches one exactly (Road Building's free-road sub-phase, Monopoly-shaped transfers, the
//      robber+steal pipeline, knight promote/activate, buildImprovement); every simplification is
//      documented at its call site and summarized in the T-804 report.

import {
  CK_CARD_TRACK,
  CK_COMMODITY_SUPPLY,
  CK_KNIGHT_CAP,
  CK_PROGRESS_HAND_LIMIT,
} from '@hexhaven/shared';
import type {
  Action,
  Commodity,
  CitiesKnightsExt,
  EdgeId,
  EngineErrorCode,
  GameEvent,
  GameState,
  HexId,
  ImprovementTrack,
  ProgressCardId,
  ResourceBundle,
  ResourceType,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import {
  built,
  commodityMonopolyResolved,
  discarded,
  knightBuilt,
  knightDisplaced,
  knightRemoved,
  merchantPlaced,
  monopolyResolved,
  numberTokensSwapped,
  production,
  progressCardDiscarded,
  progressCardPlayed,
  progressCardRevealed,
  progressCardDrawn,
  progressCardTaken,
  progressCardsTransferred,
  robberMoved,
  roadRemoved,
} from '../../events.js';
import { canAfford, payToBank } from '../../rules/afford.js';
import { updateAwards } from '../../rules/awards.js';
import { ownRoadAt, canPlaceRoad } from '../../rules/connectivity.js';
import { isVertexOccupied } from '../../rules/placement.js';
import { resolvedRoadBuildingCount } from '../../phases/devCards.js';
import { resolveSteal, stealCandidatesForHex } from '../../phases/robber.js';
import { computeVp } from '../../vp.js';
import { geometryForState, resolveConstants } from '../index.js';
import { buildImprovement, canDrawProgress } from './improvements.js';
import { activateKnight, anyKnightAt, findKnight, promoteKnight } from './knights.js';
import { citiesKnightsExt } from './state.js';
import { buildCityWall } from './walls.js';
import { canPlayRoadBuildingSeafarers } from '../seafarers/roadBuilding.js';
import { shipsLeftOf } from '../seafarers/state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/** The progress-card hand limit in effect for `state` (T-906, docs/07 D-034
 *  `customConstants.maxProgressCards`) — the base `CK_PROGRESS_HAND_LIMIT` (4) unless overridden
 *  (`Infinity` for a limitless config). Absent ⇒ `CK_PROGRESS_HAND_LIMIT` unchanged (RK-13). */
function resolvedProgressHandLimit(state: GameState): number {
  return resolveConstants(state.config).maxProgressCards ?? CK_PROGRESS_HAND_LIMIT;
}

function isCommodity(v: ResourceType | Commodity): v is Commodity {
  return v === 'paper' || v === 'cloth' || v === 'coin';
}

type PlayProgressCardAction = Extract<Action, { type: 'playProgressCard' }>;

// ---------------------------------------------------------------------------------------------
// C6.2 draw mechanic
// ---------------------------------------------------------------------------------------------

/**
 * C6.2: on a colour-gate event-die face, in turn order starting with `actingSeat`, every seat with
 * `canDrawProgress(state, seat, track, redDie)` true draws the top card of `track`'s deck. Printer/
 * Constitution (C6.3/C1.3) are revealed immediately (+1 VP) and never enter a hand. A normal draw
 * that would push a hand past `CK_PROGRESS_HAND_LIMIT` (4) auto-discards the JUST-DRAWN card back
 * to the bottom of its own deck — a documented v1 simplification of C6.3's "your choice"; flagged
 * for a later interactive refinement (a blocking multi-seat discard sub-phase is out of scope, per
 * the task). An empty deck means that seat simply draws nothing (deck order is deterministic — the
 * seeded rng only ever shuffles once, at game start, in `initCitiesKnightsExt`).
 */
export function resolveProgressDraw(
  state: GameState,
  track: ImprovementTrack,
  redDie: number,
  actingSeat: Seat
): {
  progressDecks: CitiesKnightsExt['progressDecks'];
  progressHand: CitiesKnightsExt['progressHand'];
  revealedProgress: CitiesKnightsExt['revealedProgress'];
  events: GameEvent[];
} {
  const ck = citiesKnightsExt(state)!;
  const n = state.players.length;
  let deck = [...ck.progressDecks[track]];
  const progressHand = ck.progressHand.map((h) => [...h]);
  let revealedProgress = { ...ck.revealedProgress };
  const events: GameEvent[] = [];

  for (let i = 0; i < n; i++) {
    const seat = ((actingSeat + i) % n) as Seat;
    if (!canDrawProgress(state, seat, track, redDie)) continue;
    if (deck.length === 0) continue;

    const card = deck[0]!;
    deck = deck.slice(1);

    if (card === 'printer' || card === 'constitution') {
      // Only 1 copy of each exists in the whole 54-card catalog, so `revealedProgress[card]` can
      // never already be set here in real play — kept as a defensive no-op rather than a `BUG:`
      // throw (mirrors the "coded error over throw for anything the AI's determinized search could
      // reach" discipline elsewhere in this module).
      if (revealedProgress[card] === undefined) {
        revealedProgress = { ...revealedProgress, [card]: seat };
        events.push(progressCardRevealed(seat, card));
      }
      continue;
    }

    progressHand[seat] = [...progressHand[seat]!, card];
    events.push(progressCardDrawn(seat, track, card));
    if (progressHand[seat]!.length > resolvedProgressHandLimit(state)) {
      progressHand[seat] = progressHand[seat]!.slice(0, -1);
      deck = [...deck, card];
      events.push(progressCardDiscarded(seat, card));
    }
  }

  return { progressDecks: { ...ck.progressDecks, [track]: deck }, progressHand, revealedProgress, events };
}

/** Shared by the draw mechanic (inlined above) and Spy (which adds a STOLEN card to a hand) — same
 *  hand-limit-4 (T-906-configurable, `resolvedProgressHandLimit`) auto-discard-to-own-deck-bottom
 *  rule (C6.3). */
function addCardToHandWithLimit(
  state: GameState,
  ck: CitiesKnightsExt,
  seat: Seat,
  card: ProgressCardId
): { ck: CitiesKnightsExt; discarded: ProgressCardId | null } {
  let progressHand = ck.progressHand.map((h, i) => (i === seat ? [...h, card] : h));
  let progressDecks = ck.progressDecks;
  let discarded: ProgressCardId | null = null;
  if (progressHand[seat]!.length > resolvedProgressHandLimit(state)) {
    progressHand = progressHand.map((h, i) => (i === seat ? h.slice(0, -1) : h));
    const track = CK_CARD_TRACK[card];
    progressDecks = { ...progressDecks, [track]: [...progressDecks[track], card] };
    discarded = card;
  }
  return { ck: { ...ck, progressHand, progressDecks }, discarded };
}

// ---------------------------------------------------------------------------------------------
// Small shared helpers for the effect functions below
// ---------------------------------------------------------------------------------------------

/** An opponent (not `seat`) holds a settlement/city on `vertex` — local re-implementation of
 *  connectivity.ts's private `opponentBuildingOn` (not exported there), mirroring knights.ts's own
 *  local copy. */
function opponentBuildingAt(state: GameState, seat: Seat, vertex: VertexId): boolean {
  return state.players.some(
    (p) => p.seat !== seat && (p.settlements.includes(vertex) || p.cities.includes(vertex))
  );
}

/** Diplomat (C6.5): an edge is "open" at an endpoint that carries no settlement/city AND no OTHER
 *  road of the same owner — i.e. that end is a true dead end. */
function edgeIsOpen(state: GameState, edge: EdgeId, owner: Seat): boolean {
  const geometry = geometryForState(state);
  const e = geometry.edges[edge];
  const ownerPlayer = state.players[owner];
  if (!e || !ownerPlayer) return false;
  for (const v of [e.a, e.b]) {
    const vert = geometry.vertices[v];
    if (!vert) continue;
    const hasBuilding = ownerPlayer.settlements.includes(v) || ownerPlayer.cities.includes(v);
    if (hasBuilding) continue;
    const otherRoadHere = vert.edges.some((eid) => eid !== edge && ownerPlayer.roads.includes(eid));
    if (!otherRoadHere) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Client legal-target enumerators (T-806, mirrors knights.ts's precedent): pure lookups the
// progress-card play dialogs use to offer only targets the engine will accept, so a dialog never
// dispatches a `playProgressCard` that comes back `BAD_CARD_TARGET`/`BAD_LOCATION`. Geometry-driven
// (hence engine-side, not in the client's `ckHelpers.ts`).
// ---------------------------------------------------------------------------------------------

/** Merchant (C6.5): every board hex adjacent to one of `seat`'s settlements/cities — the legal
 *  placements for the merchant piece. Empty outside a C&K game. */
export function merchantHexes(state: GameState, seat: Seat): HexId[] {
  const ck = citiesKnightsExt(state);
  if (!ck) return [];
  const geometry = geometryForState(state);
  const player = state.players[seat];
  if (!player) return [];
  const owned = new Set<number>([...player.settlements, ...player.cities]);
  return geometry.hexes.filter((h) => h.vertices.some((v) => owned.has(v))).map((h) => h.id);
}

/** Diplomat (C6.5): every road on the board with an "open" end (`edgeIsOpen` for its owner) — any
 *  player's, since Diplomat may remove any open road. Empty outside a C&K game. */
export function diplomatOpenRoads(state: GameState): EdgeId[] {
  const ck = citiesKnightsExt(state);
  if (!ck) return [];
  const out: EdgeId[] = [];
  for (const p of state.players) {
    for (const edge of p.roads) {
      if (edgeIsOpen(state, edge, p.seat)) out.push(edge);
    }
  }
  return out;
}

/** Resource-then-commodity priority order used by every auto-resolved "take/give cards" effect
 *  (Master Merchant / Wedding / Saboteur) — deterministic since the real rule's "your choice" has
 *  no interactive sub-phase in this v1 (documented simplification, consistent across all three). */
const RESOURCE_PRIORITY: readonly ResourceType[] = ['ore', 'grain', 'wool', 'lumber', 'brick'];
const COMMODITY_PRIORITY: readonly Commodity[] = ['coin', 'cloth', 'paper'];

/** Take up to `count` cards (resources first, then commodities, priority order) out of a hand,
 *  returning what was taken plus the residual resources/commodities. Used by Master Merchant and
 *  Wedding (both "take up to 2 cards, or all if fewer" — C6.5). */
function takeUpTo(
  count: number,
  resources: Record<ResourceType, number>,
  commodities: Record<Commodity, number>
): {
  takenResources: ResourceBundle;
  takenCommodities: Partial<Record<Commodity, number>>;
  residualResources: Record<ResourceType, number>;
  residualCommodities: Record<Commodity, number>;
} {
  let remaining = count;
  const residualResources = { ...resources };
  const residualCommodities = { ...commodities };
  const takenResources: ResourceBundle = {};
  const takenCommodities: Partial<Record<Commodity, number>> = {};
  for (const res of RESOURCE_PRIORITY) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, residualResources[res]);
    if (take > 0) {
      takenResources[res] = take;
      residualResources[res] -= take;
      remaining -= take;
    }
  }
  for (const com of COMMODITY_PRIORITY) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, residualCommodities[com]);
    if (take > 0) {
      takenCommodities[com] = take;
      residualCommodities[com] -= take;
      remaining -= take;
    }
  }
  return { takenResources, takenCommodities, residualResources, residualCommodities };
}

/** Merchant Fleet (C6.5, one-shot 2:1) reuses this generic bank trade over EITHER resources or
 *  commodities on either side — a superset of `commodityBankTrade`'s resource-or-commodity receive
 *  side, also allowing a resource GIVE (Merchant Fleet, unlike the Trading House, isn't commodity
 *  only). */
function tradeAny(
  state: GameState,
  seat: Seat,
  give: ResourceType | Commodity,
  receive: ResourceType | Commodity,
  rate: number
): EngineResult {
  if (give === receive) return fail('BAD_TRADE', 'give and receive must be different types');
  const ck = citiesKnightsExt(state)!;
  const player = state.players[seat]!;

  const held = isCommodity(give) ? ck.commodities[seat]![give] : player.resources[give];
  if (held < rate) return fail('CANT_AFFORD', `need ${rate} ${give}, seat ${seat} holds ${held}`);

  if (isCommodity(receive)) {
    const total = ck.commodities.reduce((s, c) => s + c[receive], 0);
    if (total >= CK_COMMODITY_SUPPLY) return fail('BANK_EMPTY', `no ${receive} left in the supply (C3.1)`);
  } else if (state.bank[receive] < 1) {
    return fail('BANK_EMPTY', `the bank has no ${receive} left`);
  }

  let commodities = ck.commodities;
  let players = state.players;
  let bank = state.bank;

  if (isCommodity(give)) {
    commodities = commodities.map((c, i) => (i === seat ? { ...c, [give]: c[give] - rate } : c));
  } else {
    players = players.map((p) =>
      p.seat === seat ? { ...p, resources: { ...p.resources, [give]: p.resources[give] - rate } } : p
    );
    bank = { ...bank, [give]: bank[give] + rate };
  }
  if (isCommodity(receive)) {
    commodities = commodities.map((c, i) => (i === seat ? { ...c, [receive]: c[receive] + 1 } : c));
  } else {
    players = players.map((p) =>
      p.seat === seat ? { ...p, resources: { ...p.resources, [receive]: p.resources[receive] + 1 } } : p
    );
    bank = { ...bank, [receive]: bank[receive] - 1 };
  }

  return {
    ok: true,
    state: { ...state, players, bank, ext: { ...state.ext, citiesKnights: { ...ck, commodities } } },
    events: [],
  };
}

// ---------------------------------------------------------------------------------------------
// Card effects — one function per distinct NAME (C6.5). Each receives a `state` that ALREADY has
// the card removed from the acting seat's hand (see `playProgressCard` below); a function may
// declare fewer than 3 parameters when it doesn't need `action` (structurally still assignable to
// `CardEffect` below — TS/JS allow calling a function with more arguments than it declares).
// ---------------------------------------------------------------------------------------------

function effectAlchemist(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const { yellowDie, redDie } = action;
  if (
    yellowDie === undefined ||
    redDie === undefined ||
    !Number.isInteger(yellowDie) ||
    !Number.isInteger(redDie) ||
    yellowDie < 1 ||
    yellowDie > 6 ||
    redDie < 1 ||
    redDie > 6
  ) {
    return fail('BAD_CARD_TARGET', 'Alchemist requires yellowDie/redDie in 1-6 (C6.5)');
  }
  const ck = citiesKnightsExt(state)!;
  return {
    ok: true,
    state: { ...state, ext: { ...state.ext, citiesKnights: { ...ck, alchemistForced: [yellowDie, redDie] } } },
    events: [],
  };
}

function effectCrane(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  if (!action.track) return fail('BAD_CARD_TARGET', 'Crane requires a track (C6.5)');
  // Discount of 1 commodity, floored at 1 — see improvements.ts's `buildImprovement` discount param.
  return buildImprovement(state, seat, action.track, 1);
}

function effectEngineer(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  if (action.vertex === undefined) return fail('BAD_CARD_TARGET', 'Engineer requires a vertex (C6.5)');
  return buildCityWall(state, seat, action.vertex, true);
}

function effectInventor(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const { hexA, hexB } = action;
  if (hexA === undefined || hexB === undefined || hexA === hexB) {
    return fail('BAD_CARD_TARGET', 'Inventor requires two distinct hexes (C6.5)');
  }
  const geometry = geometryForState(state);
  if (!geometry.hexes[hexA] || !geometry.hexes[hexB]) {
    return fail('BAD_LOCATION', 'Inventor hexes must be on the board');
  }
  const tileA = state.board.hexes[hexA];
  const tileB = state.board.hexes[hexB];
  if (!tileA || !tileB || tileA.token === null || tileB.token === null) {
    return fail('BAD_CARD_TARGET', 'Inventor requires two numbered hexes');
  }
  // C6.5: "not 2/12/6/8" per the rules doc's own flagged ambiguity — resolved here to the widely
  // printed restriction (may not relocate a 6 or 8, the two highest-probability numbers); documented
  // per the task's "confirm which are excluded during T-804" instruction.
  if (tileA.token === 6 || tileA.token === 8 || tileB.token === 6 || tileB.token === 8) {
    return fail('INVENTOR_RESTRICTED_NUMBER', 'Inventor cannot relocate a 6 or 8 token (C6.5)');
  }
  const hexes = state.board.hexes.map((h, i) =>
    i === hexA ? { ...h, token: tileB.token } : i === hexB ? { ...h, token: tileA.token } : h
  );
  return { ok: true, state: { ...state, board: { ...state.board, hexes } }, events: [numberTokensSwapped(hexA, hexB)] };
}

function effectIrrigation(state: GameState, seat: Seat): EngineResult {
  const geometry = geometryForState(state);
  const player = state.players[seat]!;
  const owned = new Set<number>([...player.settlements, ...player.cities]);
  let count = 0;
  for (const hex of geometry.hexes) {
    if (state.board.hexes[hex.id]?.terrain !== 'fields') continue;
    if (hex.vertices.some((v) => owned.has(v))) count++;
  }
  const gain = count * 2;
  if (gain === 0) return { ok: true, state, events: [] };
  const available = Math.min(gain, state.bank.grain);
  if (available === 0) return { ok: true, state, events: [] };
  const bank = { ...state.bank, grain: state.bank.grain - available };
  const players = state.players.map((p) =>
    p.seat === seat ? { ...p, resources: { ...p.resources, grain: p.resources.grain + available } } : p
  );
  return {
    ok: true,
    state: { ...state, players, bank },
    events: [production([{ seat, resources: { grain: available } }], available < gain ? ['grain'] : [])],
  };
}

function effectMining(state: GameState, seat: Seat): EngineResult {
  const geometry = geometryForState(state);
  const player = state.players[seat]!;
  const owned = new Set<number>([...player.settlements, ...player.cities]);
  let count = 0;
  for (const hex of geometry.hexes) {
    if (state.board.hexes[hex.id]?.terrain !== 'mountains') continue;
    if (hex.vertices.some((v) => owned.has(v))) count++;
  }
  const gain = count * 2;
  if (gain === 0) return { ok: true, state, events: [] };
  const available = Math.min(gain, state.bank.ore);
  if (available === 0) return { ok: true, state, events: [] };
  const bank = { ...state.bank, ore: state.bank.ore - available };
  const players = state.players.map((p) =>
    p.seat === seat ? { ...p, resources: { ...p.resources, ore: p.resources.ore + available } } : p
  );
  return {
    ok: true,
    state: { ...state, players, bank },
    events: [production([{ seat, resources: { ore: available } }], available < gain ? ['ore'] : [])],
  };
}

function effectMedicine(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const vertex = action.vertex;
  if (vertex === undefined) return fail('BAD_CARD_TARGET', 'Medicine requires a vertex (C6.5)');
  const player = state.players[seat]!;
  if (!player.settlements.includes(vertex)) {
    return fail('BAD_LOCATION', 'a city must replace one of your own settlements (R7.4)');
  }
  if (player.piecesLeft.cities <= 0) return fail('NO_PIECES_LEFT', 'no city pieces left');
  const cost = { ore: 2, grain: 1 };
  if (!canAfford(player, cost)) return fail('CANT_AFFORD', 'Medicine costs 2 ore + 1 grain (C6.5)');
  const { players, bank } = payToBank(state, seat, cost);
  const placed = players.map((p) =>
    p.seat === seat
      ? {
          ...p,
          settlements: p.settlements.filter((s) => s !== vertex),
          cities: [...p.cities, vertex],
          piecesLeft: { ...p.piecesLeft, settlements: p.piecesLeft.settlements + 1, cities: p.piecesLeft.cities - 1 },
        }
      : p
  );
  return { ok: true, state: { ...state, players: placed, bank }, events: [built(seat, 'city', vertex)] };
}

function effectSmith(state: GameState, seat: Seat): EngineResult {
  const ck = citiesKnightsExt(state)!;
  const knights = [...(ck.knights[seat] ?? [])].sort((a, b) => a.vertex - b.vertex);
  let cur = state;
  const events: GameEvent[] = [];
  let promoted = 0;
  for (const k of knights) {
    if (promoted >= 2) break;
    const res = promoteKnight(cur, seat, k.vertex, true);
    if (res.ok) {
      cur = res.state;
      events.push(...res.events);
      promoted++;
    }
  }
  return { ok: true, state: cur, events };
}

function effectWarlord(state: GameState, seat: Seat): EngineResult {
  const ck = citiesKnightsExt(state)!;
  const knights = ck.knights[seat] ?? [];
  let cur = state;
  const events: GameEvent[] = [];
  for (const k of knights) {
    if (k.active) continue;
    const res = activateKnight(cur, seat, k.vertex, true);
    if (res.ok) {
      cur = res.state;
      events.push(...res.events);
    }
  }
  return { ok: true, state: cur, events };
}

function effectMerchant(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const hex = action.hex;
  if (hex === undefined) return fail('BAD_CARD_TARGET', 'Merchant requires a hex (C6.5)');
  const geometry = geometryForState(state);
  const geomHex = geometry.hexes[hex];
  if (!geomHex) return fail('BAD_LOCATION', `hex ${hex} is off the board`);
  const player = state.players[seat]!;
  const touches = geomHex.vertices.some((v) => player.settlements.includes(v) || player.cities.includes(v));
  if (!touches) return fail('BAD_LOCATION', 'Merchant must be placed on a hex touching your settlement/city (C6.5)');
  const ck = citiesKnightsExt(state)!;
  return {
    ok: true,
    state: { ...state, ext: { ...state.ext, citiesKnights: { ...ck, merchant: { hex, owner: seat } } } },
    events: [merchantPlaced(seat, hex)],
  };
}

function effectMerchantFleet(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const { give, receive } = action;
  if (!give || !receive) return fail('BAD_CARD_TARGET', 'Merchant Fleet requires give and receive (C6.5)');
  // Documented simplification: the real card grants a standing 2:1 rate "until end of turn" for the
  // chosen type; here it instead executes ONE immediate 2:1 trade at play time, avoiding a persistent
  // per-turn rate flag threaded through the base `bankTrade`/`commodityBankTrade` handlers (owned by
  // other tasks). Flagged in the T-804 report for a later refinement if repeat trades matter.
  return tradeAny(state, seat, give, receive, 2);
}

function effectCommercialHarbor(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const { resource, commodity } = action;
  if (!resource || !commodity) {
    return fail('BAD_CARD_TARGET', 'Commercial Harbor requires a resource and commodity (C6.5)');
  }
  // Documented resolution of the rules doc's own flagged ambiguity ("confirm exact swap direction"):
  // for each opponent holding >=1 of the named resource, they give you 1 of it and you give them 1
  // of the named commodity in return (paid from your own stock) — "pass if unable" covers BOTH an
  // opponent lacking the resource and the acting seat running out of the commodity to pay with.
  const ck = citiesKnightsExt(state)!;
  let players = state.players;
  let commodities = ck.commodities;
  const events: GameEvent[] = [];
  let myCommodity = commodities[seat]![commodity];

  for (const p of state.players) {
    if (p.seat === seat) continue;
    if (myCommodity <= 0) break;
    const opponent = players.find((pl) => pl.seat === p.seat)!;
    if (opponent.resources[resource] < 1) continue;

    players = players.map((pl) => {
      if (pl.seat === p.seat) return { ...pl, resources: { ...pl.resources, [resource]: pl.resources[resource] - 1 } };
      if (pl.seat === seat) return { ...pl, resources: { ...pl.resources, [resource]: pl.resources[resource] + 1 } };
      return pl;
    });
    commodities = commodities.map((c, i) => {
      if (i === seat) return { ...c, [commodity]: c[commodity] - 1 };
      if (i === p.seat) return { ...c, [commodity]: c[commodity] + 1 };
      return c;
    });
    myCommodity -= 1;
    events.push(progressCardsTransferred(p.seat, seat, { [resource]: 1 }, {}));
    events.push(progressCardsTransferred(seat, p.seat, {}, { [commodity]: 1 }));
  }

  return {
    ok: true,
    state: { ...state, players, ext: { ...state.ext, citiesKnights: { ...ck, commodities } } },
    events,
  };
}

function effectMasterMerchant(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const targetSeat = action.targetSeat;
  if (targetSeat === undefined || targetSeat === seat) {
    return fail('BAD_CARD_TARGET', 'Master Merchant requires an opposing targetSeat (C6.5)');
  }
  if (computeVp(state, targetSeat).total <= computeVp(state, seat).total) {
    return fail('NOT_ELIGIBLE', `seat ${targetSeat} does not have more VP than seat ${seat} (C6.5)`);
  }
  const ck = citiesKnightsExt(state)!;
  const target = state.players[targetSeat]!;
  // Documented auto-resolution: the real card lets the ACTOR choose which 2 cards to take; here the
  // 2 cards are auto-picked by a fixed priority order (ore/grain/wool/lumber/brick, then
  // coin/cloth/paper) rather than an interactive sub-phase.
  const picked = takeUpTo(2, target.resources, ck.commodities[targetSeat]!);
  const players = state.players.map((p) => {
    if (p.seat === targetSeat) return { ...p, resources: picked.residualResources };
    if (p.seat === seat) {
      const merged = { ...p.resources };
      for (const [res, amt] of Object.entries(picked.takenResources)) merged[res as ResourceType] += amt ?? 0;
      return { ...p, resources: merged };
    }
    return p;
  });
  const commodities = ck.commodities.map((c, i) => {
    if (i === targetSeat) return picked.residualCommodities;
    if (i === seat) {
      const merged = { ...c };
      for (const [com, amt] of Object.entries(picked.takenCommodities)) merged[com as Commodity] += amt ?? 0;
      return merged;
    }
    return c;
  });
  return {
    ok: true,
    state: { ...state, players, ext: { ...state.ext, citiesKnights: { ...ck, commodities } } },
    events: [progressCardsTransferred(targetSeat, seat, picked.takenResources, picked.takenCommodities)],
  };
}

function effectResourceMonopoly(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const resource = action.resource;
  if (!resource) return fail('BAD_CARD_TARGET', 'Resource Monopoly requires a resource (C6.5)');
  const taken: { seat: Seat; count: number }[] = [];
  let collected = 0;
  const stripped = state.players.map((p) => {
    if (p.seat === seat) return p;
    const count = Math.min(2, p.resources[resource]);
    taken.push({ seat: p.seat, count });
    if (count === 0) return p;
    collected += count;
    return { ...p, resources: { ...p.resources, [resource]: p.resources[resource] - count } };
  });
  const players = stripped.map((p) =>
    p.seat === seat ? { ...p, resources: { ...p.resources, [resource]: p.resources[resource] + collected } } : p
  );
  return { ok: true, state: { ...state, players }, events: [monopolyResolved(seat, resource, taken)] };
}

function effectCommodityMonopoly(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const commodity = action.commodity;
  if (!commodity) return fail('BAD_CARD_TARGET', 'Commodity Monopoly requires a commodity (C6.5)');
  const ck = citiesKnightsExt(state)!;
  const taken: { seat: Seat; count: number }[] = [];
  let collected = 0;
  const stripped = ck.commodities.map((c, i) => {
    if (i === seat) return c;
    const count = Math.min(1, c[commodity]);
    taken.push({ seat: i as Seat, count });
    if (count === 0) return c;
    collected += count;
    return { ...c, [commodity]: c[commodity] - count };
  });
  const commodities = stripped.map((c, i) => (i === seat ? { ...c, [commodity]: c[commodity] + collected } : c));
  return {
    ok: true,
    state: { ...state, ext: { ...state.ext, citiesKnights: { ...ck, commodities } } },
    events: [commodityMonopolyResolved(seat, commodity, taken)],
  };
}

function effectBishop(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const ck = citiesKnightsExt(state)!;
  if (ck.robberLocked) return fail('ROBBER_LOCKED', 'the robber is locked until the first barbarian attack (C10.1)');
  const hex = action.hex;
  if (hex === undefined) return fail('BAD_CARD_TARGET', 'Bishop requires a destination hex (C6.5)');
  const geometry = geometryForState(state);
  if (!geometry.hexes[hex]) return fail('BAD_LOCATION', `hex ${hex} is off the board`);
  if (hex === state.board.robber) return fail('ROBBER_SAME_HEX', 'the robber must move to a different hex');

  let cur: GameState = { ...state, board: { ...state.board, robber: hex } };
  const events: GameEvent[] = [robberMoved(seat, hex)];
  // C6.5: steal 1 from EVERY player adjacent to the robber's new hex (not just one) — reuses the
  // same steal-candidate + resolve pipeline as the base robber, looped over every candidate.
  const candidates = stealCandidatesForHex(cur, hex);
  for (const victim of candidates) {
    const res = resolveSteal(cur, seat, victim, 'main', []);
    if (!res.ok) continue; // unreachable: stealCandidatesForHex already filters to victims holding >=1 card
    cur = res.state;
    events.push(...res.events);
  }
  return { ok: true, state: cur, events };
}

function effectDeserter(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const { targetSeat, targetVertex, vertex } = action;
  if (targetSeat === undefined || targetVertex === undefined || vertex === undefined) {
    return fail('BAD_CARD_TARGET', 'Deserter requires targetSeat, targetVertex, and vertex (C6.5)');
  }
  if (targetSeat === seat) return fail('BAD_CARD_TARGET', 'Deserter targets an opponent (C6.5)');
  const ck = citiesKnightsExt(state)!;
  const targetKnight = findKnight(ck, targetSeat, targetVertex);
  if (!targetKnight) return fail('KNIGHT_NOT_FOUND', `seat ${targetSeat} has no knight at vertex ${targetVertex}`);

  const geometry = geometryForState(state);
  if (!geometry.vertices[vertex]) return fail('BAD_LOCATION', `vertex ${vertex} is off the board`);
  if (anyKnightAt(ck, vertex)) return fail('OCCUPIED', `vertex ${vertex} already holds a knight`);
  if (opponentBuildingAt(state, seat, vertex)) {
    return fail('BAD_LOCATION', `vertex ${vertex} holds an opponent's building`);
  }
  if (!ownRoadAt(state, seat, vertex)) {
    return fail('NOT_CONNECTED', `vertex ${vertex} is not connected to seat ${seat}'s road network (C7.1)`);
  }
  const countAtLevel = (ck.knights[seat] ?? []).filter((k) => k.level === targetKnight.level).length;
  const levelCap = CK_KNIGHT_CAP[targetKnight.level];
  if (countAtLevel >= levelCap) {
    return fail('KNIGHT_CAP', `seat ${seat} already has ${levelCap} knights at level ${targetKnight.level} (C7.1)`);
  }

  const knights = ck.knights.map((list, i) => {
    if (i === targetSeat) return list.filter((k) => k.vertex !== targetVertex);
    if (i === seat) return [...list, { vertex, level: targetKnight.level, active: false }];
    return list;
  });
  return {
    ok: true,
    state: { ...state, ext: { ...state.ext, citiesKnights: { ...ck, knights } } },
    events: [knightRemoved(targetSeat, targetVertex), knightBuilt(seat, vertex, targetKnight.level)],
  };
}

function effectDiplomat(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const edge = action.edge;
  if (edge === undefined) return fail('BAD_CARD_TARGET', 'Diplomat requires an edge (C6.5)');
  const geometry = geometryForState(state);
  if (!geometry.edges[edge]) return fail('BAD_LOCATION', `edge ${edge} is off the board`);
  const owner = state.players.find((p) => p.roads.includes(edge));
  if (!owner) return fail('BAD_CARD_TARGET', `edge ${edge} has no road to remove`);
  if (!edgeIsOpen(state, edge, owner.seat)) {
    return fail('BAD_CARD_TARGET', `edge ${edge} is not an open road end (C6.5)`);
  }

  const rebuilt = owner.seat === seat;
  let players = state.players;
  if (!rebuilt) {
    players = players.map((p) =>
      p.seat === owner.seat
        ? { ...p, roads: p.roads.filter((r) => r !== edge), piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads + 1 } }
        : p
    );
  }
  const awarded = updateAwards({ ...state, players });
  return {
    ok: true,
    state: awarded.state,
    events: [roadRemoved(owner.seat, edge, rebuilt), ...awarded.events],
  };
}

function effectIntrigue(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const targetVertex = action.targetVertex;
  if (targetVertex === undefined) return fail('BAD_CARD_TARGET', 'Intrigue requires a targetVertex (C6.5)');
  const ck = citiesKnightsExt(state)!;
  if (!ownRoadAt(state, seat, targetVertex)) {
    return fail('NOT_CONNECTED', `vertex ${targetVertex} is not on seat ${seat}'s road network (C6.5)`);
  }
  let targetSeat: Seat | undefined;
  for (const p of state.players) {
    if (p.seat === seat) continue;
    if (findKnight(ck, p.seat, targetVertex)) {
      targetSeat = p.seat;
      break;
    }
  }
  if (targetSeat === undefined) return fail('KNIGHT_NOT_FOUND', `vertex ${targetVertex} holds no opponent knight`);

  // Same relocate-or-remove resolution as knights.ts's `knightDisplace`, but ignoring the strength
  // rule entirely (C6.5) and with no "mover" knight of the acting seat's own — `seat`/`from`/`to` in
  // the emitted event are the acting seat and the (unchanged) target vertex, since nothing of the
  // acting seat's own physically moves; only the displaced knight relocates.
  const geometry = geometryForState(state);
  const vert = geometry.vertices[targetVertex]!;
  const candidates = [...vert.neighbors]
    .filter((n) => !isVertexOccupied(state, n) && !anyKnightAt(ck, n) && ownRoadAt(state, targetSeat!, n))
    .sort((a, b) => a - b);
  const displacedTo = candidates[0] ?? null;

  const knights = ck.knights.map((list, i) => {
    if (i !== targetSeat) return list;
    return displacedTo !== null
      ? list.map((k) => (k.vertex === targetVertex ? { ...k, vertex: displacedTo } : k))
      : list.filter((k) => k.vertex !== targetVertex);
  });
  return {
    ok: true,
    state: { ...state, ext: { ...state.ext, citiesKnights: { ...ck, knights } } },
    events: [knightDisplaced(seat, targetVertex, targetVertex, targetSeat, displacedTo)],
  };
}

function effectSaboteur(state: GameState, seat: Seat): EngineResult {
  const myVp = computeVp(state, seat).total;
  let players = state.players;
  const bank = { ...state.bank };
  const events: GameEvent[] = [];
  const order: readonly ResourceType[] = ['ore', 'grain', 'wool', 'lumber', 'brick'];

  for (const p of state.players) {
    if (p.seat === seat) continue;
    if (computeVp(state, p.seat).total < myVp) continue; // C6.5: only players with >= your VP
    const handSize = p.resources.brick + p.resources.lumber + p.resources.wool + p.resources.grain + p.resources.ore;
    let remaining = Math.floor(handSize / 2);
    if (remaining <= 0) continue;
    const resources = { ...p.resources };
    const cards: ResourceBundle = {};
    for (const res of order) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, resources[res]);
      if (take > 0) {
        cards[res] = take;
        resources[res] -= take;
        remaining -= take;
      }
    }
    players = players.map((pl) => (pl.seat === p.seat ? { ...pl, resources } : pl));
    for (const [res, amt] of Object.entries(cards)) bank[res as ResourceType] += amt ?? 0;
    events.push(discarded(p.seat, cards));
  }
  return { ok: true, state: { ...state, players, bank }, events };
}

function effectSpy(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const { targetSeat, targetCard, targetCardIndex } = action;
  if (targetSeat === undefined || targetSeat === seat) {
    return fail('BAD_CARD_TARGET', 'Spy requires an opposing targetSeat (C6.5)');
  }
  const ck = citiesKnightsExt(state)!;
  const hand = ck.progressHand[targetSeat] ?? [];
  // T-806: the client can't see the opponent's HIDDEN hand (redact.ts never exposes card identities),
  // so it selects by POSITION (`targetCardIndex`) rather than by card id. A concrete `targetCard`
  // still works (back-compat with bots/tests that determinize the full state), and is also what a
  // human client now sends after the peek reveal below round-trips the real card ids to it.
  const idx = targetCard !== undefined ? hand.indexOf(targetCard) : (targetCardIndex ?? -1);
  if (idx < 0 || idx >= hand.length) {
    return fail(
      'BAD_CARD_TARGET',
      targetCard !== undefined
        ? `seat ${targetSeat} does not hold ${targetCard}`
        : `seat ${targetSeat} has no progress card at index ${targetCardIndex}`
    );
  }
  const stolen = hand[idx]!;

  const targetHand = [...hand.slice(0, idx), ...hand.slice(idx + 1)];
  const withRemoved: CitiesKnightsExt = {
    ...ck,
    progressHand: ck.progressHand.map((h, i) => (i === targetSeat ? targetHand : h)),
    // Peek reveal hygiene: committing clears this seat's pending peek (if any) — it served its
    // purpose the instant the real card id above was named, regardless of whether the commit reused
    // the SAME target this seat peeked at.
    spyPeek: ck.spyPeek.map((p, i) => (i === seat ? null : p)),
  };
  const added = addCardToHandWithLimit(state, withRemoved, seat, stolen);
  const events: GameEvent[] = [progressCardTaken(targetSeat, seat, stolen)];
  if (added.discarded) events.push(progressCardDiscarded(seat, added.discarded));
  return { ok: true, state: { ...state, ext: { ...state.ext, citiesKnights: added.ck } }, events };
}

/**
 * Spy peek reveal (redact.ts hidden-info UX fix, C6.5): the "begin" half of a two-step Spy play.
 * Snapshots `targetSeat`'s REAL current hand into `spyPeek[seat]` — no card moves, no hand changes —
 * so `redact.ts` can reveal it to ONLY `seat`'s own `PlayerView`. The client then re-dispatches the
 * pre-existing `playProgressCard{card:'spy', targetSeat, targetCard}` (unchanged) to commit, now
 * naming a REAL card id instead of a position. Requires `seat` to actually hold 'spy' (mirrors
 * `playProgressCard`'s own "card held" guard) — peeking is still gated on being ABLE to play the
 * card, even though it doesn't spend it yet.
 */
export function peekSpyTarget(state: GameState, seat: Seat, targetSeat: Seat): EngineResult {
  const ck = citiesKnightsExt(state);
  if (!ck) return fail('WRONG_PHASE', 'peekSpyTarget is only legal in a Cities & Knights game');
  if (!(ck.progressHand[seat] ?? []).includes('spy')) {
    return fail('CARD_NOT_HELD', `seat ${seat} does not hold spy`);
  }
  if (targetSeat === seat || !state.players[targetSeat]) {
    return fail('BAD_CARD_TARGET', `seat ${targetSeat} is not a legal Spy target`);
  }
  const spyPeek = ck.spyPeek.map((p, i) => (i === seat ? { targetSeat, cards: [...(ck.progressHand[targetSeat] ?? [])] } : p));
  return { ok: true, state: { ...state, ext: { ...state.ext, citiesKnights: { ...ck, spyPeek } } }, events: [] };
}

function effectWedding(state: GameState, seat: Seat): EngineResult {
  const myVp = computeVp(state, seat).total;
  const ck = citiesKnightsExt(state)!;
  let players = state.players;
  let commodities = ck.commodities;
  const events: GameEvent[] = [];

  for (const p of state.players) {
    if (p.seat === seat) continue;
    if (computeVp(state, p.seat).total <= myVp) continue; // C6.5: strictly more VP than you
    const picked = takeUpTo(2, p.resources, commodities[p.seat]!);
    if (Object.keys(picked.takenResources).length === 0 && Object.keys(picked.takenCommodities).length === 0) continue;

    players = players.map((pl) => {
      if (pl.seat === p.seat) return { ...pl, resources: picked.residualResources };
      if (pl.seat === seat) {
        const merged = { ...pl.resources };
        for (const [res, amt] of Object.entries(picked.takenResources)) merged[res as ResourceType] += amt ?? 0;
        return { ...pl, resources: merged };
      }
      return pl;
    });
    commodities = commodities.map((c, i) => {
      if (i === p.seat) return picked.residualCommodities;
      if (i === seat) {
        const merged = { ...c };
        for (const [com, amt] of Object.entries(picked.takenCommodities)) merged[com as Commodity] += amt ?? 0;
        return merged;
      }
      return c;
    });
    events.push(progressCardsTransferred(p.seat, seat, picked.takenResources, picked.takenCommodities));
  }
  return { ok: true, state: { ...state, players, ext: { ...state.ext, citiesKnights: { ...ck, commodities } } }, events };
}

function effectRoadBuilding(state: GameState, seat: Seat): EngineResult {
  const player = state.players[seat]!;
  // Seafarers + Cities & Knights: the free pieces may be roads OR ships (S11.1), and a pure sea route
  // is ship-only (S3.2). Use the SAME ship-aware gate + road+ship supply the Seafarers Road Building
  // card uses — a road-only `canPlaceRoad` check here would count a sea edge as a legal road and open
  // the sub-phase with nothing actually placeable, soft-locking the turn (found by the sea+ck sim).
  if (state.ext?.seafarers !== undefined) {
    if (!canPlayRoadBuildingSeafarers(state, seat)) {
      return fail('CANNOT_PLAY', 'no road/ship piece or legal edge for Road Building (C6.5/S11.1)');
    }
    const supply = player.piecesLeft.roads + shipsLeftOf(state, seat);
    const remaining = Math.min(resolvedRoadBuildingCount(state), supply);
    return { ok: true, state: { ...state, phase: { kind: 'roadBuilding', remaining } }, events: [] };
  }
  const hasLegalEdge = geometryForState(state).edges.some((e) => canPlaceRoad(state, seat, e.id));
  if (player.piecesLeft.roads <= 0 || !hasLegalEdge) {
    return fail('CANNOT_PLAY', 'no road pieces left or no legal edge for Road Building (C6.5)');
  }
  // T-906 (docs/07 D-034 `customConstants.roadBuildingCount`): same resolved count the base/
  // Seafarers Road Building sub-phase uses — absent falls back to the base 2 (RK-13).
  const remaining = Math.min(resolvedRoadBuildingCount(state), player.piecesLeft.roads);
  return { ok: true, state: { ...state, phase: { kind: 'roadBuilding', remaining } }, events: [] };
}

type CardEffect = (state: GameState, seat: Seat, action: PlayProgressCardAction) => EngineResult;

const CARD_EFFECTS: Record<Exclude<ProgressCardId, 'printer' | 'constitution'>, CardEffect> = {
  alchemist: effectAlchemist,
  crane: effectCrane,
  engineer: effectEngineer,
  inventor: effectInventor,
  irrigation: effectIrrigation,
  medicine: effectMedicine,
  mining: effectMining,
  roadBuilding: effectRoadBuilding,
  smith: effectSmith,
  merchant: effectMerchant,
  merchantFleet: effectMerchantFleet,
  commercialHarbor: effectCommercialHarbor,
  masterMerchant: effectMasterMerchant,
  resourceMonopoly: effectResourceMonopoly,
  commodityMonopoly: effectCommodityMonopoly,
  bishop: effectBishop,
  deserter: effectDeserter,
  diplomat: effectDiplomat,
  intrigue: effectIntrigue,
  saboteur: effectSaboteur,
  spy: effectSpy,
  warlord: effectWarlord,
  wedding: effectWedding,
};

/**
 * C6.4: play a progress card from `seat`'s hand. Common guard (held?) + card removal happens once
 * here; each effect function in `CARD_EFFECTS` receives a `state` whose hand ALREADY has the card
 * removed and returns the rest of the effect. A `fail(...)` from the effect rolls the WHOLE action
 * back (the caller/`reduce` never applies a failed `EngineResult`), so an invalid target never
 * consumes the card. Printer/Constitution can never be played — they never enter a hand (C6.3).
 */
export function playProgressCard(state: GameState, seat: Seat, action: PlayProgressCardAction): EngineResult {
  const ck = citiesKnightsExt(state);
  if (!ck) return fail('WRONG_PHASE', 'playProgressCard is only legal in a Cities & Knights game');
  const card = action.card;
  if (card === 'printer' || card === 'constitution') {
    return fail('CARD_NOT_HELD', `${card} is a revealed card and can never be played (C6.3)`);
  }
  const hand = ck.progressHand[seat] ?? [];
  const idx = hand.indexOf(card);
  if (idx === -1) return fail('CARD_NOT_HELD', `seat ${seat} does not hold ${card}`);

  const removedHand = [...hand.slice(0, idx), ...hand.slice(idx + 1)];
  const preState: GameState = {
    ...state,
    ext: {
      ...state.ext,
      citiesKnights: { ...ck, progressHand: ck.progressHand.map((h, i) => (i === seat ? removedHand : h)) },
    },
  };

  const effect = CARD_EFFECTS[card];
  const result = effect(preState, seat, action);
  if (!result.ok) return result;

  return { ok: true, state: result.state, events: [progressCardPlayed(seat, card), ...result.events] };
}
