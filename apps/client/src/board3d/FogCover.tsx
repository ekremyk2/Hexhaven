// A still-unexplored hex's fog cover (T-1400 requirement 5 — "honor epUnexplored/fog at least
// minimally"). Mirrors `BoardView.tsx`'s flat fog polygon: a translucent misty disc sized to the
// tile's own silhouette (`hexGeometryBuilders.ts`'s shared cap geometry, so it lines up with the tile
// exactly) sitting just above the terrain a viewer isn't meant to see yet.
//
// T-1403 requirement 2 ("parity with the SVG `?` fog"): the flat board draws a bold "?" glyph
// centered on every fogged hex (`BoardView.tsx`'s own `FOG_GLYPH`) so a still-unexplored tile reads as
// an unmistakable cover rather than a plain dark hex — this adds the same glyph here, via a
// billboarded `GlyphMarker3D` (T-1403's shared canvas-texture marker) floating just above the mist
// disc so it always faces the camera regardless of orbit angle.
import { DoubleSide, type BufferGeometry } from 'three';
import { FOG_MIST } from '../board/palette';
import { GlyphMarker3D } from './overlays/GlyphMarker3D';
import { TOKEN_RADIUS } from './constants';

const FOG_GLYPH = '?';

export function FogCover({
  position,
  geometry,
}: {
  position: readonly [number, number, number];
  geometry: BufferGeometry;
}) {
  return (
    <group userData={{ isFogCover: true }}>
      <mesh position={[position[0], position[1], position[2]]} geometry={geometry}>
        <meshBasicMaterial color={FOG_MIST} transparent opacity={0.82} side={DoubleSide} depthWrite={false} />
      </mesh>
      <GlyphMarker3D
        position={[position[0], position[1] + 0.01, position[2]]}
        radius={TOKEN_RADIUS * 0.9}
        glyph={FOG_GLYPH}
        fill="none"
        textColor="#f7f1e3"
      />
    </group>
  );
}
