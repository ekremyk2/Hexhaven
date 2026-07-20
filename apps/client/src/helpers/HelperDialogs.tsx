// Helper-use param dialogs (Phase-9 play-UI follow-up): one small "collect params -> dispatch"
// dialog per `useHelper` variant + `swapHelper`, following `citiesKnights/ProgressCardDialogs.tsx`'s
// exact pattern (radiogroup of buttons + a disabled-until-picked confirm). Single-list pickers reuse
// that file's generic `ChoicePickerDialog` (imported, not duplicated — it has no Cities & Knights-
// specific logic); the few compound shapes (Mendicant, Merchant, Architect, Priest) get their own
// small component here, same shape as `cardMods/CardModDialogs.tsx`'s.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnyDevCardId, HelperId, ResourceType, Seat } from '@hexhaven/shared';
import { RESOURCE_ORDER } from '../hud/constants';
import { ResourceIcon } from '../trade/ResourceIcon';
import { Button, Modal } from '../ui';
import { ChoicePickerDialog, type Choice } from '../citiesKnights/ProgressCardDialogs';

export { ChoicePickerDialog };
export type { Choice };

function ResourceRow({ label, value, onPick, testidPrefix }: { label?: string; value: ResourceType | null; onPick: (r: ResourceType) => void; testidPrefix: string }) {
  return (
    <section>
      {label ? <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{label}</p> : null}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {RESOURCE_ORDER.map((r) => {
          const selected = value === r;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`${testidPrefix}-${r}`}
              onClick={() => onPick(r)}
              className={[
                'flex flex-col items-center gap-1 rounded-card border p-2 cursor-pointer',
                selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
              ].join(' ')}
            >
              <ResourceIcon resource={r} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ChoiceRow({ label, choices, value, onPick }: { label: string; choices: Choice[]; value: number | null; onPick: (n: number) => void }) {
  return (
    <section>
      <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{label}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={value === c.value}
            data-testid={c.testid}
            onClick={() => onPick(c.value)}
            className={[
              'rounded-card border px-3 py-2 font-ui text-14 tabular-nums cursor-pointer',
              value === c.value ? 'border-accent bg-accent/10' : 'border-panel-edge',
            ].join(' ')}
          >
            {c.label}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---- Mayor: 1 resource --------------------------------------------------------------------------

export interface SingleResourceDialogProps {
  open: boolean;
  titleKey: string;
  instructionsKey: string;
  confirmKey: string;
  testid: string;
  onConfirm: (resource: ResourceType) => void;
  onClose: () => void;
}

/** Reused by Mayor and Captain — both are "pick 1 resource, confirm". */
export function SingleResourceDialog({ open, titleKey, instructionsKey, confirmKey, testid, onConfirm, onClose }: SingleResourceDialogProps) {
  const { t } = useTranslation('helpers');
  const [resource, setResource] = useState<ResourceType | null>(null);
  useEffect(() => {
    if (open) setResource(null);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t(titleKey)}>
      <div className="flex flex-col gap-4" data-testid={testid}>
        <p className="font-ui text-14 text-ink-soft">{t(instructionsKey)}</p>
        <ResourceRow value={resource} onPick={setResource} testidPrefix={`${testid}-pick`} />
        <Button data-testid={`${testid}-confirm`} disabled={resource == null} onClick={() => resource != null && onConfirm(resource)}>
          {t(confirmKey)}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Explorer: from + to edges -----------------------------------------------------------------

export interface ExplorerDialogProps {
  open: boolean;
  fromChoices: Choice[];
  toChoices: Choice[];
  onConfirm: (from: number, to: number) => void;
  onClose: () => void;
}

export function ExplorerDialog({ open, fromChoices, toChoices, onConfirm, onClose }: ExplorerDialogProps) {
  const { t } = useTranslation('helpers');
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  useEffect(() => {
    if (open) {
      setFrom(null);
      setTo(null);
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.explorer.title')}>
      <div className="flex flex-col gap-4" data-testid="helper-explorer-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.explorer.instructions')}</p>
        <ChoiceRow label={t('dialog.explorer.fromLabel')} choices={fromChoices} value={from} onPick={setFrom} />
        <ChoiceRow label={t('dialog.explorer.toLabel')} choices={toChoices.filter((c) => c.value !== from)} value={to} onPick={setTo} />
        <Button
          data-testid="helper-explorer-confirm"
          disabled={from == null || to == null}
          onClick={() => from != null && to != null && onConfirm(from, to)}
        >
          {t('dialog.explorer.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Mendicant: edge + replace(brick|lumber) + substitute ---------------------------------------

export interface MendicantDialogProps {
  open: boolean;
  edgeChoices: Choice[];
  onConfirm: (edge: number, replace: 'brick' | 'lumber', substitute: ResourceType) => void;
  onClose: () => void;
}

export function MendicantDialog({ open, edgeChoices, onConfirm, onClose }: MendicantDialogProps) {
  const { t } = useTranslation('helpers');
  const [edge, setEdge] = useState<number | null>(null);
  const [replace, setReplace] = useState<'brick' | 'lumber' | null>(null);
  const [substitute, setSubstitute] = useState<ResourceType | null>(null);
  useEffect(() => {
    if (open) {
      setEdge(null);
      setReplace(null);
      setSubstitute(null);
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.mendicant.title')}>
      <div className="flex flex-col gap-4" data-testid="helper-mendicant-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.mendicant.instructions')}</p>
        <ChoiceRow label={t('dialog.mendicant.edgeLabel')} choices={edgeChoices} value={edge} onPick={setEdge} />
        <section>
          <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('dialog.mendicant.replaceLabel')}</p>
          <div className="flex gap-2" role="radiogroup" aria-label={t('dialog.mendicant.replaceLabel')}>
            {(['brick', 'lumber'] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={replace === r}
                data-testid={`helper-mendicant-replace-${r}`}
                onClick={() => setReplace(r)}
                className={[
                  'flex items-center gap-1 rounded-card border p-2 cursor-pointer',
                  replace === r ? 'border-accent bg-accent/10' : 'border-panel-edge',
                ].join(' ')}
              >
                <ResourceIcon resource={r} />
              </button>
            ))}
          </div>
        </section>
        <ResourceRow label={t('dialog.mendicant.substituteLabel')} value={substitute} onPick={setSubstitute} testidPrefix="helper-mendicant-substitute" />
        <Button
          data-testid="helper-mendicant-confirm"
          disabled={edge == null || replace == null || substitute == null}
          onClick={() => edge != null && replace != null && substitute != null && onConfirm(edge, replace, substitute)}
        >
          {t('dialog.mendicant.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Robber Bride: optional target seat ---------------------------------------------------------

export interface RobberBrideDialogProps {
  open: boolean;
  targetChoices: Choice[];
  onConfirm: (target: number | undefined) => void;
  onClose: () => void;
}

export function RobberBrideDialog({ open, targetChoices, onConfirm, onClose }: RobberBrideDialogProps) {
  const { t } = useTranslation('helpers');
  const [target, setTarget] = useState<number | null>(null);
  useEffect(() => {
    if (open) setTarget(null);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.robberBride.title')}>
      <div className="flex flex-col gap-4" data-testid="helper-robber-bride-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.robberBride.instructions')}</p>
        {targetChoices.length > 0 ? (
          <ChoiceRow label={t('dialog.robberBride.targetLabel')} choices={targetChoices} value={target} onPick={setTarget} />
        ) : (
          <p className="font-ui text-12 text-ink-soft" data-testid="helper-robber-bride-no-target">
            {t('dialog.robberBride.noTargetNote')}
          </p>
        )}
        <Button
          data-testid="helper-robber-bride-confirm"
          disabled={targetChoices.length > 0 && target == null}
          onClick={() => onConfirm(target ?? undefined)}
        >
          {t('dialog.robberBride.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Merchant: up to 2 targets + demand + give-back per target -----------------------------------

export interface MerchantDialogProps {
  open: boolean;
  targetChoices: { seat: Seat; label: string }[];
  onConfirm: (targets: Seat[], demand: ResourceType, giveBack: Partial<Record<Seat, ResourceType>>) => void;
  onClose: () => void;
}

export function MerchantDialog({ open, targetChoices, onConfirm, onClose }: MerchantDialogProps) {
  const { t } = useTranslation('helpers');
  const [targets, setTargets] = useState<Seat[]>([]);
  const [demand, setDemand] = useState<ResourceType | null>(null);
  const [giveBack, setGiveBack] = useState<Partial<Record<Seat, ResourceType>>>({});

  useEffect(() => {
    if (open) {
      setTargets([]);
      setDemand(null);
      setGiveBack({});
    }
  }, [open]);

  function toggleTarget(seat: Seat) {
    setTargets((prev) => {
      if (prev.includes(seat)) return prev.filter((s) => s !== seat);
      if (prev.length >= 2) return prev;
      return [...prev, seat];
    });
  }

  const canConfirm = targets.length >= 1 && demand != null && targets.every((s) => giveBack[s] != null);

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.merchant.title')}>
      <div className="flex flex-col gap-4" data-testid="helper-merchant-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.merchant.instructions')}</p>
        <section>
          <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('dialog.merchant.targetsLabel')}</p>
          <div className="flex flex-wrap gap-2">
            {targetChoices.map((c) => {
              const selected = targets.includes(c.seat);
              const disabled = !selected && targets.length >= 2;
              return (
                <button
                  key={c.seat}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  data-testid={`helper-merchant-target-${c.seat}`}
                  onClick={() => toggleTarget(c.seat)}
                  className={[
                    'rounded-card border px-3 py-2 font-ui text-14',
                    selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                  ].join(' ')}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </section>
        <ResourceRow label={t('dialog.merchant.demandLabel')} value={demand} onPick={setDemand} testidPrefix="helper-merchant-demand" />
        {targets.map((seat) => (
          <ResourceRow
            key={seat}
            label={t('dialog.merchant.giveBackLabel', { name: targetChoices.find((c) => c.seat === seat)?.label ?? seat })}
            value={giveBack[seat] ?? null}
            onPick={(r) => setGiveBack((prev) => ({ ...prev, [seat]: r }))}
            testidPrefix={`helper-merchant-giveback-${seat}`}
          />
        ))}
        <Button
          data-testid="helper-merchant-confirm"
          disabled={!canConfirm}
          onClick={() => demand != null && canConfirm && onConfirm(targets, demand, giveBack)}
        >
          {t('dialog.merchant.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Architect: pick (0|1|2) + replace + substitute ----------------------------------------------
//
// Peek reveal fix (redact.ts hidden-info UX): the engine now supports a "begin" step
// (`useHelper{helper:'architect', beginPeek:true}`) that reveals the REAL top-3 `devDeck` cards to
// this seat's own view (`ext.helpers.architectPeek`). `peekedCards` below is OPTIONAL and purely
// additive so this component still works unchanged for a caller that never requests a peek:
//   - `undefined` (omitted entirely): the ORIGINAL behavior — positional "Card 1/2/3" labels, no
//     `beginPeek` dispatch expected of the caller. Existing callers need no changes.
//   - `null`: a peek was requested but hasn't round-tripped through state yet — shows a "peeking…"
//     placeholder instead of ever falling back to a blind numeric guess.
//   - an array: the real revealed card ids — renders actual card names (from the `devcards`
//     namespace, matching `DevCardPanel`'s own `card.<id>` keys) instead of "Card N".
// A caller opting into the reveal should dispatch `beginPeek:true` when this dialog opens (`onOpen`)
// and pass its own seat's `ext.helpers.architectPeek` through as `peekedCards`.

export interface ArchitectDialogProps {
  open: boolean;
  maxPick: 0 | 1 | 2;
  /** See the header comment above: omit entirely for the pre-existing positional behavior. */
  peekedCards?: AnyDevCardId[] | null;
  /** Fired once when the dialog opens, iff the caller wants the peek reveal — dispatches
   *  `useHelper{helper:'architect', beginPeek:true}`. Unused (and unnecessary) when `peekedCards`
   *  is omitted. */
  onOpenPeek?: () => void;
  onConfirm: (pick: 0 | 1 | 2, replace: ResourceType, substitute: ResourceType) => void;
  onClose: () => void;
}

export function ArchitectDialog({ open, maxPick, peekedCards, onOpenPeek, onConfirm, onClose }: ArchitectDialogProps) {
  const { t } = useTranslation(['helpers', 'devcards']);
  const [pick, setPick] = useState<0 | 1 | 2 | null>(null);
  const [replace, setReplace] = useState<ResourceType | null>(null);
  const [substitute, setSubstitute] = useState<ResourceType | null>(null);
  useEffect(() => {
    if (open) {
      setPick(null);
      setReplace(null);
      setSubstitute(null);
      onOpenPeek?.();
    }
    // onOpenPeek intentionally excluded from the deps array: it should fire once per open, not on
    // every re-render of a caller that passes a fresh closure each time (mirrors every other dialog's
    // `[open]`-only effect above).
  }, [open]);

  const revealing = peekedCards !== undefined;
  const pickChoices: Choice[] = Array.from({ length: maxPick + 1 }, (_, i) => {
    const real = peekedCards?.[i];
    return {
      value: i,
      label: real != null ? t(`devcards:card.${real}`) : t('dialog.architect.cardOption', { n: i + 1 }),
      testid: `helper-architect-pick-${i}`,
    };
  });
  // While revealing but the peek hasn't round-tripped yet (`peekedCards === null`), the picker is
  // withheld entirely rather than ever showing blind numeric options.
  const showPeekingPlaceholder = revealing && peekedCards == null;

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.architect.title')}>
      <div className="flex flex-col gap-4" data-testid="helper-architect-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.architect.instructions')}</p>
        {showPeekingPlaceholder ? (
          <p className="font-ui text-12 text-ink-soft" data-testid="helper-architect-peeking">
            {t('dialog.architect.peeking')}
          </p>
        ) : (
          <ChoiceRow label={t('dialog.architect.pickLabel')} choices={pickChoices} value={pick} onPick={(n) => setPick(n as 0 | 1 | 2)} />
        )}
        <ResourceRow label={t('dialog.architect.replaceLabel')} value={replace} onPick={setReplace} testidPrefix="helper-architect-replace" />
        <ResourceRow label={t('dialog.architect.substituteLabel')} value={substitute} onPick={setSubstitute} testidPrefix="helper-architect-substitute" />
        <Button
          data-testid="helper-architect-confirm"
          disabled={pick == null || replace == null || substitute == null}
          onClick={() => pick != null && replace != null && substitute != null && onConfirm(pick, replace, substitute)}
        >
          {t('dialog.architect.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Priest: build (settlement|city) + vertex ----------------------------------------------------

export interface PriestDialogProps {
  open: boolean;
  settlementChoices: Choice[];
  cityChoices: Choice[];
  onConfirm: (build: 'settlement' | 'city', vertex: number) => void;
  onClose: () => void;
}

export function PriestDialog({ open, settlementChoices, cityChoices, onConfirm, onClose }: PriestDialogProps) {
  const { t } = useTranslation('helpers');
  const [build, setBuild] = useState<'settlement' | 'city' | null>(null);
  const [vertex, setVertex] = useState<number | null>(null);
  useEffect(() => {
    if (open) {
      setBuild(null);
      setVertex(null);
    }
  }, [open]);

  const choices = build === 'city' ? cityChoices : build === 'settlement' ? settlementChoices : [];

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.priest.title')}>
      <div className="flex flex-col gap-4" data-testid="helper-priest-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.priest.instructions')}</p>
        <section>
          <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('dialog.priest.buildLabel')}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dialog.priest.buildLabel')}>
            <button
              type="button"
              role="radio"
              aria-checked={build === 'settlement'}
              disabled={settlementChoices.length === 0}
              data-testid="helper-priest-build-settlement"
              onClick={() => {
                setBuild('settlement');
                setVertex(null);
              }}
              className={[
                'rounded-card border px-3 py-2 font-ui text-14',
                build === 'settlement' ? 'border-accent bg-accent/10' : 'border-panel-edge',
                settlementChoices.length === 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              ].join(' ')}
            >
              {t('dialog.priest.buildSettlement')}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={build === 'city'}
              disabled={cityChoices.length === 0}
              data-testid="helper-priest-build-city"
              onClick={() => {
                setBuild('city');
                setVertex(null);
              }}
              className={[
                'rounded-card border px-3 py-2 font-ui text-14',
                build === 'city' ? 'border-accent bg-accent/10' : 'border-panel-edge',
                cityChoices.length === 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              ].join(' ')}
            >
              {t('dialog.priest.buildCity')}
            </button>
          </div>
        </section>
        {build ? <ChoiceRow label={t('dialog.priest.vertexLabel')} choices={choices} value={vertex} onPick={setVertex} /> : null}
        <Button
          data-testid="helper-priest-confirm"
          disabled={build == null || vertex == null}
          onClick={() => build != null && vertex != null && onConfirm(build, vertex)}
        >
          {t('dialog.priest.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Swap: pick a helper from the display ---------------------------------------------------------

export interface SwapDialogProps {
  open: boolean;
  choices: { id: HelperId; label: string }[];
  onConfirm: (take: HelperId) => void;
  onClose: () => void;
}

export function SwapDialog({ open, choices, onConfirm, onClose }: SwapDialogProps) {
  const { t } = useTranslation('helpers');
  const [take, setTake] = useState<HelperId | null>(null);
  useEffect(() => {
    if (open) setTake(null);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('swap.title')}>
      <div className="flex flex-col gap-4" data-testid="helper-swap-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('swap.instructions')}</p>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('swap.title')}>
          {choices.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={take === c.id}
              data-testid={`helper-swap-pick-${c.id}`}
              onClick={() => setTake(c.id)}
              className={[
                'flex flex-col items-start gap-0.5 rounded-card border px-3 py-2 text-left cursor-pointer',
                take === c.id ? 'border-accent bg-accent/10' : 'border-panel-edge',
              ].join(' ')}
            >
              <span className="font-ui text-14 font-semibold text-ink">{c.label}</span>
              <span className="font-ui text-12 text-ink-soft">{t(`desc.${c.id}`)}</span>
            </button>
          ))}
        </div>
        <Button data-testid="helper-swap-confirm" disabled={take == null} onClick={() => take != null && onConfirm(take)}>
          {t('swap.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
