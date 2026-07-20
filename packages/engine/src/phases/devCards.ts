// Development cards (R9; R4.1; ER-5; ER-6): buying, the four "play" actions (Knight, Road
// Building, Year of Plenty, Monopoly — Victory Point cards are never played, R9.8 — there is no
// action for them, enforced at the `Action` union type level), and the `roadBuilding` sub-phase's
// free placements. Buying is main-phase only (R9.1/R9.2, routed by phases/main.ts). The four play
// actions are legal in BOTH preRoll and main (R4.1) — phases/roll.ts and phases/main.ts both route
// into the functions here. Knight reuses the T-106 robber pipeline completely untouched: this
// module only flips the phase to `moveRobber`; phases/robber.ts's moveRobberHandler/stealHandler
// (already generic over `returnTo`) do the rest.

import { hasAtLeast } from '@hexhaven/shared';
import type {
  AnyDevCardId,
  EngineErrorCode,
  GameEvent,
  GameState,
  Phase,
  ResourceBundle,
  ResourceType,
  Seat,
} from '@hexhaven/shared';
import type { EngineResult, PhaseHandler } from '../reduce.js';
import { built, devBought, devPlayed, monopolyResolved, tradeCancelled } from '../events.js';
import { costsForState, geometryForState, resolveConstants } from '../modules/index.js';
import { canAfford, payToBank } from '../rules/afford.js';
import { canPlaceRoad } from '../rules/connectivity.js';
import { updateAwards } from '../rules/awards.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

// ---- Common play guards (R9.3/R9.4, task requirement 3) --------------------------------------

/**
 * R9.4's "not bought this same turn" gate for a single card, waived when the `playDevSameTurn`
 * modifier is enabled (T-906, docs/07 D-034, modules/modifiers/playDevSameTurn.ts) — resolved via
 * the same `ModuleConstants` seam `customTargetVp` uses (modules/types.ts). This is the ONE minimal
 * hook that modifier needs into base engine code; see its module header for why no cleaner seam
 * exists (the four play actions are routed to four separate functions from two different phase
 * handlers, so a per-card constant check here is far less invasive than reimplementing all four).
 */
function devCardIsPlayable(state: GameState, boughtOnTurn: number): boolean {
  if (resolveConstants(state.config).allowDevCardSameTurnPlay) return true;
  return boughtOnTurn !== state.turn.number;
}

/**
 * Read-only reason `type` currently can't be played by `seat`, or `null` if the common guards all
 * pass. Order is the task ruling exactly: held at all? → already played a dev this turn? → only
 * held copies bought this same turn? Card-specific extra gates (Road Building's CANNOT_PLAY,
 * Year of Plenty's BANK_EMPTY) are layered on top by their own functions / by legal.ts.
 */
export function commonPlayBlockReason(
  state: GameState,
  seat: Seat,
  type: AnyDevCardId
): 'CARD_NOT_HELD' | 'DEV_ALREADY_PLAYED' | 'DEV_BOUGHT_THIS_TURN' | null {
  const player = state.players[seat];
  if (!player || !player.devCards.some((c) => c.type === type)) return 'CARD_NOT_HELD';
  if (state.turn.devPlayed) return 'DEV_ALREADY_PLAYED'; // R9.3: one dev card per turn
  const hasPlayable = player.devCards.some(
    (c) => c.type === type && devCardIsPlayable(state, c.boughtOnTurn)
  );
  return hasPlayable ? null : 'DEV_BOUGHT_THIS_TURN'; // R9.4
}

/**
 * Common tail shared by all four "play" actions: validate via `commonPlayBlockReason`, then
 * remove ONE playable card of `type` from `seat`'s hand and mark this turn's one-dev-card
 * allowance used. `events` is always `[]` here — callers prepend their own `devPlayed(...)` (some
 * attach a `detail`) after any card-specific gate (e.g. CANNOT_PLAY) that must still fire on an
 * UNCHANGED state.
 */
