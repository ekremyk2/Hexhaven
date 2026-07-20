// Traders & Barbarians board pieces (T-1008 requirement D, functional-not-final — PM does the visual
// polish pass, per this task's own priority order). Mirrors `CitiesKnightsPieces.tsx`'s geometry-
// resolution pattern exactly (same `HEX_SIZE`/`px` scale, `data-testid` conventions) so it slots in
// as a sibling child of `<Pieces>` inside `<BoardView>`. Gated per scenario off `ext.tradersBarbarians`
// — renders nothing outside a T&B game, and only the active scenario's own layer, per TB8.1's
// standalone-only discipline.
import { GEOMETRY, type BoardGeometry, type EdgeId, type HexId, type Seat, type VertexId } from '@hexhaven/shared';
import { HEX_SIZE, PLAYER_BADGES, PLAYER_COLORS, contrastInk } from './palette';
import {
  TB_BARBARIAN_COLOR,
  TB_CAMEL_COLOR,
  TB_LAKE_COLOR,
  TB_OASIS_COLOR,
  TB_RIVER_COLOR,
  TB_TRADE_HEX_COLOR,
} from './tradersBarbariansPalette';

const S = HEX_SIZE;
const px = (n: number) => n * S;

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
}

function hexCenter(geometry: BoardGeometry, hexId: HexId) {
  const h = geometry.hexes[hexId];
  if (!h) throw new Error(`BUG: hex ${hexId}`);
  const pts = h.vertices.map((vid) => geometry.vertices[vid]).filter((v): v is NonNullable<typeof v> => v != null);
  const x = pts.reduce((a, v) => a + v.x, 0) / pts.length;
  const y = pts.reduce((a, v) => a + v.y, 0) / pts.length;
  return { x: px(x), y: px(y) };
}

