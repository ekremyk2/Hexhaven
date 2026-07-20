// BankTradeDialog (T-404 requirement 1): maritime/bank exchange — a give-type picker showing the
// seat's current rate (4/3/2, from harbors) per resource, a receive-type picker (bank-empty types
// disabled), a preview line, and a confirm button. The `give`/`receive` selection PERSISTS across a
// successful trade (playtest: repeat the same trade with one click) — see `confirm()` for why that's
// safe (affordability is re-derived every render, so an unaffordable repeat just disables the button).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import type { Action, ResourceType, Seat } from '@hexhaven/shared';
import { Badge, Button } from '../ui';
import { RESOURCE_ORDER } from '../hud/constants';
import { ResourceIcon } from './ResourceIcon';
import { bankRateOptions } from './rates';

export interface BankTradeDialogProps {
  view: PlayerView;
  mySeat: Seat;
  dispatch: (action: Action) => void;
}

export function BankTradeDialog({ view, mySeat, dispatch }: BankTradeDialogProps) {
  const { t } = useTranslation('trade');
  const [give, setGive] = useState<ResourceType | null>(null);
  const [receive, setReceive] = useState<ResourceType | null>(null);
  const options = bankRateOptions(view, mySeat);

  const canConfirm =
    give != null && receive != null && give !== receive && options[give].affordable && !options[receive].bankEmpty;

  function confirm() {
    if (!canConfirm || give == null || receive == null) return;
    dispatch({ type: 'bankTrade', give, receive });
    // Playtest: KEEP the give/receive selection after trading so the same trade can be repeated with
    // one click. `canConfirm` re-derives affordability/bank-empty from the fresh view each render, so
    // a now-unaffordable repeat just disables the button until you can afford it again — no reset.
  }

  return (
    <div className="flex flex-col gap-4" data-testid="bank-trade-dialog">
      <section>
        <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('bank.giveLabel')}</p>
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={t('bank.giveLabel')}>
          {RESOURCE_ORDER.map((resource) => {
            const opt = options[resource];
            const selected = give === resource;
            return (
              <button
                key={resource}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`bank-give-${resource}`}
                disabled={!opt.affordable}
                onClick={() => setGive(resource)}
                className={[
                  'flex min-w-0 flex-col items-center gap-1 rounded-card border p-1.5',
                  selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                  !opt.affordable ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                ].join(' ')}
              >
                <ResourceIcon resource={resource} />
                <Badge variant={opt.rate === 2 ? 'gold' : 'default'} data-testid={`bank-give-${resource}-rate`}>
                  {t('bank.rate', { rate: opt.rate })}
                </Badge>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('bank.receiveLabel')}</p>
        <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={t('bank.receiveLabel')}>
          {RESOURCE_ORDER.map((resource) => {
            const opt = options[resource];
            const disabled = resource === give || opt.bankEmpty;
            const selected = receive === resource;
            return (
              <button
                key={resource}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`bank-receive-${resource}`}
                disabled={disabled}
                onClick={() => setReceive(resource)}
                className={[
                  'flex min-w-0 flex-col items-center gap-1 rounded-card border p-1.5',
                  selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                  disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                ].join(' ')}
              >
                <ResourceIcon resource={resource} />
                {opt.bankEmpty ? (
                  <Badge variant="danger" data-testid={`bank-receive-${resource}-empty`}>
                    {t('bank.empty')}
                  </Badge>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      {give != null && receive != null ? (
        <p className="font-ui text-14 text-ink" data-testid="bank-preview">
          {t('bank.preview', {
            give: t(`log:resource.${give}`, { count: options[give].rate }),
            receive: t(`log:resource.${receive}`, { count: 1 }),
          })}
        </p>
      ) : null}

      <Button data-testid="bank-confirm" disabled={!canConfirm} onClick={confirm}>
        {t('bank.confirm')}
      </Button>
    </div>
  );
}
