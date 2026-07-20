// A small standing "peg" body topped with an optional billboarded glyph + a pinned ground shadow
// (T-1403 requirement 1: "piece-like overlays are small 3D models with shadows") — the one reusable
// shape behind every Traders & Barbarians piece-like marker that doesn't warrant its own bespoke
// silhouette (camels, path barbarians, hex-based barbarians, T&B's edge knights, wagons): a primitive
// cylinder (matching `PieceBodies.tsx`'s "three.js primitives only" discipline — this task, like
// T-1401, cannot be visually verified in this sandbox, so a hand-rotated custom shape is a needless
// risk where a primitive's built-in orientation isn't) plus `GlyphMarker3D` for the identifying
// pictogram/badge, mirroring the flat SVG board's own "colored coin + glyph" marker language
// (`TradersBarbariansPieces.tsx`'s `Camel`/`Barbarian`/`TbKnight`/`Wagon`).
import { DoubleSide } from 'three';
import { GlyphMarker3D } from './GlyphMarker3D';

export interface StandingBadge3DProps {
  /** Ground anchor (already at the tile-top elevation, e.g. `TILE_HEIGHT`) — the peg's base sits
   *  exactly here, its own shadow ellipse pinned to this same point. */
  position: readonly [number, number, number];
  /** How tall (world Y) the peg stands above `position`. */
  standHeight: number;
  bodyRadius: number;
  bodyColor: string;
  /** Omit (or pass an empty string) to render a plain peg with no glyph billboard on top — the path
   *  barbarian marker (§TB6.3), which the flat SVG board also draws as a bare colored dot. */
  glyph?: string;
  glyphRadius?: number;
  glyphTextColor?: string;
  glyphStroke?: string;
  /** Extra pip dots on the glyph disc (Cities & Knights knight level parity, if reused there). */
  pips?: number;
  shadow?: boolean;
}

export function StandingBadge3D({
  position,
  standHeight,
  bodyRadius,
  bodyColor,
  glyph = '',
  glyphRadius,
  glyphTextColor = '#f7f1e3',
  glyphStroke,
  pips = 0,
  shadow = true,
}: StandingBadge3DProps) {
  const [x, y, z] = position;
  const bodyCenterY = y + standHeight / 2;
  const badgeRadius = glyphRadius ?? bodyRadius * 1.15;
  return (
    <group>
      {shadow && (
        <mesh position={[x, y + 0.001, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => undefined}>
          <circleGeometry args={[bodyRadius * 1.35, 16]} />
          <meshBasicMaterial color="#000000" transparent opacity={0.22} depthWrite={false} />
        </mesh>
      )}
      <mesh castShadow receiveShadow position={[x, bodyCenterY, z]}>
        <cylinderGeometry args={[bodyRadius, bodyRadius * 1.08, standHeight, 14]} />
        <meshStandardMaterial color={bodyColor} roughness={0.68} metalness={0.05} side={DoubleSide} />
      </mesh>
      {glyph ? (
        <GlyphMarker3D
          position={[x, y + standHeight + badgeRadius * 0.9, z]}
          radius={badgeRadius}
          glyph={glyph}
          fill={bodyColor}
          textColor={glyphTextColor}
          stroke={glyphStroke ?? '#00000066'}
          pips={pips}
        />
      ) : null}
    </group>
  );
}
