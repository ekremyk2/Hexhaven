// T-411 §3: unit tests for the pure "who must act right now" helpers (`session.ts`'s `driveBots`
// consumes these). Built on `@hexhaven/engine/testkit`'s `stateWith` so these states are always legal
// (docs/05 §4) — no hand-crafted deep literals.
import { describe, it, expect } from "vitest";
import { stateWith } from "@hexhaven/engine/testkit";
import type { Seat } from "@hexhaven/shared";
import type { Room, SeatInfo } from "./lobby.js";
import { pendingActors, isBotSeat, nextBotActor } from "./botDrive.js";

function seatInfo(occupant: "human" | "bot"): SeatInfo {
  return occupant === "human"
    ? { occupant, nickname: "P", playerToken: "tok", connId: "conn", ready: true }
    : { occupant, nickname: null, playerToken: null, connId: null, ready: true };
}

function makeRoom(occupants: ("human" | "bot")[]): Room {
  return {
    gameId: "g1",
    code: "ABCDE",
    createdAt: Date.now(),
    config: {
      playerCount: 4,
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
      timers: { timers: false, turnSeconds: 120, decisionSeconds: 45 },
    },
    seats: occupants.map(seatInfo),
    hostSeat: 0,
    started: true,
  };
}

describe("isBotSeat", () => {
  it("true only for a seat whose occupant is 'bot'", () => {
    const room = makeRoom(["human", "bot", "human", "bot"]);
    expect(isBotSeat(room, 0 as Seat)).toBe(false);
    expect(isBotSeat(room, 1 as Seat)).toBe(true);
    expect(isBotSeat(room, 2 as Seat)).toBe(false);
    expect(isBotSeat(room, 3 as Seat)).toBe(true);
  });
});

describe("pendingActors", () => {
  it("setup/preRoll/moveRobber/steal/roadBuilding: exactly the turn owner", () => {
    const setup = stateWith({ phase: { kind: "setup", round: 1, expect: "settlement", lastSettlement: null } });
    expect(pendingActors(setup)).toEqual([setup.turn.player]);

    const preRoll = stateWith({ turn: { player: 2 as Seat }, phase: { kind: "preRoll" } });
    expect(pendingActors(preRoll)).toEqual([2]);

    const moveRobber = stateWith({ turn: { player: 1 as Seat }, phase: { kind: "moveRobber", returnTo: "main" } });
    expect(pendingActors(moveRobber)).toEqual([1]);

    const steal = stateWith({
      turn: { player: 3 as Seat },
      phase: { kind: "steal", candidates: [0 as Seat], returnTo: "main" },
    });
    expect(pendingActors(steal)).toEqual([3]);

    const roadBuilding = stateWith({ turn: { player: 2 as Seat }, phase: { kind: "roadBuilding", remaining: 2 } });
    expect(pendingActors(roadBuilding)).toEqual([2]);
  });

  it("specialBuild (5–6 SBP): the phase BUILDER, not the turn owner (who is the seat that just ended)", () => {
    // Regression: the drive must nudge the SBP builder, else a bot builder hangs the game (no-timer
    // default). turn.player stays the ender (0); the builder is 2.
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: { kind: "specialBuild", builder: 2 as Seat, queue: [3 as Seat] },
    });
    expect(pendingActors(state)).toEqual([2]);
  });

  it("Paired Players partial turn: the turn owner IS the paired builder (main phase, falls through)", () => {
    // In Paired Players turn.player is set to the paired builder, so the default path is correct.
    const state = stateWith({
      turn: { player: 3 as Seat },
      phase: { kind: "main" },
      trade: null,
      ext: { fiveSix: { partialTurn: { builder: 3 as Seat, resumeFrom: 0 as Seat } } },
    });
    expect(pendingActors(state)).toEqual([3]);
  });

  it("discard: exactly the phase's own pending list (can be several seats at once)", () => {
    const state = stateWith({
      phase: { kind: "discard", pending: [1, 3] as Seat[], amounts: { 1: 4, 3: 3 } as Record<Seat, number> },
    });
    expect(pendingActors(state)).toEqual([1, 3]);
  });

  it("chooseGoldResource (Seafarers gold, S9/ER-S7): exactly the phase's own pending list — may be a NON-owner", () => {
    // B-26 regression: the old `default` returned `[turn.player]`, so a bot owed gold on a HUMAN
    // turn owner's roll was never driven (game soft-locked, human saw no dialog). The pending list
    // here is a bot (seat 2) while the turn owner is the human (seat 0).
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: { kind: "chooseGoldResource", pending: [2] as Seat[], owed: { 2: 1 } as Record<Seat, number> },
    });
    expect(pendingActors(state)).toEqual([2]);
  });

  it("caravanVote (§TB4.2, T-1004): exactly the phase's own pending list — may be a NON-owner", () => {
    // B-50 regression (mirrors B-26's chooseGoldResource fix): the old `default` returned
    // [turn.player], so a bot due a bid on a HUMAN turn owner's turn was never driven. `pending` here
    // is a bot (seat 2) while the turn owner is the human (seat 0).
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: {
        kind: "caravanVote",
        builder: 0 as Seat,
        pending: [2] as Seat[],
        bids: { 0: 0 } as Record<Seat, number>,
        winner: null,
      },
    });
    expect(pendingActors(state)).toEqual([2]);
  });

  it("caravanVote: the resolved winner once pending is empty — may also be a NON-owner", () => {
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: {
        kind: "caravanVote",
        builder: 0 as Seat,
        pending: [] as Seat[],
        bids: { 0: 0, 1: 3, 2: 0, 3: 0 } as Record<Seat, number>,
        winner: 1 as Seat,
      },
    });
    expect(pendingActors(state)).toEqual([1]);
  });

  it("ended: nobody", () => {
    const state = stateWith({ phase: { kind: "ended", winner: 0 as Seat } });
    expect(pendingActors(state)).toEqual([]);
  });

  it("main with no open trade: exactly the turn owner", () => {
    const state = stateWith({ turn: { player: 0 as Seat }, phase: { kind: "main" }, trade: null });
    expect(pendingActors(state)).toEqual([0]);
  });

  it("main with an open trade: every OTHER seat that hasn't responded — the turn owner is BLOCKED until all responses are in", () => {
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: { kind: "main" },
      trade: { give: { brick: 1 }, receive: { ore: 1 }, responses: {} },
    });
    // players 1, 2, 3 all owe a response; the turn owner (0) may NOT act again yet (see the
    // function doc comment for why — this is what stops a re-offer cycle).
    expect(pendingActors(state)).toEqual([1, 2, 3]);
  });

  it("main with an open trade: seats that already responded drop out of the responder list", () => {
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: { kind: "main" },
      trade: { give: { brick: 1 }, receive: { ore: 1 }, responses: { 1: "declined", 2: "accepted" } },
    });
    expect(pendingActors(state)).toEqual([3]);
  });

  it("main with an open trade: once every OTHER seat has responded, the turn owner becomes the actor again", () => {
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: { kind: "main" },
      trade: { give: { brick: 1 }, receive: { ore: 1 }, responses: { 1: "declined", 2: "accepted", 3: "declined" } },
    });
    expect(pendingActors(state)).toEqual([0]);
  });
});

