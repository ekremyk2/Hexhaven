// MonopolyDialog (task requirement 4): single resource-type pick, drama-red confirm (this is the
// most aggressive card in the deck — every other seat hands over ALL of the chosen type). No bank
// gating: Monopoly never touches the bank, only moves cards between hands.
//
// Deviation from the task file's suggested path (`src/dialogs/MonopolyDialog.tsx`): this session's
// file allowlist is `apps/client/src/devcards/**` only, so this dialog lives here instead — noted
// in this task's Implementation notes for the PM.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceType } from '@hexhaven/shared';
import { RESOURCE_ORDER } from '../hud/constants';
import { ResourceIcon } from '../trade/ResourceIcon';
import { Button, Modal } from '../ui';

export interface MonopolyDialogProps {
  open: boolean;
  onConfirm: (resource: ResourceType) => void;
  onClose: () => void;
}

export function MonopolyDialog({ open, onConfirm, onClose }: MonopolyDialogProps) {
  const { t } = useTranslation('devcards');
  const [resource, setResource] = useState<ResourceType | null>(null);

  useEffect(() => {
    if (open) setResource(null);
  }, [open]);

  function confirm() {
    if (resource == null) return;
    onConfirm(resource);
  }

  return (
    <Modal open={open} onClose={onClose} title={t('monopoly.title')}>
      <div className="flex flex-col gap-4" data-testid="monopoly-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('monopoly.instructions')}</p>

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('monopoly.title')}>
          {RESOURCE_ORDER.map((r) => {
            const selected = resource === r;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`monopoly-pick-${r}`}
                onClick={() => setResource(r)}
                className={[
                  'flex flex-col items-center gap-1 rounded-card border p-2 cursor-pointer',
                  selected ? 'border-danger bg-danger/10' : 'border-panel-edge',
                ].join(' ')}
              >
                <ResourceIcon resource={r} />
              </button>
            );
          })}
        </div>

        <Button variant="danger" data-testid="monopoly-confirm" disabled={resource == null} onClick={confirm}>
          {t('monopoly.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
