// Player pieces on the board (docs/11 §4): roads on edges, settlements/cities on vertices,
// the robber on its hex. Pure, props-driven. Every piece carries its owner's shape badge so
// players are distinguishable by shape as well as colour.
//
// T-1211 "3D board" (faux-3D standing pieces): every piece's anchor + body is run through the
// shared `BoardProjection` (T-1210) so it lands on the correctly TILTED vertex/edge/hex, and
// settlements/cities/roads/ships/robber/pirate render as raised, two-tone-shaded standing models
// (a lit top/roof face + darker side walls, both derived from the piece's own base colour) rather
// than flat painted silhouettes. `projection.enabled === false` collapses every one of those
// branches — each piece function's FIRST branch is the untouched pre-T-1211 flat JSX, byte-
// identical (see Pieces.test.ts's dedicated "3D off" suite), because `boardProjection(false)`'s
// `project` is a pure identity passthrough (no arithmetic) regardless of what `height` is asked for.

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
import { HEX_SIZE, PLAYER_COLORS, PLAYER_BADGES, contrastInk, darken, lighten } from './palette';
import { boardProjection, type BoardProjection } from './projection';
import { usePrefersReducedMotion } from '../theme/motion';
import { RobberArt } from '../themes/ThemedPieces';
import { DEFAULT_THEME_ID, THEMES, type ThemeId } from '../themes/themes';

const S = HEX_SIZE;
const px = (n: number) => n * S;

/** A point in BoardView's scaled px space, pre-projection — the same convention `projection.ts`
 *  documents (`project(px(v.x), px(v.y), height)`). */
type Point = { x: number; y: number };
/** Bound to one `BoardProjection` + raw point; callers ask for a `height` (0 = on the plane,
 *  positive = raised toward the camera) and get back the projected screen point. Passed down to
 *  the piece components below so THEY decide which heights their own silhouette needs, without
 *  each one re-importing `BoardProjection`. */
type ProjectFn = (raw: Point, height?: number) => Point;

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

// T-1211: faux-3D piece heights + shading amounts, all fed through the shared `BoardProjection`'s
// `height` convention (positive = raised toward the camera). Local to this file — BoardView's
// `TILE_THICKNESS` (palette.ts) is a much larger, per-hex-TILE scale; these are the smaller
// magnitudes that make a settlement/city/road/ship/robber read as a standing object without
// dwarfing the tile it stands on.
const SETTLEMENT_WALL_HEIGHT = S * 0.22;
const SETTLEMENT_ROOF_HEIGHT = S * 0.16;
const CITY_WALL_HEIGHT = S * 0.34;
const CITY_TOWER_HEIGHT = S * 0.3;
const CITY_TOWER2_HEIGHT = S * 0.16;
const ROBBER_HEIGHT = S * 0.16;
const PIRATE_HEIGHT = S * 0.14;

/** How much darker a piece's side/wall face is than its own base colour (0 = same, 1 = black) —
 *  the shadowed face, mirroring `palette.ts`'s `SKIRT_DARKEN_AMOUNT` for hex tiles. */
const WALL_DARKEN = 0.35;
/** How much lighter a piece's roof/top face is than its own base colour (0 = same, 1 = white) —
 *  the sunlit face. */
const ROOF_LIGHTEN = 0.3;

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
  /** T-1210/T-1211 "3D board": the shared affine tilt (`board/projection.ts`) — every piece's
   *  anchor + body is projected through it so pieces land on the tilted vertex/edge/hex and, when
   *  `enabled`, stand up as raised two-tone-shaded models (T-1211). Defaults to the tilted
   *  projection, matching `BoardView`/`InteractionLayer`'s own defaults; pass `boardProjection(false)`
   *  for the flat board, which renders every piece byte-identical to pre-T-1211. */
  projection?: BoardProjection;
}

