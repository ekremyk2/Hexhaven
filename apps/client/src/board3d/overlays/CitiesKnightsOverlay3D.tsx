// Cities & Knights board overlays in 3D (T-1403), the WebGL counterpart of
// `board/CitiesKnightsPieces.tsx`. Same prop shape as the SVG version (`knights`/`walls`/
// `metropolises`, already flattened by `citiesKnights/ckHelpers.ts`) so `Game.tsx` feeds this from the
// exact same values it computes for the SVG branch — positioned via `coords.ts` (T-1400), materials
// consistent with `PieceBodies.tsx` (T-1401: `roughness`/`metalness` defaults, `darken`/`lighten`
// two-tone shading, `side={DoubleSide}` everywhere per that file's defensive-rendering rationale).
//
// Per requirement 1: city walls are flat-on-ground (a stone ring set INTO the tile, C9.1's "built
// under a city" — no shadow, no standing height); knights and the metropolis gate are piece-like
// (raised, cast/receive shadows).
import { DoubleSide } from 'three';
import { GEOMETRY, type BoardGeometry, type ImprovementTrack, type KnightLevel, type Seat, type VertexId } from '@hexhaven/shared';
import { HEX_SIZE, PLAYER_BADGES, PLAYER_COLORS, contrastInk, darken, lighten } from '../../board/palette';
import { KNIGHT_INACTIVE_FILL, TRACK_COLOR, WALL_FILL, WALL_STROKE } from '../../board/citiesKnightsPalette';
import { vertexWorldPosition } from '../coords';
import { TILE_HEIGHT } from '../constants';
import { GlyphMarker3D } from './GlyphMarker3D';

const S = HEX_SIZE;
const MATERIAL_DEFAULTS = { roughness: 0.72, metalness: 0.06 } as const;

// Standing heights, in the same "small magnitude relative to a tile" convention `PieceBodies.tsx`'s
// own constants use (a fraction of `HEX_SIZE`, NOT `TILE_HEIGHT`, which is the much larger per-tile
// prism scale — see that file's header note).
const KNIGHT_HEIGHT = S * 0.32;
const KNIGHT_RADIUS = S * 0.16;
const WALL_RADIUS = S * 0.32;
const WALL_TUBE = S * 0.055;
const METROPOLIS_TOWER_H = S * 0.32;
const METROPOLIS_TOWER_R = S * 0.045;
const METROPOLIS_SPAN = S * 0.36;

export interface CitiesKnightsOverlay3DProps {
  geometry?: BoardGeometry;
  knights?: { vertex: VertexId; seat: Seat; level: KnightLevel; active: boolean }[];
  walls?: { vertex: VertexId; seat: Seat }[];
  metropolises?: { vertex: VertexId; track: ImprovementTrack }[];
}

export function CitiesKnightsOverlay3D({
  geometry = GEOMETRY,
  knights = [],
  walls = [],
  metropolises = [],
}: CitiesKnightsOverlay3DProps) {
  const vertexOf = (id: VertexId) => {
    const v = geometry.vertices[id];
    if (!v) throw new Error(`BUG: CitiesKnightsOverlay3D vertex ${id}`);
    return v;
  };

  return (
    <group>
      {walls.map(({ vertex: vid, seat }, i) => {
        const p = vertexWorldPosition(vertexOf(vid), TILE_HEIGHT);
        return <CityWall3D key={`wl${vid}-${i}`} position={[p.x, p.y, p.z]} vertex={vid} seat={seat} />;
      })}

      {knights.map(({ vertex: vid, seat, level, active }, i) => {
        const p = vertexWorldPosition(vertexOf(vid), TILE_HEIGHT);
        return (
          <KnightBody3D
            key={`kn${vid}-${i}`}
            position={[p.x, p.y, p.z]}
            vertex={vid}
            seat={seat}
            level={level}
            active={active}
          />
        );
      })}

      {metropolises.map(({ vertex: vid, track }, i) => {
        const p = vertexWorldPosition(vertexOf(vid), TILE_HEIGHT);
        return <Metropolis3D key={`me${vid}-${i}`} position={[p.x, p.y, p.z]} vertex={vid} track={track} />;
      })}
    </group>
  );
}

/** A city wall (C9.1) — a stone ring lying flat on the tile (height 0 above ground, no shadow — a
 *  real wall is set into the plane it stands on, not raised off it). Two concentric tori (a darker
 *  outline ring behind a lighter fill ring) mirror the SVG `CityWall`'s stroke-then-fill double path. */
