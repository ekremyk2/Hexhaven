// <RobberOverlay/> (T-405): the self-contained container for the full 7/Knight UX — discard modal,
// robber-hex placement (auto-enters T-304's `movingRobber` mode), steal picker, and redaction-
// aware toasts (ER-9/ER-10). No required props: it reads `PlayerView`/`uiMode` from the store
// itself and renders nothing at all outside the phases it owns. Mount it once, anywhere above the
// board (a fixed-position sibling is fine — `DiscardModal`/`StealPicker` are full-screen `Modal`s
// already), e.g. `apps/client/src/routes/Game.tsx`'s tree: `<RobberOverlay />` alongside
// `<BoardView>`.
//
// Store wiring only — this file is intentionally thin; every actual decision (open/closed, which
// toast variant, candidate lists) is computed by `robberLogic.ts`/`toastFormat.ts`'s pure
// functions, matching the `ActionBar.tsx`/`controls/actionBarLogic.ts` split (docs/12: effects
// don't run under this workspace's `renderToStaticMarkup` test render, so nothing worth asserting
// on lives directly in here — see `RobberOverlay`'s own file for what's NOT unit-tested and why).
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlayerView, ViewerEvent } from '@hexhaven/engine';
import type { HexPieceKindId, ResourceType, Seat } from '@hexhaven/shared';
import { RESOURCE_ORDER } from '../hud/constants';
import { useGameEvents, useGameView, useHexPieceTarget, useLobbyState, useStore, useUiMode } from '../store';
import { MoveRobberBanner, PendingDiscardBar, RobberPieceChooser } from './Banners';
import { DiscardModal } from './DiscardModal';
import { GoldDialog } from './GoldDialog';
import { StealPicker } from './StealPicker';
import {
  computeDiscardModalState,
  computeGoldDialogState,
  computeStealCandidates,
  type MoveTarget,
  movableTargets,
  pendingDiscardSeats,
  shouldAutoEnterMovingRobber,
} from './robberLogic';
import { planDiscardToast, planStealToast } from './toastFormat';

