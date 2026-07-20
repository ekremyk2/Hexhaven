// T-204 §4/§5 — the acceptance core: a scripted game driven over REAL ws connections against a
// REAL server (http + wsHub + lobby + session, exactly as `startServer` wires them in production),
// asserting that every single frame any of the 4 sockets ever receives is free of hidden
// information belonging to another seat.
//
// The bot deciding each move is deliberately NOT the client's — a real client only ever has its
// own redacted `PlayerView`, which can't drive full legality checks for other seats' turns. This
// harness instead reads the TRUE `GameState` directly from the in-process `handle.sessions` map
// (the test is embedding the real server in the same Node process, so this is a legitimate
// "test oracle", not a client capability) purely to script which legal action to send next; the
// actual WS traffic, and everything asserted on, is exactly what a real client would receive.
// The decision logic reuses the engine's own PUBLIC legal-move enumerators (the same primitives
// T-112's bot is built from — `sim/bot.ts` itself is intentionally not exported from
// `@hexhaven/engine`'s public API, so it can't be imported outside the engine package).

import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { COSTS, hasAtLeast } from "@hexhaven/shared";
import type { Action, GameState, ResourceBundle, ResourceType, Seat } from "@hexhaven/shared";
import {
  hashSeed,
  pickIndex,
  legalSetupSettlements,
  legalSetupRoads,
  legalRoadEdges,
  legalSettlementVertices,
  legalCityVertices,
  legalRobberHexes,
  stealCandidates,
  buildAffordability,
  bankTradeOptions,
} from "@hexhaven/engine";
import { startServer, type ServerHandle } from "./index.js";

const RESOURCE_TYPES: readonly ResourceType[] = ["brick", "lumber", "wool", "grain", "ore"];

// ---- ws test plumbing (same pattern as lobby.test.ts) ------------------------------------------

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

function send(socket: WebSocket, envelope: unknown): void {
  socket.send(JSON.stringify(envelope));
}

function baseConfig(playerCount: 4 = 4) {
  return {
    playerCount,
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    timers: { timers: false, turnSeconds: 120, decisionSeconds: 45 },
  };
}

// ---- structural leak assertions -----------------------------------------------------------------

