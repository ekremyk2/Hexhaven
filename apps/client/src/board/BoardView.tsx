// <BoardView> — the static board as SVG (docs/11 §3). Pure: renders from a board state +
// GEOMETRY, no store access. Pieces/robber/interaction layers slot in as children.

import {
  GEOMETRY,
  type BoardGeometry,
  type GameState,
  type HexId,
  type ScenarioTerrain,
} from '@hexhaven/shared';
import {
  HEX_SIZE,
  HEX_INSET,
  TILE_THICKNESS,
  SKIRT_DARKEN_AMOUNT,
  SEA,
  SEA_DEEP,
  GOLD,
  GOLD_DEEP,
  COAST_SAND,
  FOG_MIST,
  FOG_MIST_DEEP,
  TOKEN_FACE,
  TOKEN_RING,
  TOKEN_RED,
  INK,
  pipCount,
  isRedNumber,
  scenarioTerrainFill,
  darken,
} from './palette';
import { boardProjection, type BoardProjection } from './projection';
import { RESOURCE_GLYPH } from '../hud/constants';

type BoardState = GameState['board'];

const S = HEX_SIZE;
const MARGIN = 46;

function px(n: number): number {
  return n * S;
}

type Point = { x: number; y: number };

/** Moves `p` toward `c` by an absolute `dist` px along the segment between them — how each non-sea
 * hex's top face is pulled in from its true (shared-with-neighbours) vertices (T-1210's per-hex
 * inset, `HEX_INSET`) so adjacent 3D tiles read as separate raised slabs with a visible seam. */
function insetToward(p: Point, c: Point, dist: number): Point {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: p.x - (dx / len) * dist, y: p.y - (dy / len) * dist };
}

export interface BoardViewProps {
  board: BoardState;
  geometry?: BoardGeometry;
  /** Seafarers only (T-704): the authoritative per-hex scenario terrain (`sea`/`gold`/land), aligned
   *  to `geometry.hexes` — from `view.ext.seafarers.hexTerrain`. When absent, hexes render from the
   *  base `board.hexes[i].terrain` exactly as before (base/EXT56 unchanged). Sea/gold are proxied to
   *  `desert` in `board.hexes`, so this override is how the ocean/gold tiles actually draw. */
  hexTerrain?: readonly ScenarioTerrain[];
  /** `hiddenSetupNumbers` modifier: the redacted view has stripped every token during initial
   *  placement, so render a "?" on each number-bearing hex instead of reading `tile.token`. */
  hiddenNumbers?: boolean;
  /** Explorers & Pirates (T-1108, §EP2.1/§EP5.1): hex ids still face-down — from
   *  `view.ext.explorersPirates.unexplored`. Each renders a fog cover (mirrors the `hiddenNumbers`
   *  "?" treatment above) OVER whatever `hexTerrain`/`board.hexes` say about that hex (which is
   *  itself fogged to `'sea'` by `redact.ts` — the fog layer is what visually distinguishes a
   *  still-unexplored hex from genuinely revealed open sea). Empty outside a live E&P game. */
  epUnexplored?: readonly HexId[];
  /** The Fog Islands (T-756, Seafarers 5-6 scenario): hex ids still face-down — from
   *  `view.ext.seafarers.fog.hidden`. Rendered with the SAME fog-cover treatment as `epUnexplored`
   *  above (a hidden hex is a hidden hex — the cover doesn't need to distinguish which expansion
   *  owns it). Minimal v1 rendering (task T-756); a follow-up may give it its own visual. Empty
   *  outside a live Fog Islands game. */
  seafarersFogHidden?: readonly HexId[];
  /** T-1210 "3D board": the shared affine tilt (`board/projection.ts`), also threaded through
   *  `InteractionLayer` so clicks stay pixel-exact on a tilted board. Defaults to the tilted
   *  projection (the shipped default look — `useBoard3d()` defaults ON too); pass
   *  `boardProjection(false)` for the flat board, which renders byte-identical to pre-T-1210. */
  projection?: BoardProjection;
  children?: React.ReactNode;
}

