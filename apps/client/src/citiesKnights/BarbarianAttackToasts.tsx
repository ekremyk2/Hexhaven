// Barbarian-attack banner (T-806 Priority 1 requirement 3, C8.4-C8.6): turns each
// `barbarianAttackResolved` event into a toast announcing defended/defeated + the Defender of
// Hexhaven (or the tie case) + any pillaged cities — mirroring `devcards/DevCardsPanel.tsx`'s
// `processedCount` event-watching pattern exactly (never re-toast an event already seen). A
// connected, mount-anywhere component with no props, like `DevCardsPanel`/`TradePanel`.
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewerEvent } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { useGameEvents, useLobbyState, useStore } from '../store';

export function BarbarianAttackToasts() {
  const { t } = useTranslation(['citiesKnights', 'game']);
  const events = useGameEvents() as ViewerEvent[];
  const lobby = useLobbyState();
  const pushToast = useStore((s) => s.pushToast);
  const processedCount = useRef(0);

  const seatName = (seat: Seat) => lobby.seats[seat]?.nickname ?? t('game:hud.player.seatFallback', { n: seat + 1 });

  useEffect(() => {
    for (let i = processedCount.current; i < events.length; i += 1) {
      const ev = events[i];
      if (ev == null || typeof ev !== 'object' || !('type' in ev) || ev.type !== 'barbarianAttackResolved') continue;

      if (ev.result === 'defended') {
        if (ev.defenderSeat != null) {
          pushToast({
            kind: 'info',
            message: t('citiesKnights:banner.defended', { name: seatName(ev.defenderSeat) }),
          });
        } else {
          pushToast({ kind: 'info', message: t('citiesKnights:banner.defendedTie') });
        }
      } else {
        const names = [...new Set(ev.pillaged.map((p) => p.seat))].map(seatName).join(t('citiesKnights:banner.listSeparator'));
        pushToast({
          kind: 'info',
          message: ev.pillaged.length > 0 ? t('citiesKnights:banner.pillaged', { names }) : t('citiesKnights:banner.pillagedNone'),
        });
      }
    }
    processedCount.current = events.length;
  }, [events, pushToast, t, lobby.seats]);

  return null;
}