describe("nextBotActor", () => {
  it("returns null when the only pending actor is human", () => {
    const room = makeRoom(["human", "human", "human", "human"]);
    const state = stateWith({ turn: { player: 0 as Seat }, phase: { kind: "main" }, trade: null });
    expect(nextBotActor(room, state)).toBeNull();
  });

  it("returns the turn owner when it's a bot", () => {
    const room = makeRoom(["human", "bot", "human", "human"]);
    const state = stateWith({ turn: { player: 1 as Seat }, phase: { kind: "main" }, trade: null });
    expect(nextBotActor(room, state)).toBe(1);
  });

  it("returns null when the game has ended, even with bot seats", () => {
    const room = makeRoom(["human", "bot", "bot", "bot"]);
    const state = stateWith({ phase: { kind: "ended", winner: 0 as Seat } });
    expect(nextBotActor(room, state)).toBeNull();
  });

  it("prefers a bot trade-responder over a human turn owner", () => {
    const room = makeRoom(["human", "bot", "human", "human"]);
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: { kind: "main" },
      trade: { give: { brick: 1 }, receive: { ore: 1 }, responses: {} },
    });
    expect(nextBotActor(room, state)).toBe(1);
  });

  it("returns null when every pending seat (responders + turn owner) is human, despite bots elsewhere in the trade", () => {
    // Seat 1 (a bot) already responded; the only seats still owed something are humans.
    const room = makeRoom(["human", "bot", "human", "human"]);
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: { kind: "main" },
      trade: { give: { brick: 1 }, receive: { ore: 1 }, responses: { 1: "accepted" } },
    });
    expect(nextBotActor(room, state)).toBeNull();
  });

  it("returns a pending discard seat that's a bot even if an earlier-pending seat is human", () => {
    const room = makeRoom(["human", "bot", "human", "human"]);
    const state = stateWith({
      phase: { kind: "discard", pending: [0, 1] as Seat[], amounts: { 0: 4, 1: 5 } as Record<Seat, number> },
    });
    expect(nextBotActor(room, state)).toBe(1);
  });

  it("drives a bot owed gold on a HUMAN turn owner's roll (B-26 soft-lock)", () => {
    // The human (seat 0) rolled; only a bot (seat 2) borders the producing gold hex. Before the fix
    // `nextBotActor` returned null (default -> [seat 0] human) and the game hung.
    const room = makeRoom(["human", "human", "bot", "human"]);
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: { kind: "chooseGoldResource", pending: [2] as Seat[], owed: { 2: 1 } as Record<Seat, number> },
    });
    expect(nextBotActor(room, state)).toBe(2);
  });

  it("drives a bot owed a caravanVote bid on a HUMAN turn owner's turn (B-50 soft-lock, same class as B-26)", () => {
    const room = makeRoom(["human", "human", "bot", "human"]);
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: {
        kind: "caravanVote",
        builder: 0 as Seat,
        pending: [2] as Seat[],
        bids: { 0: 0 } as Record<Seat, number>,
        winner: null,
      },
    });
    expect(nextBotActor(room, state)).toBe(2);
  });

  it("drives a bot that won a caravanVote (owes placeCamel) on a HUMAN turn owner's turn", () => {
    const room = makeRoom(["human", "human", "bot", "human"]);
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: {
        kind: "caravanVote",
        builder: 0 as Seat,
        pending: [] as Seat[],
        bids: { 0: 0, 1: 0, 2: 3, 3: 0 } as Record<Seat, number>,
        winner: 2 as Seat,
      },
    });
    expect(nextBotActor(room, state)).toBe(2);
  });
});
