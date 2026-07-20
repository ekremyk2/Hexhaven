// StealPicker (T-405 requirement 3): the `steal` phase's owner picks a victim from candidates
// carrying only a nickname + resource COUNT (docs/02 §6 redaction — never card identities). The
// engine only ever enters `steal` with >=2 eligible candidates (ER-3 auto-resolves 0/1), so this
// always renders at least two rows whenever `open`. Blocking like `DiscardModal` — the roller must
// choose (R6.3) — so `Modal`'s `onClose` is a no-op.
import { useTranslation } from 'react-i18next';
import type { Seat } from '@hexhaven/shared';
import { Card, Modal, PlayerChip } from '../ui';

export interface StealCandidate {
  seat: Seat;
  /** Display name — lobby nickname or seat fallback, plain data (not a UI string). */
  name: string;
  /** Resource COUNT only — never which resources, matching `OtherPlayerView`. */
  resourceCount: number;
}

export interface StealPickerProps {
  open: boolean;
  candidates: StealCandidate[];
  onPick: (seat: Seat) => void;
}

const NO_OP = () => {};

export function StealPicker({ open, candidates, onPick }: StealPickerProps) {
  const { t } = useTranslation('robber');

  return (
    <Modal open={open} onClose={NO_OP} title={t('steal.title')}>
      <div className="flex flex-col gap-2" data-testid="steal-picker">
        {candidates.map((candidate) => (
          <Card key={candidate.seat} data-testid={`steal-candidate-${candidate.seat}`}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 text-left"
              onClick={() => onPick(candidate.seat)}
            >
              <PlayerChip seat={candidate.seat} name={candidate.name} />
              <span
                className="font-ui text-14 font-semibold text-ink"
                data-testid={`steal-count-${candidate.seat}`}
              >
                {t('steal.cardCount', { count: candidate.resourceCount })}
              </span>
            </button>
          </Card>
        ))}
      </div>
    </Modal>
  );
}
