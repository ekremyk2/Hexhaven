// Improvements panel (T-806 Priority 2 requirement 4, C4): buy each of the 3 city-improvement
// tracks one level at a time, showing cost/level/the L3 standing ability, disabled+reason when
// unaffordable/no-city/maxed — mirrors `controls/ActionBar.tsx`'s `computeBuildShipState`-style
// button pattern exactly (`ckActionLogic.ts` is this panel's `actionBarLogic.ts`).
import { useTranslation } from 'react-i18next';
import { TRACK_COMMODITY } from '@hexhaven/engine';
import type { Action, PlayerView } from '@hexhaven/engine';
import type { ImprovementTrack, Seat } from '@hexhaven/shared';
import { ckImprovementCost } from '@hexhaven/shared';
import { ImprovementTrackDisplay } from '../board/CommodityIcon';
import { Button, Tooltip } from '../ui';
import { computeImprovementState, type CkControlState } from './ckActionLogic';
import { IMPROVEMENT_TRACKS, ckOf } from './ckHelpers';

export interface ImprovementsPanelProps {
  view: PlayerView;
  mySeat: Seat;
  dispatch: (action: Action) => void;
}

export function ImprovementsPanel({ view, mySeat, dispatch }: ImprovementsPanelProps) {
  const { t } = useTranslation(['citiesKnights', 'log']);
  const ck = ckOf(view);
  if (!ck) return null;

  function reasonText(state: CkControlState): string {
    if (state.enabled || !state.reason) return '';
    if (state.reason === 'cantAfford' && state.missing) {
      // Bug fix (mirrors KnightControls.tsx): `type` must be the bare resource/commodity word —
      // `log:resourceName.*`, not the count-baked `log:resource.*` — since the outer
      // `citiesKnights:reason.cantAfford` template already renders its own `{{need}}` count.
      const label = ['paper', 'cloth', 'coin'].includes(state.missing.type)
        ? t(`citiesKnights:commodity.${state.missing.type}`)
        : t(`log:resourceName.${state.missing.type}`);
      return t('citiesKnights:reason.cantAfford', { need: state.missing.need, type: label, have: state.missing.have });
    }
    return t(`citiesKnights:reason.${state.reason}`);
  }

  return (
    // Scroll-elimination pass (routes/Game.tsx's header has the full story): the 3 tracks used to
    // stack in one column (`flex-col`) — 3 full-width rows of height each — which alone was often
    // taller than the fixed-height footer had room for (worst case: turn 1, nobody has rolled yet,
    // all 3 show a disabled-reason line simultaneously). This lays the (exactly 3, never more)
    // tracks out SIDE BY SIDE instead — "compacting via width" per the playtest fix brief. Always 3
    // columns, even at a narrow mobile width (no `sm:` breakpoint fallback to a single column): the
    // fixed-height footer has no more vertical room at 375px than at 1280px, so falling back to a
    // stacked column at mobile would reopen the exact overflow this fixes right where it matters
    // most. A track's own row still wraps internally (`flex-wrap` below) if a translation is long,
    // trading a little width-density for guaranteed-no-scroll.
    <div className="grid grid-cols-3 gap-1.5" data-testid="ck-improvements-panel">
      {IMPROVEMENT_TRACKS.map((track: ImprovementTrack) => {
        const level = ck.improvements[mySeat]?.[track] ?? 0;
        const state = computeImprovementState(view, mySeat, track);
        const cost = level < 5 ? ckImprovementCost((level + 1) as 1 | 2 | 3 | 4 | 5) : null;
        const button = (
          <Button
            data-testid={`ck-buy-improvement-${track}`}
            variant="subtle"
            size="sm"
            disabled={!state.enabled}
            onClick={() => dispatch({ type: 'buildImprovement', track })}
          >
            {cost != null
              ? t('citiesKnights:improvements.buy', { cost, commodity: t(`citiesKnights:commodity.${TRACK_COMMODITY[track]}`) })
              : t('citiesKnights:improvements.maxed')}
          </Button>
        );
        const blocked = !state.enabled && state.reason;
        // Compact row (Priority 2: "horizontal meters, not a tall stack") — the track meter + Buy
        // button ride one row; exactly ONE more line rides below, never two (card/ability clarity
        // pass): the disabled-Buy reason when there is one, else the L3 ability's short caption —
        // measured against a real 375px mobile column (91px wide per track), the ability text used
        // to be tooltip-only (playtest feedback: "cards/abilities unclear" flagged that as
        // effectively invisible), but a permanent SECOND line stacked under the reason line would
        // have doubled the exact "all 3 disabled at once" worst case the original scroll-elimination
        // pass already had to budget for — showing one OR the other keeps this panel's max height
        // identical to what it already tolerated. The full `ability.*` sentence still rides a
        // Tooltip on the short caption for "extra detail beyond the one-liner".
        return (
          <div key={track} className="flex min-w-0 flex-col gap-0.5 rounded-card border border-panel-edge px-2 py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span data-testid={`ck-ability-${track}`}>
                <ImprovementTrackDisplay track={track} level={level} hasStandingAbility={level >= 3} />
              </span>
              {state.enabled || !state.reason ? button : <Tooltip content={reasonText(state)}>{button}</Tooltip>}
            </div>
            {blocked ? (
              <p
                data-testid={`ck-improvement-reason-${track}`}
                className="text-right font-ui text-10 leading-tight text-ink-soft"
              >
                {reasonText(state)}
              </p>
            ) : (
              <Tooltip content={t(`citiesKnights:improvements.ability.${track}`)}>
                <span
                  tabIndex={0}
                  data-testid={`ck-ability-text-${track}`}
                  className="block font-ui text-12 leading-tight text-ink-soft"
                >
                  {t(`citiesKnights:improvements.abilityShort.${track}`)}
                </span>
              </Tooltip>
            )}
          </div>
        );
      })}
      {/* What levels 4/5 unlock (Metropolis) — shared across all 3 tracks, so it renders once below
          the grid rather than repeating identical text in each of the 3 narrow columns. */}
      <p
        data-testid="ck-improvements-metropolis-hint"
        className="col-span-3 font-ui text-12 leading-tight text-ink-soft"
      >
        {t('citiesKnights:improvements.metropolisHint')}
      </p>
    </div>
  );
}
