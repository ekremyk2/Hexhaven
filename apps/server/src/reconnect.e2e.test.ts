// T-205 acceptance tests: a REAL ws server (http + wsHub + lobby + session, exactly as
// `startServer` wires them in production — same pattern as leak.test.ts), exercising the actual
// wire-level reconnect flow rather than just the pure helpers in reconnect.test.ts / the
// hub-stubbed unit tests in lobby.test.ts / session.test.ts.
//
// Covers the task's two acceptance-critical scenarios: (1) drop + rejoin mid-turn produces a
// `game.sync` that deep-equals a fresh `redact(state, seat)`, and (2) rejoining mid-discard
// resumes exactly the pending decision — the discard action succeeds afterward with NO
// special-casing in the reconnect path itself (the engine's discard handler doesn't know or care
// how the client got there; `stateWith` from the engine's testkit forces the discard sub-phase
// directly so this test doesn't need to script an entire 7-roll-and-overdraw sequence).

import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { redact } from "@hexhaven/engine";
import { stateWith } from "@hexhaven/engine/testkit";
import type { Seat } from "@hexhaven/shared";
import { startServer, type ServerHandle } from "./index.js";

interface AnyEnvelope {
  v: 1;
  type: string;
  payload: Record<string, unknown>;
}

function connect(wsUrl: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket: WebSocket): Promise<AnyEnvelope> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(JSON.parse(String(data)) as AnyEnvelope);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

function onceClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once("close", () => resolve()));
}