export function RobberOverlay() {
  // WIRE: T-204 — same cast `routes/Game.tsx`/`store/uiMode.ts` document: the wire-level
  // `PlayerView` type is still the `unknown` placeholder until that task's zod schema lands; this
  // is exactly what `game.started`/`game.events`/`game.sync` carry today (the engine's real
  // `redact()` output).
  const view = useGameView() as PlayerView | null;
  const events = useGameEvents() as ViewerEvent[];
  const lobby = useLobbyState();
  const uiMode = useUiMode();
  const hexPieceTarget = useHexPieceTarget();
  const setUiMode = useStore((s) => s.setUiMode);
  const setHexPieceTarget = useStore((s) => s.setHexPieceTarget);
  const sendAction = useStore((s) => s.sendAction);
  const pushToast = useStore((s) => s.pushToast);
  const { t } = useTranslation(['robber', 'game']);

  // How many of `events` (the store's ever-growing log, oldest first) this component has already
  // turned into a toast — never re-toast an event just because a re-render happened.
  const processedCount = useRef(0);

  const seatName = useCallback(
    (seat: Seat) => lobby.seats[seat]?.nickname ?? t('game:hud.player.seatFallback', { n: seat + 1 }),
    [lobby.seats, t],
  );

  const resourceLabel = useCallback((resource: ResourceType, count: number) => t(`robber:resource.${resource}`, { count }), [t]);

  useEffect(() => {
    if (!view) return;
    const mySeat = view.me;

    for (let i = processedCount.current; i < events.length; i += 1) {
      const ev = events[i];
      if (ev == null || typeof ev !== 'object' || !('type' in ev)) continue;

      if (ev.type === 'discarded') {
        const plan = planDiscardToast(ev, mySeat);
        if (plan.variant === 'self') {
          const list = RESOURCE_ORDER.filter((r) => (plan.cards[r] ?? 0) > 0)
            .map((r) => resourceLabel(r, plan.cards[r] ?? 0))
            .join(t('robber:toast.listSeparator'));
          pushToast({ kind: 'info', message: t('robber:toast.discardSelf', { resources: list }) });
        } else {
          pushToast({
            kind: 'info',
            message: t('robber:toast.discardOther', { name: seatName(plan.seat), count: plan.count }),
          });
        }
      } else if (ev.type === 'stolen') {
        const plan = planStealToast(ev, mySeat);
        if (plan.variant === 'thief') {
          pushToast({
            kind: 'info',
            message: t('robber:toast.stolenThief', {
              resource: resourceLabel(plan.card, 1),
              name: seatName(plan.victim),
            }),
          });
        } else if (plan.variant === 'victim') {
          pushToast({
            kind: 'info',
            message: t('robber:toast.stolenVictim', {
              name: seatName(plan.thief),
              resource: resourceLabel(plan.card, 1),
            }),
          });
        } else {
          pushToast({
            kind: 'info',
            message: t('robber:toast.stolenOthers', {
              name: seatName(plan.thief),
              victim: seatName(plan.victim),
            }),
          });
        }
      }
    }

    processedCount.current = events.length;
  }, [events, view, pushToast, t, seatName, resourceLabel]);

  // Requirement 2: silently enter T-304's `movingRobber` mode for the mover — no button, same
  // pattern as `ActionBar.tsx`'s setup-mode effect. In a Seafarers game the mover may switch the armed
  // target to the pirate (`movingPirate`, S8) via the chooser; with the T-902 hex-pieces modifier the
  // mover may switch it to the active hex piece (`movingHexPiece`) instead — don't override either choice.
  useEffect(() => {
    if (!view) return;
    const auto = shouldAutoEnterMovingRobber(view);
    const inMoveMode = uiMode === 'movingRobber' || uiMode === 'movingPirate' || uiMode === 'movingHexPiece';
    if (auto && !inMoveMode) {
      setUiMode('movingRobber');
    } else if (!auto && inMoveMode) {
      // EXIT once the moveRobber sub-phase is over (move done / not our turn). Without this the
      // effect only ever ENTERED, so `uiMode` stayed `movingRobber` after the move completed and the
      // "move the robber" banner got stuck on screen even though the robber had already moved
      // (user-reported). Resetting to idle here dismisses the banner as soon as the phase advances.
      setUiMode('idle');
    }
  }, [view, uiMode, setUiMode]);

  if (!view) return null;

  const discardState = computeDiscardModalState(view);
  const goldState = computeGoldDialogState(view);
  const pendingSeats = pendingDiscardSeats(view);
  const stealCandidates = computeStealCandidates(view);
  // T-903: a genuine N-way choice — the base robber, the Seafarers pirate (if this game has one),
  // and EVERY currently active hex-piece kind (any subset may coexist, docs/tasks/phase-9/
  // PICKS.md "standalone-selectable"). `movableTargets` returns just `['robber']` for a base game
  // (or one with neither Seafarers nor hexPieces active), in which case no chooser is shown at all
  // — just the plain `MoveRobberBanner`, exactly like before either modifier existed.
  const targets = movableTargets(view);
  const showChooser = targets.length > 1 && (uiMode === 'movingRobber' || uiMode === 'movingPirate' || uiMode === 'movingHexPiece');
  const armed: MoveTarget =
    uiMode === 'movingPirate'
      ? 'pirate'
      : uiMode === 'movingHexPiece'
        ? hexPieceTarget ?? targets.find((t): t is HexPieceKindId => t !== 'robber' && t !== 'pirate') ?? 'robber'
        : 'robber';

  const targetLabel = (target: MoveTarget): string =>
    target === 'robber'
      ? t('robber:movePirate.chooseRobber')
      : target === 'pirate'
        ? t('robber:movePirate.choosePirate')
        : t(`robber:moveHexPiece.kindName.${target}`);

  const bannerLabel =
    armed === 'robber'
      ? t('robber:moveRobber.banner')
      : armed === 'pirate'
        ? t('robber:movePirate.banner')
        : t('robber:moveHexPiece.banner', { name: targetLabel(armed) });

  const chooseTarget = (target: MoveTarget) => {
    if (target === 'robber') {
      setUiMode('movingRobber');
    } else if (target === 'pirate') {
      setUiMode('movingPirate');
    } else {
      // `setUiMode` clears `hexPieceTarget` as part of its own mode-change reset (gameSlice.ts), so
      // it must run FIRST — otherwise this call's own `setHexPieceTarget` would be wiped right back.
      setUiMode('movingHexPiece');
      setHexPieceTarget(target);
    }
  };

  const hasBanner = pendingSeats != null || showChooser || uiMode === 'movingRobber';

  return (
    <>
      {/* Priority 1/2 UI overhaul: these were plain in-flow divs before, which — mounted after a
          full-height, `overflow-hidden` game shell's footer (routes/Game.tsx/hotseat/HotseatPage.tsx)
          — could be clipped entirely rather than scrolled to. A single FIXED top-center overlay
          (below the header, above the board/HUD, under the toast/dice-overlay/modal layers per the
          stacking order) makes them always visible regardless of where the flex layout leaves room. */}
      {hasBanner ? (
        <div className="pointer-events-none fixed inset-x-0 top-16 z-20 flex flex-col items-center gap-2 px-4 md:top-20">
          {pendingSeats ? (
            <div className="pointer-events-auto">
              <PendingDiscardBar names={pendingSeats.map(seatName)} />
            </div>
          ) : null}
          {/* T-902/T-903: the N-way chooser whenever there's an actual choice (Seafarers pirate
              and/or any active hex piece alongside the robber); base game keeps the plain
              move-robber banner. */}
          {showChooser ? (
            <div className="pointer-events-auto">
              <RobberPieceChooser
                options={targets.map((target) => ({ target, label: targetLabel(target) }))}
                armed={armed}
                bannerLabel={bannerLabel}
                onChoose={(target) => chooseTarget(target as MoveTarget)}
              />
            </div>
          ) : uiMode === 'movingRobber' ? (
            <div className="pointer-events-auto">
              <MoveRobberBanner />
            </div>
          ) : null}
        </div>
      ) : null}

      <DiscardModal
        open={discardState.open}
        required={discardState.required}
        hand={discardState.hand}
        onConfirm={(cards) => sendAction({ type: 'discard', cards })}
      />

      {/* Seafarers gold fields (S9/ER-S7): blocking picker, like the discard modal. */}
      <GoldDialog
        open={goldState.open}
        required={goldState.required}
        bank={goldState.bank}
        onConfirm={(picks) => sendAction({ type: 'chooseGoldResource', picks })}
      />

      <StealPicker
        open={stealCandidates !== null}
        candidates={(stealCandidates ?? []).map((c) => ({
          seat: c.seat,
          name: seatName(c.seat),
          resourceCount: c.resourceCount,
        }))}
        onPick={(from) => sendAction({ type: 'steal', from })}
      />
    </>
  );
}
