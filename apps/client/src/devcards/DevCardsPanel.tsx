// <DevCardsPanel/> (T-406): the self-contained container for the viewer's OWN dev-card hand and
// the four "play" flows (Knight, Road Building, Year of Plenty, Monopoly — Victory Point cards are
// never played, R9.8). No required props — it reads `PlayerView`/lobby seat names straight from the
// store and dispatches via the store's `sendAction`, matching `trade/TradePanel.tsx`'s connected/
// presentational split: `DevCardsPanelView` below is the presentational half tests render directly
// against crafted `PlayerView`s; `DevCardsPanel` is the one-line drop the PM adds to
// `routes/Game.tsx` (e.g. next to `<Hand/>` in the footer, or replacing its dev-card section — the
// PM's call once this lands, out of this task's file allowlist).
//
// Knight/Road Building "hand off to existing flows" (this task's own scope note): playing either
// only ever DISPATCHES `playKnight`/`playRoadBuilding` here. Knight's aftermath (the phase flips to
// `moveRobber`) is entirely `robber/RobberOverlay.tsx`'s (T-405, already mounted in `Game.tsx`) — no
// coupling needed. Road Building's aftermath (the `roadBuilding` sub-phase's free placements) is
// NOT fully wired end-to-end yet: `store/uiMode.ts`'s `UiMode` union and `useUiInteraction`'s
// dispatch table have no `roadBuilding`/`placeFreeRoad` case, and `legal.ts` has no exported
// "legal free-road edges" enumerator for that phase (both packages/engine and store/uiMode.ts sit
// outside this task's `apps/client/src/devcards/**` allowlist). This panel dispatches
// `playRoadBuilding` and shows the progress banner reflecting `phase.remaining`; the board-click
// loop to actually place the free road(s) is a follow-up integration task — flagged in this task's
// Implementation notes.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { OwnPlayerView, PlayerView, ViewerEvent } from '@hexhaven/engine';
import type { Action, AnyDevCardId, CardModDevCardId, Seat } from '@hexhaven/shared';
import { LIMITLESS_CAP } from '@hexhaven/shared';
import { RESOURCE_GLYPH } from '../trade/ResourceIcon';
import { useGameEvents, useGameView, useLobbyState, useStore, useUiMode } from '../store';
import { Badge, Button, Tooltip } from '../ui';
import {
  computeDevPlayState,
  computeRoadBuildingBanner,
  groupDevCards,
  PLAYABLE_TYPES,
  resolveRoadBuildingCount,
  resolveYearOfPlentyCount,
  type DevPlayState,
  type PlayableDevCardType,
} from './devCardLogic';
import { planDevBoughtToast, planDevPlayedToast, planMonopolyToast } from './toastFormat';
import { MonopolyDialog } from './MonopolyDialog';
import { YearOfPlentyDialog } from './YearOfPlentyDialog';
// cardMods (Phase-9 play-UI follow-up, docs/tasks/FOLLOWUPS.md): the 6 curated new dev-card types
// mix straight into this same hand — `groupDevCards`'s `DISPLAY_ORDER` already lists them (T-904's
// own note there), this task just adds their Play buttons/dialogs.
import { MerchantsBoonDialog, ResourcePickDialog } from '../cardMods/CardModDialogs';
import { computeCardModCardPlayState, type CardModPlayReason, type CardModPlayState } from '../cardMods/cardModLogic';
import type { UiMode } from '../store/types';

// Requirement 2 (T-505): a suit-like emblem per dev-card type, purely decorative (`aria-hidden`) —
// same "glyph is not user-facing copy" precedent `hud/constants.ts`'s `RESOURCE_GLYPH` documents
// (docs/05 §7's i18n-guard only flags literal JSX text/string children, not glyph lookups like
// this one). Every accessible label sitting next to a glyph (name/desc/reason) is still translated.
const DEV_CARD_GLYPH: Record<AnyDevCardId, string> = {
  knight: '⚔️',
  roadBuilding: '🛤️',
  yearOfPlenty: '🌽',
  monopoly: '👑',
  victoryPoint: '⭐',
  bumperCrop: '🌾',
  merchantsBoon: '🤝',
  roadToll: '💰',
  trailblazer: '🧭',
  windfall: '🎁',
  highwayman: '🏹',
};

