// Pure, framework-free logic backing `Interaction3D.tsx` (T-1402) — everything here is plain
// TypeScript with no react-three-fiber/three/DOM dependency, so it can be unit-tested under the
// workspace's `environment: "node"` vitest config exactly like `coords.ts`/`coords.test.ts` (T-1400).
// `Interaction3D.tsx` itself (the actual r3f meshes/hooks) intentionally has no direct test file —
// mirrors `Board3D.tsx`'s own precedent, since mounting r3f/drei under a `window`-less node vitest
// environment isn't viable (see T-1400's "Verification note"). Splitting the math/decision logic out
// here is what keeps this task's behaviour testable anyway.
import type { BoardGeometry } from '@hexhaven/shared';
import { HEX_SIZE } from '../board/palette';
import { TILE_HEIGHT, TOKEN_HOVER } from './constants';
import type { TargetMode } from '../store/uiMode';

// ---- Marker sizing (world units, HEX_SIZE-relative — same convention as constants.ts) ------------

/** Ghost sphere radius at a legal vertex target (settlement/city/knight/etc. placeholder preview —
 *  see `Interaction3D.tsx`'s header comment for why this is a plain sphere rather than a real
 *  `Pieces3D` mesh). */
export const VERTEX_GHOST_RADIUS = HEX_SIZE * 0.14;

/** The actual raycast hit-test sphere is more generous than the ghost, mirroring the SVG layer's
 *  `HIT_VERTEX_R` (16px) being larger than its ghost ring (`HIT_VERTEX_R * 0.7`, `InteractionLayer.tsx`)
 *  — comfortable click tolerance without inflating what's actually drawn. */
export const VERTEX_HIT_RADIUS = HEX_SIZE * 0.22;

/** Ghost capsule length/radius at a legal edge target (road/ship/knight-edge placeholder). */
export const EDGE_GHOST_LENGTH = HEX_SIZE * 0.42;
export const EDGE_GHOST_RADIUS = HEX_SIZE * 0.085;

/** Same generous-hit-vs-ghost relationship as vertices, mirroring `HIT_EDGE_WIDTH` (22px) vs the SVG
 *  ghost rect's own width (`S * 0.17`, `InteractionLayer.tsx`). */
export const EDGE_HIT_LENGTH = HEX_SIZE * 0.5;
export const EDGE_HIT_RADIUS = HEX_SIZE * 0.16;

/** Vertex/edge markers float just above the tile surface so they read as a piece resting on the
 *  board rather than half-buried in it (a sphere/capsule centered exactly at the surface would poke
 *  halfway through the tile mesh). */
export const VERTEX_EDGE_MARKER_ELEVATION = TILE_HEIGHT + VERTEX_GHOST_RADIUS;

/** Hex markers sit above the number-token layer (`NumberToken3D`'s own `TILE_HEIGHT + TOKEN_HOVER`)
 *  so a robber/pirate/hex-piece highlight never z-fights the token it shares the tile with. */
export const HEX_MARKER_ELEVATION = TILE_HEIGHT + TOKEN_HOVER * 3;

// ---- Legal-target enumeration ----------------------------------------------------------------

/** Which geometry ids (within `mode`'s category) currently get a marker — the SAME `targets` set
 *  `InteractionLayer` filters against, just resolved against the 3D scene's own id lists instead of
 *  SVG polygons/lines/circles. `mode === null` (nothing interactive right now) always yields none —
 *  callers never need a separate "is anything active" check. */
export function activeTargetIds(
  geometry: Pick<BoardGeometry, 'vertices' | 'edges' | 'hexes'>,
  mode: TargetMode | null,
  targets: ReadonlySet<number>,
): number[] {
  switch (mode) {
    case 'vertex':
      return geometry.vertices.filter((v) => targets.has(v.id)).map((v) => v.id);
    case 'edge':
      return geometry.edges.filter((e) => targets.has(e.id)).map((e) => e.id);
    case 'hex':
      return geometry.hexes.filter((h) => targets.has(h.id)).map((h) => h.id);
    case null:
      return [];
    default: {
      const exhaustiveCheck: never = mode;
      return exhaustiveCheck;
    }
  }
}

/** A stale hover (the target set shrank after a server update, or `mode` changed underneath it)
 *  should never solidify a ghost that's no longer legal — mirrors `InteractionLayer.tsx`'s own
 *  `useEffect(() => setHovered(...), [mode, targets])`. */
export function nextHoverAfterTargetsChange(hovered: number | null, targets: ReadonlySet<number>): number | null {
  return hovered != null && targets.has(hovered) ? hovered : null;
}

// ---- Click vs. drag discrimination (requirement 4: don't fight OrbitControls) -----------------

/** Has the pointer moved far enough since its last `pointerdown` that this gesture should read as
 *  an orbit drag rather than a click-to-place? An orbit-rotate drag starts and ends on the exact
 *  same `<canvas>` element every target mesh's own hit-test lives on, so the browser's native
 *  `click` event fires after ANY drag regardless of how far the pointer travelled — this threshold
 *  is what actually tells "drag to orbit" and "click to place" apart (task requirement 4). */
export function exceedsDragThreshold(dxPx: number, dyPx: number, thresholdPx: number): boolean {
  return Math.hypot(dxPx, dyPx) > thresholdPx;
}

// ---- Legal-target pulse (docs/11 §5: "soft pulsing ghost (opacity 35→60%), 1.2s loop") --------

/** `elapsedSec` -> opacity, tracing the SAME keyframe shape as `InteractionLayer.tsx`'s
 *  `hexhaven-legal-pulse` CSS animation (`0%, 100% { opacity: 0.35 }`, `50% { opacity: 0.6 }`) so the
 *  3D ghost's breathing rate/curve matches the flat board's, not just "some pulse, roughly similar". */
export function pulseOpacity(elapsedSec: number, min: number, max: number, periodSec: number): number {
  const phase = (1 - Math.cos((elapsedSec / periodSec) * Math.PI * 2)) / 2;
  return min + phase * (max - min);
}