// A rejoin fires off `lobby.state` + `presence` + (if a session exists) `game.sync` back-to-back
// on the SAME connection — stacking separate `nextMessage()` (`.once`) calls to read them one at a
// time races the burst (the Nth listener may attach only after message N already arrived and fired
// with nobody listening, which drops it for good). One persistent listener collecting `count`
// messages up front avoids that.
function nextMessages(socket: WebSocket, count: number): Promise<AnyEnvelope[]> {
  return new Promise((resolve, reject) => {
    const collected: AnyEnvelope[] = [];
    const handler = (data: unknown): void => {
      try {
        collected.push(JSON.parse(String(data)) as AnyEnvelope);
      } catch (err) {
        socket.off("message", handler);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (collected.length === count) {
        socket.off("message", handler);
        resolve(collected);
      }
    };
    socket.on("message", handler);
  });
}

function send(socket: WebSocket, envelope: unknown): void {
  socket.send(JSON.stringify(envelope));
}

function baseConfig() {
  return {
    playerCount: 4 as const,
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    timers: { timers: false, turnSeconds: 120, decisionSeconds: 45 },
  };
}

function boundPort(handle: ServerHandle): number {
  const address = handle.app.server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
  return address.port;
}

describe("T-205 reconnect & resume: real ws server", () => {
  let handle: ServerHandle | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await handle?.close();
    handle = undefined;
  });

  /** Boots a real server and gets 4 sockets through create/join/ready/start, returning each
   * seat's `playerToken` (needed for `game.rejoin`) alongside the room's `gameId`. */
  async function bootAndStartFourPlayerGame(): Promise<{ wsUrl: string; gameId: string; tokens: string[] }> {
    handle = await startServer({
      port: 0,
      host: "127.0.0.1",
      logLevel: "silent",
      sessions: { gcIntervalMs: 60 * 60_000 },
    });
    const wsUrl = `ws://127.0.0.1:${boundPort(handle)}/ws`;
    for (let i = 0; i < 4; i++) sockets.push(await connect(wsUrl));

    const created = nextMessage(sockets[0]!);
    send(sockets[0]!, { v: 1, type: "lobby.create", payload: { nickname: "P0", config: baseConfig() } });
    const createdMsg = await created;
    const gameId = createdMsg.payload["gameId"] as string;
    const code = createdMsg.payload["code"] as string;
    const tokens: string[] = [(createdMsg.payload["you"] as { playerToken: string }).playerToken];

    for (let seat = 1; seat < 4; seat++) {
      const waits = sockets.slice(0, seat + 1).map(nextMessage);
      send(sockets[seat]!, { v: 1, type: "lobby.join", payload: { code, nickname: `P${seat}` } });
      const frames = await Promise.all(waits);
      tokens[seat] = (frames[seat]!.payload["you"] as { playerToken: string }).playerToken;
    }

    for (let seat = 0; seat < 4; seat++) {
      const waits = sockets.map(nextMessage);
      send(sockets[seat]!, { v: 1, type: "lobby.ready", payload: { ready: true } });
      await Promise.all(waits);
    }

    const startedWaits = sockets.map(nextMessage);
    send(sockets[0]!, { v: 1, type: "lobby.start", payload: {} });
    await Promise.all(startedWaits); // everyone gets game.started

    return { wsUrl, gameId, tokens };
  }

  it("drop + rejoin mid-turn: the resync deep-equals a fresh redact(state, seat)", async () => {
    const { wsUrl, gameId, tokens } = await bootAndStartFourPlayerGame();

    // Seat 2's socket drops cleanly (a normal disconnect, not a zombie).
    const seat2Gone = onceClose(sockets[2]!);
    const survivorsSeePresence = [nextMessage(sockets[0]!), nextMessage(sockets[1]!), nextMessage(sockets[3]!)];
    sockets[2]!.close();
    await seat2Gone;
    const presenceFrames = await Promise.all(survivorsSeePresence);
    for (const frame of presenceFrames) {
      expect(frame).toEqual({ v: 1, type: "presence", payload: { seat: 2, connected: false } });
    }

    // Seat 2 rejoins on a fresh connection with their playerToken.
    const fresh = await connect(wsUrl);
    sockets[2] = fresh; // afterEach still cleans this up

    // The rejoin fires 3 frames on `fresh` back-to-back: `lobby.state`, `presence(seat 2, true)`
    // (the rejoining connection is itself "currently connected" by the time that broadcasts), then
    // `game.sync` (the live session answering exactly like a `game.syncRequest` would).
    const rejoinFrames = nextMessages(fresh, 3);
    send(fresh, { v: 1, type: "game.rejoin", payload: { gameId, playerToken: tokens[2] } });
    const [lobbyMsg, presenceMsg, syncMsg] = await rejoinFrames;
    expect(lobbyMsg!.type).toBe("lobby.state"); // T-205 §2: lobby context alongside the resync
    expect(presenceMsg).toEqual({ v: 1, type: "presence", payload: { seat: 2, connected: true } });
    expect(syncMsg!.type).toBe("game.sync");
    expect(syncMsg!.payload["me"]).toBe(2);

    const trueState = handle!.sessions.sessions.get(gameId)!.state;
    expect(syncMsg!.payload).toEqual(redact(trueState, 2 as Seat));
  });

  it("rejoin mid-discard resumes the pending decision: the discard action succeeds afterward", async () => {
    const { wsUrl, gameId, tokens } = await bootAndStartFourPlayerGame();
    const session = handle!.sessions.sessions.get(gameId)!;

    // Force a discard sub-phase directly via the engine's testkit (bypassing the many turns a real
    // 7-roll-with-overdraw would take): seat 1 alone owes a discard of 4, holding exactly 8 cards.
    // `stateWith` deep-merges everything except arrays (which replace wholesale, docs/12
    // quickstart / testkit.ts), so `players` needs the full array back, only seat 1 touched.
    const players = stateWith().players.map((p) => ({ ...p }));
    players[1] = { ...players[1]!, resources: { brick: 2, lumber: 2, wool: 2, grain: 1, ore: 1 } }; // 8 cards
    session.state = stateWith({
      phase: { kind: "discard", pending: [1], amounts: { 0: 0, 1: 4, 2: 0, 3: 0, 4: 0, 5: 0 } },
      players,
    });

    // Seat 1 drops mid-discard, then rejoins.
    const seat1Gone = onceClose(sockets[1]!);
    sockets[1]!.close();
    await seat1Gone;

    const fresh = await connect(wsUrl);
    sockets[1] = fresh;

    const rejoinFrames = nextMessages(fresh, 3); // lobby.state, presence, game.sync — see above
    send(fresh, { v: 1, type: "game.rejoin", payload: { gameId, playerToken: tokens[1] } });
    const [, , syncMsg] = await rejoinFrames;
    expect(syncMsg!.type).toBe("game.sync");
    // The resumed view shows exactly the pending discard — nothing special-cased, it's the same
    // `redact()` output any `game.sync` produces (docs T-205 §4: "no special-casing").
    expect(syncMsg!.payload["phase"]).toEqual({
      kind: "discard",
      pending: [1],
      amounts: { 0: 0, 1: 4, 2: 0, 3: 0, 4: 0, 5: 0 },
    });

    // Resolving that exact pending decision now succeeds (discard is one of the two action types
    // the reducer's owner-guard exempts, docs/12 quickstart) — no game.error anywhere.
    const others = [nextMessage(sockets[0]!), nextMessage(sockets[2]!), nextMessage(sockets[3]!)];
    const own = nextMessage(fresh);
    send(fresh, {
      v: 1,
      type: "game.action",
      payload: { action: { type: "discard", cards: { brick: 2, lumber: 2 } } },
    });
    const ownFrame = await own;
    expect(ownFrame.type).toBe("game.events");
    await Promise.all(others);

    expect(session.state.phase.kind).not.toBe("discard"); // seat 1 was the only seat pending
  });
});
