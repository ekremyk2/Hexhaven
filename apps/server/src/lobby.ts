// Lobby & rooms (T-203, docs/02-architecture.md §5/§7, docs/07 D-011/D-012/D-025/D-031).
// In-memory room registry + the message handling for `lobby.create` / `lobby.join` /
// `lobby.ready` / `lobby.start`, wired onto a `WsHub`'s `onMessage`/`onDisconnect`. The game
// session itself (T-204) is out of scope: `attachLobby`'s `startGame` option is a stub hook.
import { timingSafeEqual } from "node:crypto";
import {
  EP_SCENARIO_SUPPORTS_56,
  isEPScenarioId,
  isTBScenarioId,
  resolveModules,
  TB_SCENARIO_SUPPORTS_56,
} from "@hexhaven/engine";
import {
  getScenario,
  parseClientMessage,
  type Action,
  type EngineErrorCode,
  type ProtocolErrorCode,
  type RoomConfig,
} from "@hexhaven/shared";
import type { ConnId, DisconnectHandler, MessageHandler, WsHub } from "./wsHub.js";
import { generateGameId, generatePlayerToken, generateRoomCode } from "./codes.js";
import { findSeatByToken } from "./reconnect.js";

type Seat = 0 | 1 | 2 | 3 | 4 | 5;

/** T-411 §1: a seat's occupant. Absent (`undefined`) is treated exactly like `'human'` — kept
 *  optional so pre-T-411 test fixtures across this package that build a `SeatInfo` literal without
 *  it keep compiling; every path THIS task adds sets it explicitly. */
export type SeatOccupant = "human" | "bot";

/**
 * T-203 §1, extended by T-411 §1 for host-added bot seats: a bot has no socket and no reconnect
 * token (`connId`/`playerToken` are `null`), and never carries a literal display string
 * (`nickname: null` — engine/server never produce user-facing text; the client derives the
 * localized "Bot" label from the seat index). Bots are always `ready` (nothing to toggle).
 */
export interface SeatInfo {
  occupant?: SeatOccupant;
  nickname: string | null;
  playerToken: string | null;
  connId: ConnId | null;
  ready: boolean;
}

/** T-203 §1. */
export interface Room {
  gameId: string;
  code: string;
  createdAt: number;
  config: RoomConfig;
  seats: (SeatInfo | null)[];
  hostSeat: Seat;
  started: boolean;
}

export interface LobbyLogger {
  info: (obj: unknown, msg?: string) => void;
}

export interface LobbyOptions {
  /** D-031: when set, `lobby.create`/`lobby.join` require a matching `password`. Unset = open. */
  password?: string;
  logger?: LobbyLogger;
  /** T-203 §3: called once a room's `lobby.start` succeeds — T-204 owns the real session. */
  startGame?: (room: Room) => void;
  /** "Play again": host restarts a FINISHED game in the same room (same seats + bots). The session
   * layer decides whether the current game is actually over before recreating it. */
  onRematch?: (room: Room) => void;
  /**
   * T-204: called for a `game.action` whose sender's connection is bound to a seat in `room` —
   * `seat` is resolved from that binding (the connection-to-seat map IS the auth check; there is
   * no separate per-message token, docs/02 §7 "seat↔token bindings" covers rejoin, T-205). The
   * session layer owns validating/applying the action and replying (accept: `game.events` fan-out;
   * reject: `game.error` to `connId` only).
   */
  onGameAction?: (room: Room, seat: Seat, connId: ConnId, action: Action) => void;
  /** T-204: called for a `chat.send` — chat works both pre-start (lobby) and mid-game. */
  onChatSend?: (room: Room, seat: Seat, connId: ConnId, text: string) => void;
  /** T-204/T-301: called for a `game.syncRequest` (client-detected `stateVersion` gap). */
  onGameSyncRequest?: (room: Room, seat: Seat, connId: ConnId) => void;
  /**
   * T-205: called once a `game.rejoin{gameId, playerToken}` has successfully rebound `connId` to
   * `seat` (token matched, zombie socket — if any — already evicted). The session layer answers
   * with the same `game.sync` a `game.syncRequest` would get; a room with no live session yet
   * (rejoin racing a not-yet-started game) is simply a no-op here — the `lobby.state` resend below
   * already covers that case.
   */
  onGameRejoin?: (room: Room, seat: Seat, connId: ConnId) => void;
  /**
   * T-206: called right after a started room's seat goes from connected to disconnected (i.e. the
   * `broadcastPresence(room, seat, false)` this same disconnect triggers) — lets the turn-timer
   * manager re-derive whether that seat's pending deadline should shorten to `decisionSeconds`
   * (task §4). A no-op when timers are flag-off.
   */
  onGameDisconnect?: (room: Room, seat: Seat) => void;
  /** Empty-room GC sweep cadence. Defaults to 60s; tests shrink this to avoid real waits. */
  gcIntervalMs?: number;
  /** How long an empty room survives before GC deletes it. Defaults to 30 min (docs/02 §7). */
  roomTtlMs?: number;
}

