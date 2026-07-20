// Explorers & Pirates board pieces (T-1108 requirement D, functional-not-final — PM does the visual
// polish pass, per this task's own priority order: D is last). Mirrors
// `TradersBarbariansPieces.tsx`'s geometry-resolution pattern exactly (same `HEX_SIZE`/`px` scale,
// `data-testid` conventions) so it slots in as a sibling child of `<Pieces>` inside `<BoardView>`.
// Ships reuse the base `<Pieces>` component's own `ships` prop (the same hull+sail piece Seafarers
// already draws, `routes/Game.tsx` merges both lists) — this file owns only the ONE piece that has no
// base-game analogue: the harbor settlement (§EP4.2, "harbor settlements REPLACE cities" — there are
// no cities in E&P). Renders nothing outside a live E&P game (`harborSettlements` empty).
import { GEOMETRY, type BoardGeometry, type Seat, type VertexId } from '@hexhaven/shared';
import { HEX_SIZE, PLAYER_BADGES, PLAYER_COLORS, contrastInk, darken, lighten } from './palette';
import { boardProjection, type BoardProjection } from './projection';

const S = HEX_SIZE;
const px = (n: number) => n * S;

type Point = { x: number; y: number };

// Decorative glyph (not routed through i18n — always paired with a translated label elsewhere, e.g.
// the HUD's harbor-settlement count; mirrors `Pieces.tsx`'s `CHIT_GLYPH` convention). Referenced as
// `{EXPRESSION}` below so the i18n-guard lint rule (which only flags literal JSX text) doesn't flag it.
const ANCHOR_GLYPH = '⚓';

// T-1212 "3D board": a harbor settlement is piece-like (a building, replacing a city in E&P) — it
// stands on a two-tone wall+roof, the same shape/magnitude Pieces.tsx's T-1211 `Settlement` uses
// (this file doesn't import that file's private constants, so they're re-derived locally at the
// same S-relative scale). `WALL_DARKEN`/`ROOF_LIGHTEN` mirror Pieces.tsx's T-1212-tuned values
// (kept numerically identical to `palette.ts`'s `SKIRT_DARKEN_AMOUNT` — one shading language).
const HS_WALL_HEIGHT = S * 0.22;
const HS_ROOF_HEIGHT = S * 0.16;
const WALL_DARKEN = 0.4;
const ROOF_LIGHTEN = 0.34;

function vertexRaw(geometry: BoardGeometry, id: VertexId): Point {
  const v = geometry.vertices[id];
  if (!v) throw new Error(`BUG: vertex ${id}`);
  return { x: px(v.x), y: px(v.y) };
}

export interface ExplorersPiratesPiecesProps {
  geometry?: BoardGeometry;
  /** Harbor settlements (§EP4.2), flattened — `{ vertex, seat }` (mirrors `epHelpers.ts`'s
   *  `epHarborSettlementsFlattened`). */
  harborSettlements?: { vertex: VertexId; seat: Seat }[];
  /** T-1212 "3D board": the shared affine tilt (`board/projection.ts`), matching `BoardView`/
   *  `Pieces`' own default — a harbor settlement (piece-like) stands a modest height above the
   *  plane when enabled. `enabled === false` ⇒ identity map ⇒ byte-identical to pre-phase-13. */
  projection?: BoardProjection;
}

export function ExplorersPiratesPieces({
  geometry = GEOMETRY,
  harborSettlements = [],
  projection = boardProjection(true),
}: ExplorersPiratesPiecesProps) {
  return (
    <g>
      {harborSettlements.map(({ vertex, seat }, i) => {
        const raw = vertexRaw(geometry, vertex);
        const ground = projection.project(raw.x, raw.y, 0);
        const wall = projection.project(raw.x, raw.y, HS_WALL_HEIGHT);
        const roof = projection.project(raw.x, raw.y, HS_WALL_HEIGHT + HS_ROOF_HEIGHT);
        return (
          <HarborSettlement
            key={`hs${vertex}-${i}`}
            x={ground.sx}
            groundY={ground.sy}
            wallY={wall.sy}
            roofY={roof.sy}
            seat={seat}
            extruded={projection.enabled}
          />
        );
      })}
    </g>
  );
}

/** A harbor settlement: the base settlement pentagon (so it reads as "still a settlement-tier
 *  building", unlike a city) plus a gold anchor badge instead of the seat's shape badge — visually
 *  distinct from BOTH a plain settlement (no city exists to confuse it with in E&P) and the base
 *  city (no tower). T-1212: with 3D on, stands on a two-tone wall+roof (mirroring `Pieces.tsx`'s
 *  T-1211 `Settlement`) instead of a single flat-fill pentagon. */
function HarborSettlement({
  x,
  groundY,
  wallY,
  roofY,
  seat,
  extruded,
}: {
  x: number;
  groundY: number;
  wallY: number;
  roofY: number;
  seat: Seat;
  extruded: boolean;
}) {
  const s = S * 0.24;
  if (!extruded) {
    const y = groundY;
    const pts = `${x - s},${y + s} ${x - s},${y - s * 0.2} ${x},${y - s} ${x + s},${y - s * 0.2} ${x + s},${y + s}`;
    return (
      <g filter="url(#piece-shadow)" data-testid={`harbor-settlement-${seat}`} data-seat={seat}>
        <polygon points={pts} fill={PLAYER_COLORS[seat]} stroke="#00000088" strokeWidth={1.5} />
        <circle cx={x} cy={y - s * 1.15} r={s * 0.42} fill="#c9a227" stroke="#00000088" strokeWidth={1.2} />
        <text
          x={x}
          y={y - s * 1.15}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={s * 0.5}
          fill={contrastInk(seat)}
          style={{ pointerEvents: 'none' }}
        >
          {ANCHOR_GLYPH}
        </text>
        <text
          x={x}
          y={y + s * 0.25}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={s * 0.9}
          fill={contrastInk(seat)}
          style={{ pointerEvents: 'none' }}
        >
          {PLAYER_BADGES[seat]}
        </text>
      </g>
    );
  }
  const color = PLAYER_COLORS[seat];
  const wallPts = `${x - s},${groundY} ${x - s},${wallY} ${x + s},${wallY} ${x + s},${groundY}`;
  const roofPts = `${x - s},${wallY} ${x},${roofY} ${x + s},${wallY}`;
  return (
    <g filter="url(#piece-shadow)" data-testid={`harbor-settlement-${seat}`} data-seat={seat}>
      <polygon points={wallPts} fill={darken(color, WALL_DARKEN)} stroke="#00000088" strokeWidth={1.5} />
      <polygon points={roofPts} fill={lighten(color, ROOF_LIGHTEN)} stroke="#00000088" strokeWidth={1.5} />
      <circle cx={x} cy={roofY - s * 0.55} r={s * 0.42} fill="#c9a227" stroke="#00000088" strokeWidth={1.2} />
      <text
        x={x}
        y={roofY - s * 0.55}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={s * 0.5}
        fill={contrastInk(seat)}
        style={{ pointerEvents: 'none' }}
      >
        {ANCHOR_GLYPH}
      </text>
      <text
        x={x}
        y={(groundY + wallY) / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={s * 0.9}
        fill={contrastInk(seat)}
        style={{ pointerEvents: 'none' }}
      >
        {PLAYER_BADGES[seat]}
      </text>
    </g>
  );
}
