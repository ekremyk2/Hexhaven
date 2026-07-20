// Commodity bank-trade panel (T-806 Priority 2 requirement 7, C4.5): trade a commodity to the bank
// for any resource or another commodity, at 2:1 with Trading House (trade track >= 3) else the base
// 4:1 — a small dedicated control (not an extension of `trade/TradePanel.tsx`, which is owned by
// T-404 and already dense) dispatching `commodityBankTrade`. Follows the same trigger-button + Modal
// shape as `TradePanel`/`YearOfPlentyDialog`.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Action, PlayerView } from '@hexhaven/engine';
import type { Commodity, ResourceType, Seat } from '@hexhaven/shared';
import { RESOURCE_ORDER } from '../hud/constants';
import { ResourceIcon } from '../trade/ResourceIcon';
import { CommodityIcon } from '../board/CommodityIcon';
import { Button, Modal } from '../ui';
import { ckOf } from './ckHelpers';

const COMMODITIES: readonly Commodity[] = ['paper', 'cloth', 'coin'];

export interface CommodityTradePanelProps {
  view: PlayerView;
  mySeat: Seat;
  dispatch: (action: Action) => void;
}

export function CommodityTradePanel({ view, mySeat, dispatch }: CommodityTradePanelProps) {
  const { t } = useTranslation('citiesKnights');
  const [open, setOpen] = useState(false);
  const [give, setGive] = useState<Commodity | null>(null);
  const [receive, setReceive] = useState<ResourceType | Commodity | null>(null);

  const ck = ckOf(view);

  useEffect(() => {
    if (open) {
      setGive(null);
      setReceive(null);
    }
  }, [open]);

  if (!ck) return null;

  const isOwner = view.turn.player === mySeat;
  const canTrade = isOwner && view.phase.kind === 'main';
  if (!canTrade) return null;

  const rate = (ck.improvements[mySeat]?.trade ?? 0) >= 3 ? 2 : 4;
  const have = give != null ? (ck.commodities[mySeat]?.[give] ?? 0) : 0;
  const canConfirm = give != null && receive != null && give !== receive && have >= rate;

  return (
    <>
      <Button data-testid="ck-commodity-trade-trigger" variant="subtle" size="sm" onClick={() => setOpen(true)}>
        {t('commodityTrade.trigger')}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('commodityTrade.title')}>
        <div className="flex flex-col gap-4" data-testid="ck-commodity-trade-dialog">
          <p className="font-ui text-14 text-ink-soft">{t('commodityTrade.rate', { rate })}</p>

          <section>
            <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('commodityTrade.giveLabel')}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('commodityTrade.giveLabel')}>
              {COMMODITIES.map((c) => {
                const disabled = (ck.commodities[mySeat]?.[c] ?? 0) < rate;
                const selected = give === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled}
                    data-testid={`ck-commodity-trade-give-${c}`}
                    onClick={() => setGive(c)}
                    className={[
                      'flex flex-col items-center gap-1 rounded-card border p-2',
                      selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                      disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    <CommodityIcon commodity={c} count={ck.commodities[mySeat]?.[c] ?? 0} />
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('commodityTrade.receiveLabel')}</p>
            <p className="mb-1 font-ui text-12 text-ink-soft">{t('commodityTrade.resourceLabel')}</p>
            <div className="mb-2 flex flex-wrap gap-2" role="radiogroup" aria-label={t('commodityTrade.resourceLabel')}>
              {RESOURCE_ORDER.map((r) => {
                const selected = receive === r;
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`ck-commodity-trade-receive-${r}`}
                    onClick={() => setReceive(r)}
                    className={[
                      'flex flex-col items-center gap-1 rounded-card border p-2 cursor-pointer',
                      selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                    ].join(' ')}
                  >
                    <ResourceIcon resource={r} />
                  </button>
                );
              })}
            </div>
            <p className="mb-1 font-ui text-12 text-ink-soft">{t('commodityTrade.commodityLabel')}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('commodityTrade.commodityLabel')}>
              {COMMODITIES.map((c) => {
                const selected = receive === c;
                const disabled = give === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={disabled}
                    data-testid={`ck-commodity-trade-receive-${c}`}
                    onClick={() => setReceive(c)}
                    className={[
                      'flex flex-col items-center gap-1 rounded-card border p-2',
                      selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                      disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    <CommodityIcon commodity={c} />
                  </button>
                );
              })}
            </div>
          </section>

          <Button
            data-testid="ck-commodity-trade-confirm"
            disabled={!canConfirm}
            onClick={() => {
              if (!canConfirm || give == null || receive == null) return;
              dispatch({ type: 'commodityBankTrade', give, receive });
              setOpen(false);
            }}
          >
            {t('commodityTrade.confirm')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