export interface Lobby {
  /** Exposed read-only for tests; keyed by `gameId`. */
  rooms: ReadonlyMap<string, Room>;
  /** Stops the GC interval. Call from test teardown / server shutdown. */
  close(): void;
}

const NOOP_LOGGER: LobbyLogger = { info: () => {} };
const DEFAULT_GC_INTERVAL_MS = 60_000;
const DEFAULT_ROOM_TTL_MS = 30 * 60_000;

/** Constant-time string compare (D-031) so wrong-password latency doesn't leak information. */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still do a same-length compare so a length mismatch doesn't return measurably faster.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** `null` = ok to proceed; otherwise the protocol error code to send back. */
function checkPassword(configured: string | undefined, provided: string | undefined): ProtocolErrorCode | null {
  if (!configured) return null; // unset env = open server (LAN default)
  if (!provided) return "PASSWORD_REQUIRED";
  if (!constantTimeEqual(provided, configured)) return "BAD_PASSWORD";
  return null;
}

/**
 * T-203 §1 / T-601 / T-705 / T-806 (docs/10 §3): unshipped expansions/player counts are rejected,
 * not silently reset. Mirrors the engine's `resolveModules` expansion-combination guard. Supported
 * combined games: Seafarers + Cities & Knights (3–4p) and the 5–6 extension + Cities & Knights
 * (5–6p, on the base 5–6 board). The ONE forbidden pair is the 5–6 extension + Seafarers (no 5–6
 * Seafarers scenario boards shipped). Seafarers also requires a KNOWN scenario; 5–6 players require
 * the fiveSix extension.
 */
