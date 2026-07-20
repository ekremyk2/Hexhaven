// The island's hex tiles as real 3D meshes (T-1400 requirement 4). One `InstancedMesh` per terrain
// (shared geometry + shared material, only the per-instance transform differs) rather than one mesh
// per hex — a 56-hex Explorers & Pirates board still costs at most ~7 draw calls (one per terrain
// present), not 56. Sea hexes are skipped entirely: `Sea.tsx`'s single big plane already reads as the
// ocean, matching `BoardView`'s own treatment (sea hexes there carry no inset/skirt either).
import { useLayoutEffect, useMemo, useRef } from 'react';
import { DoubleSide, InstancedMesh, Matrix4, type BufferGeometry } from 'three';
import type { BoardGeometry, GameState, ScenarioTerrain } from '@hexhaven/shared';
import { GOLD, TERRAIN_FILL } from '../board/palette';
import { hexWorldCenter } from './coords';
import { buildHexPrismGeometry } from './hexGeometryBuilders';

type BoardState = GameState['board'];

/** Per-terrain PBR-ish tuning so tiles read as ground/rock/water rather than flat plastic
 *  (requirement 4). Colors are the SAME `palette.ts` source the flat SVG board uses — this table
 *  only adds the roughness/metalness three.js needs that a 2D fill color never carried. */
const TERRAIN_MATERIAL: Record<string, { color: string; roughness: number; metalness: number }> = {
  hills: { color: TERRAIN_FILL.hills, roughness: 0.92, metalness: 0.04 },
  forest: { color: TERRAIN_FILL.forest, roughness: 0.88, metalness: 0.02 },
  pasture: { color: TERRAIN_FILL.pasture, roughness: 0.82, metalness: 0.02 },
  fields: { color: TERRAIN_FILL.fields, roughness: 0.78, metalness: 0.03 },
  mountains: { color: TERRAIN_FILL.mountains, roughness: 0.55, metalness: 0.2 },
  desert: { color: TERRAIN_FILL.desert, roughness: 0.95, metalness: 0.0 },
  gold: { color: GOLD, roughness: 0.3, metalness: 0.6 },
};

const FALLBACK_MATERIAL = TERRAIN_MATERIAL.desert!;

export interface HexTilesProps {
  board: BoardState;
  geometry: BoardGeometry;
  /** Seafarers scenario terrain override — same contract as `BoardView`'s `hexTerrain` prop. */
  hexTerrain?: readonly ScenarioTerrain[];
}

export function HexTiles({ board, geometry, hexTerrain }: HexTilesProps) {
  const tileGeometry = useMemo(() => buildHexPrismGeometry(geometry), [geometry]);

  // Group every non-sea hex's world-space transform by its terrain — one InstancedMesh per group.
  const groups = useMemo(() => {
    const byTerrain = new Map<string, Matrix4[]>();
    for (const hex of geometry.hexes) {
      const tile = board.hexes[hex.id];
      if (!tile) continue;
      const terrain: ScenarioTerrain = hexTerrain?.[hex.id] ?? tile.terrain;
      if (terrain === 'sea') continue;
      const center = hexWorldCenter(hex);
      const matrix = new Matrix4().makeTranslation(center.x, center.y, center.z);
      const list = byTerrain.get(terrain);
      if (list) list.push(matrix);
      else byTerrain.set(terrain, [matrix]);
    }
    return byTerrain;
  }, [board, geometry, hexTerrain]);

  return (
    <group>
      {[...groups.entries()].map(([terrain, matrices]) => (
        <TerrainInstancedTiles key={terrain} terrain={terrain} matrices={matrices} geometry={tileGeometry} />
      ))}
    </group>
  );
}

function TerrainInstancedTiles({
  terrain,
  matrices,
  geometry,
}: {
  terrain: string;
  matrices: Matrix4[];
  geometry: BufferGeometry;
}) {
  const meshRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);

  const material = TERRAIN_MATERIAL[terrain] ?? FALLBACK_MATERIAL;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, matrices.length]}
      castShadow
      receiveShadow
      userData={{ isHexTile: true }}
    >
      <meshStandardMaterial
        color={material.color}
        roughness={material.roughness}
        metalness={material.metalness}
        side={DoubleSide}
      />
    </instancedMesh>
  );
}