export function beginPlay(state: GameState, seat: Seat, type: AnyDevCardId): EngineResult {
  const reason = commonPlayBlockReason(state, seat, type);
  if (reason === 'CARD_NOT_HELD') return fail('CARD_NOT_HELD', `seat ${seat} holds no ${type} card`);
  if (reason === 'DEV_ALREADY_PLAYED') {
    return fail('DEV_ALREADY_PLAYED', 'a development card was already played this turn (R9.3)');
  }
  if (reason === 'DEV_BOUGHT_THIS_TURN') {
    return fail(
      'DEV_BOUGHT_THIS_TURN',
      `the only ${type} card(s) seat ${seat} holds were bought this turn (R9.4)`
    );
  }

  const player = state.players[seat]!;
  const playableIndex = player.devCards.findIndex(
    (c) => c.type === type && devCardIsPlayable(state, c.boughtOnTurn)
  );
  if (playableIndex === -1) {
    // Unreachable: `reason === null` above already proved such a card exists.
    throw new Error(`BUG: beginPlay found no playable ${type} card for seat ${seat} after guards passed`);
  }

  const devCards = player.devCards.slice();
  devCards.splice(playableIndex, 1);
  const players = state.players.map((p) => (p.seat === seat ? { ...p, devCards } : p));
  const next: GameState = { ...state, players, turn: { ...state.turn, devPlayed: true } };
  return { ok: true, state: next, events: [] };
}

// ---- Buy (R9.1/R9.2) ---------------------------------------------------------------------------

/**
 * R9.1/R9.2: draw `devDeck[0]` into `seat`'s hand with the purchase turn recorded. Main-phase only
 * — enforced by the caller's routing (phases/main.ts), not re-checked here. Mirrors the
 * finishBuild/bankTrade trade-cancel tail in phases/main.ts (ER-11).
 */
export function buyDevCard(state: GameState, seat: Seat): EngineResult {
  if (state.devDeck.length === 0) {
    return fail('DECK_EMPTY', 'the development card deck is empty (R9.1)');
  }
  const player = state.players[seat]!;
  const costs = costsForState(state);
  if (!canAfford(player, costs.devCard)) return fail('CANT_AFFORD', 'cannot afford a development card');

  const card = state.devDeck[0]!;
  const devDeck = state.devDeck.slice(1);
  const { players, bank } = payToBank(state, seat, costs.devCard);
  const withCard = players.map((p) =>
    p.seat === seat
      ? { ...p, devCards: [...p.devCards, { type: card, boughtOnTurn: state.turn.number }] }
      : p
  );

  let next: GameState = { ...state, players: withCard, bank, devDeck };
  const events: GameEvent[] = [devBought(seat, card)];
  // ER-11: like a build or bank trade, buying cancels any open domestic offer.
  if (next.trade != null) {
    next = { ...next, trade: null };
    events.push(tradeCancelled());
  }
  return { ok: true, state: next, events };
}

// ---- Knight (R9.5) ------------------------------------------------------------------------------

/**
 * R9.5: increments `playedKnights`, folds in the Largest Army stub/recompute, then hands off to
 * the robber pipeline exactly like a rolled 7 — EXCEPT no discard sub-phase is ever entered
 * (discards only follow a rolled 7). `returnTo` tracks whether this Knight was played before or
 * after this turn's roll (R4.1/R9.5): if the roll later comes up 7, the robber simply moves again.
 */
export function playKnight(state: GameState, seat: Seat): EngineResult {
  const guard = beginPlay(state, seat, 'knight');
  if (!guard.ok) return guard;

  const players = guard.state.players.map((p) =>
    p.seat === seat ? { ...p, playedKnights: p.playedKnights + 1 } : p
  );
  const awarded = updateAwards({ ...guard.state, players });
  const returnTo: 'preRoll' | 'main' = state.turn.rolled ? 'main' : 'preRoll';
  const next: GameState = { ...awarded.state, phase: { kind: 'moveRobber', returnTo } };

  return { ok: true, state: next, events: [devPlayed(seat, 'knight'), ...awarded.events] };
}