function expansionUnavailable(config: RoomConfig): boolean {
  // Traders & Barbarians (Phase 10): `fishermen` (T-1002), `rivers` (T-1003), `caravans` (T-1004),
  // `barbarianAttack` (T-1005), and `tradersBarbarians` (T-1006, the main scenario — LAST of the
  // five) are all shipped now; `hexhavenFor2` (T-1007, optional) stays "coming soon". Standalone only
  // (no combination with Seafarers/C&K, mirroring the engine's `resolveModules` guard). Player count:
  // 3–4p always plays the base board (fiveSix OFF); 5–6p is allowed ONLY for a scenario that declares
  // 5–6 support (`TB_SCENARIO_SUPPORTS_56`, Phase 10B T-1050 — `fishermen` is first, the rest are
  // still 3–4p-only backlog items), and always needs `fiveSix` ON (the base 30-hex EXT56 board).
  if (config.expansions.tradersBarbarians) {
    const tb = config.expansions.tradersBarbarians;
    if (
      tb.scenario !== "fishermen" &&
      tb.scenario !== "rivers" &&
      tb.scenario !== "caravans" &&
      tb.scenario !== "barbarianAttack" &&
      tb.scenario !== "tradersBarbarians"
    )
      return true;
    if (config.expansions.seafarers !== false || config.expansions.citiesKnights) {
      return true;
    }
    if (config.expansions.fiveSix) {
      if (config.playerCount !== 5 && config.playerCount !== 6) return true;
      if (!isTBScenarioId(tb.scenario) || !TB_SCENARIO_SUPPORTS_56[tb.scenario]) return true;
    } else if (config.playerCount !== 3 && config.playerCount !== 4) {
      return true;
    }
  }
  // Explorers & Pirates (Phase 11): `landHo` (T-1107, the intro scenario — movement + exploration +
  // founding, 8-VP win, no missions), `fishForHexhaven` (T-1111, that same frame + the fish mission ON,
  // 10-VP win), `spicesForHexhaven` (T-1112, that same frame + the spice mission ON, 10-VP win),
  // `pirateLairs` (T-1113, that same frame + the pirateLairs mission ON, 10-VP win), and
  // `fullCampaign` (T-1114, that same frame with ALL THREE missions ON at once, 17-VP win, ⚠ VERIFY)
  // are shipped now — every declared E&P scenario is playable, none stay "coming soon". Standalone
  // only (mirrors the engine's `resolveModules` guard). Player count: 3–4p always plays E&P's own
  // 3–4 board (fiveSix OFF); 5–6p (T-1150, Phase 11B) is allowed ONLY for a scenario that declares
  // 5–6 support (`EP_SCENARIO_SUPPORTS_56` — today: `landHo`, the rest are still 3–4p-only backlog
  // items for T-1152), and always needs `fiveSix` ON (E&P's own bigger 5–6 board). Mirrors T&B's
  // T-1050 gate exactly, just keyed on E&P's own per-scenario capability flag.
  if (config.expansions.explorersPirates) {
    const ep = config.expansions.explorersPirates;
    if (
      ep.scenario !== "landHo" &&
      ep.scenario !== "fishForHexhaven" &&
      ep.scenario !== "spicesForHexhaven" &&
      ep.scenario !== "pirateLairs" &&
      ep.scenario !== "fullCampaign"
    )
      return true;
    if (
      config.expansions.seafarers !== false ||
      config.expansions.citiesKnights ||
      config.expansions.tradersBarbarians
    ) {
      return true;
    }
    if (config.expansions.fiveSix) {
      if (config.playerCount !== 5 && config.playerCount !== 6) return true;
      if (!isEPScenarioId(ep.scenario) || !EP_SCENARIO_SUPPORTS_56[ep.scenario]) return true;
    } else if (config.playerCount !== 3 && config.playerCount !== 4) {
      return true;
    }
  }
  if (config.expansions.seafarers !== false) {
    // Phase 7B: mirror the engine's `resolveModules` seafarers gate. A scenario is playable at a given
    // player count iff it ships a board for it (`scenario.boards[pc]`); 3/4 uses the base box (fiveSix
    // OFF), 5/6 uses the Seafarers 5–6 extension (fiveSix ON).
    const sc = getScenario(config.expansions.seafarers.scenario);
    if (!sc) return true; // unknown / unshipped scenario
    const pc = config.playerCount;
    if (!sc.boards[pc]) return true; // scenario has no board for this player count
    if ((pc === 5 || pc === 6) !== config.expansions.fiveSix) return true; // 5/6 needs fiveSix; 3/4 forbids it
  }
  // 5–6 players require the fiveSix extension (D-025); it composes with C&K (base 5–6 board).
  if ((config.playerCount === 5 || config.playerCount === 6) && !config.expansions.fiveSix) {
    return true;
  }
  return false;
}

