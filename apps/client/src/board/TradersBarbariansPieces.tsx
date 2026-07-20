// Traders & Barbarians board pieces (T-1008 requirement D, functional-not-final — PM does the visual
// polish pass, per this task's own priority order). Mirrors `CitiesKnightsPieces.tsx`'s geometry-
// resolution pattern exactly (same `HEX_SIZE`/`px` scale, `data-testid` conventions) so it slots in
// as a sibling child of `<Pieces>` inside `<BoardView>`. Gated per scenario off `ext.tradersBarbarians`
// — renders nothing outside a T&B game, and only the active scenario's own layer, per TB8.1's
// standalone-only discipline.
import { GEOMETRY, type BoardGeometry, type EdgeId, type HexId, type Seat, type VertexId } from '@hexhaven/shared';
import { HEX_SIZE, PLAYER_BADGES, PLAYER_COLORS, contrastInk, darken, lighten } from './palette';
import {
  TB_BARBARIAN_COLOR,
  TB_CAMEL_COLOR,
  TB_LAKE_COLOR,
  TB_OASIS_COLOR,
  TB_RIVER_COLOR,
  TB_TRADE_HEX_COLOR,
} from './tradersBarbariansPalette';
import { boardProjection, type BoardProjection } from './projection';

const S = HEX_SIZE;
const px = (n: number) => n * S;

type Point = { x: number; y: number };

// T-1212 "3D board" overlays: modest standing heights for T&B's piece-like markers (bridges/camels/
// barbarians/knights/wagons), the same px/height convention as `Pieces.tsx`'s T-1211 constants
// (positive = raised toward the camera). Flat-on-tile markers (lake/oasis glyphs, fishing grounds,
// river/route lines, trade-hex glyphs) stay at height 0 per requirement 1 — they're decoration/track
// dressing, not standing pieces.
const BRIDGE_HEIGHT = S * 0.1;
const CAMEL_HEIGHT = S * 0.12;
const BARBARIAN_HEIGHT = S * 0.14;
const TB_KNIGHT_HEIGHT = S * 0.16;
const PATH_BARBARIAN_HEIGHT = S * 0.1;
const WAGON_HEIGHT = S * 0.16;

/** Two-tone shading amounts mirroring `Pieces.tsx`'s T-1212-tuned `WALL_DARKEN`/`ROOF_LIGHTEN` — the
 *  shadowed side face vs the sunlit top face, both derived from the piece's own seat/base colour;
 *  kept numerically identical to `Pieces.tsx` and `palette.ts`'s `SKIRT_DARKEN_AMOUNT` so every
 *  standing piece and tile skirt on the board reads with the same shading depth. */
const WALL_DARKEN = 0.4;
const ROOF_LIGHTEN = 0.34;

// Decorative pictograms (not routed through i18n — always paired with a translated label/count
// elsewhere in the UI, e.g. the HUD/action panel; mirrors `board/CommodityIcon.tsx`'s
// `COMMODITY_GLYPH` convention). Referenced as `{EXPRESSION}` below so the i18n-guard lint rule
// (which only flags literal JSX text nodes) doesn't flag these board glyphs.
const LAKE_GLYPH = '🌊';
const OASIS_GLYPH = '🌴';
const BARBARIAN_GLYPH = '⚔️';
const CAMEL_GLYPH = '🐫';

