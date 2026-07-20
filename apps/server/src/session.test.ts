// T-204 unit tests for `createGameSessions` — a stub `WsHub` records every envelope `send()`
// receives, so these tests can assert exactly what each connection was sent without a real socket
// (fast, deterministic). The wire-level, "leak nothing" security assertions live in
// `leak.test.ts` (real ws clients against a real server, per the task's acceptance criteria);
// this file covers the session state machine itself: accept/reject, chat, sync, and GC.

import { describe, it, expect, vi, afterEach } from "vitest";
import { chooseAction, legalSetupRoads, legalSetupSettlements, redact } from "@hexhaven/engine";
import type { Seat } from "@hexhaven/shared";
import type { Envelope, ConnId, WsHub } from "./wsHub.js";
import type { Room, SeatInfo } from "./lobby.js";
import { pendingActors } from "./botDrive.js";
import { createGameSessions, type GameSessions } from "./session.js";

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

function makeRoom(): Room {
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
      timers: { timers: false, turnSeconds: 120, decisionSeconds: 45 },
    },
    seats,
    hostSeat: 0,
    started: true,
  };
}

/** T-411: a room whose seats are a mix of humans (connected, `conn{i}`) and host-added bots (no
 *  socket, no token — matches lobby.ts's `handleAddBot`), keyed by `occupants[i]`. */
function makeRoomWithOccupants(occupants: ("human" | "bot")[], gameId = "game-bots"): Room {
  const seats: (SeatInfo | null)[] = occupants.map((occupant, i) =>
    occupant === "human"
      ? { occupant, nickname: `P${i}`, playerToken: `token${i}`, connId: `conn${i}`, ready: true }
      : { occupant, nickname: null, playerToken: null, connId: null, ready: true },
  );
  return {
    gameId,
    code: "ABCDE",
    createdAt: Date.now(),
    config: {
      playerCount: occupants.length as 3 | 4 | 5 | 6,
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
      timers: { timers: false, turnSeconds: 120, decisionSeconds: 45 },
    },
    seats,
    hostSeat: occupants.findIndex((o) => o === "human") as Seat,
    started: true,
  };
}

/** Polls (real timers) until `predicate()` is true, for tests driving the async
 *  `setTimeout`-chained bot auto-drive loop (session.ts's `scheduleBotTurn` always schedules via
 *  `setTimeout`, even at `botThinkDelayMs: 0`, so progress only happens across real event-loop
 *  ticks — see that function's comment for why it never recurses synchronously). */
