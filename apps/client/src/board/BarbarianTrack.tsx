// <BarbarianTrack> (T-805, docs/rules/cities-knights-rules.md C8): a standalone side/overlay strip
// showing the barbarian ship's progress toward Hexhaven — NOT drawn on the hex board itself (the ship
// isn't a board piece), so this renders its own small SVG rather than slotting into `<BoardView>`.
// Pure/presentational: takes `position`/`totalSteps` as props, no store access, no engine calls
// (T-806 wires the live value from `ext.citiesKnights.barbarian.position`).
import { useTranslation } from 'react-i18next';
import { CK_BARBARIAN_STEPS_TO_ATTACK } from '@hexhaven/shared';
import { BARBARIAN_ALERT } from './citiesKnightsPalette';

const SHIP_COLOR = '#31302c'; // matte charcoal, matching the robber/pirate recipe (docs/11 §3)
const HEXHAVEN_COLOR = '#c9a227'; // accent-gold — the "home" node the ship marches toward

export interface BarbarianTrackProps {
  /** Ship-symbol advances since the last attack (C8.1/C8.2), 0..`totalSteps`. */
  position: number;
  /** Advances needed to trigger an attack (C8.2); defaults to the module constant. */
  totalSteps?: number;
  className?: string;
  /** Rail redesign (requirement 4: "condense the barbarian track to a compact strip — it doesn't
   *  need a big card"): drops the `hexhaven-panel` card chrome/padding, shrinks the SVG, and puts the
   *  title + "imminent" flag on one line instead of stacked — for the game-sidebar mount
   *  (`CitiesKnightsHud`). The standalone full-size card (styleguide, any future non-sidebar mount)
   *  keeps the default look. */
  compact?: boolean;
}

export function BarbarianTrack({
  position,
  totalSteps = CK_BARBARIAN_STEPS_TO_ATTACK,
  className,
  compact = false,
}: BarbarianTrackProps) {
  const { t } = useTranslation('citiesKnights');
  const clamped = Math.max(0, Math.min(position, totalSteps));
  // "Attack imminent" once the NEXT ship face resolves the attack (C8.2) — i.e. one step short of
  // the total, or already at/over it (defensive: the engine resolves+resets in the same tick, but a
  // client render in between should still read as urgent rather than silently normal).
  const imminent = clamped >= totalSteps - 1;

  const slots = totalSteps + 1; // slot 0 = ship reset position, slot `totalSteps` = Hexhaven/attack
  const stepW = compact ? 16 : 28;
  const width = (slots - 1) * stepW + (compact ? 20 : 32);
  const height = compact ? 32 : 56;
  const trackY = height / 2;

  return (
    <div
      className={[compact ? 'flex flex-col gap-0.5' : 'hexhaven-panel flex flex-col gap-1 p-2', className]
        .filter(Boolean)
        .join(' ')}
      data-testid="barbarian-track"
      role="img"
      aria-label={t('barbarianTrack.title')}
    >
      <span className="flex items-center gap-1.5 font-ui text-12 font-semibold text-ink-soft">
        {t('barbarianTrack.title')}
        {compact && imminent ? (
          <span className="font-ui text-11 font-semibold" style={{ color: BARBARIAN_ALERT }} data-testid="barbarian-imminent">
            {t('barbarianTrack.imminent')}
          </span>
        ) : null}
      </span>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
        {/* Baseline */}
        <line x1={16} y1={trackY} x2={width - 16} y2={trackY} stroke="#8a6a42" strokeWidth={3} strokeLinecap="round" />

        {Array.from({ length: slots }).map((_, i) => {
          const cx = 16 + i * stepW;
          const isHexhaven = i === totalSteps;
          const filled = i <= clamped;
          const alert = isHexhaven && imminent;
          return (
            <circle
              key={i}
              cx={cx}
              cy={trackY}
              r={isHexhaven ? 10 : 6}
              data-testid={`barbarian-step-${i}`}
              data-filled={filled}
              fill={alert ? BARBARIAN_ALERT : isHexhaven ? HEXHAVEN_COLOR : filled ? '#8a6a42' : '#efe4c6'}
              stroke="#5a4327"
              strokeWidth={1.5}
              className={alert ? 'hexhaven-barbarian-alert-pulse' : undefined}
            >
              {isHexhaven && <title>{t('barbarianTrack.hexhaven')}</title>}
            </circle>
          );
        })}

        {/* The ship token, riding on the current position. */}
        <g
          transform={`translate(${16 + clamped * stepW} ${trackY})`}
          data-testid="barbarian-ship"
          data-position={clamped}
        >
          <title>{t('barbarianTrack.step', { step: clamped, total: totalSteps })}</title>
          <path
            d="M -9 4 L 9 4 L 6 10 L -6 10 Z"
            fill={SHIP_COLOR}
            stroke="#000"
            strokeWidth={1}
          />
          <line x1={0} y1={4} x2={0} y2={-10} stroke={SHIP_COLOR} strokeWidth={2} />
          <polygon points="0,-10 8,-5 0,-1" fill={SHIP_COLOR} />
        </g>
      </svg>

      {!compact && imminent && (
        <span className="font-ui text-12 font-semibold" style={{ color: BARBARIAN_ALERT }} data-testid="barbarian-imminent">
          {t('barbarianTrack.imminent')}
        </span>
      )}

      <style>{`
        @keyframes hexhaven-barbarian-alert-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
        .hexhaven-barbarian-alert-pulse { animation: hexhaven-barbarian-alert-pulse 1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .hexhaven-barbarian-alert-pulse { animation: none; }
        }
      `}</style>
    </div>
  );
}
