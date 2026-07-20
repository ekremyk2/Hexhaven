// HUD render constants (T-402). Resource card fills reuse the terrain palette from
// `board/palette.ts` (task requirement 4: "colors, from board/palette.ts colors") rather than
// declaring new ad-hoc hex — each resource maps to the terrain hex that produces it (R1).
import type { ResourceType } from '@hexhaven/shared';
import { TERRAIN_FILL } from '../board/palette';

/** Canonical display order for the 5 resource types across Hand/BankPanel. */
export const RESOURCE_ORDER: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

export const RESOURCE_FILL: Record<ResourceType, string> = {
  brick: TERRAIN_FILL.hills,
  lumber: TERRAIN_FILL.forest,
  wool: TERRAIN_FILL.pasture,
  grain: TERRAIN_FILL.fields,
  ore: TERRAIN_FILL.mountains,
};

/** Playtest fix (readability): one shared glyph per resource type, reused by both the HUD
 * (Hand/BankPanel below) and `trade/ResourceIcon.tsx` (which re-exports this constant so its
 * existing importers — devcards/**, trade/** — keep working unchanged). Emoji pictograms, not
 * routed through i18n: they're decorative glyphs, always paired with a translated count/label
 * (docs/05 §7's i18n-guard only flags literal JSX text/string children, not `{EXPRESSION}` glyph
 * lookups like this). Double-coded with `RESOURCE_FILL` above per docs/11 §4 (shape/glyph + color,
 * never color alone) so the mapping stays colorblind-safe. */
export const RESOURCE_GLYPH: Record<ResourceType, string> = {
  brick: '🧱',
  lumber: '🌲',
  wool: '🐑',
  grain: '🌾',
  ore: '⛰️',
};

/** Card-back/dev-card-back glyphs for opponent count badges (docs/02 §6: counts only, no
 * identities) — decorative, always `aria-hidden`, the real accessible text is the translated
 * count next to them. */
export const RESOURCE_BACK_GLYPH = '\u{1F0A0}'; // 🂠 card back
export const DEV_CARD_BACK_GLYPH = '\u{1F0CF}'; // 🃏 joker-as-dev-card-back stand-in
export const KNIGHT_GLYPH = '⚔️'; // ⚔️
