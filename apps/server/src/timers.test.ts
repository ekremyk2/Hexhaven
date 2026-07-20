// T-206 tests: turn timers & flag-gated auto-actions. Same hub-stub + `vi.useFakeTimers()` pattern
// as session.test.ts's GC tests (real `setTimeout`/`clearTimeout` under the hood, driven virtually
// via `vi.advanceTimersByTimeAsync`). Every test crafts the exact phase it wants to expire via the
// engine's `stateWith` testkit (same pattern reconnect.e2e.test.ts uses: start a session normally,
// then overwrite `session.state` directly) so it doesn't need to script a real game up to that
// point — `session.ts`'s `runAction`/reduce wiring is exercised for real, only the PATH to a given
// phase is skipped.
//
// Every craft below starts with `room.config.timers.timers = false` for `startGame()` (so the
// engine's own initial `setup` phase never schedules a timer), overwrites `session.state`, THEN
// flips the flag on and calls `notifyConnectivityChanged` — this guarantees every scheduled timer
// in a test starts counting from a clean t=0 baseline instead of inheriting a stale start time
// from whatever `startGame` might otherwise have scheduled.

import { describe, it, expect, vi, afterEach } from "vitest";
import { stateWith } from "@hexhaven/engine/testkit";
import {
  createGame,
  legalSetupSettlements,
  legalSetupRoads,
  legalRobberHexes,
  legalRoadEdges,
  legalSettlementVertices,
  legalCityVertices,
  buildAffordability,
} from "@hexhaven/engine";
import type { Action, EdgeId, GameConfig, GameState, HexId, Seat, VertexId } from "@hexhaven/shared";

// docs/12 quickstart's "controlled board" CONFIG shape — used only by the `setup` phase test,
// which needs a truly from-scratch state (see that test for why `stateWith`'s base doesn't work).
const FRESH_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: "unused-overridden-per-call",
  board: "random",
  tokenMethod: "spiral",
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};
import type { Envelope, ConnId, WsHub } from "./wsHub.js";
import type { Room, SeatInfo } from "./lobby.js";
import { createGameSessions, type GameSessions } from "./session.js";
import { autoDiscardBundle, computePendingDeadlines } from "./timers.js";

interface Recorded {
  connId: ConnId;
  envelope: Envelope;
}

function makeHubStub(): { hub: WsHub; sent: Recorded[] } {
  const sent: Recorded[] = [];
  const hub: WsHub = {
    onMessage: () => {},
    onDisconnect: () => {},
    send(connId, envelope) {
      sent.push({ connId, envelope });
    },
    broadcast(connIds, envelope) {
      for (const connId of connIds) sent.push({ connId, envelope });
    },
    disconnect: () => {},
    close: async () => {},
  };
  return { hub, sent };
}

function makeRoom(timers: { timers: boolean; turnSeconds: number; decisionSeconds: number }): Room {
  const seats: (SeatInfo | null)[] = [0, 1, 2, 3].map((i) => ({
    nickname: `P${i}`,
    playerToken: `token${i}`,
    connId: `conn${i}`,
    ready: true,
  }));
  return {
    gameId: "game-1",
    code: "ABCDE",
    createdAt: Date.now(),
    config: {
      playerCount: 4,
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
      timers,
    },
    seats,
    hostSeat: 0,
    started: true,
  };
}

/** Boots a session with NO timers yet (clean setup-phase, unscheduled), returning everything a
 *  test needs to overwrite `session.state` and then turn timers on from a clean t=0. */
function boot(timers: { turnSeconds: number; decisionSeconds: number }) {
  const { hub, sent } = makeHubStub();
  const room = makeRoom({ timers: false, ...timers });
  const sessions = createGameSessions(hub);
  sessions.startGame(room);
  const session = sessions.sessions.get(room.gameId)!;
  function craft(overrides: Parameters<typeof stateWith>[0]): void {
    session.state = stateWith(overrides);
  }
  function armTimers(): void {
    room.config.timers = { timers: true, ...timers };
    sessions.notifyConnectivityChanged(room);
  }
  return { hub, sent, room, sessions, session, craft, armTimers };
}

