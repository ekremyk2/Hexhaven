// The 9 actively-triggered helper handlers (T-905, docs/tasks/modifiers-helpers-RESEARCH.md §2).
// General has no handler here — it is fully reactive (reactive.ts). Every handler follows the same
// shape: `canUseHelper` gate → helper-specific validation (reusing the SAME rule helpers the base
// engine's own phases use, read-only imports — never duplicated logic where an exported function
// already does it) → apply → `finishHelperUse` (state.ts's A/B lifecycle) → a real base `GameEvent`
// where one already fits (`built`/`devBought`/`bankTraded`/`robberMoved`/`stolen`) PLUS a local
// `helperUsed` event (events.ts) recording which helper/side fired.
//
// Merchant and Priest are the two helpers flagged trickiest by the research doc (§6) — see their
// functions below for the specific simplifications each takes.

import type { EdgeId, GameEvent, GameState, ResourceBundle, ResourceType, Seat, VertexId } from '@hexhaven/shared';
import type { EngineResult } from '../../../reduce.js';
import { err } from '../../../reduce.js';
import { bankTraded, built, devBought, robberMoved, stolen, tradeCancelled } from '../../../events.js';
import { costsForState, geometryForState } from '../../index.js';
import { canAfford, payToBank } from '../../../rules/afford.js';
import { canPlaceRoad, isRoadConnected, ownRoadOrShipAt } from '../../../rules/connectivity.js';
import { isEdgeOccupied, satisfiesDistanceRule } from '../../../rules/placement.js';
import { updateAwards } from '../../../rules/awards.js';
import { resolveSteal, stealCandidatesForHex } from '../../../phases/robber.js';
import { computeVp } from '../../../vp.js';
import { pickIndex } from '../../../rng.js';
import { asGameEvent, helperUsed } from './events.js';
import { canUseHelper, finishHelperUse, helpersExt } from './state.js';

const RESOURCE_ORDER: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

// ---- Mayor (research §2: "a dry roll grants any 1 resource card") -----------------------------

/** Consumes the `mayorEligible` flag `reactive.ts`'s `applyMayorEligibility` sets, granting the
 *  player's OWN choice of 1 resource from the bank. Callable by the eligible seat regardless of
 *  whose turn it is (index.ts's `isActorAllowed` carve-out) — the trigger (a dry roll) can happen
 *  on anyone's turn. */
export function useMayor(state: GameState, seat: Seat, resource: ResourceType): EngineResult {
  if (!canUseHelper(state, seat, 'mayor')) return err('CANNOT_PLAY', 'mayor is not usable right now');
  const ext = helpersExt(state)!;
  if (!ext.mayorEligible[seat]) {
    return err('CANNOT_PLAY', 'mayor only fires after a roll that earned this seat no resources');
  }
  if (state.bank[resource] < 1) return err('BANK_EMPTY', `the bank has no ${resource} left`);

  const mayorEligible = ext.mayorEligible.slice();
  mayorEligible[seat] = false;
  const bank = { ...state.bank, [resource]: state.bank[resource] - 1 };
  const players = state.players.map((p) =>
    p.seat === seat ? { ...p, resources: { ...p.resources, [resource]: p.resources[resource] + 1 } } : p
  );
  const withGrant: GameState = {
    ...state,
    bank,
    players,
    ext: { ...state.ext, helpers: { ...ext, mayorEligible } },
  };
  const finished = finishHelperUse(withGrant, seat);
  return {
    ok: true,
    state: finished.state,
    events: [asGameEvent(helperUsed(seat, 'mayor', finished.side, { resource }))],
  };
}

// ---- Explorer (research §2: "relocate one of your own terminal/dead-end roads") ---------------

/** A road is a "dead end" at an endpoint that carries neither a building of yours nor another road
 *  of yours — i.e. it sticks out into nowhere at that end. Terminal iff at least one endpoint
 *  qualifies (a true interior road has both ends anchored by another own road or building). */
function isTerminalRoad(state: GameState, seat: Seat, edge: EdgeId): boolean {
  const geometry = geometryForState(state);
  const e = geometry.edges[edge];
  const player = state.players[seat];
  if (!e || !player) return false;
  for (const v of [e.a, e.b]) {
    if (player.settlements.includes(v) || player.cities.includes(v)) continue;
    const vert = geometry.vertices[v];
    if (!vert) continue;
    const otherOwnRoads = vert.edges.filter((ed) => ed !== edge && player.roads.includes(ed));
    if (otherOwnRoads.length === 0) return true;
  }
  return false;
}

