// Geometry → world-space mapping for the WebGL 3D board (T-1400). Pure functions, no react/three
// imports — every later 3D task (pieces T-1401, interaction T-1402, overlays T-1403) builds camera
// math, raycasts, and mesh placement on THIS module, so the convention here is the single source of
// truth for "where does board-space point (x, y) live in the scene".
//
// Convention (documented once, relied on everywhere else in board3d/**):
//   - board x  → world X   (unchanged)
//   - board y  → world Z   (unchanged — board-space "y grows downward on screen" becomes
//     "z grows away from the camera", which is exactly the tabletop framing we want: the camera
//     sits at +Z/+Y looking back toward the origin, so a larger board y/world z reads as "nearer
//     the viewer", matching `BoardView`'s screen-space y-down convention 1:1)
//   - elevation → world Y  (up — the one new axis a flat SVG board never needed)
//
// `GEOMETRY`'s hex/vertex coordinates are in the same "unit-1" space `board/palette.ts`'s `px()`
// scales from (`HEX_SIZE` px per unit) — this module reuses that exact constant so the 3D scene's
// tile spacing matches the flat board's, and a future task can sanity-check the two renderers
// side-by-side at the same scale.
import type { BoardGeometry, GeometryEdge, GeometryHex, GeometryVertex } from '@hexhaven/shared';
import { HEX_SIZE } from '../board/palette';

export interface WorldVec3 {
  x: number;
  y: number;
  z: number;
}

/** Board-space (unit-1) distance → world-space units. Shared scale factor with the flat SVG board's
 *  `px()` (`board/palette.ts`'s `HEX_SIZE`), so nothing in board3d ever hardcodes its own scale. */
export function toWorldUnits(n: number): number {
  return n * HEX_SIZE;
}

/** Board (x, y) + an optional elevation → world (X, Y, Z). The one function every other helper in
 *  this module funnels through — see the module doc comment for the axis convention. */
export function boardToWorld(x: number, y: number, elevation = 0): WorldVec3 {
  return { x: toWorldUnits(x), y: elevation, z: toWorldUnits(y) };
}

/** World position of a hex's center, at a given elevation (default 0 — sea level / tile baseline). */
export function hexWorldCenter(hex: Pick<GeometryHex, 'x' | 'y'>, elevation = 0): WorldVec3 {
  return boardToWorld(hex.x, hex.y, elevation);
}

/** World position of a vertex (settlement/city anchor, road/ship endpoint), at a given elevation. */
export function vertexWorldPosition(vertex: Pick<GeometryVertex, 'x' | 'y'>, elevation = 0): WorldVec3 {
  return boardToWorld(vertex.x, vertex.y, elevation);
}

export interface EdgeWorld extends WorldVec3 {
  /** Rotation (radians) around world Y that aligns a mesh's local +X axis with the edge's direction
   *  — the 3D counterpart of the flat board's `rotate(${e.angleDeg})` (SVG degrees, clockwise in
   *  screen space). Three.js's `Ry(θ)` rotates local +X to `(cos θ, 0, -sin θ)` in world (X, Z); we
   *  want that to equal the screen-space direction `(cos(angleDeg), sin(angleDeg))` mapped straight
   *  onto (X, Z) (no axis flip, per the module's convention) — solving `cos θ = cos(angleDeg)` and
   *  `-sin θ = sin(angleDeg)` gives `θ = -angleDeg` (in radians). */
  rotationY: number;
}

/** World position + orientation of an edge's midpoint (road/ship placement, T-1401). */
export function edgeWorldPosition(edge: Pick<GeometryEdge, 'x' | 'y' | 'angleDeg'>, elevation = 0): EdgeWorld {
  const { x, y, z } = boardToWorld(edge.x, edge.y, elevation);
  return { x, y, z, rotationY: -(edge.angleDeg * Math.PI) / 180 };
}

export interface BoardExtents {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** World-space center of the bounding box (Y always 0 — extents are a ground-plane footprint). */
  center: WorldVec3;
  /** Radius of the smallest sphere (centered on `center`, in the XZ ground plane) containing every
   *  hex center — the number every camera-framing computation (`Board3D.tsx`) starts from so all
   *  board sizes (19 → 56+ hexes) fit the same way. */
  radius: number;
}

/** Bounding footprint of every hex center in `geometry`, in world space — camera framing (any board
 *  size) and the sea plane's extent both derive from this rather than a hardcoded board size. */
export function boardWorldExtents(geometry: Pick<BoardGeometry, 'hexes'>): BoardExtents {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const hex of geometry.hexes) {
    const { x, z } = hexWorldCenter(hex);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  // A geometry always has at least one hex (base board: 19) — the Infinity sentinels above only
  // ever survive an empty `hexes` array, which no real `BoardGeometry` produces.
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, center: { x: 0, y: 0, z: 0 }, radius: HEX_SIZE };
  }
  const center: WorldVec3 = { x: (minX + maxX) / 2, y: 0, z: (minZ + maxZ) / 2 };
  const radius = Math.max(
    Math.hypot(maxX - center.x, maxZ - center.z),
    HEX_SIZE, // floor so a degenerate/near-empty board still frames sanely
  );
  return { minX, maxX, minZ, maxZ, center, radius };
}