export interface TradersBarbariansPiecesProps {
  geometry?: BoardGeometry;
  /** Fishermen (§TB2.1): the Lake hex, or `null` outside that scenario. */
  lakeHex?: HexId | null;
  /** Fishermen (§TB2.1/§TB2.2): fishing-ground tiles, each a token + the coastal vertices it feeds. */
  fishingGrounds?: { token: number; vertices: readonly VertexId[] }[];
  /** Rivers (§TB3.1): the fixed river edges (always drawn once the scenario is active, even before
   *  any bridge exists). */
  riverEdges?: readonly EdgeId[];
  /** Rivers (§TB3.2): built bridges, per seat. */
  bridges?: { edge: EdgeId; seat: Seat }[];
  /** Caravans (§TB4.1): the Oasis hex, or `null` outside that scenario. */
  oasisHex?: HexId | null;
  /** Caravans (§TB4.1): the caravan-route edges (drawn faint even before a camel sits there). */
  routeEdges?: readonly EdgeId[];
  /** Caravans (§TB4.1-§TB4.3): placed camels. */
  camels?: readonly EdgeId[];
  /** Barbarian Attack (§TB5.2): barbarian pieces by hex (may repeat if 2+ share a hex). */
  barbarianHexes?: readonly HexId[];
  /** Barbarian Attack (§TB5.2): T&B's own edge-based knights (distinct from C&K's vertex knights). */
  tbKnights?: { edge: EdgeId; seat: Seat; active: boolean }[];
  /** The main scenario (§TB6.1): the 3 fixed trade hexes. */
  tradeHexes?: { hex: HexId; kind: 'quarry' | 'glassworks' | 'castle' }[];
  /** The main scenario (§TB6.2): wagons, at their current vertex. */
  wagons?: { at: VertexId; seat: Seat; cargo: string | null }[];
  /** The main scenario (§TB6.3): barbarian-occupied paths (distinct track from Barbarian Attack's
   *  hex-based barbarians — these sit on edges and block road-building there). */
  pathBarbarians?: readonly EdgeId[];
  /** T-1212 "3D board": the shared affine tilt (`board/projection.ts`), matching `BoardView`/
   *  `Pieces`' own default — every marker's anchor is projected through it. Flat-on-tile markers
   *  (glyphs/tracks) always project at height 0; piece-like markers (bridges/camels/barbarians/
   *  knights/wagons) stand a modest height above the plane when enabled. `enabled === false` ⇒
   *  identity map ⇒ every marker lands exactly where it did pre-phase-13. */
  projection?: BoardProjection;
}

function hexCenterRaw(geometry: BoardGeometry, hexId: HexId): Point {
  const h = geometry.hexes[hexId];
  if (!h) throw new Error(`BUG: hex ${hexId}`);
  const pts = h.vertices.map((vid) => geometry.vertices[vid]).filter((v): v is NonNullable<typeof v> => v != null);
  const x = pts.reduce((a, v) => a + v.x, 0) / pts.length;
  const y = pts.reduce((a, v) => a + v.y, 0) / pts.length;
  return { x: px(x), y: px(y) };
}

function vertexRaw(geometry: BoardGeometry, id: VertexId): Point {
  const v = geometry.vertices[id];
  if (!v) throw new Error(`BUG: vertex ${id}`);
  return { x: px(v.x), y: px(v.y) };
}

function edgeGeom(geometry: BoardGeometry, id: EdgeId) {
  const e = geometry.edges[id];
  if (!e) throw new Error(`BUG: edge ${id}`);
  return e;
}

