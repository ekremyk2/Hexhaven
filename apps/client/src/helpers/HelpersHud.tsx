// HelpersHud (Phase-9 play-UI follow-up, docs/tasks/FOLLOWUPS.md): "The Helpers of Hexhaven" modifier's
// in-game surface — every seat's currently-held helper (public, research §3), a "Use" control for
// the VIEWER's own helper (one of the 9 actively-triggered abilities — General is fully reactive, no
// action exists for it), and a "Swap" control. Mirrors `citiesKnights/CitiesKnightsHud.tsx`'s mount
// shape (a self-contained sidebar panel taking `view`/`seatName`/`dispatch`) and
// `ProgressHandPanel.tsx`'s "list + Play opens a param dialog" pattern. Gated on `view.ext?.helpers`
// (present only once BOTH the `helpers` modifier is active AND this task's `redact.ts` fix has
// shipped — see that fix's header for why it was previously always `undefined`).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import type { Action, EdgeId, HelperId, ResourceType, Seat } from '@hexhaven/shared';
import { Badge, Button, NameDesc, Tooltip } from '../ui';
import { HelperIcon } from './HelperIcon';
import type { UiMode } from '../store/types';
import {
  assignmentOf,
  canSwap,
  helperUseState,
  helpersOf,
  noblewomanTargets,
  priestBuildState,
  roadTargetChoices,
  robberBrideTargets,
  type HelperUseState,
} from './helpersLogic';
import {
  ArchitectDialog,
  ChoicePickerDialog,
  MendicantDialog,
  MerchantDialog,
  RobberBrideDialog,
  SingleResourceDialog,
  SwapDialog,
  type Choice,
} from './HelperDialogs';

export interface HelpersHudProps {
  view: PlayerView;
  mySeat: Seat;
  seatName: (seat: Seat) => string;
  dispatch: (action: Action) => void;
  /** Board-click targeting follow-up: the shared `store/uiMode.ts` mode + setter (mirrors
   *  `citiesKnights/KnightControls.tsx`'s props) — Explorer (two-step edge->edge) and Priest's two
   *  build kinds (single-step vertex each) enter a board-pick mode instead of opening a dialog. */
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
}

type DialogState = HelperId | 'swap' | null;

const BOARD_MODE_BY_HELPER_ID: Partial<Record<HelperId, UiMode>> = { explorer: 'helperExplorer' };

