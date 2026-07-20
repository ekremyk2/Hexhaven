// Progress-card target dialogs (T-806 Priority 3): the single-pick param dialogs, following
// `devcards/MonopolyDialog.tsx`'s exact pattern (radiogroup of buttons + a disabled-until-picked
// confirm). Each of the three below collects ONE parameter for its `playProgressCard` action.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Commodity, ImprovementTrack, ProgressCardId, ResourceType } from '@hexhaven/shared';
import { RESOURCE_ORDER } from '../hud/constants';
import { ResourceIcon } from '../trade/ResourceIcon';
import { CommodityIcon } from '../board/CommodityIcon';
import { Button, Modal } from '../ui';

export interface ResourceMonopolyDialogProps {
  open: boolean;
  onConfirm: (resource: ResourceType) => void;
  onClose: () => void;
}

/** Resource Monopoly (C6.5): identical shape to the base Monopoly dev card's dialog. */
export function ResourceMonopolyDialog({ open, onConfirm, onClose }: ResourceMonopolyDialogProps) {
  const { t } = useTranslation('citiesKnights');
  const [resource, setResource] = useState<ResourceType | null>(null);

  useEffect(() => {
    if (open) setResource(null);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.resourceMonopoly.title')}>
      <div className="flex flex-col gap-4" data-testid="ck-resource-monopoly-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.resourceMonopoly.instructions')}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dialog.resourceMonopoly.title')}>
          {RESOURCE_ORDER.map((r) => {
            const selected = resource === r;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`ck-resource-monopoly-pick-${r}`}
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
        <Button
          variant="danger"
          data-testid="ck-resource-monopoly-confirm"
          disabled={resource == null}
          onClick={() => resource != null && onConfirm(resource)}
        >
          {t('dialog.resourceMonopoly.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

const COMMODITIES: readonly Commodity[] = ['paper', 'cloth', 'coin'];

export interface CommodityMonopolyDialogProps {
  open: boolean;
  onConfirm: (commodity: Commodity) => void;
  onClose: () => void;
}

/** Commodity Monopoly (C6.5): the commodity analogue of Resource Monopoly. */
export function CommodityMonopolyDialog({ open, onConfirm, onClose }: CommodityMonopolyDialogProps) {
  const { t } = useTranslation('citiesKnights');
  const [commodity, setCommodity] = useState<Commodity | null>(null);

  useEffect(() => {
    if (open) setCommodity(null);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.commodityMonopoly.title')}>
      <div className="flex flex-col gap-4" data-testid="ck-commodity-monopoly-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.commodityMonopoly.instructions')}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dialog.commodityMonopoly.title')}>
          {COMMODITIES.map((c) => {
            const selected = commodity === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`ck-commodity-monopoly-pick-${c}`}
                onClick={() => setCommodity(c)}
                className={[
                  'flex flex-col items-center gap-1 rounded-card border p-2 cursor-pointer',
                  selected ? 'border-danger bg-danger/10' : 'border-panel-edge',
                ].join(' ')}
              >
                <CommodityIcon commodity={c} />
              </button>
            );
          })}
        </div>
        <Button
          variant="danger"
          data-testid="ck-commodity-monopoly-confirm"
          disabled={commodity == null}
          onClick={() => commodity != null && onConfirm(commodity)}
        >
          {t('dialog.commodityMonopoly.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

const TRACKS: readonly ImprovementTrack[] = ['trade', 'politics', 'science'];

export interface CraneTrackDialogProps {
  open: boolean;
  onConfirm: (track: ImprovementTrack) => void;
  onClose: () => void;
}

/** Crane (C6.5): pick which track to advance for 1 fewer commodity. */
export function CraneTrackDialog({ open, onConfirm, onClose }: CraneTrackDialogProps) {
  const { t } = useTranslation('citiesKnights');
  const [track, setTrack] = useState<ImprovementTrack | null>(null);

  useEffect(() => {
    if (open) setTrack(null);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.crane.title')}>
      <div className="flex flex-col gap-4" data-testid="ck-crane-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.crane.instructions')}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dialog.crane.title')}>
          {TRACKS.map((tr) => {
            const selected = track === tr;
            return (
              <button
                key={tr}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`ck-crane-pick-${tr}`}
                onClick={() => setTrack(tr)}
                className={[
                  'rounded-card border px-3 py-2 font-ui text-14 cursor-pointer',
                  selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                ].join(' ')}
              >
                {t(`track.${tr}`)}
              </button>
            );
          })}
        </div>
        <Button data-testid="ck-crane-confirm" disabled={track == null} onClick={() => track != null && onConfirm(track)}>
          {t('dialog.crane.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Generic single-choice picker — the board-target cards (engineer/medicine/merchant/bishop/
// diplomat/intrigue/masterMerchant) all reduce to "pick one item from a legal list", so they share
// this instead of one bespoke dialog each. Choices are numeric ids (vertex/hex/edge/seat) with a
// caller-supplied label. NOTE (documented v1 simplification, T-806): board targets are picked from a
// LIST here, not by clicking the board — board-integrated highlighting for progress-card targets is a
// deliberate follow-up (the knight actions already do board picking; extending it to the 8 distinct
// progress-card target shapes was out of this task's budget).
// ---------------------------------------------------------------------------------------------

export interface Choice {
  value: number;
  label: string;
  testid: string;
}

export interface ChoicePickerDialogProps {
  open: boolean;
  title: string;
  instructions: string;
  confirmLabel: string;
  choices: Choice[];
  onConfirm: (value: number) => void;
  onClose: () => void;
  /** data-testid for the dialog container (so each card's flow is individually assertable). */
  testid: string;
}

export function ChoicePickerDialog({
  open,
  title,
  instructions,
  confirmLabel,
  choices,
  onConfirm,
  onClose,
  testid,
}: ChoicePickerDialogProps) {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (open) setValue(null);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4" data-testid={testid}>
        <p className="font-ui text-14 text-ink-soft">{instructions}</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={title}>
          {choices.map((c) => {
            const selected = value === c.value;
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={c.testid}
                onClick={() => setValue(c.value)}
                className={[
                  'rounded-card border px-3 py-2 font-ui text-14 cursor-pointer tabular-nums',
                  selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                ].join(' ')}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <Button data-testid={`${testid}-confirm`} disabled={value == null} onClick={() => value != null && onConfirm(value)}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Alchemist (C6.5): pick the yellow + red number-die values (1-6 each) for this turn's roll. Played
// BEFORE rolling — the caller (`ProgressHandPanel`) only offers it in `preRoll` before the roll.
// ---------------------------------------------------------------------------------------------

const DIE_FACES: readonly number[] = [1, 2, 3, 4, 5, 6];

export interface AlchemistDialogProps {
  open: boolean;
  onConfirm: (yellowDie: number, redDie: number) => void;
  onClose: () => void;
}

export function AlchemistDialog({ open, onConfirm, onClose }: AlchemistDialogProps) {
  const { t } = useTranslation('citiesKnights');
  const [yellow, setYellow] = useState<number | null>(null);
  const [red, setRed] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setYellow(null);
      setRed(null);
    }
  }, [open]);

  function dieRow(which: 'yellow' | 'red', value: number | null, onPick: (n: number) => void) {
    return (
      <section>
        <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">
          {t(`dialog.alchemist.${which}Label`)}
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t(`dialog.alchemist.${which}Label`)}>
          {DIE_FACES.map((n) => {
            const selected = value === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`ck-alchemist-${which}-${n}`}
                onClick={() => onPick(n)}
                className={[
                  'h-10 w-10 rounded-card border font-ui text-16 font-semibold tabular-nums cursor-pointer',
                  selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                ].join(' ')}
              >
                {n}
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.alchemist.title')}>
      <div className="flex flex-col gap-4" data-testid="ck-alchemist-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.alchemist.instructions')}</p>
        {dieRow('yellow', yellow, setYellow)}
        {dieRow('red', red, setRed)}
        <Button
          data-testid="ck-alchemist-confirm"
          disabled={yellow == null || red == null}
          onClick={() => yellow != null && red != null && onConfirm(yellow, red)}
        >
          {t('dialog.alchemist.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Inventor (C6.5): pick two DISTINCT numbered hexes to swap tokens. Two sequential single-choice
// steps in one modal (pick A, then pick B ≠ A). `hexChoices` is caller-supplied (engine-legal set).
// ---------------------------------------------------------------------------------------------

export interface InventorDialogProps {
  open: boolean;
  hexChoices: Choice[];
  onConfirm: (hexA: number, hexB: number) => void;
  onClose: () => void;
}

export function InventorDialog({ open, hexChoices, onConfirm, onClose }: InventorDialogProps) {
  const { t } = useTranslation('citiesKnights');
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setA(null);
      setB(null);
    }
  }, [open]);

  function row(which: 'a' | 'b', value: number | null, onPick: (n: number) => void, disabledValue: number | null) {
    return (
      <section>
        <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">
          {t(`dialog.inventor.${which}Label`)}
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t(`dialog.inventor.${which}Label`)}>
          {hexChoices.map((c) => {
            const selected = value === c.value;
            const disabled = disabledValue === c.value;
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                data-testid={`ck-inventor-${which}-${c.value}`}
                onClick={() => onPick(c.value)}
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
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.inventor.title')}>
      <div className="flex flex-col gap-4" data-testid="ck-inventor-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.inventor.instructions')}</p>
        {row('a', a, setA, b)}
        {row('b', b, setB, a)}
        <Button
          data-testid="ck-inventor-confirm"
          disabled={a == null || b == null || a === b}
          onClick={() => a != null && b != null && a !== b && onConfirm(a, b)}
        >
          {t('dialog.inventor.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Merchant Fleet (C6.5): a one-shot 2:1 bank trade — pick a give (resource OR commodity) and a
// distinct receive (resource OR commodity).
// ---------------------------------------------------------------------------------------------

type GoodsPick = { kind: 'resource'; value: ResourceType } | { kind: 'commodity'; value: Commodity };

function sameGoods(a: GoodsPick | null, b: GoodsPick | null): boolean {
  return a != null && b != null && a.kind === b.kind && a.value === b.value;
}

function GoodsRow({
  label,
  ariaLabel,
  value,
  onPick,
  testidPrefix,
  disabledPick,
}: {
  label: string;
  ariaLabel: string;
  value: GoodsPick | null;
  onPick: (pick: GoodsPick) => void;
  testidPrefix: string;
  disabledPick: GoodsPick | null;
}) {
  return (
    <section>
      <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{label}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={ariaLabel}>
        {RESOURCE_ORDER.map((r) => {
          const pick: GoodsPick = { kind: 'resource', value: r };
          const selected = sameGoods(value, pick);
          const disabled = sameGoods(disabledPick, pick);
          return (
            <button
              key={`r-${r}`}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              data-testid={`${testidPrefix}-resource-${r}`}
              onClick={() => onPick(pick)}
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
        {COMMODITIES.map((c) => {
          const pick: GoodsPick = { kind: 'commodity', value: c };
          const selected = sameGoods(value, pick);
          const disabled = sameGoods(disabledPick, pick);
          return (
            <button
              key={`c-${c}`}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              data-testid={`${testidPrefix}-commodity-${c}`}
              onClick={() => onPick(pick)}
              className={[
                'flex flex-col items-center gap-1 rounded-card border p-2',
                selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
              ].join(' ')}
            >
              <CommodityIcon commodity={c} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export interface MerchantFleetDialogProps {
  open: boolean;
  onConfirm: (give: ResourceType | Commodity, receive: ResourceType | Commodity) => void;
  onClose: () => void;
}

export function MerchantFleetDialog({ open, onConfirm, onClose }: MerchantFleetDialogProps) {
  const { t } = useTranslation('citiesKnights');
  const [give, setGive] = useState<GoodsPick | null>(null);
  const [receive, setReceive] = useState<GoodsPick | null>(null);

  useEffect(() => {
    if (open) {
      setGive(null);
      setReceive(null);
    }
  }, [open]);

  const canConfirm = give != null && receive != null && !sameGoods(give, receive);

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.merchantFleet.title')}>
      <div className="flex flex-col gap-4" data-testid="ck-merchant-fleet-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.merchantFleet.instructions')}</p>
        <GoodsRow
          label={t('dialog.merchantFleet.giveLabel')}
          ariaLabel={t('dialog.merchantFleet.giveLabel')}
          value={give}
          onPick={setGive}
          testidPrefix="ck-merchant-fleet-give"
          disabledPick={receive}
        />
        <GoodsRow
          label={t('dialog.merchantFleet.receiveLabel')}
          ariaLabel={t('dialog.merchantFleet.receiveLabel')}
          value={receive}
          onPick={setReceive}
          testidPrefix="ck-merchant-fleet-receive"
          disabledPick={give}
        />
        <Button
          data-testid="ck-merchant-fleet-confirm"
          disabled={!canConfirm}
          onClick={() => canConfirm && give != null && receive != null && onConfirm(give.value, receive.value)}
        >
          {t('dialog.merchantFleet.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Commercial Harbor (C6.5): pick the resource you take from each opponent + the commodity you give
// back in return (progressCards.ts's `effectCommercialHarbor` reads `resource` + `commodity`).
// ---------------------------------------------------------------------------------------------

export interface CommercialHarborDialogProps {
  open: boolean;
  onConfirm: (resource: ResourceType, commodity: Commodity) => void;
  onClose: () => void;
}

export function CommercialHarborDialog({ open, onConfirm, onClose }: CommercialHarborDialogProps) {
  const { t } = useTranslation('citiesKnights');
  const [resource, setResource] = useState<ResourceType | null>(null);
  const [commodity, setCommodity] = useState<Commodity | null>(null);

  useEffect(() => {
    if (open) {
      setResource(null);
      setCommodity(null);
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.commercialHarbor.title')}>
      <div className="flex flex-col gap-4" data-testid="ck-commercial-harbor-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.commercialHarbor.instructions')}</p>
        <section>
          <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('dialog.commercialHarbor.resourceLabel')}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dialog.commercialHarbor.resourceLabel')}>
            {RESOURCE_ORDER.map((r) => {
              const selected = resource === r;
              return (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`ck-commercial-harbor-resource-${r}`}
                  onClick={() => setResource(r)}
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
        <section>
          <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('dialog.commercialHarbor.commodityLabel')}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dialog.commercialHarbor.commodityLabel')}>
            {COMMODITIES.map((c) => {
              const selected = commodity === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={`ck-commercial-harbor-commodity-${c}`}
                  onClick={() => setCommodity(c)}
                  className={[
                    'flex flex-col items-center gap-1 rounded-card border p-2 cursor-pointer',
                    selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                  ].join(' ')}
                >
                  <CommodityIcon commodity={c} />
                </button>
              );
            })}
          </div>
        </section>
        <Button
          data-testid="ck-commercial-harbor-confirm"
          disabled={resource == null || commodity == null}
          onClick={() => resource != null && commodity != null && onConfirm(resource, commodity)}
        >
          {t('dialog.commercialHarbor.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Deserter (C6.5): pick an opponent's knight to remove, then where YOUR replacement (same level)
// goes. `knightChoices` (opponent knights) and `placementChoices` (your legal placements) are
// caller-supplied; each knight choice's `value` encodes the seat+vertex via the caller.
// ---------------------------------------------------------------------------------------------

export interface DeserterKnightChoice {
  targetSeat: number;
  targetVertex: number;
  label: string;
  testid: string;
}

export interface DeserterDialogProps {
  open: boolean;
  knightChoices: DeserterKnightChoice[];
  placementChoices: Choice[];
  onConfirm: (targetSeat: number, targetVertex: number, vertex: number) => void;
  onClose: () => void;
}

export function DeserterDialog({ open, knightChoices, placementChoices, onConfirm, onClose }: DeserterDialogProps) {
  const { t } = useTranslation('citiesKnights');
  const [knightIdx, setKnightIdx] = useState<number | null>(null);
  const [placement, setPlacement] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setKnightIdx(null);
      setPlacement(null);
    }
  }, [open]);

  const chosenKnight = knightIdx != null ? knightChoices[knightIdx] : undefined;

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.deserter.title')}>
      <div className="flex flex-col gap-4" data-testid="ck-deserter-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.deserter.instructions')}</p>
        <section>
          <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('dialog.deserter.knightLabel')}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dialog.deserter.knightLabel')}>
            {knightChoices.map((k, i) => {
              const selected = knightIdx === i;
              return (
                <button
                  key={k.testid}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={k.testid}
                  onClick={() => setKnightIdx(i)}
                  className={[
                    'rounded-card border px-3 py-2 font-ui text-14 cursor-pointer',
                    selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                  ].join(' ')}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
        </section>
        <section>
          <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('dialog.deserter.placementLabel')}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dialog.deserter.placementLabel')}>
            {placementChoices.map((c) => {
              const selected = placement === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={c.testid}
                  onClick={() => setPlacement(c.value)}
                  className={[
                    'rounded-card border px-3 py-2 font-ui text-14 tabular-nums cursor-pointer',
                    selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                  ].join(' ')}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </section>
        <Button
          data-testid="ck-deserter-confirm"
          disabled={chosenKnight == null || placement == null}
          onClick={() => chosenKnight != null && placement != null && onConfirm(chosenKnight.targetSeat, chosenKnight.targetVertex, placement)}
        >
          {t('dialog.deserter.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Spy (C6.5): pick a target seat, then a REAL card (peek reveal fix, redact.ts hidden-info UX).
// Two-step: picking a seat dispatches `peekSpyTarget` (`onBeginPeek`) — the engine snapshots that
// seat's real hand into `ext.citiesKnights.spyPeek[me]` and `redact.ts` reveals ONLY that entry back
// to this viewer; once `peek` (the caller's live `ck.spyPeek`) round-trips and matches the chosen
// seat, the real card names render and a click commits via `playProgressCard{card:'spy', targetSeat,
// targetCard}` (`onConfirm`, unchanged engine-side — it already accepted a real `targetCard`, T-806's
// note about "back-compat with bots/tests" is now also the human path). While the round-trip is in
// flight (or before any seat is chosen), cards are unknown and a "peeking…" placeholder shows instead
// of ever falling back to the old blind "Card N" labels. `seatChoices` = seats with ≥1 card + their
// hand size (for the peeking-placeholder skeleton only — no positional dispatch happens anymore).
// ---------------------------------------------------------------------------------------------

export interface SpySeatChoice {
  seat: number;
  count: number;
  label: string;
  testid: string;
}

export interface SpyPeek {
  targetSeat: number;
  cards: ProgressCardId[];
}

export interface SpyDialogProps {
  open: boolean;
  seatChoices: SpySeatChoice[];
  /** The VIEWER's own pending peek (engine `peekSpyTarget` + redact.ts reveal), or `null` before a
   *  seat is chosen / while the round-trip is still in flight. */
  peek: SpyPeek | null;
  /** Dispatches `peekSpyTarget` for the chosen seat — fired the instant a seat button is clicked. */
  onBeginPeek: (targetSeat: number) => void;
  onConfirm: (targetSeat: number, targetCard: ProgressCardId) => void;
  onClose: () => void;
}

export function SpyDialog({ open, seatChoices, peek, onBeginPeek, onConfirm, onClose }: SpyDialogProps) {
  const { t } = useTranslation(['citiesKnights']);
  const [seatIdx, setSeatIdx] = useState<number | null>(null);
  const [cardIdx, setCardIdx] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setSeatIdx(null);
      setCardIdx(null);
    }
  }, [open]);

  const chosenSeat = seatIdx != null ? seatChoices[seatIdx] : undefined;
  // Only trust `peek` once it names the CURRENTLY-selected seat — a peek left over from a previous
  // selection (or a race with a stale response) must never be shown as if it belonged to this pick.
  const revealed = chosenSeat != null && peek != null && peek.targetSeat === chosenSeat.seat ? peek.cards : null;

  function pickSeat(i: number) {
    setSeatIdx(i);
    setCardIdx(null);
    const seat = seatChoices[i];
    if (seat) onBeginPeek(seat.seat);
  }

  return (
    <Modal open={open} onClose={onClose} title={t('dialog.spy.title')}>
      <div className="flex flex-col gap-4" data-testid="ck-spy-dialog">
        <p className="font-ui text-14 text-ink-soft">{t('dialog.spy.instructions')}</p>
        <section>
          <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('dialog.spy.seatLabel')}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dialog.spy.seatLabel')}>
            {seatChoices.map((s, i) => {
              const selected = seatIdx === i;
              return (
                <button
                  key={s.testid}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-testid={s.testid}
                  onClick={() => pickSeat(i)}
                  className={[
                    'rounded-card border px-3 py-2 font-ui text-14 cursor-pointer',
                    selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                  ].join(' ')}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </section>
        {chosenSeat != null ? (
          <section>
            <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{t('dialog.spy.cardLabel')}</p>
            {revealed == null ? (
              <p className="font-ui text-12 text-ink-soft" data-testid="ck-spy-peeking">
                {t('dialog.spy.peeking')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('dialog.spy.cardLabel')}>
                {revealed.map((card, i) => {
                  const selected = cardIdx === i;
                  return (
                    <button
                      key={`${card}-${i}`}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      data-testid={`ck-spy-card-${i}`}
                      onClick={() => setCardIdx(i)}
                      className={[
                        'rounded-card border px-3 py-2 font-ui text-14 cursor-pointer',
                        selected ? 'border-accent bg-accent/10' : 'border-panel-edge',
                      ].join(' ')}
                    >
                      {t(`card.${card}.name`)}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}
        <Button
          data-testid="ck-spy-confirm"
          disabled={chosenSeat == null || revealed == null || cardIdx == null}
          onClick={() =>
            chosenSeat != null && revealed != null && cardIdx != null && onConfirm(chosenSeat.seat, revealed[cardIdx]!)
          }
        >
          {t('dialog.spy.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