/** docs/11 §5 "Robber move: arc hop between hexes, 400ms" — pure geometry, unit-testable without
 * rendering anything. Returns the CSS-var offsets `Robber` animates FROM (i.e. the previous hex's
 * position relative to the new one), or `null` when there's no previous hex to hop from (initial
 * placement, or the robber hasn't actually moved). Deliberately computed in RAW (pre-tilt) board
 * space, same as before T-1210/1211 existed — the hop is a short local flourish, not something
 * that needs to be perspective-exact, and keeping it raw keeps this function's own tests (and its
 * geometry) completely unaffected by whether the board is tilted. */
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
  projection = boardProjection(true),
}: PiecesProps) {
  const reducedMotion = usePrefersReducedMotion();
  // Tracks the robber's PREVIOUS hex across renders so a move can hop from where it was (docs/11
  // §5). Updated post-commit (not during render) so the render that first sees the new `robber`
  // value can still read the old one via this ref — see the effect below.
  const prevRobberHexRef = useRef<HexId | null>(robber);
  useEffect(() => {
    prevRobberHexRef.current = robber;
  }, [robber]);

  /** Projects a raw px-space point through the board's shared tilt (T-1210/1211). `height` only
   *  ever matters when `projection.enabled` — the identity projection ignores it entirely, so
   *  passing any height here is always safe for the "3D off" byte-identical guarantee. */
  const project: ProjectFn = (raw, height = 0) => {
    const p = projection.project(raw.x, raw.y, height);
    return { x: p.sx, y: p.sy };
  };

  const vertexRaw = (id: VertexId): Point => {
    const v = geometry.vertices[id];
    if (!v) throw new Error(`BUG: vertex ${id}`);
    return { x: px(v.x), y: px(v.y) };
  };
  const edgeRec = (id: EdgeId) => {
    const e = geometry.edges[id];
    if (!e) throw new Error(`BUG: edge ${id}`);
    return e;
  };
  const hexRaw = (id: HexId): Point => {
    const h = geometry.hexes[id];
    if (!h) throw new Error(`BUG: hex ${id}`);
    return { x: px(h.x), y: px(h.y) };
  };
  const hexAnchor = (id: HexId, height = 0): Point => project(hexRaw(id), height);

  /** Requirement 7 (painter's algorithm): within one piece layer, back-to-front by the RAW
   *  (pre-tilt) board-space y — mirrors `BoardView`'s own hex depth-sort. A no-op re-sort with 3D
   *  off (same order the array already carries), so the flat board's piece order — and therefore
   *  its DOM — stays byte-identical to pre-T-1211. */
  function byDepth<T>(items: T[], rawY: (item: T) => number): T[] {
    return projection.enabled ? [...items].sort((a, b) => rawY(a) - rawY(b)) : items;
  }

  const placementPop = reducedMotion ? '' : 'hexhaven-piece-pop';
  const hop = robber != null ? robberHopOffset(prevRobberHexRef.current, robber, geometry) : null;

  return (
    <g>
      {/* Roads (under buildings) */}
      {byDepth(roads, ({ edge: eid }) => edgeRec(eid).y).map(({ edge: eid, seat }, i) => {
        const e = edgeRec(eid);
        const a = project({ x: px(e.x), y: px(e.y) });
        return (
          // Outer <g> owns POSITIONING via the SVG transform attribute; the pop animation lives on
          // an INNER <g> so its CSS `transform: scale()` can't clobber the translate/rotate that
          // pins the road to its edge (the bug where roads jumped to the corner). The rotate stays
          // at the FLAT `e.angleDeg` (per T-1211's spec) — only the anchor point is projected/tilted.
          <g key={`r${eid}-${i}`} transform={`translate(${a.x} ${a.y}) rotate(${e.angleDeg})`} filter="url(#piece-shadow)">
            <g className={placementPop}>
              <RoadBody seat={seat} extruded={projection.enabled} />
            </g>
          </g>
        );
      })}

      {/* Ships (Seafarers): on sea edges, like roads but a hull + sail silhouette. */}
      {byDepth(ships, ({ edge: eid }) => edgeRec(eid).y).map(({ edge: eid, seat }, i) => {
        const e = edgeRec(eid);
        const a = project({ x: px(e.x), y: px(e.y) });
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
              <Ship seat={seat} extruded={projection.enabled} />
            </g>
          </g>
        );
      })}

      {/* Settlements */}
      {byDepth(settlements, ({ vertex: vid }) => vertexRaw(vid).y).map(({ vertex: vid, seat }, i) => (
        <Settlement
          key={`s${vid}-${i}`}
          raw={vertexRaw(vid)}
          project={project}
          seat={seat}
          pop={placementPop}
          extruded={projection.enabled}
        />
      ))}

      {/* Cities */}
      {byDepth(cities, ({ vertex: vid }) => vertexRaw(vid).y).map(({ vertex: vid, seat }, i) => (
        <City
          key={`ci${vid}-${i}`}
          raw={vertexRaw(vid)}
          project={project}
          seat={seat}
          pop={placementPop}
          extruded={projection.enabled}
        />
      ))}

      {/* Robber (T-907: reskinned per `themeId` via the shared `RobberArt`) */}
      {robber != null && (
        <Robber
          ground={hexAnchor(robber, 0)}
          body={hexAnchor(robber, ROBBER_HEIGHT)}
          hexId={robber}
          themeId={themeId}
          hopClass={reducedMotion || !hop ? '' : 'hexhaven-robber-hop'}
          hopDx={hop?.dx ?? 0}
          hopDy={hop?.dy ?? 0}
          extruded={projection.enabled}
        />
      )}

      {/* Pirate (Seafarers): on its sea hex, distinct from the land robber. */}
      {pirate != null && (
        <Pirate
          ground={hexAnchor(pirate, 0)}
          body={hexAnchor(pirate, PIRATE_HEIGHT)}
          hexId={pirate}
          extruded={projection.enabled}
        />
      )}

      {/* Island bonus-VP chits (Seafarers, S10.6): a small owner-coloured marker on the island. */}
      {islandChits.map(({ hex: hid, seat }, i) => {
        const p = hexAnchor(hid);
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
          const p = hexAnchor(hid);
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

/** A settlement — flat single-fill house silhouette pre-T-1211; with 3D on, a standing house whose
 *  walls sit on the vertex (ground, height 0) and rise to a lit roof peak (`SETTLEMENT_WALL_HEIGHT`
 *  + `SETTLEMENT_ROOF_HEIGHT` above ground) — the two-tone shading requirement 2 asks for. */
function Settlement({
  raw,
  project,
  seat,
  pop,
  extruded,
}: {
  raw: Point;
  project: ProjectFn;
  seat: Seat;
  pop: string;
  extruded: boolean;
}) {
  const s = S * 0.22;
  const ground = project(raw, 0);
  if (!extruded) {
    const { x, y } = ground;
    const pts = `${x - s},${y + s} ${x - s},${y - s * 0.2} ${x},${y - s} ${x + s},${y - s * 0.2} ${x + s},${y + s}`;
    return (
      <g filter="url(#piece-shadow)" className={pop}>
        <polygon points={pts} fill={PLAYER_COLORS[seat]} stroke="#00000088" strokeWidth={1.5} />
        <Badge x={x} y={y + s * 0.25} seat={seat} size={s * 0.9} />
      </g>
    );
  }
  const x = ground.x;
  const groundY = ground.y;
  const wallY = project(raw, SETTLEMENT_WALL_HEIGHT).y;
  const roofY = project(raw, SETTLEMENT_WALL_HEIGHT + SETTLEMENT_ROOF_HEIGHT).y;
  const color = PLAYER_COLORS[seat];
  const wallPts = `${x - s},${groundY} ${x - s},${wallY} ${x + s},${wallY} ${x + s},${groundY}`;
  const roofPts = `${x - s},${wallY} ${x},${roofY} ${x + s},${wallY}`;
  return (
    <g filter="url(#piece-shadow)" className={pop}>
      <polygon points={wallPts} fill={darken(color, WALL_DARKEN)} stroke="#00000088" strokeWidth={1.5} />
      <polygon points={roofPts} fill={lighten(color, ROOF_LIGHTEN)} stroke="#00000088" strokeWidth={1.5} />
      <Badge x={x} y={(groundY + wallY) / 2} seat={seat} size={s * 0.9} />
    </g>
  );
}

/** A city — flat wider-base + single-tower silhouette pre-T-1211; with 3D on, a taller MULTI-tower
 *  building (requirement 3): a wide darker base wall, a shorter secondary tower (also in wall
 *  shade), and a taller lit main tower — clearly bigger than a `Settlement`'s single wall+roof. */
function City({
  raw,
  project,
  seat,
  pop,
  extruded,
}: {
  raw: Point;
  project: ProjectFn;
  seat: Seat;
  pop: string;
  extruded: boolean;
}) {
  const s = S * 0.26;
  const ground = project(raw, 0);
  if (!extruded) {
    const { x, y } = ground;
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
  const x = ground.x;
  const groundY = ground.y;
  const wallY = project(raw, CITY_WALL_HEIGHT).y;
  const towerY = project(raw, CITY_WALL_HEIGHT + CITY_TOWER_HEIGHT).y;
  const tower2Y = project(raw, CITY_WALL_HEIGHT + CITY_TOWER2_HEIGHT).y;
  const color = PLAYER_COLORS[seat];
  const wallFill = darken(color, WALL_DARKEN);
  const roofFill = lighten(color, ROOF_LIGHTEN);
  const bodyPts = `${x - s},${groundY} ${x - s},${wallY} ${x + s},${wallY} ${x + s},${groundY}`;
  const tower2Pts = `${x + s * 0.15},${wallY} ${x + s * 0.15},${tower2Y} ${x + s * 0.75},${tower2Y} ${x + s * 0.75},${wallY}`;
  const towerPts = `${x - s},${wallY} ${x - s},${towerY} ${x - s * 0.2},${towerY - s * 0.35} ${x + s * 0.4},${towerY} ${x + s * 0.4},${wallY}`;
  return (
    <g filter="url(#piece-shadow)" className={pop}>
      <polygon points={bodyPts} fill={wallFill} stroke="#00000088" strokeWidth={1.5} />
      <polygon points={tower2Pts} fill={wallFill} stroke="#00000088" strokeWidth={1.5} />
      <polygon points={towerPts} fill={roofFill} stroke="#00000088" strokeWidth={1.5} />
      <rect x={x - s * 0.2} y={towerY - s * 0.4} width={s * 0.5} height={s * 0.28} fill="#c9a227" />
      <Badge x={x} y={(groundY + wallY) / 2} seat={seat} size={s * 0.8} />
    </g>
  );
}

/** A road's body, drawn in the edge-local space the caller's `<g transform>` already rotated to
 *  `edge.angleDeg` (T-1211 keeps that flat rotation, per spec — only the anchor is tilted). Flat
 *  pre-T-1211 markup is the single plain rect; with 3D on, a second darker rect offset toward the
 *  bar's own "underside" reads as the bar's visible thickness (requirement 4), topped by a lighter
 *  face. */
function RoadBody({ seat, extruded }: { seat: Seat; extruded: boolean }) {
  const len = S * 0.66;
  const w = S * 0.17;
  const color = PLAYER_COLORS[seat];
  if (!extruded) {
    return <rect x={-len / 2} y={-w / 2} width={len} height={w} rx={w * 0.4} fill={color} stroke="#00000088" strokeWidth={1.5} />;
  }
  const t = w * 0.55; // visible side-sliver thickness
  return (
    <>
      <rect x={-len / 2} y={-w / 2 + t} width={len} height={w} rx={w * 0.4} fill={darken(color, WALL_DARKEN)} stroke="#00000088" strokeWidth={1.5} />
      <rect x={-len / 2} y={-w / 2} width={len} height={w} rx={w * 0.4} fill={lighten(color, ROOF_LIGHTEN)} stroke="#00000088" strokeWidth={1.5} />
    </>
  );
}

/** A ship silhouette (docs/11 §4: hull + sail) centred on its edge, owner-coloured, with the seat
 *  shape badge on the sail. Drawn in edge-local space (the parent <g> supplies translate+rotate).
 *  With 3D on, a darker "freeboard" side-face hangs below the hull's waterline and the sail lightens
 *  a touch — requirement 5's "hull with a little freeboard/side shading + sail". The hull itself
 *  keeps its plain seat-colour fill in BOTH modes so this stays a real seat-colour hull, not just a
 *  gradient-washed one. */
function Ship({ seat, extruded }: { seat: Seat; extruded: boolean }) {
  const hullW = S * 0.6;
  const hullH = S * 0.2;
  const color = PLAYER_COLORS[seat];
  const hull = `M ${-hullW / 2} ${-hullH * 0.2} L ${hullW / 2} ${-hullH * 0.2} L ${hullW * 0.32} ${hullH} L ${-hullW * 0.42} ${hullH} Z`;
  const sailFill = extruded ? lighten(color, ROOF_LIGHTEN) : color;
  return (
    <g>
      {/* Sail */}
      <polygon
        points={`${-S * 0.04},${-hullH * 0.4} ${-S * 0.04},${-S * 0.42} ${S * 0.22},${-hullH * 0.4}`}
        fill={sailFill}
        stroke="#00000088"
        strokeWidth={1.5}
      />
      {/* Mast */}
      <line x1={-S * 0.04} y1={-hullH * 0.4} x2={-S * 0.04} y2={-S * 0.44} stroke="#00000088" strokeWidth={1.5} />
      {/* Freeboard: a darker sliver hanging below the hull's waterline, visible thickness. */}
      {extruded && (
        <path
          d={`M ${-hullW * 0.42} ${hullH} L ${hullW * 0.32} ${hullH} L ${hullW * 0.24} ${hullH * 1.55} L ${-hullW * 0.32} ${hullH * 1.55} Z`}
          fill={darken(color, WALL_DARKEN)}
          stroke="#00000088"
          strokeWidth={1.5}
        />
      )}
      {/* Hull */}
      <path d={hull} fill={color} stroke="#00000088" strokeWidth={1.5} />
      <Badge x={0} y={hullH * 0.35} seat={seat} size={hullH * 0.9} />
    </g>
  );
}

/** The pirate (Seafarers S8): a dark ship flying a flag, deliberately unlike the land robber so the
 *  two read as different threats on the same board. With 3D on, its body stands `PIRATE_HEIGHT`
 *  above the shadow ellipse (pinned to the ground/hex), and the hull gets the same two-tone
 *  freeboard shading as `Ship`. */
function Pirate({
  ground,
  body,
  hexId,
  extruded,
}: {
  ground: Point;
  body: Point;
  hexId: HexId;
  extruded: boolean;
}) {
  const s = S * 0.36;
  const { x, y } = body;
  const hull = `M ${x - s * 0.9} ${y} L ${x + s * 0.9} ${y} L ${x + s * 0.55} ${y + s * 0.5} L ${x - s * 0.7} ${y + s * 0.5} Z`;
  return (
    <g filter="url(#piece-shadow)" data-testid="pirate" data-hex-id={hexId}>
      <ellipse cx={ground.x} cy={ground.y + s * 0.65} rx={s * 0.85} ry={s * 0.22} fill="#00000033" />
      {/* Mast + black flag */}
      <line x1={x} y1={y} x2={x} y2={y - s * 1.1} stroke="#12100c" strokeWidth={2} />
      <polygon points={`${x},${y - s * 1.1} ${x + s * 0.7},${y - s * 0.9} ${x},${y - s * 0.7}`} fill="#12100c" />
      {/* Skull dot on the flag so it reads as a pirate, not just a dark boat. */}
      <circle cx={x + s * 0.28} cy={y - s * 0.9} r={s * 0.09} fill="#f7f1e3" />
      {/* Freeboard: darker hull-side sliver, same shading language as Ship's. */}
      {extruded && (
        <path
          d={`M ${x - s * 0.7} ${y + s * 0.5} L ${x + s * 0.55} ${y + s * 0.5} L ${x + s * 0.4} ${y + s * 0.72} L ${x - s * 0.55} ${y + s * 0.72} Z`}
          fill={darken('#26221b', WALL_DARKEN)}
          stroke="#000"
          strokeWidth={1.5}
        />
      )}
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
  ground,
  body,
  hexId,
  themeId,
  hopClass,
  hopDx,
  hopDy,
  extruded,
}: {
  ground: Point;
  body: Point;
  hexId: HexId;
  themeId: ThemeId;
  hopClass: string;
  hopDx: number;
  hopDy: number;
  extruded: boolean;
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
      {/* T-1211: the shadow stays pinned to the GROUND anchor (height 0) even when the body above
          stands raised — a piece's shadow never lifts off the plane it's cast on. */}
      <ellipse cx={ground.x} cy={ground.y + s * 0.9} rx={s * 0.7} ry={s * 0.25} fill="#00000033" />
      {/* T-907 PM wiring: the SAME `RobberArt` the standalone `ThemedRobber` uses (themes/
          ThemedPieces.tsx), so the live board's robber reskins identically — `classic` renders the
          exact base pawn body this used to draw inline. T-1211: `body` is the raised anchor (equal
          to `ground` when 3D is off), and `extruded` gates RobberArt's own two-tone body shading. */}
      <RobberArt art={theme.robberArt} x={body.x} y={body.y} s={s} accent={theme.accent} extruded={extruded} />
    </g>
  );
}
