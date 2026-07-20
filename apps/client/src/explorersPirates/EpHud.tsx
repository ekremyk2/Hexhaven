// EpHud (T-1108 requirement C): the viewer's own Explorers & Pirates goods where the hand/HUD lives —
// gold + harbor-settlement count + settler reserve — read straight from `view.ext.explorersPirates`,
// mirroring `tradersBarbarians/TbHud.tsx`'s "your own detail" scope exactly. The VP breakdown
// (harbor settlements worth 2 VP each) is already folded into the engine's `computeVp` (docs/rules/
// explorers-pirates-rules.md EP12.5) — this panel is display-only, no VP math of its own.
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { epOf, isLandHoGame, ownGoldOf, ownHarborSettlementsOf, ownSettlerSupplyOf } from './epHelpers';

export interface EpHudProps {
  view: PlayerView;
  mySeat: Seat;
}

export function EpHud({ view, mySeat }: EpHudProps) {
  const { t } = useTranslation('explorersPirates');
  const ep = epOf(view);
  if (!ep || !isLandHoGame(view)) return null;

  return (
    <div className="hexhaven-panel flex flex-col gap-2 p-2" data-testid="ep-hud">
      <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('hud.title')}</p>
      <p className="font-ui text-14 font-semibold text-ink" data-testid="ep-hud-gold">
        {t('hud.goldLine', { count: ownGoldOf(view, mySeat) })}
      </p>
      <p className="font-ui text-14 font-semibold text-ink" data-testid="ep-hud-harbor-settlements">
        {t('hud.harborSettlementsLine', { count: ownHarborSettlementsOf(view, mySeat).length })}
      </p>
      <p className="font-ui text-14 text-ink" data-testid="ep-hud-settler-reserve">
        {t('hud.settlerReserveLine', { count: ownSettlerSupplyOf(view, mySeat) })}
      </p>
    </div>
  );
}
