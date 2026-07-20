// CardModsComboPanel (Phase-9 play-UI follow-up): the 5 `cardMods` combo "special plays"
// (rideByNight/nightOfPlenty/monorail/megaKnight/superSettle) — these are never held in hand (each
// one CONSUMES existing base dev cards, `packages/engine/src/modules/modifiers/cardMods/
// comboCards.ts`), so they get their own panel rather than a hand-panel row, mirroring
// `citiesKnights/ProgressHandPanel.tsx`'s "list cards, Play opens a param dialog" shape. Gated on
// `view.config.modifiers?.cardMods` and mounted only for a non-Cities & Knights game (Game.tsx),
// matching `DevCardsPanel`'s own C&K gate — combos consume base dev cards that don't exist in a C&K
// game (C11.1 disables them outright), so this panel would show 5 permanently-unplayable rows there.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { Action, CardModComboId, EdgeId, HexId, Seat } from '@hexhaven/shared';
import { Button, Tooltip } from '../ui';
import type { UiMode } from '../store/types';
import {
  comboComponentsHeld,
  computeComboPlayState,
  hexChoicesExceptRobber,
  legalRoadEdgesAnyPhase,
  megaKnightTargets,
  type CardModPlayReason,
} from './cardModLogic';
import { ChoicePickerDialog, MonorailDialog, NightOfPlentyDialog, type Choice } from './CardModDialogs';

export interface CardModsComboPanelProps {
  view: PlayerView;
  mySeat: Seat;
  seatName: (seat: Seat) => string;
  dispatch: (action: Action) => void;
  /** Board-click targeting follow-up: the shared `store/uiMode.ts` mode + setter (mirrors
   *  `citiesKnights/KnightControls.tsx`'s props) — Super-Settle (vertex) and Ride By Night
   *  (two-step hex then edge) enter a board-pick mode instead of opening a list dialog. */
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
}

const COMBOS: readonly CardModComboId[] = ['rideByNight', 'nightOfPlenty', 'monorail', 'megaKnight', 'superSettle'];

/** Combos with a board target -> the `uiMode` their Play button enters. `nightOfPlenty` (hex +
 *  non-board resource), `monorail` (1-2 free roads — no "confirm N picks" board primitive yet) and
 *  `megaKnight` (opponent seat, not a board location) keep their dialogs — see this file's/
 *  `cardModLogic.ts`'s header for the reasoning behind each. */
const BOARD_TARGET_MODE: Partial<Record<CardModComboId, UiMode>> = {
  superSettle: 'cardModSuperSettle',
  rideByNight: 'cardModRideByNight',
};

const COMBO_FOR_BOARD_MODE: Partial<Record<UiMode, CardModComboId>> = Object.fromEntries(
  Object.entries(BOARD_TARGET_MODE).map(([combo, mode]) => [mode as UiMode, combo as CardModComboId]),
);

