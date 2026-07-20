// Cities & Knights board pieces (T-805, docs/rules/cities-knights-rules.md C4.6/C7/C9): knights on
// intersections, city walls, and the metropolis "gates" adornment. Pure, props-driven — mirrors
// `Pieces.tsx`'s geometry-resolution pattern exactly (same `HEX_SIZE`/`px` scale, `filter="url(#
// piece-shadow)"` from BoardView's shared <defs>, `data-testid`/`data-*` conventions) so it slots in
// as a sibling child of `<Pieces>` inside `<BoardView>` without any change to those files. Rendered
// only when C&K state exists (`ext.citiesKnights`), so base/Seafarers boards are visually untouched.
//
// This is rendering only (T-805 scope) — no store wiring, no interaction (T-806), no engine calls.

import {
  GEOMETRY,
  type BoardGeometry,
  type ImprovementTrack,
  type KnightLevel,
  type Seat,
  type VertexId,
} from '@hexhaven/shared';
import { HEX_SIZE, PLAYER_COLORS, PLAYER_BADGES, contrastInk } from './palette';
import { TRACK_COLOR, KNIGHT_INACTIVE_FILL, WALL_FILL, WALL_STROKE } from './citiesKnightsPalette';

const S = HEX_SIZE;
const px = (n: number) => n * S;

export interface CitiesKnightsPiecesProps {
  geometry?: BoardGeometry;
  /** All seats' knight pieces (C7.1), flattened from `ext.citiesKnights.knights[seat]`. */
  knights?: { vertex: VertexId; seat: Seat; level: KnightLevel; active: boolean }[];
  /** City-wall vertices (C9.1), flattened from `ext.citiesKnights.walls[seat]`. Draw these BEFORE
   *  (under) the city piece from `Pieces` — see the wrapping order note on `<CitiesKnightsPieces>`
   *  below; callers place this component's output either just before or after `<Pieces>` in the DOM
   *  since SVG paints in document order. */
  walls?: { vertex: VertexId; seat: Seat }[];
  /**
   * Metropolis markers (C4.6). The data model tracks metropolis ownership PER TRACK
   * (`ext.citiesKnights.metropolis: Record<ImprovementTrack, Seat | null>`), not per vertex — it
   * doesn't record which of the owner's cities carries it. Rendering needs a vertex, so the CALLER
   * must resolve "one of that owner's cities" (e.g. the lowest vertex id, or a city explicitly
   * flagged elsewhere) and pass it here. This is a documented approximation for T-805; T-806 (or a
   * future engine addition) may want the engine to track the metropolis's actual vertex directly.
   */
  metropolises?: { vertex: VertexId; track: ImprovementTrack }[];
}

/** Renders C&K board pieces as one <g>, geometry-driven exactly like `<Pieces>`. */
export function CitiesKnightsPieces({
  geometry = GEOMETRY,
  knights = [],
  walls = [],
  metropolises = [],
}: CitiesKnightsPiecesProps) {
  const vertex = (id: VertexId) => {
    const v = geometry.vertices[id];
    if (!v) throw new Error(`BUG: vertex ${id}`);
    return { x: px(v.x), y: px(v.y) };
  };

  return (
    <g>
      {/* City walls first — they sit UNDER the city as a base ring (C9.1: "built under a city"). */}
      {walls.map(({ vertex: vid, seat }, i) => {
        const p = vertex(vid);
        return <CityWall key={`wl${vid}-${i}`} x={p.x} y={p.y} vertex={vid} seat={seat} />;
      })}

      {/* Knights on intersections (C7.1) */}
      {knights.map(({ vertex: vid, seat, level, active }, i) => {
        const p = vertex(vid);
        return (
          <KnightPiece
            key={`kn${vid}-${i}`}
            x={p.x}
            y={p.y}
            vertex={vid}
            seat={seat}
            level={level}
            active={active}
          />
        );
      })}

      {/* Metropolis gates (C4.6) — drawn above everything else so the crest reads on top of the city. */}
      {metropolises.map(({ vertex: vid, track }, i) => {
        const p = vertex(vid);
        return <Metropolis key={`me${vid}-${i}`} x={p.x} y={p.y} vertex={vid} track={track} />;
      })}
    </g>
  );
}

function Badge({ x, y, seat, size, fill }: { x: number; y: number; seat: Seat; size: number; fill?: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={size}
      fill={fill ?? contrastInk(seat)}
      style={{ pointerEvents: 'none' }}
    >
      {PLAYER_BADGES[seat]}
    </text>
  );
}

/**
 * A knight (C7.1): a shield silhouette — deliberately distinct from the settlement's house/city's
 * house+tower silhouettes so all three read apart at a glance. Level (C7.1: basic/strong/mighty) is
 * shown as 1/2/3 chevrons above the shield's badge, à la military rank insignia. Active knights
 * render in full owner color (the piece's "color side" up); inactive knights render desaturated
 * (`KNIGHT_INACTIVE_FILL`, the piece's "black & white side" per the physical game, C7.1/C7.5) with
 * the owner's color kept only on the outline + badge, so ownership stays legible either way.
 */
