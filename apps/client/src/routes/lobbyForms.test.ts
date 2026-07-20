// Pure-logic tests for Home/Lobby (T-401 requirements 1 & 3). No jsdom/@testing-library in this
// repo's test stack (see ui/primitives.test.ts's header comment) — these exercise exactly the
// functions the routes call, in isolation, the same way store/index.test.ts exercises the
// dispatcher without rendering a component.
import { describe, expect, it } from 'vitest';
import type { RoomConfig } from '@hexhaven/shared';
import type { StorageLike } from '../ws/session';
import {
  buildCreatePayload,
  buildInviteHash,
  buildJoinPayload,
  canStartGame,
  isPasswordErrorCode,
  isValidNickname,
  isValidRoomCode,
  parseJoinHash,
  readStoredNickname,
  readStoredPresets,
  readStoredRoomConfig,
  removePreset,
  ROOM_CODE_REGEX,
  saveStoredNickname,
  saveStoredPresets,
  saveStoredRoomConfig,
  sanitizeRoomCode,
  upsertPreset,
} from './lobbyForms';

function fakeStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const CONFIG: RoomConfig = {
  playerCount: 4,
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
  timers: { timers: false, turnSeconds: 120, decisionSeconds: 45 },
};

describe('isValidNickname (1-20 chars)', () => {
  it('accepts 1-20 trimmed characters', () => {
    expect(isValidNickname('Alice')).toBe(true);
    expect(isValidNickname('A')).toBe(true);
    expect(isValidNickname('A'.repeat(20))).toBe(true);
  });

  it('rejects empty, whitespace-only, or over-length input', () => {
    expect(isValidNickname('')).toBe(false);
    expect(isValidNickname('   ')).toBe(false);
    expect(isValidNickname('A'.repeat(21))).toBe(false);
  });
});

describe('sanitizeRoomCode / isValidRoomCode (docs/02 §7, T-202 regex)', () => {
  it('auto-uppercases and strips ambiguous/disallowed characters', () => {
    expect(sanitizeRoomCode('ab3d9')).toBe('AB3D9');
    expect(sanitizeRoomCode('a0o1iZ')).toBe('AZ'); // 0, O, 1, I are all excluded
    expect(sanitizeRoomCode('ab-3d!9')).toBe('AB3D9');
  });

  it('caps at 5 characters', () => {
    expect(sanitizeRoomCode('ABCDEFGH')).toBe('ABCDE');
  });

  it('validates exactly the 5-char A-HJ-NP-Z2-9 alphabet', () => {
    expect(isValidRoomCode('AB3D9')).toBe(true);
    expect(isValidRoomCode('AB3D')).toBe(false); // too short
    expect(isValidRoomCode('AB3D99')).toBe(false); // too long
    expect(isValidRoomCode('OB3D9')).toBe(false); // ambiguous O
    expect(ROOM_CODE_REGEX.test('AB3D9')).toBe(true);
  });
});

describe('buildCreatePayload / buildJoinPayload', () => {
  it('builds lobby.create with a trimmed nickname and the given config, no password when blank', () => {
    expect(buildCreatePayload('  Alice  ', CONFIG, '')).toEqual({
      type: 'lobby.create',
      payload: { nickname: 'Alice', config: CONFIG },
    });
  });

  it('includes password only when non-empty', () => {
    expect(buildCreatePayload('Alice', CONFIG, 'secret')).toEqual({
      type: 'lobby.create',
      payload: { nickname: 'Alice', config: CONFIG, password: 'secret' },
    });
  });

  it('builds lobby.join with code/nickname and optional password', () => {
    expect(buildJoinPayload('AB3D9', 'Bob', '')).toEqual({
      type: 'lobby.join',
      payload: { code: 'AB3D9', nickname: 'Bob' },
    });
    expect(buildJoinPayload('AB3D9', 'Bob', 'pw')).toEqual({
      type: 'lobby.join',
      payload: { code: 'AB3D9', nickname: 'Bob', password: 'pw' },
    });
  });
});

describe('nickname persistence (localStorage, "remembered" requirement)', () => {
  it('round-trips through the injected storage', () => {
    const storage = fakeStorage();
    expect(readStoredNickname(storage)).toBe('');
    saveStoredNickname('Alice', storage);
    expect(readStoredNickname(storage)).toBe('Alice');
  });

  it('returns empty string when storage is null (no window, e.g. SSR/node)', () => {
    expect(readStoredNickname(null)).toBe('');
    expect(() => saveStoredNickname('Alice', null)).not.toThrow();
  });
});

