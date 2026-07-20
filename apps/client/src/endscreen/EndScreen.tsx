// <EndScreen/> (T-408): self-contained victory overlay + rematch affordance, mirroring
// `robber/RobberOverlay.tsx`/`log/LogPanel.tsx`'s brief — NO required props, reads `PlayerView`/
// events/lobby straight from the store, renders nothing at all outside `phase.kind === 'ended'`
// (R13.2). Mount it once anywhere above the board (routes/Game.tsx's tree, alongside
// `<RobberOverlay/>`) — the PM wires the actual mount point after this task lands.
//
// Standings (requirement 1) come from `standings.ts`'s pure `buildStandings` + `findWonBreakdown`.
// Board stays visible underneath: this renders as a dismissible `Modal` overlay (Escape/backdrop/✕
// all funnel through `onClose`), and a small "view final standings" chip reopens it — so a player
// can dismiss the overlay to inspect the final board position without losing the recap entirely.
//
// Rematch/back-home (requirement 2, scoped down for this task — see Implementation notes in
// docs/tasks/phase-4/T-408-end-screen.md): no `game.rematch` protocol message exists yet (adding
// one would touch `packages/shared/src/protocol/messages.ts`, `apps/server/src/session.ts` — both
// outside this task's file allowlist), so "Rematch" here is a return-to-lobby navigation using
// what's already wired (same room/`gameId`, the existing `lobby.start` flow) rather than the
// one-click same-seats reseat the full spec describes. "Back home" always returns to `/`. Both are
// plain `react-router-dom` navigations — no store/protocol changes.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { PlayerView, ViewerEvent } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { Button, Modal } from '../ui';
import { usePrefersReducedMotion } from '../theme/motion';
import { useGameEvents, useGameView, useLobbyState, useStore } from '../store';
import { StandingsTable } from './StandingsTable';
import { buildStandings, findWonBreakdown } from './standings';

// Decorative-only, `aria-hidden` (no lib — "confetti-lite CSS" per the task brief): plain glyph
// constants rendered via an expression, same convention as `board/palette.ts`'s `PLAYER_BADGES`/
// `hud/constants.ts`'s `KNIGHT_GLYPH` — pictograms aren't user-facing copy, so they don't go
// through `t()`, but the i18n-guard lint rule only recognizes that when it's an expression rather
// than raw JSX text, hence the constant instead of literal emoji between tags.
const CONFETTI_GLYPHS = ['🎉', '🎊', '✦', '★'] as const;
// docs/11 §6 budget: "animations... ≤80 [particle] nodes" — comfortably under with headroom for
// everything else on screen.
const CONFETTI_COUNT = 16;

export function EndScreen() {
  const { t } = useTranslation(['endgame', 'game']);
  // WIRE: T-204 — same cast every other Phase-4 store-reading container documents (routes/Game.tsx,
  // robber/RobberOverlay.tsx, log/LogPanel.tsx): the wire-level `PlayerView`/`ViewerEvent` types are
  // still the `unknown` placeholder (packages/shared/src/protocol/messages.ts) until that task's
  // zod schema lands. This casts to what `redact()`/`redactEvent()` actually produce, which is
  // exactly what `game.started`/`game.events`/`game.sync` carry today.
  const view = useGameView() as PlayerView | null;
  const events = useGameEvents() as ViewerEvent[];
  const lobby = useLobbyState();
  const leaveGame = useStore((s) => s.leaveGame);
  const sendLobbyMessage = useStore((s) => s.sendLobbyMessage);
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const ended = view?.phase.kind === 'ended';

  // Leaving `ended` (a rematch/new game actually starting) clears any prior dismissal, so the
  // NEXT win auto-opens the overlay again instead of silently staying hidden forever.
  useEffect(() => {
    if (!ended) setDismissed(false);
  }, [ended]);

  if (!view || view.phase.kind !== 'ended') return null;

  const winner: Seat = view.phase.winner;
  const wonBreakdown = findWonBreakdown(events);
  const rows = buildStandings(view, winner, wonBreakdown);

  const seatName = (seat: Seat) => lobby.seats[seat]?.nickname ?? t('game:hud.player.seatFallback', { n: seat + 1 });

  const bannerText =
    winner === view.me ? t('endgame:banner.youWon') : t('endgame:banner.winner', { name: seatName(winner) });

  function rematch() {
    // Multiplayer: ask the server to restart THIS finished game in the same room (same seats +
    // bots) — the fresh `game.started` replaces the view in place, so no navigation and the end
    // screen simply disappears. Hot-seat has no lobby/server, so fall back to a fresh local game.
    if (lobby.gameId) {
      sendLobbyMessage({ type: 'lobby.rematch', payload: {} });
    } else {
      navigate('/hotseat');
    }
  }

  function backHome() {
    // Reset the finished-game state (view/toasts/lobby + persisted session) so Home is clean and a
    // new game can't bounce back here or replay this game's toasts.
    leaveGame();
    navigate('/');
  }

  if (dismissed) {
    return (
      <button
        type="button"
        data-testid="endscreen-reopen"
        onClick={() => setDismissed(false)}
        className="fixed bottom-4 right-4 z-40 rounded-button bg-accent-gold px-4 py-2 font-ui text-14 font-semibold text-ink-onlight shadow-soft"
      >
        {t('endgame:reopen')}
      </button>
    );
  }

  return (
    <Modal open onClose={() => setDismissed(true)} title={bannerText}>
      <div
        // docs/11 §5 "Victory: parchment banner drop + confetti burst, 1.2s once" — the drop plays
        // on the banner/standings block; Modal's own entrance (ui/Modal.tsx) already handles the
        // parchment surface fading in, this is the extra "drop" flourish specific to a win.
        className={['flex flex-col gap-4', reducedMotion ? '' : 'hexhaven-victory-drop'].join(' ')}
        data-testid="end-screen"
      >
        <div aria-hidden="true" data-testid="endscreen-confetti" className="relative flex h-10 justify-center">
          {Array.from({ length: CONFETTI_COUNT }, (_, i) => {
            const glyph = CONFETTI_GLYPHS[i % CONFETTI_GLYPHS.length];
            const spreadPx = (i - (CONFETTI_COUNT - 1) / 2) * 12;
            const delayMs = (i % 8) * 70;
            const spinDeg = i % 2 === 0 ? 200 : -200;
            return (
              <span
                key={i}
                className={['absolute text-16', reducedMotion ? '' : 'hexhaven-confetti-piece'].join(' ')}
                style={
                  {
                    left: `calc(50% + ${spreadPx}px)`,
                    animationDelay: reducedMotion ? undefined : `${delayMs}ms`,
                    '--confetti-spin': `${spinDeg}deg`,
                  } as React.CSSProperties
                }
              >
                {glyph}
              </span>
            );
          })}
        </div>

        <StandingsTable rows={rows} seatName={seatName} />

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="subtle" data-testid="endscreen-back-home" onClick={backHome}>
            {t('endgame:actions.backHome')}
          </Button>
          <Button variant="primary" data-testid="endscreen-rematch" onClick={rematch}>
            {t('endgame:actions.rematch')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