export function useExplorer(state: GameState, seat: Seat, from: EdgeId, to: EdgeId): EngineResult {
  if (!canUseHelper(state, seat, 'explorer')) return err('CANNOT_PLAY', 'explorer is not usable right now');
  const player = state.players[seat]!;
  if (!player.roads.includes(from)) return err('BAD_LOCATION', `seat ${seat} has no road at edge ${from}`);
  if (!isTerminalRoad(state, seat, from)) {
    return err('BAD_LOCATION', `edge ${from} is not a dead-end road — Explorer only relocates a terminal road`);
  }
  if (to === from) return err('OCCUPIED', 'must relocate to a different edge');
  if (!geometryForState(state).edges[to]) return err('BAD_LOCATION', `edge ${to} is off the board`);

  const withoutFrom: GameState = {
    ...state,
    players: state.players.map((p) =>
      p.seat === seat ? { ...p, roads: p.roads.filter((e) => e !== from) } : p
    ),
  };
  if (!canPlaceRoad(withoutFrom, seat, to)) {
    return err('NOT_CONNECTED', `edge ${to} is not a legal road spot for seat ${seat} (R7.2)`);
  }

  const relocated: GameState = {
    ...withoutFrom,
    players: withoutFrom.players.map((p) => (p.seat === seat ? { ...p, roads: [...p.roads, to] } : p)),
  };
  const awarded = updateAwards(relocated);
  const finished = finishHelperUse(awarded.state, seat);
  return {
    ok: true,
    state: finished.state,
    events: [...awarded.events, asGameEvent(helperUsed(seat, 'explorer', finished.side, { from, to }))],
  };
}

// ---- Mendicant (research §2: "replace the road's brick/lumber with any resource") --------------

export function useMendicant(
  state: GameState,
  seat: Seat,
  edge: EdgeId,
  replace: ResourceType,
  substitute: ResourceType
): EngineResult {
  if (!canUseHelper(state, seat, 'mendicant')) return err('CANNOT_PLAY', 'mendicant is not usable right now');
  if (replace !== 'brick' && replace !== 'lumber') {
    return err('BAD_TRADE', 'mendicant only substitutes for the brick or lumber in a road (research §2)');
  }
  if (!geometryForState(state).edges[edge]) return err('BAD_LOCATION', `edge ${edge} is off the board`);
  if (isEdgeOccupied(state, edge)) return err('OCCUPIED', `edge ${edge} already has a road`);
  const player = state.players[seat]!;
  if (player.piecesLeft.roads <= 0) return err('NO_PIECES_LEFT', 'no road pieces left');
  if (!isRoadConnected(state, seat, edge)) {
    return err('NOT_CONNECTED', `edge ${edge} does not connect to your network (R7.2)`);
  }

  const cost: ResourceBundle = { ...costsForState(state).road };
  cost[replace] = (cost[replace] ?? 0) - 1;
  if (cost[replace] === 0) delete cost[replace];
  cost[substitute] = (cost[substitute] ?? 0) + 1;
  if (!canAfford(player, cost)) return err('CANT_AFFORD', 'cannot afford the substituted road cost');

  const { players, bank } = payToBank(state, seat, cost);
  const placed = players.map((p) =>
    p.seat === seat
      ? { ...p, roads: [...p.roads, edge], piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads - 1 } }
      : p
  );
  const awarded = updateAwards({ ...state, players: placed, bank });
  const finished = finishHelperUse(awarded.state, seat);
  return {
    ok: true,
    state: finished.state,
    events: [
      built(seat, 'road', edge),
      ...awarded.events,
      asGameEvent(helperUsed(seat, 'mendicant', finished.side, { edge, replace, substitute })),
    ],
  };
}

// ---- Robber Bride (research §2: "send the robber to the desert, take 1 from that hex") ---------