async function pollUntil(predicate: () => boolean, timeoutMs = 20_000, intervalMs = 5): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("pollUntil: timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("createGameSessions", () => {
  let sessions: GameSessions | undefined;

  afterEach(() => {
    sessions?.close();
    sessions = undefined;
  });

  it("startGame creates a session and sends every connected seat its own game.started PlayerView", () => {
    const { hub, sent } = makeHubStub();
    sessions = createGameSessions(hub);
    const room = makeRoom();

    sessions.startGame(room);

    expect(sessions.sessions.has(room.gameId)).toBe(true);
    const started = sent.filter((r) => r.envelope.type === "game.started");
    expect(started).toHaveLength(4);
    for (const { connId, envelope } of started) {
      const seat = Number(connId.replace("conn", "")) as Seat;
      const payload = envelope.payload as { me: Seat; players: Record<string, unknown>[] };
      expect(payload.me).toBe(seat);
      expect(payload.players[seat]).toHaveProperty("resources");
      for (const other of payload.players) {
        if (other["seat"] !== seat) expect(other).not.toHaveProperty("resources");
      }
    }
  });

  it("a legal game.action is applied once, broadcast as game.events to all 4 seats, and bumps stateVersion", () => {
    const { hub, sent } = makeHubStub();
    sessions = createGameSessions(hub);
    const room = makeRoom();
    sessions.startGame(room);

    const before = sessions.sessions.get(room.gameId)!.state;
    expect(before.stateVersion).toBe(0);
    const vertex = legalSetupSettlements(before)[0]!;

    sessions.handleGameAction(room, 0 as Seat, "conn0", { type: "placeSetupSettlement", vertex });

    const after = sessions.sessions.get(room.gameId)!.state;
    expect(after.stateVersion).toBe(1);
    expect(after.players[0]!.settlements).toContain(vertex);

    const events = sent.filter((r) => r.envelope.type === "game.events");
    expect(events).toHaveLength(4); // one per connected seat
    for (const { envelope } of events) {
      const payload = envelope.payload as { stateVersion: number };
      expect(payload.stateVersion).toBe(1);
    }
    expect(sent.some((r) => r.envelope.type === "game.error")).toBe(false);
  });

  it("an illegal game.action sends game.error to the sender ONLY and never mutates state", () => {
    const { hub, sent } = makeHubStub();
    sessions = createGameSessions(hub);
    const room = makeRoom();
    sessions.startGame(room);
    sent.length = 0; // drop the game.started noise

    // It's seat 0's setup turn — seat 1 acting is NOT_YOUR_TURN.
    const before = sessions.sessions.get(room.gameId)!.state;
    const vertex = legalSetupSettlements(before)[0]!;
    sessions.handleGameAction(room, 1 as Seat, "conn1", { type: "placeSetupSettlement", vertex });

    const after = sessions.sessions.get(room.gameId)!.state;
    expect(after).toEqual(before); // untouched — rejected actions never apply

    expect(sent).toHaveLength(1);
    expect(sent[0]!.connId).toBe("conn1");
    expect(sent[0]!.envelope.type).toBe("game.error");
    expect(sent[0]!.envelope.payload).toMatchObject({ code: "NOT_YOUR_TURN" });
  });

  it("handleGameAction on a room with no live session is a silent no-op", () => {
    const { hub, sent } = makeHubStub();
    sessions = createGameSessions(hub);
    const room = makeRoom(); // startGame() never called
    expect(() =>
      sessions!.handleGameAction(room, 0 as Seat, "conn0", { type: "rollDice" })
    ).not.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("chat.send broadcasts chat.message to every connected seat (works pre- and mid-game)", () => {
    const { hub, sent } = makeHubStub();
    sessions = createGameSessions(hub);
    const room = makeRoom();
    // No startGame() call — chat is lobby-level too, per T-204 §2.

    sessions.handleChatSend(room, 2 as Seat, "conn2", "gl hf");

    expect(sent).toHaveLength(4);
    for (const { envelope } of sent) {
      expect(envelope.type).toBe("chat.message");
      expect(envelope.payload).toEqual({ seat: 2, nickname: "P2", text: "gl hf" });
    }
  });

  it("game.syncRequest replies game.sync to the requester only, with their current redacted view", () => {
    const { hub, sent } = makeHubStub();
    sessions = createGameSessions(hub);
    const room = makeRoom();
    sessions.startGame(room);
    sent.length = 0;

    sessions.handleGameSyncRequest(room, 3 as Seat, "conn3");

    expect(sent).toHaveLength(1);
    expect(sent[0]!.connId).toBe("conn3");
    expect(sent[0]!.envelope.type).toBe("game.sync");
    expect((sent[0]!.envelope.payload as { me: Seat }).me).toBe(3);
  });

  it("only sends to currently-connected seats (a disconnected seat's connId is skipped)", () => {
    const { hub, sent } = makeHubStub();
    sessions = createGameSessions(hub);
    const room = makeRoom();
    room.seats[2] = { ...room.seats[2]!, connId: null };

    sessions.startGame(room);

    const started = sent.filter((r) => r.envelope.type === "game.started");
    expect(started).toHaveLength(3);
    expect(started.some((r) => r.connId === "conn2")).toBe(false);
  });

  it("a finished session (gameWon) is GC'd after finishedTtlMs", async () => {
    vi.useFakeTimers();
    const { hub } = makeHubStub();
    sessions = createGameSessions(hub, { gcIntervalMs: 10, finishedTtlMs: 50 });
    const room = makeRoom();
    sessions.startGame(room);

    const session = sessions.sessions.get(room.gameId)!;
    session.finishedAt = Date.now();

    await vi.advanceTimersByTimeAsync(20);
    expect(sessions.sessions.has(room.gameId)).toBe(true); // not yet past the TTL

    await vi.advanceTimersByTimeAsync(60);
    expect(sessions.sessions.has(room.gameId)).toBe(false);

    vi.useRealTimers();
  });

  it("T-205 §5: a started (unfinished) session is GC'd once every seat has been disconnected for allDisconnectedTtlMs", async () => {
    vi.useFakeTimers();
    const { hub } = makeHubStub();
    sessions = createGameSessions(hub, { gcIntervalMs: 10, allDisconnectedTtlMs: 50 });
    const room = makeRoom();
    sessions.startGame(room);

    // Every seat's socket drops (mirrors what lobby.ts's onDisconnect does to `room.seats` for a
    // started room: `connId` goes null, the seat itself stays occupied).
    for (const seatInfo of room.seats) if (seatInfo) seatInfo.connId = null;

    await vi.advanceTimersByTimeAsync(20);
    expect(sessions.sessions.has(room.gameId)).toBe(true); // not yet past the TTL

    await vi.advanceTimersByTimeAsync(60);
    expect(sessions.sessions.has(room.gameId)).toBe(false);

    vi.useRealTimers();
  });

  it("T-205 §5: the all-disconnected GC clock resets once any seat reconnects", async () => {
    vi.useFakeTimers();
    const { hub } = makeHubStub();
    sessions = createGameSessions(hub, { gcIntervalMs: 10, allDisconnectedTtlMs: 50 });
    const room = makeRoom();
    sessions.startGame(room);

    for (const seatInfo of room.seats) if (seatInfo) seatInfo.connId = null;
    await vi.advanceTimersByTimeAsync(20); // the clock has started but hasn't reached 50ms yet

    room.seats[0]!.connId = "conn0-again"; // seat 0 rejoins

    await vi.advanceTimersByTimeAsync(60); // would have purged by now had the clock not reset
    expect(sessions.sessions.has(room.gameId)).toBe(true);

    vi.useRealTimers();
  });

  describe("T-411: bot auto-drive", () => {
    it("startGame auto-drives a bot's setup turn without any handleGameAction call", async () => {
      const { hub } = makeHubStub();
      sessions = createGameSessions(hub, { botThinkDelayMs: 0, botBudget: 6 });
      const room = makeRoomWithOccupants(["bot", "human", "human", "human"]);
      sessions.startGame(room); // seat 0 (a bot) has the very first setup turn

      await pollUntil(() => sessions!.sessions.get(room.gameId)!.state.turn.player !== 0);

      const state = sessions.sessions.get(room.gameId)!.state;
      // Seat 0's bot placed a settlement (and the attached road) entirely on its own; setup's
      // snake order moves on to seat 1 once seat 0's pair is placed.
      expect(state.players[0]!.settlements.length).toBeGreaterThan(0);
      expect(state.players[0]!.roads.length).toBeGreaterThan(0);
      expect(state.turn.player).toBe(1);
    }, 20_000);

    it("a human action that ends the turn on a bot seat auto-drives that bot's turn", async () => {
      const { hub, sent } = makeHubStub();
      sessions = createGameSessions(hub, { botThinkDelayMs: 0, botBudget: 6 });
      const room = makeRoomWithOccupants(["human", "bot", "human", "human"]);
      sessions.startGame(room);

      // Play out setup for every seat via legal-move helpers so the game reaches `preRoll` for
      // seat 0 without needing the bot brain for setup itself; this test only cares that turning
      // control over to seat 1 (a bot) afterwards is auto-driven.
      // Snake-draft setup, but seat 1 is a bot: the auto-drive plays ITS setup turns on its own.
      // This loop must therefore act only for human seats and WAIT OUT the bot's auto-driven
      // placements — manually playing the bot seat would race the auto-drive and desync the game.
      const botSeat = 1 as Seat;
      while (sessions.sessions.get(room.gameId)!.state.phase.kind === "setup") {
        const state = sessions.sessions.get(room.gameId)!.state;
        const seat = state.turn.player;
        if (seat === botSeat) {
          await pollUntil(() => {
            const cur = sessions!.sessions.get(room.gameId)!.state;
            return cur.phase.kind !== "setup" || cur.turn.player !== botSeat;
          });
          continue;
        }
        const vertex = legalSetupSettlements(state)[0]!;
        sessions.handleGameAction(room, seat, `conn${seat}` as ConnId, { type: "placeSetupSettlement", vertex });
        const afterSettlement = sessions.sessions.get(room.gameId)!.state;
        const edge = legalSetupRoads(afterSettlement)[0]!;
        sessions.handleGameAction(room, seat, `conn${seat}` as ConnId, { type: "placeSetupRoad", edge });
      }

      await pollUntil(() => sessions!.sessions.get(room.gameId)!.state.phase.kind === "preRoll");
      expect(sessions.sessions.get(room.gameId)!.state.turn.player).toBe(0);

      sessions.handleGameAction(room, 0 as Seat, "conn0", { type: "rollDice" });
      // Seat 0 stays turn owner after rolling (still `main`); ending the turn hands it to seat 1
      // (a bot), which auto-drives. Bots now MAY offer a domestic trade — its responders here are the
      // human seats (0/2/3), so mirror a real client by declining any open offer, otherwise the
      // bot-owner stays blocked waiting on responses that never come.
      const afterRoll = sessions.sessions.get(room.gameId)!.state;
      if (afterRoll.phase.kind === "main") {
        sessions.handleGameAction(room, 0 as Seat, "conn0", { type: "endTurn" });
      }

      await pollUntil(() => {
        const s = sessions!.sessions.get(room.gameId)!.state;
        if (s.phase.kind === "main" && s.trade) {
          for (const hs of [0, 2, 3] as Seat[]) {
            if (s.turn.player !== hs && s.trade.responses[hs] === undefined) {
              sessions!.handleGameAction(room, hs, `conn${hs}` as ConnId, { type: "respondTrade", response: "decline" });
            }
          }
        }
        return s.turn.player !== 1;
      });

      expect(sent.some((r) => r.envelope.type === "game.error")).toBe(false);
      const finalState = sessions.sessions.get(room.gameId)!.state;
      expect([0, 2, 3]).toContain(finalState.turn.player); // moved past the bot seat
    }, 20_000);

    it("botThinkDelayMs is honored: a bot doesn't act until its scheduled delay elapses (fake timers)", async () => {
      vi.useFakeTimers();
      const { hub } = makeHubStub();
      sessions = createGameSessions(hub, { botThinkDelayMs: 500, botBudget: 6 });
      const room = makeRoomWithOccupants(["bot", "human", "human", "human"]);
      sessions.startGame(room);

      await vi.advanceTimersByTimeAsync(100);
      expect(sessions.sessions.get(room.gameId)!.state.players[0]!.settlements.length).toBe(0);

      await vi.advanceTimersByTimeAsync(500);
      expect(sessions.sessions.get(room.gameId)!.state.players[0]!.settlements.length).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    it("solo integration: 1 scripted human seat + 3 bots auto-drive to gameWon, zero illegal actions, redaction intact", async () => {
      const TEST_BUDGET = 12; // matches T-410's own bot.test.ts/benchmark.test.ts TEST_BUDGET
      const { hub, sent } = makeHubStub();
      sessions = createGameSessions(hub, { botThinkDelayMs: 0, botBudget: TEST_BUDGET });
      const room = makeRoomWithOccupants(["human", "bot", "bot", "bot"]);
      sessions.startGame(room);

      let humanSteps = 0;
      for (;;) {
        await pollUntil(() => {
          const state = sessions!.sessions.get(room.gameId)!.state;
          return state.phase.kind === "ended" || pendingActors(state).includes(0 as Seat);
        });

        const state = sessions.sessions.get(room.gameId)!.state;
        if (state.phase.kind === "ended") break;

        // "Scripted/auto human client" (T-411's acceptance criterion) — the human seat plays via
        // the same bot brain, fed ONLY its own redacted view, exactly like a real client would
        // decide its own move; this seat is otherwise indistinguishable from a real player to the
        // session (real socket, real `handleGameAction` call).
        const view = redact(state, 0 as Seat);
        const { action } = chooseAction(view, state.rng, { budget: TEST_BUDGET });
        sessions.handleGameAction(room, 0 as Seat, "conn0", action);

        humanSteps += 1;
        if (humanSteps > 3000) {
          throw new Error(
            `test guard: too many human-seat steps, likely stuck (stateVersion=${state.stateVersion}, phase=${state.phase.kind}, turn=${state.turn.number}/${state.turn.player})`,
          );
        }
      }

      const finalState = sessions.sessions.get(room.gameId)!.state;
      expect(finalState.phase.kind).toBe("ended");

      // Zero illegal actions: nothing was ever rejected (a `game.error` would only ever go to
      // seat 0's `conn0` — bots have no socket to receive one).
      expect(sent.some((r) => r.envelope.type === "game.error")).toBe(false);

      // Redaction intact on every broadcast frame this test observed: seat 0's own hand is the
      // only one ever carrying full `resources`/`devCards` in a `game.events`/`game.started` frame
      // sent to `conn0` (the only connected socket in this room).
      const framesToConn0 = sent.filter((r) => r.connId === "conn0" && r.envelope.payload && typeof r.envelope.payload === "object");
      for (const { envelope } of framesToConn0) {
        const payload = envelope.payload as { players?: Record<string, unknown>[]; view?: { players?: Record<string, unknown>[] } };
        const players = payload.players ?? payload.view?.players;
        if (!players) continue;
        for (const p of players) {
          if ((p as { seat?: number }).seat !== 0) expect(p).not.toHaveProperty("resources");
        }
      }
    }, 90_000);
  });
});
