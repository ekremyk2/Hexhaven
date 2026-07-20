// Traders & Barbarians board overlays in 3D (T-1403), the WebGL counterpart of
// `board/TradersBarbariansPieces.tsx`. Same prop shape as the SVG version (already flattened by
// `tradersBarbarians/tbHelpers.ts`/`Game.tsx`) so every scenario (Fishermen/Rivers/Caravans/Barbarian
// Attack/the main scenario) is fed identically to both renderers — gated so base/fiveSix/Seafarers/
// C&K rendering stays untouched (RK-13), mirroring the SVG file's own gating discipline (T&B never
// combines with those, TB8.1).
//
// Per requirement 1: flat-on-tile decoration (lake/oasis glyphs, fishing-ground tokens, river/route
// lines, trade-hex glyphs) sits at the tile top with no standing height; piece-like markers (bridges,
// camels, hex-based barbarians, edge knights, wagons, path barbarians) stand raised with a pinned
// ground shadow via `StandingBadge3D` (T-1403's shared reusable peg), materials consistent with
// `PieceBodies.tsx` (T-1401).
import { DoubleSide } from 'three';
import { GEOMETRY, type BoardGeometry, type EdgeId, type HexId, type Seat, type VertexId } from '@hexhaven/shared';
import { HEX_SIZE, PLAYER_BADGES, PLAYER_COLORS, contrastInk, darken, lighten } from '../../board/palette';
import {
  TB_BARBARIAN_COLOR,
  TB_CAMEL_COLOR,
  TB_LAKE_COLOR,
  TB_OASIS_COLOR,
  TB_RIVER_COLOR,
  TB_TRADE_HEX_COLOR,
} from '../../board/tradersBarbariansPalette';
import { edgeWorldPosition, hexWorldCenter, vertexWorldPosition } from '../coords';
import { TILE_HEIGHT, TOKEN_HOVER } from '../constants';
import { GlyphMarker3D } from './GlyphMarker3D';
import { averageXZ, ringFanOffset } from './overlayGeometry';
import { StandingBadge3D } from './StandingBadge3D';

const S = HEX_SIZE;

// Decorative pictograms — mirrors `TradersBarbariansPieces.tsx`'s own module-level glyph constants
// exactly (not i18n text; always paired with a translated label elsewhere in the HUD).
const LAKE_GLYPH = '🌊';
const OASIS_GLYPH = '🌴';
const BARBARIAN_GLYPH = '⚔️';
const CAMEL_GLYPH = '🐫';
const TRADE_HEX_GLYPH: Record<'quarry' | 'glassworks' | 'castle', string> = {
  quarry: '⛏️',
  glassworks: '🔥',
  castle: '🏰',
};

// Standing heights/radii (the `HEX_SIZE`-fraction convention `PieceBodies.tsx`/
// `CitiesKnightsOverlay3D.tsx` both use for piece-like markers).
const BRIDGE_HEIGHT = S * 0.14;
const BRIDGE_LEN = S * 0.7;
const BRIDGE_WIDTH = S * 0.2;
const CAMEL_HEIGHT = S * 0.22;
const CAMEL_RADIUS = S * 0.15;
const BARBARIAN_HEIGHT = S * 0.26;
const BARBARIAN_RADIUS = S * 0.14;
const BARBARIAN_FAN_RADIUS = S * 0.22;
const TB_KNIGHT_HEIGHT = S * 0.3;
const TB_KNIGHT_RADIUS = S * 0.15;
const PATH_BARBARIAN_HEIGHT = S * 0.18;
const PATH_BARBARIAN_RADIUS = S * 0.11;
const WAGON_HEIGHT = S * 0.3;
const WAGON_RADIUS = S * 0.17;

const WALL_DARKEN = 0.4;
const ROOF_LIGHTEN = 0.34;

export interface TradersBarbariansOverlay3DProps {
  geometry?: BoardGeometry;
  lakeHex?: HexId | null;
  fishingGrounds?: { token: number; vertices: readonly VertexId[] }[];
  riverEdges?: readonly EdgeId[];
  bridges?: { edge: EdgeId; seat: Seat }[];
  oasisHex?: HexId | null;
  routeEdges?: readonly EdgeId[];
  camels?: readonly EdgeId[];
  barbarianHexes?: readonly HexId[];
  tbKnights?: { edge: EdgeId; seat: Seat; active: boolean }[];
  tradeHexes?: { hex: HexId; kind: 'quarry' | 'glassworks' | 'castle' }[];
  wagons?: { at: VertexId; seat: Seat; cargo: string | null }[];
  pathBarbarians?: readonly EdgeId[];
}

