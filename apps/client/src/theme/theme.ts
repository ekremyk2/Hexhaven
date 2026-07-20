// Theme state (T-505 dark mode). The whole app is reskinned by flipping ONE attribute —
// `data-theme` on <html> — which swaps the design-token values (theme/tokens.dark.css). No
// component carries per-theme styles; they all read the tokens (tailwind.config.js → CSS vars).
//
// Three user choices: 'light' | 'dark' | 'system'. 'system' resolves live off
// `prefers-color-scheme`. The choice is persisted to localStorage; on first load with no stored
// choice we default to 'system' (so first paint honors the OS preference). The initial attribute is
// stamped before React mounts by the inline no-FOUC script in index.html AND re-affirmed by
// initTheme() from main.tsx — this module is the single source of truth for the logic both use.
import { useCallback, useEffect, useState } from 'react';

/** localStorage key the theme choice persists under (mirrors i18n's `hexhaven.lang`). */
export const THEME_STORAGE_KEY = 'hexhaven.theme';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** The user-facing choices, in the order the toggle renders them. */
export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system'] as const;

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** True when the OS/browser currently asks for a dark color scheme. SSR/test-safe: no window or no
 * matchMedia → false (light), never throws. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(DARK_QUERY).matches;
}

/** The persisted choice, or 'system' when nothing valid is stored (first load / private mode). */
export function readStoredChoice(): ThemeChoice {
  try {
    if (typeof localStorage === 'undefined') return 'system';
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : 'system';
  } catch {
    // localStorage can throw (Safari private mode, disabled storage) — fall back gracefully.
    return 'system';
  }
}

export function persistChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Ignore — the in-memory choice still drives the current session.
  }
}

/** Collapse a choice to the concrete theme to render ('system' → the live OS preference). */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'light' || choice === 'dark') return choice;
  return systemPrefersDark() ? 'dark' : 'light';
}

/** Stamp the resolved theme onto <html> — the one write that reskins every surface. */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolved;
}

/** Idempotent: read the stored choice and apply it. Called before React mounts (main.tsx) as a
 * belt-and-braces backstop to the inline script in index.html. */
export function initTheme(): void {
  applyResolvedTheme(resolveTheme(readStoredChoice()));
}

export interface UseThemeResult {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
}

/** React glue for the header toggle: current choice + resolved theme, and a setter that persists +
 * applies. While the choice is 'system' it subscribes to OS changes and re-applies live. */
export function useTheme(): UseThemeResult {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredChoice);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(choice));

  // Apply + reflect whenever the choice changes.
  useEffect(() => {
    const next = resolveTheme(choice);
    setResolved(next);
    applyResolvedTheme(next);
  }, [choice]);

  // In 'system' mode, follow the OS flipping its color scheme without a reload.
  useEffect(() => {
    if (choice !== 'system') return undefined;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      const next: ResolvedTheme = mql.matches ? 'dark' : 'light';
      setResolved(next);
      applyResolvedTheme(next);
    };
    // Older Safari only has addListener/removeListener; both optional so this works across the range.
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    persistChoice(next);
    setChoiceState(next);
  }, []);

  return { choice, resolved, setChoice };
}
