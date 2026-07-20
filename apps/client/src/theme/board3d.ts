// "3D board" setting — originally T-1210's tilted-tabletop SVG toggle; T-1400 repurposes it as the
// RENDERER CHOICE between the real WebGL `<Board3D>` (`board3d/Board3D.tsx`) and the flat SVG
// `<BoardView>` fallback, per the task's "replace the boolean toggle with a renderer choice ... at
// minimum keep a way to force the 2D fallback" requirement — a boolean already satisfies that
// minimum (true = prefer the WebGL board when available; false = force the flat fallback), so this
// module keeps its existing storage key/shape rather than churn a second persisted setting. `Game.tsx`
// ANDs this with `board3d/webgl.ts`'s `hasWebGL()` feature detection — a browser without WebGL always
// falls back regardless of the stored choice. Mirrors `theme.ts`'s light/dark persistence pattern
// exactly — same localStorage read/write shape, same "default resolved before first paint,
// re-affirmed by a hook" contract — just a boolean instead of a three-way choice, and a DIFFERENT
// storage key so it never collides with the UI theme or the cosmetic board-skin setting
// (`themes/themeState.ts`). Unlike dark/light this has no "system" concept and no live OS
// subscription — it's a static preference, not a media-query-driven one, so
// `usePrefersReducedMotion()` deliberately does NOT force it off: reduced motion means "no
// animation", not "no 3D board" (T-1210's original rationale, still true of the WebGL board's own
// OrbitControls damping).
import { useCallback, useState } from 'react';

/** localStorage key the renderer choice persists under. */
export const BOARD_3D_STORAGE_KEY = 'hexhaven.board3d';

/** Default ON — prefer the WebGL 3D board whenever it's available; the toggle lets a viewer force
 * the flat 2D fallback (low-power devices, accessibility, personal preference). */
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
