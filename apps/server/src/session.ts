// T-204: the authoritative game loop (docs/02-architecture.md §4/§6/§7). This module holds the
// per-room `GameState`, validates/applies every `game.action` via the engine's pure `reduce`, and
// fans out per-seat REDACTED views + events — this file (together with `redact.ts` in the engine)
// is the entire cheat-proofing boundary: a socket never receives anything but its own seat's
// `redact()`/`redactEvent()` output.
//
// Wired as `apps/server/src/lobby.ts`'s `startGame`/`onGameAction`/`onChatSend`/
// `onGameSyncRequest` hooks (see index.ts) — this module never touches the ws hub's message
// routing or the lobby's seat bookkeeping directly; `lobby.ts` resolves `connId -> (room, seat)`
// (the same binding established at `lobby.create`/`lobby.join`, which IS the auth check — there is
// no separate per-message token; rejoin/reconnect is T-205) and calls in here with the result.

import { nanoid } from "nanoid";
import { chooseAction, createGame, DEFAULT_BUDGET, enumerateCandidates, reduce, redact, redactEvent } from "@hexhaven/engine";
import {
  TARGET_VP,
  type Action,
  type EngineErrorCode,
  type GameConfig,
  type GameState,
  type ProtocolErrorCode,
  type Seat,
} from "@hexhaven/shared";
import type { ConnId, WsHub } from "./wsHub.js";
import type { Room } from "./lobby.js";
import { allSeatsDisconnected } from "./reconnect.js";
import { createTurnTimers, type TurnTimers } from "./timers.js";
import { nextBotActor } from "./botDrive.js";

export interface SessionLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const NOOP_LOGGER: SessionLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** T-204 §2: `{ state, actionLog, room }` per started room, keyed by `gameId`. */
export interface GameSession {
  room: Room;
  state: GameState;
  actionLog: { seat: Seat; action: Action }[];
  /** Set once the game reaches `phase.kind === 'ended'` — drives the 1h GC sweep (docs/02 §7). */
  finishedAt: number | null;
  /**
   * T-205 §5: timestamp of the GC tick that first found EVERY seat unbound (`null` while at least
   * one is connected). A separate, independent-of-`finishedAt` sweep purges the session once this
   * has held for `allDisconnectedTtlMs` (default 30 min) — "everyone left and never came back".
   */
  allDisconnectedSince: number | null;
}

export interface GameSessionsOptions {
  logger?: SessionLogger;
  /** Finished-session GC sweep cadence. Defaults to 10 min; tests shrink this to avoid real waits. */
  gcIntervalMs?: number;
  /** How long a finished session survives before GC deletes it. Defaults to 1h (docs/02 §7). */
  finishedTtlMs?: number;
  /**
   * T-205 §5: how long a started (unfinished) session survives once EVERY seat is disconnected.
   * Defaults to 30 min. Distinct from `finishedTtlMs` — this fires even mid-game, for "everyone
   * walked away and nobody rejoined".
   */
  allDisconnectedTtlMs?: number;
  /**
   * T-411 §3: fixed delay before each auto-driven bot move is computed & applied, so bot turns are
   * watchable in real play instead of resolving a whole game instantly. Deliberately a fixed
   * number, never `Math.random`/derived from `Date.now()` — the "deterministic/seeded so tests are
   * stable" requirement is met simply by it not depending on wall-clock jitter at all. Defaults to
   * 900ms (midpoint of the task's ~600-1200ms "for feel" range); tests set `0` for a synchronous,
   * instant auto-drive loop.
   */
  botThinkDelayMs?: number;
  /**
   * T-411 §3: search budget passed to `chooseAction` for every auto-driven bot move. Defaults to
   * the engine's production `DEFAULT_BUDGET` (240); tests shrink this (mirroring T-410's own
   * `TEST_BUDGET`) to keep the suite fast.
   */
  botBudget?: number;
  /**
   * Fixed game seed for the board + dice RNG. Production leaves this undefined so every game gets a
   * fresh `nanoid()` seed; TESTS pin it so a scripted game is fully deterministic (otherwise a random
   * board can push an unlucky random-driver game past a fixed action cap — a flaky test). Falls back
   * to the `HEXHAVEN_TEST_SEED` env var (T-501 cross-task edit) so the E2E harness can pin the seed of
   * the real, built server binary it spawns as a subprocess — that path has no way to pass a
   * `GameSessionsOptions` object directly, only environment variables (docs/12: `pnpm -w e2e` builds
   * the client, boots the real server, then scripts clicks against a board whose setup-placement
   * legal-target sequence must be identical every run — the whole basis of the zero-flake policy in
   * T-501 §6). Still never read inside `packages/engine` itself (engine purity, docs/05 §2) — only
   * here, at the server's own config boundary.
   */
  seed?: string;
}