export function TradersBarbariansPieces({
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
  projection = boardProjection(true),
}: TradersBarbariansPiecesProps) {
  const project = (raw: Point, height = 0): Point => {
    const p = projection.project(raw.x, raw.y, height);
    return { x: p.sx, y: p.sy };
  };
  const extruded = projection.enabled;

  return (
    <g>
      {/* Fishermen: the Lake glyph + fishing-ground markers (§TB2.1) — flat-on-tile decoration. */}
      {lakeHex != null ? <LakeGlyph {...project(hexCenterRaw(geometry, lakeHex))} hex={lakeHex} /> : null}
      {fishingGrounds.map((g, i) => {
        const raws = g.vertices.map((v) => vertexRaw(geometry, v));
        const rawX = raws.reduce((a, p) => a + p.x, 0) / raws.length;
        const rawY = raws.reduce((a, p) => a + p.y, 0) / raws.length;
        const p = project({ x: rawX, y: rawY });
        return <FishingGround key={`fg${i}`} x={p.x} y={p.y} token={g.token} />;
      })}

      {/* Rivers: river edges (faint, always, flat) + bridges (§TB3.1/§TB3.2, piece-like). */}
      {riverEdges.map((edgeId) => {
        const e = edgeGeom(geometry, edgeId);
        const p = project({ x: px(e.x), y: px(e.y) });
        return <RiverLine key={`riv${edgeId}`} cx={p.x} cy={p.y} angleDeg={e.angleDeg} edge={edgeId} />;
      })}
      {bridges.map(({ edge, seat }) => {
        const e = edgeGeom(geometry, edge);
        const ground = project({ x: px(e.x), y: px(e.y) }, 0);
        const body = project({ x: px(e.x), y: px(e.y) }, BRIDGE_HEIGHT);
        return (
          <Bridge key={`br${edge}`} cx={ground.x} cy={body.y} angleDeg={e.angleDeg} edge={edge} seat={seat} extruded={extruded} />
        );
      })}

      {/* Caravans: the Oasis glyph (flat) + route edges (faint, flat) + placed camels (piece-like,
          §TB4.1-§TB4.3). */}
      {oasisHex != null ? <OasisGlyph {...project(hexCenterRaw(geometry, oasisHex))} hex={oasisHex} /> : null}
      {routeEdges.map((edgeId) => {
        const e = edgeGeom(geometry, edgeId);
        const p = project({ x: px(e.x), y: px(e.y) });
        return <RouteLine key={`rt${edgeId}`} cx={p.x} cy={p.y} angleDeg={e.angleDeg} />;
      })}
      {camels.map((edgeId) => {
        const e = edgeGeom(geometry, edgeId);
        const raw = { x: px(e.x), y: px(e.y) };
        const ground = project(raw, 0);
        const body = project(raw, CAMEL_HEIGHT);
        return <Camel key={`cm${edgeId}`} x={ground.x} groundY={ground.y} bodyY={body.y} edge={edgeId} extruded={extruded} />;
      })}

      {/* Barbarian Attack: barbarians on hexes + T&B's own edge-based knights (§TB5.2, piece-like). */}
      {barbarianHexes.map((hexId, i) => {
        const raw = hexCenterRaw(geometry, hexId);
        const ground = project(raw, 0);
        const body = project(raw, BARBARIAN_HEIGHT);
        const dx = (i % 3) * 6 - 6;
        const dy = Math.floor(i / 3) * 6;
        return (
          <Barbarian
            key={`ba${hexId}-${i}`}
            x={ground.x + dx}
            groundY={ground.y + dy}
            bodyY={body.y + dy}
            hex={hexId}
            extruded={extruded}
          />
        );
      })}
      {tbKnights.map(({ edge, seat, active }) => {
        const e = edgeGeom(geometry, edge);
        const raw = { x: px(e.x), y: px(e.y) };
        const ground = project(raw, 0);
        const body = project(raw, TB_KNIGHT_HEIGHT);
        return (
          <TbKnight key={`tk${edge}`} x={ground.x} groundY={ground.y} bodyY={body.y} edge={edge} seat={seat} active={active} extruded={extruded} />
        );
      })}

      {/* The main scenario: trade hexes (flat) + wagons (piece-like) + path barbarians (piece-like,
          §TB6.1-§TB6.3). */}
      {tradeHexes.map((th) => {
        const p = project(hexCenterRaw(geometry, th.hex));
        return <TradeHexGlyph key={`th${th.hex}`} x={p.x} y={p.y} hex={th.hex} kind={th.kind} />;
      })}
      {pathBarbarians.map((edgeId) => {
        const e = edgeGeom(geometry, edgeId);
        const raw = { x: px(e.x), y: px(e.y) };
        const ground = project(raw, 0);
        const body = project(raw, PATH_BARBARIAN_HEIGHT);
        return <PathBarbarian key={`pb${edgeId}`} x={ground.x} groundY={ground.y} bodyY={body.y} edge={edgeId} extruded={extruded} />;
      })}
      {wagons.map((w, i) => {
        const raw = vertexRaw(geometry, w.at);
        const ground = project(raw, 0);
        const body = project(raw, WAGON_HEIGHT);
        return (
          <Wagon
            key={`wg${w.at}-${i}`}
            x={ground.x}
            groundY={ground.y}
            bodyY={body.y}
            vertex={w.at}
            seat={w.seat}
            loaded={w.cargo != null}
            extruded={extruded}
          />
        );
      })}
    </g>
  );
}

