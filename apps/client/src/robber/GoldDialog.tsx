// GoldDialog (T-705, Seafarers S9/ER-S7): blocking per-resource picker for a seat that owes a
// gold-field choice. The owner of each building adjacent to a producing gold hex picks free
// resources — 1 per settlement, 2 per city — capped by what the bank can still supply (S9.3).
// Presentational, exactly like `DiscardModal`: `open`/`required`/`bank` come from
// `robberLogic.ts`'s `computeGoldDialogState`, `onConfirm` is the caller's `sendAction` wrapper.
// Blocking by design (ER-S7: the turn can't continue until every owed seat picks) — `Modal`'s
// `onClose` is a no-op so Escape/backdrop-click can't dismiss it.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceBundle, ResourceType } from '@hexhaven/shared';
import { RESOURCE_ORDER } from '../hud/constants';
import { Button, Modal } from '../ui';
import { selectionTotal, stepSelection } from './discardLogic';

export interface GoldDialogProps {
  open: boolean;
  /** How many resources this seat must pick (entitlement capped by the bank, S9.3). */
  required: number;
  /** The bank's current stock — each resource is capped at what remains (R5.3/S9.3). */
  bank: Record<ResourceType, number>;
  onConfirm: (picks: ResourceBundle) => void;
}

const NO_OP = () => {};

/** A gold resource's `+` is enabled only while (a) the running TOTAL is still below the owed count
 * and (b) this resource is under its own bank/owed cap. Gating on the total — not merely on this
 * resource being at 0 — is what prevents over-selection like picking 2+2 for a "choose 2" roll
 * (user-reported). Pure so it can be unit-tested without a DOM. */
export function canIncrementGold(count: number, cap: number, total: number, required: number): boolean {
  return count < cap && total < required;
}

export function GoldDialog({ open, required, bank, onConfirm }: GoldDialogProps) {
  const { t } = useTranslation('robber');
  const [selection, setSelection] = useState<ResourceBundle>({});

  // Fresh picker every time the dialog (re)opens — a stale selection from a prior gold roll should
  // never leak into the next one.
  useEffect(() => {
    if (open) setSelection({});
  }, [open]);

  const total = selectionTotal(selection);
  // Confirm only at exactly the owed count (the client-side half of avoiding BAD_GOLD_COUNT). Allows
  // the rare bank-empty case where `required` is 0 → confirm an empty pick immediately.
  const confirmEnabled = total === required;

  return (
    <Modal open={open} onClose={NO_OP} title={t('gold.title', { count: required })}>
      <div className="flex flex-col gap-3" data-testid="gold-dialog">
        <p className="font-ui text-14 text-ink-soft" data-testid="gold-selected-count">
          {t('gold.selectedCount', { selected: total, required })}
        </p>

        <div className="flex flex-wrap gap-4">
          {RESOURCE_ORDER.map((resource) => {
            const stock = bank[resource] ?? 0;
            // Cap each resource at whichever is smaller: the bank's stock or the remaining owed count.
            const cap = Math.min(stock, required);
            const count = selection[resource] ?? 0;
            const label = t(`resourceName.${resource}`);
            const canIncrement = canIncrementGold(count, cap, total, required);
            return (
              <div
                key={resource}
                className="flex flex-col items-center gap-1"
                data-testid={`gold-row-${resource}`}
              >
                <span className="font-ui text-12 font-semibold text-ink">{label}</span>
                <span className="font-ui text-12 text-ink-soft">{t('gold.bankCount', { count: stock })}</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="subtle"
                    size="sm"
                    aria-label={t('gold.decrement', { resource: label })}
                    disabled={count <= 0}
                    onClick={() => setSelection((s) => stepSelection(s, resource, -1, cap))}
                  >
                    {t('gold.minus')}
                  </Button>
                  <span
                    className="w-6 text-center font-ui text-14 font-bold text-ink"
                    data-testid={`gold-count-${resource}`}
                  >
                    {count}
                  </span>
                  <Button
                    variant="subtle"
                    size="sm"
                    aria-label={t('gold.increment', { resource: label })}
                    disabled={!canIncrement}
                    onClick={() => setSelection((s) => stepSelection(s, resource, 1, cap))}
                  >
                    {t('gold.plus')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="primary"
            data-testid="gold-confirm"
            disabled={!confirmEnabled}
            onClick={() => onConfirm(selection)}
          >
            {t('gold.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
