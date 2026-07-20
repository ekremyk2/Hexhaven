// T-410 support: legal-action ENUMERATION for a (state, seat) pair — the full set, not a single
// pick. Built entirely on legal.ts's summaries (never a second copy of the rules), mirroring
// sim/bot.ts's per-phase candidate lists (T-112) but returning every option instead of picking one
// at random; both search.ts's root and greedyBaseline.ts's one-ply ranking scan this same list.

import { hasAtLeast } from '@hexhaven/shared';
import type { Action, GameState, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import { canAfford } from '../rules/afford.js';
import { costsForState, resolveConstants } from '../modules/index.js';
import { legalSpecialBuildActions, partialTurnOf } from '../modules/fiveSix/common.js';
import {
  bankTradeOptions,
  buildAffordability,
  canBuildShip,
  goldPickCount,
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
} from '../legal.js';

const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

/** A modest, deterministic sample of representative domestic offers (task requirement 5: "trades
 * ... offers if the search finds them positive") — NOT exhaustive (the space of give/receive
 * bundles is enormous); one offer per (give exactly 1 of a held type, receive exactly 1 of a
 * different type) covers the common "swap a surplus card for a needed one" shape and gives the
 * search/eval something concrete to rank against every other main-phase option. */
function offerTradeCandidates(state: GameState, seat: Seat): Action[] {
  const player = state.players[seat];
  if (!player) return [];
  const out: Action[] = [];
  for (const give of RESOURCE_TYPES) {
    if (player.resources[give] < 1) continue;
    for (const receive of RESOURCE_TYPES) {
      if (receive === give) continue;
      const giveBundle: ResourceBundle = { [give]: 1 };
      const receiveBundle: ResourceBundle = { [receive]: 1 };
      out.push({ type: 'offerTrade', give: giveBundle, receive: receiveBundle });
    }
  }
  return out;
}

/** Every (a, b) pair the bank can currently supply for Year of Plenty (ER-6), a === b included.
 *  T-906 (docs/07 D-034 `customConstants.yearOfPlentyCount`): this enumerator only ever proposes
 *  the base 2-pick shape, so it stops proposing Year of Plenty at all once a host configures a
 *  DIFFERENT count — the engine would reject the 2-pick shape with `BAD_YOP_COUNT` otherwise. A
 *  soft AI-quality degradation (not a rule bug), flagged in the T-906 report. */
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

/** Discard sub-phase (R6.1): every DISTINCT multiset of exactly `owed` cards drawn from the seat's
 * hand, capped at `DISCARD_CANDIDATE_CAP` for very large hands — the search still ranks a broad,
 * diverse sample by `evaluate` rather than falling back to a single hard-coded heuristic (task
 * requirement 5: discards are decided BY the search, not special-cased). */
const DISCARD_CANDIDATE_CAP = 200;

function discardCandidates(state: GameState, seat: Seat, owed: number): Action[] {
  const player = state.players[seat];
  if (!player || owed <= 0) return [];
  const counts = RESOURCE_TYPES.map((r) => ({ r, n: player.resources[r] }));
  const results: ResourceBundle[] = [];

  function rec(i: number, remaining: number, acc: ResourceBundle): void {
    if (results.length >= DISCARD_CANDIDATE_CAP) return;
    if (remaining === 0) {
      results.push({ ...acc });
      return;
    }
    if (i >= counts.length) return;
    const entry = counts[i];
    if (!entry) return;
    const { r, n } = entry;
    const maxTake = Math.min(n, remaining);
    for (let take = maxTake; take >= 0; take--) {
      if (results.length >= DISCARD_CANDIDATE_CAP) return;
      const next = { ...acc };
      if (take > 0) next[r] = take;
      rec(i + 1, remaining - take, next);
    }
  }
  rec(0, owed, {});
  return results.map((cards) => ({ type: 'discard', cards }) as Action);
}

/** Gold sub-phase (S9/ER-S7): every DISTINCT multiset of exactly `need` cards drawable from the
 * bank's current per-resource stock (capped for large entitlements, like discards). The search ranks
 * these by `evaluate` rather than a hard-coded pick. */
function goldCandidates(state: GameState, seat: Seat): Action[] {
  const need = goldPickCount(state, seat);
  if (need <= 0) return [];
  const counts = RESOURCE_TYPES.map((r) => ({ r, n: state.bank[r] }));
  const results: ResourceBundle[] = [];

  function rec(i: number, remaining: number, acc: ResourceBundle): void {
    if (results.length >= DISCARD_CANDIDATE_CAP) return;
    if (remaining === 0) {
      results.push({ ...acc });
      return;
    }
    if (i >= counts.length) return;
    const entry = counts[i];
    if (!entry) return;
    const { r, n } = entry;
    const maxTake = Math.min(n, remaining);
    for (let take = maxTake; take >= 0; take--) {
      if (results.length >= DISCARD_CANDIDATE_CAP) return;
      const next = { ...acc };
      if (take > 0) next[r] = take;
      rec(i + 1, remaining - take, next);
    }
  }
  rec(0, need, {});
  return results.map((picks) => ({ type: 'chooseGoldResource', picks }) as Action);
}

/**
 * Every legal action for `seat` on `state` right now (task requirement 4: "handles ALL decision
 * points"). `seat` need not be `state.turn.player` — `discard` (R6.1) and `respondTrade` (R8.1) are
 * the two exceptions reduce.ts's actor guard allows, mirroring sim/bot.ts's dispatch.
 */
export function enumerateCandidates(state: GameState, seat: Seat): Action[] {
  if (state.phase.kind === 'discard') {
    return discardCandidates(state, seat, state.phase.amounts[seat]);
  }
  // Seafarers gold (S9/ER-S7): a pending seat (possibly a non-owner) chooses its resources.
  if (state.phase.kind === 'chooseGoldResource') {
    return state.phase.pending.includes(seat) ? goldCandidates(state, seat) : [];
  }
  // 5–6 SBP (X12): the current builder acts although `turn.player` is the seat whose turn just
  // ended — handle before the non-owner branch (otherwise it'd be treated as a trade responder).
  if (state.phase.kind === 'specialBuild') {
    return state.phase.builder === seat ? legalSpecialBuildActions(state, seat) : [];
  }
  if (seat !== state.turn.player) {
    if (state.trade == null) return [];
    // A responder may `accept` in principle without holding the cards (main.ts's `respondTrade`
    // doesn't hand-check — `confirmTrade` re-verifies), but then the owner's confirm fails with
    // CANT_AFFORD and the trade dead-ends. So a bot only ACCEPTS when it currently holds the
    // requested `receive`; otherwise it can only decline. (The bot IS the responder here, so its own
    // resources are exact even on a determinized state.)
    const responder = state.players[seat];
    const canFulfill = !!responder && hasAtLeast(responder.resources, state.trade.receive);
    return canFulfill
      ? [
          { type: 'respondTrade', response: 'accept' },
          { type: 'respondTrade', response: 'decline' },
        ]
      : [{ type: 'respondTrade', response: 'decline' }];
  }

  switch (state.phase.kind) {
    case 'setup':
      if (state.phase.expect === 'settlement') {
        return legalSetupSettlements(state).map((vertex) => ({ type: 'placeSetupSettlement', vertex }) as Action);
      }
      return legalSetupRoads(state).map((edge) => ({ type: 'placeSetupRoad', edge }) as Action);
    case 'preRoll':
      return [{ type: 'rollDice' }, ...devCardCandidates(state, seat)];
    case 'moveRobber':
      // Seafarers (S8.2): move the robber (to land) OR the pirate (to a sea hex).
      return [
        ...legalRobberHexes(state).map((hex) => ({ type: 'moveRobber', hex }) as Action),
        ...legalPirateHexes(state).map((hex) => ({ type: 'movePirate', hex }) as Action),
      ];
    case 'steal':
      return state.phase.candidates.map((from) => ({ type: 'steal', from }) as Action);
    case 'caravanVote': {
      // T-1004 (Caravans): a still-pending seat may bid (abstain `{0,0}` is always legal); once bids
      // resolve, the vote winner places one camel on a free route edge. Mirrors sim/bot.ts.
      const phase = state.phase;
      if (phase.pending.includes(seat)) return [{ type: 'caravanVote', grain: 0, wool: 0 }];
      if (phase.winner === seat) return legalCamelEdges(state).map((edge) => ({ type: 'placeCamel', edge }) as Action);
      return [];
    }
    case 'roadBuilding':
      // legalFreeRoadEdges scans the ACTIVE board's edges (5–6 EXT56 / seafarers scenario, not the
      // base 19-hex GEOMETRY) and applies the seafarers land-edge + ship-aware occupancy filters, so a
      // free road is never proposed on a pure sea route (S3.2) or a ship edge (S3.3). Base: unchanged.
      // Seafarers (S11.1): a free piece may also be a ship.
      return [
        ...legalFreeRoadEdges(state, seat).map((edge) => ({ type: 'placeFreeRoad', edge }) as Action),
        ...legalFreeShipEdges(state, seat).map((edge) => ({ type: 'placeFreeShip', edge }) as Action),
      ];
    case 'main': {
      // Paired-Players partial turn (X12): supply trade + build + ≤1 dev card + pass. NO player
      // trades, no plain endTurn. `phase` is `main` but `ext` marks the restricted partial turn.
      const partial = partialTurnOf(state) !== null;
      const out: Action[] = partial ? [{ type: 'passSpecialBuild' }] : [{ type: 'endTurn' }];
      const afford = buildAffordability(state, seat);
      if (afford.road) {
        out.push(...legalRoadEdges(state, seat).map((edge) => ({ type: 'buildRoad', edge }) as Action));
      }
      if (afford.settlement) {
        out.push(
          ...legalSettlementVertices(state, seat).map((vertex) => ({ type: 'buildSettlement', vertex }) as Action)
        );
      }
      if (afford.city) {
        out.push(...legalCityVertices(state, seat).map((vertex) => ({ type: 'buildCity', vertex }) as Action));
      }
      // Seafarers (S4/S7): ship builds and open-ship relocations. Empty in a base/fiveSix game.
      if (canBuildShip(state, seat)) {
        out.push(...legalShipEdges(state, seat).map((edge) => ({ type: 'buildShip', edge }) as Action));
      }
      for (const from of movableShips(state, seat)) {
        out.push(...shipMoveTargets(state, seat, from).map((to) => ({ type: 'moveShip', from, to }) as Action));
      }
      const player = state.players[seat];
      if (player && state.devDeck.length > 0 && canAfford(player, costsForState(state).devCard)) {
        out.push({ type: 'buyDevCard' });
      }
      out.push(...bankTradeCandidates(state, seat));
      out.push(...devCardCandidates(state, seat));
      if (partial) return out; // player-to-player trading is blocked during a partial turn
      // Only propose a domestic offer if none has been made this turn (B-21 loop guard: `offerTrade`
      // sets `turn.offeredThisTurn`, so a bot offers at most once per turn — after it's declined the
      // bot moves on instead of re-offering the identical trade forever).
      if (state.trade == null && !state.turn.offeredThisTurn) {
        out.push(...offerTradeCandidates(state, seat));
      } else if (state.trade != null) {
        out.push({ type: 'cancelTrade' });
        const trade = state.trade;
        const owner = state.players[seat];
        // Mirrors legal.ts's `tradeOfferSummary().confirmable` (main.ts's `confirmTrade` handler
        // re-verifies exactly this at execution time): both the owner's `give` and the accepter's
        // `receive` must CURRENTLY be held, not just accepted-in-principle — a response is not
        // hand-checked at accept time (phases/main.ts's `respondTrade`), so `responses[s] ===
        // 'accepted'` alone is not enough. NOTE: on a determinized sample, the "accepter's `receive`
        // holdings" input to this check is itself SAMPLED, not truth — see bot.ts's root-candidate
        // filter, which drops `confirmTrade` before it can ever become the bot's OWN final decision
        // for exactly that reason. Safe here because every caller of `enumerateCandidates` besides
        // that one root call (greedyBaseline's one-ply score, and the search's internal rollouts)
        // immediately re-verifies via the real `reduce` on the SAME self-consistent state anyway.
        if (owner && hasAtLeast(owner.resources, trade.give)) {
          const confirmable = state.players
            .filter((p) => p.seat !== seat && trade.responses[p.seat] === 'accepted' && hasAtLeast(p.resources, trade.receive))
            .map((p) => p.seat);
          for (const withSeat of confirmable) out.push({ type: 'confirmTrade', with: withSeat });
        }
      }
      return out;
    }
    case 'ended':
      return [];
  }
}
