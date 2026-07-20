// ResourceIcon (T-404 requirement 4): shared resource glyph, an emoji-based MVP with a
// palette-colored ring so it stays colorblind-safe (docs/11 §4 double-coding: shape/glyph + color,
// never color alone). Colors reuse `hud/constants.ts`'s `RESOURCE_FILL` (itself sourced from
// `board/palette.ts`'s terrain palette) rather than declaring new ad-hoc hex.
//
// Playtest fix (readability) follow-up: `RESOURCE_GLYPH` now lives in `hud/constants.ts` (next to
// `RESOURCE_FILL`, which it was always paired with) so `Hand`/`BankPanel` can use the exact same
// glyph mapping as this trade tray without a second definition. Re-exported here unchanged so this
// module's existing importers (`devcards/DevCardsPanel.tsx`, this file's own test) keep working.
import type { ResourceBundle, ResourceType } from '@hexhaven/shared';
import { RESOURCE_FILL, RESOURCE_GLYPH } from '../hud/constants';

export { RESOURCE_GLYPH };

/** Decorative "give -> receive" divider (bank preview, tracker summary, incoming-offer card) — a
 * plain constant like `RESOURCE_GLYPH` above, not routed through i18n: it's a punctuation glyph,
 * not user-facing copy, and every accessible-text neighbor is already translated (docs/05 §7's
 * i18n-guard lint rule only flags literal JSX text nodes, not `{EXPRESSION}` children like this). */
export const ARROW_GLYPH = '→';

export interface ResourceIconProps {
  resource: ResourceType;
  /** Omit to render a bare glyph (e.g. a legend); present (including 0) to show a count badge. */
  count?: number;
}

export function ResourceIcon({ resource, count }: ResourceIconProps) {
  return (
    <span
      data-testid={`resource-icon-${resource}`}
      className="inline-flex items-center gap-1 rounded-full border-2 px-1.5 py-0.5 font-ui text-12 font-semibold text-ink"
      style={{ borderColor: RESOURCE_FILL[resource] }}
    >
      <span aria-hidden="true" className="text-14 leading-none">
        {RESOURCE_GLYPH[resource]}
      </span>
      {count != null ? <span data-testid={`resource-icon-${resource}-count`}>{count}</span> : null}
    </span>
  );
}

/** Renders every non-zero resource in a bundle as a `ResourceIcon` with its count — the "give"/
 * "receive" side of a trade preview, tracker summary, or incoming-offer card. Empty bundle renders
 * nothing (never a bare glyph with no count, which would misleadingly read as "1 of everything"). */
export function ResourceBundleIcons({ bundle }: { bundle: ResourceBundle }) {
  const entries = (Object.entries(bundle) as [ResourceType, number | undefined][]).filter(
    ([, count]) => (count ?? 0) > 0
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {entries.map(([resource, count]) => (
        <ResourceIcon key={resource} resource={resource} count={count} />
      ))}
    </span>
  );
}
