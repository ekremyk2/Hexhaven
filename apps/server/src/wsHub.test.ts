import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import { createHttpServer } from "./http.js";
import { attachWsHub, type Envelope, type WsHub, type WsHubOptions } from "./wsHub.js";

async function boot(hubOptions?: WsHubOptions): Promise<{ app: FastifyInstance; hub: WsHub; wsUrl: string }> {
  const app = createHttpServer({ logLevel: "silent" });
  const hub = attachWsHub(app, hubOptions);
  await app.listen({ port: 0, host: "127.0.0.1" });

  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a bound TCP address");
  }
  return { app, hub, wsUrl: `ws://127.0.0.1:${address.port}/ws` };
}

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function onceMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        // test clients only ever receive JSON text frames -> data is a Buffer
        resolve(JSON.parse(String(data)));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

function onceClose(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once("close", () => resolve()));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("wsHub", () => {
  let app: FastifyInstance | undefined;
  let hub: WsHub | undefined;
  const clients: WebSocket[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.terminate();
    }
    await hub?.close();
    await app?.close();
    app = undefined;
    hub = undefined;
  });

  it("echoes a test envelope through onMessage -> send", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;

    hub.onMessage((connId, envelope) => {
      hub?.send(connId, envelope);
    });

    const client = new WebSocket(booted.wsUrl);
    clients.push(client);
    await onceOpen(client);

    const sent: Envelope = { v: 1, type: "chat.send", payload: { text: "hello" } };
    const received = onceMessage(client);
    client.send(JSON.stringify(sent));

    await expect(received).resolves.toEqual(sent);
  });

  it("responds to malformed JSON with BAD_MESSAGE and keeps the connection open", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;

    const seen: Array<{ connId: string; envelope: Envelope }> = [];
    hub.onMessage((connId, envelope) => {
      seen.push({ connId, envelope });
    });

    const client = new WebSocket(booted.wsUrl);
    clients.push(client);
    await onceOpen(client);

    const errorReply = onceMessage(client);
    client.send("{ not valid json");

    await expect(errorReply).resolves.toEqual({
      v: 1,
      type: "game.error",
      payload: { code: "BAD_MESSAGE", message: expect.any(String) },
    });
    expect(seen).toHaveLength(0); // the malformed frame never reached onMessage

    // the connection must survive: a well-formed envelope right after still round-trips.
    expect(client.readyState).toBe(WebSocket.OPEN);
    hub.onMessage((connId, envelope) => hub?.send(connId, envelope));
    const followUp: Envelope = { v: 1, type: "chat.send", payload: { text: "still alive" } };
    const echoed = onceMessage(client);
    client.send(JSON.stringify(followUp));
    await expect(echoed).resolves.toEqual(followUp);
  });

  it("responds to non-envelope JSON (no string `type`) with BAD_MESSAGE", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;
    hub.onMessage(() => {
      throw new Error("should not be reached for a malformed envelope");
    });

    const client = new WebSocket(booted.wsUrl);
    clients.push(client);
    await onceOpen(client);

    const reply = onceMessage(client);
    client.send(JSON.stringify([1, 2, 3]));

    await expect(reply).resolves.toEqual({
      v: 1,
      type: "game.error",
      payload: { code: "BAD_MESSAGE", message: expect.any(String) },
    });

    // missing `v: 1` is also rejected (docs/02 §5 envelope shape)
    const reply2 = onceMessage(client);
    client.send(JSON.stringify({ type: "chat.send", payload: { text: "no v" } }));
    await expect(reply2).resolves.toEqual({
      v: 1,
      type: "game.error",
      payload: { code: "BAD_MESSAGE", message: expect.any(String) },
    });
  });

  it("broadcast sends the envelope to every listed connection", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;

    // single handler (onMessage replaces, not stacks): record the connId, echo back so the
    // hello round-trips below resolve once each connection is known to the hub.
    const connIds: string[] = [];
    hub.onMessage((connId, envelope) => {
      if (!connIds.includes(connId)) connIds.push(connId);
      hub?.send(connId, envelope);
    });

    const a = new WebSocket(booted.wsUrl);
    const b = new WebSocket(booted.wsUrl);
    clients.push(a, b);
    await Promise.all([onceOpen(a), onceOpen(b)]);

    // both connections say hello so the hub (and this test) learns their connIds
    const aHello = onceMessage(a);
    const bHello = onceMessage(b);
    const helloEnvelope: Envelope = { v: 1, type: "chat.send", payload: { text: "hi" } };
    a.send(JSON.stringify(helloEnvelope));
    b.send(JSON.stringify(helloEnvelope));
    await Promise.all([aHello, bHello]);
    expect(connIds).toHaveLength(2);

    const announcement: Envelope = { v: 1, type: "presence", payload: { note: "broadcast" } };
    const aGotIt = onceMessage(a);
    const bGotIt = onceMessage(b);
    hub.broadcast(connIds, announcement);

    await expect(aGotIt).resolves.toEqual(announcement);
    await expect(bGotIt).resolves.toEqual(announcement);
  });

  it("shutdown (hub.close) closes open sockets", async () => {
    const booted = await boot();
    app = booted.app;
    hub = booted.hub;

    const client = new WebSocket(booted.wsUrl);
    clients.push(client);
    await onceOpen(client);

    const closed = onceClose(client);
    await hub.close();
    await expect(closed).resolves.toBeUndefined();
  });

  it("terminates a connection after maxMissedPongs missed heartbeats", async () => {
    const booted = await boot({ heartbeatIntervalMs: 25, maxMissedPongs: 2 });
    app = booted.app;
    hub = booted.hub;

    // autoPong: false simulates an unresponsive peer that never answers ping frames.
    const client = new WebSocket(booted.wsUrl, { autoPong: false });
    clients.push(client);
    await onceOpen(client);

    const closed = onceClose(client);
    await expect(closed).resolves.toBeUndefined();
  }, 5000);

  it("does not terminate a connection that keeps responding to pings", async () => {
    const booted = await boot({ heartbeatIntervalMs: 25, maxMissedPongs: 2 });
    app = booted.app;
    hub = booted.hub;

    const client = new WebSocket(booted.wsUrl); // default: auto-pong enabled
    clients.push(client);
    await onceOpen(client);

    await wait(200); // several heartbeat cycles worth of real time
    expect(client.readyState).toBe(WebSocket.OPEN);
  });
});
