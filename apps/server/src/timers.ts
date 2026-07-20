// T-206: turn timers & auto-actions (flag-gated, docs/07 D-020, docs/02 §4 "Timers").
//
// Room-config-driven pacing: `room.config.timers` (T-202) is `{ timers, turnSeconds,
// decisionSeconds }`, default `timers: false` — this whole module is a true no-op whenever that
// flag is off (`computePendingDeadlines` returns `[]` unconditionally in that case, so nothing
// downstream ever schedules a `setTimeout`).
//
// Wiring (session.ts): `createGameSessions` builds one `TurnTimers` per hub and calls it at three
// points — `onSessionStarted` (after `startGame`), `onActionApplied` (after every ACCEPTED real OR
// auto action), `onConnectivityChanged` (from lobby.ts's disconnect/`game.rejoin` hooks, wired in
// index.ts). Every entry point funnels into `reconcile`, which:
//   1. Recomputes the CURRENT full "who's pending, for how long" map from `session.state` +
//      `session.room` (live connectivity).
//   2. Clears exactly the scheduled timers that are no longer correct: gone from the map, a
//      different duration (e.g. a disconnect shortened `turnSeconds` -> `decisionSeconds`), or
//      belong to the seat that was just force-refreshed (the task's "cleared on any accepted
//      action of the AWAITED seat" — every accepted action from the currently-timed seat restarts
//      their own clock, even if the decision itself didn't change, e.g. a mid-turn `buildRoad`).
//   3. Schedules a fresh timer for anything now-desired that doesn't already have one running.
// Seats NOT touched by a given call (e.g. seat 1's still-pending `discard` clock when seat 0's
// discard is accepted) are left running untouched — this is why the diff is per-seat rather than
// "clear everything and reschedule from the current state".
//
// Auto-actions on expiry are applied EXCLUSIVELY through the engine's `reduce` (via the
// `applyAction` callback session.ts supplies) — never state surgery (task §3) — so they get the
// exact same validation, events, redaction, and `stateVersion` bump a real player action would.

import { reduce, legalRobberHexes, legalSetupSettlements, legalSetupRoads } from "@hexhaven/engine";
import { GEOMETRY } from "@hexhaven/shared";
import type { Action, EdgeId, GameState, ResourceType, Seat } from "@hexhaven/shared";
import type { WsHub } from "./wsHub.js";
import type { Room } from "./lobby.js";
import type { GameSession } from "./session.js";

/** Resource enum order (docs/01 preamble; mirrors packages/engine/src/phases/robber.ts). */
const RESOURCE_ORDER: readonly ResourceType[] = ["brick", "lumber", "wool", "grain", "ore"];

interface ScheduledTimer {
  handle: ReturnType<typeof setTimeout>;
  ms: number;
  deadline: number; // epoch ms
}

interface PendingDeadline {
  seat: Seat;
  ms: number;
}

export interface TurnTimersLogger {
  error: (obj: unknown, msg?: string) => void;
}

export interface TurnTimersDeps {
  hub: WsHub;
  /** Read-only session lookup — `session.ts` owns the actual map. */
  sessions: ReadonlyMap<string, GameSession>;
  /**
   * Applies one engine action for `seat` as if it were a normal accepted action (reduce + mutate +
   * broadcast `game.events`, same as a real `game.action`) and reports whether it succeeded. A
   * `false` means the deterministic auto-action was somehow illegal — a `BUG:`, since these are
   * only ever derived from the engine's own legal-move helpers — logged by the caller, never
   * thrown into the timer callback.
   */
  applyAction(gameId: string, seat: Seat, action: Action): boolean;
  logger?: TurnTimersLogger;
}

export interface TurnTimers {
  /** After `startGame` — schedules the initial deadline(s) for the fresh session. */
  onSessionStarted(gameId: string): void;
  /** After a real or auto action from `seat` was accepted. */
  onActionApplied(gameId: string, seat: Seat): void;
  /** After a seat's connection changes (disconnect or `game.rejoin`). */
  onConnectivityChanged(gameId: string): void;
  /** Clears every outstanding timer for one game (session GC, or `close()`). */
  clearAll(gameId: string): void;
  /** Clears every outstanding timer for every game — server shutdown / test teardown. */
  closeAll(): void;
}

function isSeatConnected(room: Room, seat: Seat): boolean {
  return room.seats[seat]?.connId != null;
}

/**
 * Requirement §2's duration table, plus §4's disconnect-shortening: `setup` is not explicitly
 * listed in the task's bucket table (only "preRoll/main" are named as `turnSeconds`) — treated
 * here as the same `turnSeconds` bucket as the turn owner's other "my move" decisions, since it's
 * equally "the turn owner is expected to act". Flagged in the task's Implementation notes for PM
 * review as an assumption, not an explicit spec line.
 */
