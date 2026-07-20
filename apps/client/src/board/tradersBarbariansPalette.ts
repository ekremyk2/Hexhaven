// Traders & Barbarians render constants (T-1008). docs/11-visual-design.md predates T&B and has no
// dedicated token section for its commodities/pieces yet (same gap `citiesKnightsPalette.ts` already
// documents for C&K). Per docs/05 §8 ("no ad-hoc hex"), every color below REUSES an existing docs/11
// §1 token from `./palette.ts` rather than inventing new hex — mirrors `citiesKnightsPalette.ts`'s
// own discipline exactly. PM: fold these into docs/11 in the visual polish pass.

import { TERRAIN_FILL } from './palette';

/** §TB6.1 commodity colors: marble reuses the mountains grey (stone); glass reuses the sea blue
 *  (transparency); sand reuses the desert tan (its own name); tools reuses the terracotta accent
 *  (crafted metal/wood). A distinct 4-commodity set from Cities & Knights' paper/cloth/coin — kept in
 *  its own map rather than widening `COMMODITY_COLOR`, which is typed for exactly those 3. */
export const TB_COMMODITY_COLOR: Record<'marble' | 'glass' | 'sand' | 'tools', string> = {
  marble: TERRAIN_FILL.mountains,
  glass: '#3d7ea6',
  sand: TERRAIN_FILL.desert,
  tools: '#b3541e',
};

/** Decorative pictograms (not routed through i18n — always paired with a translated label/count
 *  next to them, mirrors `board/CommodityIcon.tsx`'s `COMMODITY_GLYPH` convention). */
export const TB_COMMODITY_GLYPH: Record<'marble' | 'glass' | 'sand' | 'tools', string> = {
  marble: '🗿',
  glass: '🔷',
  sand: '⏳',
  tools: '🔧',
};

/** Trade-hex kind colors (main scenario, §TB6.1) — reuses the same commodity a hex PRODUCES as its
 *  own accent, so a quarry (produces sand+marble) reads in sand's tan, etc. */
export const TB_TRADE_HEX_COLOR: Record<'quarry' | 'glassworks' | 'castle', string> = {
  quarry: TB_COMMODITY_COLOR.sand,
  glassworks: TB_COMMODITY_COLOR.glass,
  castle: TB_COMMODITY_COLOR.marble,
};

/** The Lake/Oasis glyph tint (fishermen/caravans, §TB2.1/§TB4.1) — reuses the sea blue for the Lake
 *  and the fields gold for the Oasis (desert repurposed as a fertile stop). */
export const TB_LAKE_COLOR = '#3d7ea6';
export const TB_OASIS_COLOR = TERRAIN_FILL.fields;

/** River edges (§TB3.1) and barbarian pieces (§TB5/§TB6.3) — reuses the sea blue for water and the
 *  existing `BARBARIAN_ALERT` danger tone for barbarians (mirrors `citiesKnightsPalette.ts`). */
export const TB_RIVER_COLOR = '#3d7ea6';
export const TB_BARBARIAN_COLOR = '#8c2a1f';
export const TB_CAMEL_COLOR = TERRAIN_FILL.fields;
