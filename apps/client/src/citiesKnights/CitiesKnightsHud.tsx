// Cities & Knights HUD (T-806 Priority 1 requirement 3, redesigned by the rail-fits-without-
// scrolling playtest fix): the barbarian ship's progress (C8, now a compact strip) + the VIEWER's
// OWN commodities (C3.1) and improvement-track levels (C4.1) — all sourced from
// `view.ext.citiesKnights` (fully public, redact.ts). Gated on `isCitiesKnightsGame` so base/
// fiveSix/Seafarers HUD stays untouched (RK-13).
//
// This used to render a FULL block (commodities + all 3 tracks) for EVERY seat — "the biggest
// offender" the playtest called out for why the sidebar couldn't fit without scrolling. Only the
// viewer needs that level of their OWN detail at a glance; every other seat's improvement levels now
// fold into `hud/Scoreboard.tsx`'s table instead (one compact column), and this panel shrinks to one
// seat's worth of content plus the condensed barbarian strip.
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import type { Commodity, Seat } from '@hexhaven/shared';
import { BarbarianTrack } from '../board/BarbarianTrack';
import { CommodityIcon, ImprovementTrackDisplay } from '../board/CommodityIcon';
import { IMPROVEMENT_TRACKS, ckOf } from './ckHelpers';

const COMMODITIES: readonly Commodity[] = ['paper', 'cloth', 'coin'];

export interface CitiesKnightsHudProps {
  view: PlayerView;
  /** The viewer's own seat — whose commodities/tracks render prominently here. */
  mySeat: Seat;
  /** Kept in the props shape for call-site parity with the other sidebar panels (Scoreboard,
   *  HelpersHud) even though this redesign no longer needs a name to render (it's scoped to a
   *  single "your" panel) — every existing mount already passes it. */
  seatName: (seat: Seat) => string;
}

export function CitiesKnightsHud({ view, mySeat }: CitiesKnightsHudProps) {
  const { t } = useTranslation('citiesKnights');
  const ck = ckOf(view);
  if (!ck) return null;

  return (
    <div className="hexhaven-panel flex flex-col gap-2 p-2" data-testid="cities-knights-hud">
      <BarbarianTrack position={ck.barbarian.position} compact />
      <div className="flex flex-col gap-1 border-t border-panel-edge pt-1.5">
        {ck.defenderVp[mySeat] ? (
          <span className="text-accent-gold font-ui text-12 font-semibold" title={t('defenderOfHexhaven.label')}>
            {t('defenderOfHexhaven.badge', { count: ck.defenderVp[mySeat] })}
          </span>
        ) : null}
        <span className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('hud.yourCommodities')}</span>
        <div className="flex flex-wrap gap-1" data-testid={`ck-commodities-${mySeat}`}>
          {COMMODITIES.map((c) => (
            <CommodityIcon key={c} commodity={c} count={ck.commodities[mySeat]?.[c] ?? 0} />
          ))}
        </div>
        <span className="mt-1 font-ui text-12 font-semibold uppercase text-ink-soft">{t('hud.yourImprovements')}</span>
        <div className="flex flex-col gap-0.5" data-testid={`ck-improvements-${mySeat}`}>
          {IMPROVEMENT_TRACKS.map((track) => (
            <ImprovementTrackDisplay
              key={track}
              track={track}
              level={ck.improvements[mySeat]?.[track] ?? 0}
              hasStandingAbility={(ck.improvements[mySeat]?.[track] ?? 0) >= 3}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
