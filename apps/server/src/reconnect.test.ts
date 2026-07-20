// T-205 unit tests for the pure helpers in reconnect.ts — no ws server needed. The end-to-end wire
// flows (game.rejoin over a real socket, presence broadcasts, mid-subphase resync) live in
// lobby.test.ts / session.test.ts / reconnect.e2e.test.ts.

import { describe, it, expect } from "vitest";
import type { Room, SeatInfo } from "./lobby.js";
import { findSeatByToken, allSeatsDisconnected } from "./reconnect.js";

function makeRoom(seats: (SeatInfo | null)[]): Room {
  return {
    gameId: "game-1",
    code: "ABCDE",
    createdAt: Date.now(),
    config: {
      playerCount: 4,
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
      timers: { timers: false, turnSeconds: 120, decisionSeconds: 45 },
    },
    seats,
    hostSeat: 0,
    started: true,
  };
}

function seat(nickname: string, playerToken: string, connId: string | null): SeatInfo {
  return { nickname, playerToken, connId, ready: true };
}

describe("findSeatByToken", () => {
  it("finds the seat index whose playerToken matches", () => {
    const room = makeRoom([
      seat("Alice", "tok-a", "conn0"),
      seat("Bob", "tok-b", "conn1"),
      seat("Carol", "tok-c", null),
      seat("Dave", "tok-d", "conn3"),
    ]);
    expect(findSeatByToken(room, "tok-c")).toBe(2);
    expect(findSeatByToken(room, "tok-a")).toBe(0);
  });

  it("returns null (BAD_TOKEN) when no seat holds that token", () => {
    const room = makeRoom([seat("Alice", "tok-a", "conn0"), null, null, null]);
    expect(findSeatByToken(room, "does-not-exist")).toBeNull();
  });

  it("returns null for a token that belonged to a seat freed by a pre-start disconnect", () => {
    // Pre-start disconnect nulls the whole seat entry (lobby.ts) — the token is simply gone.
    const room = makeRoom([null, seat("Bob", "tok-b", "conn1"), null, null]);
    expect(findSeatByToken(room, "tok-a")).toBeNull();
  });
});

describe("allSeatsDisconnected", () => {
  it("false while at least one occupied seat still has a bound connId", () => {
    const room = makeRoom([
      seat("Alice", "tok-a", null),
      seat("Bob", "tok-b", "conn1"),
      seat("Carol", "tok-c", null),
      seat("Dave", "tok-d", null),
    ]);
    expect(allSeatsDisconnected(room)).toBe(false);
  });

  it("true once every occupied seat's connId is null", () => {
    const room = makeRoom([
      seat("Alice", "tok-a", null),
      seat("Bob", "tok-b", null),
      seat("Carol", "tok-c", null),
      seat("Dave", "tok-d", null),
    ]);
    expect(allSeatsDisconnected(room)).toBe(true);
  });

  it("empty (never-filled) seats don't count against it", () => {
    const room = makeRoom([seat("Alice", "tok-a", null), null, null, null]);
    expect(allSeatsDisconnected(room)).toBe(true);
  });
});