/** Attaches lobby message handling + disconnect cleanup to `hub`. */
export function attachLobby(hub: WsHub, options: LobbyOptions = {}): Lobby {
  const logger = options.logger ?? NOOP_LOGGER;
  const startGame =
    options.startGame ??
    ((room: Room): void => {
      logger.info({ gameId: room.gameId }, "startGame stub: T-204 session layer not wired yet");
    });
  const onRematch = options.onRematch;
  const gcIntervalMs = options.gcIntervalMs ?? DEFAULT_GC_INTERVAL_MS;
  const roomTtlMs = options.roomTtlMs ?? DEFAULT_ROOM_TTL_MS;

  const rooms = new Map<string, Room>(); // gameId -> Room
  const codeToGameId = new Map<string, string>();
  const connSeats = new Map<ConnId, { gameId: string; seat: Seat }>();
  const emptySince = new Map<string, number>(); // gameId -> ms timestamp the room became empty

  function isCodeTaken(code: string): boolean {
    return codeToGameId.has(code);
  }

  function deleteRoom(gameId: string): void {
    const room = rooms.get(gameId);
    if (!room) return;
    rooms.delete(gameId);
    codeToGameId.delete(room.code);
    emptySince.delete(gameId);
  }

  function refreshEmptiness(room: Room): void {
    // T-411: a seat occupied ONLY by bots isn't "someone's here" — nobody can host or ready it up,
    // so a pre-start room with nothing but bot seats (the last human left) counts as empty too,
    // same as a literally-empty one, so it still starts its 30-min GC clock instead of leaking
    // forever (bots, unlike a disconnected human, never come back to reclaim the room).
    const isEmpty = room.seats.every((seat) => seat === null || seat.occupant === "bot");
    if (isEmpty) {
      if (!emptySince.has(room.gameId)) emptySince.set(room.gameId, Date.now());
    } else {
      emptySince.delete(room.gameId);
    }
  }

  const gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [gameId, since] of emptySince) {
      if (now - since >= roomTtlMs) deleteRoom(gameId);
    }
  }, gcIntervalMs);
  gcTimer.unref();

  function sendError(connId: ConnId, code: ProtocolErrorCode | EngineErrorCode, message: string): void {
    hub.send(connId, { v: 1, type: "game.error", payload: { code, message } });
  }

  // T-203 §4: broadcast the seats/nicknames/ready/host snapshot to every seated connection;
  // `justClaimedSeat` (create/join only) additionally carries that one recipient's own
  // `{ seat, playerToken }` — never any other seat's token (T-203 §5 leak check).
  function broadcastLobbyState(room: Room, justClaimedSeat?: Seat): void {
    const seatsPayload = room.seats.map((info) =>
      info ? { occupant: info.occupant ?? "human", nickname: info.nickname, ready: info.ready } : null,
    );
    room.seats.forEach((info, seat) => {
      if (!info || !info.connId) return;
      const payload: Record<string, unknown> = {
        gameId: room.gameId,
        code: room.code,
        hostSeat: room.hostSeat,
        seats: seatsPayload,
        // `info.playerToken` is only ever null for a bot seat, which never has a `connId` and so
        // never reaches this branch (host claims their own human seat via create/join) — the guard
        // is defensive, not load-bearing.
        ...(seat === justClaimedSeat && info.playerToken ? { you: { seat, playerToken: info.playerToken } } : {}),
      };
      hub.send(info.connId, { v: 1, type: "lobby.state", payload });
    });
  }

  function handleCreate(
    connId: ConnId,
    payload: { nickname: string; config: RoomConfig; password?: string },
  ): void {
    const passwordError = checkPassword(options.password, payload.password);
    if (passwordError) return sendError(connId, passwordError, "a valid server password is required");

    if (expansionUnavailable(payload.config)) {
      return sendError(connId, "EXPANSION_NOT_AVAILABLE", "requested player count or expansion is not shipped yet");
    }

    // T-901 (docs/07 D-034): `config.modifiers` validation mirrors `expansionUnavailable` above,
    // but delegates to the engine's own `resolveModules` — the single source of truth for both
    // "is this modifier known" and "does it conflict with the chosen expansion/other modifiers"
    // (`MODIFIER_INCOMPATIBLE`) — rather than re-deriving the compatibility matrix here.
    const moduleResult = resolveModules(payload.config);
    if (!moduleResult.ok) {
      return sendError(connId, moduleResult.error.code, moduleResult.error.message);
    }

    const gameId = generateGameId();
    const code = generateRoomCode(isCodeTaken);
    const seats: (SeatInfo | null)[] = new Array<SeatInfo | null>(payload.config.playerCount).fill(null);
    seats[0] = {
      occupant: "human",
      nickname: payload.nickname,
      playerToken: generatePlayerToken(),
      connId,
      ready: false,
    };

    const room: Room = {
      gameId,
      code,
      createdAt: Date.now(),
      config: payload.config,
      seats,
      hostSeat: 0,
      started: false,
    };
    rooms.set(gameId, room);
    codeToGameId.set(code, gameId);
    connSeats.set(connId, { gameId, seat: 0 });
    refreshEmptiness(room);
    broadcastLobbyState(room, 0);
  }

  function handleJoin(connId: ConnId, payload: { code: string; nickname: string; password?: string }): void {
    const passwordError = checkPassword(options.password, payload.password);
    if (passwordError) return sendError(connId, passwordError, "a valid server password is required");

    const gameId = codeToGameId.get(payload.code);
    const room = gameId ? rooms.get(gameId) : undefined;
    if (!room) return sendError(connId, "UNKNOWN_GAME", "no live room with that code (or it expired)");
    if (room.started) return sendError(connId, "ALREADY_STARTED", "this game has already started");

    const freeSeat = room.seats.findIndex((seat) => seat === null);
    if (freeSeat === -1) return sendError(connId, "LOBBY_FULL", "all seats are taken");

    const nicknameLower = payload.nickname.toLowerCase();
    // `seat.nickname` is `null` only for a bot seat (T-411 §1) — never a collision candidate.
    const taken = room.seats.some((seat) => seat?.nickname?.toLowerCase() === nicknameLower);
    if (taken) return sendError(connId, "NICKNAME_TAKEN", "that nickname is already used in this room");

    room.seats[freeSeat] = {
      occupant: "human",
      nickname: payload.nickname,
      playerToken: generatePlayerToken(),
      connId,
      ready: false,
    };
    connSeats.set(connId, { gameId: room.gameId, seat: freeSeat as Seat });
    refreshEmptiness(room);
    broadcastLobbyState(room, freeSeat as Seat);
  }

  function handleReady(connId: ConnId, payload: { ready: boolean }): void {
    const loc = connSeats.get(connId);
    if (!loc) return;
    const room = rooms.get(loc.gameId);
    const seatInfo = room?.seats[loc.seat];
    if (!room || !seatInfo) return;

    seatInfo.ready = payload.ready;
    broadcastLobbyState(room);
  }

  /**
   * T-411 §1/§2: host-only, pre-start, targets an empty seat within `config.playerCount`. A bot
   * seat needs no socket and no reconnect token; it's `ready: true` immediately (T-203's "ready to
   * start" check — `handleStart`'s `allSeatedAndReady` above — needs no bot-specific case because
   * of this). `nickname: null` — never a literal display string (cross-cutting i18n rule); the
   * client derives the localized "Bot" label from the seat index.
   */
  function handleAddBot(connId: ConnId, payload: { seat: Seat }): void {
    const loc = connSeats.get(connId);
    if (!loc) return;
    const room = rooms.get(loc.gameId);
    if (!room) return;

    if (loc.seat !== room.hostSeat) return sendError(connId, "NOT_HOST", "only the host can add a bot");
    if (room.started) return sendError(connId, "ALREADY_STARTED", "cannot add a bot after the game has started");
    if (payload.seat >= room.config.playerCount) {
      return sendError(connId, "SEAT_OUT_OF_RANGE", "seat is beyond this room's player count");
    }
    if (room.seats[payload.seat] !== null) {
      return sendError(connId, "SEAT_OCCUPIED", "that seat is already taken");
    }

    room.seats[payload.seat] = { occupant: "bot", nickname: null, playerToken: null, connId: null, ready: true };
    refreshEmptiness(room);
    broadcastLobbyState(room);
  }

  /** T-411 §1/§2: host-only, pre-start, frees a bot seat back to empty. Rejects a target that's
   *  already empty or that holds a human (removing a human is out of this task's scope). */
  function handleRemoveBot(connId: ConnId, payload: { seat: Seat }): void {
    const loc = connSeats.get(connId);
    if (!loc) return;
    const room = rooms.get(loc.gameId);
    if (!room) return;

    if (loc.seat !== room.hostSeat) return sendError(connId, "NOT_HOST", "only the host can remove a bot");
    if (room.started) return sendError(connId, "ALREADY_STARTED", "cannot remove a bot after the game has started");

    const seatInfo = room.seats[payload.seat];
    if (!seatInfo) return sendError(connId, "SEAT_EMPTY", "that seat is already empty");
    if (seatInfo.occupant !== "bot") return sendError(connId, "SEAT_NOT_BOT", "that seat is not a bot");

    room.seats[payload.seat] = null;
    refreshEmptiness(room);
    broadcastLobbyState(room);
  }

  function handleStart(connId: ConnId): void {
    const loc = connSeats.get(connId);
    if (!loc) return;
    const room = rooms.get(loc.gameId);
    if (!room) return;

    if (loc.seat !== room.hostSeat) return sendError(connId, "NOT_HOST", "only the host can start the game");

    // T-203 §3: "requires all config.playerCount seats filled & ready" — no error code is defined
    // for this precondition (only NOT_HOST is), so an unready `lobby.start` is a silent no-op; the
    // lobby UI is expected to only enable Start once every seat is ready (D-025).
    const allSeatedAndReady = room.seats.every((seat) => seat !== null && seat.ready);
    if (!allSeatedAndReady) return;

    room.started = true;
    startGame(room);
  }

  function handleRematch(connId: ConnId): void {
    const loc = connSeats.get(connId);
    if (!loc) return;
    const room = rooms.get(loc.gameId);
    if (!room) return;
    if (loc.seat !== room.hostSeat) return sendError(connId, "NOT_HOST", "only the host can start a rematch");
    // Only meaningful once the room has started; the session layer additionally guards that the
    // current game is actually FINISHED before recreating it (so this can't reset a live game).
    if (!room.started) return;
    onRematch?.(room);
  }

  // T-204: `game.action`/`chat.send`/`game.syncRequest` are dispatched to the session layer with
  // the seat already resolved from `connSeats` — same binding `lobby.ready`/`lobby.start` use, so
  // a message from a connection nobody ever seated (or that already disconnected) is a silent
  // no-op, exactly like the other handlers above.
  function handleGameAction(connId: ConnId, payload: { action: Action }): void {
    const loc = connSeats.get(connId);
    if (!loc) return;
    const room = rooms.get(loc.gameId);
    if (!room) return;
    options.onGameAction?.(room, loc.seat, connId, payload.action);
  }

  function handleChatSend(connId: ConnId, payload: { text: string }): void {
    const loc = connSeats.get(connId);
    if (!loc) return;
    const room = rooms.get(loc.gameId);
    if (!room) return;
    options.onChatSend?.(room, loc.seat, connId, payload.text);
  }

  function handleGameSyncRequest(connId: ConnId): void {
    const loc = connSeats.get(connId);
    if (!loc) return;
    const room = rooms.get(loc.gameId);
    if (!room) return;
    options.onGameSyncRequest?.(room, loc.seat, connId);
  }

  // T-205 §2: broadcasts `presence{seat, connected}` to every socket CURRENTLY bound in `room`
  // (never to `seat` itself — by the time this fires it's either not yet rebound, on disconnect,
  // or already the caller's own connId, on rejoin, which gets its state via `game.sync` instead).
  function broadcastPresence(room: Room, seat: Seat, connected: boolean): void {
    for (const info of room.seats) {
      if (info?.connId) hub.send(info.connId, { v: 1, type: "presence", payload: { seat, connected } });
    }
  }

  // T-205 §2: `game.rejoin{gameId, playerToken}` — a disconnected (or freshly refreshed) client
  // presenting the reconnect credential T-203 issued at seat claim. `UNKNOWN_GAME`/`BAD_TOKEN`
  // mirror `lobby.join`'s error shape; success rebinds the socket, evicts any zombie socket still
  // holding the seat, resends lobby context (seats/host/`you`, same payload `lobby.join` gets), and
  // lets the session layer answer with a fresh `game.sync` (docs/02 §7).
  function handleGameRejoin(connId: ConnId, payload: { gameId: string; playerToken: string }): void {
    const room = rooms.get(payload.gameId);
    if (!room) return sendError(connId, "UNKNOWN_GAME", "no live game with that id (or it expired)");

    const seat = findSeatByToken(room, payload.playerToken);
    if (seat === null) {
      return sendError(connId, "BAD_TOKEN", "player token does not match any seat in this game");
    }

    const seatInfo = room.seats[seat]!;
    const staleConnId = seatInfo.connId;
    if (staleConnId && staleConnId !== connId) {
      // A previous socket (e.g. a stale tab that never noticed the drop) is still bound to this
      // seat — repoint the bookkeeping first so the `onDisconnect` this eviction triggers is a
      // no-op, then actually close it.
      connSeats.delete(staleConnId);
      hub.disconnect(staleConnId);
    }

    seatInfo.connId = connId;
    connSeats.set(connId, { gameId: room.gameId, seat });
    refreshEmptiness(room);

    broadcastLobbyState(room, seat);
    broadcastPresence(room, seat, true);
    options.onGameRejoin?.(room, seat, connId);
  }

  const onMessage: MessageHandler = (connId, envelope) => {
    const parsed = parseClientMessage(envelope);
    if (!parsed.ok) {
      sendError(connId, parsed.code, parsed.detail);
      return;
    }

    switch (parsed.msg.type) {
      case "lobby.create":
        handleCreate(connId, parsed.msg.payload);
        break;
      case "lobby.join":
        handleJoin(connId, parsed.msg.payload);
        break;
      case "lobby.ready":
        handleReady(connId, parsed.msg.payload);
        break;
      case "lobby.start":
        handleStart(connId);
        break;
      case "lobby.rematch":
        handleRematch(connId);
        break;
      case "lobby.addBot":
        handleAddBot(connId, parsed.msg.payload);
        break;
      case "lobby.removeBot":
        handleRemoveBot(connId, parsed.msg.payload);
        break;
      case "game.action":
        handleGameAction(connId, parsed.msg.payload);
        break;
      case "chat.send":
        handleChatSend(connId, parsed.msg.payload);
        break;
      case "game.syncRequest":
        handleGameSyncRequest(connId);
        break;
      case "game.rejoin":
        handleGameRejoin(connId, parsed.msg.payload);
        break;
      default:
        break;
    }
  };

  // T-203 §3 (pre-start) / T-205 §1 (started): leaving pre-start frees the seat and migrates host;
  // an empty room starts its 30-min GC clock. Once `room.started`, a disconnect never frees the
  // seat or touches game state (D-020) — it only unbinds the socket and tells everyone else, so
  // `game.rejoin` can rebind the same seat later.
  const onDisconnect: DisconnectHandler = (connId) => {
    const loc = connSeats.get(connId);
    if (!loc) return;
    connSeats.delete(connId);

    const room = rooms.get(loc.gameId);
    if (!room) return;

    if (room.started) {
      const seatInfo = room.seats[loc.seat];
      // Guard `connId === seatInfo.connId`: a rejoin may already have repointed this seat to a
      // new connection (with this stale one evicted) before its own delayed `close` event lands.
      if (seatInfo && seatInfo.connId === connId) {
        seatInfo.connId = null;
        options.onGameDisconnect?.(room, loc.seat);
        broadcastPresence(room, loc.seat, false);
      }
      return;
    }

    room.seats[loc.seat] = null;
    if (loc.seat === room.hostSeat) {
      // T-411: host must migrate to a live HUMAN seat — a bot has no connection to host anything
      // (never mind claim a nonexistent socket), so it's never an eligible migration target.
      const nextHost = room.seats.findIndex((seat) => seat !== null && seat.occupant !== "bot");
      if (nextHost !== -1) room.hostSeat = nextHost as Seat;
    }
    refreshEmptiness(room);
    broadcastLobbyState(room);
  };

  hub.onMessage(onMessage);
  hub.onDisconnect(onDisconnect);

  return {
    rooms,
    close() {
      clearInterval(gcTimer);
    },
  };
}
