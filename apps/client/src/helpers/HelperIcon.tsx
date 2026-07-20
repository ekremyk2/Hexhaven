// HelperIcon (card/ability clarity pass): a small decorative glyph per helper, so each of the 10
// "Helpers of Hexhaven" powers gets a recognizable visual alongside its translated name/description —
// same lightweight approach `board/CommodityIcon.tsx`'s `COMMODITY_GLYPH` already uses for the 3
// commodities (an original-emoji pictogram, not routed through i18n itself since it's always paired
// with translated text next to it; docs/05 §7's i18n-guard only flags literal JSX text). No SVG asset
// work implied by docs/11 — that doc doesn't define a Helpers-of-Hexhaven art recipe (it's a home-grown
// modifier, not a shipped expansion) — so this stays in the same "emoji pictogram" register the
// codebase already established rather than inventing new bespoke art out of scope for this task.
import type { HelperId } from '@hexhaven/shared';

export const HELPER_GLYPH: Record<HelperId, string> = {
  mayor: '🏛️',
  general: '🎖️',
  explorer: '🧭',
  mendicant: '🙏',
  robberBride: '💍',
  merchant: '🧳',
  captain: '⚓',
  noblewoman: '👑',
  architect: '📐',
  priest: '⛪',
};

export interface HelperIconProps {
  helper: HelperId;
}

/** Bare decorative glyph — `aria-hidden` since callers always render the translated name as real
 *  text right alongside it (mirrors `CommodityIcon`'s own accessibility discipline). */
export function HelperIcon({ helper }: HelperIconProps) {
  return (
    <span aria-hidden="true" className="text-14 leading-none" data-testid={`helper-icon-${helper}`}>
      {HELPER_GLYPH[helper]}
    </span>
  );
}
