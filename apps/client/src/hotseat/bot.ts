// src/hotseat/bot.ts (T-305 requirement 2: "🤖 bot move" / "bot until my next turn"). The engine's
// own random-legal-move bot (packages/engine/src/sim/bot.ts) is deliberately kept sim-internal —
// index.ts's header comment says so explicitly, and it isn't part of `@hexhaven/engine`'s package
// exports — so this is the client's own analogous picker, built entirely from the public
// `legal.ts` enumerators `@hexhaven/engine` re-exports. It's deliberately simpler than the engine's
// tuned sim bot: no dev-card plays, no domestic trade offers, so it can never stall on an open
// trade it created itself. (Prior to the B-caravan-vote-bots fix this comment also claimed
// `roadBuilding`'s free-road placements had "no public enumerator" — stale: `legalFreeRoadEdges`/
// `legalFreeShipEdges` are `@hexhaven/engine` package exports, same as everything else imported below,
// and are now used.) Good enough for "advance the game for solo playtesting" — a tuned
// game-completion bot is T-112's job, not this harness's.
import {
  bankTradeOptions,
  buildAffordability,
  goldPickCount,
  legalCamelEdges,
  legalCityVertices,
  legalFreeRoadEdges,
  legalFreeShipEdges,
  legalRoadEdges,
  legalRobberHexes,
  legalSettlementVertices,
  legalSetupRoads,
  legalSetupSettlements,
  stealCandidates,
} from '@hexhaven/engine';
import { COSTS, hasAtLeast } from '@hexhaven/shared';
import type { Action, GameState, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import { computeActiveSeat, type LocalTransport } from './localTransport';

const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function pick<T>(items: readonly T[]): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

/** A uniformly random valid discard (R6.1) of exactly the owed count, drawn without replacement
 * from the seat's flattened hand — same shape as `sim/bot.ts`'s own `discardAction`, just driven
 * by `Math.random` (fine here: this file lives in `apps/client`, not `packages/engine`). */
function randomDiscard(state: GameState, seat: Seat): Action | null {
  if (state.phase.kind !== 'discard') return null;
  const owed = state.phase.amounts[seat];
  const player = state.players[seat];
  if (owed === undefined || !player) return null;
  const pool: ResourceType[] = [];
  for (const res of RESOURCE_TYPES) {
    for (let i = 0; i < player.resources[res]; i++) pool.push(res);
  }
  const cards: ResourceBundle = {};
  for (let i = 0; i < owed && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const res = pool.splice(idx, 1)[0]!;
    cards[res] = (cards[res] ?? 0) + 1;
  }
  return { type: 'discard', cards };
}

/** Road Building dev card (R+free road; Seafarers S11.1 free ship): every free road/ship placement
 *  `seat` can currently make, mirroring the engine's own sim bot (`sim/bot.ts`'s
 *  `roadBuildingAction`) via the public `legalFreeRoadEdges`/`legalFreeShipEdges` enumerators —
 *  `[]` in a base (non-seafarers) game for the ship half. */
function roadBuildingCandidates(state: GameState, seat: Seat): Action[] {
  return [
    ...legalFreeRoadEdges(state, seat).map((edge) => ({ type: 'placeFreeRoad', edge }) as Action),
    ...legalFreeShipEdges(state, seat).map((edge) => ({ type: 'placeFreeShip', edge }) as Action),
  ];
}

/** Seafarers gold sub-phase (S9/ER-S7): a uniformly random valid pick of exactly the owed count,
 *  drawn without replacement from the bank's current stock — same shape as `randomDiscard` above
 *  (`Math.random`-driven; fine here, `apps/client`, not `packages/engine`). */
function chooseGoldResourceAction(state: GameState, seat: Seat): Action {
  const need = goldPickCount(state, seat);
  const pool: ResourceType[] = [];
  for (const res of RESOURCE_TYPES) for (let i = 0; i < state.bank[res]; i++) pool.push(res);
  const picks: ResourceBundle = {};
  for (let i = 0; i < need && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const res = pool.splice(idx, 1)[0]!;
    picks[res] = (picks[res] ?? 0) + 1;
  }
  return { type: 'chooseGoldResource', picks };
}

/** Every maritime trade `seat` can currently afford and the bank can currently supply (R8.2). */
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

/** Build/buy actions `seat` can afford right now (shared by the main turn and the SBP builder). */
function buildBuyCandidates(state: GameState, seat: Seat): Action[] {
  const buildBuy: Action[] = [];
  const afford = buildAffordability(state, seat);
  if (afford.road) {
    buildBuy.push(...legalRoadEdges(state, seat).map((edge) => ({ type: 'buildRoad', edge }) as Action));
  }
  if (afford.settlement) {
    buildBuy.push(
      ...legalSettlementVertices(state, seat).map((vertex) => ({ type: 'buildSettlement', vertex }) as Action),
    );
  }
  if (afford.city) {
    buildBuy.push(...legalCityVertices(state, seat).map((vertex) => ({ type: 'buildCity', vertex }) as Action));
  }
  const player = state.players[seat];
  if (player && state.devDeck.length > 0 && hasAtLeast(player.resources, COSTS.devCard)) {
    buildBuy.push({ type: 'buyDevCard' });
  }
  return buildBuy;
}

/** 5–6 Special Building Phase (X12 §6): the builder may build/buy from resources in hand or pass —
 * no trading, no dev-card plays, no rolling. Biases toward building when it can, else passes so the
 * SBP round advances (mirrors `sim/bot.ts`'s own SBP handling). */
function specialBuildCandidates(state: GameState, seat: Seat): Action[] {
  const buildBuy = buildBuyCandidates(state, seat);
  if (buildBuy.length > 0 && Math.random() < 0.6) return buildBuy;
  return [...buildBuy, { type: 'passSpecialBuild' }];
}

function mainCandidates(state: GameState, seat: Seat): Action[] {
  const buildBuy = buildBuyCandidates(state, seat);
  const other: Action[] = [{ type: 'endTurn' }, ...bankTradeCandidates(state, seat)];
  if (state.trade != null) {
    // The bot never opens a domestic offer itself (see file header), so the only way one is open
    // is the human proposed it — cancelling keeps the bot from stalling on someone else's offer.
    other.push({ type: 'cancelTrade' });
  }

  // Heavily bias toward building when something is affordable — mirrors `sim/bot.ts`'s own tuning
  // (there, 70% to dodge a 4,000-action budget; here, just to make "bot until my turn" feel like
  // it's actually playing rather than churning `endTurn`).
  if (buildBuy.length > 0 && Math.random() < 0.7) return buildBuy;
  return [...buildBuy, ...other];
}

/** One uniformly-random legal action for `seat` right now, or `null` when this simplified bot has
 * no candidate for the current phase (only once the game has ended, or the rare caravanVote
 * moment described above where neither branch applies) — the debug panel's raw-action JSON box is
 * the fallback for those. */
export function pickBotAction(state: GameState, seat: Seat): Action | null {
  if (state.phase.kind === 'discard') return randomDiscard(state, seat);
  // 5–6 SBP (X12): the builder acts while `turn.player` is the seat whose turn just ended, so this
  // must be handled BEFORE the turn.player check below.
  if (state.phase.kind === 'specialBuild') {
    return state.phase.builder === seat ? pick(specialBuildCandidates(state, seat)) : null;
  }
  // Caravans (§TB4.2, T-1004): `pending` is EVERY seat (builder first) and the resolved `winner`
  // (once `pending` is empty) owes a `placeCamel` — both routinely differ from `turn.player`, so
  // this must ALSO be handled BEFORE the turn.player check below (same reason as specialBuild
  // above). Bidding always abstains (`{grain:0, wool:0}`) — deliberately simple/safe: an all-abstain
  // vote resolves immediately with no camel needed (caravans.ts's `caravanVoteHandler`), so this
  // alone is enough to drive an all-bot vote to resolution without ever stalling. The `placeCamel`
  // branch below is a defensive fallback for the one path a BOT can still become the winner despite
  // always bidding 0: a tie among two or more HUMAN seats bidding equally resolves to the BUILDER
  // (§TB4.2), who may be a bot.
  if (state.phase.kind === 'caravanVote') {
    const phase = state.phase;
    if (phase.pending.includes(seat)) return { type: 'caravanVote', grain: 0, wool: 0 };
    return phase.winner === seat
      ? pick(legalCamelEdges(state).map((edge) => ({ type: 'placeCamel', edge }) as Action))
      : null;
  }
  if (seat !== state.turn.player) {
    // The only other seat ever allowed to act (R8.1): a pending trade responder.
    return pick([
      { type: 'respondTrade', response: 'accept' },
      { type: 'respondTrade', response: 'decline' },
    ]);
  }

  switch (state.phase.kind) {
    case 'setup':
      return state.phase.expect === 'settlement'
        ? pick(legalSetupSettlements(state).map((vertex) => ({ type: 'placeSetupSettlement', vertex }) as Action))
        : pick(legalSetupRoads(state).map((edge) => ({ type: 'placeSetupRoad', edge }) as Action));
    case 'preRoll':
      return { type: 'rollDice' };
    case 'moveRobber':
      return pick(legalRobberHexes(state).map((hex) => ({ type: 'moveRobber', hex }) as Action));
    case 'steal':
      return pick(stealCandidates(state).map((from) => ({ type: 'steal', from }) as Action));
    case 'main':
      return pick(mainCandidates(state, seat));
    // `specialBuild` is handled above (the builder ≠ turn.player). The 2022 Paired-Players partial
    // turn is a `main` turn owned by the paired builder, so it is covered by the `main` case.
    // `caravanVote` (§TB4.2, T-1004) is handled above too (its pending/winner seats routinely ≠
    // turn.player) — narrowed out of `state.phase` by that early return, so it has no case here.
    case 'roadBuilding':
      return pick(roadBuildingCandidates(state, seat));
    case 'chooseGoldResource':
      return chooseGoldResourceAction(state, seat);
    case 'ended':
      return null;
    default: {
      const exhaustive: never = state.phase;
      return exhaustive;
    }
  }
}

export type BotStopReason = 'reachedSeat' | 'ended' | 'noLegalAction' | 'maxActionsExceeded';

/** Plays exactly one bot action for whichever seat currently must act (requirement 2's "bot move"
 * button). Returns `false` (does nothing) when this simplified bot has no action for the current
 * phase — the caller should point the user at the raw-action JSON box instead. */
export function playBotMove(transport: LocalTransport): boolean {
  const state = transport.getGameState();
  if (state.phase.kind === 'ended') return false;
  const seat = computeActiveSeat(state);
  const action = pickBotAction(state, seat);
  if (action === null) return false;
  transport.send(action);
  return true;
}

/** Runs bot moves until `targetSeat` is the acting seat again (requirement 2's "bot until my next
 * turn"), or until one of the guard conditions trips. Never loops unboundedly. */
export function runBotUntilSeat(
  transport: LocalTransport,
  targetSeat: Seat,
  maxActions = 500,
): { steps: number; reason: BotStopReason } {
  let steps = 0;
  while (steps < maxActions) {
    const state = transport.getGameState();
    if (state.phase.kind === 'ended') return { steps, reason: 'ended' };
    if (computeActiveSeat(state) === targetSeat) return { steps, reason: 'reachedSeat' };
    const played = playBotMove(transport);
    if (!played) return { steps, reason: 'noLegalAction' };
    steps += 1;
  }
  return { steps, reason: 'maxActionsExceeded' };
}
