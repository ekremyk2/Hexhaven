import { describe, it, expect, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { createHttpServer } from "./http.js";
import { attachWsHub, type WsHub } from "./wsHub.js";
import { attachLobby, type Lobby, type LobbyOptions, type Room } from "./lobby.js";

interface Booted {
  app: FastifyInstance;
  hub: WsHub;
  lobby: Lobby;
  wsUrl: string;
}

async function boot(lobbyOptions?: LobbyOptions): Promise<Booted> {
  const app = createHttpServer({ logLevel: "silent" });
  const hub = attachWsHub(app);
  const lobby = attachLobby(hub, lobbyOptions);
  await app.listen({ port: 0, host: "127.0.0.1" });

  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a bound TCP address");
  }
  return { app, hub, lobby, wsUrl: `ws://127.0.0.1:${address.port}/ws` };
}

function connect(wsUrl: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

// Loose shape covering every payload field used across `lobby.state`/`game.error` messages in
// these tests — avoids `any` while letting each test only care about the fields it touches.
interface TestPayload {
  gameId?: string;
  code?: string; // room code (`lobby.state`) or error code (`game.error`) — both plain strings
  hostSeat?: number;
  seats?: ({ occupant: "human" | "bot"; nickname: string | null; ready: boolean } | null)[];
  you?: { seat: number; playerToken: string };
  message?: string;
}

interface AnyEnvelope {
  v: 1;
  type: string;
  payload: TestPayload;
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

function send(socket: WebSocket, envelope: unknown): void {
  socket.send(JSON.stringify(envelope));
}

// T-205: waits for exactly `count` messages on `socket`, in arrival order, via ONE persistent
// listener registered up front — unlike stacking multiple `nextMessage()` (`.once`) calls, this
// can't race a burst of back-to-back sends (e.g. `lobby.state` immediately followed by
// `presence`) where the second listener attaches only after both frames already arrived.
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

function baseConfig(playerCount: 3 | 4 | 5 | 6 = 4, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    playerCount,
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    timers: { timers: false, turnSeconds: 120, decisionSeconds: 45 },
    ...overrides,
  };
}

// T-205: gets 4 sockets through create/join/ready/start (mirrors the "full happy path" test
// above) and hands back each seat's playerToken so `game.rejoin` tests don't need to re-derive
// them. `startGame` is caller-supplied (a `vi.fn()`) purely so the test can `vi.waitFor` on it —
// it never sends anything itself, exactly like the existing happy-path test.
async function startFourPlayerGame(
  wsUrl: string,
  startGame: (room: Room) => void,
): Promise<{ sockets: WebSocket[]; gameId: string; code: string; tokens: string[] }> {
  const sockets = [await connect(wsUrl), await connect(wsUrl), await connect(wsUrl), await connect(wsUrl)];
  const tokens: string[] = [];

  const created = nextMessage(sockets[0]!);
  send(sockets[0]!, { v: 1, type: "lobby.create", payload: { nickname: "P0", config: baseConfig(4) } });
  const createdMsg = await created;
  const gameId = createdMsg.payload.gameId!;
  const code = createdMsg.payload.code!;
  tokens[0] = createdMsg.payload.you!.playerToken;

  for (let seat = 1; seat < 4; seat++) {
    const waits = sockets.slice(0, seat + 1).map(nextMessage);
    send(sockets[seat]!, { v: 1, type: "lobby.join", payload: { code, nickname: `P${seat}` } });
    const frames = await Promise.all(waits);
    tokens[seat] = frames[seat]!.payload.you!.playerToken;
  }

  for (let seat = 0; seat < 4; seat++) {
    const waits = sockets.map(nextMessage);
    send(sockets[seat]!, { v: 1, type: "lobby.ready", payload: { ready: true } });
    await Promise.all(waits);
  }

  send(sockets[0]!, { v: 1, type: "lobby.start", payload: {} });
  await vi.waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

  return { sockets, gameId, code, tokens };
}

describe("lobby", () => {
  let app: FastifyInstance | undefined;
  let hub: WsHub | undefined;
  let lobby: Lobby | undefined;
  const clients: WebSocket[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.terminate();
    lobby?.close();
    await hub?.close();
    await app?.close();
    app = undefined;
    hub = undefined;
    lobby = undefined;
  });

  it("full happy path: 4 players create/join/ready/start", async () => {
    const startGame = vi.fn();
    const booted = await boot({ startGame });
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    const p1 = await connect(booted.wsUrl);
    const p2 = await connect(booted.wsUrl);
    const p3 = await connect(booted.wsUrl);
    clients.push(p0, p1, p2, p3);

    const created = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
    const createdMsg = await created;

    expect(createdMsg.type).toBe("lobby.state");
    expect(createdMsg.payload.hostSeat).toBe(0);
    expect(createdMsg.payload.seats).toEqual([
      { occupant: "human", nickname: "Alice", ready: false },
      null,
      null,
      null,
    ]);
    expect(createdMsg.payload.you).toEqual({ seat: 0, playerToken: expect.any(String) });
    const gameId = createdMsg.payload.gameId!;
    const code = createdMsg.payload.code!;
    expect(gameId).toEqual(expect.any(String));
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);

    // Bob joins: both Alice (broadcast) and Bob (his own claim reply) see the update.
    const aliceSeesBob = nextMessage(p0);
    const bobJoined = nextMessage(p1);
    send(p1, { v: 1, type: "lobby.join", payload: { code, nickname: "Bob" } });
    const [aliceSawBob, bobMsg] = await Promise.all([aliceSeesBob, bobJoined]);
    expect(bobMsg.payload.you).toEqual({ seat: 1, playerToken: expect.any(String) });
    expect(aliceSawBob.payload.you).toBeUndefined();
    expect(aliceSawBob.payload.seats).toEqual([
      { occupant: "human", nickname: "Alice", ready: false },
      { occupant: "human", nickname: "Bob", ready: false },
      null,
      null,
    ]);
    expect(bobMsg.payload.you!.playerToken).not.toBe(createdMsg.payload.you!.playerToken); // token uniqueness

    const carolJoined = nextMessage(p2);
    const others1 = [nextMessage(p0), nextMessage(p1)];
    send(p2, { v: 1, type: "lobby.join", payload: { code, nickname: "Carol" } });
    const [carolMsg] = await Promise.all([carolJoined, ...others1]);
    expect(carolMsg.payload.you).toEqual({ seat: 2, playerToken: expect.any(String) });

    const daveJoined = nextMessage(p3);
    const others2 = [nextMessage(p0), nextMessage(p1), nextMessage(p2)];
    send(p3, { v: 1, type: "lobby.join", payload: { code, nickname: "Dave" } });
    const [daveMsg] = await Promise.all([daveJoined, ...others2]);
    expect(daveMsg.payload.seats).toEqual([
      { occupant: "human", nickname: "Alice", ready: false },
      { occupant: "human", nickname: "Bob", ready: false },
      { occupant: "human", nickname: "Carol", ready: false },
      { occupant: "human", nickname: "Dave", ready: false },
    ]);

    // leak check: no seat entry ever carries a playerToken, and no `you` for the wrong recipient.
    for (const msg of [createdMsg, aliceSawBob, carolMsg, daveMsg]) {
      for (const seat of msg.payload.seats!) {
        if (seat) expect(Object.keys(seat).sort()).toEqual(["nickname", "occupant", "ready"]);
      }
    }

    // Everyone readies up; every ready toggle broadcasts to all four sockets.
    for (const [socket, others] of [
      [p0, [p1, p2, p3]],
      [p1, [p0, p2, p3]],
      [p2, [p0, p1, p3]],
      [p3, [p0, p1, p2]],
    ] as const) {
      const waits = [socket, ...others].map(nextMessage);
      send(socket, { v: 1, type: "lobby.ready", payload: { ready: true } });
      await Promise.all(waits);
    }

    expect(startGame).not.toHaveBeenCalled();
    send(p0, { v: 1, type: "lobby.start", payload: {} });
    await vi.waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
    const startedRoom = startGame.mock.calls[0]![0] as Room;
    expect(startedRoom.gameId).toBe(gameId);
    expect(startedRoom.started).toBe(true);
  });

  it("3-player config happy path", async () => {
    const startGame = vi.fn();
    const booted = await boot({ startGame });
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    const p1 = await connect(booted.wsUrl);
    const p2 = await connect(booted.wsUrl);
    clients.push(p0, p1, p2);

    const created = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(3) } });
    const code = (await created).payload.code!;

    const bobJoin = nextMessage(p1);
    const aliceSeesBob = nextMessage(p0);
    send(p1, { v: 1, type: "lobby.join", payload: { code, nickname: "Bob" } });
    await Promise.all([bobJoin, aliceSeesBob]);

    const carolJoin = nextMessage(p2);
    const others = [nextMessage(p0), nextMessage(p1)];
    send(p2, { v: 1, type: "lobby.join", payload: { code, nickname: "Carol" } });
    const [carolMsg] = await Promise.all([carolJoin, ...others]);
    expect(carolMsg.payload.seats).toHaveLength(3);

    for (const [socket, others2] of [
      [p0, [p1, p2]],
      [p1, [p0, p2]],
      [p2, [p0, p1]],
    ] as const) {
      const waits = [socket, ...others2].map(nextMessage);
      send(socket, { v: 1, type: "lobby.ready", payload: { ready: true } });
      await Promise.all(waits);
    }

    send(p0, { v: 1, type: "lobby.start", payload: {} });
    await vi.waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
  });

  it("lobby.join: UNKNOWN_GAME for a code with no live room (also covers expiry)", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const reply = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.join", payload: { code: "ZZZZZ", nickname: "Ghost" } });
    const msg = await reply;
    expect(msg).toEqual({ v: 1, type: "game.error", payload: { code: "UNKNOWN_GAME", message: expect.any(String) } });
  });

  it("lobby.join: LOBBY_FULL once config.playerCount seats are taken", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    const p1 = await connect(booted.wsUrl);
    const p2 = await connect(booted.wsUrl);
    const p3 = await connect(booted.wsUrl);
    clients.push(p0, p1, p2, p3);

    const created = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(3) } });
    const code = (await created).payload.code!;

    const bobJoin = nextMessage(p1);
    const aliceSeesBob = nextMessage(p0);
    send(p1, { v: 1, type: "lobby.join", payload: { code, nickname: "Bob" } });
    await Promise.all([bobJoin, aliceSeesBob]);

    const carolJoin = nextMessage(p2);
    const others = [nextMessage(p0), nextMessage(p1)];
    send(p2, { v: 1, type: "lobby.join", payload: { code, nickname: "Carol" } });
    await Promise.all([carolJoin, ...others]);

    // room now has all 3 seats (playerCount 3) filled: a 4th join is rejected.
    const reply = nextMessage(p3);
    send(p3, { v: 1, type: "lobby.join", payload: { code, nickname: "Dave" } });
    const msg = await reply;
    expect(msg).toEqual({ v: 1, type: "game.error", payload: { code: "LOBBY_FULL", message: expect.any(String) } });
  });

  it("lobby.join: ALREADY_STARTED once the room has started", async () => {
    const startGame = vi.fn();
    const booted = await boot({ startGame });
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    const p1 = await connect(booted.wsUrl);
    clients.push(p0, p1);

    const created = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(3) } });
    const code = (await created).payload.code!;

    const bobJoin = nextMessage(p1);
    const aliceSeesBob = nextMessage(p0);
    send(p1, { v: 1, type: "lobby.join", payload: { code, nickname: "Bob" } });
    await Promise.all([bobJoin, aliceSeesBob]);

    // Carol claims the 3rd seat then leaves — the seat stays occupied (started rooms don't free
    // seats on disconnect; that's T-205's rejoin flow), so we can still start a 3-seat room.
    const p2 = await connect(booted.wsUrl);
    clients.push(p2);
    const carolJoin = nextMessage(p2);
    const others = [nextMessage(p0), nextMessage(p1)];
    send(p2, { v: 1, type: "lobby.join", payload: { code, nickname: "Carol" } });
    await Promise.all([carolJoin, ...others]);

    for (const [socket, others2] of [
      [p0, [p1, p2]],
      [p1, [p0, p2]],
      [p2, [p0, p1]],
    ] as const) {
      const waits = [socket, ...others2].map(nextMessage);
      send(socket, { v: 1, type: "lobby.ready", payload: { ready: true } });
      await Promise.all(waits);
    }
    send(p0, { v: 1, type: "lobby.start", payload: {} });
    await vi.waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));

    const p3 = await connect(booted.wsUrl);
    clients.push(p3);
    const reply = nextMessage(p3);
    send(p3, { v: 1, type: "lobby.join", payload: { code, nickname: "Erin" } });
    const msg = await reply;
    expect(msg).toEqual({
      v: 1,
      type: "game.error",
      payload: { code: "ALREADY_STARTED", message: expect.any(String) },
    });
  });

  it("lobby.join: NICKNAME_TAKEN is case-insensitive", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    const p1 = await connect(booted.wsUrl);
    clients.push(p0, p1);

    const created = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
    const code = (await created).payload.code!;

    const reply = nextMessage(p1);
    send(p1, { v: 1, type: "lobby.join", payload: { code, nickname: "ALICE" } });
    const msg = await reply;
    expect(msg).toEqual({
      v: 1,
      type: "game.error",
      payload: { code: "NICKNAME_TAKEN", message: expect.any(String) },
    });
  });

  it("lobby.start: NOT_HOST for a non-host seat", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    const p1 = await connect(booted.wsUrl);
    clients.push(p0, p1);

    const created = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
    const code = (await created).payload.code!;

    const bobJoin = nextMessage(p1);
    const aliceSeesBob = nextMessage(p0);
    send(p1, { v: 1, type: "lobby.join", payload: { code, nickname: "Bob" } });
    await Promise.all([bobJoin, aliceSeesBob]);

    const reply = nextMessage(p1);
    send(p1, { v: 1, type: "lobby.start", payload: {} });
    const msg = await reply;
    expect(msg).toEqual({ v: 1, type: "game.error", payload: { code: "NOT_HOST", message: expect.any(String) } });
  });

  it("lobby.create: accepts citiesKnights combined with the 5-6 extension (C&K 5-6, base 5-6 board)", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const reply = nextMessage(p0);
    send(p0, {
      v: 1,
      type: "lobby.create",
      payload: { nickname: "Alice", config: baseConfig(5, { expansions: { fiveSix: true, seafarers: false, citiesKnights: true } }) },
    });
    const msg = await reply;
    expect(msg.type).toBe("lobby.state");
  });

  it("lobby.create: accepts Seafarers combined with Cities & Knights (the official combined game)", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const reply = nextMessage(p0);
    send(p0, {
      v: 1,
      type: "lobby.create",
      payload: {
        nickname: "Alice",
        config: baseConfig(4, { expansions: { fiveSix: false, seafarers: { scenario: "headingForNewShores" }, citiesKnights: true } }),
      },
    });
    const msg = await reply;
    expect(msg.type).toBe("lobby.state");
  });

  it("lobby.create: EXPANSION_NOT_AVAILABLE for citiesKnights at 5 players WITHOUT the 5-6 extension (D-025)", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const reply = nextMessage(p0);
    send(p0, {
      v: 1,
      type: "lobby.create",
      payload: { nickname: "Alice", config: baseConfig(5, { expansions: { fiveSix: false, seafarers: false, citiesKnights: true } }) },
    });
    const msg = await reply;
    expect(msg).toEqual({
      v: 1,
      type: "game.error",
      payload: { code: "EXPANSION_NOT_AVAILABLE", message: expect.any(String) },
    });
  });

  it("lobby.create: accepts citiesKnights at 4 players (T-806, W3 shipped)", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const reply = nextMessage(p0);
    send(p0, {
      v: 1,
      type: "lobby.create",
      payload: {
        nickname: "Alice",
        config: baseConfig(4, { expansions: { fiveSix: false, seafarers: false, citiesKnights: true } }),
      },
    });
    const msg = await reply;
    expect(msg.type).toBe("lobby.state");
  });

  it("lobby.create: accepts a valid modifiers combo (T-901, customTargetVp + combine2sAnd12s)", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const reply = nextMessage(p0);
    send(p0, {
      v: 1,
      type: "lobby.create",
      payload: {
        nickname: "Alice",
        config: baseConfig(4, { modifiers: { customTargetVp: 8, combine2sAnd12s: true } }),
      },
    });
    const msg = await reply;
    expect(msg.type).toBe("lobby.state");
  });

  it("lobby.create: MODIFIER_INCOMPATIBLE for eventCards combined with citiesKnights (T-901 matrix)", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const reply = nextMessage(p0);
    send(p0, {
      v: 1,
      type: "lobby.create",
      payload: {
        nickname: "Alice",
        config: baseConfig(4, {
          expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
          modifiers: { eventCards: true },
        }),
      },
    });
    const msg = await reply;
    expect(msg).toEqual({
      v: 1,
      type: "game.error",
      payload: { code: "MODIFIER_INCOMPATIBLE", message: expect.any(String) },
    });
  });

  it("lobby.create: EXPANSION_NOT_AVAILABLE for playerCount 5", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const reply = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(5) } });
    const msg = await reply;
    expect(msg).toEqual({
      v: 1,
      type: "game.error",
      payload: { code: "EXPANSION_NOT_AVAILABLE", message: expect.any(String) },
    });
  });

  it("lobby.create: accepts fiveSix at 6 players (T-601, W1 shipped)", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const reply = nextMessage(p0);
    send(p0, {
      v: 1,
      type: "lobby.create",
      payload: {
        nickname: "Alice",
        config: baseConfig(6, { expansions: { fiveSix: true, seafarers: false, citiesKnights: false } }),
      },
    });
    const msg = await reply;
    expect(msg.type).toBe("lobby.state");
  });

  it("password gate (D-031): PASSWORD_REQUIRED / BAD_PASSWORD when LOBBY_PASSWORD is set", async () => {
    const booted = await boot({ password: "s3cret" });
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const missing = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
    expect(await missing).toEqual({
      v: 1,
      type: "game.error",
      payload: { code: "PASSWORD_REQUIRED", message: expect.any(String) },
    });

    const wrong = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4), password: "nope" } });
    expect(await wrong).toEqual({
      v: 1,
      type: "game.error",
      payload: { code: "BAD_PASSWORD", message: expect.any(String) },
    });

    const ok = nextMessage(p0);
    send(p0, {
      v: 1,
      type: "lobby.create",
      payload: { nickname: "Alice", config: baseConfig(4), password: "s3cret" },
    });
    const created = await ok;
    expect(created.type).toBe("lobby.state");
    const code = created.payload.code!;

    // lobby.join is gated the same way.
    const p1 = await connect(booted.wsUrl);
    clients.push(p1);
    const joinMissing = nextMessage(p1);
    send(p1, { v: 1, type: "lobby.join", payload: { code, nickname: "Bob" } });
    expect(await joinMissing).toEqual({
      v: 1,
      type: "game.error",
      payload: { code: "PASSWORD_REQUIRED", message: expect.any(String) },
    });
  });

  it("password flow is skipped entirely when LOBBY_PASSWORD is unset", async () => {
    const booted = await boot(); // no password option
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const reply = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
    const msg = await reply;
    expect(msg.type).toBe("lobby.state"); // no password supplied, no error
  });

  it("seat-freeing + host migration on pre-start disconnect", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    const p1 = await connect(booted.wsUrl);
    const p2 = await connect(booted.wsUrl);
    clients.push(p0, p1, p2);

    const created = nextMessage(p0);
    send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(3) } });
    const code = (await created).payload.code!;

    const bobJoin = nextMessage(p1);
    const aliceSeesBob = nextMessage(p0);
    send(p1, { v: 1, type: "lobby.join", payload: { code, nickname: "Bob" } });
    await Promise.all([bobJoin, aliceSeesBob]);

    const carolJoin = nextMessage(p2);
    const others = [nextMessage(p0), nextMessage(p1)];
    send(p2, { v: 1, type: "lobby.join", payload: { code, nickname: "Carol" } });
    await Promise.all([carolJoin, ...others]);

    // Alice (host, seat 0) disconnects: her seat frees, host migrates to Bob (seat 1).
    const bobSeesLeave = nextMessage(p1);
    const carolSeesLeave = nextMessage(p2);
    p0.close();
    const [bobUpdate, carolUpdate] = await Promise.all([bobSeesLeave, carolSeesLeave]);
    expect(bobUpdate.payload.hostSeat).toBe(1);
    expect(bobUpdate.payload.seats![0]).toBeNull();
    expect(bobUpdate.payload.seats![1]).toEqual({ occupant: "human", nickname: "Bob", ready: false });
    expect(carolUpdate.payload.hostSeat).toBe(1);

    // Bob (now host, seat 1) disconnects too: host migrates on to Carol (seat 2).
    const carolSeesBobLeave = nextMessage(p2);
    p1.close();
    const finalUpdate = await carolSeesBobLeave;
    expect(finalUpdate.payload.hostSeat).toBe(2);
    expect(finalUpdate.payload.seats![1]).toBeNull();
  });

  it("post-start disconnect: seat stays occupied, no host migration, presence broadcasts to survivors", async () => {
    const startGame = vi.fn();
    const booted = await boot({ startGame });
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const { sockets, gameId } = await startFourPlayerGame(booted.wsUrl, startGame);
    clients.push(...sockets);
    const room = [...lobby.rooms.values()].find((r) => r.gameId === gameId)!;
    expect(room.hostSeat).toBe(0);

    // The host (seat 0) drops mid-game: unlike a pre-start disconnect, the seat must NOT free and
    // the host must NOT migrate — only the socket binding drops (T-205 §1, D-020).
    const survivorsSeePresence = [nextMessage(sockets[1]!), nextMessage(sockets[2]!), nextMessage(sockets[3]!)];
    sockets[0]!.close();
    const presenceFrames = await Promise.all(survivorsSeePresence);
    for (const msg of presenceFrames) {
      expect(msg).toEqual({ v: 1, type: "presence", payload: { seat: 0, connected: false } });
    }

    expect(room.hostSeat).toBe(0);
    expect(room.seats[0]).not.toBeNull();
    expect(room.seats[0]!.nickname).toBe("P0");
    expect(room.seats[0]!.connId).toBeNull();
  });

  it("game.rejoin: UNKNOWN_GAME for a gameId with no live room", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const p0 = await connect(booted.wsUrl);
    clients.push(p0);

    const reply = nextMessage(p0);
    send(p0, { v: 1, type: "game.rejoin", payload: { gameId: "no-such-game", playerToken: "tok" } });
    const msg = await reply;
    expect(msg).toEqual({ v: 1, type: "game.error", payload: { code: "UNKNOWN_GAME", message: expect.any(String) } });
  });

  it("game.rejoin: BAD_TOKEN when the token doesn't match any seat in that game", async () => {
    const startGame = vi.fn();
    const booted = await boot({ startGame });
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const { sockets, gameId } = await startFourPlayerGame(booted.wsUrl, startGame);
    clients.push(...sockets);

    const outsider = await connect(booted.wsUrl);
    clients.push(outsider);
    const reply = nextMessage(outsider);
    send(outsider, { v: 1, type: "game.rejoin", payload: { gameId, playerToken: "totally-bogus-token" } });
    const msg = await reply;
    expect(msg).toEqual({ v: 1, type: "game.error", payload: { code: "BAD_TOKEN", message: expect.any(String) } });
  });

  it("game.rejoin: rebinds the seat, evicts a zombie socket, and resends lobby context + presence", async () => {
    const startGame = vi.fn();
    const rejoinSpy = vi.fn();
    const booted = await boot({ startGame, onGameRejoin: rejoinSpy });
    app = booted.app;
    hub = booted.hub;
    lobby = booted.lobby;

    const { sockets, gameId, tokens } = await startFourPlayerGame(booted.wsUrl, startGame);
    clients.push(...sockets);

    // Seat 1's original socket never fires `close` (e.g. a suspended laptop) — a fresh connection
    // presents seat 1's token instead. Rejoin must evict (kick) the stale one.
    const zombie = sockets[1]!;
    const zombieClosed = new Promise<void>((resolve) => zombie.once("close", () => resolve()));

    const fresh = await connect(booted.wsUrl);
    clients.push(fresh);

    // Each survivor gets exactly two frames back-to-back: the refreshed `lobby.state`, then the
    // `presence(connected:true)` broadcast — both listeners must be registered before the rejoin
    // is sent (see `nextMessages`'s doc comment for why stacking two `.once`s here would race).
    const others = [nextMessages(sockets[0]!, 2), nextMessages(sockets[2]!, 2), nextMessages(sockets[3]!, 2)];
    const rejoinReply = nextMessage(fresh);
    send(fresh, { v: 1, type: "game.rejoin", payload: { gameId, playerToken: tokens[1] } });

    const rejoinMsg = await rejoinReply;
    expect(rejoinMsg.type).toBe("lobby.state"); // T-205 §2: lobby/chat context alongside the resync
    expect(rejoinMsg.payload.you).toEqual({ seat: 1, playerToken: tokens[1] });

    const [p0Frames, p2Frames, p3Frames] = await Promise.all(others);
    for (const frames of [p0Frames!, p2Frames!, p3Frames!]) {
      expect(frames[0]!.type).toBe("lobby.state");
      expect(frames[1]).toEqual({ v: 1, type: "presence", payload: { seat: 1, connected: true } });
    }
    await zombieClosed; // the stale socket got kicked

    const room = [...lobby.rooms.values()].find((r) => r.gameId === gameId)!;
    expect(room.seats[1]!.connId).not.toBeNull();
    expect(room.seats[1]!.connId).not.toBe("stale");

    expect(rejoinSpy).toHaveBeenCalledTimes(1);
    const [rejoinedRoom, rejoinedSeat] = rejoinSpy.mock.calls[0]!;
    expect((rejoinedRoom as Room).gameId).toBe(gameId);
    expect(rejoinedSeat).toBe(1);
  });

  describe("T-411: lobby.addBot / lobby.removeBot", () => {
    it("host adds a bot to an empty seat: broadcasts occupant 'bot', nickname null, ready true", async () => {
      const booted = await boot();
      app = booted.app;
      hub = booted.hub;
      lobby = booted.lobby;

      const p0 = await connect(booted.wsUrl);
      clients.push(p0);
      const created = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
      await created;

      const reply = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.addBot", payload: { seat: 1 } });
      const msg = await reply;

      expect(msg.type).toBe("lobby.state");
      expect(msg.payload.seats![1]).toEqual({ occupant: "bot", nickname: null, ready: true });
      // leak check still holds for a bot seat: no token/connId ever rides the wire.
      expect(Object.keys(msg.payload.seats![1]!).sort()).toEqual(["nickname", "occupant", "ready"]);

      const room = [...lobby.rooms.values()].values().next().value!;
      expect(room.seats[1]!.playerToken).toBeNull();
      expect(room.seats[1]!.connId).toBeNull();
    });

    it("bot seats count as ready — start succeeds with 1 human + 3 bots", async () => {
      const startGame = vi.fn();
      const booted = await boot({ startGame });
      app = booted.app;
      hub = booted.hub;
      lobby = booted.lobby;

      const p0 = await connect(booted.wsUrl);
      clients.push(p0);
      const created = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
      await created;

      for (const seat of [1, 2, 3]) {
        const reply = nextMessage(p0);
        send(p0, { v: 1, type: "lobby.addBot", payload: { seat } });
        await reply;
      }

      const readyReply = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.ready", payload: { ready: true } });
      await readyReply;

      send(p0, { v: 1, type: "lobby.start", payload: {} });
      await vi.waitFor(() => expect(startGame).toHaveBeenCalledTimes(1));
    });

    it("removeBot frees the seat back to empty", async () => {
      const booted = await boot();
      app = booted.app;
      hub = booted.hub;
      lobby = booted.lobby;

      const p0 = await connect(booted.wsUrl);
      clients.push(p0);
      const created = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
      await created;

      const added = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.addBot", payload: { seat: 1 } });
      await added;

      const reply = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.removeBot", payload: { seat: 1 } });
      const msg = await reply;
      expect(msg.payload.seats![1]).toBeNull();
    });

    it("non-host addBot/removeBot is rejected NOT_HOST", async () => {
      const booted = await boot();
      app = booted.app;
      hub = booted.hub;
      lobby = booted.lobby;

      const p0 = await connect(booted.wsUrl);
      const p1 = await connect(booted.wsUrl);
      clients.push(p0, p1);

      const created = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
      const code = (await created).payload.code!;
      const bobJoin = nextMessage(p1);
      const aliceSeesBob = nextMessage(p0);
      send(p1, { v: 1, type: "lobby.join", payload: { code, nickname: "Bob" } });
      await Promise.all([bobJoin, aliceSeesBob]);

      const reply = nextMessage(p1);
      send(p1, { v: 1, type: "lobby.addBot", payload: { seat: 2 } });
      const msg = await reply;
      expect(msg).toEqual({ v: 1, type: "game.error", payload: { code: "NOT_HOST", message: expect.any(String) } });
    });

    it("addBot on an occupied seat is rejected SEAT_OCCUPIED", async () => {
      const booted = await boot();
      app = booted.app;
      hub = booted.hub;
      lobby = booted.lobby;

      const p0 = await connect(booted.wsUrl);
      clients.push(p0);
      const created = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
      await created;

      const reply = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.addBot", payload: { seat: 0 } }); // seat 0 is Alice
      const msg = await reply;
      expect(msg).toEqual({
        v: 1,
        type: "game.error",
        payload: { code: "SEAT_OCCUPIED", message: expect.any(String) },
      });
    });

    it("addBot beyond playerCount is rejected SEAT_OUT_OF_RANGE", async () => {
      const booted = await boot();
      app = booted.app;
      hub = booted.hub;
      lobby = booted.lobby;

      const p0 = await connect(booted.wsUrl);
      clients.push(p0);
      const created = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(3) } });
      await created;

      const reply = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.addBot", payload: { seat: 3 } }); // playerCount is 3 (seats 0-2)
      const msg = await reply;
      expect(msg).toEqual({
        v: 1,
        type: "game.error",
        payload: { code: "SEAT_OUT_OF_RANGE", message: expect.any(String) },
      });
    });

    it("removeBot on an empty seat is rejected SEAT_EMPTY; on a human seat is rejected SEAT_NOT_BOT", async () => {
      const booted = await boot();
      app = booted.app;
      hub = booted.hub;
      lobby = booted.lobby;

      const p0 = await connect(booted.wsUrl);
      clients.push(p0);
      const created = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
      await created;

      const emptyReply = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.removeBot", payload: { seat: 1 } });
      expect(await emptyReply).toEqual({
        v: 1,
        type: "game.error",
        payload: { code: "SEAT_EMPTY", message: expect.any(String) },
      });

      const humanReply = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.removeBot", payload: { seat: 0 } }); // seat 0 is Alice, a human
      expect(await humanReply).toEqual({
        v: 1,
        type: "game.error",
        payload: { code: "SEAT_NOT_BOT", message: expect.any(String) },
      });
    });

    it("addBot/removeBot after start is rejected ALREADY_STARTED", async () => {
      const startGame = vi.fn();
      const booted = await boot({ startGame });
      app = booted.app;
      hub = booted.hub;
      lobby = booted.lobby;

      const { sockets } = await startFourPlayerGame(booted.wsUrl, startGame);
      clients.push(...sockets);

      const addReply = nextMessage(sockets[0]!);
      send(sockets[0]!, { v: 1, type: "lobby.addBot", payload: { seat: 1 } });
      expect(await addReply).toEqual({
        v: 1,
        type: "game.error",
        payload: { code: "ALREADY_STARTED", message: expect.any(String) },
      });
    });

    it("host migrates to a human seat, never a bot, when the host disconnects pre-start", async () => {
      const booted = await boot();
      app = booted.app;
      hub = booted.hub;
      lobby = booted.lobby;

      const p0 = await connect(booted.wsUrl);
      const p1 = await connect(booted.wsUrl);
      clients.push(p0, p1);

      const created = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.create", payload: { nickname: "Alice", config: baseConfig(4) } });
      const code = (await created).payload.code!;

      // Bots fill seats 2 and 3; Bob (human) joins seat 1.
      const bot2 = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.addBot", payload: { seat: 2 } });
      await bot2;
      const bot3 = nextMessage(p0);
      send(p0, { v: 1, type: "lobby.addBot", payload: { seat: 3 } });
      await bot3;

      const bobJoin = nextMessage(p1);
      const aliceSeesBob = nextMessage(p0);
      send(p1, { v: 1, type: "lobby.join", payload: { code, nickname: "Bob" } });
      await Promise.all([bobJoin, aliceSeesBob]);

      // Alice (host, seat 0) disconnects: host must migrate to Bob (seat 1, human), skipping the
      // bot seats even though they're non-null.
      const room = [...lobby.rooms.values()].find((r) => r.code === code)!;
      const bobSeesLeave = nextMessage(p1);
      p0.close();
      await bobSeesLeave;
      expect(room.hostSeat).toBe(1);
    });
  });
});
