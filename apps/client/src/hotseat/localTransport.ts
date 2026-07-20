// src/hotseat/localTransport.ts (T-305): the hot-seat `GameTransport` (docs/02 §8, D-013) — runs
// the real engine in-browser instead of a ws socket, so a whole 4-seat game is playable from one
// tab with no server. `send(action)` always resolves the ACTING seat itself (turn owner, or the
// pending discarder/responder — `computeActiveSeat` below) rather than trusting a caller-supplied
// seat, exactly mirroring what a real client does: the human only ever "is" whichever seat
// currently owns the decision, regardless of which seat's camera happens to be on screen.
// `redact`/`redactEvent` (T-204, `@hexhaven/engine`) are reused verbatim for every message this
// transport emits — this file never reimplements hidden-information stripping.
//
// Extra methods beyond `GameTransport` (newGame/setViewedSeat/exportBundle/replayBundle/...) are the
// hot-seat harness's own admin surface. `HotseatPage` is the one place allowed to construct/hold
// this object directly — the same exception `bootstrap.ts` gets for the real ws transport (docs/02
// §8: "no component reads raw ws" holds for ordinary gameplay; the harness's admin controls are not
// ordinary gameplay). Every regular game action still flows through the store's `sendAction`/
// `setUiMode` once this transport is registered, exactly like the networked path.
import { createGame, reduce, redact, redactEvent } from '@hexhaven/engine';
import type { LoggedAction } from '@hexhaven/engine';
import type { GameConfig, GameState, Seat, ServerMessage } from '@hexhaven/shared';
import type { GameTransport } from '../store/transport';

export type TokenMethod = GameConfig['tokenMethod'];
/** Board-setup method (T-606): random shuffle vs the fixed Beginner board. */
export type BoardChoice = GameConfig['board'];
/** Hot-seat player count: 3/4 (base or Seafarers) plus the 5–6 extension seats (T-603/T-705). */
export type HotseatPlayerCount = 3 | 4 | 5 | 6;
/** 5–6 extra-building turn rule (X12), only meaningful at 5–6 players. */
export type FiveSixTurnRule = NonNullable<NonNullable<GameConfig['variants']>['fiveSixTurnRule']>;
/** Selected Seafarers scenario id, or `null` for a non-Seafarers game (T-705). */
export type SeafarersChoice = string | null;

/** Builds the engine config from the hot-seat knobs (requirement 3, extended by T-603 to cover the
 * 5–6 extension, T-806 to cover Cities & Knights): `playerCount` ≥ 5 turns the fiveSix module on and
 * selects the extra-build rule; at 4 the config is byte-identical to the base game (fiveSix off, no
 * `variants` — RK-13 holds). Cities & Knights (docs/rules/cities-knights-rules.md C12) is a 3–4p,
 * single-expansion-only game — it wins over both Seafarers and fiveSix when requested. */
function buildConfig(opts: {
  seed: string;
  tokenMethod: TokenMethod;
  playerCount: HotseatPlayerCount;
  turnRule: FiveSixTurnRule;
  board: BoardChoice;
  seafarers: SeafarersChoice;
  citiesKnights: boolean;
}): GameConfig {
  // C&K (T-806, C12): 3/4-player only, mutually exclusive with Seafarers and fiveSix.
  const citiesKnightsOn = opts.citiesKnights && (opts.playerCount === 3 || opts.playerCount === 4);
  // Seafarers (T-705): a 3/4-player scenario game, mutually exclusive with the 5–6 board and C&K.
  const seafarersOn = !citiesKnightsOn && opts.seafarers != null && (opts.playerCount === 3 || opts.playerCount === 4);
  const fiveSix = !citiesKnightsOn && !seafarersOn && opts.playerCount >= 5;
  // T-606: the fixed Beginner board is base-19 only; force Random at 5–6 (the engine rejects the
  // combo). At 4 players with board:'random' the config stays byte-identical to the base game.
  const board: BoardChoice = fiveSix ? 'random' : opts.board;
  return {
    playerCount: opts.playerCount,
    targetVp: 10,
    board,
    seed: opts.seed,
    tokenMethod: opts.tokenMethod,
    expansions: {
      fiveSix,
      seafarers: seafarersOn ? { scenario: opts.seafarers as string } : false,
      citiesKnights: citiesKnightsOn,
    },
    ...(fiveSix ? { variants: { fiveSixTurnRule: opts.turnRule } } : {}),
  };
}

/** The bug-report format (docs/02 §4: "Replay/repro = config + action log"), pinned to the exact
 * two config knobs this harness exposes plus the full seat+action trail. */
export interface ReproBundle {
  seed: string;
  tokenMethod: TokenMethod;
  /** Optional for back-compat with pre-T-603 bundles (absent → 4-player base game). */
  playerCount?: HotseatPlayerCount;
  turnRule?: FiveSixTurnRule;
  /** Optional for back-compat with pre-T-606 bundles (absent → random board). */
  board?: BoardChoice;
  /** Optional for back-compat with pre-T-705 bundles (absent → no Seafarers scenario). */
  seafarers?: SeafarersChoice;
  /** Optional for back-compat with pre-T-806 bundles (absent → not a C&K game). */
  citiesKnights?: boolean;
  actions: LoggedAction[];
}

