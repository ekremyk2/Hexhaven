// The sea plane surrounding the island (T-1400 requirement 3). Sized off `coords.ts`'s
// `boardWorldExtents` (bounding radius of the actual board) rather than a hardcoded size, so it
// scales with every board (base 19 -> EXT56 30 -> Seafarers/E&P 37+). `side={DoubleSide}` is a
// deliberate defensive choice (see `Board3D.tsx`'s top-of-file note): this task can't be visually
// verified in this sandbox, so every surface guards against an invisible-due-to-winding mistake
// rather than risk a silently blank ocean.
//
// T-1404 materials polish: a tiled procedural wave-streak texture (`terrainTexture.ts`'s 'sea'
// entry) gives the water a "not flat plastic" surface — `repeat` is set here (not in
// `terrainTexture.ts`) because it depends on THIS plane's own real-world size, unlike every land
// terrain's single untiled tile texture.
import { useMemo } from 'react';
import { DoubleSide } from 'three';
import type { BoardGeometry } from '@hexhaven/shared';
import { boardWorldExtents } from './coords';
import { SEA_DEPTH, SEA_MARGIN_FACTOR } from './constants';
import { terrainSurfaceTextures } from './terrainTexture';

/** How many texture repeats span the sea plane's full width — a smallish tile count keeps the wave
 *  streaks legible up close without the pattern reading as a single stretched-out smear. */
const SEA_TEXTURE_TILES = 10;

export function Sea({ geometry }: { geometry: Pick<BoardGeometry, 'hexes'> }) {
  const extents = useMemo(() => boardWorldExtents(geometry), [geometry]);
  const size = extents.radius * SEA_MARGIN_FACTOR;
  const { color, bump } = useMemo(() => terrainSurfaceTextures('sea'), []);
  useMemo(() => {
    for (const t of [color, bump]) t.repeat.set(SEA_TEXTURE_TILES, SEA_TEXTURE_TILES);
  }, [color, bump]);

  return (
    <mesh
      position={[extents.center.x, -SEA_DEPTH, extents.center.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      userData={{ isSea: true }}
    >
      <planeGeometry args={[size, size, 24, 24]} />
      <meshStandardMaterial
        map={color}
        bumpMap={bump}
        bumpScale={0.5}
        roughnessMap={bump}
        roughness={0.35}
        metalness={0.1}
        side={DoubleSide}
      />
    </mesh>
  );
}
