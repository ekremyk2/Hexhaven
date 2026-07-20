// OfferBuilder (T-404 requirement 2): the turn owner's domestic-trade surface. Renders one of two
// things depending on `view.trade` (never both): while no offer is open, `OfferForm` — two bundle
// steppers (give from the owner's own hand only / receive) with ER-4 violations blocked inline; once
// `offerTrade` opens one, `TradeResponseTracker` — a per-opponent pending/accepted/declined readout
// with a "Complete with…" button per accepter and a Cancel button. Sending a replacement offer while
// one is already open (`offerTrade` again) resets the tracker to the new offer once the view updates
// — no extra client-side state needed, since which one renders is derived straight from `view.trade`.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OwnPlayerView, PlayerView } from '@hexhaven/engine';
import { hasAtLeast } from '@hexhaven/shared';
import type { Action, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import { Badge, Button } from '../ui';
import { FOCUS_RING_CLASS } from '../ui/constants';
import { RESOURCE_ORDER } from '../hud/constants';
import { ARROW_GLYPH, ResourceBundleIcons, ResourceIcon } from './ResourceIcon';
import { respondingSeats, validateOffer } from './rates';

// Stepper button glyphs — plain constants (not i18n keys), same rationale as `ARROW_GLYPH`
// (ResourceIcon.tsx): punctuation, not copy, referenced as `{EXPRESSION}` so the i18n-guard lint
// rule (docs/05 §7, which only flags literal JSX text nodes) doesn't apply.
const MINUS_GLYPH = '−';
const PLUS_GLYPH = '+';

// ---- Bundle stepper (shared by the give/receive sides) -----------------------------------------

interface BundleStepperProps {
  label: string;
  bundle: ResourceBundle;
  onChange: (bundle: ResourceBundle) => void;
  max: (resource: ResourceType) => number;
  testidPrefix: string;
  /** Give side: show the seat's held count under each resource ("x / held") so the player can see
   * what they actually have to offer (the receive side has no "held" concept). */
  showHeld?: boolean;
}

/** Receive side has no real hand to cap against — a generous ceiling keeps the stepper usable
 * without pretending any particular number is a rule (docs/01 R8.1 doesn't cap the ask side). */
const RECEIVE_STEP_MAX = 10;

/** Compact square step button (−/+) — the full-padding `Button` primitive is too wide for a 5-across
 *  stepper grid (playtest: "the trade menu doesn't fit in a line"), so the give/receive steppers use
 *  this small fixed-size control instead. Keeps aria-label / data-testid / disabled + the focus ring. */
function StepButton({ label, testid, disabled, onClick, glyph }: { label: string; testid: string; disabled: boolean; onClick: () => void; glyph: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex h-7 w-7 items-center justify-center rounded-button border border-panel-edge font-ui text-16 leading-none text-ink',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-panel-edge',
        FOCUS_RING_CLASS,
      ].join(' ')}
    >
      {glyph}
    </button>
  );
}

