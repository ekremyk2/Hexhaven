// Player pieces on the board (docs/11 §4): roads on edges, settlements/cities on vertices,
// the robber on its hex. Pure, props-driven. Every piece carries its owner's shape badge so
// players are distinguishable by shape as well as colour.
//
// T-1404: retired the Phase-13 faux-3D standing-piece extrusion (T-1211) along with
// `board/projection.ts` — the WebGL 3D board (`board3d/Pieces3D.tsx`) is the shipped "3D" piece
// look now, so this file is back to flat painted silhouettes (byte-identical to pre-T-1211).

import { useEffect, useRef } from 'react';
import {
  GEOMETRY,
  type BoardGeometry,
  type EdgeId,
  type HexId,
  type HexPieceKindId,
  type Seat,
  type VertexId,
} from '@hexhaven/shared';
import { HEX_SIZE, PLAYER_COLORS, PLAYER_BADGES, contrastInk } from './palette';
import { usePrefersReducedMotion } from '../theme/motion';
import { RobberArt } from '../themes/ThemedPieces';
import { DEFAULT_THEME_ID, THEMES, type ThemeId } from '../themes/themes';

const S = HEX_SIZE;
const px = (n: number) => n * S;

type Point = { x: number; y: number };

// Decorative glyph (referenced as an expression, like the Scoreboard's, so the i18n-guard doesn't
// treat it as raw copy — it is a pictogram, not translatable text).
const CHIT_GLYPH = '★';

// T-903: one small pictogram + fill color per hex-piece kind (docs/tasks/phase-9 "each piece
// visually distinct") — decorative glyphs, not translatable text, same discipline as `CHIT_GLYPH`.
const HEX_PIECE_GLYPH: Readonly<Record<HexPieceKindId, string>> = {
  wizard: '★',
  trader: '⚖',
  robinHood: '➹',
  banker: '¤',
  poaching: '⚑',
};
const HEX_PIECE_COLOR: Readonly<Record<HexPieceKindId, string>> = {
  wizard: '#7c3aed',
  trader: '#0891b2',
  robinHood: '#16a34a',
  banker: '#ca8a04',
  poaching: '#dc2626',
};

export interface PiecesProps {
  geometry?: BoardGeometry;
  roads?: { edge: EdgeId; seat: Seat }[];
  settlements?: { vertex: VertexId; seat: Seat }[];
  cities?: { vertex: VertexId; seat: Seat }[];
  robber?: HexId | null;
  /** Seafarers (T-704): ships on sea edges, rendered like roads but as a hull + sail silhouette in
   *  the owner's seat colour. From `view.ext.seafarers.ships` (flattened to `{ edge, seat }`). */
  ships?: { edge: EdgeId; seat: Seat }[];
  /** Seafarers (T-704): the pirate on its sea hex (S8), distinct from the land robber. */
  pirate?: HexId | null;
  /** Seafarers (T-704): earned small-island bonus chits, resolved to the island hex they sit on and
   *  the seat that owns them (from `view.ext.seafarers.islandChits`, mapped through scenario data). */
  islandChits?: { hex: HexId; seat: Seat }[];
  /** Cosmetic theme (T-907 PM wiring): reskins ONLY the robber's art — every other piece keeps its
   *  base geometry/color in every theme (themes.ts's `ThemedPieceKind` doc). Defaults to `classic`
   *  (identity — no reskin), so an omitted prop renders bit-identical to before this existed. */
  themeId?: ThemeId;
  /** T-903 (multi-piece hex framework): every currently active hex piece (any subset of Wizard/
   *  Trader/Robin Hood/Banker/Poaching), each drawn as a small distinct marker at its hex center —
   *  from `view.ext.hexPieces.pieces`. Empty/absent while the `hexPieces` modifier is off. */
  hexPieces?: { hex: HexId; kind: HexPieceKindId }[];
}

