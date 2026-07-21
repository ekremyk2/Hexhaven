// T-1505 REWORK (user correction) — harbors are SEA-HEX TILES, not props floating off the coast.
// The original T-1505 pass placed a small ship/lighthouse prop near each `board.harbors` edge; the
// user corrected this: the harbor model must REPLACE the sea hex tile at that harbor's location (a
// sea tile that happens to carry a harbor renders the ship/lighthouse model INSTEAD of plain water),
// not sit as a separate accent object. This module now computes, per harbor edge, WHICH sea tile
// that is (a real board hex for Seafarers/E&P, or a synthetic ring hex for a land-only board — see
// `seaHexRing.ts`) and the yaw to rotate the harbor model so its dock faces the island. `HexTiles.tsx`
// is the sole caller: it swaps that specific tile's normal water render for a `HarborStlTile`.
//
// Land-hex lookup mirrors `board/BoardView.tsx`'s own harbor block (same "orient outward from the
// LAND hex, not whichever of the edge's 1-2 hexes happens to be `hexes[0]`" fix — B-24 — a Seafarers
// harbor edge borders one land + one real sea hex, either could be first).
//
// Target sea tile: `edge.hexes` has 1 entry (coastal, base-board boundary edge — no sea hex exists in
// `geometry` at all) or 2 entries (Seafarers/E&P — a real sea hex already borders the edge). The
// second entry, when present and itself resolves to 'sea', IS the target tile directly. When only the
// land hex is present, the target is a SYNTHETIC ring hex: the edge's outward direction is, on a
// perfect hex grid, exactly one of the land hex's 6 axial neighbor directions (an edge midpoint is
// always the exact midpoint between a hex's own center and that neighbor's center), so the correct
// neighbor is whichever of `seaHexRing.ts`'s `NEIGHBOR_DELTAS` best matches that direction.
//
// Facing: the model's dock must face the ISLAND, i.e. the yaw pointing from the sea tile's own center
// back toward the harbor edge midpoint (the exact opposite of the land-hex-to-edge "outward" vector,
// and — since edge midpoint/land center/sea-tile center are collinear on a regular hex grid — exactly
// `atan2` of the negated outward vector, no extra geometry needed). Harbor models share terrain tiles'
// hex-shaped footprint (`terrainStlModels.ts`'s doc), so — like every terrain tile — only one of the 6
// `hexYaw` steps seats a harbor model flush in its hex slot; the computed inward direction is snapped
// to the nearest such step (`nearestRotationStep`, unchanged from the original prop-based version:
// still "snap a world yaw to the nearest of 6 hex-flush steps", just now applied to the INWARD
// direction instead of the outward one).
import type { BoardGeometry, EdgeId, GameState, HarborType, HexId, ScenarioTerrain } from '@hexhaven/shared';
import { edgeWorldPosition, hexWorldCenter, toWorldUnits } from './coords';
import { NEIGHBOR_DELTAS, type RingHex } from './seaHexRing';
import { hexYaw, pickHarborVariant, type TerrainModelVariant } from './terrainStlModels';
import { resolvedHexTerrain } from './tileElevation';

type BoardState = GameState['board'];

/** USER-CALIBRATED CONSTANT — the user will supply a value once the harbors render on :8080. Added
 *  on top of every harbor's computed inward-facing, hex-flush-snapped yaw (below) to correct for
 *  whichever direction the shipped harbor models' own authored "front"/dock actually faces at their
 *  own local rotation 0 (unverified here — this sandbox can't render WebGL). Change ONLY this one
 *  constant to re-aim EVERY harbor tile together; the per-harbor inward-direction math must not need
 *  touching to recalibrate. Radians. Starts at 0 (i.e. "assume the model's dock already faces the
 *  direction `nearestRotationStep`'s snapped yaw points"). */
export const HARBOR_MODEL_YAW_OFFSET = (-2 * Math.PI) / 3; // user-calibrated on the Beginner board: -120°

const BASE_YAW = Math.PI / 6;
const ROTATION_STEP = Math.PI / 3;
const TWO_PI = Math.PI * 2;

/** Snaps a desired world-space facing angle (`Math.atan2(dx, dz)` convention, matching three.js's
 *  `Ry(θ)` mapping local +Z to world `(sinθ, 0, cosθ)`) to the nearest of the 6 flush rotation steps
 *  (`terrainStlModels.ts`'s `hexYaw`) — the same "only 30°+k·60° seats a hex-footprint model flush"
 *  constraint every terrain tile is bound by. On a perfect hex grid the true inward-facing direction
 *  already lands almost exactly on one of these 6 steps (edge directions from a hex center are
 *  themselves 60° apart) — this just rounds away floating-point noise, it doesn't approximate. */
