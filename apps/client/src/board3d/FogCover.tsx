// A still-unexplored hex's fog cover (T-1400 requirement 5 — "honor epUnexplored/fog at least
// minimally"; full fog polish is T-1403). Mirrors `BoardView.tsx`'s flat fog polygon: a translucent
// misty disc sized to the tile's own silhouette (`hexGeometryBuilders.ts`'s shared cap geometry, so
// it lines up with the tile exactly) sitting just above the terrain a viewer isn't meant to see yet.
import { DoubleSide, type BufferGeometry } from 'three';
import { FOG_MIST } from '../board/palette';

export function FogCover({
  position,
  geometry,
}: {
  position: readonly [number, number, number];
  geometry: BufferGeometry;
}) {
  return (
    <mesh position={[position[0], position[1], position[2]]} geometry={geometry} userData={{ isFogCover: true }}>
      <meshBasicMaterial color={FOG_MIST} transparent opacity={0.82} side={DoubleSide} depthWrite={false} />
    </mesh>
  );
}