/** docs/11 §5 "Robber move: arc hop between hexes, 400ms" — pure geometry, unit-testable without
 * rendering anything. Returns the CSS-var offsets `Robber` animates FROM (i.e. the previous hex's
 * position relative to the new one), or `null` when there's no previous hex to hop from (initial
 * placement, or the robber hasn't actually moved). */
export function robberHopOffset(
  prevHex: HexId | null,
  nextHex: HexId,
  geometry: BoardGeometry = GEOMETRY,
): { dx: number; dy: number } | null {
  if (prevHex == null || prevHex === nextHex) return null;
  const from = geometry.hexes[prevHex];
  const to = geometry.hexes[nextHex];
  if (!from || !to) return null;
  return { dx: px(from.x) - px(to.x), dy: px(from.y) - px(to.y) };
}

export function Pieces({
  geometry = GEOMETRY,
  roads = [],
  settlements = [],
  cities = [],
  robber = null,
  ships = [],
  pirate = null,
  islandChits = [],
  themeId = DEFAULT_THEME_ID,
  hexPieces = [],
}: PiecesProps) {
  const reducedMotion = usePrefersReducedMotion();
  // Tracks the robber's PREVIOUS hex across renders so a move can hop from where it was (docs/11
  // §5). Updated post-commit (not during render) so the render that first sees the new `robber`
  // value can still read the old one via this ref — see the effect below.
  const prevRobberHexRef = useRef<HexId | null>(robber);
  useEffect(() => {
    prevRobberHexRef.current = robber;
  }, [robber]);

  const vertexPoint = (id: VertexId): Point => {
    const v = geometry.vertices[id];
    if (!v) throw new Error(`BUG: vertex ${id}`);
    return { x: px(v.x), y: px(v.y) };
  };
  const edgeRec = (id: EdgeId) => {
    const e = geometry.edges[id];
    if (!e) throw new Error(`BUG: edge ${id}`);
    return e;
  };
  const hexPoint = (id: HexId): Point => {
    const h = geometry.hexes[id];
    if (!h) throw new Error(`BUG: hex ${id}`);
    return { x: px(h.x), y: px(h.y) };
  };

  const placementPop = reducedMotion ? '' : 'hexhaven-piece-pop';
  const hop = robber != null ? robberHopOffset(prevRobberHexRef.current, robber, geometry) : null;

  return (
    <g>
      {/* Roads (under buildings) */}
      {roads.map(({ edge: eid, seat }, i) => {
        const e = edgeRec(eid);
        const a = { x: px(e.x), y: px(e.y) };
        return (
          // Outer <g> owns POSITIONING via the SVG transform attribute; the pop animation lives on
          // an INNER <g> so its CSS `transform: scale()` can't clobber the translate/rotate that
          // pins the road to its edge (the bug where roads jumped to the corner).
          <g key={`r${eid}-${i}`} transform={`translate(${a.x} ${a.y}) rotate(${e.angleDeg})`} filter="url(#piece-shadow)">
            <g className={placementPop}>
              <RoadBody seat={seat} />
            </g>
          </g>
        );
      })}

      {/* Ships (Seafarers): on sea edges, like roads but a hull + sail silhouette. */}
      {ships.map(({ edge: eid, seat }, i) => {
        const e = edgeRec(eid);
        const a = { x: px(e.x), y: px(e.y) };
        return (
          <g
            key={`sh${eid}-${i}`}
            transform={`translate(${a.x} ${a.y}) rotate(${e.angleDeg})`}
            filter="url(#piece-shadow)"
            data-testid={`ship-${eid}`}
            data-edge-id={eid}
            data-seat={seat}
          >
            <g className={placementPop}>
              <Ship seat={seat} />
            </g>
          </g>
        );
      })}

      {/* Settlements */}
      {settlements.map(({ vertex: vid, seat }, i) => (
        <Settlement key={`s${vid}-${i}`} point={vertexPoint(vid)} seat={seat} pop={placementPop} />
      ))}

      {/* Cities */}
      {cities.map(({ vertex: vid, seat }, i) => (
        <City key={`ci${vid}-${i}`} point={vertexPoint(vid)} seat={seat} pop={placementPop} />
      ))}

      {/* Robber (T-907: reskinned per `themeId` via the shared `RobberArt`) */}
      {robber != null && (
        <Robber
          point={hexPoint(robber)}
          hexId={robber}
          themeId={themeId}
          hopClass={reducedMotion || !hop ? '' : 'hexhaven-robber-hop'}
          hopDx={hop?.dx ?? 0}
          hopDy={hop?.dy ?? 0}
        />
      )}

      {/* Pirate (Seafarers): on its sea hex, distinct from the land robber. */}
      {pirate != null && <Pirate point={hexPoint(pirate)} hexId={pirate} />}

      {/* Island bonus-VP chits (Seafarers, S10.6): a small owner-coloured marker on the island. */}
      {islandChits.map(({ hex: hid, seat }, i) => {
        const p = hexPoint(hid);
        return <IslandChit key={`ch${hid}-${i}`} x={p.x} y={p.y} seat={seat} hexId={hid} />;
      })}

      {/* T-903 hex pieces (Wizard/Trader/Robin Hood/Banker/Poaching): each a small, kind-distinct
          marker — coexists with the base robber (a separate untouched piece). Every enabled piece
          STARTS on the robber's desert hex (docs/tasks/phase-9/PICKS.md), and any subset can share a
          hex, so they're FANNED in a ring around the hex center — otherwise all N (plus the robber)
          drew at the same point and stacked into one unreadable blob (playtest: "hex pieces never
          appeared on the board"). `index`/`count` (within the same hex) drive each marker's angle. */}
      {(() => {
        const kindsByHex = new Map<HexId, HexPieceKindId[]>();
        for (const { hex: hid, kind } of hexPieces) {
          const list = kindsByHex.get(hid) ?? [];
          list.push(kind);
          kindsByHex.set(hid, list);
        }
        return hexPieces.map(({ hex: hid, kind }) => {
          const p = hexPoint(hid);
          const list = kindsByHex.get(hid)!;
          return (
            <HexPieceMarker
              key={`hx${hid}-${kind}`}
              x={p.x}
              y={p.y}
              hexId={hid}
              kind={kind}
              index={list.indexOf(kind)}
              count={list.length}
            />
          );
        });
      })()}
    </g>
  );
}