export function TradersBarbariansOverlay3D({
  geometry = GEOMETRY,
  lakeHex = null,
  fishingGrounds = [],
  riverEdges = [],
  bridges = [],
  oasisHex = null,
  routeEdges = [],
  camels = [],
  barbarianHexes = [],
  tbKnights = [],
  tradeHexes = [],
  wagons = [],
  pathBarbarians = [],
}: TradersBarbariansOverlay3DProps) {
  const hexOf = (id: HexId) => {
    const h = geometry.hexes[id];
    if (!h) throw new Error(`BUG: TradersBarbariansOverlay3D hex ${id}`);
    return h;
  };
  const vertexOf = (id: VertexId) => {
    const v = geometry.vertices[id];
    if (!v) throw new Error(`BUG: TradersBarbariansOverlay3D vertex ${id}`);
    return v;
  };
  const edgeOf = (id: EdgeId) => {
    const e = geometry.edges[id];
    if (!e) throw new Error(`BUG: TradersBarbariansOverlay3D edge ${id}`);
    return e;
  };

  const fogHover = TILE_HEIGHT + TOKEN_HOVER;

  return (
    <group>
      {/* Fishermen: Lake glyph + fishing-ground tokens (§TB2.1/§TB2.2) — flat decoration. */}
      {lakeHex != null &&
        (() => {
          const c = hexWorldCenter(hexOf(lakeHex), fogHover);
          return <GlyphMarker3D position={[c.x, c.y, c.z]} radius={S * 0.32} glyph={LAKE_GLYPH} fill={TB_LAKE_COLOR} fillOpacity={0.55} />;
        })()}
      {fishingGrounds.map((g, i) => {
        const points = g.vertices.map((vid) => vertexWorldPosition(vertexOf(vid)));
        const avg = averageXZ(points);
        return (
          <GlyphMarker3D
            key={`fg${i}`}
            position={[avg.x, fogHover, avg.z]}
            radius={S * 0.17}
            glyph={String(g.token)}
            fill={TB_LAKE_COLOR}
            fillOpacity={0.5}
          />
        );
      })}

      {/* Rivers: river edges (faint, flat) + bridges (piece-like, §TB3.1/§TB3.2). */}
      {riverEdges.map((edgeId) => (
        <FlatEdgeLine
          key={`riv${edgeId}`}
          edge={edgeOf(edgeId)}
          length={S * 0.66}
          width={S * 0.1}
          color={TB_RIVER_COLOR}
          opacity={0.7}
        />
      ))}
      {bridges.map(({ edge, seat }) => {
        const w = edgeWorldPosition(edgeOf(edge), TILE_HEIGHT + BRIDGE_HEIGHT);
        return <Bridge3D key={`br${edge}`} position={[w.x, w.y, w.z]} rotationY={w.rotationY} seat={seat} />;
      })}

      {/* Caravans: Oasis glyph (flat) + route edges (faint, flat) + placed camels (piece-like). */}
      {oasisHex != null &&
        (() => {
          const c = hexWorldCenter(hexOf(oasisHex), fogHover);
          return <GlyphMarker3D position={[c.x, c.y, c.z]} radius={S * 0.32} glyph={OASIS_GLYPH} fill={TB_OASIS_COLOR} fillOpacity={0.6} />;
        })()}
      {routeEdges.map((edgeId) => (
        <FlatEdgeLine
          key={`rt${edgeId}`}
          edge={edgeOf(edgeId)}
          length={S * 0.6}
          width={S * 0.05}
          color={TB_CAMEL_COLOR}
          opacity={0.5}
        />
      ))}
      {camels.map((edgeId) => {
        const e = edgeOf(edgeId);
        const g = edgeWorldPosition(e, TILE_HEIGHT);
        return (
          <StandingBadge3D
            key={`cm${edgeId}`}
            position={[g.x, g.y, g.z]}
            standHeight={CAMEL_HEIGHT}
            bodyRadius={CAMEL_RADIUS}
            bodyColor={TB_CAMEL_COLOR}
            glyph={CAMEL_GLYPH}
          />
        );
      })}

      {/* Barbarian Attack: barbarians on hexes (fanned when 2+ share one) + edge-based knights. */}
      {barbarianHexes.map((hexId, i) => {
        const sameHex = barbarianHexes.filter((h) => h === hexId);
        const indexInHex = barbarianHexes.slice(0, i).filter((h) => h === hexId).length;
        const c = hexWorldCenter(hexOf(hexId), TILE_HEIGHT);
        const { dx, dz } = ringFanOffset(indexInHex, sameHex.length, BARBARIAN_FAN_RADIUS);
        return (
          <StandingBadge3D
            key={`ba${hexId}-${i}`}
            position={[c.x + dx, c.y, c.z + dz]}
            standHeight={BARBARIAN_HEIGHT}
            bodyRadius={BARBARIAN_RADIUS}
            bodyColor={TB_BARBARIAN_COLOR}
            glyph={BARBARIAN_GLYPH}
          />
        );
      })}
      {tbKnights.map(({ edge, seat, active }) => {
        const g = edgeWorldPosition(edgeOf(edge), TILE_HEIGHT);
        return (
          <StandingBadge3D
            key={`tk${edge}`}
            position={[g.x, g.y, g.z]}
            standHeight={TB_KNIGHT_HEIGHT}
            bodyRadius={TB_KNIGHT_RADIUS}
            bodyColor={active ? PLAYER_COLORS[seat] : '#6b5f47'}
            glyph={PLAYER_BADGES[seat]}
            glyphTextColor={contrastInk(seat)}
            glyphStroke={PLAYER_COLORS[seat]}
          />
        );
      })}

      {/* The main scenario: trade hexes (flat) + wagons (piece-like) + path barbarians (piece-like). */}
      {tradeHexes.map((th) => {
        const c = hexWorldCenter(hexOf(th.hex), fogHover);
        return (
          <GlyphMarker3D
            key={`th${th.hex}`}
            position={[c.x, c.y, c.z]}
            radius={S * 0.3}
            glyph={TRADE_HEX_GLYPH[th.kind]}
            fill={TB_TRADE_HEX_COLOR[th.kind]}
            fillOpacity={0.6}
          />
        );
      })}
      {pathBarbarians.map((edgeId) => {
        const g = edgeWorldPosition(edgeOf(edgeId), TILE_HEIGHT);
        return (
          <StandingBadge3D
            key={`pb${edgeId}`}
            position={[g.x, g.y, g.z]}
            standHeight={PATH_BARBARIAN_HEIGHT}
            bodyRadius={PATH_BARBARIAN_RADIUS}
            bodyColor={TB_BARBARIAN_COLOR}
          />
        );
      })}
      {wagons.map((w, i) => {
        const g = vertexWorldPosition(vertexOf(w.at), TILE_HEIGHT);
        return (
          <StandingBadge3D
            key={`wg${w.at}-${i}`}
            position={[g.x, g.y, g.z]}
            standHeight={WAGON_HEIGHT}
            bodyRadius={WAGON_RADIUS}
            bodyColor={PLAYER_COLORS[w.seat]}
            glyph={w.cargo != null ? '📦' : PLAYER_BADGES[w.seat]}
            glyphTextColor={contrastInk(w.seat)}
          />
        );
      })}
    </group>
  );
}

