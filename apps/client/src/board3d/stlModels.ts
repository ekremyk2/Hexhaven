// STL piece models (T-1503) — settlement/city/road replace their `PieceBodies` procedural meshes
// with the user-supplied STL models (`board3d/models/{settlement,city,road}.stl`), tinted per seat
// colour in `StlPieceModels.tsx`. This module owns the parts that don't touch react/three's
// renderer at all — pure enough to unit-test the same way `coords.ts`/`pieceAnimation.ts` are (per
// docs/12's guidance) — plus the three `STLLoader` subclasses that hook normalization into the
// ONE-TIME parse each STL gets (see `normalizeStlGeometry`'s doc for why a subclass, not a
// per-instance step).
//
// Asset loading: each STL is imported with Vite's `?url` suffix rather than a hardcoded
// `/models/...` path — the client is served from a GitHub-Pages base path (`VITE_BASE=/Hexhaven/`)
// AND gets content-hashed filenames in production, so a literal string path would 404 off-root and
// never bust cache; `?url` bakes both in at build time (typed by `vite-env.d.ts`'s `vite/client`
// reference, which declares the generic `*?url` module shape for any asset extension).
import settlementStlUrl from './models/settlement.stl?url';
import cityStlUrl from './models/city.stl?url';
import roadStlUrl from './models/road.stl?url';
// T-1505 part 2: the Seafarers ship model — a user-supplied print-resolution STL, so (unlike
// settlement/city/road above) it goes through the SAME raw -> decimated `models/opt/` pipeline the
// terrain/harbor models use (`apps/client/scripts/optimize-models.mjs`), not a direct `models/*.stl`.
import shipStlUrl from './models/opt/ship1.stl?url';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { BufferGeometry, Vector3 } from 'three';
import { HEX_SIZE } from '../board/palette';

export { settlementStlUrl, cityStlUrl, roadStlUrl, shipStlUrl };

/** How a model is fit to its target size (requirement 2, "scale to fit its board slot") — always a
 *  single UNIFORM scale factor (never anisotropic), so an arbitrary source mesh's proportions
 *  survive intact:
 *   - `'footprint'` (settlement/city): the model's largest HORIZONTAL (X or Z) extent is scaled to
 *     `targetSize` — the constraint that actually matters for a piece standing on a vertex (don't
 *     spill over the hex or onto a neighbour's spot); height is left to follow proportionally
 *     rather than being independently squashed/stretched to match.
 *   - `'length'` (road): the model's long axis (auto-detected — see below) is scaled to
 *     `targetSize`, the edge-segment length `Pieces3D`'s wrapping group already sizes/rotates for.
 */
export type StlFitMode = 'footprint' | 'length';

/**
 * Centers, orients, and scales a raw `STLLoader`-parsed geometry to fit its board slot — mutates and
 * returns the SAME geometry object. Called exactly once per load (from inside a loader subclass's
 * `parse()`, below), so there's no risk of double-applying it to an already-normalized geometry that
 * `useLoader`'s cache is about to hand out to a second/third/... instance of the same piece type.
 *
 * Orientation: the supplied STLs are assumed Z-up (the common CAD/3D-print export convention) while
 * the board's world up-axis is +Y (`coords.ts`'s module doc) — `rotateX(-90deg)` is the standard
 * Z-up -> Y-up remap (old +Z becomes new +Y; `Rx(-90deg): (x,y,z) -> (x, z, -y)`). For `'length'`
 * pieces (road) whose long axis might have been authored along either horizontal axis, an extra 90
 * degree yaw brings it onto local +X if it came out along Z instead — `Pieces3D`'s wrapping group
 * already carries the edge's own rotation onto local +X (see `PieceBodies.tsx`'s `RoadBody` doc
 * comment), so the model's long axis must agree regardless of how the STL was authored.
 *
 * Placement origin: after centering horizontally, the geometry is translated so its lowest point
 * sits at y=0 — `PieceBodies.tsx`'s documented local-space convention ("origin at ground level",
 * caller positions/rotates the WRAPPING group, never the body mesh) applies here too.
 *
 * Normals: `STLLoader` always returns a non-indexed geometry with a `normal` attribute (either from
 * the file or computed per-face) — `computeVertexNormals()` only runs if that attribute is somehow
 * missing (requirement 2's "if the STL lacks smooth normals"); on a non-indexed geometry it can only
 * recompute the same flat per-face normal (there are no shared vertex indices left to average
 * across), so pieces read with a faceted "painted miniature" shading rather than a smooth-shaded
 * one — an acceptable, in fact fitting, look for a tabletop game piece.
 */
