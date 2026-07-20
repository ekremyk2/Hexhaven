// `hexhaven.session` localStorage schema (T-301 §4): the `{gameId, playerToken, nickname}` bundle
// that lets the ws client auto-rejoin an in-progress game after a refresh or reconnect. The lobby
// slice (store/lobbySlice.ts) writes it as soon as it learns the player's identity from a
// `lobby.state` message; `ws/client.ts` reads it on every successful socket open.
//
// Storage access goes through a minimal injectable interface (not the full DOM `Storage` type) so
// tests can swap in an in-memory fake instead of needing a real `window`/jsdom.
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredSession {
  gameId: string;
  playerToken: string;
  nickname: string;
}

const SESSION_KEY = 'hexhaven.session';

/** `window.localStorage` when run in a browser; `null` outside one (e.g. plain-Node tests) so
 * callers degrade to a no-op instead of throwing on a missing `window`. */
export function defaultStorage(): StorageLike | null {
  return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.gameId === 'string' && typeof v.playerToken === 'string' && typeof v.nickname === 'string'
  );
}

export function readSession(storage: StorageLike | null = defaultStorage()): StoredSession | null {
  if (!storage) return null;
  const raw = storage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(
  session: StoredSession,
  storage: StorageLike | null = defaultStorage(),
): void {
  storage?.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(storage: StorageLike | null = defaultStorage()): void {
  storage?.removeItem(SESSION_KEY);
}