/** Every dot-joined path in `value` whose final key is exactly `key`, walking arrays too. */
function findKeyPaths(value: unknown, key: string, path = ""): string[] {
  if (value === null || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${k}` : k;
    if (k === key) out.push(here);
    out.push(...findKeyPaths(v, key, here));
  }
  return out;
}

/** Asserts a single `game.started`/`game.sync`-shaped `PlayerView` leaks nothing to `viewerSeat`. */
function assertViewLeaksNothing(view: Record<string, unknown>, viewerSeat: number): void {
  expect(findKeyPaths(view, "rng")).toEqual([]);
  expect(findKeyPaths(view, "devDeck")).toEqual([]); // devDeckCount is fine; the array itself never is
  const players = view["players"] as Record<string, unknown>[];
  for (const p of players) {
    if (p["seat"] === viewerSeat) continue;
    expect(p).not.toHaveProperty("resources");
    expect(p).not.toHaveProperty("devCards");
  }
}

/** Asserts a `game.events` frame's `events` array holds the discarded/stolen/devBought rows. */
function assertEventsLeakNothing(events: Record<string, unknown>[], viewerSeat: number): void {
  for (const ev of events) {
    switch (ev["type"]) {
      case "discarded":
        if (ev["seat"] !== viewerSeat) {
          expect(ev).not.toHaveProperty("cards");
          expect(ev).toHaveProperty("count");
        }
        break;
      case "stolen":
        if (ev["from"] !== viewerSeat && ev["to"] !== viewerSeat) {
          expect(ev).not.toHaveProperty("card");
        }
        break;
      case "devBought":
        if (ev["seat"] !== viewerSeat) {
          expect(ev).not.toHaveProperty("card");
        }
        break;
      default:
        break;
    }
  }
}

// ---- a minimal, deterministic "just make progress" bot, built ONLY from public engine helpers --

function pick<T>(rng: number, arr: readonly T[]): { value: T; rng: number } {
  const draw = pickIndex(rng, arr.length);
  return { value: arr[draw.value]!, rng: draw.state };
}

/** Mirrors `sim/runGame.ts`'s `nextActor` — simplified because this harness never opens a
 * domestic trade (so `state.trade` is always null and that branch never applies). */
function nextActor(state: GameState): Seat {
  if (state.phase.kind === "discard") {
    const seat = state.phase.pending[0];
    if (seat === undefined) throw new Error("BUG: discard phase entered with no pending seats");
    return seat;
  }
  return state.turn.player;
}

/** Greedy VP-directed policy: upgrade to city, else buy a dev card (silent VP chance), else grow
 * via settlement/road, else bank-trade toward affordability, else end the turn. Never plays a dev
 * card (avoids needing `roadBuilding`-phase legality, which has no public enumerator) and never
 * opens a domestic trade (keeps `nextActor` simple) — neither is needed for this harness's job. */
function decide(state: GameState, seat: Seat, rng: number): { action: Action; rng: number } {
  if (state.phase.kind === "discard") {
    const owed = state.phase.amounts[seat] ?? 0;
    const player = state.players[seat];
    if (!player) throw new Error(`BUG: discard requested for unknown seat ${seat}`);
    const pool: ResourceType[] = [];
    for (const res of RESOURCE_TYPES) for (let i = 0; i < player.resources[res]; i++) pool.push(res);
    const cards: ResourceBundle = {};
    let r = rng;
    for (let i = 0; i < owed; i++) {
      const draw = pickIndex(r, pool.length);
      r = draw.state;
      const res = pool[draw.value]!;
      cards[res] = (cards[res] ?? 0) + 1;
      pool.splice(draw.value, 1);
    }
    return { action: { type: "discard", cards }, rng: r };
  }

  switch (state.phase.kind) {
    case "setup": {
      if (state.phase.expect === "settlement") {
        const p = pick(rng, legalSetupSettlements(state));
        return { action: { type: "placeSetupSettlement", vertex: p.value }, rng: p.rng };
      }
      const p = pick(rng, legalSetupRoads(state));
      return { action: { type: "placeSetupRoad", edge: p.value }, rng: p.rng };
    }
    case "preRoll":
      return { action: { type: "rollDice" }, rng };
    case "moveRobber": {
      const p = pick(rng, legalRobberHexes(state));
      return { action: { type: "moveRobber", hex: p.value }, rng: p.rng };
    }
    case "steal": {
      const candidates = stealCandidates(state);
      if (candidates.length === 0) throw new Error("BUG: steal phase entered with no candidates");
      const p = pick(rng, candidates);
      return { action: { type: "steal", from: p.value }, rng: p.rng };
    }
    case "roadBuilding":
      throw new Error("BUG: this harness never plays roadBuilding — should be unreachable");
    case "caravanVote":
      throw new Error("BUG: this harness never enters caravanVote (base games only) — unreachable");
    case "main": {
      const player = state.players[seat];
      if (!player) throw new Error(`BUG: main-phase action requested for unknown seat ${seat}`);
      const afford = buildAffordability(state, seat);

      const cityTargets = afford.city ? legalCityVertices(state, seat) : [];
      if (cityTargets.length > 0) {
        const p = pick(rng, cityTargets);
        return { action: { type: "buildCity", vertex: p.value }, rng: p.rng };
      }

      if (state.devDeck.length > 0 && hasAtLeast(player.resources, COSTS.devCard)) {
        return { action: { type: "buyDevCard" }, rng };
      }

      const settlementTargets = afford.settlement ? legalSettlementVertices(state, seat) : [];
      if (settlementTargets.length > 0) {
        const p = pick(rng, settlementTargets);
        return { action: { type: "buildSettlement", vertex: p.value }, rng: p.rng };
      }

      const roadTargets = afford.road ? legalRoadEdges(state, seat) : [];
      if (roadTargets.length > 0) {
        const p = pick(rng, roadTargets);
        return { action: { type: "buildRoad", edge: p.value }, rng: p.rng };
      }

      const bankOptions = bankTradeOptions(state, seat);
      const give = [...RESOURCE_TYPES].sort((a, b) => player.resources[b] - player.resources[a])[0]!;
      if (bankOptions[give] && bankOptions[give].affordable) {
        const receive =
          RESOURCE_TYPES.find((r) => r !== give && state.bank[r] > 0 && player.resources[r] === 0) ??
          RESOURCE_TYPES.find((r) => r !== give && state.bank[r] > 0);
        if (receive) return { action: { type: "bankTrade", give, receive }, rng };
      }

      return { action: { type: "endTurn" }, rng };
    }
    case "specialBuild":
      throw new Error("BUG: this harness never enters specialBuild — base game only");
    case "chooseGoldResource":
      throw new Error("BUG: this harness never enters chooseGoldResource — base game only");
    case "ended":
      throw new Error("BUG: decide() called on an ended game");
  }
}

function boundPort(handle: ServerHandle): number {
  const address = handle.app.server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
  return address.port;
}

// ---- the harness ---------------------------------------------------------------------------------

describe("T-204 leak test: real ws server, scripted game, per-viewer redaction", () => {
  let handle: ServerHandle | undefined;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await handle?.close();
    handle = undefined;
  });

  it(
    "≥200 actions × 4 viewers leak nothing, the game reaches gameWon, and final views agree on everything public",
    async () => {
      handle = await startServer({
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        // Pin the game seed so the board+dice are deterministic: with the fixed-seed random driver
        // below, a random board could otherwise push an unlucky game past MAX_ACTIONS (flaky).
        sessions: { gcIntervalMs: 60 * 60_000, seed: "T-204-leak-board" },
      });
      const wsUrl = `ws://127.0.0.1:${boundPort(handle)}/ws`;

      for (let i = 0; i < 4; i++) sockets.push(await connect(wsUrl));

      // Lobby: create/join/ready/start — seat i is exactly sockets[i] (create claims seat 0, then
      // joins fill 1..3 in order), matching lobby.test.ts's own happy-path pattern.
      const created = nextMessage(sockets[0]!);
      send(sockets[0]!, { v: 1, type: "lobby.create", payload: { nickname: "P0", config: baseConfig() } });
      const createdMsg = await created;
      const gameId = createdMsg.payload["gameId"] as string;
      const code = createdMsg.payload["code"] as string;

      for (let seat = 1; seat < 4; seat++) {
        const waits = sockets.slice(0, seat + 1).map(nextMessage);
        send(sockets[seat]!, { v: 1, type: "lobby.join", payload: { code, nickname: `P${seat}` } });
        await Promise.all(waits);
      }

      for (let seat = 0; seat < 4; seat++) {
        const waits = sockets.map(nextMessage);
        send(sockets[seat]!, { v: 1, type: "lobby.ready", payload: { ready: true } });
        await Promise.all(waits);
      }

      const startedWaits = sockets.map(nextMessage);
      send(sockets[0]!, { v: 1, type: "lobby.start", payload: {} });
      const startedFrames = await Promise.all(startedWaits);
      startedFrames.forEach((frame, seat) => {
        expect(frame.type).toBe("game.started");
        expect(frame.payload["me"]).toBe(seat);
        assertViewLeaksNothing(frame.payload, seat);
      });

      expect(handle.sessions.sessions.has(gameId)).toBe(true);

      // ---- drive the game: read the TRUE state in-process, script one legal action per step,
      // send it over the acting seat's REAL socket, and check every one of the 4 real responses.
      const MAX_ACTIONS = 8000;
      let actionsPlayed = 0;
      let botRng = hashSeed("T-204-leak-test");

      while (actionsPlayed < MAX_ACTIONS) {
        const session = handle.sessions.sessions.get(gameId)!;
        if (session.state.phase.kind === "ended") break;

        const actor = nextActor(session.state);
        const decision = decide(session.state, actor, botRng);
        botRng = decision.rng;

        const waits = sockets.map(nextMessage);
        send(sockets[actor]!, { v: 1, type: "game.action", payload: { action: decision.action } });
        const frames = await Promise.all(waits);

        frames.forEach((frame, seat) => {
          if (frame.type === "game.error") {
            throw new Error(
              `unexpected game.error for seat ${seat} (actor ${actor} sent ${JSON.stringify(decision.action)}): ` +
                JSON.stringify(frame.payload)
            );
          }
          expect(frame.type).toBe("game.events");
          assertViewLeaksNothing(frame.payload["view"] as Record<string, unknown>, seat);
          assertEventsLeakNothing(frame.payload["events"] as Record<string, unknown>[], seat);
        });

        actionsPlayed++;
      }

      expect(actionsPlayed).toBeGreaterThanOrEqual(200);

      const finalSession = handle.sessions.sessions.get(gameId)!;
      expect(finalSession.state.phase.kind).toBe("ended");

      // ---- final consistency: every seat's game.sync must agree on every PUBLIC field, even
      // though each one's OWN vs. OTHERS' player entries are shaped differently by redaction.
      const syncWaits = sockets.map(nextMessage);
      sockets.forEach((socket) => send(socket, { v: 1, type: "game.syncRequest", payload: { gameId } }));
      const syncFrames = await Promise.all(syncWaits);

      syncFrames.forEach((frame, seat) => {
        expect(frame.type).toBe("game.sync");
        expect(frame.payload["me"]).toBe(seat);
        assertViewLeaksNothing(frame.payload, seat);
      });

      const views = syncFrames.map((f) => f.payload);
      const reference = views[0]!;
      for (const view of views) {
        expect(view["board"]).toEqual(reference["board"]);
        expect(view["bank"]).toEqual(reference["bank"]);
        expect(view["awards"]).toEqual(reference["awards"]);
        expect(view["phase"]).toEqual(reference["phase"]);
        expect(view["devDeckCount"]).toEqual(reference["devDeckCount"]);

        const players = view["players"] as Record<string, unknown>[];
        const refPlayers = reference["players"] as Record<string, unknown>[];
        for (let seat = 0; seat < 4; seat++) {
          // Public per-player fields must be identical across every viewer regardless of whose
          // hand is redacted for them (docs/02 §6: piecesLeft/roads/settlements/cities/
          // playedKnights are never hidden).
          for (const field of ["piecesLeft", "roads", "settlements", "cities", "playedKnights"] as const) {
            expect(players[seat]![field]).toEqual(refPlayers[seat]![field]);
          }
        }
      }
    },
    120_000
  );
});
