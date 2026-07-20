// Protocol-layer error codes (T-202 §4) — distinct from `@hexhaven/shared`'s `EngineErrorCode`
// (game-rule violations, docs/03 §4). These cover connection/lobby/message-shape failures that
// can happen before (or entirely outside of) an engine `reduce` call.

import { z } from 'zod';

export const PROTOCOL_ERROR_CODES = [
  'BAD_MESSAGE',
  'BAD_ACTION',
  'UNKNOWN_GAME',
  'BAD_TOKEN',
  'LOBBY_FULL',
  'ALREADY_STARTED',
  'NOT_HOST',
  'NICKNAME_TAKEN',
  'PASSWORD_REQUIRED',
  'BAD_PASSWORD',
  // T-411 §1: `lobby.addBot`/`lobby.removeBot` validation. `NOT_HOST`/`ALREADY_STARTED` above are
  // reused as-is for those two checks on the bot messages too.
  'SEAT_OCCUPIED', // addBot targeted a seat that isn't empty
  'SEAT_OUT_OF_RANGE', // addBot targeted a seat index >= room.config.playerCount
  'SEAT_EMPTY', // removeBot targeted a seat with nothing in it
  'SEAT_NOT_BOT', // removeBot targeted a seat occupied by a human
] as const;

export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

export const ProtocolErrorCodeSchema = z.enum(PROTOCOL_ERROR_CODES);