function isPlayableBaseType(type: AnyDevCardId): type is PlayableDevCardType {
  return (PLAYABLE_TYPES as readonly string[]).includes(type);
}

const ZERO_PARAM_CARD_MOD_CARDS: ReadonlySet<CardModDevCardId> = new Set(['bumperCrop', 'windfall']);
const CARD_MOD_CARD_IDS: ReadonlySet<CardModDevCardId> = new Set([
  'bumperCrop',
  'merchantsBoon',
  'roadToll',
  'trailblazer',
  'windfall',
  'highwayman',
]);

function isCardModCard(type: string): type is CardModDevCardId {
  return CARD_MOD_CARD_IDS.has(type as CardModDevCardId);
}

export interface DevCardsPanelViewProps {
  view: PlayerView;
  own: OwnPlayerView;
  mySeat: Seat;
  dispatch: (action: Action) => void;
  /** Board-click targeting follow-up: the shared `store/uiMode.ts` mode + setter (mirrors
   *  `citiesKnights/KnightControls.tsx`'s props) — Trailblazer/Highwayman enter a board-pick mode
   *  instead of opening a list dialog. */
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
}

const CARD_MOD_BOARD_MODE: Partial<Record<CardModDevCardId, UiMode>> = {
  trailblazer: 'cardModTrailblazer',
  highwayman: 'cardModHighwayman',
};

const CARD_MOD_FOR_BOARD_MODE: Partial<Record<UiMode, CardModDevCardId>> = Object.fromEntries(
  Object.entries(CARD_MOD_BOARD_MODE).map(([card, mode]) => [mode as UiMode, card as CardModDevCardId]),
);

