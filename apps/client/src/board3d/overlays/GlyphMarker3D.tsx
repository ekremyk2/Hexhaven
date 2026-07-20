// A billboarded glyph disc (T-1403) — the shared building block for every FLAT-on-tile overlay marker
// (island chits, T-903 hex pieces, Traders & Barbarians' lake/oasis/fishing-ground/trade-hex glyphs,
// Explorers & Pirates' harbor-settlement anchor badge). Mirrors `NumberToken3D.tsx`'s own
// `<Billboard><mesh><planeGeometry/><meshBasicMaterial map={texture}/></mesh></Billboard>` shape
// exactly (T-1400's established "always face the camera" convention for board-plane glyphs), just
// backed by `glyphTexture.ts`'s generic drawer instead of the number-token-specific one.
import { Billboard } from '@react-three/drei';
import { useMemo } from 'react';
import { DoubleSide } from 'three';
import { glyphDiscTexture, type GlyphDiscOptions } from './glyphTexture';

export interface GlyphMarker3DProps extends GlyphDiscOptions {
  position: readonly [number, number, number];
  /** World-unit radius of the billboarded disc/plane. */
  radius: number;
}

export function GlyphMarker3D({
  position,
  radius,
  glyph,
  fill,
  fillOpacity,
  stroke,
  strokeWidth,
  textColor,
  fontSize,
  fontWeight,
  pips,
  pipColor,
}: GlyphMarker3DProps) {
  const texture = useMemo(
    () => glyphDiscTexture({ glyph, fill, fillOpacity, stroke, strokeWidth, textColor, fontSize, fontWeight, pips, pipColor }),
    [glyph, fill, fillOpacity, stroke, strokeWidth, textColor, fontSize, fontWeight, pips, pipColor],
  );
  return (
    <Billboard position={[position[0], position[1], position[2]]}>
      <mesh userData={{ isGlyphMarker: true }}>
        <planeGeometry args={[radius * 2, radius * 2]} />
        <meshBasicMaterial map={texture} transparent side={DoubleSide} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}
