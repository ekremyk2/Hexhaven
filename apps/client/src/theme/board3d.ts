// "3D board" setting (T-1210): a per-viewer, persisted on/off toggle for the tilted-tabletop board
// (`board/projection.ts`). Mirrors `theme.ts`'s light/dark persistence pattern exactly — same
// localStorage read/write shape, same "default resolved before first paint, re-affirmed by a hook"
// contract — just a boolean instead of a three-way choice, and a DIFFERENT storage key so it never
// collides with the UI theme or the cosmetic board-skin setting (`themes/themeState.ts`). Unlike
// dark/light this has no "system" concept and no live OS subscription — it's a static tilt, not a
// media-query-driven preference, so `usePrefersReducedMotion()` deliberately does NOT force it off
// (T-1210 requirement 2): reduced motion means "no animation", not "no static tilt".
import { useCallback, useState } from 'react';

/** localStorage key the "3D board" choice persists under. */
export const BOARD_3D_STORAGE_KEY = 'hexhaven.board3d';

/** Default ON — the tilted tabletop is the shipped look; the toggle lets a viewer opt back out to
 * the flat board (low-power devices, personal preference). */
export const BOARD_3D_DEFAULT = true;

function parseStored(value: string | null): boolean | null {
  if (value === 'on') return true;
  if (value === 'off') return false;
  return null;
}

/** The persisted choice, or `BOARD_3D_DEFAULT` when nothing valid is stored (first load / private
 * mode). SSR/test-safe: no `localStorage` → the default, never throws. */
export function readStoredBoard3d(): boolean {
  try {
    if (typeof localStorage === 'undefined') return BOARD_3D_DEFAULT;
    const parsed = parseStored(localStorage.getItem(BOARD_3D_STORAGE_KEY));
    return parsed ?? BOARD_3D_DEFAULT;
  } catch {
    // localStorage can throw (Safari private mode, disabled storage) — fall back gracefully.
    return BOARD_3D_DEFAULT;
  }
}

export function persistBoard3d(enabled: boolean): void {
  try {
    localStorage.setItem(BOARD_3D_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Ignore — the in-memory choice still drives the current session.
  }
}

export interface UseBoard3dResult {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

/** React glue for the settings-menu toggle: current choice (read once from localStorage on mount)
 * and a setter that persists + updates state, mirroring `theme.ts`'s `useTheme()`/
 * `themeState.ts`'s `useHexhavenTheme()`. Returned as a tuple by `useBoard3d()` below for a
 * `useState`-shaped call site; this named-field shape is what the settings menu reads from. */
export function useBoard3dState(): UseBoard3dResult {
  const [enabled, setEnabledState] = useState<boolean>(readStoredBoard3d);
  const setEnabled = useCallback((next: boolean) => {
    persistBoard3d(next);
    setEnabledState(next);
  }, []);
  return { enabled, setEnabled };
}

/** `[enabled, setEnabled]` convenience wrapper over `useBoard3dState()` — the shape the task file
 * asks for (`useBoard3d()` returning a tuple like `useState`). */
export function useBoard3d(): [boolean, (enabled: boolean) => void] {
  const { enabled, setEnabled } = useBoard3dState();
  return [enabled, setEnabled];
}