function Badge({ x, y, seat, size }: { x: number; y: number; seat: Seat; size: number }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={size}
      fill={contrastInk(seat)}
      style={{ pointerEvents: 'none' }}
    >
      {PLAYER_BADGES[seat]}
    </text>
  );
}

/** A settlement — a flat single-fill house silhouette. */
function Settlement({ point, seat, pop }: { point: Point; seat: Seat; pop: string }) {
  const s = S * 0.22;
  const { x, y } = point;
  const pts = `${x - s},${y + s} ${x - s},${y - s * 0.2} ${x},${y - s} ${x + s},${y - s * 0.2} ${x + s},${y + s}`;
  return (
    <g filter="url(#piece-shadow)" className={pop}>
      <polygon points={pts} fill={PLAYER_COLORS[seat]} stroke="#00000088" strokeWidth={1.5} />
      <Badge x={x} y={y + s * 0.25} seat={seat} size={s * 0.9} />
    </g>
  );
}

/** A city — a flat wider-base + single-tower silhouette. */
function City({ point, seat, pop }: { point: Point; seat: Seat; pop: string }) {
  const s = S * 0.26;
  const { x, y } = point;
  const base = `${x - s},${y + s} ${x - s},${y} ${x + s},${y} ${x + s},${y + s}`;
  const tower = `${x - s},${y} ${x - s},${y - s * 0.9} ${x - s * 0.2},${y - s * 1.3} ${x + s * 0.4},${y - s * 0.9} ${x + s * 0.4},${y}`;
  return (
    <g filter="url(#piece-shadow)" className={pop}>
      <polygon points={base} fill={PLAYER_COLORS[seat]} stroke="#00000088" strokeWidth={1.5} />
      <polygon points={tower} fill={PLAYER_COLORS[seat]} stroke="#00000088" strokeWidth={1.5} />
      <rect x={x - s * 0.2} y={y - s * 1.34} width={s * 0.5} height={s * 0.28} fill="#c9a227" />
      <Badge x={x} y={y + s * 0.45} seat={seat} size={s * 0.8} />
    </g>
  );
}

