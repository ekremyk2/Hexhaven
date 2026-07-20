// DiscardModal (T-405 requirement 1): blocking per-resource stepper modal for a seat that owes a
// discard (R6.1). Presentational — `open`/`required`/`hand` are computed by `robberLogic.ts`'s
// `computeDiscardModalState`, `onConfirm` is the caller's `sendAction` wrapper. Blocking by design
// (docs/01 ER-2: an owed discard isn't optional): `Modal`'s `onClose` is wired to a no-op so
// Escape/backdrop-click can't dismiss it.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceBundle, ResourceType } from '@hexhaven/shared';
import { RESOURCE_ORDER } from '../hud/constants';
import { Button, Modal } from '../ui';
import { autoDiscardBundle, canConfirmDiscard, selectionTotal, stepSelection } from './discardLogic';

export interface DiscardModalProps {
  open: boolean;
  /** `phase.amounts[mySeat]` — how many cards this seat must discard (R6.1: floor(hand/2)). */
  required: number;
  /** The viewer's own full hand (only ever read for the viewer's own seat — never an opponent's). */
  hand: Record<ResourceType, number>;
  onConfirm: (cards: ResourceBundle) => void;
}

const NO_OP = () => {};

export function DiscardModal({ open, required, hand, onConfirm }: DiscardModalProps) {
  const { t } = useTranslation('robber');
  const [selection, setSelection] = useState<ResourceBundle>({});

  // Fresh picker every time the modal (re)opens — a stale selection from a PRIOR discard should
  // never leak into the next one.
  useEffect(() => {
    if (open) setSelection({});
  }, [open]);

  const total = selectionTotal(selection);
  const confirmEnabled = canConfirmDiscard(selection, required);

  return (
    <Modal open={open} onClose={NO_OP} title={t('discard.title', { count: required })}>
      <div className="flex flex-col gap-3" data-testid="discard-modal">
        <p className="font-ui text-14 text-ink-soft" data-testid="discard-selected-count">
          {t('discard.selectedCount', { selected: total, required })}
        </p>

        <div className="flex flex-wrap gap-4">
          {RESOURCE_ORDER.map((resource) => {
            const cap = hand[resource] ?? 0;
            const count = selection[resource] ?? 0;
            const label = t(`resourceName.${resource}`);
            return (
              <div
                key={resource}
                className="flex flex-col items-center gap-1"
                data-testid={`discard-row-${resource}`}
              >
                <span className="font-ui text-12 font-semibold text-ink">{label}</span>
                <span className="font-ui text-12 text-ink-soft">{t('discard.haveCount', { count: cap })}</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="subtle"
                    size="sm"
                    aria-label={t('discard.decrement', { resource: label })}
                    disabled={count <= 0}
                    onClick={() => setSelection((s) => stepSelection(s, resource, -1, cap))}
                  >
                    {t('discard.minus')}
                  </Button>
                  <span
                    className="w-6 text-center font-ui text-14 font-bold text-ink"
                    data-testid={`discard-count-${resource}`}
                  >
                    {count}
                  </span>
                  <Button
                    variant="subtle"
                    size="sm"
                    aria-label={t('discard.increment', { resource: label })}
                    disabled={count >= cap}
                    onClick={() => setSelection((s) => stepSelection(s, resource, 1, cap))}
                  >
                    {t('discard.plus')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="subtle"
            data-testid="discard-auto"
            onClick={() => setSelection(autoDiscardBundle(hand, required))}
          >
            {t('discard.auto')}
          </Button>
          <Button
            variant="danger"
            data-testid="discard-confirm"
            disabled={!confirmEnabled}
            onClick={() => onConfirm(selection)}
          >
            {t('discard.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
