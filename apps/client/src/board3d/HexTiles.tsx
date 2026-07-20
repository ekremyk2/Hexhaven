// The island's hex tiles as real 3D meshes (T-1400 requirement 4). One `InstancedMesh` per terrain
// (shared geometry + shared material, only the per-instance transform differs) rather than one mesh
// per hex — a 56-hex Explorers & Pirates board still costs at most ~7 draw calls (one per terrain
// present), not 56. Sea hexes are skipped entirely: `Sea.tsx`'s single big plane already reads as the
// ocean, matching `BoardView`'s own treatment (sea hexes there carry no inset/skirt either).
//
// T-1404 materials polish: each terrain's `map`/`bumpMap`/`roughnessMap` come from
// `terrainTexture.ts`'s procedural canvas (see that file's header for why a bump map, not a true
// normal map) — the flat `color` below is now white (identity tint) so the texture's OWN baked
// base colour shows through unmodified; roughness/metalness stay the per-terrain PBR-ish tuning.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { DoubleSide, InstancedMesh, Matrix4, type BufferGeometry } from 'three';
import type { BoardGeometry, GameState, ScenarioTerrain } from '@hexhaven/shared';
import { hexWorldCenter } from './coords';
import { buildHexPrismGeometry } from './hexGeometryBuilders';
import { terrainSurfaceTextures } from './terrainTexture';

type BoardState = GameState['board'];

/** Per-terrain PBR-ish tuning so tiles read as ground/rock/water rather than flat plastic
 *  (requirement 4). Roughness/metalness are the values three.js needs that a 2D fill color never
 *  carried; the actual colour comes from `terrainTexture.ts`'s canvas (see above). */
const TERRAIN_MATERIAL: Record<string, { roughness: number; metalness: number; bumpScale: number }> = {
  hills: { roughness: 0.92, metalness: 0.04, bumpScale: 0.6 },
  forest: { roughness: 0.88, metalness: 0.02, bumpScale: 0.7 },
  pasture: { roughness: 0.82, metalness: 0.02, bumpScale: 0.5 },
  fields: { roughness: 0.78, metalness: 0.03, bumpScale: 0.5 },
  mountains: { roughness: 0.55, metalness: 0.2, bumpScale: 0.9 },
  desert: { roughness: 0.95, metalness: 0.0, bumpScale: 0.4 },
  gold: { roughness: 0.3, metalness: 0.6, bumpScale: 0.3 },
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
  const textures = useMemo(
    () => terrainSurfaceTextures(terrain as ScenarioTerrain),
    [terrain],
  );

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, matrices.length]}
      castShadow
      receiveShadow
      userData={{ isHexTile: true }}
    >
      <meshStandardMaterial
        map={textures.color}
        bumpMap={textures.bump}
        bumpScale={material.bumpScale}
        roughnessMap={textures.bump}
        roughness={material.roughness}
        metalness={material.metalness}
        side={DoubleSide}
      />
    </instancedMesh>
  );
}