function timerEnvelopes(sent: Recorded[]): { seat: Seat; deadline: number }[][] {
  return sent
    .filter((r) => r.envelope.type === "timer")
    .map((r) => (r.envelope.payload as { deadlines: { seat: Seat; deadline: number }[] }).deadlines);
}

describe("T-206 turn timers & auto-actions", () => {
  let sessions: GameSessions | undefined;
  afterEach(() => {
    sessions?.close();
    sessions = undefined;
    vi.useRealTimers();
  });

  it("flag off: zero timers scheduled, no `timer` broadcasts, state never auto-advances", async () => {
    vi.useFakeTimers();
    const { sent, session, craft, sessions: s } = boot({ turnSeconds: 1, decisionSeconds: 1 });
    sessions = s;
    craft({ phase: { kind: "preRoll" }, turn: { rolled: false } });
    // Timers deliberately left OFF (never call armTimers()).
    const before = session.state;

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(session.state).toEqual(before);
    expect(timerEnvelopes(sent)).toHaveLength(0);
  });

  it("preRoll expiry -> rollDice for the turn owner", async () => {
    vi.useFakeTimers();
    const { sent, session, craft, armTimers, sessions: s } = boot({ turnSeconds: 1, decisionSeconds: 1 });
    sessions = s;
    craft({ phase: { kind: "preRoll" }, turn: { player: 0, rolled: false } });
    armTimers();
    const before = session.state.stateVersion;

    await vi.advanceTimersByTimeAsync(1000);

    expect(session.state.phase.kind).not.toBe("preRoll"); // rollDice always leaves preRoll
    expect(session.state.stateVersion).toBeGreaterThan(before);
    const diceEvents = sent
      .filter((r) => r.envelope.type === "game.events")
      .flatMap((r) => (r.envelope.payload as { events: { type: string; seat?: Seat }[] }).events)
      .filter((ev) => ev.type === "diceRolled");
    expect(diceEvents.some((ev) => ev.seat === 0)).toBe(true);
  });

  it("main (no open trade) expiry -> endTurn", async () => {
    vi.useFakeTimers();
    const { session, craft, armTimers, sessions: s } = boot({ turnSeconds: 1, decisionSeconds: 1 });
    sessions = s;
    craft({ phase: { kind: "main" }, turn: { player: 0, rolled: true }, trade: null });
    armTimers();

    await vi.advanceTimersByTimeAsync(1000);

    expect(session.state.turn.player).toBe(1); // endTurn advanced past seat 0
    expect(session.state.phase.kind).toBe("preRoll");
  });

  it("main WITH an open trade expiry -> cancelTrade then endTurn (and uses decisionSeconds)", async () => {
    vi.useFakeTimers();
    // turnSeconds intentionally large: only the SHORTER decisionSeconds should govern while a
    // trade is open (task §2's "owner ... open-trade -> decisionSeconds").
    const { session, craft, armTimers, sessions: s } = boot({ turnSeconds: 100, decisionSeconds: 1 });
    sessions = s;
    craft({
      phase: { kind: "main" },
      turn: { player: 0, rolled: true },
      trade: { give: { brick: 1 }, receive: { ore: 1 }, responses: {} },
    });
    armTimers();

    await vi.advanceTimersByTimeAsync(1000); // decisionSeconds, NOT turnSeconds(100s)

    expect(session.state.trade).toBeNull();
    expect(session.state.turn.player).toBe(1);
  });

  it("discard expiry -> floor(hand/2), largest pile first, ties by resource enum order", async () => {
    vi.useFakeTimers();
    const { session, craft, armTimers, sessions: s } = boot({ turnSeconds: 1, decisionSeconds: 1 });
    sessions = s;
    const players = stateWith().players.map((p) => ({ ...p }));
    // 8 cards: brick=3, lumber=1, wool=1, grain=1, ore=2 -> owed floor(8/2)=4.
    players[1] = { ...players[1]!, resources: { brick: 3, lumber: 1, wool: 1, grain: 1, ore: 2 } };
    craft({
      phase: { kind: "discard", pending: [1 as Seat], amounts: { 0: 0, 1: 4, 2: 0, 3: 0, 4: 0, 5: 0 } },
      players,
    });
    armTimers();

    // Pure-logic cross-check: the exact bundle the auto-action should produce.
    expect(autoDiscardBundle({ brick: 3, lumber: 1, wool: 1, grain: 1, ore: 2 }, 4)).toEqual({
      brick: 3,
      ore: 1,
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(session.state.phase.kind).not.toBe("discard"); // seat 1 was the only one pending
    expect(session.state.players[1]!.resources).toEqual({ brick: 0, lumber: 1, wool: 1, grain: 1, ore: 1 });
  });

  it("discard: seat 2's independent timer is untouched when seat 1's discard resolves first (no reset)", async () => {
    vi.useFakeTimers();
    const { session, craft, armTimers, sessions: s } = boot({ turnSeconds: 1, decisionSeconds: 1 });
    sessions = s;
    const players = stateWith().players.map((p) => ({ ...p }));
    players[1] = { ...players[1]!, resources: { brick: 4, lumber: 0, wool: 0, grain: 0, ore: 0 } }; // owed 2
    players[2] = { ...players[2]!, resources: { brick: 0, lumber: 4, wool: 0, grain: 0, ore: 0 } }; // owed 2
    craft({
      phase: { kind: "discard", pending: [1 as Seat, 2 as Seat], amounts: { 0: 0, 1: 2, 2: 2, 3: 0, 4: 0, 5: 0 } },
      players,
    });
    armTimers();

    // Seat 1 discards for real, well before either timer would expire.
    await vi.advanceTimersByTimeAsync(400);
    sessions.handleGameAction(session.room, 1 as Seat, "conn1", { type: "discard", cards: { brick: 2 } });
    expect(session.state.phase.kind).toBe("discard");
    expect((session.state.phase as { pending: Seat[] }).pending).toEqual([2]);

    // Seat 2's clock started at t=0 (decisionSeconds=1000ms) and must NOT have been reset by seat
    // 1's unrelated action — it should fire at t=1000, not t=400+1000=1400.
    await vi.advanceTimersByTimeAsync(650); // now at t=1050
    expect(session.state.phase.kind).not.toBe("discard");
  });

  it("moveRobber expiry -> lowest HexId excluding the robber's current hex", async () => {
    vi.useFakeTimers();
    const { session, craft, armTimers, sessions: s } = boot({ turnSeconds: 1, decisionSeconds: 1 });
    sessions = s;
    craft({
      phase: { kind: "moveRobber", returnTo: "main" },
      turn: { player: 0 },
      board: { robber: 3 as HexId },
    });
    armTimers();

    await vi.advanceTimersByTimeAsync(1000);

    expect(session.state.board.robber).toBe(0); // lowest legal hex (0 != the prior robber hex 3)
  });

  it("steal expiry -> lowest-seat candidate", async () => {
    vi.useFakeTimers();
    const { sent, craft, armTimers, sessions: s } = boot({ turnSeconds: 1, decisionSeconds: 1 });
    sessions = s;
    const players = stateWith().players.map((p) => ({ ...p }));
    players[2] = { ...players[2]!, resources: { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 } };
    players[3] = { ...players[3]!, resources: { brick: 0, lumber: 1, wool: 0, grain: 0, ore: 0 } };
    craft({
      phase: { kind: "steal", candidates: [3 as Seat, 2 as Seat], returnTo: "main" },
      turn: { player: 0 },
      players,
    });
    armTimers();

    await vi.advanceTimersByTimeAsync(1000);

    // `game.events` fans out once PER connected seat (4 copies of the same events) — look at only
    // one recipient's stream so a single steal doesn't appear to be 4.
    const stolenEvents = sent
      .filter((r) => r.envelope.type === "game.events" && r.connId === "conn0")
      .flatMap((r) => (r.envelope.payload as { events: { type: string; from?: Seat; to?: Seat }[] }).events)
      .filter((ev) => ev.type === "stolen");
    expect(stolenEvents).toHaveLength(1);
    expect(stolenEvents[0]).toMatchObject({ from: 2, to: 0 }); // 2 < 3
  });

  it("roadBuilding expiry -> lowest-EdgeId legal edge(s), fully resolving the sub-phase", async () => {
    vi.useFakeTimers();
    const { session, craft, armTimers, sessions: s } = boot({ turnSeconds: 1, decisionSeconds: 1 });
    sessions = s;
    craft({ phase: { kind: "roadBuilding", remaining: 2 }, turn: { player: 0, rolled: true } });
    armTimers();
    const before = session.state.players[0]!.roads.length;

    await vi.advanceTimersByTimeAsync(1000);

    expect(session.state.phase.kind).not.toBe("roadBuilding"); // fully resolved in one firing
    expect(session.state.players[0]!.roads.length).toBeGreaterThan(before);
  });

  it("setup expiry -> lowest-ID legal settlement, then lowest-ID legal road", async () => {
    vi.useFakeTimers();
    const { session, armTimers, sessions: s } = boot({ turnSeconds: 1, decisionSeconds: 1 });
    sessions = s;
    // NOT `stateWith`/`craft` here: the testkit's base state already has 8 settlements placed
    // (its "legal mid-game" starting point), which corrupts `setupHandler`'s snake-draft index
    // math (it counts settlements across ALL players to derive whose turn is next). A genuinely
    // fresh `createGame()` state is a real, from-scratch `setup` phase instead.
    session.state = createGame({ ...FRESH_CONFIG, seed: "t-206-setup-test" });
    const expectedVertex = Math.min(...legalSetupSettlements(session.state));
    armTimers();

    await vi.advanceTimersByTimeAsync(1000);

    expect(session.state.players[0]!.settlements).toContain(expectedVertex);
    expect(session.state.phase).toMatchObject({ kind: "setup", expect: "road" });

    const expectedEdge = Math.min(...legalSetupRoads(session.state));
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.state.players[0]!.roads).toContain(expectedEdge);
  });

  it("disconnected turn owner's deadline shortens to decisionSeconds even with a large turnSeconds", async () => {
    vi.useFakeTimers();
    const { session, room, craft, armTimers, sessions: s } = boot({ turnSeconds: 100, decisionSeconds: 1 });
    sessions = s;
    craft({ phase: { kind: "main" }, turn: { player: 0, rolled: true }, trade: null });
    room.seats[0] = { ...room.seats[0]!, connId: null }; // seat 0 (the turn owner) is disconnected
    armTimers();

    await vi.advanceTimersByTimeAsync(1000); // decisionSeconds, nowhere near turnSeconds(100s)

    expect(session.state.turn.player).toBe(1); // endTurn already fired
  });

  it("a real action from the awaited seat clears its timer; the NEW decision gets a fresh full clock", async () => {
    vi.useFakeTimers();
    const { session, room, craft, armTimers, sessions: s } = boot({ turnSeconds: 1, decisionSeconds: 1 });
    sessions = s;
    craft({ phase: { kind: "preRoll" }, turn: { player: 0, rolled: false } });
    armTimers();

    await vi.advanceTimersByTimeAsync(400); // t=400: well before the preRoll timer's t=1000
    expect(session.state.phase.kind).toBe("preRoll"); // nothing has fired yet

    sessions.handleGameAction(room, 0 as Seat, "conn0", { type: "rollDice" });
    expect(session.actionLog).toHaveLength(1);
    expect(session.state.phase.kind).not.toBe("preRoll");

    // If the OLD preRoll timer (scheduled at t=0, due t=1000) had NOT been cleared, its stale
    // closure would fire an unwanted auto-action right around t=1000. The correctly-cleared +
    // freshly-rescheduled timer (armed at t=400, same 1000ms bucket either way since
    // turnSeconds===decisionSeconds here) is due at t=1400 — so at t=1050 NOTHING should have
    // happened yet.
    await vi.advanceTimersByTimeAsync(650); // now at t=1050
    expect(session.actionLog).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(400); // now at t=1450, past the correct t=1400 deadline
    expect(session.actionLog).toHaveLength(2);
  });

  it("`timer` broadcasts carry an absolute epoch-ms deadline per pending seat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const { sent, craft, armTimers, sessions: s } = boot({ turnSeconds: 5, decisionSeconds: 1 });
    sessions = s;
    craft({ phase: { kind: "preRoll" }, turn: { player: 2, rolled: false } });
    armTimers();

    const deadlines = timerEnvelopes(sent);
    expect(deadlines.length).toBeGreaterThan(0);
    const latest = deadlines[deadlines.length - 1]!;
    expect(latest).toEqual([{ seat: 2, deadline: 1_700_000_000_000 + 5000 }]);
  });

  it("computePendingDeadlines is a pure [] whenever the room's timers flag is off", () => {
    const room = makeRoom({ timers: false, turnSeconds: 5, decisionSeconds: 1 });
    const state = stateWith({ phase: { kind: "preRoll" }, turn: { player: 0, rolled: false } });
    expect(computePendingDeadlines(state, room)).toEqual([]);
  });

  it("full game: two permanently-dead seats never block seat 1 from reaching gameWon", async () => {
    vi.useFakeTimers();
    const { session, room, craft, armTimers, sessions: s } = boot({ turnSeconds: 1, decisionSeconds: 1 });
    sessions = s;

    // Low targetVp + seat 1 already at 2 VP (testkit's base 2 settlements) + exactly a city's cost
    // in hand: ONE buildCity reaches 3 VP and wins. Seats 0/2/3 are "dead" — this test never sends
    // a `game.action` on their behalf; every one of THEIR decisions must come from timer expiry.
    const players = stateWith().players.map((p) => ({ ...p }));
    players[1] = { ...players[1]!, resources: { brick: 0, lumber: 0, wool: 0, grain: 2, ore: 3 } };
    craft({
      config: { targetVp: 3 },
      phase: { kind: "preRoll" },
      turn: { player: 0, rolled: false },
      players,
    });
    armTimers();

    function chooseLiveAction(state: GameState, seat: Seat): Action {
      switch (state.phase.kind) {
        case "setup":
          return state.phase.expect === "settlement"
            ? { type: "placeSetupSettlement", vertex: Math.min(...legalSetupSettlements(state)) as VertexId }
            : { type: "placeSetupRoad", edge: Math.min(...legalSetupRoads(state)) as EdgeId };
        case "preRoll":
          return { type: "rollDice" };
        case "discard": {
          const owed = state.phase.amounts[seat] ?? 0;
          return { type: "discard", cards: autoDiscardBundle(state.players[seat]!.resources, owed) };
        }
        case "moveRobber":
          return { type: "moveRobber", hex: Math.min(...legalRobberHexes(state)) as HexId };
        case "steal":
          return { type: "steal", from: Math.min(...state.phase.candidates) as Seat };
        case "roadBuilding": {
          const edge = legalRoadEdges({ ...state, phase: { kind: "main" } }, seat)[0];
          return { type: "placeFreeRoad", edge: edge ?? (Math.min(...legalRoadEdges(state, seat)) as EdgeId) };
        }
        case "main": {
          const afford = buildAffordability(state, seat);
          if (afford.city) {
            const vertex = legalCityVertices(state, seat)[0];
            if (vertex !== undefined) return { type: "buildCity", vertex };
          }
          if (afford.settlement) {
            const vertex = legalSettlementVertices(state, seat)[0];
            if (vertex !== undefined) return { type: "buildSettlement", vertex };
          }
          if (afford.road) {
            const edge = legalRoadEdges(state, seat)[0];
            if (edge !== undefined) return { type: "buildRoad", edge };
          }
          return { type: "endTurn" };
        }
        case "specialBuild":
          return { type: "passSpecialBuild" };
        case "chooseGoldResource":
          throw new Error("seafarers gold choice cannot occur in this base-game test");
        case "caravanVote":
          throw new Error("caravans camel vote cannot occur in this base-game test");
        case "ended":
          throw new Error("no action once the game has ended");
      }
    }

    const LIVE: Seat = 1 as Seat;
    let guard = 0;
    while (session.state.phase.kind !== "ended") {
      guard += 1;
      if (guard > 200) throw new Error("did not reach gameWon in time (T-206 auto-action stall?)");

      if (session.state.phase.kind === "discard") {
        if (session.state.phase.pending.includes(LIVE)) {
          sessions.handleGameAction(room, LIVE, "conn1", chooseLiveAction(session.state, LIVE));
          continue;
        }
        await vi.advanceTimersByTimeAsync(1500); // dead seats' discard timers
        continue;
      }

      const owner = session.state.turn.player;
      if (owner === LIVE) {
        sessions.handleGameAction(room, LIVE, "conn1", chooseLiveAction(session.state, LIVE));
      } else {
        await vi.advanceTimersByTimeAsync(1500); // dead seat: only the timer drives its turn
      }
    }

    expect(session.state.phase).toMatchObject({ kind: "ended", winner: 1 });
  });
});
