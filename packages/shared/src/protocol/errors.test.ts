import { describe, it, expect } from 'vitest';
import { PROTOCOL_ERROR_CODES, ProtocolErrorCodeSchema } from './errors.js';

describe('PROTOCOL_ERROR_CODES', () => {
  it('contains exactly the 10 codes from T-202 §4 plus T-411 §1\'s 4 bot-seat codes', () => {
    expect(PROTOCOL_ERROR_CODES).toEqual([
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
      'SEAT_OCCUPIED',
      'SEAT_OUT_OF_RANGE',
      'SEAT_EMPTY',
      'SEAT_NOT_BOT',
    ]);
  });
});

describe('ProtocolErrorCodeSchema', () => {
  it.each(PROTOCOL_ERROR_CODES.map((code) => [code] as const))('accepts %s', (code) => {
    expect(ProtocolErrorCodeSchema.safeParse(code).success).toBe(true);
  });

  it('rejects a code outside the union', () => {
    expect(ProtocolErrorCodeSchema.safeParse('NOT_A_REAL_CODE').success).toBe(false);
  });

  it('rejects an EngineErrorCode value (different union)', () => {
    expect(ProtocolErrorCodeSchema.safeParse('NOT_YOUR_TURN').success).toBe(false);
  });
});
