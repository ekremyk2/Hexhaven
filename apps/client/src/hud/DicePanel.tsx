// DicePanel (T-402 requirement 3): last roll as two dice faces + turn number + current player
// name; a subdued "waiting for X…" phase line for everyone but the current actor, driven by
// `phaseText.ts`'s phase -> i18n key map.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import { Panel } from '../ui';
import { usePrefersReducedMotion } from '../theme/motion';
import { DieFace } from './DieFace';
import { phaseTextKey } from './phaseText';

export interface DicePanelProps {
  turn: PlayerView['turn'];
  phase: PlayerView['phase'];
  turnPlayerName: string;
  /** True when the viewer IS the seat that must act right now — suppresses the "waiting for
   * X…" line (it would be talking about the viewer themselves). */
  isViewerTurn: boolean;
  /** T-904b: the Event Cards modifier is active for this game — show the drawn card's total in
   *  place of two dice faces (`turn.roll` is still a synthetic `[a, b]` pair summing to it, so
   *  reading `roll[0] + roll[1]` here works identically to the base dice case). */
  eventCardsOn?: boolean;
}

function EventCardFace({
  total,
  animated,
  ariaLabel,
}: {
  total: number | null;
  animated: boolean;
  ariaLabel?: string;
}) {
  return (
    <span
      aria-label={ariaLabel}
      className={[
        'flex h-8 w-14 items-center justify-center rounded-md border border-panel-edge bg-panel font-display text-16 font-bold text-ink shadow-soft',
        animated ? 'hexhaven-dice-tumble' : '',
      ].join(' ')}
    >
      {total ?? '–'}
    </span>
  );
}

// docs/11 §5 "Dice roll: dice tumble in the panel (3 keyframe faces) then settle, 600ms ease-out".
// Keyed on the roll+turn number below so a NEW roll remounts the face (a fresh DOM node is what
// makes a CSS animation play again — see theme/motion.css's header note). On top of the CSS tumble,
// the face CYCLES through random 1–6 values for ~480ms and then SETTLES on the real result, so the
// numbers actually "roll" instead of the final value just spinning in place. Math.random here is
// purely cosmetic client display (engine purity only binds packages/engine).
const TUMBLE_TICK_MS = 80;
const TUMBLE_TICKS = 6; // ~480ms of cycling, inside the 600ms CSS tumble

// Real pip faces (Priority 3 UI overhaul), not numerals — `DieFace` renders the 1-6 dot layout;
// this component keeps owning the tumble-then-settle display logic (cycling through random faces
// briefly before landing on the real roll) and the reduced-motion static fallback.
function DiceFace({ value, animated }: { value: number | null; animated: boolean }) {
  const [display, setDisplay] = useState<number | null>(value);

  useEffect(() => {
    if (!animated || value == null) {
      setDisplay(value);
      return;
    }
    let ticks = 0;
    setDisplay(1 + Math.floor(Math.random() * 6));
    const id = setInterval(() => {
      ticks += 1;
      if (ticks >= TUMBLE_TICKS) {
        clearInterval(id);
        setDisplay(value); // settle on the real roll
      } else {
        setDisplay(1 + Math.floor(Math.random() * 6));
      }
    }, TUMBLE_TICK_MS);
    return () => clearInterval(id);
  }, [animated, value]);

  // `data-testid` carries the die's numeral (or "blank" pre-roll) so tests/tools can assert the
  // rolled value without depending on the SVG pip markup itself — the die is otherwise `aria-hidden`
  // (DieFace.tsx), same as before this switched from a printed digit to real pips.
  return (
    <span data-testid={`die-face-${display ?? 'blank'}`}>
      <DieFace value={display} size={32} className={animated ? 'hexhaven-dice-tumble' : ''} />
    </span>
  );
}

export function DicePanel({ turn, phase, turnPlayerName, isViewerTurn, eventCardsOn }: DicePanelProps) {
  const { t } = useTranslation('game');
  const reducedMotion = usePrefersReducedMotion();
  const [d1, d2] = turn.roll ?? [null, null];
  const total = d1 != null && d2 != null ? d1 + d2 : null;
  const rollKey = `${turn.number}-${d1 ?? '_'}-${d2 ?? '_'}`;
  const animated = !reducedMotion && turn.roll != null;

  return (
    <Panel data-testid="dice-panel">
      <div className="flex items-center gap-3">
        {eventCardsOn ? (
          <div className="flex flex-col items-center gap-0.5" data-testid="event-card-face">
            <EventCardFace
              key={`card-${rollKey}`}
              total={total}
              animated={animated}
              ariaLabel={total == null ? undefined : t('hud.dice.eventCardAria', { total })}
            />
            <span className="font-ui text-10 text-ink-soft">{t('hud.dice.eventCard')}</span>
          </div>
        ) : (
          <div className="flex gap-1">
            <DiceFace key={`d1-${rollKey}`} value={d1} animated={animated} />
            <DiceFace key={`d2-${rollKey}`} value={d2} animated={animated} />
          </div>
        )}
        <span className="font-ui text-12 text-ink-soft">{t('hud.dice.turnNumber', { number: turn.number })}</span>
      </div>
      <p className="mt-1 font-ui text-14 font-semibold text-ink">{turnPlayerName}</p>
      {!isViewerTurn ? (
        <p className="mt-1 font-ui text-12 italic text-ink-soft">{t(phaseTextKey(phase), { name: turnPlayerName })}</p>
      ) : null}
    </Panel>
  );
}