function computePendingDeadlines(state: GameState, room: Room): PendingDeadline[] {
  if (!room.config.timers.timers) return [];
  const turnMs = room.config.timers.turnSeconds * 1000;
  const decisionMs = room.config.timers.decisionSeconds * 1000;

  switch (state.phase.kind) {
    case "setup":
    case "preRoll": {
      const seat = state.turn.player;
      return [{ seat, ms: isSeatConnected(room, seat) ? turnMs : decisionMs }];
    }
    case "main": {
      const seat = state.turn.player;
      // T-602: a Paired-Players partial turn is a `main` phase with `turn.player` = the paired
      // builder — give it the shorter decision deadline (X12 auto-end), like the SBP below.
      const partial = state.ext?.fiveSix?.partialTurn != null;
      const shortened = partial || state.trade !== null || !isSeatConnected(room, seat);
      return [{ seat, ms: shortened ? decisionMs : turnMs }];
    }
    case "discard":
      return state.phase.pending.map((seat) => ({ seat, ms: decisionMs }));
    // Seafarers gold (S9): like discards, each pending seat owes a decision-timed choice.
    case "chooseGoldResource":
      return state.phase.pending.map((seat) => ({ seat, ms: decisionMs }));
    // T-1004 (Caravans camel vote): each still-pending seat owes a bid; once bids resolve, the
    // winner owes a camel placement — all decision-timed (like discard/gold).
    case "caravanVote": {
      const pend = state.phase.pending;
      if (pend.length > 0) return pend.map((seat) => ({ seat, ms: decisionMs }));
      return state.phase.winner != null ? [{ seat: state.phase.winner, ms: decisionMs }] : [];
    }
    case "moveRobber":
    case "steal":
    case "roadBuilding":
      return [{ seat: state.turn.player, ms: decisionMs }];
    // T-602 (X12): the SBP builder gets a `passSpecialBuild` auto-pass deadline (decisionSeconds).
    case "specialBuild":
      return [{ seat: state.phase.builder, ms: decisionMs }];
    case "ended":
      return [];
  }
}

/** R6.1-style discard: `floor(hand/2)` (passed in as `owed`), largest pile first, ties by
 *  RESOURCE_ORDER (brick -> ore) — greedily removes one card at a time from whichever resource is
 *  CURRENTLY the largest pile, which is what "taking from the largest counts first" means once
 *  more than one card must come off the same resource. */
function autoDiscardBundle(
  resources: Record<ResourceType, number>,
  owed: number
): Partial<Record<ResourceType, number>> {
  const counts: Record<ResourceType, number> = { ...resources };
  const bundle: Partial<Record<ResourceType, number>> = {};
  let remaining = owed;
  while (remaining > 0) {
    let pick: ResourceType | null = null;
    for (const r of RESOURCE_ORDER) {
      if (counts[r] > 0 && (pick === null || counts[r] > counts[pick])) pick = r;
    }
    if (!pick) break; // defensive: hand can't actually run out before `owed` is reached
    counts[pick] -= 1;
    bundle[pick] = (bundle[pick] ?? 0) + 1;
    remaining -= 1;
  }
  return bundle;
}

function minOrNull<T extends number>(arr: readonly T[]): T | null {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => (b < a ? b : a));
}

/** Probes ascending EdgeId via `reduce` itself (pure, no mutation) rather than duplicating
 *  `canPlaceRoad`'s connectivity rule, which isn't exported from `@hexhaven/engine` — this is exactly
 *  the "via engine actions only" path the task asks for, just used to also DISCOVER legality. */
function firstLegalFreeRoadEdge(state: GameState, seat: Seat): EdgeId | null {
  for (const e of GEOMETRY.edges) {
    if (reduce(state, seat, { type: "placeFreeRoad", edge: e.id }).ok) return e.id;
  }
  return null;
}

/** Builds the deterministic auto-action(s) for the CURRENT phase and runs them through
 *  `deps.applyAction`, re-reading live session state between steps (needed for `roadBuilding`,
 *  which may place a second free road after the first changes what's legal). */
