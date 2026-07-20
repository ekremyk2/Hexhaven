// <Board3D> — the WebGL 3D board (T-1400), replacing the flat SVG `<BoardView>` stack when WebGL is
// available (`Game.tsx` decides which to mount). Terrain-only for now: pieces (T-1401), click
// interaction (T-1402), and expansion overlays (T-1403) land in later tasks — this stands up the
// `<Canvas>`, camera + `OrbitControls`, lighting/shadows, the sea, and the island's hex tiles +
// number tokens.
//
// Lighting note: no drei `<Environment>` preset — those fetch an HDRI over HTTP at runtime by
// default, which the task's offline/self-contained constraint rules out. A hemisphere light gives
// the same "soft sky + ground bounce" read without any network dependency (same reasoning
// `numberTexture.ts` gives for skipping drei's `<Text>`).
//
// Defensive rendering note: this task cannot be visually verified in this sandbox (see the task
// file's "Verification note for the implementer") — every mesh in board3d/** renders `side:
// DoubleSide` so a winding-direction mistake in `hexGeometryBuilders.ts` produces a possibly-odd
// look rather than SILENTLY INVISIBLE geometry, which would be a much worse failure mode to ship
// unverified.
import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { InstancedMesh } from 'three';
import type { BoardGeometry, GameState, HexId, ScenarioTerrain } from '@hexhaven/shared';
import { SEA_DEEP } from '../board/palette';
import { boardWorldExtents, hexWorldCenter } from './coords';
import { TILE_HEIGHT, TOKEN_HOVER } from './constants';
import { FogCover } from './FogCover';
import { buildHexCapGeometry } from './hexGeometryBuilders';
import { HexTiles } from './HexTiles';
import { NumberToken3D } from './NumberToken3D';
import { Sea } from './Sea';

export interface Board3DProps {
  board: GameState['board'];
  geometry: BoardGeometry;
  /** Seafarers scenario terrain override — same contract as `BoardView`'s `hexTerrain` prop. */
  hexTerrain?: readonly ScenarioTerrain[];
  /** Blind-setup-placement modifier: every hex's token is withheld, render "?" instead. */
  hiddenNumbers?: boolean;
  /** Explorers & Pirates still-unexplored hexes. */
  epUnexplored?: readonly HexId[];
  /** The Fog Islands (Seafarers 5-6) still-hidden hexes — same cover treatment as `epUnexplored`. */
  seafarersFogHidden?: readonly HexId[];
}

