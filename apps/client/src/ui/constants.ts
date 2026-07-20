// Shared style constants for src/ui/** primitives (T-307 requirement 4). Centralised so every
// primitive gets an identical focus ring / hit target, and so a11y tests can assert against the
// same values the components actually render (no hand-duplicated expectations).

/** Visible focus ring (docs/11 §6: "--accent 2px"). `focus-visible` only — no ring on a plain
 * mouse click, matching modern browser/UI convention (keyboard/AT users still always get it). */
export const FOCUS_RING_CLASS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel';

/** Button hit targets in px (docs/11 §6: "hit targets >= 24px"). All three sizes clear the bar
 * with headroom; `sm` is the floor for icon-only/inline controls. */
export const BUTTON_HIT_TARGET_PX = {
  sm: 32,
  md: 40,
  lg: 48,
} as const;

export type ButtonSize = keyof typeof BUTTON_HIT_TARGET_PX;

export const MIN_HIT_TARGET_PX = 24;

/** T-506 (mobile-friendly interface) requirement 2: "touch-sized tap targets (>=44px)" — the
 * widely-cited Apple/WCAG 2.5.5 touch minimum, well above docs/11 §6's general 24px floor. Below
 * the `md:` breakpoint every tappable primitive (`Button`, `Tabs`, `SegmentedControl`) is floored
 * at this height regardless of its declared desktop size; `md:` always reverts to the desktop value
 * unchanged (constraint: "keep desktop layout unchanged, only add mobile touch-target sizing"). */
export const MOBILE_MIN_HIT_TARGET_PX = 44;