export function useRobberBride(state: GameState, seat: Seat, target?: Seat): EngineResult {
  if (!canUseHelper(state, seat, 'robberBride')) return err('CANNOT_PLAY', 'robberBride is not usable right now');
  if (state.phase.kind !== 'preRoll' && state.phase.kind !== 'main') {
    return err('WRONG_PHASE', "robberBride only fires before rolling or during your own turn's main play");
  }
  const geometry = geometryForState(state);
  const desertHex = geometry.hexes.find((h) => state.board.hexes[h.id]?.terrain === 'desert')?.id;
  if (desertHex === undefined) return err('BAD_LOCATION', 'no desert hex on this board');
  if (state.board.robber === desertHex) return err('ROBBER_SAME_HEX', 'the robber is already on the desert');

  const oldHex = state.board.robber;
  const moved: GameState = { ...state, board: { ...state.board, robber: desertHex } };
  const candidates = stealCandidatesForHex(moved, oldHex);

  let afterSteal = moved;
  const events: GameEvent[] = [robberMoved(seat, desertHex)];
  if (candidates.length > 0) {
    if (target === undefined || !candidates.includes(target)) {
      return err('NOT_A_CANDIDATE', 'robberBride requires naming one of the eligible steal targets');
    }
    const stealResult = resolveSteal(moved, seat, target, state.phase.kind === 'preRoll' ? 'preRoll' : 'main', []);
    if (!stealResult.ok) return stealResult;
    afterSteal = stealResult.state;
    events.push(...stealResult.events);
  }

  const finished = finishHelperUse(afterSteal, seat);
  return {
    ok: true,
    state: finished.state,
    events: [
      ...events,
      asGameEvent(helperUsed(seat, 'robberBride', finished.side, { from: oldHex, to: desertHex, target })),
    ],
  };
}

// ---- Merchant (research §6: flagged the TRICKIEST helper) ---------------------------------------
//
// Real rule: "demand a specific resource from up to 2 players; for each you receive, give back any
// 1 resource." Simplifications taken here (documented per the task brief):
//  1. Both target seats (if 2) and each one's give-back resource are chosen UP FRONT in one action,
//     rather than an interactive per-target back-and-forth (like the domestic-trade sub-flow would
//     be) — the actor already sees the true state, so this is equivalent in outcome, just collapsed
//     into a single decision point.
//  2. A target holding 0 of the demanded resource is silently skipped (no error, no transfer) — the
//     rule's "for each you receive" already implies no give-back is owed for an empty-handed target.
//  3. The actor must be ABLE to afford each owed give-back at the moment it's paid (hand state
//     threads through the loop in order), or the whole action fails atomically — no partial merchant
//     use.

export function useMerchant(
  state: GameState,
  seat: Seat,
  targets: Seat[],
  demand: ResourceType,
  giveBack: Partial<Record<Seat, ResourceType>>
): EngineResult {
  if (!canUseHelper(state, seat, 'merchant')) return err('CANNOT_PLAY', 'merchant is not usable right now');
  if (targets.length < 1 || targets.length > 2) {
    return err('NOT_A_CANDIDATE', 'merchant demands from 1 or 2 players');
  }
  if (new Set(targets).size !== targets.length || targets.includes(seat)) {
    return err('NOT_A_CANDIDATE', 'merchant targets must be distinct opponents');
  }
  for (const t of targets) {
    if (!state.players[t]) return err('NOT_A_CANDIDATE', `seat ${t} does not exist`);
  }

  let players = state.players;
  const transfers: { target: Seat; took: boolean; gaveBack: ResourceType | null }[] = [];

  for (const t of targets) {
    const targetPlayer = players.find((p) => p.seat === t)!;
    if ((targetPlayer.resources[demand] ?? 0) < 1) {
      transfers.push({ target: t, took: false, gaveBack: null });
      continue;
    }
    const back = giveBack[t];
    if (!back) return err('BAD_TRADE', `merchant must name a card to give back to seat ${t}`);
    const actor = players.find((p) => p.seat === seat)!;
    if ((actor.resources[back] ?? 0) < 1) {
      return err('CANT_AFFORD', `seat ${seat} does not hold a ${back} card to give back`);
    }
    players = players.map((p) => {
      if (p.seat === t) {
        const resources = { ...p.resources };
        resources[demand] -= 1;
        resources[back] += 1;
        return { ...p, resources };
      }
      if (p.seat === seat) {
        const resources = { ...p.resources };
        resources[demand] += 1;
        resources[back] -= 1;
        return { ...p, resources };
      }
      return p;
    });
    transfers.push({ target: t, took: true, gaveBack: back });
  }

  const finished = finishHelperUse({ ...state, players }, seat);
  return {
    ok: true,
    state: finished.state,
    events: [asGameEvent(helperUsed(seat, 'merchant', finished.side, { demand, transfers }))],
  };
}

