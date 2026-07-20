// TurnNotifier (QoL): when it becomes the VIEWER's turn while the tab is in the background, nudge
// them — flash the browser-tab title, play a short chime, and (if the user has granted permission)
// fire a desktop notification. Self-contained like the other overlays: reads the store view itself
// and renders nothing. Only fires while `document.hidden` (you're on another tab/app) — when the
// game tab is already focused you can see it's your turn, so it stays silent. The pure `isMyTurn`
// predicate is unit-tested; the side effects (title/audio/Notification) aren't (no jsdom timers/audio
// in this repo's test stack — same "effects untested, logic extracted" split as RobberOverlay).
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import { useGameView } from '../store';

/** True when the viewer owes an action right now — their own turn, OR a decision they must make even
 *  on someone else's turn: a pending discard / gold-resource choice, or an open trade offer awaiting
 *  their response (T-507). The notifier fires on the transition into this state while backgrounded. */
export function needsAttention(view: PlayerView | null): boolean {
  if (view == null || view.phase.kind === 'ended') return false;
  const me = view.me;
  const phase = view.phase;
  if (phase.kind === 'discard' && phase.pending.includes(me)) return true;
  if (phase.kind === 'chooseGoldResource' && phase.pending.includes(me)) return true;
  if (view.trade != null && view.turn.player !== me && view.trade.responses[me] == null) return true;
  return view.turn.player === me;
}

/** A short two-note chime via WebAudio — no audio asset needed. Best-effort: any failure (no
 *  AudioContext, autoplay policy, a throttled background tab) is swallowed. */
function playChime(): void {
  try {
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), 700);
  } catch {
    /* best effort */
  }
}

export function TurnNotifier() {
  const view = useGameView() as PlayerView | null;
  const { t } = useTranslation('game');
  const mine = needsAttention(view);
  const prevMine = useRef(mine);
  const flashTimer = useRef<number | null>(null);
  const originalTitle = useRef(typeof document !== 'undefined' ? document.title : '');

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const stopFlash = () => {
      if (flashTimer.current != null) {
        window.clearInterval(flashTimer.current);
        flashTimer.current = null;
      }
      document.title = originalTitle.current;
    };

    const becameMine = mine && !prevMine.current;
    prevMine.current = mine;

    if (becameMine && document.hidden) {
      playChime();
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification(t('notify.yourTurnTitle'), { body: t('notify.yourTurnBody') });
        } catch {
          /* best effort */
        }
      }
      if (flashTimer.current == null) {
        originalTitle.current = document.title || originalTitle.current;
        let on = false;
        flashTimer.current = window.setInterval(() => {
          on = !on;
          document.title = on ? `🔔 ${t('notify.yourTurnTitle')}` : originalTitle.current;
        }, 1000);
      }
    }
    if (!mine) stopFlash();
    return undefined;
  }, [mine, t]);

  // Stop the title flash the moment the player looks at the tab again.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisible = () => {
      if (!document.hidden && flashTimer.current != null) {
        window.clearInterval(flashTimer.current);
        flashTimer.current = null;
        document.title = originalTitle.current;
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      if (flashTimer.current != null) {
        window.clearInterval(flashTimer.current);
        flashTimer.current = null;
        document.title = originalTitle.current;
      }
    };
  }, []);

  return null;
}