export interface GameSessions {
  /** Exposed read-only for tests/PM review, keyed by `gameId`. */
  sessions: ReadonlyMap<string, GameSession>;
  /** `lobby.ts`'s `startGame` hook: creates the engine game and sends each seat `game.started`. */
  startGame(room: Room): void;
  /** "Play again": recreate a fresh game for the same room + occupants, but ONLY if the current
   * game has finished (guards against resetting a live game). Re-broadcasts `game.started`. */
  rematch(room: Room): void;
  /** `lobby.ts`'s `onGameAction` hook. */
  handleGameAction(room: Room, seat: Seat, connId: ConnId, action: Action): void;
  /** `lobby.ts`'s `onChatSend` hook — chat is lobby-level too, so this works pre- and mid-game. */
  handleChatSend(room: Room, seat: Seat, connId: ConnId, text: string): void;
  /** `lobby.ts`'s `onGameSyncRequest` hook. */
  handleGameSyncRequest(room: Room, seat: Seat, connId: ConnId): void;
  /**
   * T-206: called whenever a seat's live connection changes for an already-started room —
   * `lobby.ts`'s disconnect handler and `game.rejoin` handler both call this (wired in index.ts) —
   * so the turn-timer manager can re-derive whether the currently-pending seat's deadline should
   * be `turnSeconds` or the disconnect-shortened `decisionSeconds` (task §4). A no-op if timers are
   * flag-off or there's no live session yet.
   */
  notifyConnectivityChanged(room: Room): void;
  /** Stops the GC interval. Call from test teardown / server shutdown. */
  close(): void;
}

const DEFAULT_GC_INTERVAL_MS = 10 * 60_000;
const DEFAULT_FINISHED_TTL_MS = 60 * 60_000;
const DEFAULT_ALL_DISCONNECTED_TTL_MS = 30 * 60_000;
/** T-411 §3: fixed per-move bot "think" delay default — see `GameSessionsOptions.botThinkDelayMs`. */
const DEFAULT_BOT_THINK_DELAY_MS = 900;
/**
 * T-411 §3 loop-guard: a bot must always produce a legal move (T-410's contract), so a single
 * continuous bot-driven stretch (however many bot turns run back-to-back before control returns to
 * a human) should never come close to this many steps in practice — a full 4-player game runs well
 * under it (docs/03 §7 invariant I10 caps a whole game at 4,000 actions). Tripping it means a real
 * bug (T-410 returning an action `reduce` rejects, or the two modules disagreeing about legality),
 * never ordinary play — logged loudly rather than looping forever.
 */
const MAX_AUTO_DRIVE_STEPS = 4000;

/** Every currently-connected `(seat, connId)` pair for `room` — disconnected seats are skipped. */
function connectedSeats(room: Room): { seat: Seat; connId: ConnId }[] {
  const out: { seat: Seat; connId: ConnId }[] = [];
  room.seats.forEach((info, index) => {
    if (info?.connId) out.push({ seat: index as Seat, connId: info.connId });
  });
  return out;
}