export type ReplayResult = { ok: true; stateVersion: number } | { ok: false; error: string };

export interface LocalTransport extends GameTransport {
  getGameState(): GameState;
  getSeed(): string;
  getTokenMethod(): TokenMethod;
  getActionLog(): readonly LoggedAction[];
  /** Pushes the CURRENT state as a `game.started` message. Call exactly once, right after
   * subscribing via `onUpdate` — the constructor itself never emits, so nothing is lost between
   * "the game exists" and "someone is listening" (T-305 bootstrap ordering). */
  start(): void;
  getPlayerCount(): HotseatPlayerCount;
  getTurnRule(): FiveSixTurnRule;
  getBoard(): BoardChoice;
  getSeafarers(): SeafarersChoice;
  getCitiesKnights(): boolean;
  /** Resets to a brand-new game (requirement 3's "new game" control) — defaults to a fresh random
   * seed and keeps the current token method / player count / turn rule / scenario unless overridden.
   * At ≥5 players the 5–6 extension turns on; a Seafarers scenario at 3–4 turns Seafarers on (T-705);
   * Cities & Knights at 3–4 turns C&K on (T-806) and wins over both when requested (C12). */
  newGame(opts?: {
    seed?: string;
    tokenMethod?: TokenMethod;
    playerCount?: HotseatPlayerCount;
    turnRule?: FiveSixTurnRule;
    board?: BoardChoice;
    seafarers?: SeafarersChoice;
    citiesKnights?: boolean;
  }): void;
  /** Switches which seat's redacted view sits in the store (requirement 2's manual override tabs).
   * Purely a camera move — the next `send`/bot action still auto-follows the real actor. */
  setViewedSeat(seat: Seat): void;
  exportBundle(): ReproBundle;
  replayBundle(bundle: ReproBundle): ReplayResult;
}

/** Whichever seat must act right now (requirement 2: "turn owner, or pending discarder/
 * responder"): a still-pending discarder first (R6.1), else an unresponded seat while a domestic
 * trade offer is open (R8.1), else the turn owner. Mirrors `packages/engine/src/sim/runGame.ts`'s
 * `nextActor` — engine-internal and not exported across the package boundary, so this harness
 * re-derives the same single-actor-at-a-time resolution the sim bot itself relies on. Exported so
 * both `src/hotseat/bot.ts` and this module's own tests can reuse the exact same logic. */
