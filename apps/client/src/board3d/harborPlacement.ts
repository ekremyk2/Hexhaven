// T-1505 requirement 5 — where/how each `board.harbors` edge's 3D model (ship or lighthouse) sits.
// Pure geometry + a deterministic model pick, no react/three imports (`coords.ts`/`tileElevation.ts`
// convention) — a `Harbors3D.tsx` component (or a test) just maps over this module's output.
//
// Outward placement mirrors `board/BoardView.tsx`'s own harbor block (same "orient toward OPEN SEA,
// i.e. outward from the LAND hex, not whichever of the edge's 1-2 hexes happens to be `hexes[0]`"
// fix that block documents — B-24 — a Seafarers harbor edge borders one land + one real sea hex,
// either of which could be `hexes[0]`).
//
// Placement distance: `edge.x/y`'s world position (`edgeWorldPosition`) is ALWAYS the exact midpoint
// between the land hex's center and its (real-or-synthetic) sea-side neighbor's center — reflecting
// the land center through that midpoint (`landCenter + factor * (edgeMid - landCenter)`, factor 2.0)
// would land EXACTLY on that neighbor hex's own center; `HARBOR_OUT_FACTOR` below is a bit short of
// that (partway from the coastline to the neighbor's center) so the model reads as "just off the
// coast" rather than sitting dead-center on top of the sea/ring tile there.
//
// Rotation: harbor models share terrain tiles' hex-shaped footprint (measured identically — see
// `terrainStlModels.ts`'s top doc comment) and therefore the SAME "only 30° + k*60° seats flush"
// constraint (T-1505 "User direction") — a continuous yaw would hang the model's rectangular base off
// the hex edge. So rather than an arbitrary/random `k` (terrain tiles' approach), a harbor picks
// whichever of the 6 valid steps points CLOSEST to the true outward direction, best-effort "seaward"
// orientation given that constraint (see `nearestRotationStep`'s doc for the one assumption this
// rests on, which a human should confirm once rendered — this sandbox can't check it visually).
import type { BoardGeometry, EdgeId, GameState, HarborType, ScenarioTerrain } from '@hexhaven/shared';
import { edgeWorldPosition, hexWorldCenter, type WorldVec3 } from './coords';
import { pickHarborVariant, type TerrainModelVariant } from './terrainStlModels';
import { resolvedHexTerrain } from './tileElevation';

type BoardState = GameState['board'];

const HARBOR_OUT_FACTOR = 1.35;

const BASE_YAW = Math.PI / 6;
const ROTATION_STEP = Math.PI / 3;
const TWO_PI = Math.PI * 2;

/** Snaps a desired world-space facing angle (`Math.atan2(dx, dz)` convention, matching three.js's
 *  `Ry(θ)` mapping local +Z to world `(sinθ, 0, cosθ)`) to the nearest of the 6 flush rotation steps.
 *  ASSUMES each harbor model's un-rotated (`step = 0`, i.e. `BASE_YAW`) orientation faces local +Z —
 *  the modeler's likely default "front" axis, but unverified (this sandbox can't render WebGL to
 *  check) — if the shipped models turn out to face a different local axis, every harbor will be
 *  off by the same constant angular offset, fixable by changing `BASE_YAW`'s effective phase here
 *  rather than touching the math itself. */
export function nearestRotationStep(desiredYaw: number): number {
  const normalized = (((desiredYaw - BASE_YAW) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round(normalized / ROTATION_STEP) % 6;
}

export interface HarborPlacement {
  edgeId: EdgeId;
  type: HarborType;
  position: WorldVec3;
  rotationStep: number;
  variant: TerrainModelVariant;
}

/** One placement per `board.harbors` entry — `undefined`/skipped entries (a harbor edge id with no
 *  matching geometry edge, or an edge with no resolvable land hex) never happen on a real board but
 *  are guarded defensively rather than thrown, matching `BoardView.tsx`'s own `if (!e) return null`. */
export function computeHarborPlacements(
  board: Pick<BoardState, 'harbors' | 'hexes'>,
  geometry: Pick<BoardGeometry, 'edges' | 'hexes'>,
  hexTerrain: readonly ScenarioTerrain[] | undefined,
): HarborPlacement[] {
  const placements: HarborPlacement[] = [];

  for (const [edgeIdStr, type] of Object.entries(board.harbors) as [string, HarborType][]) {
    const edgeId = Number(edgeIdStr) as EdgeId;
    const edge = geometry.edges[edgeId];
    if (!edge) continue;

    const landHexId = edge.hexes.find((h) => resolvedHexTerrain(board, hexTerrain, h) !== 'sea') ?? edge.hexes[0];
    if (landHexId == null) continue;
    const landHex = geometry.hexes[landHexId];
    if (!landHex) continue;

    const landCenter = hexWorldCenter(landHex);
    const edgeMid = edgeWorldPosition(edge);
    const dx = edgeMid.x - landCenter.x;
    const dz = edgeMid.z - landCenter.z;

    const position: WorldVec3 = {
      x: landCenter.x + dx * HARBOR_OUT_FACTOR,
      y: 0,
      z: landCenter.z + dz * HARBOR_OUT_FACTOR,
    };
    const rotationStep = nearestRotationStep(Math.atan2(dx, dz));

    placements.push({ edgeId, type, position, rotationStep, variant: pickHarborVariant(edgeId) });
  }

  return placements;
}
