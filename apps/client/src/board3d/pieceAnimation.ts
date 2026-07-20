// Pure animation math for 3D pieces (T-1401 requirement 4: placement drop-in/scale-in + robber
// hop/slide). No react/three imports — every `Pieces3D.tsx` sub-component drives its own `useFrame`
// loop off these pure functions, so the actual easing/curve math is unit-testable in isolation the
// same way `coords.ts` (T-1400) kept its geometry math free of react/three.
//
// Durations: `PLACEMENT_DURATION_MS` is a short, snappy pop (matches the flat SVG board's
// `hexhaven-piece-pop` CSS animation, ~300ms class); `HOP_DURATION_MS` mirrors docs/11 §5's own
// spec ("Robber move: arc hop between hexes, 400ms") and `board/Pieces.tsx`'s
// `hexhaven-robber-hop` CSS animation, so the 3D board's robber moves at the same felt speed as the
// flat board's.

/** Clamps to [0, 1], treating NaN as 0 (defensive — callers always pass elapsed/duration, which is
 *  never NaN in practice, but a pure helper should be total). */
export function clampProgress(t: number): number {
  if (Number.isNaN(t)) return 0;
  return Math.min(1, Math.max(0, t));
}

/** Standard ease-out cubic — starts fast, settles gently. Used for the placement pop (scale +
 *  drop height both ease out, so a piece "lands" rather than snapping to rest). */
export function easeOutCubic(t: number): number {
  const c = clampProgress(t);
  return 1 - Math.pow(1 - c, 3);
}

/** Standard ease-in-out cubic — used for the robber's horizontal hop travel (accelerates away from
 *  the old hex, decelerates into the new one), independent from the vertical arc's own sine curve. */
export function easeInOutCubic(t: number): number {
  const c = clampProgress(t);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export const PLACEMENT_DURATION_MS = 320;

/** Never fully zero — a literal 0 scale is a degenerate (singular) transform in three.js; a tiny
 *  starting scale still reads as "popping in from nothing" visually. */
export const PLACEMENT_MIN_SCALE = 0.05;

/** Scale multiplier for a piece's placement pop, `progress` in [0, 1] (0 = just placed, 1 = settled
 *  at full size). Cities/settlements/roads/ships all drive their wrapping group's uniform scale off
 *  this so a newly-placed piece grows in rather than appearing instantly. */
export function placementScale(progress: number): number {
  const eased = easeOutCubic(progress);
  return PLACEMENT_MIN_SCALE + (1 - PLACEMENT_MIN_SCALE) * eased;
}

/** World-Y offset (added ABOVE the piece's resting position) for the placement drop-in, `progress`
 *  in [0, 1] (0 = full `dropHeight` above rest, 1 = at rest). */
export function placementDropOffset(progress: number, dropHeight: number): number {
  return dropHeight * (1 - easeOutCubic(progress));
}

/** docs/11 §5 "Robber move: arc hop between hexes, 400ms" — same duration the flat board's
 *  `hexhaven-robber-hop` CSS animation uses (`board/Pieces.tsx`). */
export const HOP_DURATION_MS = 400;

export interface HopOffset {
  x: number;
  y: number;
  z: number;
}

/** World-space offset (added to the robber/pirate's resting position) for an in-flight hop,
 *  `progress` in [0, 1]. `dx`/`dz` are the FULL offset from the new hex back to the previous one
 *  (i.e. where the piece starts, relative to where it's going) — they ease out to 0 (arrival) via
 *  `easeInOutCubic`. `y` traces a simple sine arc (0 at both ends, peak `arcHeight` at the
 *  midpoint) so the hop reads as a little jump rather than a slide along the ground. */
export function hopOffset(progress: number, dx: number, dz: number, arcHeight: number): HopOffset {
  const c = clampProgress(progress);
  const eased = easeInOutCubic(c);
  return {
    x: dx * (1 - eased),
    z: dz * (1 - eased),
    y: arcHeight * Math.sin(Math.PI * c),
  };
}
