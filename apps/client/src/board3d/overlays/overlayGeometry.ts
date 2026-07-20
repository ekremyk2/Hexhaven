// Pure geometry helpers shared by the T-1403 expansion overlays. Kept separate from the JSX overlay
// components (which can't be rendered/asserted on in this sandbox — no WebGL context, see
// `Board3D.tsx`'s own "defensive rendering note" and every prior 3D task's verification note) so the
// actual POSITIONING MATH gets real unit-test coverage even though the meshes built from it don't.

/** A ground-plane (world X/Z) offset, in world units. */
export interface Offset2D {
  dx: number;
  dz: number;
}

/**
 * Fans `count` markers sharing the same anchor (typically a hex center) evenly around a ring of
 * `radius`, clockwise from straight up — the 3D counterpart of `board/Pieces.tsx`'s `HexPieceMarker`
 * ring-fan math (same `-90deg + index * 360/count` angle formula), reused here for BOTH T-903 hex
 * pieces (any subset of Wizard/Trader/Robin Hood/Banker/Poaching sharing a hex) and Traders &
 * Barbarians' barbarian-attack pieces (2+ barbarians can share a hex, §TB5.2) — a single fan
 * implementation rather than reproducing the flat SVG's two slightly different stacking schemes
 * (T&B's SVG version used a 3-per-row grid offset; the ring reads just as clearly in 3D and keeps
 * one function to reason about/test).
 *
 * A lone marker (`count <= 1`) sits dead-center — no fan needed, `{ dx: 0, dz: 0 }`.
 */
export function ringFanOffset(index: number, count: number, radius: number): Offset2D {
  if (count <= 1) return { dx: 0, dz: 0 };
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return { dx: radius * Math.cos(angle), dz: radius * Math.sin(angle) };
}

/** World-space (X, Z) average of a set of points — used to anchor a marker that spans several
 *  vertices rather than sitting on one (Traders & Barbarians' fishing-ground token, §TB2.2, centers
 *  itself over the coastal vertices it feeds, mirroring `TradersBarbariansPieces.tsx`'s own
 *  `hexCenterRaw`/fishing-ground averaging in the flat SVG board). */
export function averageXZ(points: readonly { x: number; z: number }[]): { x: number; z: number } {
  if (points.length === 0) return { x: 0, z: 0 };
  let sx = 0;
  let sz = 0;
  for (const p of points) {
    sx += p.x;
    sz += p.z;
  }
  return { x: sx / points.length, z: sz / points.length };
}