export function HelpersHud({ view, mySeat, seatName, dispatch, uiMode, setMode }: HelpersHudProps) {
  const { t } = useTranslation(['helpers', 'log']);
  const [dialog, setDialog] = useState<DialogState>(null);

  const ext = helpersOf(view);
  if (!ext) return null;

  const mine = assignmentOf(view, mySeat);

  function close() {
    setDialog(null);
  }

  function reasonText(state: HelperUseState): string {
    if (state.reason === 'cantAfford' && state.missing) {
      // Bug fix (same root cause as citiesKnights/KnightControls.tsx): `reason.cantAfford` already
      // supplies its own `{{need}}` count, so `type` must be the bare resource word
      // (`log:resourceName.*`) — the count-baked `log:resource.*` rendered "Need 1 1 grain…".
      return t('reason.cantAfford', {
        need: state.missing.need,
        type: t(`log:resourceName.${state.missing.type}`),
        have: state.missing.have,
      });
    }
    return t(`reason.${state.reason}`);
  }

  /** Priest's build choice (board-click targeting follow-up): two dedicated board-pick buttons
   *  (settlement/city), each individually gated by `priestBuildState`'s target+cost check, instead
   *  of one "Use" button opening a build-kind-then-vertex dialog. */
  function priestButtons() {
    function button(build: 'settlement' | 'city') {
      const state = priestBuildState(view, mySeat, build);
      const mode: UiMode = build === 'settlement' ? 'helperPriestSettlement' : 'helperPriestCity';
      const active = uiMode === mode;
      const btn = (
        <Button
          data-testid={`helper-priest-build-${build}`}
          size="sm"
          variant={active ? 'primary' : 'subtle'}
          disabled={!state.playable}
          onClick={() => (state.playable ? setMode(active ? 'idle' : mode) : undefined)}
        >
          {t(build === 'settlement' ? 'dialog.priest.buildSettlement' : 'dialog.priest.buildCity')}
        </Button>
      );
      return state.playable || !state.reason ? btn : <Tooltip content={reasonText(state)}>{btn}</Tooltip>;
    }
    return (
      <div className="flex gap-2">
        {button('settlement')}
        {button('city')}
      </div>
    );
  }

  function useButton() {
    if (!mine) return null;
    if (mine.id === 'general') {
      return (
        <span className="font-ui text-12 italic text-ink-soft" data-testid="helper-auto-note">
          {t('hud.auto')}
        </span>
      );
    }
    // Board-click targeting follow-up: Priest gets two dedicated buttons instead of one "Use".
    if (mine.id === 'priest') return priestButtons();

    const state = helperUseState(view, mySeat, mine.id);
    const boardMode = BOARD_MODE_BY_HELPER_ID[mine.id];
    const button = (
      <Button
        data-testid={`helper-use-${mine.id}`}
        size="sm"
        variant="subtle"
        disabled={!state.playable}
        onClick={() => {
          if (!state.playable) return;
          if (mine.id === 'robberBride' && robberBrideTargets(view, mySeat).length === 0) {
            dispatch({ type: 'useHelper', helper: 'robberBride' });
            return;
          }
          if (boardMode) setMode(boardMode);
          else setDialog(mine.id);
        }}
      >
        {t('hud.use')}
      </Button>
    );
    return state.playable || !state.reason ? button : <Tooltip content={reasonText(state)}>{button}</Tooltip>;
  }

  function swapButton() {
    if (ext == null) return null;
    const enabled = canSwap(view, mySeat) && ext.display.length > 0;
    const button = (
      <Button data-testid="helper-swap" size="sm" variant="subtle" disabled={!enabled} onClick={() => enabled && setDialog('swap')}>
        {t('hud.swap')}
      </Button>
    );
    return button;
  }

  const edgeChoice = (id: number): Choice => ({ value: id, label: t('dialog.edgeOption', { n: id }), testid: `helper-edge-${id}` });
  const seatChoice = (s: Seat): Choice => ({ value: s, label: seatName(s), testid: `helper-seat-${s}` });

  function play(action: Extract<Action, { type: 'useHelper' | 'swapHelper' }>) {
    dispatch(action);
    close();
  }

  // Board-click targeting follow-up: is one of Explorer/Priest's board-pick modes active right now?
  const inExplorerFlow = uiMode === 'helperExplorer';
  const inPriestFlow = uiMode === 'helperPriestSettlement' || uiMode === 'helperPriestCity';

  return (
    <div className="hexhaven-panel flex flex-col gap-2 p-2" data-testid="helpers-hud">
      <h3 className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('hud.title')}</h3>

      <div className="flex items-start justify-between gap-2 rounded-card border border-panel-edge p-2" data-testid="helpers-hud-mine">
        {mine ? (
          <NameDesc
            testId="helpers-hud-mine-card"
            nameTestId="helpers-hud-mine-name"
            descTestId="helpers-hud-mine-desc"
            icon={<HelperIcon helper={mine.id} />}
            name={t('hud.nameSide', { name: t(`name.${mine.id}`), side: t('hud.side', { side: mine.side }) })}
            desc={t(`desc.${mine.id}`)}
          />
        ) : (
          <div>
            <p className="font-ui text-12 font-semibold text-ink">{t('hud.yourHelper')}</p>
            <p className="font-ui text-12 text-ink-soft" data-testid="helpers-hud-mine-none">
              {t('hud.none')}
            </p>
          </div>
        )}
        {mine ? (
          <div className="flex shrink-0 gap-2">
            {useButton()}
            {swapButton()}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1" data-testid="helpers-hud-others">
        {view.players
          .filter((p) => p.seat !== mySeat)
          .map((p) => {
            const a = assignmentOf(view, p.seat);
            return (
              <p
                key={p.seat}
                className="flex items-center gap-1 font-ui text-12 text-ink-soft"
                data-testid={`helpers-hud-other-${p.seat}`}
                title={a ? t(`desc.${a.id}`) : undefined}
              >
                {a ? <HelperIcon helper={a.id} /> : null}
                {a ? t('hud.otherHelper', { name: seatName(p.seat), helper: t(`name.${a.id}`) }) : t('hud.otherHelper', { name: seatName(p.seat), helper: t('hud.none') })}
              </p>
            );
          })}
      </div>

      <div className="flex flex-col gap-1" data-testid="helpers-hud-display">
        <Badge data-testid="helpers-hud-display-count">{t('hud.display', { count: ext.display.length })}</Badge>
        {ext.display.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {ext.display.map((id) => (
              <li key={id} data-testid={`helpers-hud-display-${id}`}>
                <NameDesc
                  icon={<HelperIcon helper={id} />}
                  name={t(`name.${id}`)}
                  desc={t(`desc.${id}`)}
                  descMaxWidthClassName="max-w-none"
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* ---- Use dialogs (only the held helper's is ever reachable) --------------------------- */}
      <SingleResourceDialog
        open={dialog === 'mayor'}
        titleKey="dialog.mayor.title"
        instructionsKey="dialog.mayor.instructions"
        confirmKey="dialog.mayor.confirm"
        testid="helper-mayor-dialog"
        onClose={close}
        onConfirm={(resource: ResourceType) => play({ type: 'useHelper', helper: 'mayor', resource })}
      />
      <SingleResourceDialog
        open={dialog === 'captain'}
        titleKey="dialog.captain.title"
        instructionsKey="dialog.captain.instructions"
        confirmKey="dialog.captain.confirm"
        testid="helper-captain-dialog"
        onClose={close}
        onConfirm={(resource: ResourceType) => play({ type: 'useHelper', helper: 'captain', resource })}
      />
      <MendicantDialog
        open={dialog === 'mendicant'}
        edgeChoices={roadTargetChoices(view, mySeat).map(edgeChoice)}
        onClose={close}
        onConfirm={(edge, replace, substitute) =>
          play({ type: 'useHelper', helper: 'mendicant', edge: edge as EdgeId, replace, substitute })
        }
      />
      <RobberBrideDialog
        open={dialog === 'robberBride'}
        targetChoices={robberBrideTargets(view, mySeat).map(seatChoice)}
        onClose={close}
        onConfirm={(target) => play({ type: 'useHelper', helper: 'robberBride', target: target as Seat | undefined })}
      />
      <MerchantDialog
        open={dialog === 'merchant'}
        targetChoices={view.players.filter((p) => p.seat !== mySeat).map((p) => ({ seat: p.seat, label: seatName(p.seat) }))}
        onClose={close}
        onConfirm={(targets, demand, giveBack) => play({ type: 'useHelper', helper: 'merchant', targets, demand, giveBack })}
      />
      <ChoicePickerDialog
        open={dialog === 'noblewoman'}
        testid="helper-noblewoman-dialog"
        title={t('dialog.noblewoman.title')}
        instructions={t('dialog.noblewoman.instructions')}
        confirmLabel={t('dialog.noblewoman.confirm')}
        choices={noblewomanTargets(view, mySeat).map(seatChoice)}
        onClose={close}
        onConfirm={(target) => play({ type: 'useHelper', helper: 'noblewoman', target: target as Seat })}
      />
      <ArchitectDialog
        open={dialog === 'architect'}
        maxPick={Math.max(0, Math.min(2, view.devDeckCount - 1)) as 0 | 1 | 2}
        onClose={close}
        onConfirm={(pick, replace, substitute) => play({ type: 'useHelper', helper: 'architect', pick, replace, substitute })}
      />
      <SwapDialog
        open={dialog === 'swap'}
        choices={ext.display.map((id) => ({ id, label: t(`name.${id}`) }))}
        onClose={close}
        onConfirm={(take) => play({ type: 'swapHelper', take })}
      />

      {/* Board-click targeting banner (Explorer/Priest), mirroring
          `citiesKnights/ProgressHandPanel.tsx`'s banner exactly. */}
      {inExplorerFlow || inPriestFlow ? (
        <div
          className="flex flex-col gap-2 rounded-card border border-accent bg-accent/10 p-2"
          data-testid="helper-board-target-banner"
        >
          <p className="font-ui text-12 font-semibold text-ink">{t('dialog.boardTargetPending')}</p>
          <p className="font-ui text-12 text-ink-soft">
            {inExplorerFlow ? t('dialog.explorer.instructions') : t('dialog.priest.instructions')}
          </p>
          <Button size="sm" variant="subtle" data-testid="helper-board-target-cancel" onClick={() => setMode('idle')}>
            {t('dialog.boardTargetCancel')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
