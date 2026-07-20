import { describe, expect, it } from 'vitest';
import { clearSession, readSession, saveSession, type StorageLike } from './session';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { dump(): Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

const SESSION = { gameId: 'g1', playerToken: 'tok-1', nickname: 'Alice' };

describe('hexhaven.session storage helpers', () => {
  it('round-trips a session under the hexhaven.session key', () => {
    const storage = fakeStorage();
    saveSession(SESSION, storage);
    expect(Object.keys(storage.dump())).toEqual(['hexhaven.session']);
    expect(readSession(storage)).toEqual(SESSION);
  });

  it('clearSession removes the stored session', () => {
    const storage = fakeStorage();
    saveSession(SESSION, storage);
    clearSession(storage);
    expect(readSession(storage)).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(readSession(fakeStorage())).toBeNull();
  });

  it('returns null (not a throw) for corrupt JSON', () => {
    const storage = fakeStorage({ 'hexhaven.session': '{not json' });
    expect(readSession(storage)).toBeNull();
  });

  it('returns null for JSON of the wrong shape', () => {
    const storage = fakeStorage({ 'hexhaven.session': JSON.stringify({ gameId: 'g1' }) });
    expect(readSession(storage)).toBeNull();
    const storage2 = fakeStorage({ 'hexhaven.session': JSON.stringify(['nope']) });
    expect(readSession(storage2)).toBeNull();
  });

  it('degrades to a no-op with a null storage (non-browser environment)', () => {
    expect(() => saveSession(SESSION, null)).not.toThrow();
    expect(readSession(null)).toBeNull();
    expect(() => clearSession(null)).not.toThrow();
  });
});
