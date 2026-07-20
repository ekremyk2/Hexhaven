// ws hub: attaches a WebSocketServer to Fastify's underlying HTTP server on `/ws`
// (docs/02-architecture.md §5, §7). Per-connection heartbeat + a structural JSON/envelope
// guard live here; everything else (protocol validation, lobby/session logic) is out of
// scope (T-202/T-203/T-204) — this hub just passes well-formed envelopes upward untouched.
import type { FastifyInstance } from "fastify";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { nanoid } from "nanoid";

/** Wire envelope shape (docs/02 §5): `{ v: 1, type: string, payload: … }`. */
export interface Envelope {
  v: 1;
  type: string;
  payload?: unknown;
}

export type ConnId = string;

export type MessageHandler = (connId: ConnId, envelope: Envelope) => void;
export type DisconnectHandler = (connId: ConnId) => void;

export interface WsHubOptions {
  /** Ping cadence in ms (docs/02 §5: 15s heartbeat). Overridable for tests. */
  heartbeatIntervalMs?: number;
  /** Missed pongs allowed before a connection is terminated. Defaults to 2. */
  maxMissedPongs?: number;
}

export interface WsHub {
  /** Registers the handler invoked for every structurally-valid inbound envelope. */
  onMessage(handler: MessageHandler): void;
  /** Registers the handler invoked once a connection's socket closes (T-203: seat cleanup). */
  onDisconnect(handler: DisconnectHandler): void;
  /** Sends an envelope to one connection. No-op if the connection is unknown or not open. */
  send(connId: ConnId, envelope: Envelope): void;
  /** Sends an envelope to many connections. */
  broadcast(connIds: Iterable<ConnId>, envelope: Envelope): void;
  /**
   * Forcefully closes one connection (T-205: evicts a zombie socket still bound to a seat when
   * `game.rejoin` rebinds it to a new connection). No-op if the connection is unknown or already
   * closed. Fires the normal `onDisconnect` handler for `connId` like any other socket close.
   */
  disconnect(connId: ConnId): void;
  /** Stops the heartbeat and closes every open socket; resolves once the ws server is closed. */
  close(): Promise<void>;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_MAX_MISSED_PONGS = 2;

const BAD_MESSAGE: Envelope = {
  v: 1,
  type: "game.error",
  // `message` is required by GameErrorPayloadSchema (T-202) — clients drop schema-invalid frames.
  payload: { code: "BAD_MESSAGE", message: "malformed frame: expected JSON envelope { v:1, type, payload }" },
};

/** Attaches a `ws` hub to `app`'s underlying HTTP server on path `/ws`. */
export function attachWsHub(app: FastifyInstance, options: WsHubOptions = {}): WsHub {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const maxMissedPongs = options.maxMissedPongs ?? DEFAULT_MAX_MISSED_PONGS;

  const wss = new WebSocketServer({ server: app.server, path: "/ws" });
  const sockets = new Map<ConnId, WebSocket>();
  const missedPongs = new Map<ConnId, number>();
  let messageHandler: MessageHandler = () => {};
  let disconnectHandler: DisconnectHandler = () => {};

  function send(connId: ConnId, envelope: Envelope): void {
    const socket = sockets.get(connId);
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(envelope));
  }

  function broadcast(connIds: Iterable<ConnId>, envelope: Envelope): void {
    for (const connId of connIds) send(connId, envelope);
  }

  // T-205: evict a stale/zombie socket on rejoin. Uses the same close code family as shutdown
  // (below); the normal `on("close", ...)` listener still fires for this connId, so callers that
  // already repointed their own bookkeeping (e.g. `lobby.ts`'s `connSeats`) away from `connId`
  // before calling this see that later `onDisconnect` call become a harmless no-op.
  function disconnectOne(connId: ConnId): void {
    const socket = sockets.get(connId);
    if (!socket) return;
    socket.close(4000, "reconnected from another connection");
  }

  // Heartbeat: every tick, either terminate connections that ignored the last
  // `maxMissedPongs` pings, or ping the rest and bump their missed-pong count (a `pong`
  // listener below resets it back to 0).
  const heartbeat = setInterval(() => {
    for (const [connId, socket] of sockets) {
      const missed = missedPongs.get(connId) ?? 0;
      if (missed >= maxMissedPongs) {
        app.log.warn({ connId }, "ws heartbeat: no pong, terminating connection");
        socket.terminate();
        continue;
      }
      missedPongs.set(connId, missed + 1);
      socket.ping();
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();

  wss.on("connection", (socket) => {
    const connId: ConnId = nanoid();
    sockets.set(connId, socket);
    missedPongs.set(connId, 0);
    app.log.info({ connId }, "ws connected");

    socket.on("pong", () => {
      missedPongs.set(connId, 0);
    });

    socket.on("message", (data, isBinary) => {
      const envelope = parseEnvelope(data, isBinary);
      if (!envelope) {
        send(connId, BAD_MESSAGE);
        return;
      }
      try {
        messageHandler(connId, envelope);
      } catch (err) {
        app.log.error({ connId, err }, "ws onMessage handler threw");
      }
    });

    socket.on("close", () => {
      sockets.delete(connId);
      missedPongs.delete(connId);
      app.log.info({ connId }, "ws disconnected");
      try {
        disconnectHandler(connId);
      } catch (err) {
        app.log.error({ connId, err }, "ws onDisconnect handler threw");
      }
    });

    socket.on("error", (err) => {
      app.log.warn({ connId, err }, "ws socket error");
    });
  });

  // Idempotent: a second wss.close() would error with "The server is not running",
  // so the first close's promise is memoized and returned to later callers.
  let closing: Promise<void> | null = null;
  function close(): Promise<void> {
    closing ??= new Promise((resolve, reject) => {
      clearInterval(heartbeat);
      for (const socket of sockets.values()) {
        socket.close(1001, "server shutting down");
      }
      wss.close((err) => (err ? reject(err) : resolve()));
    });
    return closing;
  }

  return {
    onMessage(handler) {
      messageHandler = handler;
    },
    onDisconnect(handler) {
      disconnectHandler = handler;
    },
    send,
    broadcast,
    disconnect: disconnectOne,
    close,
  };
}

/** JSON parse guard: malformed/binary/non-envelope-shaped frames become `null` (→ BAD_MESSAGE). */
function parseEnvelope(data: RawData, isBinary: boolean): Envelope | null {
  if (isBinary) return null; // docs/02 §5: transport is JSON text frames only

  let text: string;
  try {
    text = rawDataToString(data);
  } catch {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  return isEnvelopeShaped(value) ? value : null;
}

function rawDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

// Structural shape only (docs/02 §5: `{ v: 1, type: string, payload: … }`) — full per-type
// payload validation is T-202 (zod), applied by the upper layer that owns `onMessage`.
function isEnvelopeShaped(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { v, type } = value as { v?: unknown; type?: unknown };
  return v === 1 && typeof type === "string";
}
