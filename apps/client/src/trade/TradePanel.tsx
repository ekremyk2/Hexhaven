// TradePanel (T-404): the single mount point for both trade flows. `<TradePanel/>` takes no
// required props — it reads `view`/`mySeat`/lobby seat names straight from the store and dispatches
// via the store's `sendAction`, so the PM's integration into `routes/Game.tsx` is a one-line
// `<TradePanel/>` drop next to the other footer widgets (matching how that file already wires
// `ActionBar`/`Hand`/etc., except this component wires itself instead of taking store values as
// props). `TradePanelView` below is the presentational half — everything the connected `TradePanel`
// renders once it has a view and the viewer's own hand — kept separate so tests can render it
// directly against crafted `PlayerView`s without touching the zustand store (same split
// `routes/Game.tsx` draws against `ActionBar`).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { Action, Seat } from '@hexhaven/shared';
import { Button, Modal, SegmentedControl } from '../ui';
import { useGameView, useLobbyState, useStore } from '../store';
import { BankTradeDialog } from './BankTradeDialog';
import { IncomingOffer } from './IncomingOffer';
import { OfferBuilder } from './OfferBuilder';

type TradeTab = 'bank' | 'domestic';

export interface TradePanelViewProps {
  view: PlayerView;
  own: OwnPlayerView;
  mySeat: Seat;
  /** Display name for any seat (lobby nickname, falling back to "Seat N") — `TradePanel` builds
   * this from `useLobbyState()`, same fallback `routes/Game.tsx` uses. */
  seatName: (seat: Seat) => string;
  /** Whether player-to-player (domestic) trades are allowed right now. `false` during a 5–6
   * Paired-Players partial turn (X12: player 2 may trade with the SUPPLY only) — the domestic tab
   * is hidden and the dialog collapses to bank/maritime trade only. Defaults to `true`. */
  playerTradeAllowed?: boolean;
  dispatch: (action: Action) => void;
}

export function TradePanelView({ view, own, mySeat, seatName, playerTradeAllowed = true, dispatch }: TradePanelViewProps) {
  const { t } = useTranslation('trade');
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TradeTab>('bank');

  const isOwner = view.turn.player === mySeat;
  // R8.1/R8.2: both trade actions are turn-owner-only and main-phase-only (engine tests:
  // `phases/domesticTrade.test.ts`/`phases/bankTrade.test.ts`, "WRONG_PHASE elsewhere") — the
  // trigger simply doesn't render outside that window, matching `ActionBar`'s own-turn collapse.
  const canTrade = isOwner && view.phase.kind === 'main';
  const effectiveTab = playerTradeAllowed ? tab : 'bank';

  return (
    <>
      {canTrade ? (
        <>
          <Button data-testid="trade-panel-trigger" onClick={() => setOpen(true)}>
            {t('trigger')}
          </Button>
          <Modal open={open} onClose={() => setOpen(false)} title={t('title')}>
            <div className="flex flex-col gap-4" data-testid="trade-panel-dialog">
              {playerTradeAllowed ? (
                <SegmentedControl
                  ariaLabel={t('tabs.ariaLabel')}
                  value={tab}
                  onChange={(value) => setTab(value as TradeTab)}
                  options={[
                    { value: 'bank', label: t('tabs.bank') },
                    { value: 'domestic', label: t('tabs.domestic') },
                  ]}
                />
              ) : null}
              {effectiveTab === 'bank' ? (
                <BankTradeDialog view={view} mySeat={mySeat} dispatch={dispatch} />
              ) : (
                <OfferBuilder view={view} own={own} mySeat={mySeat} opponentName={seatName} dispatch={dispatch} />
              )}
            </div>
          </Modal>
        </>
      ) : null}

      {!isOwner && view.trade != null ? (
        <IncomingOffer
          trade={view.trade}
          own={own}
          mySeat={mySeat}
          offererName={seatName(view.turn.player)}
          dispatch={dispatch}
        />
      ) : null}
    </>
  );
}

function isOwnPlayerView(p: PlayerView['players'][number]): p is OwnPlayerView {
  return 'resources' in p;
}

/** Connected container — the one export the PM mounts. Renders nothing before a game view (and the
 * viewer's own seat/hand within it) is available. */
export function TradePanel() {
  const { t } = useTranslation('trade');
  const view = useGameView() as PlayerView | null;
  const lobby = useLobbyState();
  const sendAction = useStore((s) => s.sendAction);
  const mySeat = lobby.mySeat;

  if (!view || mySeat == null) return null;
  const own = view.players.find((p) => p.seat === mySeat && isOwnPlayerView(p)) as OwnPlayerView | undefined;
  if (!own) return null;

  const seatName = (seat: Seat) => lobby.seats[seat]?.nickname ?? t('game:hud.player.seatFallback', { n: seat + 1 });

  // 5–6 Paired Players (X12): during player 2's partial turn, only supply (bank/maritime) trade is
  // allowed — hide the domestic offer tab. The partial-turn marker rides on `view.ext` (redact.ts).
  const partialTurn = view.ext?.fiveSix?.partialTurn ?? null;
  const playerTradeAllowed = !(partialTurn != null && partialTurn.builder === mySeat);

  return (
    <TradePanelView
      view={view}
      own={own}
      mySeat={mySeat}
      seatName={seatName}
      playerTradeAllowed={playerTradeAllowed}
      dispatch={sendAction}
    />
  );
}
