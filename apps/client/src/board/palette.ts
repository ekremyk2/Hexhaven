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