function vertexPoint(geometry: BoardGeometry, id: VertexId) {
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
}: TradersBarbariansPiecesProps) {
  return (
    <g>
      {/* Fishermen: the Lake glyph + fishing-ground markers (§TB2.1). */}
      {lakeHex != null ? <LakeGlyph {...hexCenter(geometry, lakeHex)} hex={lakeHex} /> : null}
      {fishingGrounds.map((g, i) => {
        const pts = g.vertices.map((v) => vertexPoint(geometry, v));
        const x = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const y = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        return <FishingGround key={`fg${i}`} x={x} y={y} token={g.token} />;
      })}

      {/* Rivers: river edges (faint, always) + bridges (§TB3.1/§TB3.2). */}
      {riverEdges.map((edgeId) => {
        const e = edgeGeom(geometry, edgeId);
        return <RiverLine key={`riv${edgeId}`} cx={px(e.x)} cy={px(e.y)} angleDeg={e.angleDeg} edge={edgeId} />;
      })}
      {bridges.map(({ edge, seat }) => {
        const e = edgeGeom(geometry, edge);
        return <Bridge key={`br${edge}`} cx={px(e.x)} cy={px(e.y)} angleDeg={e.angleDeg} edge={edge} seat={seat} />;
      })}

      {/* Caravans: the Oasis glyph + route edges (faint) + placed camels (§TB4.1-§TB4.3). */}
      {oasisHex != null ? <OasisGlyph {...hexCenter(geometry, oasisHex)} hex={oasisHex} /> : null}
      {routeEdges.map((edgeId) => {
        const e = edgeGeom(geometry, edgeId);
        return <RouteLine key={`rt${edgeId}`} cx={px(e.x)} cy={px(e.y)} angleDeg={e.angleDeg} />;
      })}
      {camels.map((edgeId) => {
        const e = edgeGeom(geometry, edgeId);
        return <Camel key={`cm${edgeId}`} x={px(e.x)} y={px(e.y)} edge={edgeId} />;
      })}

      {/* Barbarian Attack: barbarians on hexes + T&B's own edge-based knights (§TB5.2). */}
      {barbarianHexes.map((hexId, i) => {
        const c = hexCenter(geometry, hexId);
        return <Barbarian key={`ba${hexId}-${i}`} x={c.x + (i % 3) * 6 - 6} y={c.y + Math.floor(i / 3) * 6} hex={hexId} />;
      })}
      {tbKnights.map(({ edge, seat, active }) => {
        const e = edgeGeom(geometry, edge);
        return <TbKnight key={`tk${edge}`} x={px(e.x)} y={px(e.y)} edge={edge} seat={seat} active={active} />;
      })}

      {/* The main scenario: trade hexes + wagons + path barbarians (§TB6.1-§TB6.3). */}
      {tradeHexes.map((th) => {
        const c = hexCenter(geometry, th.hex);
        return <TradeHexGlyph key={`th${th.hex}`} x={c.x} y={c.y} hex={th.hex} kind={th.kind} />;
      })}
      {pathBarbarians.map((edgeId) => {
        const e = edgeGeom(geometry, edgeId);
        return <PathBarbarian key={`pb${edgeId}`} x={px(e.x)} y={px(e.y)} edge={edgeId} />;
      })}
      {wagons.map((w, i) => {
        const p = vertexPoint(geometry, w.at);
        return <Wagon key={`wg${w.at}-${i}`} x={p.x} y={p.y} vertex={w.at} seat={w.seat} loaded={w.cargo != null} />;
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

function Bridge({ cx, cy, angleDeg, edge, seat }: { cx: number; cy: number; angleDeg: number; edge: EdgeId; seat: Seat }) {
  const len = S * 0.7;
  const color = PLAYER_COLORS[seat];
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

function Camel({ x, y, edge }: { x: number; y: number; edge: EdgeId }) {
  return (
    <g data-testid={`tb-camel-${edge}`} data-edge-id={edge} style={{ pointerEvents: 'none' }}>
      <circle cx={x} cy={y} r={S * 0.2} fill={TB_CAMEL_COLOR} stroke="#00000055" strokeWidth={1} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.22}>{CAMEL_GLYPH}</text>
    </g>
  );
}

// ---- Barbarian Attack --------------------------------------------------------------------------------

function Barbarian({ x, y, hex }: { x: number; y: number; hex: HexId }) {
  return (
    <g data-testid={`tb-barbarian-${hex}`} data-hex-id={hex} style={{ pointerEvents: 'none' }}>
      <circle cx={x} cy={y} r={S * 0.18} fill={TB_BARBARIAN_COLOR} stroke="#00000066" strokeWidth={1.2} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.2}>{BARBARIAN_GLYPH}</text>
    </g>
  );
}

function TbKnight({ x, y, edge, seat, active }: { x: number; y: number; edge: EdgeId; seat: Seat; active: boolean }) {
  const color = PLAYER_COLORS[seat];
  return (
    <g data-testid={`tb-knight-${edge}`} data-edge-id={edge} data-seat={seat} data-active={active}>
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

function PathBarbarian({ x, y, edge }: { x: number; y: number; edge: EdgeId }) {
  return (
    <g data-testid={`tb-path-barbarian-${edge}`} data-edge-id={edge} style={{ pointerEvents: 'none' }}>
      <circle cx={x} cy={y} r={S * 0.16} fill={TB_BARBARIAN_COLOR} stroke="#00000066" strokeWidth={1} />
    </g>
  );
}

function Wagon({ x, y, vertex, seat, loaded }: { x: number; y: number; vertex: VertexId; seat: Seat; loaded: boolean }) {
  const color = PLAYER_COLORS[seat];
  const s = S * 0.22;
  return (
    <g filter="url(#piece-shadow)" data-testid={`tb-wagon-${vertex}`} data-vertex-id={vertex} data-seat={seat} data-loaded={loaded}>
      <rect x={-s} y={-s * 0.6} width={s * 2} height={s * 1.2} rx={s * 0.3} transform={`translate(${x} ${y})`} fill={color} stroke="#00000055" strokeWidth={1.2} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={s} fill={contrastInk(seat)}>
        {loaded ? '📦' : PLAYER_BADGES[seat]}
      </text>
    </g>
  );
}