function CityWall3D({
  position,
  vertex,
  seat,
}: {
  position: readonly [number, number, number];
  vertex: VertexId;
  seat: Seat;
}) {
  const [x, y, z] = position;
  return (
    <group userData={{ isCityWall: true, vertex, seat }}>
      <mesh position={[x, y + 0.002, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <torusGeometry args={[WALL_RADIUS, WALL_TUBE * 1.35, 8, 24]} />
        <meshStandardMaterial color={WALL_STROKE} roughness={0.85} metalness={0.05} side={DoubleSide} />
      </mesh>
      <mesh position={[x, y + 0.004, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <torusGeometry args={[WALL_RADIUS, WALL_TUBE, 8, 24]} />
        <meshStandardMaterial color={WALL_FILL} roughness={0.8} metalness={0.05} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** A knight (C7.1) — a shield-like standing box, distinct from `PieceBodies.tsx`'s settlement/city/
 *  road/ship silhouettes so all the board's piece kinds still read apart in 3D. Active knights stand
 *  in full owner color; inactive knights render in the desaturated `KNIGHT_INACTIVE_FILL` (the
 *  physical piece's "black & white side", C7.1/C7.5) while the badge + level pips keep the owner's
 *  color, mirroring `CitiesKnightsPieces.tsx`'s `KnightPiece` exactly. */
function KnightBody3D({
  position,
  vertex,
  seat,
  level,
  active,
}: {
  position: readonly [number, number, number];
  vertex: VertexId;
  seat: Seat;
  level: KnightLevel;
  active: boolean;
}) {
  const [x, y, z] = position;
  const ownerColor = PLAYER_COLORS[seat];
  const fill = active ? ownerColor : KNIGHT_INACTIVE_FILL;
  const badgeTextColor = active ? contrastInk(seat) : '#f7f1e3';
  const bodyH = KNIGHT_HEIGHT;
  const bodyW = KNIGHT_RADIUS * 1.7;
  return (
    <group userData={{ isKnight: true, vertex, seat, level, active }}>
      <mesh position={[x, y + 0.001, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => undefined}>
        <circleGeometry args={[KNIGHT_RADIUS * 1.5, 14]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh castShadow receiveShadow position={[x, y + bodyH / 2, z]}>
        <boxGeometry args={[bodyW, bodyH, bodyW * 0.55]} />
        <meshStandardMaterial color={fill} {...MATERIAL_DEFAULTS} side={DoubleSide} />
      </mesh>
      {/* Roof-like cap so the shield reads as tapering, mirroring the SVG shield's pointed base with a
          pointed TOP cap instead (a downward-camera-friendly read in 3D). */}
      <mesh castShadow receiveShadow position={[x, y + bodyH + bodyW * 0.14, z]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[bodyW * 0.62, bodyW * 0.28, 4]} />
        <meshStandardMaterial color={lighten(fill, 0.2)} roughness={0.65} metalness={0.04} side={DoubleSide} />
      </mesh>
      <GlyphMarker3D
        position={[x, y + bodyH + bodyW * 0.65, z]}
        radius={KNIGHT_RADIUS * 0.85}
        glyph={PLAYER_BADGES[seat]}
        fill={fill}
        textColor={badgeTextColor}
        stroke={darken(fill, 0.3)}
        pips={level}
        pipColor={badgeTextColor}
      />
    </group>
  );
}

/** The metropolis "gates" adornment (C4.6) — two thin track-colored towers bridged by a half-torus
 *  arch, floating above the city it marks (approximation documented on `CitiesKnightsOverlay3DProps`'
 *  SVG counterpart: the caller resolves which of the owner's cities anchors this). Color-coded by
 *  track (`TRACK_COLOR`) so all three metropolises stay distinguishable without checking ownership. */
function Metropolis3D({
  position,
  vertex,
  track,
}: {
  position: readonly [number, number, number];
  vertex: VertexId;
  track: ImprovementTrack;
}) {
  const [x, y, z] = position;
  const color = TRACK_COLOR[track];
  // Perched above where a city's own raised tower-top would sit (Pieces3D/PieceBodies' CityBody
  // stands roughly `S * 0.34 + S * 0.3` tall) — floats just above that so it reads as crowning the
  // city rather than colliding with it.
  const baseY = y + S * 0.72;
  const archRadius = METROPOLIS_SPAN / 2;
  return (
    <group userData={{ isMetropolis: true, vertex, track }}>
      <mesh castShadow position={[x - archRadius, baseY, z]}>
        <cylinderGeometry args={[METROPOLIS_TOWER_R, METROPOLIS_TOWER_R, METROPOLIS_TOWER_H, 8]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.25} side={DoubleSide} />
      </mesh>
      <mesh castShadow position={[x + archRadius, baseY, z]}>
        <cylinderGeometry args={[METROPOLIS_TOWER_R, METROPOLIS_TOWER_R, METROPOLIS_TOWER_H, 8]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.25} side={DoubleSide} />
      </mesh>
      {/* Half-torus arch bridging the two towers' tops (a 180-degree arc, `torusGeometry`'s `arc` arg).
          `TorusGeometry`'s big ring traces `(R cos u, R sin u, ~0)` for `u` in `[0, arc]` — over
          `[0, π]` that's `y = R sin u >= 0` throughout, i.e. the UPPER half already (from
          `(archRadius, 0)` up through `(0, archRadius)` down to `(-archRadius, 0)`), so no extra
          rotation is needed to bridge the two towers with an arch that rises ABOVE their tops. */}
      <mesh castShadow position={[x, baseY + METROPOLIS_TOWER_H / 2, z]}>
        <torusGeometry args={[archRadius, METROPOLIS_TOWER_R * 0.9, 8, 16, Math.PI]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.25} side={DoubleSide} />
      </mesh>
    </group>
  );
}
