// CkActionPanel (visual-cohesion pass): the ONE consolidated C&K action panel, replacing four
// separately-boxed `hexhaven-panel`s (`ImprovementsPanel` + `KnightControls` + `CommodityTradePanel` +
// `ProgressHandPanel`) that used to stack full height in the footer — the single worst offender the
// redesign brief calls out ("look like they are vibe coded", "scrolling is unbearable"). Each of the
// four keeps its own component/tests/testids unchanged (`ckPanels.render.test.ts` still renders them
// individually); this file only adds the shared chrome — one `hexhaven-panel` shell + a `Tabs` strip —
// and shows exactly one section at a time via `hidden` (not unmount, so `ProgressHandPanel`'s open
// param dialog or `CommodityTradePanel`'s in-progress pick isn't silently reset by a tab switch).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Action, OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { Tabs } from '../ui';
import type { UiMode } from '../store/types';
import { CommodityTradePanel } from './CommodityTradePanel';
import { ImprovementsPanel } from './ImprovementsPanel';
import { KnightControls } from './KnightControls';
import { ProgressHandPanel } from './ProgressHandPanel';
import { ckOf } from './ckHelpers';

export interface CkActionPanelProps {
  view: PlayerView;
  own: OwnPlayerView | undefined;
  mySeat: Seat;
  seatName: (seat: Seat) => string;
  dispatch: (action: Action) => void;
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
}

type CkTab = 'improvements' | 'knights' | 'cards';

// A board-pick mode entered from the Knights/Cards tab should keep that tab visible even if the
// player had `tab` state pointed elsewhere (e.g. switched away, then a stray Escape/re-entry raced
// the click) — so the active-target banner is never hidden behind an idle tab.
const KNIGHT_MODES: readonly UiMode[] = [
  'buildingKnight',
  'activatingKnight',
  'promotingKnight',
  'movingKnight',
  'displacingKnight',
  'chasingRobber',
  'buildingCityWall',
];
const CARD_MODES: readonly UiMode[] = [
  'ckPlayEngineer',
  'ckPlayMedicine',
  'ckPlayMerchant',
  'ckPlayBishop',
  'ckPlayInventor',
  'ckPlayDiplomat',
  'ckPlayIntrigue',
  'ckPlayDeserter',
];

export function CkActionPanel({ view, own, mySeat, seatName, dispatch, uiMode, setMode }: CkActionPanelProps) {
  const { t } = useTranslation('citiesKnights');
  const [tab, setTab] = useState<CkTab>('improvements');
  const ck = ckOf(view);
  if (!ck) return null;

  const activeTab: CkTab = KNIGHT_MODES.includes(uiMode) ? 'knights' : CARD_MODES.includes(uiMode) ? 'cards' : tab;

  return (
    <div className="hexhaven-panel flex flex-col gap-2 p-2" data-testid="ck-action-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          ariaLabel={t('tabs.groupLabel')}
          activeId={activeTab}
          onChange={(id) => setTab(id as CkTab)}
          tabs={[
            { id: 'improvements', label: t('tabs.improvements') },
            { id: 'knights', label: t('tabs.knights') },
            { id: 'cards', label: t('tabs.cards'), badge: ck.ownProgressHand.length },
          ]}
        />
        <CommodityTradePanel view={view} mySeat={mySeat} dispatch={dispatch} />
      </div>

      <div className={activeTab === 'improvements' ? 'contents' : 'hidden'} data-testid="ck-tab-improvements">
        <ImprovementsPanel view={view} mySeat={mySeat} dispatch={dispatch} />
      </div>
      <div className={activeTab === 'knights' ? 'contents' : 'hidden'} data-testid="ck-tab-knights">
        <KnightControls view={view} mySeat={mySeat} uiMode={uiMode} setMode={setMode} />
      </div>
      <div className={activeTab === 'cards' ? 'contents' : 'hidden'} data-testid="ck-tab-cards">
        <ProgressHandPanel
          view={view}
          own={own}
          mySeat={mySeat}
          seatName={seatName}
          dispatch={dispatch}
          uiMode={uiMode}
          setMode={setMode}
        />
      </div>
    </div>
  );
}
