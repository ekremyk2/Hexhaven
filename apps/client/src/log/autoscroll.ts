// Pure "stick to bottom unless the user scrolled up" logic for the log pane (T-407 requirement
// 2). Kept out of LogPanel.tsx so it's testable without a real DOM — this repo's component tests
// run under `renderToStaticMarkup` (no jsdom, no real scrolling; see apps/client/src/hud's tests).
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Within this many px of the bottom still counts as "pinned" (rounding/subpixel tolerance). */
const PIN_THRESHOLD_PX = 24;

/** True when the given scroll position is at (or within tolerance of) the bottom of the pane —
 * the signal LogPanel uses to decide whether to auto-scroll on new lines vs. show the "jump to
 * latest" chip instead. */
export function isAtBottom(metrics: ScrollMetrics): boolean {
  const distanceFromBottom = metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distanceFromBottom <= PIN_THRESHOLD_PX;
}
