// YearOfPlentyDialog (task requirement 4): N independent resource picks — the same type is legal to
// pick more than once (ER-6: each repeat needs one more of that type in the bank) — with bank-empty
// types disabled LIVE as earlier picks change. Presentational + self-contained local selection
// state, matching `robber/DiscardModal.tsx`'s split: `open`/`bank` are computed by the caller,
// `onConfirm` is the caller's `sendAction` wrapper.
//
// Deviation from the task file's suggested path (`src/dialogs/YearOfPlentyDialog.tsx`): this
// session's file allowlist is `apps/client/src/devcards/**` only, so this dialog lives here instead
// — noted in this task's Implementation notes for the PM.
//
// Phase-9 play-UI follow-up (docs/tasks/FOLLOWUPS.md): `count` generalizes this from exactly 2 picks
// to any N (the `customConstants.yearOfPlentyCount` modifier, T-906) — omitted/2 (its default)
// renders IDENTICALLY to the original 2-pick dialog, same testids (`yop-pick-a-*`/`yop-pick-b-*`),
// so base games are pixel- and test-id-unaffected (RK-13). `onConfirm` now hands back the full
// `picks` array; the caller (`DevCardsPanel.tsx`) splits it into the `playYearOfPlenty` action's
// `a`/`b`/`extra` fields.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceType } from '@hexhaven/shared';
import { RESOURCE_ORDER } from '../hud/constants';
import { ResourceIcon } from '../trade/ResourceIcon';
import { Badge, Button, Modal } from '../ui';
import { yopCanConfirmN, yopPickDisabledAt } from './devCardLogic';

export interface YearOfPlentyDialogProps {
  open: boolean;
  /** Current bank stock — ER-6 gating is live against this, not a snapshot at open time. */
  bank: Record<ResourceType, number>;
  /** How many resources to pick, total. Omit for the base-game default of 2. */
  count?: number;
  onConfirm: (picks: ResourceType[]) => void;
  onClose: () => void;
}

function PickRow({
  testidPrefix,
  label,
  value,
  onPick,
  disabledFor,
}: {
  testidPrefix: string;
  label: string;
  value: ResourceType | null;
  onPick: (resource: ResourceType) => void;
  disabledFor: (resource: ResourceType) => boolean;
}) {
  return (
    <section>
      <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{label}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {RESOURCE_ORDER.map((resource) => {
          const disabled = disabledFor(resource);
          const selected = value === resource;
          return (
            <button
              key={resource}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`${testidPrefix}-${resource}`}
              disabled={disabled}
              onClick={() => onPick(resource)}
              className={[
                'flex flex-col items-center gap-1 rounded-card border p-2',
                selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              ].join(' ')}
            >
              <ResourceIcon resource={resource} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** Pick index -> testid prefix: the first two stay `yop-pick-a`/`yop-pick-b` (pre-existing testids,
 *  asserted on by `YearOfPlentyDialog.test.ts`); any pick beyond that (only possible with the
 *  `customConstants.yearOfPlentyCount` modifier set above 2) is `yop-pick-{index}`. */
function testidFor(index: number): string {
  if (index === 0) return 'yop-pick-a';
  if (index === 1) return 'yop-pick-b';
  return `yop-pick-${index}`;
}

export function YearOfPlentyDialog({ open, bank, count = 2, onConfirm, onClose }: YearOfPlentyDialogProps) {
  const { t } = useTranslation('devcards');
  const n = Math.max(1, count);
  const [picks, setPicks] = useState<(ResourceType | null)[]>(() => Array.from({ length: n }, () => null));

  // Fresh picks every time the dialog (re)opens, or `n` changes (a stale selection — or one sized
  // for a different count — should never leak into the next open).
  useEffect(() => {
    if (open) setPicks(Array.from({ length: n }, () => null));
  }, [open, n]);

  const canConfirm = yopCanConfirmN(bank, picks);

  function setPick(index: number, resource: ResourceType) {
    setPicks((prev) => prev.map((p, i) => (i === index ? resource : p)));
  }

  function confirm() {
    if (!canConfirm) return;
    onConfirm(picks as ResourceType[]);
  }

  return (
    <Modal open={open} onClose={onClose} title={t('yearOfPlenty.title')}>
      <div className="flex flex-col gap-4" data-testid="year-of-plenty-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('yearOfPlenty.instructions', { count: n })}</p>

        {picks.map((value, index) => (
          <PickRow
            key={index}
            testidPrefix={testidFor(index)}
            label={t('yearOfPlenty.pickLabel', { n: index + 1 })}
            value={value}
            onPick={(resource) => setPick(index, resource)}
            disabledFor={(resource) => yopPickDisabledAt(bank, picks, index, resource)}
          />
        ))}

        {!canConfirm && picks.every((p) => p != null) ? (
          <Badge variant="danger" data-testid="yop-bank-empty">
            {t('reason.bankEmpty')}
          </Badge>
        ) : null}

        <Button data-testid="yop-confirm" disabled={!canConfirm} onClick={confirm}>
          {t('yearOfPlenty.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
