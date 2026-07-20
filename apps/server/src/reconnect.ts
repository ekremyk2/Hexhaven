// T-205: reconnect & resume (docs/02-architecture.md §5/§7, docs/07 D-020, docs/08 RK-7).
//
// A page refresh or dropped socket must never kill a game: `lobby.ts` owns the actual
// `game.rejoin` wire handling (seat/token bookkeeping, `connSeats`, broadcasting) because it
// already owns `Room`/`SeatInfo`; this module holds the small pieces of that flow worth testing on
// their own, without booting a real ws server:
//
//   - `findSeatByToken` — the `BAD_TOKEN` lookup a `game.rejoin{gameId, playerToken}` needs once
//     `lobby.ts` has already resolved `gameId -> Room` (a miss there is `UNKNOWN_GAME`, handled by
//     the caller since it owns the `rooms` map).
//   - `allSeatsDisconnected` — "is anyone still here?" for a started room; `session.ts`'s GC sweep
//     uses this to purge a room once EVERY seat's socket has been unbound for 30 minutes (docs/02
//     §7), independent of the existing 1h "finished game" GC.
//
// Both are pure functions over the `Room`/`SeatInfo` shapes `lobby.ts` already defines — kept here
// instead of inlined so the seat-matching and all-away logic has its own focused unit tests.

import type { Room } from "./lobby.js";

type Seat = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Finds the seat whose `playerToken` matches, for a `game.rejoin` against an already-resolved
 * `Room`. `null` means `BAD_TOKEN` (no seat in this room holds that token — including a seat that
 * was never filled, or one freed by a pre-start disconnect).
 */
export function findSeatByToken(room: Room, playerToken: string): Seat | null {
  const seatIndex = room.seats.findIndex(
    (info) => info !== null && info.playerToken === playerToken,
  );
  return seatIndex === -1 ? null : (seatIndex as Seat);
}

/**
 * True once every occupied seat in `room` has no live socket bound (`connId === null`). Empty
 * seats (`null`, only possible pre-start) don't count against this — a started room's seats are
 * never freed on disconnect (T-205 §1), only unbound, so in practice every seat is occupied by the
 * time this matters.
 */
export function allSeatsDisconnected(room: Room): boolean {
  return room.seats.every((info) => info === null || info.connId === null);
}