// ---- Fishermen ------------------------------------------------------------------------------------

function LakeGlyph({ x, y, hex }: { x: number; y: number; hex: HexId }) {
  return (
    <g data-testid={`tb-lake-${hex}`} data-hex-id={hex} style={{ pointerEvents: 'none' }}>
      <circle cx={x} cy={y} r={S * 0.32} fill={TB_LAKE_COLOR} fillOpacity={0.55} stroke="#ffffffaa" strokeWidth={1.5} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.32}>{LAKE_GLYPH}</text>
    </g>
  );
}

function FishingGround({ x, y, token }: { x: number; y: number; token: number }) {
  return (
    <g data-testid={`tb-fishing-ground-${token}`} style={{ pointerEvents: 'none' }}>
      <circle cx={x} cy={y} r={S * 0.16} fill={TB_LAKE_COLOR} fillOpacity={0.5} stroke="#ffffffaa" strokeWidth={1} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.16} fill="#f7f1e3" fontWeight={700}>
        {token}
      </text>
    </g>
  );
}

// ---- Rivers ----------------------------------------------------------------------------------------

function RiverLine({ cx, cy, angleDeg, edge }: { cx: number; cy: number; angleDeg: number; edge: EdgeId }) {
  const len = S * 0.66;
  return (
    <g
      transform={`translate(${cx} ${cy}) rotate(${angleDeg})`}
      data-testid={`tb-river-${edge}`}
      data-edge-id={edge}
      style={{ pointerEvents: 'none' }}
    >
      <line x1={-len / 2} y1={0} x2={len / 2} y2={0} stroke={TB_RIVER_COLOR} strokeWidth={S * 0.12} strokeLinecap="round" opacity={0.7} />
    </g>
  );
}

function Bridge({
  cx,
  cy,
  angleDeg,
  edge,
  seat,
  extruded = false,
}: {
  cx: number;
  cy: number;
  angleDeg: number;
  edge: EdgeId;
  seat: Seat;
  /** T-1212 "3D board": mirrors `Pieces.tsx`'s T-1211 `RoadBody` two-tone extrusion (a darker
   *  underside rect + a lit top rect reading as visible thickness) — a bridge is the same "extruded
   *  bar on an edge" shape as a road. `false` (the default) renders the single pre-phase-13 rect. */
  extruded?: boolean;
}) {
  const len = S * 0.7;
  const color = PLAYER_COLORS[seat];
  if (!extruded) {
    return (
      <g
        transform={`translate(${cx} ${cy}) rotate(${angleDeg})`}
        data-testid={`tb-bridge-${edge}`}
        data-edge-id={edge}
        data-seat={seat}
      >
        <rect x={-len / 2} y={-S * 0.09} width={len} height={S * 0.18} rx={S * 0.05} fill={color} stroke="#00000055" strokeWidth={1.2} />
      </g>
    );
  }
  const w = S * 0.18;
  const t = w * 0.5;
  return (
    <g
      transform={`translate(${cx} ${cy}) rotate(${angleDeg})`}
      data-testid={`tb-bridge-${edge}`}
      data-edge-id={edge}
      data-seat={seat}
    >
      <rect x={-len / 2} y={-w / 2 + t} width={len} height={w} rx={S * 0.05} fill={darken(color, WALL_DARKEN)} stroke="#00000055" strokeWidth={1.2} />
      <rect x={-len / 2} y={-w / 2} width={len} height={w} rx={S * 0.05} fill={lighten(color, ROOF_LIGHTEN)} stroke="#00000055" strokeWidth={1.2} />
    </g>
  );
}

// ---- Caravans --------------------------------------------------------------------------------------

function OasisGlyph({ x, y, hex }: { x: number; y: number; hex: HexId }) {
  return (
    <g data-testid={`tb-oasis-${hex}`} data-hex-id={hex} style={{ pointerEvents: 'none' }}>
      <circle cx={x} cy={y} r={S * 0.32} fill={TB_OASIS_COLOR} fillOpacity={0.6} stroke="#ffffffaa" strokeWidth={1.5} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.32}>{OASIS_GLYPH}</text>
    </g>
  );
}