// ---- Captain (research §2: "trade one chosen resource at 2:1 with the bank, for the turn") ------

export function useCaptain(state: GameState, seat: Seat, resource: ResourceType): EngineResult {
  if (!canUseHelper(state, seat, 'captain')) return err('CANNOT_PLAY', 'captain is not usable right now');
  if (state.phase.kind !== 'main') return err('WRONG_PHASE', 'captain only activates during your main phase');
  const ext = helpersExt(state)!;
  const captainRate = ext.captainRate.slice();
  captainRate[seat] = resource;
  const activated: GameState = { ...state, ext: { ...state.ext, helpers: { ...ext, captainRate } } };
  const finished = finishHelperUse(activated, seat);
  return {
    ok: true,
    state: finished.state,
    events: [asGameEvent(helperUsed(seat, 'captain', finished.side, { resource }))],
  };
}

/**
 * Captain's discounted 2:1 bank trade — `index.ts`'s `interceptAction` reroutes a `bankTrade` here
 * whenever `give` matches the acting seat's active `captainRate`. Duplicates `phases/main.ts`'s
 * `bankTrade` shape with the rate forced to 2 rather than harbor-derived (2:1 is already the best
 * rate the base game ever offers, so there's no need to compare against the seat's own harbors).
 */
export function captainBankTrade(
  state: GameState,
  seat: Seat,
  give: ResourceType,
  receive: ResourceType
): EngineResult {
  if (give === receive) return err('BAD_TRADE', 'give and receive must be different resources (R8.2)');
  const player = state.players[seat]!;
  const rate = 2;
  if (player.resources[give] < rate) {
    return err('CANT_AFFORD', `trading ${give} needs ${rate} cards at Captain's rate, seat ${seat} holds ${player.resources[give]}`);
  }
  if (state.bank[receive] < 1) return err('BANK_EMPTY', `the bank has no ${receive} left`);

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

  const gave: ResourceBundle = { [give]: rate };
  const got: ResourceBundle = { [receive]: 1 };
  let next: GameState = { ...state, players, bank };
  const events: GameEvent[] = [bankTraded(seat, gave, got, rate)];
  if (next.trade != null) {
    next = { ...next, trade: null };
    events.push(tradeCancelled());
  }
  return { ok: true, state: next, events };
}

// ---- Noblewoman (research §2: "peek + steal 1 from a strictly higher-VP player") -----------------

export function useNoblewoman(state: GameState, seat: Seat, target: Seat): EngineResult {
  if (!canUseHelper(state, seat, 'noblewoman')) return err('CANNOT_PLAY', 'noblewoman is not usable right now');
  if (state.phase.kind !== 'main') return err('WRONG_PHASE', 'noblewoman fires after your roll, in the main phase');
  if (target === seat || !state.players[target]) {
    return err('NOT_A_CANDIDATE', `seat ${target} is not a legal target`);
  }
  if (computeVp(state, target).total <= computeVp(state, seat).total) {
    return err('NOT_ELIGIBLE', `seat ${target} does not hold strictly more VP than seat ${seat}`);
  }
  const targetPlayer = state.players[target]!;
  const flat: ResourceType[] = [];
  for (const res of RESOURCE_ORDER) for (let i = 0; i < targetPlayer.resources[res]; i++) flat.push(res);
  if (flat.length === 0) return err('NOT_A_CANDIDATE', `seat ${target} holds no cards to peek/steal`);

  const draw = pickIndex(state.rng, flat.length);
  const card = flat[draw.value]!;
  const players = state.players.map((p) => {
    if (p.seat === target) return { ...p, resources: { ...p.resources, [card]: p.resources[card] - 1 } };
    if (p.seat === seat) return { ...p, resources: { ...p.resources, [card]: p.resources[card] + 1 } };
    return p;
  });
  const next: GameState = { ...state, rng: draw.state, players };
  const finished = finishHelperUse(next, seat);
  return {
    ok: true,
    state: finished.state,
    events: [stolen(target, seat, card), asGameEvent(helperUsed(seat, 'noblewoman', finished.side, { target }))],
  };
}