export function CardModsComboPanel({ view, mySeat, seatName, dispatch, uiMode, setMode }: CardModsComboPanelProps) {
  const { t } = useTranslation('cardMods');
  const [dialog, setDialog] = useState<CardModComboId | null>(null);

  if (!view.config.modifiers?.cardMods) return null;

  const own = view.players.find((p): p is OwnPlayerView => p.seat === mySeat && 'devCards' in p);
  if (!own) return null;

  const hexChoice = (id: number): Choice => ({ value: id, label: t('dialog.hexOption', { n: id }), testid: `cardmod-hex-${id}` });
  const edgeChoice = (id: number): Choice => ({ value: id, label: t('dialog.edgeOption', { n: id }), testid: `cardmod-edge-${id}` });

  const hexChoices = hexChoicesExceptRobber(view).map(hexChoice);
  const edgeChoices = legalRoadEdgesAnyPhase(view, mySeat).map(edgeChoice);
  const megaKnightChoices: Choice[] = megaKnightTargets(view, mySeat).map((s) => ({
    value: s,
    label: seatName(s),
    testid: `cardmod-mega-knight-target-${s}`,
  }));

  function reasonText(reason: CardModPlayReason): string {
    return t(`combo.reason.${reason}`);
  }

  function playButton(combo: CardModComboId) {
    const state = computeComboPlayState(view, mySeat, combo);
    const boardMode = BOARD_TARGET_MODE[combo];
    const button = (
      <Button
        data-testid={`cardmod-combo-play-${combo}`}
        size="sm"
        variant="subtle"
        disabled={!state.playable}
        onClick={() => (boardMode ? setMode(boardMode) : setDialog(combo))}
      >
        {t('combo.play')}
      </Button>
    );
    return state.playable || !state.reason ? button : <Tooltip content={reasonText(state.reason)}>{button}</Tooltip>;
  }

  function close() {
    setDialog(null);
  }
  function play(action: Extract<Action, { type: 'playCardModCombo' }>) {
    dispatch(action);
    setDialog(null);
  }

  // Board-click targeting follow-up: which combo (if any) the board is currently targeting.
  const activeBoardCombo = COMBO_FOR_BOARD_MODE[uiMode];

  // Playtest (user): list a special play only when its card COMBINATION is actually in hand — e.g.
  // Ride by Night appears only while you hold a Knight AND a Road Building card — instead of showing
  // all 5 permanently. Finer conditions (turn/phase/legal target/bought-this-turn) still gate the
  // Play button (`computeComboPlayState`), so a held-but-not-yet-playable combo shows disabled.
  const visibleCombos = COMBOS.filter((combo) => comboComponentsHeld(own, combo));

  return (
    <div className="hexhaven-panel flex flex-col gap-2 p-2" data-testid="cardmod-combo-panel">
      <h3 className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('combo.title')}</h3>
      {visibleCombos.length === 0 ? (
        <p className="font-ui text-12 text-ink-soft" data-testid="cardmod-combo-empty">{t('combo.empty')}</p>
      ) : null}
      <div className="flex flex-col gap-2">
        {visibleCombos.map((combo) => (
          <div
            key={combo}
            className="flex items-center justify-between gap-2 rounded-card border border-panel-edge p-2"
            data-testid={`cardmod-combo-${combo}`}
          >
            <div>
              <p className="font-ui text-12 font-semibold text-ink">{t(`combo.name.${combo}`)}</p>
              <p className="max-w-[16rem] font-ui text-12 text-ink-soft">{t(`combo.desc.${combo}`)}</p>
            </div>
            {playButton(combo)}
          </div>
        ))}
      </div>

      <NightOfPlentyDialog
        open={dialog === 'nightOfPlenty'}
        hexChoices={hexChoices}
        onClose={close}
        onConfirm={(resource, hex) =>
          play({ type: 'playCardModCombo', combo: 'nightOfPlenty', resource, hex: hex as HexId })
        }
      />
      <MonorailDialog
        open={dialog === 'monorail'}
        edgeChoices={edgeChoices}
        onClose={close}
        onConfirm={(edges) => play({ type: 'playCardModCombo', combo: 'monorail', edges: edges as EdgeId[] })}
      />
      <ChoicePickerDialog
        open={dialog === 'megaKnight'}
        testid="cardmod-mega-knight-dialog"
        title={t('dialog.megaKnight.title')}
        instructions={t('dialog.megaKnight.instructions')}
        confirmLabel={t('dialog.megaKnight.confirm')}
        choices={megaKnightChoices}
        onClose={close}
        onConfirm={(targetSeat) => play({ type: 'playCardModCombo', combo: 'megaKnight', targetSeat: targetSeat as Seat })}
      />

      {/* Board-click targeting banner (Super-Settle/Ride By Night), mirroring
          `ProgressHandPanel.tsx`'s banner exactly. */}
      {activeBoardCombo ? (
        <div
          className="flex flex-col gap-2 rounded-card border border-accent bg-accent/10 p-2"
          data-testid="cardmod-combo-board-target-banner"
        >
          <p className="font-ui text-12 font-semibold text-ink">{t('dialog.boardTargetPending')}</p>
          <p className="font-ui text-12 text-ink-soft">{t(`dialog.${activeBoardCombo}.instructions`)}</p>
          <Button size="sm" variant="subtle" data-testid="cardmod-combo-board-target-cancel" onClick={() => setMode('idle')}>
            {t('dialog.boardTargetCancel')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
