// VpWidget (T-402 requirement 5): the viewer's own public VP + hidden VP total, with a breakdown
// tooltip. Only ever constructed with the viewer's OWN `OwnPlayerView` — never call this with an
// opponent's entry (there is no opponent `OwnPlayerView` to pass; the type system enforces this).
import { useTranslation } from 'react-i18next';
import type { OwnPlayerView, PlayerView } from '@hexhaven/engine';
import { Badge, Tooltip } from '../ui';
import { computeExtraVp, computeOwnVp } from './vp';

export interface VpWidgetProps {
  own: OwnPlayerView;
  awards: PlayerView['awards'];
  /** The full view — needed to read the modifier/C&K award VP (`computeExtraVp`) that lives in
   *  `view.ext` (harbormaster, metropolis, defender, merchant), not on the bare `own`/`awards`. */
  view: PlayerView;
}

export function VpWidget({ own, awards, view }: VpWidgetProps) {
  const { t } = useTranslation('game');
  const vp = computeOwnVp(own, awards);
  // Same engine-aligned extras the Scoreboard adds (B-38): without them the badge read 2 short for a
  // harbormaster holder, so a player could WIN (engine total ≥ target) while this still showed 13/15.
  const extra = computeExtraVp(view, own.seat);
  const total = vp.totalWithHidden + extra;
  const baseBreakdown = t('hud.vp.breakdown', {
    settlements: vp.settlements,
    cities: vp.cities,
    longestRoad: vp.longestRoad,
    largestArmy: vp.largestArmy,
    vpCards: vp.vpCards,
  });
  const breakdown = extra > 0 ? `${baseBreakdown} ${t('hud.vp.otherBreakdown', { count: extra })}` : baseBreakdown;

  return (
    <Tooltip content={breakdown}>
      <span tabIndex={0} data-testid="vp-widget">
        <Badge variant="gold">{t('hud.vp.total', { count: total })}</Badge>
      </span>
    </Tooltip>
  );
}
