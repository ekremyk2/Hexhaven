// DiceRollOverlay (Priority 3 UI overhaul): a brief CENTER-SCREEN celebration of a roll result —
// two real pip-face dice (`DieFace`) tumble in, settle on the actual rolled values, hold a beat,
// then fade out on their own (no dismiss control — this is decoration, never a blocking dialog).
// Self-contained like `robber/RobberOverlay.tsx`/`endscreen/EndScreen.tsx`: no required props, reads
// `useGameView()` itself, mount it once anywhere in the game screen tree (`routes/Game.tsx` and
// `hotseat/HotseatPage.tsx` both do). Triggers off `turn.roll` changing — a PUBLIC field every
// seat's `PlayerView` carries identically (dice results are never hidden info), so every viewer
// sees the active player's roll play, not just the roller themselves.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import { useGameView, useLobbyState } from '../store';
import { usePrefersReducedMotion } from '../theme/motion';
import { DieFace } from './DieFace';

// docs/11 §5 "Dice roll... 600ms ease-out" for the tumble itself; the overlay's total lifetime
// (tumble + hold + fade) lands at ~1.45s, inside the task's "~1.2-1.6s" window.
const TUMBLE_MS = 600;
const HOLD_MS = 550;
const FADE_MS = 300;
const TUMBLE_TICK_MS = 90;
// Reduced motion: no tumble, but still "briefly hold, then fade" per the task brief — only the
// transform-based tumble is cut, not the (opacity-only, compositor-friendly) hold/fade.
const REDUCED_HOLD_MS = 500;

type Phase = 'idle' | 'tumbling' | 'settled' | 'fading';

export function DiceRollOverlay() {
  const view = useGameView() as PlayerView | null;
  const lobby = useLobbyState();
  const { t } = useTranslation('game');
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [tumbleFaces, setTumbleFaces] = useState<[number, number]>([1, 1]);
  const lastKeyRef = useRef<string | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const roll = view?.turn.roll ?? null;
  const turnNumber = view?.turn.number ?? 0;
  const key = roll ? `${turnNumber}-${roll[0]}-${roll[1]}` : null;

  useEffect(() => {
    // Only a genuinely NEW roll starts the overlay — comparing against the previous key (not just
    // "roll != null") is what makes this safe to mount mid-game (reconnect, seat-camera switch in
    // hot-seat) without replaying a celebration for a roll that already happened before mount.
    if (key == null || key === lastKeyRef.current) return undefined;
    const isFirstObservation = lastKeyRef.current === null;
    lastKeyRef.current = key;
    if (isFirstObservation) return undefined;

    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    if (reducedMotion) {
      setPhase('settled');
      timersRef.current.push(
        setTimeout(() => setPhase('fading'), REDUCED_HOLD_MS),
        setTimeout(() => setPhase('idle'), REDUCED_HOLD_MS + FADE_MS),
      );
      return undefined;
    }

    setPhase('tumbling');
    const tickId = setInterval(() => {
      setTumbleFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
    }, TUMBLE_TICK_MS);
    timersRef.current.push(
      setTimeout(() => {
        clearInterval(tickId);
        setPhase('settled');
      }, TUMBLE_MS),
      setTimeout(() => setPhase('fading'), TUMBLE_MS + HOLD_MS),
      setTimeout(() => setPhase('idle'), TUMBLE_MS + HOLD_MS + FADE_MS),
    );
    return () => clearInterval(tickId);
  }, [key, reducedMotion]);

  // Belt-and-suspenders: clear any in-flight timers on unmount (route change mid-animation).
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  if (phase === 'idle' || !view || !roll) return null;

  const [d1, d2] = phase === 'tumbling' ? tumbleFaces : roll;
  const seatName = lobby.seats[view.turn.player]?.nickname ?? t('hud.player.seatFallback', { n: view.turn.player + 1 });

  return (
    <div
      className={[
        // Stacking order (Priority 2): board < HUD < banners(z-30) < toasts(z-30) < dice overlay
        // (z-40) < modals(z-50) — this sits above the toast layer, below any blocking modal.
        'pointer-events-none fixed inset-0 z-40 flex items-center justify-center',
        phase === 'fading' ? 'hexhaven-dice-overlay-fade' : '',
      ]
        .join(' ')
        .trim()}
      role="status"
      aria-live="polite"
      data-testid="dice-roll-overlay"
    >
      <div className="hexhaven-panel flex flex-col items-center gap-3 px-8 py-6">
        <div className="flex gap-3">
          <DieFace value={d1} size={72} className={phase === 'tumbling' ? 'hexhaven-dice-tumble' : ''} />
          <DieFace value={d2} size={72} className={phase === 'tumbling' ? 'hexhaven-dice-tumble' : ''} />
        </div>
        <p className="font-display text-20 font-semibold text-ink">
          {t('hud.dice.rollOverlay', { name: seatName, total: (roll[0] ?? 0) + (roll[1] ?? 0) })}
        </p>
      </div>
    </div>
  );
}