// ---- Road Building (R9.6/ER-5) -------------------------------------------------------------------

/** The resolved Road Building free-piece count (T-906, docs/07 D-034 `customConstants.
 *  roadBuildingCount`) — absent falls back to the base 2 (R9.6/ER-5), bit-identical (RK-13). */
export function resolvedRoadBuildingCount(state: GameState): number {
  return resolveConstants(state.config).roadBuildingCount ?? 2;
}

/**
 * R9.6/ER-5: 0 road pieces left OR 0 currently-legal edges → the card cannot be played at all
 * (`CANNOT_PLAY`, state unchanged — the card stays in hand and the turn's dev-play allowance is
 * NOT spent). Otherwise opens the `roadBuilding` sub-phase for up to `resolvedRoadBuildingCount`
 * (base 2) free placements.
 */
export function playRoadBuilding(state: GameState, seat: Seat): EngineResult {
  const guard = beginPlay(state, seat, 'roadBuilding');
  if (!guard.ok) return guard;

  const player = state.players[seat]!;
  const hasLegalEdge = geometryForState(state).edges.some((e) => canPlaceRoad(state, seat, e.id));
  if (player.piecesLeft.roads <= 0 || !hasLegalEdge) {
    return fail('CANNOT_PLAY', 'no road pieces left or no legal edge for Road Building (ER-5)');
  }

  const remaining = Math.min(resolvedRoadBuildingCount(state), player.piecesLeft.roads);
  const next: GameState = { ...guard.state, phase: { kind: 'roadBuilding', remaining } };
  return { ok: true, state: next, events: [devPlayed(seat, 'roadBuilding')] };
}

/**
 * `roadBuilding` sub-phase (R9.6/ER-5): accepts `placeFreeRoad` only. Registered as the
 * `roadBuilding` entry in reduce.ts's `PHASE_HANDLERS`. Free (no cost, bank untouched) but
 * otherwise a normal road under R7.2 via `canPlaceRoad` — occupancy + connectivity, so the second
 * free road may legally chain off the first one just placed. After each placement, re-checks
 * whether to continue or return: the `roadBuilding` Phase carries no `returnTo` field, so the
 * destination is DERIVED from `turn.rolled` (rolled ⇔ this turn's main phase started it,
 * !rolled ⇔ it was played in preRoll — same correspondence Knight's `returnTo` uses).
 */
export const roadBuildingHandler: PhaseHandler = (state, seat, action): EngineResult => {
  if (state.phase.kind !== 'roadBuilding') return fail('WRONG_PHASE', 'not in the roadBuilding phase');
  const phase = state.phase;
  if (action.type !== 'placeFreeRoad') {
    return fail('WRONG_PHASE', `action ${action.type} is not legal during Road Building`);
  }
  // A single gate (occupancy + connectivity, R7.2) — same helper legalRoadEdges/buildRoad use.
  if (!canPlaceRoad(state, seat, action.edge)) {
    return fail('BAD_LOCATION', `edge ${action.edge} is not a legal free-road spot (R7.2/R9.6)`);
  }

  const players = state.players.map((p) =>
    p.seat === seat
      ? {
          ...p,
          roads: [...p.roads, action.edge],
          piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads - 1 },
        }
      : p
  );
  const awarded = updateAwards({ ...state, players });
  const events: GameEvent[] = [built(seat, 'road', action.edge), ...awarded.events];

  const remaining = phase.remaining - 1;
  const stillLegal = geometryForState(awarded.state).edges.some((e) =>
    canPlaceRoad(awarded.state, seat, e.id)
  );
  if (remaining <= 0 || !stillLegal) {
    const returnPhase: Phase = awarded.state.turn.rolled ? { kind: 'main' } : { kind: 'preRoll' };
    return { ok: true, state: { ...awarded.state, phase: returnPhase }, events };
  }
  return {
    ok: true,
    state: { ...awarded.state, phase: { kind: 'roadBuilding', remaining } },
    events,
  };
};