/** A flat, faint line along an edge (river/route decoration) — a thin box lying on the tile top,
 *  oriented via the edge's own `rotationY` (T-1400's `coords.ts` convention), no standing height. */
function FlatEdgeLine({
  edge,
  length,
  width,
  color,
  opacity,
}: {
  edge: Parameters<typeof edgeWorldPosition>[0];
  length: number;
  width: number;
  color: string;
  opacity: number;
}) {
  const w = edgeWorldPosition(edge, TILE_HEIGHT + 0.01);
  return (
    <group position={[w.x, w.y, w.z]} rotation={[0, w.rotationY, 0]}>
      <mesh raycast={() => undefined}>
        <boxGeometry args={[length, width * 0.4, width]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.8} metalness={0} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** A bridge (§TB3.2) — a two-tone extruded bar spanning the edge, mirroring `PieceBodies.tsx`'s
 *  `RoadBody` two-tone shading (a darker underside + a lit top face, both derived from the owner's
 *  seat color). Piece-like (raised `BRIDGE_HEIGHT` above the river), unlike the flat river line under
 *  it. */
function Bridge3D({
  position,
  rotationY,
  seat,
}: {
  position: readonly [number, number, number];
  rotationY: number;
  seat: Seat;
}) {
  const [x, y, z] = position;
  const color = PLAYER_COLORS[seat];
  const height = S * 0.08;
  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]} userData={{ isBridge: true, seat }}>
      <mesh castShadow receiveShadow position={[0, -height * 0.3, 0]}>
        <boxGeometry args={[BRIDGE_LEN, height, BRIDGE_WIDTH]} />
        <meshStandardMaterial color={darken(color, WALL_DARKEN)} roughness={0.7} metalness={0.05} side={DoubleSide} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, height * 0.2, 0]}>
        <boxGeometry args={[BRIDGE_LEN, height * 0.6, BRIDGE_WIDTH]} />
        <meshStandardMaterial color={lighten(color, ROOF_LIGHTEN)} roughness={0.65} metalness={0.05} side={DoubleSide} />
      </mesh>
    </group>
  );
}
