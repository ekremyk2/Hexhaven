// The island's hex tiles as real 3D meshes (T-1400 requirement 4; T-1505 generalizes this to the
// user's sculpted terrain/water STL models). Terrains WITH a supplied STL model (hills/forest/
// pasture/fields/mountains/desert/sea — see `terrainStlModels.ts`) render that model, one mesh per
// hex (deterministic per-hex variant + rotation, below); terrains WITHOUT one (`gold`, Seafarers) keep
// the original procedural beveled-prism `InstancedMesh` path (one draw call per terrain, unaffected by
// this task). Sea hexes used to be skipped entirely (the big ocean plane read as "the sea"); T-1505
// requirement 3 gives ON-BOARD sea hexes (Seafarers/E&P) their own `water` tile, and requirement
// "sea-hex ring" synthesizes a one-hex ring of `water` tiles around a LAND-ONLY board (base game) so
// coastal pieces don't sit against bare table — see `seaHexRing.ts`.
import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLoader } from '@react-three/fiber';
import { DoubleSide, InstancedMesh, Matrix4, type BufferGeometry } from 'three';
import type { BoardGeometry, GameState, HexId, ScenarioTerrain } from '@hexhaven/shared';
import { SEA, TERRAIN_FILL } from '../board/palette';
import { hexWorldCenter, type WorldVec3 } from './coords';
import { buildHexPrismGeometry } from './hexGeometryBuilders';
import { computeSeaHexRing, type RingHex } from './seaHexRing';
import { hasStlCoverage, hexYaw, pickRotationStep, pickTerrainVariant, TerrainSTLLoader } from './terrainStlModels';
import { terrainSurfaceTextures } from './terrainTexture';

type BoardState = GameState['board'];

/** Per-terrain PBR-ish tuning so tiles read as ground/rock/water rather than flat plastic
 *  (requirement 4). Roughness/metalness are the values three.js needs that a 2D fill color never
 *  carried. Non-STL terrains (`gold` + the fallback) still use `terrainTexture.ts`'s procedural
 *  canvas for their actual colour (T-1404); STL terrains (incl. `sea`, added T-1505) use a flat
 *  single colour instead — `TILE_FILL` below — per the user's "single colour, no multicolour" ask. */
const TERRAIN_MATERIAL: Record<string, { roughness: number; metalness: number; bumpScale: number }> = {
  hills: { roughness: 0.92, metalness: 0.04, bumpScale: 0.6 },
  forest: { roughness: 0.88, metalness: 0.02, bumpScale: 0.7 },
  pasture: { roughness: 0.82, metalness: 0.02, bumpScale: 0.5 },
  fields: { roughness: 0.78, metalness: 0.03, bumpScale: 0.5 },
  mountains: { roughness: 0.55, metalness: 0.2, bumpScale: 0.9 },
  desert: { roughness: 0.95, metalness: 0.0, bumpScale: 0.4 },
  gold: { roughness: 0.3, metalness: 0.6, bumpScale: 0.3 },
  sea: { roughness: 0.25, metalness: 0.15, bumpScale: 0.3 },
};

const FALLBACK_MATERIAL = TERRAIN_MATERIAL.desert!;

/** Flat single-colour fill for STL tiles (user: no multicolour) — reuses the existing terrain palette
 *  (`board/palette.ts`'s `TERRAIN_FILL`) plus `SEA` for the one STL-covered terrain that isn't in that
 *  record (`sea` was previously never given its own tile mesh at all — the big ocean plane stood in
 *  for it — so `TERRAIN_FILL` never needed a `sea` entry until T-1505's water tiles). */
const TILE_FILL: Partial<Record<ScenarioTerrain, string>> = { ...TERRAIN_FILL, sea: SEA };

export interface HexTilesProps {
  board: BoardState;
  geometry: BoardGeometry;
  /** Seafarers scenario terrain override — same contract as `BoardView`'s `hexTerrain` prop. */
  hexTerrain?: readonly ScenarioTerrain[];
}

