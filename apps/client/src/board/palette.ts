// Board render constants — docs/11 §1/§3/§4. Values mirror theme/tokens.css so SVG fills
// (which can't read CSS vars reliably across all renderers) stay in sync with the token layer.

import type { TerrainType, ScenarioTerrain, Seat } from '@hexhaven/shared';

export const HEX_SIZE = 56; // px per geometry unit (geometry coords are in unit-1 space)

export const TERRAIN_FILL: Record<TerrainType, string> = {
  hills: '#b45d33',
  forest: '#2f6b3c',
  pasture: '#7fb05a',
  fields: '#dfae3c',
  mountains: '#8b8d93',
  desert: '#e3d5ae',
};

export const SEA = '#3d7ea6';
export const SEA_DEEP = '#2f6480';
export const COAST_SAND = '#e8d9a8';

// Seafarers terrain (docs/11 §4): `sea` blends into the ocean backdrop (rendered with the shared
// `sea-grad`); `gold` is a warm shimmering field that still carries a number token (S9.1).
export const GOLD = '#e7b526';
export const GOLD_DEEP = '#b8860b';

/** Fill for a scenario terrain. Sea/gold reference the board's radial gradients so a sea hex melts
 *  into the ocean and gold reads as metallic; base terrains use their flat `TERRAIN_FILL`. */
export function scenarioTerrainFill(terrain: ScenarioTerrain): string {
  if (terrain === 'sea') return 'url(#sea-grad)';
  if (terrain === 'gold') return 'url(#gold-grad)';
  return TERRAIN_FILL[terrain];
}

// Explorers & Pirates fog (T-1108, §EP2.1/§EP5.1): the cover drawn over `unexplored` hexes — a misty
// grey-blue, distinct from both the terrain fills above AND `SEA`/`SEA_DEEP` (an unexplored hex's
// `seaMap` entry is itself fogged to `'sea'` by `redact.ts`, so the fog layer must read as visibly
// DIFFERENT from ordinary open water, or a still-fogged hex and a revealed sea hex would look
// identical on the board).
export const FOG_MIST = '#7b8794';
export const FOG_MIST_DEEP = '#4a5560';

export const TOKEN_FACE = '#f3e9cf';
export const TOKEN_RING = '#7a6a44';
export const TOKEN_RED = '#c62828';
export const INK = '#2b2416';

// Seat identity: colour + shape badge (colour-blind safe, docs/11 §4).
export const PLAYER_COLORS: Record<Seat, string> = {
  0: '#c62828',
  1: '#1e5fb4',
  2: '#f5f0e6',
  3: '#e07b28',
  4: '#2e7d32',
  5: '#6d4c2f',
};

// Badge glyphs rendered as <text> centred on each piece.
export const PLAYER_BADGES: Record<Seat, string> = {
  0: '●', // ●
  1: '▲', // ▲
  2: '■', // ■
  3: '◆', // ◆
  4: '✚', // ✚
  5: '⬟', // ⬟
};

/** Badge/text colour that reads on a given seat colour (seat 2 is near-white). */
export function contrastInk(seat: Seat): string {
  return seat === 2 ? '#2b2416' : '#f7f1e3';
}

/** Pip count under a number token (docs/01 R16): 6/8 are the reddest. */
export function pipCount(value: number): number {
  return 6 - Math.abs(7 - value);
}

export function isRedNumber(value: number): boolean {
  return value === 6 || value === 8;
}

// --- 3D board (T-1210): per-hex "chunky raised tile" look ------------------------------------
// Every non-sea hex renders as its OWN proud tile (not just the island's outer rim): its top face
// is inset slightly toward its centre so neighbouring tiles show a visible gap/seam, and its
// viewer-facing edges (per `projection.ts`'s tilt) get a filled side wall down to `-TILE_THICKNESS`.
// Gated entirely behind `BoardProjection.enabled` in BoardView — with 3D off neither constant is
// consulted, so the flat board stays byte-identical to pre-T-1210.

/** How far (px) each hex's top-face vertex is pulled toward the hex centre, so adjacent 3D tiles
 *  read as separate raised slabs rather than one seamless island. ~5% of `HEX_SIZE`. */
export const HEX_INSET = HEX_SIZE * 0.05;

/** How far (px) a hex's side walls ("skirt") hang below its top face — the tile's visible
 *  thickness. Passed as the negative `height` to `BoardProjection.project` for the wall's bottom
 *  edge. */
export const TILE_THICKNESS = HEX_SIZE * 0.4;

/** How much darker a skirt's fill is than its tile's top-face fill (0 = same, 1 = black) — reads as
 *  the side wall being in shadow relative to the sunlit top face. */
export const SKIRT_DARKEN_AMOUNT = 0.4;

/** Darkens a `#rrggbb` color toward black by `amount` (0..1) — used to derive a hex's skirt shade
 *  from its top-face fill without hand-picking a `*_SIDE` constant per terrain. Non-hex fills (e.g.
 *  a gradient reference like `url(#gold-grad)`, which sea/gold hexes use) pass through unchanged —
 *  callers only ever darken a LAND hex's flat `TERRAIN_FILL`, never a gradient url, but this keeps
 *  the helper total rather than throwing on unexpected input. */
export function darken(fill: string, amount: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(fill)) return fill;
  const n = parseInt(fill.slice(1), 16);
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel * (1 - amount))));
  const r = clamp((n >> 16) & 0xff);
  const g = clamp((n >> 8) & 0xff);
  const b = clamp(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// --- 3D board (T-1211): faux-3D piece shading ------------------------------------------------
// `darken` (above) already gives hex-tile skirts their shadow; standing PIECES (settlements,
// cities, roads/ships, the robber/pirate) need the OTHER half of two-tone shading too — a
// lightened "lit roof/top face" derived from the same seat colour, so a piece's raised body reads
// as catching light on top and sitting in shadow on its sides without any hand-picked `*_LIT`
// constant per seat. Symmetric with `darken`: same hex-only guard, same passthrough for non-hex
// fills (e.g. a gradient url), same 0..1 amount convention (0 = unchanged, 1 = white).

/** Lightens a `#rrggbb` color toward white by `amount` (0..1) — the roof/top-face counterpart to
 *  `darken`'s skirt/wall shade. Non-hex fills pass through unchanged (see `darken`'s rationale). */
export function lighten(fill: string, amount: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(fill)) return fill;
  const n = parseInt(fill.slice(1), 16);
  const clamp = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel + (255 - channel) * amount)));
  const r = clamp((n >> 16) & 0xff);
  const g = clamp((n >> 8) & 0xff);
  const b = clamp(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
