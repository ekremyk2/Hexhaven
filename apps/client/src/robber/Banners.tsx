// Subtle non-blocking banners (T-405 requirement 1/2): the "waiting for X, Y to discard…" bar for
// non-affected players, and the "move the robber" board banner shown to the mover while the T-304
// `movingRobber` hex mode is active. T-705 adds a robber-or-pirate chooser for Seafarers (S8).
// T-902/T-903 add `RobberPieceChooser`, a genuine N-way chooser (robber + pirate + every active hex
// piece) for the multi-piece hex framework (docs/07 D-034) — used instead of `RobberPirateChooser`
// whenever the `hexPieces` modifier is active (with or without Seafarers also active).
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';

export interface PendingDiscardBarProps {
  /** Display names of the seats still owed a discard (`robberLogic.ts`'s `pendingDiscardSeats`). */
  names: string[];
}

export function PendingDiscardBar({ names }: PendingDiscardBarProps) {
  const { t } = useTranslation('robber');
  if (names.length === 0) return null;

  return (
    <div
      className="hexhaven-panel px-3 py-2 font-ui text-12 italic text-ink-soft"
      data-testid="discard-pending-bar"
    >
      {t('discard.pendingBar', { names: names.join(', ') })}
    </div>
  );
}

export function MoveRobberBanner() {
  const { t } = useTranslation('robber');

  return (
    <div
      className="hexhaven-panel px-3 py-2 font-ui text-14 font-semibold text-ink"
      data-testid="move-robber-banner"
    >
      {t('moveRobber.banner')}
    </div>
  );
}

export interface RobberPirateChooserProps {
  /** Which target is currently armed: the land robber (`movingRobber`) or the pirate (`movingPirate`). */
  target: 'robber' | 'pirate';
  onChoose: (target: 'robber' | 'pirate') => void;
}

/** Seafarers (S8, T-705): the mover picks whether the 7/Knight moves the land robber or the sea
 * pirate, then clicks a highlighted hex. Two toggle buttons + a hint about the armed target. */
export function RobberPirateChooser({ target, onChoose }: RobberPirateChooserProps) {
  const { t } = useTranslation('robber');
  return (
    <div
      className="hexhaven-panel flex flex-col gap-2 px-3 py-2"
      data-testid="robber-pirate-chooser"
    >
      <p className="font-ui text-14 font-semibold text-ink">
        {t(target === 'robber' ? 'moveRobber.banner' : 'movePirate.banner')}
      </p>
      <div className="flex items-center gap-2">
        <Button
          data-testid="choose-robber"
          size="sm"
          variant={target === 'robber' ? 'primary' : 'subtle'}
          onClick={() => onChoose('robber')}
        >
          {t('movePirate.chooseRobber')}
        </Button>
        <Button
          data-testid="choose-pirate"
          size="sm"
          variant={target === 'pirate' ? 'primary' : 'subtle'}
          onClick={() => onChoose('pirate')}
        >
          {t('movePirate.choosePirate')}
        </Button>
      </div>
    </div>
  );
}

/** T-903: one option in the `RobberPieceChooser` — a movable target's key (matches
 *  `robberLogic.ts`'s `MoveTarget`: `'robber'`, `'pirate'`, or a `HexPieceKindId`) and its already-
 *  translated button label. Kept as plain strings here (rather than importing `HexPieceKindId`)
 *  so this presentational component stays decoupled from `@hexhaven/shared`. */
export interface RobberPieceChooserOption {
  target: string;
  label: string;
}

export interface RobberPieceChooserProps {
  options: RobberPieceChooserOption[];
  /** Which target is currently armed (must be one of `options[].target`). */
  armed: string;
  /** The banner line above the option buttons (already resolved to the armed target's own copy —
   *  "Move the robber…" / "Move the pirate…" / "Move the Trader…", etc). */
  bannerLabel: string;
  onChoose: (target: string) => void;
}

/**
 * T-902/T-903 (multi-piece hex framework, docs/07 D-034): a genuine N-way chooser among every
 * movable target this 7/Knight — the base robber, the Seafarers pirate (if the game has one), and
 * every currently active hex-piece kind (any subset, T-903's "standalone-selectable" pieces may all
 * coexist) — instead of a fixed 2-way toggle. `RobberOverlay.tsx` builds `options`/`armed`/
 * `bannerLabel` from `robberLogic.ts`'s `movableTargets` + i18n; this component is purely
 * presentational (one button per option, the armed one highlighted).
 */
export function RobberPieceChooser({ options, armed, bannerLabel, onChoose }: RobberPieceChooserProps) {
  return (
    <div className="hexhaven-panel flex flex-col gap-2 px-3 py-2" data-testid="robber-piece-chooser">
      <p className="font-ui text-14 font-semibold text-ink">{bannerLabel}</p>
      <div className="flex flex-wrap items-center gap-2">
        {options.map((option) => (
          <Button
            key={option.target}
            data-testid={`choose-${option.target}`}
            size="sm"
            variant={option.target === armed ? 'primary' : 'subtle'}
            onClick={() => onChoose(option.target)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
