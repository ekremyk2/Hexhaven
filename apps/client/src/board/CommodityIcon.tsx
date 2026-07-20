// Commodity + improvement-track atoms (T-805 requirement 5, "optional, light"): small reusable
// presentational pieces for the 3 commodities (C3.1) and a compact 0–5 improvement-track level
// display (C4.1), built the same way `trade/ResourceIcon.tsx` builds its resource glyphs — a
// palette-colored badge, never color alone (docs/11 §4 double-coding: glyph + color). T-806 wires
// these into the live HUD; this task only builds the presentational shells.
import { useTranslation } from 'react-i18next';
import type { Commodity, ImprovementTrack } from '@hexhaven/shared';
import { Meter } from '../ui';
import { COMMODITY_COLOR, TRACK_COLOR } from './citiesKnightsPalette';

/** Decorative pictograms (not routed through i18n — always paired with a translated label/count
 *  next to them, matching `hud/constants.ts`'s `RESOURCE_GLYPH` convention; docs/05 §7's i18n-guard
 *  only flags literal JSX text, not `{EXPRESSION}` glyph lookups like this). */
export const COMMODITY_GLYPH: Record<Commodity, string> = {
  paper: '📜',
  cloth: '🧶',
  coin: '🪙',
};

export interface CommodityIconProps {
  commodity: Commodity;
  /** Omit to render a bare glyph (e.g. a legend); present (including 0) to show a count badge. */
  count?: number;
}

export function CommodityIcon({ commodity, count }: CommodityIconProps) {
  const { t } = useTranslation('citiesKnights');
  return (
    <span
      data-testid={`commodity-icon-${commodity}`}
      className="inline-flex items-center gap-1 rounded-full border-2 px-1.5 py-0.5 font-ui text-12 font-semibold text-ink"
      style={{ borderColor: COMMODITY_COLOR[commodity] }}
      title={t(`commodity.${commodity}`)}
    >
      <span aria-hidden="true" className="text-14 leading-none">
        {COMMODITY_GLYPH[commodity]}
      </span>
      {count != null ? <span data-testid={`commodity-icon-${commodity}-count`}>{count}</span> : null}
    </span>
  );
}

export interface ImprovementTrackDisplayProps {
  track: ImprovementTrack;
  /** Current level, 0–5 (C4.1). */
  level: number;
  /** Highlights the track name when this seat holds the track at level 3 (C4.5 standing ability) —
   *  purely a visual affordance; callers decide the condition. */
  hasStandingAbility?: boolean;
}

/** Compact 0–5 level display for one improvement track: the track's translated name plus 5 pip
 *  slots, filled up to `level` in the track's color (`TRACK_COLOR`). */
export function ImprovementTrackDisplay({ track, level, hasStandingAbility }: ImprovementTrackDisplayProps) {
  const { t } = useTranslation('citiesKnights');
  const color = TRACK_COLOR[track];
  const clamped = Math.max(0, Math.min(level, 5));
  return (
    <div
      className="flex items-center gap-1.5 font-ui text-12"
      data-testid={`improvement-track-${track}`}
      data-level={clamped}
    >
      <span className={hasStandingAbility ? 'font-semibold text-ink' : 'text-ink-soft'} style={{ color }}>
        {t(`track.${track}`)}
      </span>
      <Meter value={clamped} max={5} color={color} size={10} trailing={`${clamped}/5`} />
    </div>
  );
}