/** A road's body, drawn in the edge-local space the caller's `<g transform>` already rotated to
 *  `edge.angleDeg` — a plain rounded-rect bar. */
function RoadBody({ seat }: { seat: Seat }) {
  const len = S * 0.66;
  const w = S * 0.17;
  const color = PLAYER_COLORS[seat];
  return <rect x={-len / 2} y={-w / 2} width={len} height={w} rx={w * 0.4} fill={color} stroke="#00000088" strokeWidth={1.5} />;
}

/** A ship silhouette (docs/11 §4: hull + sail) centred on its edge, owner-coloured, with the seat
 *  shape badge on the sail. Drawn in edge-local space (the parent <g> supplies translate+rotate). */
function Ship({ seat }: { seat: Seat }) {
  const hullW = S * 0.6;
  const hullH = S * 0.2;
  const color = PLAYER_COLORS[seat];
  const hull = `M ${-hullW / 2} ${-hullH * 0.2} L ${hullW / 2} ${-hullH * 0.2} L ${hullW * 0.32} ${hullH} L ${-hullW * 0.42} ${hullH} Z`;
  return (
    <g>
      {/* Sail */}
      <polygon
        points={`${-S * 0.04},${-hullH * 0.4} ${-S * 0.04},${-S * 0.42} ${S * 0.22},${-hullH * 0.4}`}
        fill={color}
        stroke="#00000088"
        strokeWidth={1.5}
      />
      {/* Mast */}
      <line x1={-S * 0.04} y1={-hullH * 0.4} x2={-S * 0.04} y2={-S * 0.44} stroke="#00000088" strokeWidth={1.5} />
      {/* Hull */}
      <path d={hull} fill={color} stroke="#00000088" strokeWidth={1.5} />
      <Badge x={0} y={hullH * 0.35} seat={seat} size={hullH * 0.9} />
    </g>
  );
}

/** The pirate (Seafarers S8): a dark ship flying a flag, deliberately unlike the land robber so the
 *  two read as different threats on the same board. */
function Pirate({ point, hexId }: { point: Point; hexId: HexId }) {
  const s = S * 0.36;
  const { x, y } = point;
  const hull = `M ${x - s * 0.9} ${y} L ${x + s * 0.9} ${y} L ${x + s * 0.55} ${y + s * 0.5} L ${x - s * 0.7} ${y + s * 0.5} Z`;
  return (
    <g filter="url(#piece-shadow)" data-testid="pirate" data-hex-id={hexId}>
      <ellipse cx={x} cy={y + s * 0.65} rx={s * 0.85} ry={s * 0.22} fill="#00000033" />
      {/* Mast + black flag */}
      <line x1={x} y1={y} x2={x} y2={y - s * 1.1} stroke="#12100c" strokeWidth={2} />
      <polygon points={`${x},${y - s * 1.1} ${x + s * 0.7},${y - s * 0.9} ${x},${y - s * 0.7}`} fill="#12100c" />
      {/* Skull dot on the flag so it reads as a pirate, not just a dark boat. */}
      <circle cx={x + s * 0.28} cy={y - s * 0.9} r={s * 0.09} fill="#f7f1e3" />
      {/* Hull */}
      <path d={hull} fill="#26221b" stroke="#000" strokeWidth={1.5} />
    </g>
  );
}

/** Small island bonus-VP chit (Seafarers S10.6): an owner-coloured gold coin with a star, marking
 *  that the seat was first to settle this small island (+2 VP, folded into the engine's total). */