/** Builds `apps/server`'s game-session layer, bound to `hub` for sending. */
export function createGameSessions(hub: WsHub, options: GameSessionsOptions = {}): GameSessions {
  const logger = options.logger ?? NOOP_LOGGER;
  const gcIntervalMs = options.gcIntervalMs ?? DEFAULT_GC_INTERVAL_MS;
  const finishedTtlMs = options.finishedTtlMs ?? DEFAULT_FINISHED_TTL_MS;
  const allDisconnectedTtlMs = options.allDisconnectedTtlMs ?? DEFAULT_ALL_DISCONNECTED_TTL_MS;

  const sessions = new Map<string, GameSession>();

  // T-206: turn timers & auto-actions, flag-gated on `room.config.timers.timers` (D-020) — see
  // timers.ts's header for the full reconcile/diff model. `applyAutoAction` is the callback the
  // timer manager uses to actually commit an expired-decision's deterministic action; it shares
  // `runAction` (below) with the real `handleGameAction` path so both go through the identical
  // reduce -> mutate -> broadcast pipeline.
  const timers: TurnTimers = createTurnTimers({
    hub,
    sessions,
    logger,
    applyAction(gameId, seat, action) {
      const session = sessions.get(gameId);
      if (!session) return false;
      const outcome = runAction(session, seat, action);
      if (!outcome.ok) {
        logger.error(
          { gameId, seat, actionType: action.type, code: outcome.error.code },
          "T-206: auto-action was rejected by the engine (BUG: should always be legal)"
        );
        return false;
      }
      // T-411 §3: a timer-expiry auto-action (always a HUMAN seat — see this task's Implementation
      // notes on why a bot's own clock never fires) can still hand the next decision to a bot seat.
      driveBots(session);
      return true;
    },
  });

  /**
   * Shared core of "apply one engine action to a live session": reduce -> mutate `session.state`
   * -> append to `actionLog` -> broadcast `game.events` to every connected seat -> flip
   * `finishedAt` once. Used by both `handleGameAction` (a real player action; the caller relays a
   * failure to `connId` as `game.error`) and the timer manager's auto-actions (a failure there is
   * only ever a `BUG:`, logged by the caller, never surfaced to any socket since no player caused
   * it). Callers own scheduling the T-206 timer reconcile afterwards — this function never touches
   * timers itself, so it stays a pure "one accepted action" primitive.
   */
  function runAction(
    session: GameSession,
    seat: Seat,
    action: Action
  ): { ok: true } | { ok: false; error: { code: EngineErrorCode | ProtocolErrorCode; message: string } } {
    const room = session.room;
    let result: ReturnType<typeof reduce>;
    try {
      result = reduce(session.state, seat, action);
    } catch (err) {
      // Engine game-rule violations are coded returns, never throws (docs/05 §2) — a throw here
      // is a `BUG:` programmer error. Never let it crash the process or the ws connection.
      logger.error(
        { gameId: room.gameId, seat, actionType: action.type, err },
        "reduce() threw unexpectedly"
      );
      return { ok: false, error: { code: "BAD_ACTION", message: "internal error processing action" } };
    }

    if (!result.ok) {
      logger.warn(
        { gameId: room.gameId, seat, actionType: action.type, code: result.error.code },
        "action rejected"
      );
      return { ok: false, error: result.error };
    }

    session.state = result.state;
    session.actionLog.push({ seat, action });
    logger.info(
      { gameId: room.gameId, seat, actionType: action.type, stateVersion: session.state.stateVersion },
      "action accepted"
    );

    for (const { seat: viewerSeat, connId: viewerConn } of connectedSeats(room)) {
      hub.send(viewerConn, {
        v: 1,
        type: "game.events",
        payload: {
          events: result.events.map((ev) => redactEvent(ev, viewerSeat)),
          stateVersion: session.state.stateVersion,
          view: redact(session.state, viewerSeat),
        },
      });
    }

    if (session.state.phase.kind === "ended" && session.finishedAt === null) {
      session.finishedAt = Date.now();
      logger.info({ gameId: room.gameId, winner: session.state.phase.winner }, "game session finished");
    }

    return { ok: true };
  }

  // T-411 §3: server-side bot auto-drive. `botDriveActive`/`botDriveSteps` are keyed by `gameId`
  // rather than stored on `GameSession` so this stays a self-contained addition — nothing about the
  // exported `GameSession` shape (used by tests/PM review elsewhere) changes for this task.
  const botThinkDelayMs = options.botThinkDelayMs ?? DEFAULT_BOT_THINK_DELAY_MS;
  const botBudget = options.botBudget ?? DEFAULT_BUDGET;
  const botDriveActive = new Set<string>();
  const botDriveSteps = new Map<string, number>();

  /**
   * Runs ONE bot decision for `seat` in `session`, then (on success) hands off to
   * `continueDrivingBots` for whatever's next. `redact(session.state, seat)` is the bot's ONLY
   * input — exactly the boundary a real player's client would see — so a bot can never act on
   * hidden information (T-410's fairness contract carried through to the server). The rng
   * `chooseAction` returns (consumed by its own determinization sampling) becomes the new
   * authoritative `state.rng` BEFORE `runAction`/`reduce` runs, so the actual outcome of a
   * subsequent stochastic action (e.g. the dice roll `rollDice` triggers) is never the same draw
   * the bot's search already peeked at.
   */
  /** A safe legal action for `seat` in the REAL state, used only to recover from a bot-search failure
   *  (see `run`). Prefers a terminal action (end turn / pass) so the recovery just advances play;
   *  excludes `offerTrade`/`confirmTrade` (bots never initiate/confirm domestic trades, B-21). `null`
   *  only if the seat genuinely has no legal action (should never happen for a seat we were driving). */
  function fallbackBotAction(state: GameState, seat: Seat): Action | null {
    const cands = enumerateCandidates(state, seat).filter(
      (a) => a.type !== "offerTrade" && a.type !== "confirmTrade"
    );
    if (cands.length === 0) return null;
    return cands.find((a) => a.type === "endTurn" || a.type === "passSpecialBuild") ?? cands[0]!;
  }

  function scheduleBotTurn(session: GameSession, seat: Seat): void {
    const gameId = session.room.gameId;

    function run(): void {
      let applied = false;
      try {
        const view = redact(session.state, seat);
        const { action, rng } = chooseAction(view, session.state.rng, { budget: botBudget });
        session.state = { ...session.state, rng };

        let outcome = runAction(session, seat, action);
        if (!outcome.ok) {
          // A bot `confirmTrade` legitimately fails CANT_AFFORD when the accepter's real hidden hand
          // doesn't match the bot's determinization guess (it decided from its redacted view). That's
          // not a bug — recover by cancelling the now-unfulfillable offer so the turn still moves on.
          if (action.type === "confirmTrade" && outcome.error.code === "CANT_AFFORD" && session.state.trade != null) {
            outcome = runAction(session, seat, { type: "cancelTrade" });
          }
        }
        if (outcome.ok) {
          applied = true;
        } else {
          logger.error(
            { gameId, seat, actionType: action.type, code: outcome.error.code },
            "T-411: bot produced an action the engine rejected — falling back to a legal move"
          );
        }
      } catch (err) {
        // `chooseAction`'s contract is to always return a legal move; a throw is a T-410 bug (a
        // determinized-search edge case — e.g. a rollout reaching an inconsistent hidden state).
        logger.error({ gameId, seat, err }, "T-411: chooseAction threw — falling back to a legal move");
      }

      // RESILIENCE (never hang a live game on a bot bug): if the search failed or produced an illegal
      // move, apply a safe legal move computed from the REAL state. The server is authoritative and
      // has full info, so `enumerateCandidates` here always yields a genuinely legal action; we prefer
      // a terminal one (end turn / pass) so the recovery is harmless rather than a wasteful build.
      if (!applied) {
        const fb = fallbackBotAction(session.state, seat);
        if (fb && runAction(session, seat, fb).ok) {
          applied = true;
        } else {
          logger.error({ gameId, seat }, "T-411: no legal fallback action for a bot — drive halted");
          botDriveActive.delete(gameId);
          return;
        }
      }

      timers.onActionApplied(gameId, seat);
      continueDrivingBots(session);
    }

    // ALWAYS via `setTimeout` — even at the test default of 0ms — never a direct synchronous call.
    // A long stretch of bot-only turns (up to this task's own loop-guard cap) would otherwise grow
    // ONE JS call stack by a frame per action (`run` -> `continueDrivingBots` -> `scheduleBotTurn`
    // -> `run` -> …); scheduling every step as its own macrotask keeps each step's stack shallow
    // regardless of how many bot actions run back-to-back before a human (or nobody, if a room is
    // ever all-bot) gets control back. `setTimeout(fn, 0)` still fires on the very next tick with no
    // real wall-clock wait, so this costs tests nothing but an `await`/fake-timer flush.
    const handle = setTimeout(run, Math.max(0, botThinkDelayMs));
    handle.unref?.();
  }

  /** Re-checks `nextBotActor` against the CURRENT session state and either stops (game ended / a
   *  human is next) or schedules the next bot move. Also enforces the loop-guard. */
  function continueDrivingBots(session: GameSession): void {
    const gameId = session.room.gameId;
    if (session.state.phase.kind === "ended") {
      botDriveActive.delete(gameId);
      botDriveSteps.delete(gameId);
      return;
    }
    const seat = nextBotActor(session.room, session.state);
    if (seat === null) {
      botDriveActive.delete(gameId);
      botDriveSteps.delete(gameId);
      return;
    }

    const steps = (botDriveSteps.get(gameId) ?? 0) + 1;
    if (steps > MAX_AUTO_DRIVE_STEPS) {
      logger.error({ gameId, seat, steps }, "T-411: bot auto-drive loop-guard tripped (BUG)");
      botDriveActive.delete(gameId);
      botDriveSteps.delete(gameId);
      return;
    }
    botDriveSteps.set(gameId, steps);
    scheduleBotTurn(session, seat);
  }

  /**
   * Entry point called after every applied action (real, timer-auto, or the game's initial start):
   * kicks off auto-drive if the next actor is a bot and nothing is already driving this session. A
   * no-op if a drive loop for this `gameId` is already in flight — that loop re-reads
   * `session.state` fresh on every step, so it always picks up whatever the caller just applied.
   */
  function driveBots(session: GameSession): void {
    const gameId = session.room.gameId;
    if (botDriveActive.has(gameId)) return;
    if (session.state.phase.kind === "ended") return;
    const seat = nextBotActor(session.room, session.state);
    if (seat === null) return;

    botDriveActive.add(gameId);
    botDriveSteps.set(gameId, 0);
    scheduleBotTurn(session, seat);
  }

  function startGame(room: Room): void {
    // R14 config (docs/03 §3): `lobby.ts`'s `expansionUnavailable` gate already rejected any
    // unshipped expansion/player-count at `lobby.create` time, so `room.config.expansions` only ever
    // carries SHIPPED combos here (base, 5–6, or a 3–4 Seafarers scenario). The expansions object is
    // forwarded verbatim; for a Seafarers scenario `createGame` derives the board and overrides
    // `targetVp` with the scenario's own target (14 for "Heading for New Shores", S10.1).
    const config: GameConfig = {
      playerCount: room.config.playerCount,
      // Production is always R13's 10. `HEXHAVEN_TARGET_VP` (E2E only, same env-hook rationale as the
      // seed below) lets the e2e harness lower it so a scripted game reaches `gameWon` in a few
      // turns — setup already grants 2 VP, so e.g. 4 ends quickly — instead of a multi-minute full
      // game. Never read in `packages/engine` (purity); only here at the server config boundary.
      targetVp: Number(process.env.HEXHAVEN_TARGET_VP) || TARGET_VP,
      seed: options.seed ?? process.env.HEXHAVEN_TEST_SEED ?? nanoid(),
      // T-606: board-setup method from the lobby (Random vs fixed Beginner). Absent → 'random'
      // (historical default; keeps pre-T-606 rooms byte-identical). The engine rejects
      // 'beginner' + fiveSix, which the lobby UI already prevents.
      board: room.config.board ?? "random",
      tokenMethod: "spiral",
      expansions: room.config.expansions,
      // T-602: forward the optional rule selector (inert unless fiveSix is on). Omitted for base
      // lobbies, so base config/state stays byte-for-byte what it was.
      ...(room.config.variants ? { variants: room.config.variants } : {}),
      // T-901 (docs/07 D-034): forward the lobby's Modifiers selection — `lobby.ts`'s
      // `resolveModules` call already rejected an unknown/incompatible combo at `lobby.create`
      // time, so whatever reaches here is legal. Omitted for a lobby with no modifiers enabled,
      // so base/expansion-only config/state stays byte-for-byte what it was (RK-13).
      ...(room.config.modifiers ? { modifiers: room.config.modifiers } : {}),
    };
    const state = createGame(config);
    const session: GameSession = { room, state, actionLog: [], finishedAt: null, allDisconnectedSince: null };
    sessions.set(room.gameId, session);

    for (const { seat, connId } of connectedSeats(room)) {
      hub.send(connId, { v: 1, type: "game.started", payload: redact(state, seat) });
    }
    logger.info({ gameId: room.gameId, playerCount: config.playerCount }, "game session started");
    timers.onSessionStarted(room.gameId);
    // T-411 §3: covers the (unusual, but not impossible in a crafted room) case where the very
    // first actor is already a bot seat — e.g. a test room seated with bots from position 0.
    driveBots(session);
  }

  function rematch(room: Room): void {
    const existing = sessions.get(room.gameId);
    // Only a FINISHED game may be replayed — never reset a game still in progress.
    if (!existing || existing.state.phase.kind !== "ended") return;
    startGame(room); // fresh board/game for the same gameId + occupants (incl. bots); re-broadcasts game.started
  }

  function handleGameAction(room: Room, seat: Seat, connId: ConnId, action: Action): void {
    const session = sessions.get(room.gameId);
    if (!session) return; // no live session for this room (shouldn't happen; defensive no-op)

    const outcome = runAction(session, seat, action);
    if (!outcome.ok) {
      hub.send(connId, { v: 1, type: "game.error", payload: outcome.error });
      return;
    }
    timers.onActionApplied(room.gameId, seat);
    // T-411 §3: a human's action may hand the very next decision to a bot seat (turn passes to a
    // bot, or a bot now owes a discard/trade response) — keep driving until control is human again.
    driveBots(session);
  }

  function notifyConnectivityChanged(room: Room): void {
    timers.onConnectivityChanged(room.gameId);
  }

  function handleChatSend(room: Room, seat: Seat, _connId: ConnId, text: string): void {
    const seatInfo = room.seats[seat];
    if (!seatInfo) return; // BUG-defensive: seat resolved by lobby.ts must be occupied
    for (const { connId: viewerConn } of connectedSeats(room)) {
      hub.send(viewerConn, {
        v: 1,
        type: "chat.message",
        payload: { seat, nickname: seatInfo.nickname, text },
      });
    }
  }

  function handleGameSyncRequest(room: Room, seat: Seat, connId: ConnId): void {
    const session = sessions.get(room.gameId);
    if (!session) return;
    hub.send(connId, { v: 1, type: "game.sync", payload: redact(session.state, seat) });
  }

  const gcTimer = setInterval(() => {
    const now = Date.now();
    for (const [gameId, session] of sessions) {
      if (session.finishedAt !== null && now - session.finishedAt >= finishedTtlMs) {
        timers.clearAll(gameId);
        sessions.delete(gameId);
        continue;
      }

      // T-205 §5: everyone-away purge, independent of `finishedAt` — tracks how long EVERY seat
      // has been continuously unbound across GC ticks (reset the moment anyone reconnects).
      if (allSeatsDisconnected(session.room)) {
        if (session.allDisconnectedSince === null) {
          session.allDisconnectedSince = now;
        } else if (now - session.allDisconnectedSince >= allDisconnectedTtlMs) {
          timers.clearAll(gameId);
          sessions.delete(gameId);
        }
      } else {
        session.allDisconnectedSince = null;
      }
    }
  }, gcIntervalMs);
  gcTimer.unref();

  return {
    sessions,
    startGame,
    rematch,
    handleGameAction,
    handleChatSend,
    handleGameSyncRequest,
    notifyConnectivityChanged,
    close() {
      clearInterval(gcTimer);
      timers.closeAll();
    },
  };
}