function RouteLine({ cx, cy, angleDeg }: { cx: number; cy: number; angleDeg: number }) {
  const len = S * 0.6;
  return (
    <g transform={`translate(${cx} ${cy}) rotate(${angleDeg})`} style={{ pointerEvents: 'none' }}>
      <line x1={-len / 2} y1={0} x2={len / 2} y2={0} stroke={TB_CAMEL_COLOR} strokeWidth={S * 0.08} strokeDasharray="4 3" opacity={0.6} />
    </g>
  );
}

function Camel({
  x,
  groundY,
  bodyY,
  edge,
  extruded = false,
}: {
  x: number;
  groundY: number;
  bodyY: number;
  edge: EdgeId;
  /** T-1212 "3D board": stands the camel a modest height above the plane with a pinned ground
   *  shadow, mirroring `Pieces.tsx`'s T-1211 robber/pirate idiom. `false` (the default) renders the
   *  pre-phase-13 flat marker at `groundY` with no shadow. */
  extruded?: boolean;
}) {
  const y = extruded ? bodyY : groundY;
  return (
    <g data-testid={`tb-camel-${edge}`} data-edge-id={edge} style={{ pointerEvents: 'none' }}>
      {extruded && <ellipse cx={x} cy={groundY + S * 0.1} rx={S * 0.24} ry={S * 0.08} fill="#00000033" />}
      <circle cx={x} cy={y} r={S * 0.2} fill={TB_CAMEL_COLOR} stroke="#00000055" strokeWidth={1} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.22}>{CAMEL_GLYPH}</text>
    </g>
  );
}

// ---- Barbarian Attack --------------------------------------------------------------------------------

function Barbarian({
  x,
  groundY,
  bodyY,
  hex,
  extruded = false,
}: {
  x: number;
  groundY: number;
  bodyY: number;
  hex: HexId;
  /** T-1212 "3D board": stands the barbarian a modest height above the plane with a pinned ground
   *  shadow. `false` (the default) renders the pre-phase-13 flat marker at `groundY`, no shadow. */
  extruded?: boolean;
}) {
  const y = extruded ? bodyY : groundY;
  return (
    <g data-testid={`tb-barbarian-${hex}`} data-hex-id={hex} style={{ pointerEvents: 'none' }}>
      {extruded && <ellipse cx={x} cy={groundY + S * 0.11} rx={S * 0.2} ry={S * 0.07} fill="#00000033" />}
      <circle cx={x} cy={y} r={S * 0.18} fill={TB_BARBARIAN_COLOR} stroke="#00000066" strokeWidth={1.2} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.2}>{BARBARIAN_GLYPH}</text>
    </g>
  );
}

function TbKnight({
  x,
  groundY,
  bodyY,
  edge,
  seat,
  active,
  extruded = false,
}: {
  x: number;
  groundY: number;
  bodyY: number;
  edge: EdgeId;
  seat: Seat;
  active: boolean;
  /** T-1212 "3D board": stands the knight a modest height above the plane with a pinned ground
   *  shadow, mirroring `CitiesKnightsPieces.tsx`'s own `KnightPiece` treatment. `false` (the
   *  default) renders the pre-phase-13 flat marker at `groundY`, no shadow. */
  extruded?: boolean;
}) {
  const color = PLAYER_COLORS[seat];
  const y = extruded ? bodyY : groundY;
  return (
    <g data-testid={`tb-knight-${edge}`} data-edge-id={edge} data-seat={seat} data-active={active}>
      {extruded && <ellipse cx={x} cy={groundY + S * 0.12} rx={S * 0.22} ry={S * 0.08} fill="#00000033" />}
      <circle cx={x} cy={y} r={S * 0.2} fill={active ? color : '#6b5f47'} stroke={color} strokeWidth={1.5} opacity={active ? 1 : 0.7} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.2} fill={contrastInk(seat)}>
        {PLAYER_BADGES[seat]}
      </text>
    </g>
  );
}

// ---- The main scenario -------------------------------------------------------------------------------

const TRADE_HEX_GLYPH: Record<'quarry' | 'glassworks' | 'castle', string> = {
  quarry: '⛏️',
  glassworks: '🔥',
  castle: '🏰',
};