export function HexTiles({ board, geometry, hexTerrain }: HexTilesProps) {
  const tileGeometry = useMemo(() => buildHexPrismGeometry(geometry), [geometry]);

  // Split every board hex into "procedural instanced prism" (no STL coverage: gold, or a missing
  // tile) vs. "sculpted STL tile" (everything else, incl. sea — T-1505), and note whether the board
  // has ANY real sea hex at all (gates the synthetic sea-ring below).
  const { proceduralByTerrain, stlHexes, anySeaHex } = useMemo(() => {
    const proceduralByTerrain = new Map<string, Matrix4[]>();
    const stlHexes: { id: HexId; center: WorldVec3; terrain: ScenarioTerrain }[] = [];
    let anySeaHex = false;
    for (const hex of geometry.hexes) {
      const tile = board.hexes[hex.id];
      if (!tile) continue;
      const terrain: ScenarioTerrain = hexTerrain?.[hex.id] ?? tile.terrain;
      if (terrain === 'sea') anySeaHex = true;
      if (hasStlCoverage(terrain)) {
        stlHexes.push({ id: hex.id, center: hexWorldCenter(hex), terrain });
        continue;
      }
      const center = hexWorldCenter(hex);
      const matrix = new Matrix4().makeTranslation(center.x, center.y, center.z);
      const list = proceduralByTerrain.get(terrain);
      if (list) list.push(matrix);
      else proceduralByTerrain.set(terrain, [matrix]);
    }
    return { proceduralByTerrain, stlHexes, anySeaHex };
  }, [board, geometry, hexTerrain]);

  // Sea-hex ring (T-1505): only for a board with NO real sea hex anywhere (the base game / any
  // land-only scenario) — Seafarers/E&P already carry real sea hexes in `geometry` (handled above,
  // as ordinary `stlHexes` entries), so they don't need synthetic filler.
  const seaRing = useMemo<RingHex[]>(() => (anySeaHex ? [] : computeSeaHexRing(geometry)), [geometry, anySeaHex]);

  return (
    <group>
      {[...proceduralByTerrain.entries()].map(([terrain, matrices]) => (
        <TerrainInstancedTiles key={terrain} terrain={terrain} matrices={matrices} geometry={tileGeometry} />
      ))}
      {stlHexes.map(({ id, center, terrain }) => (
        <TerrainStlTile key={`t${id}`} terrain={terrain} seed={id} center={center} fallbackGeometry={tileGeometry} />
      ))}
      {seaRing.map((ring) => (
        <TerrainStlTile
          key={`ring${ring.q},${ring.r}`}
          terrain="sea"
          seed={ring.seed}
          center={hexWorldCenter(ring)}
          fallbackGeometry={tileGeometry}
        />
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

// --- T-1505: sculpted STL terrain/water tile, generalizing the retired forest-only SPIKE -----------
// (`forestStlModel.ts`) to every terrain with a supplied model. Single-colour `MeshStandardMaterial`
// (`TILE_FILL`, not the procedural canvas texture the instanced prism uses) per the user's "single
// colour, no multicolour" ask. `useLoader` + `<Suspense>` is this module's LAZY-LOAD mechanism
// (requirement: "so first paint isn't blocked") — the fallback (the same flat procedural prism every
// non-STL terrain renders) shows immediately while the STL fetches/parses in the background, exactly
// the retired spike's own approach, just no longer forest-only.

/** Catches the error `useLoader` re-throws on a failed load (`useLoader` needs an error boundary
 *  ABOVE it — a `Suspense` alone only catches the pending promise, mirrors `StlPieceModels.tsx`'s own
 *  `StlFallbackBoundary` and the retired spike's `ForestFallbackBoundary`). Falls back to the ordinary
 *  procedural prism so a tile never goes invisible if its STL fails to load. */
class TerrainFallbackBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function TerrainFallbackMesh({ terrain, geometry }: { terrain: ScenarioTerrain; geometry: BufferGeometry }) {
  const material = TERRAIN_MATERIAL[terrain] ?? FALLBACK_MATERIAL;
  return (
    <mesh castShadow receiveShadow geometry={geometry}>
      <meshStandardMaterial
        color={TILE_FILL[terrain] ?? TERRAIN_FILL.desert}
        roughness={material.roughness}
        metalness={material.metalness}
        side={DoubleSide}
      />
    </mesh>
  );
}

function TerrainStlMesh({ terrain, url }: { terrain: ScenarioTerrain; url: string }) {
  const geometry = useLoader(TerrainSTLLoader, url);
  const material = TERRAIN_MATERIAL[terrain] ?? FALLBACK_MATERIAL;
  return (
    <mesh castShadow receiveShadow geometry={geometry}>
      <meshStandardMaterial
        color={TILE_FILL[terrain] ?? TERRAIN_FILL.desert}
        roughness={material.roughness}
        metalness={material.metalness}
        side={DoubleSide}
      />
    </mesh>
  );
}

/** One sculpted terrain/water hex — `seed` picks its model variant + rotation deterministically
 *  (`terrainStlModels.ts`'s `pickTerrainVariant`/`pickRotationStep`: the real `HexId` for a board hex,
 *  or a synthetic-but-stable seed for a sea-ring filler hex, see `seaHexRing.ts`). Positioned at the
 *  hex's world center, base at y=0 (`normalizeStlGeometry`'s "sit at y=0" convention). */
function TerrainStlTile({
  terrain,
  seed,
  center,
  fallbackGeometry,
}: {
  terrain: ScenarioTerrain;
  seed: number;
  center: WorldVec3;
  fallbackGeometry: BufferGeometry;
}) {
  const variant = pickTerrainVariant(terrain, seed);
  const fallback = <TerrainFallbackMesh terrain={terrain} geometry={fallbackGeometry} />;
  // No STL coverage after all (shouldn't happen — `HexTiles` only routes STL-covered terrains here —
  // defensive fallback rather than throwing mid-render).
  if (!variant) return <group position={[center.x, center.y, center.z]}>{fallback}</group>;

  // The yaw only applies to the STL model itself — NOT to the fallback prism (shown while loading,
  // or permanently on a load error): the fallback's geometry is built directly from the real hex's
  // own vertex offsets (`hexGeometryBuilders.ts`), so it already matches the true hex outline exactly
  // and would visibly mis-align (a hexagon only repeats its own outline every 60°, not 30°) if it
  // inherited the STL's 30°-based yaw. Wrapping just the STL mesh in its own inner rotated group
  // (sharing the outer group's origin, i.e. still rotating around the hex's true center) keeps the
  // fallback's un-rotated footprint correct in both the loading and error states.
  const yaw = hexYaw(pickRotationStep(seed));
  return (
    <group position={[center.x, center.y, center.z]}>
      <TerrainFallbackBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <group rotation={[0, yaw, 0]}>
            <TerrainStlMesh terrain={terrain} url={variant.url} />
          </group>
        </Suspense>
      </TerrainFallbackBoundary>
    </group>
  );
}