describe('room-config persistence (localStorage, "store the game settings" requirement)', () => {
  it('round-trips the full config — including modifiers — through the injected storage', () => {
    const storage = fakeStorage();
    expect(readStoredRoomConfig(storage)).toBeNull(); // nothing stored yet → caller uses the default
    const config: RoomConfig = {
      ...CONFIG,
      playerCount: 6,
      expansions: { fiveSix: true, seafarers: false, citiesKnights: false },
      modifiers: { harbormaster: true, customConstants: { targetVp: 15, maxRoads: null } },
    };
    saveStoredRoomConfig(config, storage);
    expect(readStoredRoomConfig(storage)).toEqual(config);
  });

  it('discards a stored blob that no longer validates (stale schema / bad value)', () => {
    const storage = fakeStorage();
    storage.setItem('hexhaven.roomConfig', JSON.stringify({ ...CONFIG, playerCount: 7 })); // 7 isn't a legal count
    expect(readStoredRoomConfig(storage)).toBeNull();
  });

  it('discards malformed JSON without throwing', () => {
    const storage = fakeStorage();
    storage.setItem('hexhaven.roomConfig', '{not json');
    expect(readStoredRoomConfig(storage)).toBeNull();
  });

  it('is a no-op / null-safe when storage is unavailable (SSR/node)', () => {
    expect(readStoredRoomConfig(null)).toBeNull();
    expect(() => saveStoredRoomConfig(CONFIG, null)).not.toThrow();
  });
});

describe('named config presets', () => {
  const CK: RoomConfig = { ...CONFIG, expansions: { fiveSix: false, seafarers: false, citiesKnights: true }, playerCount: 3 };

  it('upsert adds newest-first and dedups by name (case-insensitive)', () => {
    let list = upsertPreset([], 'Base', CONFIG);
    list = upsertPreset(list, 'C&K night', CK);
    expect(list.map((p) => p.name)).toEqual(['C&K night', 'Base']);
    // Same name (different case) replaces in place, moving to the front.
    list = upsertPreset(list, 'base', CK);
    expect(list.map((p) => p.name)).toEqual(['base', 'C&K night']);
    expect(list[0]!.config).toEqual(CK);
  });

  it('a blank name is ignored', () => {
    expect(upsertPreset([], '   ', CONFIG)).toEqual([]);
  });

  it('remove drops the named preset', () => {
    const list = upsertPreset(upsertPreset([], 'A', CONFIG), 'B', CK);
    expect(removePreset(list, 'A').map((p) => p.name)).toEqual(['B']);
  });

  it('round-trips through storage and discards a preset whose config no longer validates', () => {
    const storage = fakeStorage();
    expect(readStoredPresets(storage)).toEqual([]);
    saveStoredPresets([{ name: 'Base', config: CONFIG }], storage);
    expect(readStoredPresets(storage)).toEqual([{ name: 'Base', config: CONFIG }]);
    // A preset with an invalid config is silently dropped on read.
    storage.setItem('hexhaven.roomConfigPresets', JSON.stringify([{ name: 'Bad', config: { ...CONFIG, playerCount: 7 } }]));
    expect(readStoredPresets(storage)).toEqual([]);
  });
});

describe('invite link round trip (requirement 3: "/#/join/CODE")', () => {
  it('buildInviteHash + parseJoinHash round-trip a code', () => {
    const hash = buildInviteHash('AB3D9');
    expect(hash).toBe('#/join/AB3D9');
    expect(parseJoinHash(hash)).toBe('AB3D9');
  });

  it('sanitizes a lowercase/mixed code found in the hash', () => {
    expect(parseJoinHash('#/join/ab3d9')).toBe('AB3D9');
  });

  it('returns null for a hash that is not a join link', () => {
    expect(parseJoinHash('')).toBeNull();
    expect(parseJoinHash('#/lobby/AB3D9')).toBeNull();
  });
});

describe('isPasswordErrorCode (drives the Home password-field reveal, requirement 1)', () => {
  it('flags PASSWORD_REQUIRED and BAD_PASSWORD only', () => {
    expect(isPasswordErrorCode('PASSWORD_REQUIRED')).toBe(true);
    expect(isPasswordErrorCode('BAD_PASSWORD')).toBe(true);
    expect(isPasswordErrorCode('UNKNOWN_GAME')).toBe(false);
    expect(isPasswordErrorCode('NICKNAME_TAKEN')).toBe(false);
  });
});

describe('canStartGame (D-025: full & ready gate, mirrors the server check)', () => {
  it('false until every seat is filled and ready', () => {
    expect(canStartGame([])).toBe(false);
    expect(canStartGame([{ ready: true }, null, null, null])).toBe(false);
    expect(canStartGame([{ ready: true }, { ready: false }, { ready: true }, { ready: true }])).toBe(false);
  });

  it('true once every seat (3-player and 4-player rooms alike) is filled and ready', () => {
    expect(canStartGame([{ ready: true }, { ready: true }, { ready: true }])).toBe(true);
    expect(
      canStartGame([{ ready: true }, { ready: true }, { ready: true }, { ready: true }]),
    ).toBe(true);
  });

  it('seats 5 and 6 (5–6 extension, T-603): gates on all N filled & ready, no 4-seat cap', () => {
    const five = [true, true, true, true, true].map((ready) => ({ ready }));
    const six = [true, true, true, true, true, true].map((ready) => ({ ready }));
    expect(canStartGame(five)).toBe(true);
    expect(canStartGame(six)).toBe(true);
    // Any un-ready or empty seat among the six blocks start.
    expect(canStartGame([...five, { ready: false }])).toBe(false);
    expect(canStartGame([{ ready: true }, { ready: true }, { ready: true }, { ready: true }, null, null])).toBe(false);
  });
});
