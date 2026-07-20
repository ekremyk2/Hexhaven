// Cosmetic-theme persistence (T-907 PM wiring). Mirrors `theme/theme.ts`'s (light/dark UI theme)
// localStorage pattern exactly — a DIFFERENT key so the two settings never collide — and
// `components/LanguageSwitcher.tsx`'s "just a per-viewer client setting" precedent: this is
// intentionally NOT part of `RoomConfig`/`GameConfig` (see themes.ts's header — a theme has zero
// engine effect, so persisting it per-device via localStorage, like the language and light/dark
// choices, is the right layer; every player at the table may pick their own reskin independently).
import { useCallback, useState } from 'react';
import { DEFAULT_THEME_ID, THEME_IDS, type ThemeId } from './themes';

/** localStorage key the cosmetic theme choice persists under (mirrors i18n's `hexhaven.lang` and
 *  the light/dark toggle's `hexhaven.theme` — a distinct key so the two settings never collide). */
export const COSMETIC_THEME_STORAGE_KEY = 'hexhaven.cosmeticTheme';

function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

/** The persisted choice, or `DEFAULT_THEME_ID` ('classic') when nothing valid is stored (first
 *  load / private mode) — same "default = identity, unchanged look" contract `themes.ts` documents. */
export function readStoredThemeId(): ThemeId {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_THEME_ID;
    const stored = localStorage.getItem(COSMETIC_THEME_STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME_ID;
  } catch {
    // localStorage can throw (Safari private mode, disabled storage) — fall back gracefully.
    return DEFAULT_THEME_ID;
  }
}

export function persistThemeId(themeId: ThemeId): void {
  try {
    localStorage.setItem(COSMETIC_THEME_STORAGE_KEY, themeId);
  } catch {
    // Ignore — the in-memory choice still drives the current session.
  }
}

export interface UseHexhavenThemeResult {
  themeId: ThemeId;
  setThemeId: (themeId: ThemeId) => void;
}

/** React glue for the theme switcher: the current choice (read once from localStorage on mount)
 *  and a setter that persists + updates state, exactly mirroring `theme/theme.ts`'s `useTheme()`. */
export function useHexhavenTheme(): UseHexhavenThemeResult {
  const [themeId, setThemeIdState] = useState<ThemeId>(readStoredThemeId);
  const setThemeId = useCallback((next: ThemeId) => {
    persistThemeId(next);
    setThemeIdState(next);
  }, []);
  return { themeId, setThemeId };
}
