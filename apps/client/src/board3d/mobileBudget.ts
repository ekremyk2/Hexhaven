// T-1404 requirement 3 ("a mobile path: lower shadow/dpr/geometry budget"). Pure, SSR/test-safe
// detection (mirrors `board3d/webgl.ts`'s `hasWebGL()` guard-and-never-throw convention) — a coarse
// pointer OR a narrow viewport gets the cheaper budget, the SAME two conditions
// `board/InteractionLayer.tsx`'s own `PULSE_CSS` comment already documents as this app's "is this a
// touch/small-screen device" test (touch phone in portrait satisfies both; a desktop window merely
// resized down to phone width satisfies only the viewport one — both should get the cheap budget).
import { useState } from 'react';

export interface Board3DBudget {
  /** `<Canvas dpr>` range — capping the max device-pixel-ratio is the single biggest fill-rate
   *  lever on a retina/4K display; mobile caps at 1x (never render more pixels than the CSS size). */
  dpr: readonly [number, number];
  /** Shadow-map resolution for the one shadow-casting key light. Mobile GPUs pay quadratically for
   *  this — 512 is a third of the desktop 1536 default's fill cost. */
  shadowMapSize: number;
}

const DESKTOP_BUDGET: Board3DBudget = { dpr: [1, 2], shadowMapSize: 1536 };
const MOBILE_BUDGET: Board3DBudget = { dpr: [1, 1], shadowMapSize: 512 };

/** SSR/test-safe: no `window`/`matchMedia` → the (cheaper-is-safer) mobile budget, never throws. */
export function detectMobileBudget(): Board3DBudget {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return MOBILE_BUDGET;
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const narrowViewport = window.matchMedia('(max-width: 767px)').matches;
    return coarsePointer || narrowViewport ? MOBILE_BUDGET : DESKTOP_BUDGET;
  } catch {
    return MOBILE_BUDGET;
  }
}

/** React glue: resolved once per mount (device class doesn't change mid-session; a live-resize
 *  edge case isn't worth a `matchMedia` change listener for a rendering BUDGET, unlike
 *  `theme.ts`'s light/dark, which genuinely needs live OS-preference updates). `useState`'s
 *  functional initializer runs exactly once, on mount — no effect/listener needed. */
export function useMobileBudget(): Board3DBudget {
  const [budget] = useState(detectMobileBudget);
  return budget;
}
