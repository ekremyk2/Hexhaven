// Baked "tilted tabletop" projection (T-1210, Catan-Universe look). This is a pure math remap
// applied to every point BEFORE it lands in the SVG's `d`/`points`/`cx`/`cy` attributes — NOT a CSS
// 3D transform on the board container. A CSS `transform: perspective()/rotateX()` would visually
// tilt the whole `<svg>` but leave the DOM's own coordinate system (and therefore pointer
// coordinates) in the flat, un-tilted space, which would desync `InteractionLayer`'s hit-testing
// from what the viewer actually sees. Baking the same affine map into BOTH `BoardView` (drawing) and
// `InteractionLayer` (hit-testing) keeps clicks pixel-exact on the tilted board.
//
// Deliberately affine, NOT true perspective: `sy` is a fixed linear scale of `y` plus a `height`
// offset — no vanishing point, no x foreshortening by depth. That keeps every straight line straight
// and every pair of parallel lines parallel, which is what lets one shared, order-independent helper
// serve both drawing and hit-area math without either side re-deriving a projection matrix (a true
// perspective divide would make hit-testing a non-trivial inverse problem instead of "call the same
// pure function the renderer called").

/** Vertical compression of the oblique tilt (tabletop viewed from over-the-shoulder). Named so it's
 *  the one number to retune the "how tilted" look — everything else derives from it. */
export const TILT_SCALE_Y = 0.62;

export interface BoardProjection {
  /** Projects a point already in BoardView's scaled px space (callers pass `px(v.x)`, `px(v.y)` —
   *  this does NOT re-scale by `HEX_SIZE` itself). `height` is elevation toward the camera in px:
   *  positive height raises the point UP the screen (subtracted from `sy`), used for skirts/pieces
   *  that stand proud of the board plane. Omitted/`0` = on the plane. */
  project(x: number, y: number, height?: number): { sx: number; sy: number };
  /** Whether this projection actually tilts anything. `false` ⇒ `project` is the identity map, so a
   *  caller gating skirts/insets on `enabled` renders byte-identical to the pre-T-1210 flat board. */
  enabled: boolean;
}

/** Factory for the shared projection. `enabled=false` (the "3D board" setting OFF, or a caller that
 *  hasn't opted in) returns the identity map — `sx=x`, `sy=y`, `height` ignored entirely — so the
 *  flat board is bit-for-bit what it was before this module existed. `enabled=true` applies the
 *  oblique tabletop tilt. */
export function boardProjection(enabled: boolean): BoardProjection {
  if (!enabled) {
    return {
      enabled,
      project: (x: number, y: number) => ({ sx: x, sy: y }),
    };
  }
  return {
    enabled,
    project: (x: number, y: number, height = 0) => ({ sx: x, sy: y * TILT_SCALE_Y - height }),
  };
}
