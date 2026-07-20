// TbHud (T-1008 requirement C): the viewer's own Traders & Barbarians goods where the hand/HUD
// lives — fish count (fishermen), gold coins (rivers), commodities (the main scenario), captured
// barbarians/gold (barbarianAttack), camels remaining (caravans) — read straight from
// `view.ext.tradersBarbarians`, mirroring `citiesKnights/CitiesKnightsHud.tsx`'s "your own detail"
// scope exactly (every OTHER seat's public totals show on the Scoreboard instead, see that file's
// Old Boot/Wealthiest/Poorest glyphs).
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import type { TBCommodity, Seat } from '@hexhaven/shared';
import { camelsRemaining } from './tbActionLogic';
import {
  isBarbarianAttackGame,
  isCaravansGame,
  isFishermenGame,
  isRiversGame,
  isTradersBarbariansMainGame,
  tbOf,
} from './tbHelpers';
import { TbCommodityIcon } from './TbCommodityIcon';

const TB_COMMODITY_TYPES: readonly TBCommodity[] = ['marble', 'glass', 'sand', 'tools'];

export interface TbHudProps {
  view: PlayerView;
  mySeat: Seat;
}

export function TbHud({ view, mySeat }: TbHudProps) {
  const { t } = useTranslation('tradersBarbarians');
  const tb = tbOf(view);
  if (!tb) return null;

  return (
    <div className="hexhaven-panel flex flex-col gap-2 p-2" data-testid="tb-hud">
      <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('hud.title')}</p>

      {isFishermenGame(view) ? (
        <p className="font-ui text-14 font-semibold text-ink" data-testid="tb-hud-fish">
          {t('hud.fishLine', { count: tb.fish?.[mySeat] ?? 0 })}
        </p>
      ) : null}

      {isRiversGame(view) ? (
        <p className="font-ui text-14 font-semibold text-ink" data-testid="tb-hud-coins">
          {t('hud.coinsLine', { count: tb.coins?.[mySeat] ?? 0 })}
        </p>
      ) : null}

      {isCaravansGame(view) ? (
        <p className="font-ui text-14 text-ink" data-testid="tb-hud-camels">
          {t('hud.camelsRemaining', { count: camelsRemaining(view) })}
        </p>
      ) : null}

      {isBarbarianAttackGame(view) ? (
        <>
          <p className="font-ui text-14 font-semibold text-ink" data-testid="tb-hud-captured">
            {t('hud.capturedBarbariansLine', { count: tb.capturedBarbarians?.[mySeat] ?? 0 })}
          </p>
          <p className="font-ui text-14 font-semibold text-ink" data-testid="tb-hud-gold">
            {t('hud.goldLine', { count: tb.gold?.[mySeat] ?? 0 })}
          </p>
        </>
      ) : null}

      {isTradersBarbariansMainGame(view) ? (
        <>
          <p className="font-ui text-14 font-semibold text-ink" data-testid="tb-hud-deliveries">
            {t('hud.deliveriesLine', { count: tb.deliveries?.[mySeat] ?? 0 })}
          </p>
          <p className="font-ui text-14 font-semibold text-ink" data-testid="tb-hud-gold">
            {t('hud.goldLine', { count: tb.gold?.[mySeat] ?? 0 })}
          </p>
          <div className="flex flex-wrap gap-1" data-testid="tb-hud-commodities">
            {TB_COMMODITY_TYPES.map((c) => (
              <TbCommodityIcon key={c} commodity={c} count={tb.commodities?.[mySeat]?.[c] ?? 0} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
