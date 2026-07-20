// Pure helpers behind Home/Lobby (T-401 requirements 1 & 3): validation, payload building, the
// nickname-persistence + invite-link round trip. Kept side-effect-free (beyond the explicit
// storage calls) and framework-free so they're testable without jsdom/@testing-library — neither
// is in this repo's test stack (see apps/client/src/ui/primitives.test.ts's header comment); the
// routes themselves stay thin wrappers around these functions.
import type { RoomConfig } from '@hexhaven/shared';
import { RoomConfigSchema } from '@hexhaven/shared';
import type { LobbyOutboundMessage } from '../store/transport';
import { defaultStorage, type StorageLike } from '../ws/session';

export const NICKNAME_MAX_LENGTH = 20;

/** docs/02 §7 / T-202: 5 chars from A-Z2-9, excluding the ambiguous O/0/1/I. */
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_REGEX = /^[A-HJ-NP-Z2-9]{5}$/;

export function isValidNickname(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.length >= 1 && trimmed.length <= NICKNAME_MAX_LENGTH;
}

/** Auto-uppercases and strips any character the room-code alphabet doesn't allow (including the
 * ambiguous O/0/1/I) as the user types, capped to the code length. */
export function sanitizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_REGEX.test(code);
}

/** Whether a `game.error` code (routed to `lobby.lastError`, store/index.ts) means "reveal the
 * server-password field" (D-031) rather than just showing its translated message. */
const PASSWORD_ERROR_CODES = new Set(['PASSWORD_REQUIRED', 'BAD_PASSWORD']);
export function isPasswordErrorCode(code: string): boolean {
  return PASSWORD_ERROR_CODES.has(code);
}

export function buildCreatePayload(
  nickname: string,
  config: RoomConfig,
  password: string,
): LobbyOutboundMessage {
  return {
    type: 'lobby.create',
    payload: {
      nickname: nickname.trim(),
      config,
      ...(password ? { password } : {}),
    },
  };
}

export function buildJoinPayload(
  code: string,
  nickname: string,
  password: string,
): LobbyOutboundMessage {
  return {
    type: 'lobby.join',
    payload: {
      code,
      nickname: nickname.trim(),
      ...(password ? { password } : {}),
    },
  };
}

// ---- Nickname persistence (requirement 1: "remembered in localStorage") -----------------------
const NICKNAME_STORAGE_KEY = 'hexhaven.nickname';

export function readStoredNickname(storage: StorageLike | null = defaultStorage()): string {
  return storage?.getItem(NICKNAME_STORAGE_KEY) ?? '';
}

export function saveStoredNickname(nickname: string, storage: StorageLike | null = defaultStorage()): void {
  storage?.setItem(NICKNAME_STORAGE_KEY, nickname);
}

// ---- Room-config persistence (playtest: "store the game settings in localStorage") -------------
// The last-used lobby options — player count, board, expansions, variants, and the whole modifiers
// selection incl. the custom-game values — are saved on every change and restored on Home mount. The
// stored blob is VALIDATED against `RoomConfigSchema` on load, so a corrupt / older-schema / bounds-
// changed config is discarded (returns `null` ⇒ caller falls back to `DEFAULT_ROOM_CONFIG`) rather
// than restoring something the lobby would reject. Best-effort: any storage failure is swallowed.
const ROOM_CONFIG_STORAGE_KEY = 'hexhaven.roomConfig';

export function readStoredRoomConfig(storage: StorageLike | null = defaultStorage()): RoomConfig | null {
  const raw = storage?.getItem(ROOM_CONFIG_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = RoomConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // malformed JSON in storage
  }
}

export function saveStoredRoomConfig(config: RoomConfig, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(ROOM_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // storage quota exceeded / unavailable — persistence is best-effort, never block the UI.
  }
}

// ---- Named config presets (QoL: save/load several game setups) ---------------------------------
export interface NamedPreset {
  name: string;
  config: RoomConfig;
}
const PRESETS_STORAGE_KEY = 'hexhaven.roomConfigPresets';
export const PRESET_NAME_MAX_LENGTH = 40;
const MAX_PRESETS = 12;

/** Reads saved presets, dropping any whose stored config no longer validates (same discipline as
 *  `readStoredRoomConfig`) so a stale/corrupt preset can never load an invalid config. */
export function readStoredPresets(storage: StorageLike | null = defaultStorage()): NamedPreset[] {
  const raw = storage?.getItem(PRESETS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: NamedPreset[] = [];
    for (const item of arr) {
      const name = (item as { name?: unknown })?.name;
      if (typeof name !== 'string' || name.trim() === '') continue;
      const parsed = RoomConfigSchema.safeParse((item as { config?: unknown }).config);
      if (parsed.success) out.push({ name: name.slice(0, PRESET_NAME_MAX_LENGTH), config: parsed.data });
    }
    return out.slice(0, MAX_PRESETS);
  } catch {
    return [];
  }
}

export function saveStoredPresets(presets: NamedPreset[], storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets.slice(0, MAX_PRESETS)));
  } catch {
    /* best-effort */
  }
}

/** Upsert a preset by name (case-insensitive), newest first, capped to `MAX_PRESETS`. Returns the
 *  new list; a blank name is a no-op. Pure — the caller persists via `saveStoredPresets`. */
export function upsertPreset(presets: NamedPreset[], name: string, config: RoomConfig): NamedPreset[] {
  const trimmed = name.trim().slice(0, PRESET_NAME_MAX_LENGTH);
  if (!trimmed) return presets;
  const without = presets.filter((p) => p.name.toLowerCase() !== trimmed.toLowerCase());
  return [{ name: trimmed, config }, ...without].slice(0, MAX_PRESETS);
}

export function removePreset(presets: NamedPreset[], name: string): NamedPreset[] {
  return presets.filter((p) => p.name !== name);
}

// ---- Invite link round trip (requirement 3: "copyable join URL `/#/join/CODE` — home
// pre-fills from it"). The app is a plain BrowserRouter (App.tsx) — the hash fragment is never
// routed, just read once on Home's mount, so this needs no new route or router type. ------------
export function buildInviteHash(code: string): string {
  return `#/join/${code}`;
}

const JOIN_HASH_REGEX = /^#\/join\/([A-Za-z0-9]+)$/;

/** Extracts and sanitizes a room code from a `#/join/CODE` hash; `null` if the hash doesn't match. */
export function parseJoinHash(hash: string): string | null {
  const match = JOIN_HASH_REGEX.exec(hash);
  return match ? sanitizeRoomCode(match[1]!) : null;
}

// ---- Lobby room gating (requirement 3: "host-only Start button enabled at full & ready") -------
export interface StartGateSeat {
  ready: boolean;
}

/** D-025: the host may start once every seat (`config.playerCount` of them) is filled and ready.
 * Mirrors the server's own `allSeatedAndReady` check (apps/server/src/lobby.ts) so the button's
 * enabled state never promises a start the server would silently no-op. */
export function canStartGame(seats: (StartGateSeat | null)[]): boolean {
  return seats.length > 0 && seats.every((seat) => seat !== null && seat.ready);
}