export function normalizeStlGeometry(
  geometry: BufferGeometry,
  targetSize: number,
  fitMode: StlFitMode,
): BufferGeometry {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();

  geometry.rotateX(-Math.PI / 2);

  geometry.computeBoundingBox();
  let box = geometry.boundingBox;
  if (!box) return geometry; // defensive: an empty/degenerate STL — nothing sane to normalize.
  const size = new Vector3();
  box.getSize(size);

  if (fitMode === 'length' && size.z > size.x) {
    geometry.rotateY(Math.PI / 2);
    geometry.computeBoundingBox();
    box = geometry.boundingBox;
    if (!box) return geometry;
    box.getSize(size);
  }

  const center = new Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -box.min.y, -center.z);

  const measured = fitMode === 'length' ? size.x : Math.max(size.x, size.z);
  const scale = measured > 1e-8 ? targetSize / measured : 1;
  geometry.scale(scale, scale, scale);

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// Target sizes derived from `PieceBodies.tsx`'s own procedural dimensions (both keyed off the same
// `HEX_SIZE`) so an STL piece lands at the same order of magnitude as the procedural body it
// replaces:
//  - settlement/city footprint target = the procedural wall footprint's diagonal (`hypot(w, d)`) —
//    `CITY_FOOTPRINT > SETTLEMENT_FOOTPRINT` (0.64*S vs 0.48*S) guarantees a city always normalizes
//    visibly larger than a settlement (acceptance criterion), independent of the two source STLs'
//    own relative scale.
//  - road length target = the procedural bar's overall span (`len`, including its rounded end-caps).
//  - ship length target (T-1505 part 2) = a bit longer than a road's, matching `PieceBodies.tsx`'s
//    own procedural `ShipBody`/`Hull`'s overall hull+bow span (`hullLen * (0.8/2 + 0.36 + ~0.34/2)`,
//    roughly `S * 0.7`) so the STL hull replaces it at the same order of magnitude, not a road-sized
//    sliver or an oversized boat overhanging its edge slot.
export const SETTLEMENT_FOOTPRINT = Math.hypot(HEX_SIZE * 0.36, HEX_SIZE * 0.32);
export const CITY_FOOTPRINT = Math.hypot(HEX_SIZE * 0.5, HEX_SIZE * 0.4);
export const ROAD_LENGTH = HEX_SIZE * 0.66;
export const SHIP_LENGTH = HEX_SIZE * 0.72;

/**
 * Three `STLLoader` subclasses — one per piece type — each overriding `parse()` to normalize the
 * geometry right after three's own parsing, before `useLoader`'s cache (keyed on `(Proto, url)`, per
 * `@react-three/fiber`'s `useLoader` doc — "must be wrapped with React.Suspense") ever stores/returns
 * it. Normalization lives in the loader subclass (not a `useMemo` in the consuming component)
 * *because* `useLoader` already dedupes/caches by url: every settlement instance gets back the exact
 * SAME geometry object on a cache hit, so normalizing again per-instance would double-scale/
 * double-rotate an already-normalized geometry. A stable module-level class (rather than one
 * constructed per render) is required for that cache key to stay stable across renders.
 */
export class SettlementSTLLoader extends STLLoader {
  override parse(data: ArrayBuffer | string): BufferGeometry {
    return normalizeStlGeometry(super.parse(data), SETTLEMENT_FOOTPRINT, 'footprint');
  }
}

export class CitySTLLoader extends STLLoader {
  override parse(data: ArrayBuffer | string): BufferGeometry {
    return normalizeStlGeometry(super.parse(data), CITY_FOOTPRINT, 'footprint');
  }
}

export class RoadSTLLoader extends STLLoader {
  override parse(data: ArrayBuffer | string): BufferGeometry {
    return normalizeStlGeometry(super.parse(data), ROAD_LENGTH, 'length');
  }
}

/** Ship (T-1505 part 2) — same `'length'` fit mode as `RoadSTLLoader` (a ship sits on a sea EDGE,
 *  like a road on a land edge), just a different target size. */
export class ShipSTLLoader extends STLLoader {
  override parse(data: ArrayBuffer | string): BufferGeometry {
    return normalizeStlGeometry(super.parse(data), SHIP_LENGTH, 'length');
  }
}