export function computeActiveSeat(state: GameState): Seat {
  if (state.phase.kind === 'discard') {
    const seat = state.phase.pending[0];
    if (seat === undefined) throw new Error('BUG: discard phase entered with no pending seats');
    return seat;
  }
  // 5–6 SBP (X12): the special builder acts while `turn.player` is the seat whose turn just ended
  // (mirrors sim/runGame.ts's `nextActor`). Paired Players makes `turn.player` the paired builder,
  // so it falls through to the base return.
  if (state.phase.kind === 'specialBuild') return state.phase.builder;
  // Caravans (§TB4.2, T-1004): `caravanVote`'s `pending` list is EVERY seat (builder first) — the
  // builder is frequently NOT the acting seat once they've already bid, and the vote's winner
  // (once `pending` is empty) is often not `turn.player` either. Without this case the fallback
  // below always returned `turn.player`, which stops being a pending bidder the moment they bid —
  // stranding the vote (nobody else ever gets auto-followed/driven) — the bug this case fixes.
  if (state.phase.kind === 'caravanVote') {
    const phase = state.phase;
    if (phase.pending.length > 0) return phase.pending[0]!;
    if (phase.winner !== null) return phase.winner;
    // The engine resolves an all-abstain vote (maxBid === 0) straight back to `main` instead of
    // leaving a winner-less `caravanVote` phase (caravans.ts's own `caravanVoteHandler`), so a
    // `caravanVote` phase with no pending bidders always has a resolved winner — unreachable.
    throw new Error('BUG: caravanVote phase has no pending bidders and no winner');
  }
  if (state.phase.kind === 'main' && state.trade != null) {
    const owner = state.turn.player;
    const trade = state.trade;
    const responder = state.players.map((p) => p.seat).find((s) => s !== owner && trade.responses[s] === undefined);
    if (responder !== undefined) return responder;
  }
  return state.turn.player;
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createLocalTransport(
  opts: {
    seed?: string;
    tokenMethod?: TokenMethod;
    playerCount?: HotseatPlayerCount;
    turnRule?: FiveSixTurnRule;
    board?: BoardChoice;
    seafarers?: SeafarersChoice;
    citiesKnights?: boolean;
  } = {},
): LocalTransport {
  let seed = opts.seed ?? randomSeed();
  let tokenMethod: TokenMethod = opts.tokenMethod ?? 'spiral';
  let playerCount: HotseatPlayerCount = opts.playerCount ?? 4;
  let turnRule: FiveSixTurnRule = opts.turnRule ?? 'sbp';
  let board: BoardChoice = opts.board ?? 'random';
  let seafarers: SeafarersChoice = opts.seafarers ?? null;
  let citiesKnights = opts.citiesKnights ?? false;
  let state: GameState = createGame(
    buildConfig({ seed, tokenMethod, playerCount, turnRule, board, seafarers, citiesKnights }),
  );
  let viewedSeat: Seat = 0 as Seat;
  let log: LoggedAction[] = [];

  const subscribers = new Set<(msg: ServerMessage) => void>();
  function emit(msg: ServerMessage): void {
    for (const cb of subscribers) cb(msg);
  }
  function pushView(type: 'game.started' | 'game.sync'): void {
    const payload = redact(state, viewedSeat);
    if (type === 'game.started') emit({ v: 1, type: 'game.started', payload });
    else emit({ v: 1, type: 'game.sync', payload });
  }

  return {
    getGameState: () => state,
    getSeed: () => seed,
    getTokenMethod: () => tokenMethod,
    getPlayerCount: () => playerCount,
    getTurnRule: () => turnRule,
    getBoard: () => board,
    getSeafarers: () => seafarers,
    getCitiesKnights: () => citiesKnights,
    getActionLog: () => log,

    start() {
      pushView('game.started');
    },

    newGame(nextOpts = {}) {
      seed = nextOpts.seed ?? randomSeed();
      tokenMethod = nextOpts.tokenMethod ?? tokenMethod;
      playerCount = nextOpts.playerCount ?? playerCount;
      turnRule = nextOpts.turnRule ?? turnRule;
      board = nextOpts.board ?? board;
      seafarers = nextOpts.seafarers !== undefined ? nextOpts.seafarers : seafarers;
      citiesKnights = nextOpts.citiesKnights !== undefined ? nextOpts.citiesKnights : citiesKnights;
      state = createGame(
        buildConfig({ seed, tokenMethod, playerCount, turnRule, board, seafarers, citiesKnights }),
      );
      viewedSeat = 0 as Seat;
      log = [];
      pushView('game.started');
    },

    setViewedSeat(seat) {
      viewedSeat = seat;
      pushView('game.sync');
    },

    send(action) {
      const actor = computeActiveSeat(state);
      const result = reduce(state, actor, action);
      if (!result.ok) {
        // The standard `game.error` toast path (store/index.ts's dispatcher) — never thrown.
        emit({ v: 1, type: 'game.error', payload: result.error });
        return;
      }
      state = result.state;
      log = [...log, { seat: actor, action }];
      viewedSeat = computeActiveSeat(state); // requirement 2: auto-follow after every action
      emit({
        v: 1,
        type: 'game.events',
        payload: {
          events: result.events.map((e) => redactEvent(e, viewedSeat)),
          stateVersion: state.stateVersion,
          view: redact(state, viewedSeat),
        },
      });
    },

    // Hot-seat has no lobby/chat surface — both are safe no-ops so this object still satisfies
    // `GameTransport` for any store code that addresses it generically.
    sendLobby() {
      /* no-op: hot-seat has no lobby */
    },
    sendChat() {
      /* no-op: hot-seat has no chat */
    },

    onUpdate(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },

    exportBundle() {
      return { seed, tokenMethod, playerCount, turnRule, board, seafarers, citiesKnights, actions: log };
    },

    replayBundle(bundle) {
      const bundlePlayerCount = bundle.playerCount ?? 4;
      const bundleTurnRule = bundle.turnRule ?? 'sbp';
      const bundleBoard = bundle.board ?? 'random';
      const bundleSeafarers = bundle.seafarers ?? null;
      const bundleCitiesKnights = bundle.citiesKnights ?? false;
      let replay: GameState;
      try {
        replay = createGame(
          buildConfig({
            seed: bundle.seed,
            tokenMethod: bundle.tokenMethod,
            playerCount: bundlePlayerCount,
            turnRule: bundleTurnRule,
            board: bundleBoard,
            seafarers: bundleSeafarers,
            citiesKnights: bundleCitiesKnights,
          }),
        );
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      for (let i = 0; i < bundle.actions.length; i++) {
        const entry = bundle.actions[i]!;
        const result = reduce(replay, entry.seat, entry.action);
        if (!result.ok) {
          return {
            ok: false,
            error: `action ${i} (seat ${entry.seat} ${JSON.stringify(entry.action)}) failed: ${result.error.code} ${result.error.message}`,
          };
        }
        replay = result.state;
      }
      seed = bundle.seed;
      tokenMethod = bundle.tokenMethod;
      playerCount = bundlePlayerCount;
      turnRule = bundleTurnRule;
      board = bundleBoard;
      seafarers = bundleSeafarers;
      citiesKnights = bundleCitiesKnights;
      state = replay;
      log = [...bundle.actions];
      viewedSeat = computeActiveSeat(state);
      pushView('game.started');
      return { ok: true, stateVersion: state.stateVersion };
    },
  };
}
