// ActionBar (T-403 requirement 1/4/5): the bottom bar's turn-owner controls — roll, build road/
// settlement/city (entering the T-304 interaction layer's mode), buy dev card, end turn, and a
// disabled T-404 trade slot — plus the cost-reference popover and an optional countdown. Purely
// presentational (props in, `dispatch`/`setMode` callbacks out) like every other `src/hud/**`
// component: `routes/Game.tsx` is the one place that wires it to the store's `sendAction`/
// `setUiMode`, matching how `Hand`/`PlayerPanel`/`DicePanel` etc. are wired there already.
//
// T-603 adds the 5–6 extension's two extra-building turn-rule UIs (X12): the 2015 Special Building
// Phase (a build/buy + Pass bar for the current builder, a banner + queue for everyone else) and the
// 2022 Paired-Players partial turn (a distinct indicator + the restricted action matrix). Both are
// classified by the pure `turnRuleSituation()` helper; see `turnRuleUi.ts`.
//
// Out of scope (acceptance criteria): trade dialog internals (T-404), robber flows — discard/
// moveRobber/steal (T-405), dev-card play flows (T-406). While the viewer is the turn owner during
// one of those phases, or during any phase not this task's (`ended`), the bar collapses to a
// bare note — the PM's debug panel remains the only way to drive those until their tasks land.
import { cloneElement, useEffect } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { Action, Seat } from '@hexhaven/shared';
import { PLAYER_BADGES, PLAYER_COLORS } from '../board/palette';
import { isCitiesKnightsGame } from '../citiesKnights/ckHelpers';
import { phaseTextKey } from '../hud/phaseText';
import { Button, Tooltip } from '../ui';
import type { UiMode } from '../store/types';
import { DEFAULT_THEME_ID, themedPieceLabelKey, type ThemeId } from '../themes/themes';
import {
  autoSetupMode,
  computeBuildShipState,
  computeBuildState,
  computeBuyDevCardState,
  computeEndTurnState,
  computeMoveShipState,
  computeRollState,
  isSeafarersGame,
  toggleBuildMode,
  type BuildKind,
  type ControlState,
} from './actionBarLogic';
import { CostCardPopover } from './CostCard';
import { Countdown } from './Countdown';
import { turnRuleSituation } from './turnRuleUi';

const BUILD_KINDS: readonly BuildKind[] = ['road', 'settlement', 'city'];

export interface ActionBarProps {
  view: PlayerView;
  own: OwnPlayerView;
  mySeat: Seat;
  /** Display name of `view.turn.player` — used for the non-owner "waiting for X…" collapse. */
  turnPlayerName: string;
  /** Display name for ANY seat — needed for the SBP queue / paired-turn indicators. Falls back to a
   * "Seat N" label when omitted (older call sites / tests that don't exercise the 5–6 rules). */
  seatName?: (seat: Seat) => string;
  uiMode: UiMode;
  deadlines: { seat: Seat; deadline: number }[];
  dispatch: (action: Action) => void;
  setMode: (mode: UiMode) => void;
  /** Cosmetic theme (T-907 PM wiring): reskins the road/settlement/city build-button labels via the
   *  `themes` i18n namespace. Defaults to `classic` (identity), so an omitted prop is unchanged. */
  themeId?: ThemeId;
}

/** Colored shape-badge chips for a run of seats (SBP queue / paired indicator) — reuses the same
 * seat color + shape double-coding the board/HUD use (docs/11 §4). */
function SeatDots({ seats, seatName }: { seats: Seat[]; seatName: (seat: Seat) => string }) {
  return (
    <span className="inline-flex items-center gap-1" data-testid="turn-rule-seat-dots">
      {seats.map((s, i) => (
        <span
          key={`${s}-${i}`}
          aria-hidden="true"
          title={seatName(s)}
          className="text-14 leading-none"
          style={{ color: PLAYER_COLORS[s] }}
        >
          {PLAYER_BADGES[s]}
        </span>
      ))}
    </span>
  );
}

