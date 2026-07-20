// Builds the shared hex-prism (+ flat cap, for the fog cover) three.js geometries once per
// `BoardGeometry` (T-1400 requirement 4: "shared geometry ... for perf" — every hex tile, regardless
// of terrain, is congruent on a regular hex grid, so ONE geometry is reused across every instance via
// `HexTiles.tsx`'s `InstancedMesh`, only the material differing per terrain).
//
// Derivation of the local-shape → world-Y-up transform (`geometry.rotateX(-Math.PI / 2)` below): a
// `THREE.ExtrudeGeometry`/`ShapeGeometry` is authored in the shape's local XY plane and extrudes
// along +Z. `Rx(-90°)` maps a point `(x, y, z)` to `(x, z, -y)` — so the extrusion axis (Z) becomes
// world Y (up, extrude depth = tile height, exactly what we want), and the shape's local Y maps to
// world Z with a sign flip. We build the shape's local (x, y) from a hex's actual vertex offsets as
// `(dx, -dz)` (negating the world-Z offset) so that after the rotation the sign flip cancels out and
// the tile's footprint lands exactly on its true world (X, Z) position — see `coords.ts`'s own
// `edgeWorldPosition` doc comment for the same `Rx` derivation applied to rotation instead of position.
import * as THREE from 'three';
import type { BoardGeometry } from '@hexhaven/shared';
import { hexWorldCenter, vertexWorldPosition } from './coords';
import { TILE_BEVEL_SIZE, TILE_BEVEL_THICKNESS, TILE_HEIGHT } from './constants';

/** The regular hexagon every tile shares (local XY, pre-rotation) — built from hex #0's actual
 *  vertex offsets so it matches the REAL geometry rather than an assumed/hardcoded orientation. Every
 *  hex on a uniform hex grid (base 19, EXT56 30, any scenario frame) is congruent, so this one shape
 *  is valid for all of them. Throws only if `geometry.hexes` is empty (`BUG:` — never true for a real
 *  `BoardGeometry`, which always has >= 19 hexes). */
function buildHexShape(geometry: Pick<BoardGeometry, 'hexes' | 'vertices'>): THREE.Shape {
  const hex = geometry.hexes[0];
  if (!hex) throw new Error('BUG: buildHexShape — geometry has no hexes');
  const center = hexWorldCenter(hex);
  const shape = new THREE.Shape();
  hex.vertices.forEach((vid, i) => {
    const vertex = geometry.vertices[vid];
    if (!vertex) throw new Error(`BUG: buildHexShape — missing vertex ${vid}`);
    const w = vertexWorldPosition(vertex);
    const localX = w.x - center.x;
    const localY = -(w.z - center.z);
    if (i === 0) shape.moveTo(localX, localY);
    else shape.lineTo(localX, localY);
  });
  shape.closePath();
  return shape;
}

/** The beveled hexagonal prism every non-sea tile instances (requirement 4). */
export function buildHexPrismGeometry(geometry: Pick<BoardGeometry, 'hexes' | 'vertices'>): THREE.ExtrudeGeometry {
  const shape = buildHexShape(geometry);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: TILE_HEIGHT,
    bevelEnabled: true,
    bevelSize: TILE_BEVEL_SIZE,
    bevelThickness: TILE_BEVEL_THICKNESS,
    bevelSegments: 2,
    steps: 1,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** A flat hex-shaped cap (no extrusion) — the fog cover's silhouette, sized to exactly match a
 *  tile's outline (minimal v1 rendering, parity with `BoardView`'s fog polygon; full fog polish is
 *  T-1403). */
export function buildHexCapGeometry(geometry: Pick<BoardGeometry, 'hexes' | 'vertices'>): THREE.ShapeGeometry {
  const shape = buildHexShape(geometry);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}
