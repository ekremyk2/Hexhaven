// Boots the Fastify HTTP server with the ws hub attached, and — when run directly (not
// imported by tests) — installs SIGINT/SIGTERM graceful shutdown. docs/02-architecture.md §7.
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { createHttpServer, type HttpServerOptions } from "./http.js";
import { attachWsHub, type WsHub, type WsHubOptions } from "./wsHub.js";
import { attachLobby, type Lobby, type LobbyOptions } from "./lobby.js";
import { createGameSessions, type GameSessions, type GameSessionsOptions } from "./session.js";

const DEFAULT_PORT = 8080;
const DEFAULT_HOST = "0.0.0.0";

export interface StartServerOptions {
  /** Defaults to the PORT env var, or 8080. */
  port?: number;
  /** Defaults to 0.0.0.0 (docs/02 §9 — LAN server is the primary target). */
  host?: string;
  logLevel?: HttpServerOptions["logLevel"];
  wsHub?: WsHubOptions;
  /** Defaults to the LOBBY_PASSWORD env var (unset = open server, D-031). */
  lobby?: LobbyOptions;
  /** T-204: game-session GC tuning. Tests shrink this to avoid real waits. */
  sessions?: GameSessionsOptions;
}

export interface ServerHandle {
  app: FastifyInstance;
  hub: WsHub;
  lobby: Lobby;
  /** T-204: the authoritative per-room game state + redaction fan-out. */
  sessions: GameSessions;
  /** Stops the heartbeat, closes every open ws connection, then closes the HTTP server. Idempotent. */
  close(): Promise<void>;
}

/** Boots http.ts + wsHub.ts + lobby.ts together and starts listening. Does not install signal handlers. */
export async function startServer(options: StartServerOptions = {}): Promise<ServerHandle> {
  const port = options.port ?? Number(process.env.PORT ?? DEFAULT_PORT);
  const host = options.host ?? DEFAULT_HOST;

  const app = createHttpServer({ logLevel: options.logLevel });
  const hub = attachWsHub(app, options.wsHub);
  const sessions = createGameSessions(hub, { logger: app.log, ...options.sessions });
  const lobby = attachLobby(hub, {
    password: process.env.LOBBY_PASSWORD,
    logger: app.log,
    startGame: (room) => sessions.startGame(room),
    onRematch: (room) => sessions.rematch(room),
    onGameAction: (room, seat, connId, action) => sessions.handleGameAction(room, seat, connId, action),
    onChatSend: (room, seat, connId, text) => sessions.handleChatSend(room, seat, connId, text),
    onGameSyncRequest: (room, seat, connId) => sessions.handleGameSyncRequest(room, seat, connId),
    // T-205 §2: rejoin's `game.sync` is identical to a client-driven `game.syncRequest`'s — same
    // seat, same fresh `redact(state, seat)`. A room with no live session yet (rejoin racing a
    // not-yet-started game) is already a no-op inside `handleGameSyncRequest`.
    onGameRejoin: (room, seat, connId) => {
      sessions.handleGameSyncRequest(room, seat, connId);
      // T-206 §4: a rejoin can lengthen the reconnecting seat's deadline back to `turnSeconds`.
      sessions.notifyConnectivityChanged(room);
    },
    // T-206 §4: a disconnect can shorten the disconnecting seat's deadline to `decisionSeconds`.
    onGameDisconnect: (room) => sessions.notifyConnectivityChanged(room),
    ...options.lobby,
  });

  await app.listen({ port, host });

  const address = app.server.address();
  const boundPort = address && typeof address === "object" ? address.port : port;
  app.log.info(`hexhaven server listening on http://${host}:${boundPort} (ws hub on /ws)`);

  let closing: Promise<void> | null = null;
  function close(): Promise<void> {
    closing ??= (async () => {
      sessions.close();
      lobby.close();
      await hub.close();
      await app.close();
    })();
    return closing;
  }

  return { app, hub, lobby, sessions, close };
}

function isEntryPoint(): boolean {
  const invokedPath = process.argv[1];
  if (!invokedPath) return false;
  return import.meta.url === pathToFileURL(invokedPath).href;
}

if (isEntryPoint()) {
  try {
    const handle = await startServer();

    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      handle.app.log.info(`${signal} received, shutting down`);
      handle
        .close()
        .then(() => process.exit(0))
        .catch((err: unknown) => {
          handle.app.log.error(err, "error during shutdown");
          process.exit(1);
        });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    // Logger may not exist yet if createHttpServer() itself threw — console.error is the
    // last-resort fallback (allowed: docs/05 §6 bans console.log, not warn/error).
    console.error("Fatal error while starting server:", err);
    process.exit(1);
  }
}
