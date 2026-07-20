// Progress-card hand panel (T-806 Priority 3; board-click targeting follow-up, Phase-9): shows the
// viewer's own `ownProgressHand` (count + cards) and plays one via `playProgressCard`. Timing
// (C6.4): every card except Alchemist is playable only in `main` (after rolling); Alchemist is
// `preRoll` + not yet rolled.
//
// All 25 distinct cards are now wired. Play routing:
//   • 7 zero-param cards dispatch immediately (irrigation, mining, smith, warlord, roadBuilding,
//     saboteur, wedding).
//   • 8 board-target cards (engineer/medicine/merchant/bishop/inventor/deserter/diplomat/intrigue)
//     enter a dedicated `store/uiMode.ts` board-pick mode instead of opening a list dialog — the
//     board highlights the card's legal targets (reusing the exact enumerators the old list dialogs
//     were built from) and a click dispatches `playProgressCard` directly. Inventor (two DISTINCT
//     hexes) and Deserter (an opponent's knight vertex, then the seat's own placement vertex) are
//     two-step, mirroring `movingKnight`'s board-driven step-1/step-2 shape via `game.
//     progressCardStep1` (no dialog needed either way — every param for both is a board pick).
//   • The rest still open a param dialog (`ProgressCardDialogs.tsx`) for their non-board param(s):
//     Crane's track, the two Monopolies' resource/commodity, Alchemist's dice, Merchant Fleet/
//     Commercial Harbor's give/receive, Master Merchant's target seat, Spy's target seat + card
//     (peek reveal fix: picking a seat dispatches `peekSpyTarget`, which reveals that seat's real
//     hand to ONLY this viewer via `ck.spyPeek` — see `SpyDialog`'s own header comment).
// A target-requiring card whose legal-target list is empty shows a disabled Play + reason, so the UI
// never opens a dead-end dialog or enters a dead-end board-pick mode.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  diplomatOpenRoads,
  intrigueTargets,
  knightPlacementVertices,
  merchantHexes,
  wallEligibleCities,
} from '@hexhaven/engine';
import type { GameState, OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { Action, Commodity, ImprovementTrack, ProgressCardId, ResourceType, Seat } from '@hexhaven/shared';
import { Badge, Button, Tooltip } from '../ui';
import type { UiMode } from '../store/types';
import {
  AlchemistDialog,
  ChoicePickerDialog,
  CommercialHarborDialog,
  CommodityMonopolyDialog,
  CraneTrackDialog,
  MerchantFleetDialog,
  ResourceMonopolyDialog,
  SpyDialog,
  type Choice,
  type SpySeatChoice,
} from './ProgressCardDialogs';
import {
  bishopHexes,
  flattenKnights,
  inventorHexes,
  masterMerchantSeats,
  medicineVertices,
  spyTargetSeats,
  ckOf,
} from './ckHelpers';

export interface ProgressHandPanelProps {
  view: PlayerView;
  own: OwnPlayerView | undefined;
  mySeat: Seat;
  seatName: (seat: Seat) => string;
  dispatch: (action: Action) => void;
  /** Board-click targeting follow-up: the shared `store/uiMode.ts` mode + setter (mirrors
   *  `KnightControls`'s props exactly), so this panel can enter/leave a board-target mode instead
   *  of opening a list dialog for the 8 cards that have one. */
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
}

/** Cards whose effect takes no extra parameters — `playProgressCard({ card })` dispatches directly. */
const ZERO_PARAM_CARDS: readonly ProgressCardId[] = [
  'irrigation',
  'mining',
  'smith',
  'warlord',
  'roadBuilding',
  'saboteur',
  'wedding',
];

const REVEALED_CARDS: readonly ProgressCardId[] = ['printer', 'constitution'];

/** Board-target cards -> the `uiMode` their Play button enters (board-click targeting follow-up).
 *  Every param for all 8 of these comes from the board pick(s) alone — no dialog needed. */
const BOARD_TARGET_MODE: Partial<Record<ProgressCardId, UiMode>> = {
  engineer: 'ckPlayEngineer',
  medicine: 'ckPlayMedicine',
  merchant: 'ckPlayMerchant',
  bishop: 'ckPlayBishop',
  inventor: 'ckPlayInventor',
  diplomat: 'ckPlayDiplomat',
  intrigue: 'ckPlayIntrigue',
  deserter: 'ckPlayDeserter',
};

/** Reverse of `BOARD_TARGET_MODE` — which card (if any) the CURRENT `uiMode` is targeting, so the
 *  banner/cancel below can render while one of these 8 modes is active. */
const CARD_FOR_BOARD_MODE: Partial<Record<UiMode, ProgressCardId>> = Object.fromEntries(
  Object.entries(BOARD_TARGET_MODE).map(([card, mode]) => [mode as UiMode, card as ProgressCardId]),
);

/** Fixed resource cost gate (coordinator follow-up): a Play button must never be clickable when its
 *  card's card FIXED cost can't be paid — Medicine's 2 ore + 1 grain (C6.5) is the reported case, but
 *  the same discipline `ckActionLogic.ts`'s `compute*State` helpers already use for build buttons
 *  applies here too. Cards whose cost is a player CHOICE made inside the param dialog (Merchant
 *  Fleet's give/receive) get the weaker "could this possibly be completed at all" gate below instead
 *  — the exact resource isn't known until the dialog opens. */
const MEDICINE_COST: readonly (readonly ['ore' | 'grain', number])[] = [
  ['ore', 2],
  ['grain', 1],
];

export function ProgressHandPanel({ view, own, mySeat, seatName, dispatch, uiMode, setMode }: ProgressHandPanelProps) {
  const { t } = useTranslation(['citiesKnights', 'log']);
  const [dialogCard, setDialogCard] = useState<ProgressCardId | null>(null);

  const ck = ckOf(view);
  if (!ck || !own) return null;
  const state = view as unknown as GameState; // WIRE (store/uiMode.ts precedent) for engine enumerators.

  const hand = ck.ownProgressHand;
  const revealed = REVEALED_CARDS.filter((c) => ck.revealedProgress[c as 'printer' | 'constitution'] === mySeat);

  const isMain = view.phase.kind === 'main';
  const isAlchemistWindow = view.phase.kind === 'preRoll' && !view.turn.rolled;

  // ---- Per-card legal-target counts (computed once; hand is ≤4 so this is cheap). The 8
  // board-target cards only need the COUNT here (to gate the Play button) — the actual ids are
  // read straight off the board by `store/uiMode.ts`'s `computeUiTargets` once the mode is entered. ---
  const engineerCount = wallEligibleCities(state, mySeat).length;
  const medicineCount = medicineVertices(view, mySeat).length;
  const merchantCount = merchantHexes(state, mySeat).length;
  const bishopCount = bishopHexes(view).length;
  const inventorCount = inventorHexes(view).length;
  const diplomatCount = diplomatOpenRoads(state).length;
  const intrigueCount = intrigueTargets(state, mySeat).length;
  const deserterHasKnight = flattenKnights(view).some((k) => k.seat !== mySeat);
  const deserterHasPlacement = knightPlacementVertices(state, mySeat).length > 0;

  const masterMerchantChoices: Choice[] = masterMerchantSeats(view, mySeat).map((s) => ({
    value: s,
    label: seatName(s),
    testid: `ck-master-merchant-pick-${s}`,
  }));
  const spySeats: SpySeatChoice[] = spyTargetSeats(view, mySeat).map((s) => ({
    seat: s,
    count: ck.progressHandCounts[s] ?? 0,
    label: seatName(s),
    testid: `ck-spy-seat-${s}`,
  }));

  /** How many legal targets a target-requiring card has right now (for the Play-enabled gate);
   *  non-target cards return a sentinel so they never gate on this. */
  function targetCount(card: ProgressCardId): number {
    switch (card) {
      case 'engineer':
        return engineerCount;
      case 'medicine':
        return medicineCount;
      case 'merchant':
        return merchantCount;
      case 'bishop':
        return bishopCount;
      case 'inventor':
        return inventorCount >= 2 ? inventorCount : 0;
      case 'diplomat':
        return diplomatCount;
      case 'intrigue':
        return intrigueCount;
      case 'masterMerchant':
        return masterMerchantChoices.length;
      case 'deserter':
        return deserterHasKnight && deserterHasPlacement ? 1 : 0;
      case 'spy':
        return spySeats.length;
      default:
        return Number.POSITIVE_INFINITY;
    }
  }

  /** Medicine's fixed 2 ore + 1 grain (C6.5) — `null` if affordable, else the first shortage found
   *  (mirrors `ckActionLogic.ts`'s `computeBuildKnightState`'s sequential wool-then-ore check). */
  function medicineShortage(): { type: 'ore' | 'grain'; need: number; have: number } | null {
    for (const [type, need] of MEDICINE_COST) {
      const have = own!.resources[type];
      if (have < need) return { type, need, have };
    }
    return null;
  }

  /** Merchant Fleet's 2:1 trade cost is a resource/commodity CHOSEN inside the dialog, so the exact
   *  amount can't be pre-checked — but if the seat holds fewer than 2 of EVERY resource and commodity,
   *  no give choice could ever complete the trade, so the Play button should still be disabled rather
   *  than opening a dialog where every option fails on confirm. */
  function merchantFleetHasAnyGiveOption(): boolean {
    const commodities = ck!.commodities[mySeat];
    const hasCommodity = commodities != null && (commodities.paper >= 2 || commodities.cloth >= 2 || commodities.coin >= 2);
    return hasCommodity || Object.values(own!.resources).some((n) => n >= 2);
  }

  /** `null` = playable now; else the reason string it's blocked on. */
  function blockedReason(card: ProgressCardId): string | null {
    if (card === 'alchemist') return isAlchemistWindow ? null : t('progressHand.beforeRollOnly');
    if (!isMain) return t('progressHand.afterRollOnly');
    if (targetCount(card) <= 0) return t('reason.noLegalTargets');
    if (card === 'medicine') {
      const shortage = medicineShortage();
      if (shortage) {
        // Bug fix (same root cause as citiesKnights/KnightControls.tsx): `reason.cantAfford` already
        // supplies its own `{{need}}` count, so `type` must be the bare resource word
        // (`log:resourceName.*`) — the count-baked `log:resource.*` rendered "Need 2 2 ore…".
        return t('reason.cantAfford', {
          need: shortage.need,
          type: t(`log:resourceName.${shortage.type}`),
          have: shortage.have,
        });
      }
    }
    if (card === 'merchantFleet' && !merchantFleetHasAnyGiveOption()) {
      return t('reason.noLegalTargets');
    }
    return null;
  }

  function onPlay(card: ProgressCardId) {
    if (ZERO_PARAM_CARDS.includes(card)) {
      dispatch({ type: 'playProgressCard', card });
      return;
    }
    const boardMode = BOARD_TARGET_MODE[card];
    if (boardMode) {
      setMode(boardMode);
      return;
    }
    setDialogCard(card);
  }

  function playButton(card: ProgressCardId) {
    const reason = blockedReason(card);
    const button = (
      <Button
        data-testid={`ck-play-${card}`}
        size="sm"
        variant="subtle"
        disabled={reason != null}
        onClick={() => onPlay(card)}
      >
        {t('progressHand.play')}
      </Button>
    );
    return reason == null ? button : <Tooltip content={reason}>{button}</Tooltip>;
  }

  function closeDialog() {
    setDialogCard(null);
  }
  function play(action: Extract<Action, { type: 'playProgressCard' }>) {
    dispatch(action);
    setDialogCard(null);
  }

  // Board-click targeting follow-up: which card (if any) the board is currently targeting for.
  const activeBoardCard = CARD_FOR_BOARD_MODE[uiMode];

  return (
    <div className="hexhaven-panel flex flex-col gap-2 p-2" data-testid="ck-progress-hand-panel">
      <h3 className="font-ui text-12 font-semibold uppercase text-ink-soft">
        {t('progressHand.title')}
        {' '}
        <Badge data-testid="ck-progress-hand-count">{t('progressHand.count', { count: hand.length })}</Badge>
      </h3>

      {revealed.length > 0 ? (
        <p className="font-ui text-12 text-accent-gold" data-testid="ck-progress-hand-revealed">
          {t('progressHand.revealedLine', { names: revealed.map((c) => t(`card.${c}.name`)).join(', ') })}
        </p>
      ) : null}

      {hand.length === 0 ? (
        <p className="font-ui text-12 text-ink-soft" data-testid="ck-progress-hand-empty">
          {t('progressHand.empty')}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {hand.map((card, i) => (
            <div
              key={`${card}-${i}`}
              className="flex items-center justify-between gap-2 rounded-card border border-panel-edge p-2"
              data-testid={`ck-progress-card-${card}`}
            >
              <div>
                <p className="font-ui text-12 font-semibold text-ink">{t(`card.${card}.name`)}</p>
                <p className="max-w-[16rem] font-ui text-12 text-ink-soft">{t(`card.${card}.desc`)}</p>
              </div>
              {playButton(card)}
            </div>
          ))}
        </div>
      )}

      {/* Board-click targeting banner: shown while a `ckPlay*` mode is active (requirement: a clear
          banner + cancel, matching `KnightControls`'s two-step hint). Escape (handled globally by
          `useUiInteraction`) also cancels back to idle without spending the card. */}
      {activeBoardCard ? (
        <div
          className="flex flex-col gap-2 rounded-card border border-accent bg-accent/10 p-2"
          data-testid="ck-board-target-banner"
        >
          <p className="font-ui text-12 font-semibold text-ink">{t('progressHand.dialogPending')}</p>
          <p className="font-ui text-12 text-ink-soft">{t(`dialog.${activeBoardCard}.instructions`)}</p>
          <Button
            size="sm"
            variant="subtle"
            data-testid="ck-board-target-cancel"
            onClick={() => setMode('idle')}
          >
            {t('progressHand.cancel')}
          </Button>
        </div>
      ) : null}

      {/* ---- Param dialogs (only the active card's is open) — non-board-param cards only ------- */}
      <AlchemistDialog
        open={dialogCard === 'alchemist'}
        onClose={closeDialog}
        onConfirm={(yellowDie, redDie) => play({ type: 'playProgressCard', card: 'alchemist', yellowDie, redDie })}
      />
      <CraneTrackDialog
        open={dialogCard === 'crane'}
        onClose={closeDialog}
        onConfirm={(track: ImprovementTrack) => play({ type: 'playProgressCard', card: 'crane', track })}
      />
      <ResourceMonopolyDialog
        open={dialogCard === 'resourceMonopoly'}
        onClose={closeDialog}
        onConfirm={(resource: ResourceType) => play({ type: 'playProgressCard', card: 'resourceMonopoly', resource })}
      />
      <CommodityMonopolyDialog
        open={dialogCard === 'commodityMonopoly'}
        onClose={closeDialog}
        onConfirm={(commodity: Commodity) => play({ type: 'playProgressCard', card: 'commodityMonopoly', commodity })}
      />
      <ChoicePickerDialog
        open={dialogCard === 'masterMerchant'}
        testid="ck-master-merchant-dialog"
        title={t('dialog.masterMerchant.title')}
        instructions={t('dialog.masterMerchant.instructions')}
        confirmLabel={t('dialog.masterMerchant.confirm')}
        choices={masterMerchantChoices}
        onClose={closeDialog}
        onConfirm={(targetSeat) => play({ type: 'playProgressCard', card: 'masterMerchant', targetSeat: targetSeat as Seat })}
      />
      <MerchantFleetDialog
        open={dialogCard === 'merchantFleet'}
        onClose={closeDialog}
        onConfirm={(give, receive) => play({ type: 'playProgressCard', card: 'merchantFleet', give, receive })}
      />
      <CommercialHarborDialog
        open={dialogCard === 'commercialHarbor'}
        onClose={closeDialog}
        onConfirm={(resource, commodity) => play({ type: 'playProgressCard', card: 'commercialHarbor', resource, commodity })}
      />
      <SpyDialog
        open={dialogCard === 'spy'}
        seatChoices={spySeats}
        peek={ck.spyPeek}
        onBeginPeek={(targetSeat) => dispatch({ type: 'peekSpyTarget', targetSeat: targetSeat as Seat })}
        onClose={closeDialog}
        onConfirm={(targetSeat, targetCard) =>
          play({ type: 'playProgressCard', card: 'spy', targetSeat: targetSeat as Seat, targetCard })
        }
      />
    </div>
  );
}
