// Panel gallery (visual-cohesion pass): renders the REAL panel components — not swatches — against
// the mocked C&K/modifiers views from `styleguideFixtures.ts`, so the redesign is reviewable without
// a live game (PM/user open `/styleguide`). A "Preview viewport" toggle wraps the gallery in a
// fixed 375px frame to sanity-check the same markup at the mobile breakpoint side-by-side with the
// full-width desktop layout — real responsive proof still wants a live game at 375×812 (see this
// task's report), but this catches gross overflow/wrapping regressions in seconds, no dev server
// resize needed.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { BankPanel } from '../hud/BankPanel';
import { DicePanel } from '../hud/DicePanel';
import { Hand } from '../hud/Hand';
import { Scoreboard } from '../hud/Scoreboard';
import { VpWidget } from '../hud/VpWidget';
import { CitiesKnightsHud } from '../citiesKnights/CitiesKnightsHud';
import { CkActionPanel } from '../citiesKnights/CkActionPanel';
import { HelpersHud } from '../helpers/HelpersHud';
import { CardModsComboPanel } from '../cardMods/CardModsComboPanel';
import type { UiMode } from '../store/types';
import { Panel, SegmentedControl } from '../ui';
import { ckStyleguideView, modifiersStyleguideView } from './styleguideFixtures';

const NOOP_DISPATCH = () => {};

function ownOf(view: PlayerView, seat: Seat): OwnPlayerView | undefined {
  return view.players.find((p): p is OwnPlayerView => p.seat === seat && 'resources' in p);
}

function CkGallery() {
  const { t } = useTranslation(['common', 'game']);
  const [uiMode, setUiMode] = useState<UiMode>('idle');
  const view = ckStyleguideView();
  const own = ownOf(view, view.me);
  const seatName = (seat: Seat) => t(`game:hud.player.seatFallback`, { n: seat + 1 });

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-ui text-14 font-semibold text-ink-soft">{t('common:styleguide.panels.citiesKnightsHeading')}</h3>
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-72">
          <Scoreboard
            view={view}
            me={view.me}
            seatName={seatName}
            presence={{}}
            discardAmountFor={() => undefined}
          />
        </div>
        <div className="grid w-60 grid-cols-2 gap-2">
          <BankPanel bank={view.bank} devDeckCount={view.devDeckCount} />
          <DicePanel
            turn={view.turn}
            phase={view.phase}
            turnPlayerName={seatName(view.turn.player)}
            isViewerTurn
          />
        </div>
        <div className="w-72">
          <CitiesKnightsHud view={view} mySeat={view.me} seatName={seatName} />
        </div>
        <div className="w-72">
          <HelpersHud view={view} mySeat={view.me} seatName={seatName} dispatch={NOOP_DISPATCH} uiMode={uiMode} setMode={setUiMode} />
        </div>
      </div>
      {own ? (
        <div className="flex flex-wrap items-center gap-4">
          <Hand own={own} turnNumber={view.turn.number} />
          <VpWidget own={own} awards={view.awards} view={view} />
        </div>
      ) : null}
      <CkActionPanel
        view={view}
        own={own}
        mySeat={view.me}
        seatName={seatName}
        dispatch={NOOP_DISPATCH}
        uiMode={uiMode}
        setMode={setUiMode}
      />
    </div>
  );
}

function ModifiersGallery() {
  const { t } = useTranslation(['common', 'game']);
  const [uiMode, setUiMode] = useState<UiMode>('idle');
  const view = modifiersStyleguideView();
  const seatName = (seat: Seat) => t(`game:hud.player.seatFallback`, { n: seat + 1 });

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-ui text-14 font-semibold text-ink-soft">{t('common:styleguide.panels.modifiersHeading')}</h3>
      <CardModsComboPanel
        view={view}
        mySeat={view.me}
        seatName={seatName}
        dispatch={NOOP_DISPATCH}
        uiMode={uiMode}
        setMode={setUiMode}
      />
    </div>
  );
}

export function StyleguidePanels() {
  const { t } = useTranslation('common');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.panels')}</h2>
        <SegmentedControl
          ariaLabel={t('styleguide.panels.viewportToggleLabel')}
          value={viewport}
          onChange={(v) => setViewport(v as 'desktop' | 'mobile')}
          options={[
            { value: 'desktop', label: t('styleguide.panels.viewportDesktop') },
            { value: 'mobile', label: t('styleguide.panels.viewportMobile') },
          ]}
        />
      </div>
      <div
        className={viewport === 'mobile' ? 'mt-4 mx-auto max-w-[375px] overflow-x-hidden border border-panel-edge rounded-panel p-2' : 'mt-4'}
      >
        <div className="flex flex-col gap-8">
          <CkGallery />
          <ModifiersGallery />
        </div>
      </div>
    </Panel>
  );
}