// ---- Year of Plenty (R9.7/ER-6) ------------------------------------------------------------------

/**
 * ER-6: every chosen type must come out of the bank — picking the same type twice needs 2 of it
 * in the bank. `BANK_EMPTY` leaves the state (and the dev-play allowance) untouched.
 *
 * `extra` (T-906, docs/07 D-034 `customConstants.yearOfPlentyCount`) is additive-only: absent, the
 * resolved count defaults to the base 2 and only `a`/`b` are granted — bit-identical to before this
 * task (RK-13). When the modifier configures a DIFFERENT count: <=2 grants only the first `count`
 * of `[a, b]` (so a count of 1 grants `a` alone, `b` is never charged or received); >2 requires
 * `extra` to carry exactly `count - 2` more picks (`BAD_YOP_COUNT` otherwise).
 */
export function playYearOfPlenty(
  state: GameState,
  seat: Seat,
  a: ResourceType,
  b: ResourceType,
  extra: readonly ResourceType[] = []
): EngineResult {
  const guard = beginPlay(state, seat, 'yearOfPlenty');
  if (!guard.ok) return guard;

  const count = resolveConstants(state.config).yearOfPlentyCount ?? 2;
  let picks: ResourceType[];
  if (count <= 2) {
    picks = [a, b].slice(0, count);
  } else {
    if (extra.length !== count - 2) {
      return fail(
        'BAD_YOP_COUNT',
        `Year of Plenty requires exactly ${count} resource picks (got ${2 + extra.length})`
      );
    }
    picks = [a, b, ...extra];
  }

  const need: ResourceBundle = {};
  for (const res of picks) need[res] = (need[res] ?? 0) + 1;
  if (!hasAtLeast(state.bank, need)) {
    return fail('BANK_EMPTY', 'the bank cannot supply the requested resources for Year of Plenty (ER-6)');
  }

  const bank = { ...guard.state.bank };
  for (const res of picks) bank[res] -= 1;
  const players = guard.state.players.map((p) => {
    if (p.seat !== seat) return p;
    const resources = { ...p.resources };
    for (const res of picks) resources[res] += 1;
    return { ...p, resources };
  });

  const next: GameState = { ...guard.state, bank, players };
  // `detail` stays exactly `{a, b}` (no stray `extra` key) at the base count, so the RK-13 oracle's
  // event shape is byte-identical; `extra` only appears once a non-default count actually used it.
  const detail = extra.length > 0 ? { a, b, extra } : { a, b };
  return { ok: true, state: next, events: [devPlayed(seat, 'yearOfPlenty', detail)] };
}

// ---- Monopoly (R9.7) -----------------------------------------------------------------------------

/**
 * Every OTHER seat hands over ALL of `resource` (possibly 0 — the card is still consumed either
 * way). Bank untouched; cards only move between hands, so I1 holds trivially.
 */
export function playMonopoly(state: GameState, seat: Seat, resource: ResourceType): EngineResult {
  const guard = beginPlay(state, seat, 'monopoly');
  if (!guard.ok) return guard;

  const taken: { seat: Seat; count: number }[] = [];
  let collected = 0;
  const stripped = guard.state.players.map((p) => {
    if (p.seat === seat) return p;
    const count = p.resources[resource];
    taken.push({ seat: p.seat, count });
    if (count === 0) return p;
    collected += count;
    return { ...p, resources: { ...p.resources, [resource]: 0 } };
  });
  const players = stripped.map((p) =>
    p.seat === seat
      ? { ...p, resources: { ...p.resources, [resource]: p.resources[resource] + collected } }
      : p
  );

  const next: GameState = { ...guard.state, players };
  return {
    ok: true,
    state: next,
    events: [devPlayed(seat, 'monopoly'), monopolyResolved(seat, resource, taken)],
  };
}
