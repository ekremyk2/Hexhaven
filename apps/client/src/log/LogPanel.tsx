// GameLog (T-407): self-contained sidebar container for the game event log. Reads the store
// directly (game.events, game.view for `me`, lobby.seats for nicknames) so the mount point is
// `<GameLog/>` with NO required props, the same way `Toasts`/`ConnectionBanner` own their own
// store wiring.
//
// Chat used to live here behind a Log|Chat sub-tab, but chat is now its own top-level sidebar tab
// (`hud/ChatPanel`, wired in Game.tsx) — having both was two separate chat menus (playtest), so this
// panel is log-only now. It auto-scrolls to the newest line unless the viewer has scrolled up
// (`autoscroll.ts`'s `isAtBottom`), showing a "jump to latest" chip while unpinned; turn separators
// come from `timeline.ts`'s `buildTimeline`.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Seat } from '@hexhaven/shared';
import type { PlayerView, ViewerEvent } from '@hexhaven/engine';
import { Panel } from '../ui';
import { useGameEvents, useGameView, useLobbyState } from '../store';
import { isAtBottom } from './autoscroll';
import { resolveLogParams } from './logParams';
import { buildTimeline } from './timeline';

export function GameLog() {
  const { t } = useTranslation('log');
  // WIRE: T-204 — same workaround `routes/Game.tsx`/`hotseat/HotseatPage.tsx` document: the
  // wire-level `PlayerView`/`ViewerEvent` types are still the `unknown` placeholders
  // (packages/shared/src/protocol/messages.ts) until that task lands the real zod schemas. These
  // cast to what the engine's `redact()`/`redactEvent()` actually produce, which is exactly what
  // `game.started`/`game.events`/`game.sync` carry today.
  const events = useGameEvents() as ViewerEvent[];
  const view = useGameView() as PlayerView | null;
  const lobby = useLobbyState();

  const [pinned, setPinned] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // `view` is only `null` before the game has started (Game.tsx's own loading guard) — at that
  // point `events` is always empty too, so the fallback seat here never actually renders a line.
  const mySeat = (view?.me ?? 0) as Seat;
  const seatName = (seat: Seat): string => lobby.seats[seat]?.nickname ?? t('seatFallback', { n: seat + 1 });

  const nodes = buildTimeline(events, mySeat);

  // Auto-scroll to the newest line, but only while the viewer hasn't scrolled up.
  useEffect(() => {
    if (pinned && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [nodes.length, pinned]);

  const jumpToLatest = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setPinned(true);
  };

  // Priority 3 redesign (kill scrolling except log/chat): `h-full min-h-0` fills whatever height the
  // flex parent gives this slot exactly, so only the log's own internal `log-scroll` region scrolls.
  return (
    <Panel className="flex h-full min-h-0 flex-col gap-0 p-0" data-testid="game-log">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          data-testid="log-scroll"
          className="h-full overflow-y-auto px-3 pb-2 pt-2 font-ui text-12 text-ink"
          onScroll={(e) => setPinned(isAtBottom(e.currentTarget))}
        >
          {events.length === 0 ? <p className="italic text-ink-soft">{t('empty')}</p> : null}
          {nodes.map((node) =>
            node.kind === 'separator' ? (
              <p
                key={node.id}
                data-testid="log-turn-separator"
                className="my-1 text-center text-12 uppercase tracking-wide text-ink-soft"
              >
                {t('turnSeparator', { turnNumber: node.turnNumber, name: seatName(node.seat) })}
              </p>
            ) : (
              <p key={node.id} data-testid="log-line">
                <span aria-hidden="true">{node.icon}</span> {t(node.key, resolveLogParams(t, seatName, node.params))}
              </p>
            ),
          )}
        </div>
        {!pinned ? (
          <button
            type="button"
            data-testid="jump-to-latest"
            onClick={jumpToLatest}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-button bg-accent px-3 py-1 font-ui text-12 font-semibold text-on-accent shadow-soft"
          >
            {t('jumpToLatest')}
          </button>
        ) : null}
      </div>
    </Panel>
  );
}