// ---- Architect (research §2: "substitute 1 dev-card resource; look at top 3, choose") -----------
//
// PM NOTE (redaction): this reveals the top 3 dev-deck cards to the acting seat by construction —
// the 2 NOT chosen never appear in any event this function emits, so no OTHER seat learns them
// either; only the CHOSEN card appears in `devBought`, same as a normal buy (existing redaction
// pattern, T-204). Peek reveal fix (redact.ts hidden-info UX): the human client previously had no
// way to actually SEE those top-3 identities before picking (redact.ts strips `devDeck` entirely) —
// `useArchitectBeginPeek` below adds a "begin" step that reveals them to ONLY the acting seat's
// `PlayerView` (via `HelpersExt.architectPeek`) BEFORE this commit runs; this function itself is
// otherwise unchanged and still works standalone (e.g. for bots/tests that never call it).

/**
 * Architect peek reveal, step 1/2 (`useHelper{helper:'architect', beginPeek:true}`): snapshots the
 * real top-3 `devDeck` cards into `architectPeek[seat]` — no deck/bank/hand change, so `redact.ts`
 * can reveal them to `seat`'s own `PlayerView` only. Does NOT call `finishHelperUse` (a peek doesn't
 * spend the A/B use — only the commit below does), so `seat` may re-peek (idempotent, same top-3)
 * or simply let the turn end without ever committing.
 */
export function useArchitectBeginPeek(state: GameState, seat: Seat): EngineResult {
  if (!canUseHelper(state, seat, 'architect')) return err('CANNOT_PLAY', 'architect is not usable right now');
  if (state.phase.kind !== 'main') return err('WRONG_PHASE', 'buying a development card is main-phase only (R9.1)');
  if (state.devDeck.length === 0) return err('DECK_EMPTY', 'the development card deck is empty (R9.1)');
  const ext = helpersExt(state)!;
  const architectPeek = ext.architectPeek.map((c, i) => (i === seat ? state.devDeck.slice(0, 3) : c));
  return {
    ok: true,
    state: { ...state, ext: { ...state.ext, helpers: { ...ext, architectPeek } } },
    events: [],
  };
}

export function useArchitect(
  state: GameState,
  seat: Seat,
  pick: 0 | 1 | 2,
  replace: ResourceType,
  substitute: ResourceType
): EngineResult {
  if (!canUseHelper(state, seat, 'architect')) return err('CANNOT_PLAY', 'architect is not usable right now');
  if (state.phase.kind !== 'main') return err('WRONG_PHASE', 'buying a development card is main-phase only (R9.1)');
  if (state.devDeck.length === 0) return err('DECK_EMPTY', 'the development card deck is empty (R9.1)');
  if (pick >= state.devDeck.length) {
    return err('DECK_EMPTY', `fewer than ${pick + 1} cards remain to look at`);
  }
  const player = state.players[seat]!;
  const cost: ResourceBundle = { ...costsForState(state).devCard };
  cost[replace] = (cost[replace] ?? 0) - 1;
  if (cost[replace] === 0) delete cost[replace];
  cost[substitute] = (cost[substitute] ?? 0) + 1;
  if (!canAfford(player, cost)) return err('CANT_AFFORD', 'cannot afford the substituted development-card cost');

  const card = state.devDeck[pick]!;
  const devDeck = state.devDeck.slice();
  devDeck.splice(pick, 1);
  const { players, bank } = payToBank(state, seat, cost);
  const withCard = players.map((p) =>
    p.seat === seat ? { ...p, devCards: [...p.devCards, { type: card, boughtOnTurn: state.turn.number }] } : p
  );
  // Peek reveal hygiene: committing clears this seat's pending peek (if any) — folded into the
  // state BEFORE `finishHelperUse` runs so its own `ext.helpers` bookkeeping builds on top of it.
  const ext = helpersExt(state);
  const clearedHelpers = ext ? { ...ext, architectPeek: ext.architectPeek.map((c, i) => (i === seat ? null : c)) } : undefined;
  const next: GameState = {
    ...state,
    players: withCard,
    bank,
    devDeck,
    ext: clearedHelpers ? { ...state.ext, helpers: clearedHelpers } : state.ext,
  };
  const finished = finishHelperUse(next, seat);
  return {
    ok: true,
    state: finished.state,
    events: [
      devBought(seat, card),
      asGameEvent(helperUsed(seat, 'architect', finished.side, { pick, replace, substitute })),
    ],
  };
}

