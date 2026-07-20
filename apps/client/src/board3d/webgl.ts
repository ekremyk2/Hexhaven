// WebGL feature detection (T-1400 requirement 6): the flat SVG `<BoardView>` stays the fallback for
// any browser/device that can't do WebGL — this is the single gate `Game.tsx` (and the settings
// menu, to disable the "3D" choice) both check. SSR/test-safe: no `document` → false, never throws
// (mirrors `theme.ts`'s `systemPrefersDark()` guard pattern).
export function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    return gl != null;
  } catch {
    // Some browsers throw rather than return null on a disabled/blocklisted GPU.
    return false;
  }
}
