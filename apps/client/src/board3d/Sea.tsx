// The sea plane surrounding the island (T-1400 requirement 3). Sized off `coords.ts`'s
// `boardWorldExtents` (bounding radius of the actual board) rather than a hardcoded size, so it
// scales with every board (base 19 -> EXT56 30 -> Seafarers/E&P 37+). `side={DoubleSide}` is a
// deliberate defensive choice (see `Board3D.tsx`'s top-of-file note): this task can't be visually
// verified in this sandbox, so every surface guards against an invisible-due-to-winding mistake
// rather than risk a silently blank ocean.
import { useMemo } from 'react';
import { DoubleSide } from 'three';
import type { BoardGeometry } from '@hexhaven/shared';
import { SEA } from '../board/palette';
import { boardWorldExtents } from './coords';
import { SEA_DEPTH, SEA_MARGIN_FACTOR } from './constants';

export function Sea({ geometry }: { geometry: Pick<BoardGeometry, 'hexes'> }) {
  const extents = useMemo(() => boardWorldExtents(geometry), [geometry]);
  const size = extents.radius * SEA_MARGIN_FACTOR;
  return (
    <mesh
      position={[extents.center.x, -SEA_DEPTH, extents.center.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
      userData={{ isSea: true }}
    >
      <planeGeometry args={[size, size, 24, 24]} />
      <meshStandardMaterial color={SEA} roughness={0.35} metalness={0.1} side={DoubleSide} />
    </mesh>
  );
}
