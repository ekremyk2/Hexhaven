// Explorers & Pirates board pieces (T-1108 requirement D, functional-not-final — PM does the visual
// polish pass, per this task's own priority order: D is last). Mirrors
// `TradersBarbariansPieces.tsx`'s geometry-resolution pattern exactly (same `HEX_SIZE`/`px` scale,
// `data-testid` conventions) so it slots in as a sibling child of `<Pieces>` inside `<BoardView>`.
// Ships reuse the base `<Pieces>` component's own `ships` prop (the same hull+sail piece Seafarers
// already draws, `routes/Game.tsx` merges both lists) — this file owns only the ONE piece that has no
// base-game analogue: the harbor settlement (§EP4.2, "harbor settlements REPLACE cities" — there are
// no cities in E&P). Renders nothing outside a live E&P game (`harborSettlements` empty).
import { GEOMETRY, type BoardGeometry, type Seat, type VertexId } from '@hexhaven/shared';
import { HEX_SIZE, PLAYER_BADGES, PLAYER_COLORS, contrastInk } from './palette';

const S = HEX_SIZE;
const px = (n: number) => n * S;

type Point = { x: number; y: number };

// Decorative glyph (not routed through i18n — always paired with a translated label elsewhere, e.g.
// the HUD's harbor-settlement count; mirrors `Pieces.tsx`'s `CHIT_GLYPH` convention). Referenced as
// `{EXPRESSION}` below so the i18n-guard lint rule (which only flags literal JSX text) doesn't flag it.
const ANCHOR_GLYPH = '⚓';

function vertexPoint(geometry: BoardGeometry, id: VertexId): Point {
  const v = geometry.vertices[id];
  if (!v) throw new Error(`BUG: vertex ${id}`);
  return { x: px(v.x), y: px(v.y) };
}

export interface ExplorersPiratesPiecesProps {
  geometry?: BoardGeometry;
  /** Harbor settlements (§EP4.2), flattened — `{ vertex, seat }` (mirrors `epHelpers.ts`'s
   *  `epHarborSettlementsFlattened`). */
  harborSettlements?: { vertex: VertexId; seat: Seat }[];
}

export function ExplorersPiratesPieces({
  geometry = GEOMETRY,
  harborSettlements = [],
}: ExplorersPiratesPiecesProps) {
  return (
    <g>
      {harborSettlements.map(({ vertex, seat }, i) => {
        const p = vertexPoint(geometry, vertex);
        return <HarborSettlement key={`hs${vertex}-${i}`} x={p.x} y={p.y} seat={seat} />;
      })}
    </g>
  );
}

/** A harbor settlement: the base settlement pentagon (so it reads as "still a settlement-tier
 *  building", unlike a city) plus a gold anchor badge instead of the seat's shape badge — visually
 *  distinct from BOTH a plain settlement (no city exists to confuse it with in E&P) and the base
 *  city (no tower). */
function HarborSettlement({ x, y, seat }: { x: number; y: number; seat: Seat }) {
  const s = S * 0.24;
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
