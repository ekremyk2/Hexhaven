// IncomingOffer (T-404 requirement 3): the non-owner's view of an open domestic offer — a
// CENTERED, non-blocking card (playtest: "move trade offers to the center of the screen"; still not
// a `Modal` — no backdrop, play continues underneath it), Accept/Decline
// (-> `respondTrade`). It is purely `view`-driven: `TradePanel` only mounts it while
// `view.trade != null` and the viewer isn't the owner, so it "follows" `tradeResponded`/
// `tradeCompleted`/`tradeCancelled` (incl. the ER-11 auto-cancel on turn end) simply by unmounting
// or re-rendering whenever the store applies the next `view` — no event-specific logic needed here.
import { useTranslation } from 'react-i18next';
import type { OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { Action, Seat } from '@hexhaven/shared';
import { hasAtLeast } from '@hexhaven/shared';
import { Badge, Button } from '../ui';
import { ARROW_GLYPH, ResourceBundleIcons } from './ResourceIcon';

export interface IncomingOfferProps {
  trade: NonNullable<PlayerView['trade']>;
  own: OwnPlayerView;
  mySeat: Seat;
  offererName: string;
  dispatch: (action: Action) => void;
}

export function IncomingOffer({ trade, own, mySeat, offererName, dispatch }: IncomingOfferProps) {
  const { t } = useTranslation('trade');
  const myResponse = trade.responses[mySeat];
  const alreadyResponded = myResponse != null;
  // To accept, you'd GIVE the owner what they asked for (`trade.receive`) — so you must hold it.
  // If you don't, accepting would only fail the owner's confirm (CANT_AFFORD); disable it but still
  // show the offer so you can decline / see it (B-21).
  const canAccept = hasAtLeast(own.resources, trade.receive);

  return (
    <div
      className="hexhaven-panel fixed left-1/2 top-1/2 z-50 flex w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-4 shadow-soft"
      role="status"
      data-testid="incoming-offer"
    >
      <p className="font-ui text-14 font-semibold text-ink">{t('incoming.headline', { name: offererName })}</p>

      {/* Shown from the RESPONDER's perspective (T-508 fix): the offer stores give/receive from the
          OFFERER's side, so to the responder the offerer's `receive` is what YOU GIVE and the
          offerer's `give` is what YOU GET. Previously both were shown offerer-side, so the responder
          read the trade backwards. Labelled explicitly so it can't be misread either way. */}
      <div className="flex items-center justify-center gap-3">
        <div className="flex flex-col items-center gap-1">
          <span className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('incoming.youGive')}</span>
          <ResourceBundleIcons bundle={trade.receive} />
        </div>
        <span aria-hidden="true" className="text-16 text-ink-soft">{ARROW_GLYPH}</span>
        <div className="flex flex-col items-center gap-1">
          <span className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('incoming.youGet')}</span>
          <ResourceBundleIcons bundle={trade.give} />
        </div>
      </div>

      {alreadyResponded ? (
        <Badge variant={myResponse === 'accepted' ? 'gold' : 'danger'} data-testid="incoming-offer-status">
          {t(myResponse === 'accepted' ? 'incoming.youAccepted' : 'incoming.youDeclined')}
        </Badge>
      ) : !canAccept ? (
        <p className="font-ui text-12 text-ink-soft" data-testid="incoming-offer-cant-accept">
          {t('incoming.cantAccept')}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          size="sm"
          data-testid="incoming-offer-accept"
          disabled={alreadyResponded || !canAccept}
          onClick={() => dispatch({ type: 'respondTrade', response: 'accept' })}
        >
          {t('incoming.accept')}
        </Button>
        <Button
          size="sm"
          variant="subtle"
          data-testid="incoming-offer-decline"
          disabled={alreadyResponded}
          onClick={() => dispatch({ type: 'respondTrade', response: 'decline' })}
        >
          {t('incoming.decline')}
        </Button>
      </div>
    </div>
  );
}