export function Board3D({
  board,
  geometry,
  hexTerrain,
  hiddenNumbers = false,
  epUnexplored = [],
  seafarersFogHidden = [],
}: Board3DProps) {
  const extents = useMemo(() => boardWorldExtents(geometry), [geometry]);
  const capGeometry = useMemo(() => buildHexCapGeometry(geometry), [geometry]);
  const fogHexes = useMemo(
    () => new Set<HexId>([...epUnexplored, ...seafarersFogHidden]),
    [epUnexplored, seafarersFogHidden],
  );

  // Camera framing (requirement 2/acceptance: every board size 19 -> 56+ hexes fits) — the fit
  // distance is derived from the board's OWN bounding radius (`coords.ts`'s `boardWorldExtents`),
  // never a hardcoded number, so a bigger Seafarers/E&P board frames just as correctly as the base.
  const fovDeg = 42;
  const fitDistance = (extents.radius / Math.sin((fovDeg * Math.PI) / 360)) * 1.35;
  const target: [number, number, number] = [extents.center.x, TILE_HEIGHT * 0.5, extents.center.z];
  const cameraPosition: [number, number, number] = [
    extents.center.x,
    target[1] + fitDistance * 0.72,
    extents.center.z + fitDistance * 0.82,
  ];

  // Expected non-sea tile count — the verification note's "assert the expected number of tile
  // meshes" is checked against this in dev (`Board3DDebug`, below).
  const expectedTileCount = useMemo(() => {
    let n = 0;
    for (const hex of geometry.hexes) {
      const tile = board.hexes[hex.id];
      if (!tile) continue;
      const terrain: ScenarioTerrain = hexTerrain?.[hex.id] ?? tile.terrain;
      if (terrain !== 'sea') n++;
    }
    return n;
  }, [board, geometry, hexTerrain]);

  return (
    <Canvas
      shadows
      camera={{ position: cameraPosition, fov: fovDeg, near: 1, far: fitDistance * 8 }}
      className="h-full w-full"
      aria-label="HEXHAVEN 3D board"
    >
      <color attach="background" args={[SEA_DEEP]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight color={0xbfe0ff} groundColor={0x2f3a42} intensity={0.5} />
      <directionalLight
        position={[
          extents.center.x + fitDistance * 0.35,
          fitDistance * 0.95,
          extents.center.z + fitDistance * 0.25,
        ]}
        intensity={1.15}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={1}
        shadow-camera-far={fitDistance * 3}
        shadow-camera-left={-extents.radius * 1.6}
        shadow-camera-right={extents.radius * 1.6}
        shadow-camera-top={extents.radius * 1.6}
        shadow-camera-bottom={-extents.radius * 1.6}
      />
      <directionalLight
        position={[-fitDistance * 0.3, fitDistance * 0.35, -fitDistance * 0.2]}
        intensity={0.22}
      />

      <Sea geometry={geometry} />
      <HexTiles board={board} geometry={geometry} hexTerrain={hexTerrain} />

      {geometry.hexes.map((hex) => {
        const tile = board.hexes[hex.id];
        if (!tile) return null;
        const terrain: ScenarioTerrain = hexTerrain?.[hex.id] ?? tile.terrain;
        const tokenCenter = hexWorldCenter(hex, TILE_HEIGHT + TOKEN_HOVER);
        if (fogHexes.has(hex.id)) {
          const fogCenter = hexWorldCenter(hex, TILE_HEIGHT + TOKEN_HOVER * 0.4);
          return <FogCover key={`fog${hex.id}`} position={[fogCenter.x, fogCenter.y, fogCenter.z]} geometry={capGeometry} />;
        }
        if (hiddenNumbers) {
          if (terrain === 'desert' || terrain === 'sea') return null;
          return (
            <NumberToken3D
              key={`t${hex.id}`}
              position={[tokenCenter.x, tokenCenter.y, tokenCenter.z]}
              hidden
              dimmed={board.robber === hex.id}
            />
          );
        }
        if (tile.token == null) return null;
        return (
          <NumberToken3D
            key={`t${hex.id}`}
            position={[tokenCenter.x, tokenCenter.y, tokenCenter.z]}
            value={tile.token}
            dimmed={board.robber === hex.id}
          />
        );
      })}

      <OrbitControls
        target={target}
        enableDamping
        dampingFactor={0.08}
        minDistance={fitDistance * 0.35}
        maxDistance={fitDistance * 2.2}
        minPolarAngle={0.15}
        maxPolarAngle={1.45}
        enablePan
        screenSpacePanning={false}
      />

      {import.meta.env.DEV && <Board3DDebug expectedTileCount={expectedTileCount} />}
    </Canvas>
  );
}

/** Dev-only: stashes an object count on `window` so the implementer/PM can assert the scene actually
 *  contains the expected number of tile meshes without a DOM inspector (a `<canvas>` is opaque to
 *  one) — the task file's own suggested verification technique. Never rendered in a production
 *  build (`import.meta.env.DEV` is statically false there, so this whole branch is tree-shaken). */
function Board3DDebug({ expectedTileCount }: { expectedTileCount: number }) {
  const { scene } = useThree();
  useEffect(() => {
    let tileMeshCount = 0;
    let numberTokenCount = 0;
    scene.traverse((obj) => {
      if (obj instanceof InstancedMesh && obj.userData?.isHexTile) tileMeshCount += obj.count;
      if (obj.userData?.isNumberToken) numberTokenCount += 1;
    });
    (window as unknown as Record<string, unknown>).__HEXHAVEN_BOARD3D_DEBUG__ = {
      tileMeshCount,
      expectedTileCount,
      numberTokenCount,
    };
  }, [scene, expectedTileCount]);
  return null;
}
