// T-501 requirement 5: fullgame.spec — no UI. 4 ws clients drive a complete seeded game to
// `gameWon` against the BUILT server (the deployment smoke test, docs/02 §9's single-port shape:
// this is the exact binary `apps/server/dist/index.js` that `playwright.config.ts`'s `webServer`
// already booted for every other suite in this run).
//
// Each socket decides its OWN next move purely from its OWN latest redacted `PlayerView` — using
// `@hexhaven/engine`'s real T-410 bot (`chooseAction`), the same production decision-maker
// `apps/server/src/session.ts` uses to auto-drive bot seats — so this never reads hidden
// information any real client couldn't see (mirrors the ws-plumbing pattern of T-204's own
// `apps/server/src/leak.test.ts`, adapted here to decide from each client's own view instead of an
// in-process server oracle, since this test only has an external ws connection to the separately-
// spawned server process — see this task's Implementation notes for that interpretation).
import { test, expect } from "@playwright/test";
import { chooseAction, hashSeed } from "@hexhaven/engine";
import type { PlayerView } from "@hexhaven/engine";
import type { Seat } from "@hexhaven/shared";
import { BASE_URL, E2E_SEED } from "./constants";

interface AnyEnvelope {
  v: 1;
  type: string;
  payload: Record<string, unknown>;
}

// T-410's own test suites (bot.test.ts, benchmark.test.ts) shrink the production search budget
// (240) down to this exact value for CI speed while still always returning a legal move — matching
// that established convention rather than inventing a new one.
const TEST_BUDGET = 12;

function wsUrl(): string {
  return `${BASE_URL.replace(/^http/, "ws")}/ws`;
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", (ev) => reject(new Error(`ws error: ${JSON.stringify(ev)}`)), {
      once: true,
    });
  });
}

function send(socket: WebSocket, envelope: unknown): void {
  socket.send(JSON.stringify(envelope));
}

function nextMessage(socket: WebSocket): Promise<AnyEnvelope> {
  return new Promise((resolve) => {
    socket.addEventListener(
      "message",
      (ev) => resolve(JSON.parse(String(ev.data)) as AnyEnvelope),
      { once: true },
    );
  });
}

function baseConfig() {
  return {
    playerCount: 4,
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    timers: { timers: false, turnSeconds: 120, decisionSeconds: 45 },
  };
}

/** Mirrors `apps/server/src/botDrive.ts`'s `pendingActors`, but sourced entirely from a single
 * seat's OWN `PlayerView` (every field it reads — `phase.pending`, `trade.responses`,
 * `turn.player` — is public, docs/02 §6) rather than the server's internal `GameState`: does `me`
 * have a decision to make RIGHT NOW? */
function myPendingDecision(view: PlayerView, me: Seat): boolean {
  if (view.phase.kind === "ended") return false;
  if (view.phase.kind === "discard") return view.phase.pending.includes(me);
  if (view.phase.kind === "main" && view.trade) {
    const trade = view.trade;
    const responders = view.players
      .map((p) => p.seat)
      .filter((seat) => seat !== view.turn.player && trade.responses[seat] === undefined);
    if (responders.length > 0) return responders.includes(me);
  }
  return view.turn.player === me;
}

test(
  "4 headless ws clients (T-410's chooseAction bot) play a seeded game to gameWon against the built server",
  async () => {
    test.setTimeout(3 * 60_000);
    const url = wsUrl();
    const sockets: WebSocket[] = [await connect(url), await connect(url), await connect(url), await connect(url)];

    try {
      // ---- Lobby: create/join/ready/start (identical wire shape to apps/server/src/leak.test.ts).
      const createdPromise = nextMessage(sockets[0]!);
      send(sockets[0]!, {
        v: 1,
        type: "lobby.create",
        payload: { nickname: "Bot0", config: baseConfig() },
      });
      const created = await createdPromise;
      const code = created.payload.code as string;

      for (let seat = 1; seat < 4; seat++) {
        const waits = sockets.slice(0, seat + 1).map(nextMessage);
        send(sockets[seat]!, { v: 1, type: "lobby.join", payload: { code, nickname: `Bot${seat}` } });
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

      const views: (PlayerView | null)[] = startedFrames.map((f) => f.payload as unknown as PlayerView);
      const rngs: number[] = [0, 1, 2, 3].map((seat) => hashSeed(`${E2E_SEED}-fullgame-bot-${seat}`));

      // ---- Play: each socket reacts to every frame it personally receives (its own `game.started`/
      // `game.sync`/`game.events.view`) by deciding its OWN next action whenever it's its turn.
      const gameEnded = new Promise<{ winner: Seat }>((resolve, reject) => {
        function maybeAct(seat: Seat): void {
          const view = views[seat];
          if (!view) return;
          if (view.phase.kind === "ended") {
            resolve({ winner: view.phase.winner });
            return;
          }
          if (!myPendingDecision(view, seat)) return;
          try {
            const { action, rng } = chooseAction(view, rngs[seat]!, { budget: TEST_BUDGET });
            rngs[seat] = rng;
            send(sockets[seat]!, { v: 1, type: "game.action", payload: { action } });
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }

        sockets.forEach((socket, seat) => {
          socket.addEventListener("message", (ev) => {
            const msg = JSON.parse(String(ev.data)) as AnyEnvelope;
            if (msg.type === "game.sync" || msg.type === "game.started") {
              views[seat] = msg.payload as unknown as PlayerView;
            } else if (msg.type === "game.events") {
              views[seat] = msg.payload.view as unknown as PlayerView;
            } else if (msg.type === "game.error") {
              reject(new Error(`seat ${seat} received game.error: ${JSON.stringify(msg.payload)}`));
              return;
            }
            maybeAct(seat as Seat);
          });
        });

        // Kick off from the `game.started` views already captured above (one of the 4 seats may
        // already have the very first decision, e.g. seat 0 opens the setup draft).
        for (let seat = 0; seat < 4; seat++) maybeAct(seat as Seat);
      });

      const { winner } = await gameEnded;
      expect(winner).toBeGreaterThanOrEqual(0);
      expect(winner).toBeLessThanOrEqual(3);
    } finally {
      for (const socket of sockets) socket.close();
    }
  },
);