// ---- Priest (research §6: flagged the SECOND-trickiest helper) ---------------------------------
//
// Real rule: "discard a Knight (dev) card to build a settlement/city at reduced cost." Simplifications:
//  1. Reduced costs: settlement = 1 brick + 1 lumber (skip wool + grain); city = 2 ore + 1 grain
//     (skip 1 ore) — the research doc flags the EXACT printed costs as unconfirmed; these are the
//     values given in §2's summary.
//  2. Discarding the Knight is treated as a pure cost substitution, NOT as "playing" it — it does
//     NOT consume `turn.devPlayed` (R9.3's one-dev-card-per-turn allowance) and is exempt from
//     R9.4's "not bought this same turn" restriction, since the ability discards the card rather
//     than invoking its own robber-move effect.

export function usePriest(state: GameState, seat: Seat, build: 'settlement' | 'city', vertex: VertexId): EngineResult {
  if (!canUseHelper(state, seat, 'priest')) return err('CANNOT_PLAY', 'priest is not usable right now');
  if (state.phase.kind !== 'main') return err('WRONG_PHASE', 'building is main-phase only (R4 step 2)');
  const player = state.players[seat]!;
  const knightIndex = player.devCards.findIndex((c) => c.type === 'knight');
  if (knightIndex === -1) return err('CARD_NOT_HELD', `seat ${seat} holds no Knight card to discard`);

  if (build === 'settlement') {
    if (!geometryForState(state).vertices[vertex]) return err('BAD_LOCATION', `vertex ${vertex} is off the board`);
    if (!satisfiesDistanceRule(state, vertex)) {
      return err('DISTANCE_RULE', `vertex ${vertex} fails the distance rule (R7.3)`);
    }
    if (!ownRoadOrShipAt(state, seat, vertex)) {
      return err('NOT_CONNECTED', 'a settlement must touch one of your roads (R7.3)');
    }
    if (player.piecesLeft.settlements <= 0) return err('NO_PIECES_LEFT', 'no settlement pieces left');
    const cost: ResourceBundle = { brick: 1, lumber: 1 };
    if (!canAfford(player, cost)) return err('CANT_AFFORD', "cannot afford Priest's reduced settlement cost");

    const { players, bank } = payToBank(state, seat, cost);
    const withKnightGone = players.map((p) => {
      if (p.seat !== seat) return p;
      const devCards = p.devCards.slice();
      devCards.splice(knightIndex, 1);
      return {
        ...p,
        devCards,
        settlements: [...p.settlements, vertex],
        piecesLeft: { ...p.piecesLeft, settlements: p.piecesLeft.settlements - 1 },
      };
    });
    const awarded = updateAwards({ ...state, players: withKnightGone, bank });
    const finished = finishHelperUse(awarded.state, seat);
    return {
      ok: true,
      state: finished.state,
      events: [
        built(seat, 'settlement', vertex),
        ...awarded.events,
        asGameEvent(helperUsed(seat, 'priest', finished.side, { build, vertex })),
      ],
    };
  }

  if (!player.settlements.includes(vertex)) {
    return err('BAD_LOCATION', 'a city must replace one of your own settlements (R7.4)');
  }
  if (player.piecesLeft.cities <= 0) return err('NO_PIECES_LEFT', 'no city pieces left');
  const cost: ResourceBundle = { ore: 2, grain: 1 };
  if (!canAfford(player, cost)) return err('CANT_AFFORD', "cannot afford Priest's reduced city cost");

  const { players, bank } = payToBank(state, seat, cost);
  const withKnightGone = players.map((p) => {
    if (p.seat !== seat) return p;
    const devCards = p.devCards.slice();
    devCards.splice(knightIndex, 1);
    return {
      ...p,
      devCards,
      settlements: p.settlements.filter((s) => s !== vertex),
      cities: [...p.cities, vertex],
      piecesLeft: { ...p.piecesLeft, settlements: p.piecesLeft.settlements + 1, cities: p.piecesLeft.cities - 1 },
    };
  });
  const awarded = updateAwards({ ...state, players: withKnightGone, bank });
  const finished = finishHelperUse(awarded.state, seat);
  return {
    ok: true,
    state: finished.state,
    events: [
      built(seat, 'city', vertex),
      ...awarded.events,
      asGameEvent(helperUsed(seat, 'priest', finished.side, { build, vertex })),
    ],
  };
}