export function BoardView({
  board,
  geometry = GEOMETRY,
  hexTerrain,
  hiddenNumbers = false,
  epUnexplored = [],
  seafarersFogHidden = [],
  projection = boardProjection(true),
  children,
}: BoardViewProps) {
  const vx = (id: number) => {
    const v = geometry.vertices[id];
    if (!v) throw new Error(`BUG: vertex ${id}`);
    return v;
  };
  // Raw (pre-tilt) hex centre — every JSX consumer below runs it through `proj`/`project` before
  // emitting a coordinate; the raw value is what direction/inset math (harbors, skirts) is done in.
  const hexCenter = (id: HexId): Point => {
    const h = geometry.hexes[id];
    if (!h) throw new Error(`BUG: hex ${id}`);
    return { x: px(h.x), y: px(h.y) };
  };
  /** Projects a raw px-space point through the board's shared tilt (T-1210). `height` only ever
   *  matters when `projection.enabled` — the identity projection ignores it, per `projection.ts`. */
  const project = (p: Point, height?: number) => projection.project(p.x, p.y, height);
  // T-756: the Fog Islands' still-hidden hexes render with the SAME cover as E&P's `unexplored` —
  // union the two sets so one rendering block below covers both (only one is ever non-empty for a
  // given game, since the two expansions never combine, docs/10 §3).
  const epFogHexes = new Set([...epUnexplored, ...seafarersFogHidden]);

  // viewBox from PROJECTED vertex extents (requirement 3) — a tilted board's silhouette isn't the
  // same rectangle as the flat one, so the box must be recomputed post-projection or the tilted
  // island would run off the edge / leave lopsided empty margin. `projection.enabled === false` is
  // the identity map, so this is numerically identical to the pre-T-1210 "scaled vertex extents"
  // computation in that case (RK-13-style byte-identical guarantee for the flat board).
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const v of geometry.vertices) {
    const p = project({ x: px(v.x), y: px(v.y) });
    minX = Math.min(minX, p.sx);
    minY = Math.min(minY, p.sy);
    maxX = Math.max(maxX, p.sx);
    maxY = Math.max(maxY, p.sy);
  }
  // Room for hex skirts hanging TILE_THICKNESS below the frontmost (largest-y) tiles' top faces —
  // otherwise the nearest row's side walls would be clipped by the viewBox.
  if (projection.enabled) maxY += TILE_THICKNESS;
  const vbX = minX - MARGIN;
  const vbY = minY - MARGIN;
  const vbW = maxX - minX + MARGIN * 2;
  const vbH = maxY - minY + MARGIN * 2;

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      className="h-full w-full select-none"
      role="img"
      aria-label="HEXHAVEN board"
    >
      <defs>
        <radialGradient id="sea-grad" cx="50%" cy="42%" r="75%">
          <stop offset="0%" stopColor={SEA} />
          <stop offset="100%" stopColor={SEA_DEEP} />
        </radialGradient>
        {/* Gold field shimmer (Seafarers, S9): a warm metallic radial so gold reads as precious. */}
        <radialGradient id="gold-grad" cx="42%" cy="36%" r="80%">
          <stop offset="0%" stopColor="#fbe38a" />
          <stop offset="55%" stopColor={GOLD} />
          <stop offset="100%" stopColor={GOLD_DEEP} />
        </radialGradient>
        <filter id="piece-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" floodColor="#000" floodOpacity="0.35" />
        </filter>
        {/* T-1212 lighting polish: a soft ambient-occlusion blur for the board-shadow ellipse below —
            baked into the SVG itself (not a CSS drop-shadow) so it reads identically whether the
            surrounding page chrome is light or dark (docs/11 §2's table tokens flip between themes;
            the island's own render deliberately doesn't, tokens.dark.css). */}
        <filter id="board-shadow-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={TILE_THICKNESS * 0.4} />
        </filter>
      </defs>

      {/* Sea backdrop */}
      <rect x={vbX} y={vbY} width={vbW} height={vbH} fill="url(#sea-grad)" />

      {/* T-1212: a soft global shadow the raised island casts onto the sea in front of it — drawn
          UNDER the hexes/skirts (they paint over its top half), so only the "spill" past the
          island's front edge shows, selling the tabletop's depth. 3D-off has no raised slab to cast
          one, so this is gated on `projection.enabled` (a no-op, byte-identical flat board). */}
      {projection.enabled && (
        <ellipse
          data-testid="board-shadow"
          cx={(minX + maxX) / 2}
          cy={maxY - TILE_THICKNESS * 0.2}
          rx={(maxX - minX) * 0.46}
          ry={TILE_THICKNESS * 0.9}
          fill="#00000048"
          filter="url(#board-shadow-blur)"
        />
      )}

      {/* Coastline: thick sand stroke on the island's outer edges. */}
      <g stroke={COAST_SAND} strokeWidth={S * 0.34} strokeLinecap="round" opacity={0.9}>
        {geometry.coastEdges.map((eid) => {
          const e = geometry.edges[eid];
          if (!e) return null;
          const a = project({ x: px(vx(e.a).x), y: px(vx(e.a).y) });
          const b = project({ x: px(vx(e.b).x), y: px(vx(e.b).y) });
          return <line key={`c${eid}`} x1={a.sx} y1={a.sy} x2={b.sx} y2={b.sy} />;
        })}
      </g>

      {/* Hexes (+ T-1210 skirts). With 3D on, draw back-to-front (ascending raw board-space y) so a
          nearer tile/skirt paints over the one behind it — requirement 3's depth-order rule. With 3D
          off this is a no-op re-sort by the identical key React already used (id order == geometry
          order), so the flat board's DOM stays byte-identical to pre-T-1210. */}
      {(projection.enabled ? [...geometry.hexes].sort((a, b) => a.y - b.y) : geometry.hexes).map((h) => {
        const tile = board.hexes[h.id];
        if (!tile) return null;
        // Authoritative terrain: the Seafarers scenario map when present (sea/gold live only here,
        // proxied to `desert` in `board.hexes`), else the base tile terrain (base/EXT56 unchanged).
        const terrain: ScenarioTerrain = hexTerrain?.[h.id] ?? tile.terrain;
        const isSea = terrain === 'sea';
        const rawC = hexCenter(h.id);
        const rawVerts = h.vertices.map((vid) => {
          const v = vx(vid);
          return { x: px(v.x), y: px(v.y) };
        });
        // T-1210: every non-sea hex reads as its OWN raised tile — pulled in slightly from its true
        // (shared-with-neighbours) vertices so adjacent tiles show a seam. Sea stays un-inset (flat,
        // melts into the backdrop) and this only ever runs with 3D on (flat board ⇒ `rawVerts`
        // unchanged ⇒ identical polygon to pre-T-1210).
        const topRawVerts = projection.enabled && !isSea ? rawVerts.map((p) => insetToward(p, rawC, HEX_INSET)) : rawVerts;
        const topPts = topRawVerts.map((p) => project(p));
        const pts = topPts.map((p) => `${p.sx},${p.sy}`);
        const c = project(rawC);
        const fill = scenarioTerrainFill(terrain);
        return (
          <g
            key={`h${h.id}`}
            // T-501 e2e requirement 2: a "board fingerprint" needs the terrain/token layout exposed
            // as DOM data-attrs so Playwright can compare what all 4 seats' boards render without
            // any hidden-info concern (board layout is fully public, docs/02 §6) — no existing
            // testid/role covers per-hex terrain, so this is a minimal, justified addition.
            data-testid={`hex-tile-${h.id}`}
            data-hex-id={h.id}
            data-terrain={terrain}
            data-token={tile.token ?? ''}
          >
            {/* T-1210 skirts: side walls on this hex's OWN viewer-facing edges (top faces stay
                coplanar at height 0 — no per-terrain elevation, so T-1211's vertex piece placement
                doesn't have to account for it). Drawn BEFORE the top face so the top face's fill
                always paints over its own skirts' top seam. */}
            {projection.enabled &&
              !isSea &&
              topRawVerts.map((aRaw, i) => {
                const bRaw = topRawVerts[(i + 1) % topRawVerts.length]!;
                const aTop = topPts[i]!;
                const bTop = topPts[(i + 1) % topPts.length]!;
                // Viewer-facing = this edge's midpoint projects nearer the viewer (larger sy) than
                // the hex's own centre — the "lower half" of the tile in screen space.
                const isFront = (aTop.sy + bTop.sy) / 2 > c.sy;
                if (!isFront) return null;
                const aBot = project(aRaw, -TILE_THICKNESS);
                const bBot = project(bRaw, -TILE_THICKNESS);
                return (
                  <polygon
                    key={`sk${h.id}-${i}`}
                    data-testid={`hex-skirt-${h.id}`}
                    points={`${aTop.sx},${aTop.sy} ${bTop.sx},${bTop.sy} ${bBot.sx},${bBot.sy} ${aBot.sx},${aBot.sy}`}
                    fill={darken(fill, SKIRT_DARKEN_AMOUNT)}
                    stroke="#00000030"
                    strokeWidth={1}
                  />
                );
              })}
            <polygon
              points={pts.join(' ')}
              fill={fill}
              // Sea hexes carry no outline so they melt into the ocean backdrop (docs/11 §4).
              stroke={isSea ? 'none' : '#00000022'}
              strokeWidth={2}
            />
            <TerrainMotif terrain={terrain} cx={c.sx} cy={c.sy} />
            {/* inner bevel highlight (skipped on sea so the tile edge stays invisible) */}
            {!isSea && (
              <polygon
                points={pts.join(' ')}
                fill="none"
                stroke="#ffffff30"
                strokeWidth={1.5}
                transform={`translate(${c.sx} ${c.sy}) scale(0.9) translate(${-c.sx} ${-c.sy})`}
              />
            )}
          </g>
        );
      })}

      {/* Number tokens */}
      {geometry.hexes.map((h) => {
        const tile = board.hexes[h.id];
        if (!tile) return null;
        const c = project(hexCenter(h.id));
        const robbed = board.robber === h.id;
        if (hiddenNumbers) {
          // Blind placement (hiddenSetupNumbers): tokens were stripped in redaction, so decide from
          // terrain which hexes WILL carry a number (everything that isn't desert/sea) and show a "?".
          const terrain = hexTerrain?.[h.id] ?? tile.terrain;
          if (terrain === 'desert' || terrain === 'sea') return null;
          return <NumberToken key={`t${h.id}`} cx={c.sx} cy={c.sy} hidden dimmed={robbed} />;
        }
        if (tile.token == null) return null;
        return (
          <NumberToken key={`t${h.id}`} cx={c.sx} cy={c.sy} value={tile.token} dimmed={robbed} />
        );
      })}

      {/* Harbors */}
      {Object.entries(board.harbors).map(([eidStr, type]) => {
        const eid = Number(eidStr);
        const e = geometry.edges[eid];
        if (!e) return null;
        // Orient the dock toward OPEN SEA — i.e. outward from the LAND hex the harbor serves. On a
        // base coast edge `e.hexes[0]` is that land hex, but on a Seafarers harbor edge (land + sea,
        // both on-board) `e.hexes[0]` may be the SEA hex, which would point the dock INWARD (B-24).
        // sea hexes are only identifiable via `hexTerrain` (board.hexes proxies sea → 'desert').
        const hid = e.hexes.find((h) => h != null && hexTerrain?.[h] !== 'sea') ?? e.hexes[0];
        if (hid == null) return null;
        // Direction math stays in raw (pre-tilt) space — the affine tilt scales y uniformly, so an
        // "outward" unit vector computed here still points away from the hex once BOTH endpoints are
        // projected; only the final `mid`/`(bx,by)` points are projected, right before rendering.
        const hc = hexCenter(hid);
        const rawMid = { x: px(e.x), y: px(e.y) };
        // outward = from the land hex centre through the edge midpoint (toward the sea)
        let dx = rawMid.x - hc.x,
          dy = rawMid.y - hc.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const rawB = { x: rawMid.x + dx * S * 0.5, y: rawMid.y + dy * S * 0.5 };
        const mid = project(rawMid);
        const b = project(rawB);
        const label = type === 'generic' ? '3:1' : '2:1';
        return (
          <g key={`hb${eid}`}>
            <line
              x1={mid.sx}
              y1={mid.sy}
              x2={b.sx}
              y2={b.sy}
              stroke="#8a6a42"
              strokeWidth={S * 0.12}
              strokeLinecap="round"
            />
            {/* A slightly larger token; a resource (2:1) harbor shows the RESOURCE ICON above the
                ratio instead of a cryptic, overflowing 3-letter abbreviation ("bri") — the icon says
                which resource at a glance and needs no translation (playtest: "can't read the bonus"). */}
            <circle cx={b.sx} cy={b.sy} r={S * 0.32} fill="#efe4c6" stroke="#8a6a42" strokeWidth={2} />
            {type === 'generic' ? (
              <text
                x={b.sx}
                y={b.sy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={S * 0.26}
                fontWeight={700}
                fill={INK}
              >
                {label}
              </text>
            ) : (
              <>
                <text x={b.sx} y={b.sy - S * 0.09} textAnchor="middle" dominantBaseline="central" fontSize={S * 0.24}>
                  {RESOURCE_GLYPH[type]}
                </text>
                <text
                  x={b.sx}
                  y={b.sy + S * 0.13}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={S * 0.19}
                  fontWeight={700}
                  fill={INK}
                >
                  {label}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* Explorers & Pirates fog (T-1108, §EP2.1/§EP5.1): drawn LAST (over terrain/tokens/harbors)
          so a still-unexplored hex reads as an unmistakable cover, not just a plain sea tile. */}
      {epFogHexes.size > 0 &&
        geometry.hexes.map((h) => {
          if (!epFogHexes.has(h.id)) return null;
          const c = project(hexCenter(h.id));
          const pts = h.vertices.map((vid) => {
            const v = vx(vid);
            return project({ x: px(v.x), y: px(v.y) });
          });
          const ptsStr = pts.map((p) => `${p.sx},${p.sy}`).join(' ');
          return (
            <g key={`fog${h.id}`} data-testid={`ep-fog-${h.id}`} data-hex-id={h.id}>
              <polygon points={ptsStr} fill={FOG_MIST} opacity={0.82} />
              <polygon points={ptsStr} fill="none" stroke={FOG_MIST_DEEP} strokeWidth={1.5} opacity={0.6} />
              <text
                x={c.sx}
                y={c.sy}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="var(--font-display)"
                fontSize={S * 0.55}
                fontWeight={700}
                fill="#f7f1e3"
                opacity={0.85}
              >
                {FOG_GLYPH}
              </text>
            </g>
          );
        })}

      {children}
    </svg>
  );
}

// Placeholder glyph for a still-unexplored E&P hex (mirrors `HIDDEN_TOKEN_GLYPH` below — a module
// const, not literal JSX text, so the i18n-guard lint rule doesn't flag it).
const FOG_GLYPH = '?';

// Placeholder glyph for a withheld number token (hiddenSetupNumbers modifier). A module const, not
// literal JSX text, so the i18n-guard lint rule doesn't flag it (same rationale as the harbor label).
const HIDDEN_TOKEN_GLYPH = '?';

function NumberToken({
  cx,
  cy,
  value,
  dimmed,
  hidden = false,
}: {
  cx: number;
  cy: number;
  /** The rolled number; omitted only when `hidden` (the token is being withheld during setup). */
  value?: number;
  dimmed: boolean;
  hidden?: boolean;
}) {
  const r = S * 0.4;
  if (hidden || value == null) {
    return (
      <g opacity={dimmed ? 0.4 : 1} filter="url(#piece-shadow)">
        <circle cx={cx} cy={cy} r={r} fill={TOKEN_FACE} stroke={TOKEN_RING} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={r - 3} fill="none" stroke={TOKEN_RING} strokeWidth={0.75} opacity={0.6} />
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="var(--font-display)"
          fontSize={S * 0.5}
          fontWeight={700}
          fill={INK}
        >
          {HIDDEN_TOKEN_GLYPH}
        </text>
      </g>
    );
  }
  const red = isRedNumber(value);
  const pips = pipCount(value);
  // Bigger, clearer frequency dots (playtest: the pips were too small to read at a glance). 6/8 show
  // five fat dots; 2/12 a single small one — the standard visual cue for how often a hex pays out.
  const pipR = S * 0.038;
  const pipGap = S * 0.095;
  const startX = cx - ((pips - 1) * pipGap) / 2;
  return (
    <g opacity={dimmed ? 0.4 : 1} filter="url(#piece-shadow)">
      <circle cx={cx} cy={cy} r={r} fill={TOKEN_FACE} stroke={TOKEN_RING} strokeWidth={2} />
      <circle cx={cx} cy={cy} r={r - 3} fill="none" stroke={TOKEN_RING} strokeWidth={0.75} opacity={0.6} />
      <text
        x={cx}
        y={cy - S * 0.05}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-display)"
        fontSize={S * 0.42}
        fontWeight={700}
        fill={red ? TOKEN_RED : INK}
      >
        {value}
      </text>
      <g fill={red ? TOKEN_RED : INK}>
        {Array.from({ length: pips }).map((_, i) => (
          <circle key={i} cx={startX + i * pipGap} cy={cy + S * 0.22} r={pipR} />
        ))}
      </g>
    </g>
  );
}

function TerrainMotif({ terrain, cx, cy }: { terrain: ScenarioTerrain; cx: number; cy: number }) {
  const g = (children: React.ReactNode, opacity = 0.5) => (
    <g transform={`translate(${cx} ${cy})`} opacity={opacity}>
      {children}
    </g>
  );
  switch (terrain) {
    case 'sea':
      // Subtle wave motif — two lighter crests, low opacity so the ocean stays calm (docs/11 §4).
      return g(
        <>
          {[-8, 8].map((dy, i) => (
            <path
              key={i}
              d={`M ${-20} ${dy} q 10 -7 20 0 q 10 7 20 0`}
              fill="none"
              stroke="#cfe6f2"
              strokeWidth={2}
            />
          ))}
        </>,
        0.35
      );
    case 'gold':
      // Gold shimmer: a few four-point sparkles catching the light (docs/11 §4).
      return g(
        <>
          {([
            [-10, -6, 5],
            [12, 2, 4],
            [-2, 10, 3.5],
          ] as [number, number, number][]).map(([x, y, r], i) => (
            <path
              key={i}
              d={`M ${x} ${y - r} L ${x + r * 0.32} ${y - r * 0.32} L ${x + r} ${y} L ${x + r * 0.32} ${y + r * 0.32} L ${x} ${y + r} L ${x - r * 0.32} ${y + r * 0.32} L ${x - r} ${y} L ${x - r * 0.32} ${y - r * 0.32} Z`}
              fill="#fff6d0"
            />
          ))}
        </>,
        0.85
      );
    case 'forest':
      return g(
        <>
          {[-0.42, 0.0, 0.42].map((dx, i) => (
            <polygon
              key={i}
              points={`${dx * S - 8},${6} ${dx * S},${-14 - (i === 1 ? 4 : 0)} ${dx * S + 8},${6}`}
              fill="#1f5230"
            />
          ))}
        </>
      );
    case 'mountains':
      return g(
        <>
          {[-0.4, 0.05].map((dx, i) => (
            <g key={i}>
              <polygon
                points={`${dx * S},${12} ${dx * S + 16},${-16} ${dx * S + 32},${12}`}
                fill="#6f727a"
              />
              <polygon
                points={`${dx * S + 10},${-4} ${dx * S + 16},${-16} ${dx * S + 22},${-4}`}
                fill="#e9edf2"
              />
            </g>
          ))}
        </>
      );
    case 'hills':
      return g(
        <>
          {[-0.3, 0.0, 0.3].map((dx, i) => (
            <path
              key={i}
              d={`M ${dx * S - 12} ${8 + i * 2} q 12 -12 24 0`}
              fill="none"
              stroke="#8f4526"
              strokeWidth={3}
            />
          ))}
        </>
      );
    case 'fields':
      return g(
        <>
          {[-10, 0, 10].map((dy, i) => (
            <path
              key={i}
              d={`M ${-22} ${dy} q 11 -6 22 0 q 11 6 22 0`}
              fill="none"
              stroke="#c79320"
              strokeWidth={3}
            />
          ))}
        </>
      );
    case 'pasture':
      return g(
        <>
          {[
            [-12, -6],
            [10, -8],
            [-4, 8],
            [16, 6],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={4} fill="#5f8a42" />
          ))}
        </>
      );
    case 'desert':
      return g(
        <path
          d={`M ${-22} 8 q 22 -14 44 0`}
          fill="none"
          stroke="#c9b483"
          strokeWidth={3}
        />,
        0.7
      );
    default:
      return null;
  }
}