function runAutoActions(deps: TurnTimersDeps, gameId: string, seat: Seat): void {
  const logger = deps.logger ?? { error: () => {} };
  const session = deps.sessions.get(gameId);
  if (!session) return;
  const state = session.state;

  switch (state.phase.kind) {
    case "setup": {
      if (state.phase.expect === "settlement") {
        const vertex = minOrNull(legalSetupSettlements(state));
        if (vertex !== null) deps.applyAction(gameId, seat, { type: "placeSetupSettlement", vertex });
      } else {
        const edge = minOrNull(legalSetupRoads(state));
        if (edge !== null) deps.applyAction(gameId, seat, { type: "placeSetupRoad", edge });
      }
      return;
    }
    case "preRoll":
      deps.applyAction(gameId, seat, { type: "rollDice" });
      return;
    case "main": {
      if (state.trade !== null) deps.applyAction(gameId, seat, { type: "cancelTrade" });
      deps.applyAction(gameId, seat, { type: "endTurn" });
      return;
    }
    case "discard": {
      const owed = state.phase.amounts[seat] ?? 0;
      const hand = state.players[seat]?.resources;
      if (!hand) {
        logger.error({ gameId, seat }, "T-206: discard auto-action but seat has no player state (BUG)");
        return;
      }
      deps.applyAction(gameId, seat, { type: "discard", cards: autoDiscardBundle(hand, owed) });
      return;
    }
    case "moveRobber": {
      const hex = minOrNull(legalRobberHexes(state));
      if (hex !== null) deps.applyAction(gameId, seat, { type: "moveRobber", hex });
      return;
    }
    case "steal": {
      // Use the phase's OWN `candidates` — the authoritative list `stealHandler` itself validates
      // `action.from` against — rather than recomputing via legal.ts's hex-based `stealCandidates`
      // (board-derived; only ever guaranteed to match `phase.candidates` for a real, non-crafted
      // game state, since both are computed from the same robber-hex + settlements at the moment
      // `moveRobber` entered this sub-phase).
      const from = minOrNull(state.phase.candidates);
      if (from !== null) deps.applyAction(gameId, seat, { type: "steal", from });
      return;
    }
    case "roadBuilding": {
      // Up to 2 free roads (phase.remaining); re-probe after each placement since the first
      // placement can open/close what's legal for the second. `guard` is a defensive cap only —
      // the phase always exits `roadBuilding` within <=2 successful placements (docs/03 §3).
      let guard = 0;
      while (deps.sessions.get(gameId)?.state.phase.kind === "roadBuilding" && guard < 4) {
        guard += 1;
        const current = deps.sessions.get(gameId)!.state;
        const edge = firstLegalFreeRoadEdge(current, seat);
        if (edge === null) break;
        deps.applyAction(gameId, seat, { type: "placeFreeRoad", edge });
      }
      return;
    }
    // T-602 (X12): SBP auto-pass. (A Paired-Players partial turn is a `main` phase, auto-ended by the
    // `endTurn` above — reduce redirects it to end the partial turn.)
    case "specialBuild":
      deps.applyAction(gameId, seat, { type: "passSpecialBuild" });
      return;
    case "ended":
      return;
  }
}

/** Creates the per-hub timer manager. Real `setTimeout`/`clearTimeout` (unref'd, same pattern as
 *  session.ts's/lobby.ts's GC intervals) — tests drive it with `vi.useFakeTimers()` +
 *  `vi.advanceTimersByTimeAsync`, exactly like the existing GC tests in session.test.ts. */
export function createTurnTimers(deps: TurnTimersDeps): TurnTimers {
  const registry = new Map<string, Map<Seat, ScheduledTimer>>();

  function broadcastDeadlines(room: Room, scheduled: Map<Seat, ScheduledTimer>): void {
    const deadlines = [...scheduled.entries()]
      .map(([seat, slot]) => ({ seat, deadline: slot.deadline }))
      .sort((a, b) => a.seat - b.seat);
    for (const info of room.seats) {
      if (info?.connId) deps.hub.send(info.connId, { v: 1, type: "timer", payload: { deadlines } });
    }
  }

  function clearAll(gameId: string): void {
    const scheduled = registry.get(gameId);
    if (!scheduled) return;
    for (const slot of scheduled.values()) clearTimeout(slot.handle);
    registry.delete(gameId);
  }

  function onExpiry(gameId: string, seat: Seat): void {
    // The timer that just fired is done — drop its own bookkeeping entry before doing anything
    // else so `reconcile`'s diff below doesn't try to double-clear an already-fired handle.
    registry.get(gameId)?.delete(seat);
    runAutoActions(deps, gameId, seat);
    reconcile(gameId, seat);
  }

  function reconcile(gameId: string, forceSeat: Seat | null): void {
    const session = deps.sessions.get(gameId);
    if (!session) {
      clearAll(gameId);
      return;
    }
    const room = session.room;
    if (!room.config.timers.timers) {
      clearAll(gameId); // defensive: config is fixed at room creation, but never leave a stray timer
      return;
    }

    const scheduled = registry.get(gameId) ?? new Map<Seat, ScheduledTimer>();
    const desired = computePendingDeadlines(session.state, room);
    const desiredBySeat = new Map(desired.map((d) => [d.seat, d.ms]));

    for (const [seat, slot] of [...scheduled]) {
      const desiredMs = desiredBySeat.get(seat);
      if (desiredMs === undefined || desiredMs !== slot.ms || seat === forceSeat) {
        clearTimeout(slot.handle);
        scheduled.delete(seat);
      }
    }
    for (const [seat, ms] of desiredBySeat) {
      if (scheduled.has(seat)) continue;
      const handle = setTimeout(() => onExpiry(gameId, seat), ms);
      handle.unref?.();
      scheduled.set(seat, { handle, ms, deadline: Date.now() + ms });
    }

    if (scheduled.size > 0) registry.set(gameId, scheduled);
    else registry.delete(gameId);

    broadcastDeadlines(room, scheduled);
  }

  return {
    onSessionStarted(gameId) {
      reconcile(gameId, null);
    },
    onActionApplied(gameId, seat) {
      reconcile(gameId, seat);
    },
    onConnectivityChanged(gameId) {
      reconcile(gameId, null);
    },
    clearAll,
    closeAll() {
      for (const gameId of [...registry.keys()]) clearAll(gameId);
    },
  };
}

// Re-exported for tests that want to exercise the pure decision logic without a full session/hub.
export { computePendingDeadlines, autoDiscardBundle };
