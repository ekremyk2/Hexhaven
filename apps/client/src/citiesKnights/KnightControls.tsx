// Knight + city-wall controls (T-806 Priority 2 requirement 5/6, C7/C9): one mode-toggle button per
// knight action + city walls, entering the matching `store/uiMode.ts` board-pick mode exactly like
// `controls/ActionBar.tsx`'s build/ship buttons do (`toggleBuildMode`/`shipButton` precedent).
// `buildKnight`/`activateKnight`/`promoteKnight`/`buildCityWall` are single-step vertex picks;
// `moveKnight`/`knightDisplace`/`chaseRobber` are two-step (the board itself walks the picker
// through step 1 -> step 2 via `game.knightPickFrom`, driven by `useUiInteraction`) — this panel
// only needs to toggle the mode and show a short "pick your knight" hint while one of those three
// is active, mirroring how `ActionBar` shows the seafarers move-ship hint.
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { IconButton, Tooltip } from '../ui';
import type { UiMode } from '../store/types';
import {
  computeActivateKnightState,
  computeBuildKnightState,
  computeBuildWallState,
  computeChaseRobberState,
  computeDisplaceKnightState,
  computeMoveKnightState,
  computePromoteKnightState,
  type CkControlState,
} from './ckActionLogic';
import { ckOf } from './ckHelpers';

export interface KnightControlsProps {
  view: PlayerView;
  mySeat: Seat;
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
}

const TWO_STEP_MODES: readonly UiMode[] = ['movingKnight', 'displacingKnight', 'chasingRobber'];

/** One glyph per knight/wall action (Priority 2: "a tight labeled icon grid, not 7 stacked
 *  full-width buttons") — decorative only, `IconButton` always keeps the translated label as the
 *  visible accessible name next to it (docs/11 §6: never color/glyph alone). */
const ACTION_GLYPH: Record<
  'buildingKnight' | 'activatingKnight' | 'promotingKnight' | 'movingKnight' | 'displacingKnight' | 'chasingRobber' | 'buildingCityWall',
  string
> = {
  buildingKnight: '⚔️',
  activatingKnight: '🛡️',
  promotingKnight: '⭐',
  movingKnight: '🔀',
  displacingKnight: '👊',
  chasingRobber: '🏃',
  buildingCityWall: '🧱',
};

export function KnightControls({ view, mySeat, uiMode, setMode }: KnightControlsProps) {
  const { t } = useTranslation(['citiesKnights', 'log']);
  const ck = ckOf(view);
  if (!ck) return null;

  function reasonText(state: CkControlState): string {
    if (state.enabled || !state.reason) return '';
    if (state.reason === 'cantAfford' && state.missing) {
      // Bug fix (found live while verifying the inline-reason display): `citiesKnights:reason.
      // cantAfford` already supplies its own `{{need}}` count ("Need 1 grain…"), so `type` must be
      // the BARE resource word — `log:resourceName.*` — not `log:resource.*` (which bakes its OWN
      // count in, e.g. "1 grain"). Using the count-baked key here rendered "Need 1 1 grain (have 0)."
      const label = ['paper', 'cloth', 'coin'].includes(state.missing.type)
        ? t(`citiesKnights:commodity.${state.missing.type}`)
        : t(`log:resourceName.${state.missing.type}`);
      return t('citiesKnights:reason.cantAfford', { need: state.missing.need, type: label, have: state.missing.have });
    }
    return t(`citiesKnights:reason.${state.reason}`);
  }

  // Playtest fix (requirement 1b): a disabled knight/wall button used to explain itself only via a
  // hover/focus `Tooltip` — invisible on touch, and easy to miss even on desktop ("can't be
  // activated even after I rolled the dice" turned out to be genuine gating the user just never
  // saw the reason for). Every disabled button now also renders its reason as a small ALWAYS-VISIBLE
  // line right under it (`ck-reason-*`), with the tooltip kept as a redundant hover affordance.
  function modeButton(testid: string, mode: keyof typeof ACTION_GLYPH, state: CkControlState, labelKey: string) {
    const active = uiMode === mode;
    const button = (
      <IconButton
        data-testid={testid}
        icon={ACTION_GLYPH[mode]}
        label={t(labelKey)}
        active={active}
        disabled={!state.enabled}
        onClick={() => setMode(active ? 'idle' : mode)}
      />
    );
    const wrapped = state.enabled || !state.reason ? button : <Tooltip content={reasonText(state)}>{button}</Tooltip>;
    return (
      <div key={testid} className="flex w-20 shrink-0 flex-col items-center gap-0.5">
        {wrapped}
        {!state.enabled && state.reason ? (
          // `w-full` is required here: a flex-COLUMN item has no width constraint of its own by
          // default (unlike a row item, which stretches), so without it a long reason sentence
          // just grows past the `w-20` column instead of wrapping (found live via a
          // `scrollWidth > clientWidth` sweep — B-style overflow bug).
          <p
            data-testid={`ck-reason-${testid}`}
            className="w-full break-words text-center font-ui text-10 leading-tight text-ink-soft"
          >
            {reasonText(state)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid="ck-knight-controls">
      <div className="flex flex-wrap gap-1.5">
        {modeButton('ck-action-build-knight', 'buildingKnight', computeBuildKnightState(view, mySeat), 'citiesKnights:knightControls.build')}
        {modeButton('ck-action-activate-knight', 'activatingKnight', computeActivateKnightState(view, mySeat), 'citiesKnights:knightControls.activate')}
        {modeButton('ck-action-promote-knight', 'promotingKnight', computePromoteKnightState(view, mySeat), 'citiesKnights:knightControls.promote')}
        {modeButton('ck-action-move-knight', 'movingKnight', computeMoveKnightState(view, mySeat), 'citiesKnights:knightControls.move')}
        {modeButton('ck-action-displace-knight', 'displacingKnight', computeDisplaceKnightState(view, mySeat), 'citiesKnights:knightControls.displace')}
        {modeButton('ck-action-chase-robber', 'chasingRobber', computeChaseRobberState(view, mySeat), 'citiesKnights:knightControls.chaseRobber')}
        {modeButton('ck-action-build-wall', 'buildingCityWall', computeBuildWallState(view, mySeat), 'citiesKnights:knightControls.buildWall')}
      </div>
      {TWO_STEP_MODES.includes(uiMode) ? (
        <p className="mt-2 font-ui text-12 italic text-ink-soft" data-testid="ck-two-step-hint">
          {t('citiesKnights:knightControls.pickSourceHint')}
        </p>
      ) : null}
    </div>
  );
}
