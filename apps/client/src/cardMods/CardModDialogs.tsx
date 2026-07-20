// cardMods param dialogs (Phase-9 play-UI follow-up): one small "collect params -> dispatch"
// dialog per card/combo that needs a target, following `citiesKnights/ProgressCardDialogs.tsx`'s
// exact pattern (radiogroup of buttons + a disabled-until-picked confirm) — this file's own
// `ChoicePickerDialog` reuse below is that generic list-picker component, imported rather than
// duplicated (it has no Cities & Knights-specific logic despite living in that folder).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EdgeId, HexId, ResourceType, Seat, VertexId } from '@hexhaven/shared';
import { RESOURCE_ORDER } from '../hud/constants';
import { ResourceIcon } from '../trade/ResourceIcon';
import { Button, Modal } from '../ui';
import { ChoicePickerDialog, type Choice } from '../citiesKnights/ProgressCardDialogs';

// ---------------------------------------------------------------------------------------------
// Shared single-resource radiogroup — merchantsBoon (give/receive) and roadToll/nightOfPlenty
// (one resource) all reduce to this.
// ---------------------------------------------------------------------------------------------

function ResourceRow({
  label,
  value,
  onPick,
  testidPrefix,
  disabledPick,
}: {
  label?: string;
  value: ResourceType | null;
  onPick: (r: ResourceType) => void;
  testidPrefix: string;
  disabledPick?: ResourceType | null;
}) {
  return (
    <section>
      {label ? <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{label}</p> : null}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {RESOURCE_ORDER.map((r) => {
          const selected = value === r;
          const disabled = disabledPick === r;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              data-testid={`${testidPrefix}-${r}`}
              onClick={() => onPick(r)}
              className={[
                'flex flex-col items-center gap-1 rounded-card border p-2',
                selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
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

// ---- Merchant's Boon: give (2) / receive (1), distinct -----------------------------------------

export interface MerchantsBoonDialogProps {
  open: boolean;
  onConfirm: (give: ResourceType, receive: ResourceType) => void;
  onClose: () => void;
}

export function MerchantsBoonDialog({ open, onConfirm, onClose }: MerchantsBoonDialogProps) {
  const { t } = useTranslation('cardMods');
  const [give, setGive] = useState<ResourceType | null>(null);
  const [receive, setReceive] = useState<ResourceType | null>(null);

  useEffect(() => {
    if (open) {
      setGive(null);
      setReceive(null);
    }
  }, [open]);

  const canConfirm = give != null && receive != null && give !== receive;

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.merchantsBoon.title')}>
      <div className="flex flex-col gap-4" data-testid="cardmod-merchants-boon-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.merchantsBoon.instructions')}</p>
        <ResourceRow
          label={t('dialog.merchantsBoon.giveLabel')}
          value={give}
          onPick={setGive}
          testidPrefix="cardmod-merchants-boon-give"
          disabledPick={receive}
        />
        <ResourceRow
          label={t('dialog.merchantsBoon.receiveLabel')}
          value={receive}
          onPick={setReceive}
          testidPrefix="cardmod-merchants-boon-receive"
          disabledPick={give}
        />
        <Button
          data-testid="cardmod-merchants-boon-confirm"
          disabled={!canConfirm}
          onClick={() => give != null && receive != null && onConfirm(give, receive)}
        >
          {t('dialog.merchantsBoon.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Road Toll: one resource ---------------------------------------------------------------

export interface ResourcePickDialogProps {
  open: boolean;
  titleKey: string;
  instructionsKey: string;
  confirmKey: string;
  onConfirm: (resource: ResourceType) => void;
  onClose: () => void;
  testid: string;
}

/** Single-resource-pick dialog reused by Road Toll and Night of Plenty's free resource. */
export function ResourcePickDialog({ open, titleKey, instructionsKey, confirmKey, onConfirm, onClose, testid }: ResourcePickDialogProps) {
  const { t } = useTranslation('cardMods');
  const [resource, setResource] = useState<ResourceType | null>(null);

  useEffect(() => {
    if (open) setResource(null);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t(titleKey)}>
      <div className="flex flex-col gap-4" data-testid={testid}>
        <p className="font-ui text-14 text-ink-soft">{t(instructionsKey)}</p>
        <ResourceRow value={resource} onPick={setResource} testidPrefix={`${testid}-pick`} />
        <Button
          data-testid={`${testid}-confirm`}
          disabled={resource == null}
          onClick={() => resource != null && onConfirm(resource)}
        >
          {t(confirmKey)}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Night of Plenty: resource + hex --------------------------------------------------------

export interface NightOfPlentyDialogProps {
  open: boolean;
  hexChoices: Choice[];
  onConfirm: (resource: ResourceType, hex: number) => void;
  onClose: () => void;
}

export function NightOfPlentyDialog({ open, hexChoices, onConfirm, onClose }: NightOfPlentyDialogProps) {
  const { t } = useTranslation('cardMods');
  const [resource, setResource] = useState<ResourceType | null>(null);
  const [hex, setHex] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setResource(null);
      setHex(null);
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.nightOfPlenty.title')}>
      <div className="flex flex-col gap-4" data-testid="cardmod-night-of-plenty-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.nightOfPlenty.instructions')}</p>
        <ResourceRow label={t('dialog.nightOfPlenty.resourceLabel')} value={resource} onPick={setResource} testidPrefix="cardmod-nop-resource" />
        <section>
          <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('dialog.nightOfPlenty.hexLabel')}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dialog.nightOfPlenty.hexLabel')}>
            {hexChoices.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={hex === c.value}
                data-testid={c.testid}
                onClick={() => setHex(c.value)}
                className={[
                  'rounded-card border px-3 py-2 font-ui text-14 tabular-nums cursor-pointer',
                  hex === c.value ? 'border-accent bg-accent/10' : 'border-panel-edge',
                ].join(' ')}
              >
                {c.label}
              </button>
            ))}
          </div>
        </section>
        <Button
          data-testid="cardmod-night-of-plenty-confirm"
          disabled={resource == null || hex == null}
          onClick={() => resource != null && hex != null && onConfirm(resource, hex)}
        >
          {t('dialog.nightOfPlenty.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Ride by Night: hex (robber) + edge (free road) ------------------------------------------

export interface RideByNightDialogProps {
  open: boolean;
  hexChoices: Choice[];
  edgeChoices: Choice[];
  onConfirm: (hex: number, edge: number) => void;
  onClose: () => void;
}

export function RideByNightDialog({ open, hexChoices, edgeChoices, onConfirm, onClose }: RideByNightDialogProps) {
  const { t } = useTranslation('cardMods');
  const [hex, setHex] = useState<number | null>(null);
  const [edge, setEdge] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setHex(null);
      setEdge(null);
    }
  }, [open]);

  function row(label: string, choices: Choice[], value: number | null, onPick: (n: number) => void) {
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

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.rideByNight.title')}>
      <div className="flex flex-col gap-4" data-testid="cardmod-ride-by-night-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.rideByNight.instructions')}</p>
        {row(t('dialog.rideByNight.hexLabel'), hexChoices, hex, setHex)}
        {row(t('dialog.rideByNight.edgeLabel'), edgeChoices, edge, setEdge)}
        <Button
          data-testid="cardmod-ride-by-night-confirm"
          disabled={hex == null || edge == null}
          onClick={() => hex != null && edge != null && onConfirm(hex, edge)}
        >
          {t('dialog.rideByNight.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Monorail: 1 or 2 free roads ---------------------------------------------------------------

export interface MonorailDialogProps {
  open: boolean;
  edgeChoices: Choice[];
  onConfirm: (edges: number[]) => void;
  onClose: () => void;
}

export function MonorailDialog({ open, edgeChoices, onConfirm, onClose }: MonorailDialogProps) {
  const { t } = useTranslation('cardMods');
  const [picked, setPicked] = useState<number[]>([]);

  useEffect(() => {
    if (open) setPicked([]);
  }, [open]);

  function toggle(value: number) {
    setPicked((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      if (prev.length >= 2) return prev;
      return [...prev, value];
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.monorail.title')}>
      <div className="flex flex-col gap-4" data-testid="cardmod-monorail-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.monorail.instructions')}</p>
        <section>
          <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('dialog.monorail.edgeLabel')}</p>
          <div className="flex flex-wrap gap-2">
            {edgeChoices.map((c) => {
              const selected = picked.includes(c.value);
              const disabled = !selected && picked.length >= 2;
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled}
                  data-testid={c.testid}
                  onClick={() => toggle(c.value)}
                  className={[
                    'rounded-card border px-3 py-2 font-ui text-14 tabular-nums',
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
        <Button
          data-testid="cardmod-monorail-confirm"
          disabled={picked.length < 1}
          onClick={() => onConfirm(picked)}
        >
          {t('dialog.monorail.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---- Re-exports of the generic picker for trailblazer/highwayman/megaKnight/superSettle --------
export { ChoicePickerDialog };
export type { Choice };

export type CardModDialogEdge = EdgeId;
export type CardModDialogHex = HexId;
export type CardModDialogVertex = VertexId;
export type CardModDialogSeat = Seat;