function BundleStepper({ label, bundle, onChange, max, testidPrefix, showHeld = false }: BundleStepperProps) {
  return (
    <section>
      <p className="mb-2 font-ui text-12 font-semibold uppercase text-ink-soft">{label}</p>
      {/* 5 fixed columns so the resources always fit one line at any modal/bottom-sheet width; the
          stepper stacks vertically (icon+count over a small −/+ row) to stay narrow. */}
      <div className="grid grid-cols-5 gap-1.5">
        {RESOURCE_ORDER.map((resource) => {
          const count = bundle[resource] ?? 0;
          const cap = max(resource);
          return (
            <div
              key={resource}
              className="flex min-w-0 flex-col items-center gap-1 rounded-card border border-panel-edge p-1.5"
              data-testid={`${testidPrefix}-${resource}`}
            >
              <ResourceIcon resource={resource} count={count} />
              {showHeld ? (
                <span className="font-ui text-10 text-ink-soft" data-testid={`${testidPrefix}-${resource}-held`}>
                  {`/${cap}`}
                </span>
              ) : null}
              <div className="flex items-center gap-1">
                <StepButton
                  label={`-1 ${resource}`}
                  testid={`${testidPrefix}-${resource}-minus`}
                  disabled={count <= 0}
                  glyph={MINUS_GLYPH}
                  onClick={() => onChange({ ...bundle, [resource]: count - 1 <= 0 ? undefined : count - 1 })}
                />
                <StepButton
                  label={`+1 ${resource}`}
                  testid={`${testidPrefix}-${resource}-plus`}
                  disabled={count >= cap}
                  glyph={PLUS_GLYPH}
                  onClick={() => onChange({ ...bundle, [resource]: count + 1 })}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- Builder form (task requirement 2, no open offer) -------------------------------------------

export interface OfferFormProps {
  own: OwnPlayerView;
  dispatch: (action: Action) => void;
}

export function OfferForm({ own, dispatch }: OfferFormProps) {
  const { t } = useTranslation('trade');
  const [give, setGive] = useState<ResourceBundle>({});
  const [receive, setReceive] = useState<ResourceBundle>({});

  const reason = validateOffer(give, receive, own.resources);
  const touched = Object.values(give).some((n) => (n ?? 0) > 0) || Object.values(receive).some((n) => (n ?? 0) > 0);

  function send() {
    if (reason != null) return;
    dispatch({ type: 'offerTrade', give, receive });
    setGive({});
    setReceive({});
  }

  return (
    <div className="flex flex-col gap-4" data-testid="offer-builder-form">
      <BundleStepper
        label={t('form.giveLabel')}
        bundle={give}
        onChange={setGive}
        max={(resource) => own.resources[resource]}
        testidPrefix="offer-give"
        showHeld
      />
      <BundleStepper
        label={t('form.receiveLabel')}
        bundle={receive}
        onChange={setReceive}
        max={() => RECEIVE_STEP_MAX}
        testidPrefix="offer-receive"
      />
      {/* Reserve a fixed-height slot for the block reason so it appearing/disappearing never shifts
          the Send button (playtest: "the error changes the buttons position"). */}
      <p className="min-h-[1.25rem] font-ui text-12 text-danger" role="alert" data-testid="offer-block-reason">
        {reason != null && touched ? t(`form.blocked.${reason}`) : ''}
      </p>
      <Button data-testid="offer-send" disabled={reason != null} onClick={send}>
        {t('form.send')}
      </Button>
    </div>
  );
}

// ---- Response tracker (task requirement 2, offer open) -------------------------------------------

export interface TradeResponseTrackerProps {
  trade: NonNullable<PlayerView['trade']>;
  own: OwnPlayerView;
  opponentSeats: Seat[];
  opponentName: (seat: Seat) => string;
  dispatch: (action: Action) => void;
}

export function TradeResponseTracker({ trade, own, opponentSeats, opponentName, dispatch }: TradeResponseTrackerProps) {
  const { t } = useTranslation('trade');
  // The owner's own hand is always fully known (docs/02 §6) — an accepter's may have changed since
  // they responded, so `confirmTrade` re-verifies that side server-side (task requirement 5: a
  // CANT_AFFORD there surfaces as a toast without closing this tracker, since `view.trade` stays
  // open until an actual confirm succeeds).
  const canAffordGive = hasAtLeast(own.resources, trade.give);

  return (
    <div className="flex flex-col gap-3" data-testid="trade-tracker">
      <div className="flex flex-wrap items-center gap-2 font-ui text-14 text-ink">
        <ResourceBundleIcons bundle={trade.give} />
        <span aria-hidden="true">{ARROW_GLYPH}</span>
        <ResourceBundleIcons bundle={trade.receive} />
      </div>

      <ul className="flex flex-col gap-2">
        {opponentSeats.map((seat) => {
          const response = trade.responses[seat];
          const statusKey = response === 'accepted' ? 'tracker.accepted' : response === 'declined' ? 'tracker.declined' : 'tracker.pending';
          const statusVariant = response === 'accepted' ? 'gold' : response === 'declined' ? 'danger' : 'default';
          return (
            <li
              key={seat}
              className="flex items-center justify-between gap-3 rounded-card border border-panel-edge p-2"
              data-testid={`trade-tracker-seat-${seat}`}
            >
              <span className="font-ui text-14 font-medium text-ink">{opponentName(seat)}</span>
              <span className="flex items-center gap-2">
                <Badge variant={statusVariant} data-testid={`trade-tracker-status-${seat}`}>
                  {t(statusKey)}
                </Badge>
                {response === 'accepted' ? (
                  <Button
                    size="sm"
                    data-testid={`trade-tracker-confirm-${seat}`}
                    disabled={!canAffordGive}
                    onClick={() => dispatch({ type: 'confirmTrade', with: seat })}
                  >
                    {t('tracker.completeWith', { name: opponentName(seat) })}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      <Button variant="danger" size="sm" data-testid="trade-tracker-cancel" onClick={() => dispatch({ type: 'cancelTrade' })}>
        {t('tracker.cancel')}
      </Button>
    </div>
  );
}

// ---- Composed export (this is what mounts) -------------------------------------------------------

export interface OfferBuilderProps {
  view: PlayerView;
  own: OwnPlayerView;
  mySeat: Seat;
  opponentName: (seat: Seat) => string;
  dispatch: (action: Action) => void;
}

/** Picks builder vs. tracker purely from `view.trade` — this component itself carries no offer
 * state, so a replaced offer (a second `offerTrade` while one is already open, ER-11-adjacent) just
 * re-renders the tracker against the new `view.trade` once it arrives (task requirement 2: "replace-
 * offer resets tracker"). */
export function OfferBuilder({ view, own, mySeat, opponentName, dispatch }: OfferBuilderProps) {
  if (view.trade != null) {
    return (
      <TradeResponseTracker
        trade={view.trade}
        own={own}
        opponentSeats={respondingSeats(view, mySeat)}
        opponentName={opponentName}
        dispatch={dispatch}
      />
    );
  }
  return <OfferForm own={own} dispatch={dispatch} />;
}
