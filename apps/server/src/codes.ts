// ID/code generation for lobby rooms (T-203 §2, docs/02 §7).
// - Room codes: 5 chars from A-HJ-NP-Z2-9 (excludes ambiguous O/0/1/I; matches T-202's
//   `LOBBY_CODE_REGEX` in packages/shared/src/protocol/messages.ts), collision-checked against
//   live rooms by the caller.
// - `gameId`: nanoid default alphabet/length.
// - `playerToken`: nanoid(32) — long enough to be unguessable as a reconnect credential (T-205).
import { customAlphabet, nanoid } from "nanoid";

// A-H, J-N, P-Z, 2-9 — 32 chars, matches `/^[A-HJ-NP-Z2-9]{5}$/` in the protocol schema.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 5;
const MAX_CODE_ATTEMPTS = 1000;

const generateRawCode = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

/** A fresh, globally-unique room identifier (internal key; never shown to players). */
export function generateGameId(): string {
  return nanoid();
}

/** A fresh reconnect credential for a seat (T-205 consumes this; unguessable by length). */
export function generatePlayerToken(): string {
  return nanoid(32);
}

/**
 * A fresh 5-char room code not currently in use. `isTaken` is asked about each candidate so the
 * caller decides what "in use" means (its live rooms map) — this module holds no state itself.
 */
export function generateRoomCode(isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateRawCode();
    if (!isTaken(code)) return code;
  }
  // BUG: the whole 32^5 code space is live simultaneously — practically unreachable, but the
  // reducer-purity convention (docs/05 §2) of "throw only for programmer errors" applies here too.
  throw new Error("BUG: exhausted room code space without finding a free code");
}
