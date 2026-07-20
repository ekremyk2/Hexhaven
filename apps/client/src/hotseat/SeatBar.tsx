// SeatBar (T-305 requirement 2): all 4 seats as manual-override tabs, plus the two bot-autoplay
// controls. The currently ACTING seat (whoever must act — `computeActiveSeat`) gets `PlayerChip`'s
// own "active" glow (docs/11 §5 turn-change); the currently VIEWED seat (whichever camera the store
// is redacted for) gets its own accent ring. The two coincide except during a manual peek — keeping
// them visually distinct is the point of "auto-follows... with manual override tabs".
import { useTranslation } from 'react-i18next';
import type { GameState, Seat } from '@hexhaven/shared';
import { Badge, Button, PlayerChip } from '../ui';
import { pickBotAction, playBotMove, runBotUntilSeat } from './bot';
import { computeActiveSeat, type LocalTransport } from './localTransport';

/** Fixed hot-seat convention (task requirement 2: "bot until my next turn... viewed seat 0"): the
 * human always plays seat 0; seats 1-3 are the ones "bot until my turn" fast-forwards through. */
const HUMAN_SEAT = 0 as Seat;

export interface ToastInput {
  kind: 'info' | 'error';
  message: string;
}

export interface SeatBarProps {
  state: GameState;
  viewedSeat: Seat;
  onSelectSeat: (seat: Seat) => void;
  transport: LocalTransport;
  onToast: (input: ToastInput) => void;
}

export function SeatBar({ state, viewedSeat, onSelectSeat, transport, onToast }: SeatBarProps) {
  const { t } = useTranslation('game');
  const activeSeat = computeActiveSeat(state);
  const seats = state.players.map((p) => p.seat);
  const ended = state.phase.kind === 'ended';

  const canBotMove =
    !ended && pickBotAction(state, computeActiveSeat(state)) !== null;

  function handleBotMove() {
    const played = playBotMove(transport);
    if (!played) onToast({ kind: 'error', message: t('hotseat.bot.noLegalAction') });
  }

  function handleBotUntilMyTurn() {
    const result = runBotUntilSeat(transport, HUMAN_SEAT);
    if (result.reason !== 'reachedSeat') {
      onToast({ kind: 'error', message: t(`hotseat.bot.stopReason.${result.reason}`) });
    }
  }

  return (
    // Priority 1 UI overhaul: `flex-nowrap` + `overflow-x-auto` (not wrap) keeps this bar to one
    // compact row so the hot-seat page's board/HUD row below isn't squeezed for vertical space.
    <div className="hexhaven-panel flex flex-nowrap items-center gap-3 overflow-x-auto p-3">
      <div className="flex shrink-0 gap-2" role="tablist" aria-label={t('hotseat.seatBar.ariaLabel')}>
        {seats.map((seat) => (
          <button
            key={seat}
            type="button"
            role="tab"
            aria-selected={seat === viewedSeat}
            onClick={() => onSelectSeat(seat)}
            className={[
              'rounded-full transition-shadow',
              seat === viewedSeat ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel' : '',
            ].join(' ')}
          >
            <PlayerChip
              seat={seat}
              name={t('hotseat.seatBar.seatLabel', { n: seat + 1 })}
              active={seat === activeSeat}
            />
          </button>
        ))}
      </div>

      {ended ? (
        <Badge variant="gold">{t('hotseat.seatBar.gameOver')}</Badge>
      ) : (
        <div className="flex shrink-0 gap-2">
          <Button variant="subtle" size="sm" onClick={handleBotMove} disabled={!canBotMove}>
            {t('hotseat.bot.moveButton')}
          </Button>
          <Button variant="subtle" size="sm" onClick={handleBotUntilMyTurn}>
            {t('hotseat.bot.untilMyTurnButton')}
          </Button>
        </div>
      )}
    </div>
  );
}