export function ActionBar({
  view,
  own,
  mySeat,
  turnPlayerName,
  seatName,
  uiMode,
  deadlines,
  dispatch,
  setMode,
  themeId = DEFAULT_THEME_ID,
}: ActionBarProps) {
  const { t } = useTranslation(['game', 'themes']);
  const phase = view.phase;
  const nameOf = seatName ?? ((s: Seat) => t('hud.player.seatFallback', { n: s + 1 }));
  const situation = turnRuleSituation(view, mySeat);
  const isOwner = view.turn.player === mySeat;
  const setupMode = isOwner && situation.kind === 'none' ? autoSetupMode(phase) : null;

  // Requirement 5: silently enter the T-304 mode for the acting seat during setup — no buttons.
  useEffect(() => {
    if (setupMode != null) setMode(setupMode);
  }, [setupMode, setMode]);

  function reasonText(state: ControlState): string {
    if (state.enabled || !state.reason) return '';
    if (state.reason === 'cantAfford') {
      return t('controls.reason.needResources', { list: formatMissing(state.missing ?? {}) });
    }
    return t(`controls.reason.${state.reason}`);
  }

  function formatMissing(missing: NonNullable<ControlState['missing']>): string {
    return (Object.entries(missing) as [keyof typeof missing, number][])
      .filter(([, need]) => (need ?? 0) > 0)
      .map(([res, need]) => t(`log:resource.${res}`, { count: need }))
      .join(t('controls.reason.listSeparator'));
  }

  function withOptionalTooltip(state: ControlState, node: ReactElement, block = false) {
    return state.enabled ? node : (
      <Tooltip content={reasonText(state)} block={block}>
        {node}
      </Tooltip>
    );
  }

  // T-907 PM wiring: under a non-classic theme, the build buttons show that theme's piece name
  // (e.g. "Outpost" instead of "Settlement") via the shared `themes` i18n namespace — `classic`
  // keeps the base `controls.build.<kind>` copy unchanged (identity theme, RK-13-style default).
  function buildLabel(kind: BuildKind): string {
    return themeId === 'classic' ? t(`controls.build.${kind}`) : t(themedPieceLabelKey(themeId, kind), { ns: 'themes' });
  }

  function buildButton(kind: BuildKind) {
    const state = computeBuildState(kind, view, mySeat);
    const active = uiMode === (kind === 'road' ? 'placingRoad' : kind === 'settlement' ? 'placingSettlement' : 'placingCity');
    const button = (
      <Button
        fullWidth
        data-testid={`action-build-${kind}`}
        variant={active ? 'primary' : 'subtle'}
        disabled={!state.enabled}
        onClick={() => setMode(toggleBuildMode(uiMode, kind))}
      >
        {buildLabel(kind)}
      </Button>
    );
    return cloneElement(withOptionalTooltip(state, button, true), { key: kind });
  }

  // Seafarers (T-705): "Build ship" / "Move ship" toggle the T-304 board modes, exactly like the
  // build buttons. Rendered only in a seafarers game (ships in play). Move-ship reflects the ≤1/turn
  // limit via its disabled reason ("Already moved").
  function shipButton(kind: 'buildShip' | 'moveShip') {
    const mode: UiMode = kind === 'buildShip' ? 'placingShip' : 'movingShip';
    const state =
      kind === 'buildShip' ? computeBuildShipState(view, mySeat) : computeMoveShipState(view, mySeat);
    const active = uiMode === mode;
    const button = (
      <Button
        fullWidth
        data-testid={`action-${kind === 'buildShip' ? 'build-ship' : 'move-ship'}`}
        variant={active ? 'primary' : 'subtle'}
        disabled={!state.enabled}
        onClick={() => setMode(active ? 'idle' : mode)}
      >
        {t(`controls.ship.${kind}`)}
      </Button>
    );
    return cloneElement(withOptionalTooltip(state, button, true), { key: kind });
  }

  function buyDevButton() {
    const devState = computeBuyDevCardState(view, mySeat);
    return withOptionalTooltip(
      devState,
      <Button
        fullWidth
        data-testid="action-buy-dev"
        variant="subtle"
        disabled={!devState.enabled}
        onClick={() => dispatch({ type: 'buyDevCard' })}
      >
        {t('controls.buyDevCard')}
      </Button>,
      true,
    );
  }

  // ---- 5–6 Special Building Phase (X12, 2015) --------------------------------------------------
  if (situation.kind === 'sbpBuilder') {
    return (
      <div className="flex w-full flex-col gap-2" data-testid="action-bar-sbp-builder">
        <p className="font-ui text-14 font-semibold text-ink">
          {t('controls.specialBuild.yourTurn')}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {BUILD_KINDS.map(buildButton)}
          {/* No dev-card deck in Cities & Knights (C11.1) — same gate as the main-phase bar. */}
          {isCitiesKnightsGame(view) ? null : buyDevButton()}
        </div>
        <Button
          fullWidth
          data-testid="action-pass-special-build"
          onClick={() => dispatch({ type: 'passSpecialBuild' })}
        >
          {t('controls.specialBuild.pass')}
        </Button>
      </div>
    );
  }

  if (situation.kind === 'sbpWaiting') {
    return (
      <div className="flex w-full flex-col items-center gap-1" data-testid="action-bar-sbp-waiting">
        <p className="font-ui text-14 italic text-ink-soft">
          {t('controls.specialBuild.waiting', { name: nameOf(situation.builder) })}
        </p>
        <div className="flex items-center gap-2">
          <SeatDots seats={[situation.builder, ...situation.queue]} seatName={nameOf} />
        </div>
      </div>
    );
  }

  // ---- 2022 Paired Players: viewer is a bystander during someone else's partial turn ----------
  if (situation.kind === 'pairedWaiting') {
    return (
      <div className="flex w-full items-center justify-center gap-2" data-testid="action-bar-paired-waiting">
        <SeatDots seats={[situation.builder]} seatName={nameOf} />
        <p className="font-ui text-14 italic text-ink-soft">
          {t('controls.pairedTurn.waiting', { name: nameOf(situation.builder) })}
        </p>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="flex w-full items-center justify-center" data-testid="action-bar">
        <p className="font-ui text-14 italic text-ink-soft">{t(phaseTextKey(phase), { name: turnPlayerName })}</p>
      </div>
    );
  }

  if (setupMode != null) {
    return (
      <div className="flex w-full items-center gap-3" data-testid="action-bar">
        <p className="font-ui text-14 font-semibold text-ink">
          {t(setupMode === 'placingSettlement' ? 'controls.setup.settlement' : 'controls.setup.road')}
        </p>
      </div>
    );
  }

  if (phase.kind !== 'preRoll' && phase.kind !== 'main') {
    return (
      <div className="flex w-full items-center justify-center" data-testid="action-bar">
        <p className="font-ui text-14 italic text-ink-soft">{t('controls.pendingOtherUi')}</p>
      </div>
    );
  }

  const isPaired = situation.kind === 'pairedPartial';
  const rollState = computeRollState(view);
  const endTurnState = computeEndTurnState(view);
  const myDeadline = deadlines.find((d) => d.seat === mySeat)?.deadline ?? null;

  return (
    <div className="flex w-full flex-col gap-2" data-testid="action-bar">
      {isPaired ? (
        // Requirement 4: a distinct "Paired turn" indicator so this reads as the paired player's
        // restricted partial turn, not a normal turn.
        <div
          className="flex items-center gap-2 rounded-card border border-accent-gold/60 bg-accent-gold/10 px-2 py-1"
          data-testid="paired-turn-indicator"
        >
          <SeatDots seats={[mySeat]} seatName={nameOf} />
          <p className="font-ui text-12 font-semibold text-ink">{t('controls.pairedTurn.indicator')}</p>
          <p className="font-ui text-12 text-ink-soft">{t('controls.pairedTurn.restrictions')}</p>
        </div>
      ) : null}

      {/* Row 1 — turn flow: Roll | End turn as equal halves. These are the two primary, mutually-
          exclusive phase actions, so they lead and are visually separated from the build/buy grid.
          On a paired partial turn there's no roll (X12), so End turn's flex-1 fills the row alone. */}
      <div className="flex items-stretch gap-2">
        {isPaired ? null : (
          <div className="flex-1">
            {rollState.enabled ? (
              <span className="flex animate-pulse motion-reduce:animate-none">
                <Button fullWidth data-testid="action-roll" onClick={() => dispatch({ type: 'rollDice' })}>
                  {t('controls.roll')}
                </Button>
              </span>
            ) : (
              <Button fullWidth data-testid="action-roll" variant="subtle" disabled>
                {t('controls.roll')}
              </Button>
            )}
          </div>
        )}
        <div className="flex-1">
          {withOptionalTooltip(
            endTurnState,
            <Button
              fullWidth
              data-testid="action-end-turn"
              disabled={!endTurnState.enabled}
              onClick={() => dispatch({ type: 'endTurn' })}
            >
              {isPaired ? t('controls.pairedTurn.end') : t('controls.endTurn')}
            </Button>,
            true,
          )}
        </div>
      </div>

      {/* Row 2 — build / buy actions in an aligned grid so they read as columns, not a ragged flow.
          Two columns keep the base game a tidy 2×2 (road/settlement/city/dev card) and a seafarers
          game a 3×2. Cities & Knights (T-806, C11.1) has no dev-card deck — progress cards replace
          it — so that cell is dropped there. */}
      <div className="grid grid-cols-2 gap-2">
        {BUILD_KINDS.map(buildButton)}
        {isSeafarersGame(view) ? shipButton('buildShip') : null}
        {isSeafarersGame(view) ? shipButton('moveShip') : null}
        {isCitiesKnightsGame(view) ? null : buyDevButton()}
      </div>

      {/* Row 3 — reference + timer, de-emphasised below the actions. */}
      <div className="flex items-center justify-between gap-2">
        <CostCardPopover own={own} triggerLabel={t('controls.costCard.trigger')} />
        <Countdown deadline={myDeadline} />
      </div>

      {/* Discoverability nudge (B-24 follow-up): while placing a road on a seafarers board, remind
          the player that sea routes are ships — the "I clicked the sea edge and it didn't work"
          confusion. Only shown in road mode so it isn't nagging otherwise. */}
      {isSeafarersGame(view) && uiMode === 'placingRoad' ? (
        <span className="font-ui text-12 italic text-ink-soft" data-testid="seafarers-road-hint">
          {t('controls.seafarersRoadHint')}
        </span>
      ) : null}

      {/* Blocks end-turn while a trade is open (ER-11); shown here since End turn moved up into
          row 1. TradePanel itself is mounted in Game.tsx (not here): ActionBar early-returns for a
          non-turn player, which would suppress the responder's incoming-offer card (B-20). */}
      {view.trade != null ? (
        <p className="font-ui text-12 text-danger" data-testid="action-end-turn-trade-warning">
          {t('controls.endTurnTradeWarning')}
        </p>
      ) : null}
    </div>
  );
}
