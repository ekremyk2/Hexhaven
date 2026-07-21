// T-1505 requirement 5 — 3D harbors. The flat SVG board (`board/BoardView.tsx`) already draws every
// `board.harbors` edge as a dock + ratio/resource token; the WebGL board never did (this is new). Each
// harbor renders as a sculpted ship or lighthouse model (`terrainStlModels.ts`'s `pickHarborVariant`,
// deterministic per edge) at the position/orientation `harborPlacement.ts` computes (pure, and unit-
// tested there), plus a billboarded ratio + resource-icon label (reusing `GlyphMarker3D`, the same
// canvas-texture marker `FogCover.tsx`/T-903 hex pieces use) so the 3:1/2:1 trade ratio stays legible
// at any camera angle.
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import { useLoader } from '@react-three/fiber';
import { DoubleSide } from 'three';
import type { BoardGeometry, GameState, HarborType, ScenarioTerrain } from '@hexhaven/shared';
import { RESOURCE_GLYPH } from '../../hud/constants';
import { TOKEN_RADIUS } from '../constants';
import { computeHarborPlacements, type HarborPlacement } from '../harborPlacement';
import { hexYaw, modelHeight, TerrainSTLLoader } from '../terrainStlModels';
import { GlyphMarker3D } from './GlyphMarker3D';

type BoardState = GameState['board'];

/** A single flat tint for every harbor model (user: single colour, no multicolour — same convention
 *  `HexTiles.tsx`'s STL terrain tiles use) — a warm wood/hull tone matching the flat board's own
 *  harbor dock line colour (`BoardView.tsx`'s `stroke="#8a6a42"`) so the two renderers read as the
 *  same game piece. */
const HARBOR_TILE_COLOR = '#8a6a42';

const GENERIC_LABEL_FILL = '#efe4c6';
const GENERIC_LABEL_TEXT = '#2b2416'; // matches board/palette.ts's INK

export interface Harbors3DProps {
  board: Pick<BoardState, 'harbors' | 'hexes'>;
  geometry: Pick<BoardGeometry, 'edges' | 'hexes'>;
  hexTerrain?: readonly ScenarioTerrain[];
}

export function Harbors3D({ board, geometry, hexTerrain }: Harbors3DProps) {
  const placements = useMemo(
    () => computeHarborPlacements(board, geometry, hexTerrain),
    [board, geometry, hexTerrain],
  );

  return (
    <group>
      {placements.map((placement) => (
        <HarborTile key={`harbor${placement.edgeId}`} placement={placement} />
      ))}
    </group>
  );
}

/** Mirrors `HexTiles.tsx`'s `TerrainFallbackBoundary` (`useLoader` needs an error boundary above it)
 *  but with no visible fallback: a harbor is a small decorative accent, not load-bearing board state
 *  (unlike a terrain tile going invisible), so simply not rendering it on failure is an acceptable
 *  degrade rather than needing its own procedural stand-in model. */
class HarborFallbackBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function HarborModelMesh({ url }: { url: string }) {
  const geometry = useLoader(TerrainSTLLoader, url);
  return (
    <mesh castShadow receiveShadow geometry={geometry}>
      <meshStandardMaterial color={HARBOR_TILE_COLOR} roughness={0.75} metalness={0.05} side={DoubleSide} />
    </mesh>
  );
}

function HarborRatioLabel({ type, height }: { type: HarborType; height: number }) {
  const label = type === 'generic' ? '3:1' : '2:1';
  const labelY = height + TOKEN_RADIUS * 0.5;
  if (type === 'generic') {
    return (
      <GlyphMarker3D
        position={[0, labelY, 0]}
        radius={TOKEN_RADIUS * 0.85}
        glyph={label}
        fill={GENERIC_LABEL_FILL}
        fillOpacity={0.92}
        textColor={GENERIC_LABEL_TEXT}
      />
    );
  }
  // Resource harbor: icon above the ratio (mirrors BoardView.tsx's two-line "icon over 2:1" layout).
  return (
    <group>
      <GlyphMarker3D
        position={[0, labelY + TOKEN_RADIUS * 0.55, 0]}
        radius={TOKEN_RADIUS * 0.7}
        glyph={RESOURCE_GLYPH[type]}
        fill="none"
      />
      <GlyphMarker3D
        position={[0, labelY, 0]}
        radius={TOKEN_RADIUS * 0.6}
        glyph={label}
        fill={GENERIC_LABEL_FILL}
        fillOpacity={0.92}
        textColor={GENERIC_LABEL_TEXT}
        fontSize={TOKEN_RADIUS * 0.5}
      />
    </group>
  );
}

function HarborTile({ placement }: { placement: HarborPlacement }) {
  const { position, rotationStep, variant, type } = placement;
  const yaw = hexYaw(rotationStep);
  const height = modelHeight(variant);
  return (
    <group position={[position.x, position.y, position.z]}>
      <HarborFallbackBoundary>
        <Suspense fallback={null}>
          <group rotation={[0, yaw, 0]}>
            <HarborModelMesh url={variant.url} />
          </group>
        </Suspense>
      </HarborFallbackBoundary>
      <HarborRatioLabel type={type} height={height} />
    </group>
  );
}