export function DevCardsPanelView({ view, own, mySeat, dispatch, uiMode, setMode }: DevCardsPanelViewProps) {
  // 'cardMods' is a second namespace (not just `devcards`): the 6 new dev-card types' param dialogs
  // (merchantsBoon/roadToll/trailblazer/highwayman) share `cardMods/CardModDialogs.tsx`/i18n with
  // `CardModsComboPanel.tsx`'s combo dialogs, same "declare every ns this component reads" style
  // `DevCardsPanel`'s connected half below already uses (`useTranslation(['devcards', 'game'])`).
  const { t } = useTranslation(['devcards', 'cardMods']);
  const [yopOpen, setYopOpen] = useState(false);
  const [monopolyOpen, setMonopolyOpen] = useState(false);
  // cardMods (Phase-9 play-UI follow-up): which of the 6 new dev-card types currently has its param
  // dialog open, `null` when none — same one-dialog-at-a-time shape `ProgressHandPanel.tsx` uses.
  const [cardModDialog, setCardModDialog] = useState<CardModDevCardId | null>(null);
  // Requirement 3 (T-505, drag-and-drop): which card type is mid-drag, `null` when none — drives
  // the drop-target banner's visibility. Pointer-only, purely additive: nothing here replaces the
  // click-to-play path below, it just calls the SAME trigger functions the buttons call.
  const [draggingType, setDraggingType] = useState<AnyDevCardId | null>(null);

  const groups = groupDevCards(own, view.turn.number);
  const banner = computeRoadBuildingBanner(view, mySeat);

  function reasonText(reason: NonNullable<ReturnType<typeof computeDevPlayState>['reason']>): string {
    return t(`reason.${reason}`);
  }

  /** The ONE place a base dev card actually gets played from — both `playButtonFor`'s onClick and
   *  the drop-target's onDrop call this, so drag-and-drop can never diverge from click-to-play
   *  (task requirement 3(c)). `state` is passed in so callers reuse whichever `computeDevPlayState`
   *  call they already made rather than this recomputing it a second time. */
  function triggerDevPlay(type: PlayableDevCardType, state: DevPlayState) {
    if (!state.playable) return;
    if (type === 'knight') dispatch({ type: 'playKnight' });
    else if (type === 'roadBuilding') dispatch({ type: 'playRoadBuilding' });
    else if (type === 'yearOfPlenty') setYopOpen(true);
    else setMonopolyOpen(true);
  }

  function playButtonFor(type: PlayableDevCardType, state: DevPlayState) {
    const button = (
      <Button
        data-testid={`devcard-play-${type}`}
        variant="subtle"
        disabled={!state.playable}
        onClick={() => triggerDevPlay(type, state)}
      >
        {t('play')}
      </Button>
    );
    if (state.playable || !state.reason) return button;
    return <Tooltip content={reasonText(state.reason)}>{button}</Tooltip>;
  }

  function cardModReasonText(state: { reason?: CardModPlayReason; missing?: { type: string; need: number; have: number } }): string {
    if (state.reason === 'cantAfford' && state.missing) {
      return t('reason.cantAfford', { need: state.missing.need, have: state.missing.have });
    }
    return t(`reason.${state.reason === 'noLegalTargets' ? 'cannotPlay' : state.reason}`);
  }

  /** The cardMods twin of `triggerDevPlay` above — same "one trigger, two callers (button + drop
   *  zone)" discipline. `bumperCrop`/`windfall` dispatch immediately (no params); the rest open
   *  their param dialog / board-pick mode (`cardMods/CardModDialogs.tsx`). */
  function triggerCardModPlay(type: CardModDevCardId, state: CardModPlayState) {
    if (!state.playable) return;
    const boardMode = CARD_MOD_BOARD_MODE[type];
    if (ZERO_PARAM_CARD_MOD_CARDS.has(type)) dispatch({ type: 'playCardModCard', card: type });
    else if (boardMode) setMode(boardMode);
    else setCardModDialog(type);
  }

  /** Play buttons for the 6 curated new dev-card types (T-904): `bumperCrop`/`windfall` dispatch
   *  immediately (no params); the rest open their param dialog (`cardMods/CardModDialogs.tsx`).
   *  Coordinator follow-up: `computeCardModCardPlayState` now also gates on affordability/piece
   *  supply (Trailblazer/Merchant's Boon), so a disabled button here always carries a reason. */
  function cardModPlayButtonFor(type: CardModDevCardId, state: CardModPlayState) {
    const button = (
      <Button
        data-testid={`devcard-play-${type}`}
        variant="subtle"
        disabled={!state.playable}
        onClick={() => triggerCardModPlay(type, state)}
      >
        {t('play')}
      </Button>
    );
    if (state.playable || !state.reason) return button;
    return <Tooltip content={cardModReasonText(state)}>{button}</Tooltip>;
  }

  // Board-click targeting follow-up: which cardMods card (if any) the board is currently targeting.
  const activeBoardCard = CARD_MOD_FOR_BOARD_MODE[uiMode];

  /** Requirement 3: the drop target's onDrop — reads back the type `onDragStart` (below) stashed in
   *  `dataTransfer`, re-derives ITS OWN fresh play-state (state may have moved on since drag start),
   *  and calls the exact same trigger the Play button uses. Never invents a second play path. */
  function handleDropToPlay(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDraggingType(null);
    const type = e.dataTransfer.getData('text/plain') as AnyDevCardId | '';
    if (!type) return;
    if (isCardModCard(type)) triggerCardModPlay(type, computeCardModCardPlayState(view, mySeat, type));
    else if (isPlayableBaseType(type)) triggerDevPlay(type, computeDevPlayState(view, mySeat, type));
  }

  return (
    <div className="hexhaven-panel flex flex-col gap-3 p-3" data-testid="devcards-panel">
      <h3 className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('title')}</h3>

      {groups.length === 0 ? (
        <p className="font-ui text-12 text-ink-soft" data-testid="devcards-empty">
          {t('empty')}
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          {groups.map((group) => {
            // DISPLAY_ORDER (devCardLogic.ts) is PLAYABLE_TYPES + 'victoryPoint' + the 6 cardMods
            // types (T-904). `playState` is `null` for Victory Point (never played, R9.8 — no Play
            // button, never draggable); otherwise it's whichever `compute*PlayState` the button below
            // already needs, computed ONCE here and threaded through so the draggable attribute (req
            // 3b: "not playable => not draggable") and the button can never disagree about it.
            const playState = group.type === 'victoryPoint'
              ? null
              : isCardModCard(group.type)
                ? computeCardModCardPlayState(view, mySeat, group.type)
                : computeDevPlayState(view, mySeat, group.type as PlayableDevCardType);
            const draggable = playState?.playable ?? false;

            return (
              <div key={group.type} className="flex w-36 flex-col gap-1.5" data-testid={`devcard-group-${group.type}`}>
                {/* Requirement 2: the card face — a playing-card silhouette (rounded rect, border,
                    2-layer shadow — docs/11 §1) with a suit-like emblem, corner index badges (count/
                    NEW), and the name banner, legible in both themes via tokens only (no ad-hoc hex).
                    Requirement 3: also the drag SOURCE — `draggable` mirrors `playState.playable`
                    exactly, so an unplayable card (bought this turn, wrong phase, bank empty, ...)
                    can never be picked up, matching the Play button's own disabled state. */}
                <div
                  className={[
                    'relative flex flex-col overflow-hidden rounded-card border border-panel-edge bg-panel shadow-soft transition-[transform,opacity] duration-150',
                    draggable ? 'cursor-grab active:cursor-grabbing' : '',
                    draggingType === group.type ? 'opacity-40' : '',
                  ].filter(Boolean).join(' ')}
                  draggable={draggable}
                  onDragStart={(e) => {
                    if (!draggable) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData('text/plain', group.type);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingType(group.type);
                  }}
                  onDragEnd={() => setDraggingType(null)}
                >
                  <div className="absolute left-1.5 top-1.5">
                    {group.count > 1 ? <Badge data-testid={`devcard-count-${group.type}`}>{t('count', { count: group.count })}</Badge> : null}
                  </div>
                  {group.isNew ? (
                    <div className="absolute right-1.5 top-1.5">
                      <Badge variant="gold">{t('newBadge')}</Badge>
                    </div>
                  ) : null}
                  <div
                    className="flex flex-col items-center justify-center gap-1 px-2 pb-2 pt-6 text-center"
                    // Tailwind's color-opacity modifiers (`bg-accent/10`) need the base color defined
                    // as an "r g b" channel triplet (Tailwind docs' `rgb(var(--x) / <alpha-value>)`
                    // recipe); tailwind.config.js maps every token straight to `var(--x)` (a full CSS
                    // color, needed elsewhere for things like inline `style={{ color: ... }}` reads —
                    // see ResourceIcon.tsx), so `/NN` opacity suffixes on these custom tokens silently
                    // resolve to a NO-OP everywhere in this codebase (verified live: `.bg-accent\/10`
                    // has no generated rule at all, same for `.hover\:bg-panel-edge\/40` etc. — flagged
                    // as a follow-up, out of this task's scope to fix app-wide). `color-mix` sidesteps
                    // it for just this emblem wash while still deriving from the token, not ad-hoc hex.
                    style={{
                      backgroundColor: `color-mix(in srgb, var(${group.type === 'victoryPoint' ? '--accent-gold' : '--accent'}) 14%, transparent)`,
                    }}
                  >
                    <span aria-hidden="true" className="text-28 leading-none">
                      {DEV_CARD_GLYPH[group.type]}
                    </span>
                  </div>
                  <div className="border-t border-panel-edge px-2 py-1.5">
                    <span
                      className="block font-display text-12 font-semibold uppercase tracking-wide text-ink"
                      data-testid={`devcard-name-${group.type}`}
                    >
                      {t(`card.${group.type}`)}
                    </span>
                  </div>
                </div>

                {group.type === 'victoryPoint' ? (
                  <p className="font-ui text-12 italic text-ink-soft" data-testid="devcard-vp-hint">
                    {/* Reflects the resolved win target (customTargetVp / customConstants.targetVp,
                        written into config.targetVp at createGame), not a hardcoded 10 — B-43. An
                        "Unlimited" target (LIMITLESS_CAP sentinel) shows as ∞, not 100000. */}
                    {t('vpHint', { target: view.config.targetVp >= LIMITLESS_CAP ? '∞' : view.config.targetVp })}
                  </p>
                ) : (
                  <>
                    <p className="font-ui text-12 text-ink-soft" data-testid={`devcard-desc-${group.type}`}>
                      {/* The count-based descriptions reflect the customConstants overrides so the card
                          text matches what the engine actually does (B-43): Year of Plenty picks N, Road
                          Building N free roads. Other cards take no count param. */}
                      {group.type === 'roadBuilding'
                        ? t('desc.roadBuilding', { count: resolveRoadBuildingCount(view) })
                        : group.type === 'yearOfPlenty'
                          ? t('desc.yearOfPlenty', { count: resolveYearOfPlentyCount(view) })
                          : t(`desc.${group.type}`)}
                    </p>
                    {isCardModCard(group.type)
                      ? cardModPlayButtonFor(group.type, playState as CardModPlayState)
                      : playButtonFor(group.type as PlayableDevCardType, playState as DevPlayState)}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Requirement 3: the drop target — only rendered mid-drag (no permanent clutter in the
          panel), so it never competes for space with the Play buttons that stay the primary/AT
          path. `handleDropToPlay` re-derives fresh play-state and calls the same trigger the Play
          button uses — dropping an unplayable card here is impossible anyway since it was never
          draggable in the first place. */}
      {draggingType ? (
        <div
          data-testid="devcard-drop-zone"
          className="flex items-center justify-center rounded-card border-2 border-dashed border-accent px-3 py-3 font-ui text-12 font-semibold text-ink"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropToPlay}
        >
          {t('dropToPlay')}
        </div>
      ) : null}

      {banner ? (
        <div className="hexhaven-panel px-3 py-2 font-ui text-14 font-semibold text-ink" data-testid="road-building-banner">
          {t('roadBuilding.banner', { count: banner.remaining })}
        </div>
      ) : null}

      <YearOfPlentyDialog
        open={yopOpen}
        bank={view.bank}
        count={resolveYearOfPlentyCount(view)}
        onConfirm={(picks) => {
          // `picks` is always ≥1 long (`YearOfPlentyDialog`'s own `Math.max(1, count)`); `b` falls
          // back to `a` when the resolved count is 1 — the `playYearOfPlenty` action always needs
          // both fields, but a count of 1 means the engine only ever reads/charges `a` (devCards.ts's
          // `count <= 2` branch slices `[a, b]` down to `count`), so `b`'s fallback value is inert.
          const [a, b, ...extra] = picks;
          dispatch({ type: 'playYearOfPlenty', a: a!, b: b ?? a!, extra: extra.length > 0 ? extra : undefined });
          setYopOpen(false);
        }}
        onClose={() => setYopOpen(false)}
      />

      <MonopolyDialog
        open={monopolyOpen}
        onConfirm={(resource) => {
          dispatch({ type: 'playMonopoly', resource });
          setMonopolyOpen(false);
        }}
        onClose={() => setMonopolyOpen(false)}
      />

      {/* cardMods (T-904) param dialogs — only the active card's is open. */}
      <MerchantsBoonDialog
        open={cardModDialog === 'merchantsBoon'}
        onClose={() => setCardModDialog(null)}
        onConfirm={(give, receive) => {
          dispatch({ type: 'playCardModCard', card: 'merchantsBoon', give, receive });
          setCardModDialog(null);
        }}
      />
      <ResourcePickDialog
        open={cardModDialog === 'roadToll'}
        testid="cardmod-road-toll-dialog"
        titleKey="cardMods:dialog.roadToll.title"
        instructionsKey="cardMods:dialog.roadToll.instructions"
        confirmKey="cardMods:dialog.roadToll.confirm"
        onClose={() => setCardModDialog(null)}
        onConfirm={(resource) => {
          dispatch({ type: 'playCardModCard', card: 'roadToll', resource });
          setCardModDialog(null);
        }}
      />
      {/* Board-click targeting banner (Trailblazer/Highwayman), mirroring
          `ProgressHandPanel.tsx`'s banner exactly. */}
      {activeBoardCard ? (
        <div
          className="flex flex-col gap-2 rounded-card border border-accent bg-accent/10 p-2"
          data-testid="cardmod-board-target-banner"
        >
          <p className="font-ui text-12 font-semibold text-ink">{t('cardMods:dialog.boardTargetPending')}</p>
          <p className="font-ui text-12 text-ink-soft">{t(`cardMods:dialog.${activeBoardCard}.instructions`)}</p>
          <Button size="sm" variant="subtle" data-testid="cardmod-board-target-cancel" onClick={() => setMode('idle')}>
            {t('cardMods:dialog.boardTargetCancel')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function isOwnPlayerView(p: PlayerView['players'][number]): p is OwnPlayerView {
  return 'resources' in p;
}

/** Connected container — the one export the PM mounts (`<DevCardsPanel/>`, no props). Renders
 * nothing before a game view and the viewer's own seat/hand within it are both available, matching
 * `trade/TradePanel.tsx`'s precedent exactly. */
export function DevCardsPanel() {
  const { t } = useTranslation(['devcards', 'game']);
  // WIRE: T-204 — same cast `routes/Game.tsx`/`trade/TradePanel.tsx`/`robber/RobberOverlay.tsx`
  // document: the wire-level `PlayerView` type is still the `unknown` placeholder until that task's
  // zod schema lands; this is exactly what `game.started`/`game.events`/`game.sync` carry today.
  const view = useGameView() as PlayerView | null;
  const events = useGameEvents() as ViewerEvent[];
  const lobby = useLobbyState();
  const sendAction = useStore((s) => s.sendAction);
  const pushToast = useStore((s) => s.pushToast);
  const uiMode = useUiMode();
  const setUiMode = useStore((s) => s.setUiMode);
  const mySeat = lobby.mySeat;

  // How many of `events` (the store's ever-growing log, oldest first) this component has already
  // turned into a toast — never re-toast an event just because a re-render happened (same pattern
  // as `robber/RobberOverlay.tsx`'s `processedCount`).
  const processedCount = useRef(0);

  const seatName = useCallback(
    (seat: Seat) => lobby.seats[seat]?.nickname ?? t('game:hud.player.seatFallback', { n: seat + 1 }),
    [lobby.seats, t],
  );

  useEffect(() => {
    if (mySeat == null) return;

    for (let i = processedCount.current; i < events.length; i += 1) {
      const ev = events[i];
      if (ev == null || typeof ev !== 'object' || !('type' in ev)) continue;

      if (ev.type === 'devPlayed') {
        const plan = planDevPlayedToast(ev, mySeat);
        if (plan) {
          pushToast({
            kind: 'info',
            message: t('devcards:toast.playedOther', { name: seatName(plan.seat), card: t(`devcards:card.${plan.card}`) }),
          });
        }
      } else if (ev.type === 'devBought') {
        const plan = planDevBoughtToast(ev, mySeat);
        if (plan) {
          pushToast({ kind: 'info', message: t('devcards:toast.boughtOther', { name: seatName(plan.seat) }) });
        }
      } else if (ev.type === 'monopolyResolved') {
        const plan = planMonopolyToast(ev, mySeat);
        const breakdown = plan.breakdown
          .map((entry) => t('devcards:toast.breakdownEntry', { name: seatName(entry.seat), count: entry.count }))
          .join(t('devcards:toast.listSeparator'));
        const glyph = RESOURCE_GLYPH[plan.resource];
        const message =
          plan.variant === 'self'
            ? t('devcards:toast.monopolySelf', { total: plan.total, glyph, breakdown })
            : t('devcards:toast.monopolyOther', { name: seatName(plan.seat), total: plan.total, glyph, breakdown });
        pushToast({ kind: 'info', message });
      }
    }

    processedCount.current = events.length;
  }, [events, mySeat, pushToast, t, seatName]);

  if (!view || mySeat == null) return null;
  const own = view.players.find((p) => p.seat === mySeat && isOwnPlayerView(p)) as OwnPlayerView | undefined;
  if (!own) return null;

  return (
    <DevCardsPanelView view={view} own={own} mySeat={mySeat} dispatch={sendAction} uiMode={uiMode} setMode={setUiMode} />
  );
}