export function KnightPiece({
  x,
  y,
  vertex,
  seat,
  level,
  active,
}: {
  x: number;
  y: number;
  vertex: VertexId;
  seat: Seat;
  level: KnightLevel;
  active: boolean;
}) {
  const s = S * 0.24;
  const ownerColor = PLAYER_COLORS[seat];
  const fill = active ? ownerColor : KNIGHT_INACTIVE_FILL;
  const badgeFill = active ? contrastInk(seat) : '#f7f1e3'; // panel cream reads on the muted inactive fill
  // Shield: flat top, pointed base.
  const pts = `${x - s},${y - s * 0.7} ${x + s},${y - s * 0.7} ${x + s},${y + s * 0.15} ${x},${y + s * 1.15} ${x - s},${y + s * 0.15}`;
  return (
    <g
      filter="url(#piece-shadow)"
      data-testid={`knight-${vertex}`}
      data-vertex-id={vertex}
      data-seat={seat}
      data-level={level}
      data-active={active}
    >
      <polygon points={pts} fill={fill} stroke={ownerColor} strokeWidth={active ? 1.5 : 2} />
      {/* Level chevrons (1/2/3 per basic/strong/mighty, C7.1) along the shield's top edge. */}
      <g stroke={badgeFill} strokeWidth={1.4} fill="none" opacity={0.9}>
        {Array.from({ length: level }).map((_, i) => {
          const cy = y - s * 0.4 + i * s * 0.32;
          return <path key={i} d={`M ${x - s * 0.5} ${cy + s * 0.14} L ${x} ${cy - s * 0.1} L ${x + s * 0.5} ${cy + s * 0.14}`} />;
        })}
      </g>
      <Badge x={x} y={y + s * 0.55} seat={seat} size={s * 0.8} fill={badgeFill} />
    </g>
  );
}

/** A city wall (C9.1): a stone ring drawn under the city, wider than the settlement/city glyphs so
 *  it reads as a base the city sits on. Neutral stone-grey (not owner-colored — the city above
 *  already carries ownership); `seat` is still exposed as a data attribute for test/debug hooks. */
export function CityWall({
  x,
  y,
  vertex,
  seat,
}: {
  x: number;
  y: number;
  vertex: VertexId;
  seat: Seat;
}) {
  const r = S * 0.34;
  return (
    <g data-testid={`city-wall-${vertex}`} data-vertex-id={vertex} data-seat={seat}>
      <path
        d={`M ${x - r} ${y + r * 0.5} A ${r} ${r} 0 0 1 ${x + r} ${y + r * 0.5}`}
        fill="none"
        stroke={WALL_STROKE}
        strokeWidth={S * 0.16}
        strokeLinecap="round"
      />
      <path
        d={`M ${x - r} ${y + r * 0.5} A ${r} ${r} 0 0 1 ${x + r} ${y + r * 0.5}`}
        fill="none"
        stroke={WALL_FILL}
        strokeWidth={S * 0.16 - 2}
        strokeLinecap="round"
      />
    </g>
  );
}

/**
 * The metropolis "gates" adornment (C4.6): a track-colored gate/crest placed above a city, marking
 * it worth 4 VP (2 city + 2 metropolis). Colour-coded by track (`TRACK_COLOR`) so all three
 * metropolises are distinguishable at a glance even without checking who owns them.
 *
 * NOTE (approximation, see `CitiesKnightsPiecesProps.metropolises`): the data model tracks
 * metropolis ownership per TRACK, not per vertex, so the caller must resolve which of the owner's
 * cities to anchor this on (e.g. their first/lowest-id city). This component just draws the marker
 * at whatever vertex it's given.
 */
export function Metropolis({
  x,
  y,
  vertex,
  track,
}: {
  x: number;
  y: number;
  vertex: VertexId;
  track: ImprovementTrack;
}) {
  const color = TRACK_COLOR[track];
  const w = S * 0.5;
  const topY = y - S * 0.85;
  return (
    <g
      filter="url(#piece-shadow)"
      data-testid={`metropolis-${vertex}`}
      data-vertex-id={vertex}
      data-track={track}
    >
      {/* Two gate towers + a connecting arch, straddling the city above its tower roof. */}
      <rect x={x - w / 2} y={topY} width={S * 0.13} height={S * 0.32} fill={color} stroke="#00000088" strokeWidth={1.2} />
      <rect x={x + w / 2 - S * 0.13} y={topY} width={S * 0.13} height={S * 0.32} fill={color} stroke="#00000088" strokeWidth={1.2} />
      <path
        d={`M ${x - w / 2} ${topY} Q ${x} ${topY - S * 0.22} ${x + w / 2} ${topY}`}
        fill="none"
        stroke={color}
        strokeWidth={S * 0.1}
        strokeLinecap="round"
      />
    </g>
  );
}
