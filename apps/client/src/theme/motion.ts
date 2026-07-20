// Motion foundation (T-409, docs/11 §5): a single `usePrefersReducedMotion()` hook every animated
// component in src/** reads before choosing which className to render. Two layers of defense, per
// docs/11 §5's "prefers-reduced-motion: reduce collapses all of it to instant state changes":
//   1. This hook (JS-level): lets a component swap in a *different* (static) className, which is
//      what makes the behavior assertable from a plain `renderToStaticMarkup` string (no jsdom in
//      this workspace — see docs/12 quickstart / vitest.config.ts `environment: "node"`). Tests
//      stub `globalThis.window.matchMedia` as a plain object (no jsdom needed for that — it's just
//      a value read during render, not a real CSSOM).
//   2. Plain CSS `@media (prefers-reduced-motion: reduce)` rules in theme/motion.css as a backstop,
//      so the app is still correct even before/without this hook (e.g. a future SSR pass, or a
//      component that only ever uses Tailwind's built-in `motion-reduce:` variant).
//
// SSR/test-safe: `window`/`matchMedia` may not exist at all (this workspace's default test
// environment has no `window` global whatsoever) — both are guarded, defaulting to "motion is
// fine" (`false`) rather than throwing.
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

/** True when the viewer's OS/browser asks for reduced motion. Re-subscribes to live changes in a
 * real browser (e.g. the user flips the OS setting without reloading); under `renderToStaticMarkup`
 * (no effects run) it's simply the value read once during render. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    // Older Safari only has addListener/removeListener; both are typed optional here so this
    // works across the range without a runtime feature-sniff branch.
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}

/** Picks the animated class when motion is fine, the static fallback when it isn't. Every
 * animated component in src/** funnels its keyframe/transition class through this so the "collapse
 * to instant state changes" rule (docs/11 §5) can never be forgotten on a one-off basis. */
export function motionClass(reducedMotion: boolean, animated: string, staticFallback = ''): string {
  return reducedMotion ? staticFallback : animated;
}