function TradeHexGlyph({ x, y, hex, kind }: { x: number; y: number; hex: HexId; kind: 'quarry' | 'glassworks' | 'castle' }) {
  return (
    <g data-testid={`tb-trade-hex-${hex}`} data-hex-id={hex} data-kind={kind} style={{ pointerEvents: 'none' }}>
      <circle cx={x} cy={y} r={S * 0.3} fill={TB_TRADE_HEX_COLOR[kind]} fillOpacity={0.6} stroke="#ffffffaa" strokeWidth={1.5} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.28}>{TRADE_HEX_GLYPH[kind]}</text>
    </g>
  );
}

function PathBarbarian({
  x,
  groundY,
  bodyY,
  edge,
  extruded = false,
}: {
  x: number;
  groundY: number;
  bodyY: number;
  edge: EdgeId;
  /** T-1212 "3D board": stands the marker a modest height above the plane with a pinned ground
   *  shadow. `false` (the default) renders the pre-phase-13 flat marker at `groundY`, no shadow. */
  extruded?: boolean;
}) {
  const y = extruded ? bodyY : groundY;
  return (
    <g data-testid={`tb-path-barbarian-${edge}`} data-edge-id={edge} style={{ pointerEvents: 'none' }}>
      {extruded && <ellipse cx={x} cy={groundY + S * 0.08} rx={S * 0.18} ry={S * 0.06} fill="#00000033" />}
      <circle cx={x} cy={y} r={S * 0.16} fill={TB_BARBARIAN_COLOR} stroke="#00000066" strokeWidth={1} />
    </g>
  );
}

function Wagon({
  x,
  groundY,
  bodyY,
  vertex,
  seat,
  loaded,
  extruded = false,
}: {
  x: number;
  groundY: number;
  bodyY: number;
  vertex: VertexId;
  seat: Seat;
  loaded: boolean;
  /** T-1212 "3D board": stands the wagon body on a two-tone base/roof (mirroring `Pieces.tsx`'s
   *  T-1211 `Settlement`) with a pinned ground shadow. `false` (the default) renders the
   *  pre-phase-13 flat single-fill rect at `groundY`. */
  extruded?: boolean;
}) {
  const color = PLAYER_COLORS[seat];
  const s = S * 0.22;
  if (!extruded) {
    return (
      <g filter="url(#piece-shadow)" data-testid={`tb-wagon-${vertex}`} data-vertex-id={vertex} data-seat={seat} data-loaded={loaded}>
        <rect x={-s} y={-s * 0.6} width={s * 2} height={s * 1.2} rx={s * 0.3} transform={`translate(${x} ${groundY})`} fill={color} stroke="#00000055" strokeWidth={1.2} />
        <text x={x} y={groundY} textAnchor="middle" dominantBaseline="central" fontSize={s} fill={contrastInk(seat)}>
          {loaded ? '📦' : PLAYER_BADGES[seat]}
        </text>
      </g>
    );
  }
  return (
    <g filter="url(#piece-shadow)" data-testid={`tb-wagon-${vertex}`} data-vertex-id={vertex} data-seat={seat} data-loaded={loaded}>
      <ellipse cx={x} cy={groundY + s * 0.5} rx={s * 1.1} ry={s * 0.3} fill="#00000033" />
      <rect x={-s} y={-s * 0.3} width={s * 2} height={s * 0.7} rx={s * 0.25} transform={`translate(${x} ${bodyY})`} fill={darken(color, WALL_DARKEN)} stroke="#00000055" strokeWidth={1.2} />
      <rect x={-s} y={-s * 0.75} width={s * 2} height={s * 0.5} rx={s * 0.25} transform={`translate(${x} ${bodyY})`} fill={lighten(color, ROOF_LIGHTEN)} stroke="#00000055" strokeWidth={1.2} />
      <text x={x} y={bodyY} textAnchor="middle" dominantBaseline="central" fontSize={s} fill={contrastInk(seat)}>
        {loaded ? '📦' : PLAYER_BADGES[seat]}
      </text>
    </g>
  );
}
