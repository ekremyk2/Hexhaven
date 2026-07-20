// FooterCardsPanel (scroll-elimination pass, see routes/Game.tsx's header for the full story): the
// dev-card hand list (`DevCardsPanel`, "GELİŞİM KARTLARI") and the cardMods "special plays" combo
// list (`CardModsComboPanel`, "ÖZEL OYNAMALAR") used to both render UNCONDITIONALLY, stacked full
// height, in the footer — together they were the single tallest offender causing the footer's own
// vertical scrollbar (worse still during SETUP, when neither section has anything playable yet).
// This wraps both in ONE `hexhaven-panel` + `Tabs` strip, mirroring `citiesKnights/CkActionPanel.tsx`'s
// exact recipe: exactly one section visible at a time via `hidden` (not unmount, so an open dialog
// in either section survives a tab switch), and the "special plays" tab only exists at all when
// `cardMods` is actually on (mirrors `CardModsComboPanel`'s own gate) — no empty tab for a game that
// doesn't have combos. `Game.tsx` mounts this only for a non-C&K game (same reasoning `DevCardsPanel`/
// `CardModsComboPanel` already used individually: C&K disables base dev cards outright, C11.1) and
// only past SETUP (neither section has anything to show before the first dev card can be bought).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import type { Action, Seat } from '@hexhaven/shared';
import { Tabs } from '../ui';
import type { UiMode } from '../store/types';
import { DevCardsPanel } from '../devcards/DevCardsPanel';
import { CardModsComboPanel } from '../cardMods/CardModsComboPanel';

export interface FooterCardsPanelProps {
  view: PlayerView;
  mySeat: Seat;
  seatName: (seat: Seat) => string;
  dispatch: (action: Action) => void;
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
}

type FooterCardsTab = 'devCards' | 'specialPlays';

// Board-pick modes that belong to each side (mirrors CkActionPanel's KNIGHT_MODES/CARD_MODES): a
// mode entered from a tab's Play button keeps that tab visible even if local `tab` state pointed
// elsewhere, so the active-target banner is never hidden behind an idle tab.
const DEV_CARD_BOARD_MODES: readonly UiMode[] = ['cardModTrailblazer', 'cardModHighwayman'];
const SPECIAL_PLAY_BOARD_MODES: readonly UiMode[] = ['cardModSuperSettle', 'cardModRideByNight'];

export function FooterCardsPanel({ view, mySeat, seatName, dispatch, uiMode, setMode }: FooterCardsPanelProps) {
  const { t } = useTranslation('game');
  const { t: tDevCards } = useTranslation('devcards');
  const { t: tCardMods } = useTranslation('cardMods');
  const [tab, setTab] = useState<FooterCardsTab>('devCards');

  const combosOn = view.config.modifiers?.cardMods === true;
  const activeTab: FooterCardsTab = DEV_CARD_BOARD_MODES.includes(uiMode)
    ? 'devCards'
    : SPECIAL_PLAY_BOARD_MODES.includes(uiMode)
      ? 'specialPlays'
      : tab;

  return (
    <div className="hexhaven-panel flex min-h-0 flex-col gap-2 p-2" data-testid="footer-cards-panel">
      <Tabs
        ariaLabel={t('hud.footer.cardsTabsLabel')}
        activeId={activeTab}
        onChange={(id) => setTab(id as FooterCardsTab)}
        className="shrink-0"
        tabs={[
          { id: 'devCards', label: tDevCards('title') },
          ...(combosOn ? [{ id: 'specialPlays', label: tCardMods('combo.title') }] : []),
        ]}
      />
      <div className={activeTab === 'devCards' ? 'contents' : 'hidden'} data-testid="footer-cards-tab-devCards">
        <DevCardsPanel />
      </div>
      {combosOn ? (
        <div className={activeTab === 'specialPlays' ? 'contents' : 'hidden'} data-testid="footer-cards-tab-specialPlays">
          <CardModsComboPanel view={view} mySeat={mySeat} seatName={seatName} dispatch={dispatch} uiMode={uiMode} setMode={setMode} />
        </div>
      ) : null}
    </div>
  );
}