export function nearestRotationStep(desiredYaw: number): number {
  const normalized = (((desiredYaw - BASE_YAW) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round(normalized / ROTATION_STEP) % 6;
}

export type HarborTileTarget =
  | { kind: 'hex'; hexId: HexId }
  | { kind: 'ring'; q: number; r: number };

export interface HarborTile {
  edgeId: EdgeId;
  type: HarborType;
  variant: TerrainModelVariant;
  /** Final yaw (radians) for the harbor model's rotation group — the inward-facing direction snapped
   *  to the nearest hex-flush step, PLUS `HARBOR_MODEL_YAW_OFFSET`. */
  yaw: number;
  /** Which sea tile this harbor renders on top of instead of plain water — `HexTiles.tsx` matches
   *  this against the real hex it's about to render (`kind: 'hex'`) or the synthetic ring hex
   *  (`kind: 'ring'`) it's about to render, and swaps in the harbor model there instead. */
  target: HarborTileTarget;
}

/** One entry per `board.harbors` edge, each naming the sea tile it replaces + the yaw to face the
 *  island. `seaRing` must be the SAME ring `HexTiles.tsx` is about to render (only non-empty for a
 *  board with no real sea hex anywhere — see that file's `anySeaHex` gate) so a base-board harbor's
 *  ring-hex target is always found; a Seafarers/E&P harbor's target is always a real hex instead (its
 *  edge already borders one in `geometry`), so `seaRing` is irrelevant to those entries. Defensive
 *  skips (a harbor edge id with no matching geometry edge, or — should never happen given the two
 *  cases above are exhaustive on a real board — no resolvable target) mirror `BoardView.tsx`'s own
 *  `if (!e) return null`. */
export function computeHarborTiles(
  board: Pick<BoardState, 'harbors' | 'hexes'>,
  geometry: Pick<BoardGeometry, 'edges' | 'hexes'>,
  hexTerrain: readonly ScenarioTerrain[] | undefined,
  seaRing: readonly RingHex[],
): HarborTile[] {
  const ringByKey = new Map<string, RingHex>();
  for (const ring of seaRing) ringByKey.set(`${ring.q},${ring.r}`, ring);

  const tiles: HarborTile[] = [];

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

    const otherHexId = edge.hexes.find((h) => h !== landHexId);
    let target: HarborTileTarget | undefined;
    if (otherHexId != null && resolvedHexTerrain(board, hexTerrain, otherHexId) === 'sea') {
      target = { kind: 'hex', hexId: otherHexId };
    } else {
      // Boundary edge (base board): pick whichever of the land hex's 6 axial neighbors points closest
      // to the edge's own direction — every neighbor delta corresponds to a FIXED world-space offset
      // (independent of the land hex's own position), so comparing dot products directly is exact,
      // not an approximation.
      let bestDelta = NEIGHBOR_DELTAS[0]!;
      let bestDot = -Infinity;
      for (const delta of NEIGHBOR_DELTAS) {
        const worldDx = toWorldUnits(Math.sqrt(3) * (delta.q + delta.r / 2));
        const worldDz = toWorldUnits(1.5 * delta.r);
        const dot = dx * worldDx + dz * worldDz;
        if (dot > bestDot) {
          bestDot = dot;
          bestDelta = delta;
        }
      }
      const q = landHex.q + bestDelta.q;
      const r = landHex.r + bestDelta.r;
      const ring = ringByKey.get(`${q},${r}`);
      if (ring) target = { kind: 'ring', q, r };
    }
    if (!target) continue;

    // Inward yaw: from the sea tile's own center back toward the harbor edge (i.e. toward the
    // island) — the exact negation of the land-hex-to-edge "outward" vector (collinear on a regular
    // hex grid: the edge midpoint is always exactly between the land hex's center and the sea tile's
    // center, real or synthetic).
    const inwardYaw = Math.atan2(-dx, -dz);
    const yaw = hexYaw(nearestRotationStep(inwardYaw)) + HARBOR_MODEL_YAW_OFFSET;

    tiles.push({ edgeId, type, variant: pickHarborVariant(edgeId), yaw, target });
  }

  return tiles;
}