function IslandChit({ x, y, seat, hexId }: { x: number; y: number; seat: Seat; hexId: HexId }) {
  const r = S * 0.2;
  return (
    <g filter="url(#piece-shadow)" data-testid={`island-chit-${hexId}`} data-hex-id={hexId} data-seat={seat}>
      <circle cx={x} cy={y} r={r} fill="#e7b526" stroke={PLAYER_COLORS[seat]} strokeWidth={3} />
      <text
        x={x}
        y={y + r * 0.06}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={r * 1.1}
        fill="#2b2416"
        style={{ pointerEvents: 'none' }}
      >
        {CHIT_GLYPH}
      </text>
    </g>
  );
}

/** T-903 (multi-piece hex framework): a small kind-distinct marker for a coexisting hex piece
 *  (Wizard/Trader/Robin Hood/Banker/Poaching) — a colored coin + glyph at its hex center, offset
 *  slightly below-right of the number token so it never fully occludes it, mirroring `IslandChit`'s
 *  shape at a slightly larger size (these are gameplay-relevant, not decorative). Fully public —
 *  like the robber, a hex piece's position is never hidden information. */
function HexPieceMarker({
  x,
  y,
  hexId,
  kind,
  index = 0,
  count = 1,
}: {
  x: number;
  y: number;
  hexId: HexId;
  kind: HexPieceKindId;
  /** This piece's position among all pieces sharing `hexId`, and how many share it — drives the fan
   *  so co-located pieces (and the robber at the hex center) don't stack into one blob. */
  index?: number;
  count?: number;
}) {
  const r = S * 0.17;
  // A lone piece sits at the lower-right (as before); multiples fan evenly around the hex center on a
  // ring, clockwise from the top — clear of the robber/number token at the center.
  const ring = S * 0.4;
  const angle = count > 1 ? -Math.PI / 2 + (index * 2 * Math.PI) / count : Math.PI / 4;
  const cx = x + ring * Math.cos(angle);
  const cy = y + ring * Math.sin(angle);
  return (
    <g
      filter="url(#piece-shadow)"
      data-testid={`hex-piece-${kind}`}
      data-hex-id={hexId}
      data-kind={kind}
    >
      <circle cx={cx} cy={cy} r={r} fill={HEX_PIECE_COLOR[kind]} stroke="#00000088" strokeWidth={1.5} />
      <text
        x={cx}
        y={cy + r * 0.06}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={r * 1.1}
        fill="#ffffff"
        style={{ pointerEvents: 'none' }}
      >
        {HEX_PIECE_GLYPH[kind]}
      </text>
    </g>
  );
}

function Robber({
  point,
  hexId,
  themeId,
  hopClass,
  hopDx,
  hopDy,
}: {
  point: Point;
  hexId: HexId;
  themeId: ThemeId;
  hopClass: string;
  hopDx: number;
  hopDy: number;
}) {
  const s = S * 0.34;
  const theme = THEMES[themeId];
  return (
    <g
      filter="url(#piece-shadow)"
      opacity={0.95}
      className={hopClass}
      // T-501 e2e: exposes the robber's current hex for the reconnect/gameplay board-fingerprint
      // assertions — board/robber position is fully public (docs/02 §6), so this is a data-only
      // addition, no hidden info.
      data-testid="robber"
      data-hex-id={hexId}
      data-theme-id={themeId}
      style={hopClass ? ({ '--hop-dx': `${hopDx}px`, '--hop-dy': `${hopDy}px` } as React.CSSProperties) : undefined}
    >
      <ellipse cx={point.x} cy={point.y + s * 0.9} rx={s * 0.7} ry={s * 0.25} fill="#00000033" />
      {/* T-907 PM wiring: the SAME `RobberArt` the standalone `ThemedRobber` uses (themes/
          ThemedPieces.tsx), so the live board's robber reskins identically — `classic` renders the
          exact base pawn body this used to draw inline. */}
      <RobberArt art={theme.robberArt} x={point.x} y={point.y} s={s} accent={theme.accent} />
    </g>
  );
}
