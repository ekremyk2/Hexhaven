// `/game/:gameId` (T-402 requirement 1): the real game screen chrome — board center-left (~70%),
// right sidebar (opponent panels + bank + a log slot for T-407), bottom bar (own hand + VP widget
// + the T-403 action bar). This file owns the layout + store wiring: `useUiInteraction()` (T-304)
// drives the board's `<InteractionLayer>` (click-to-build/move-robber), and `<ActionBar>` (T-403)
// is wired to the same `uiMode`/`sendAction` here — every other `src/controls/**`/`src/hud/**`
// component stays presentational, taking only props. `log-slot` stays an empty marker for T-407.
//
// Playtest fix ("scrolling is unbearable"): the sidebar used to stack EVERY section (scoreboard,
// bank, a persistent dice panel, the barbarian track, a full per-seat C&K block, helpers, log) and
// scroll the whole column as one unit — the log's own tab strip ended up clipped at the bottom. The
// rail is now a `<Tabs>` strip (Players · Bank · [Cities & Knights] · Log) showing exactly ONE
// section at a time via `hidden` (not unmount, so the log's scroll position/pinned state and any
// open dialogs survive a tab switch) — only that section's own `overflow-y-auto` ever scrolls, the
// `<aside>` itself never does. The persistent dice panel is gone entirely (center-screen
// `DiceRollOverlay` is the only dice UI now); the one thing worth keeping from it — turn number +
// whose turn — now rides `hud/Scoreboard.tsx`'s header line instead of a standalone box.
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { OtherPlayerView, OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { BoardView } from '../board/BoardView';
import { boardGeometryFor } from '../board/geometry';
import { InteractionLayer } from '../board/InteractionLayer';
import { boardProjection } from '../board/projection';
import { Pieces } from '../board/Pieces';
import { CitiesKnightsPieces } from '../board/CitiesKnightsPieces';
import { PLAYER_COLORS } from '../board/palette';
import { ActionBar } from '../controls/ActionBar';
import { RoadBuildingBar } from '../controls/RoadBuildingBar';
import { BankPanel } from '../hud/BankPanel';
import { DiceRollOverlay } from '../hud/DiceRollOverlay';
import { Hand } from '../hud/Hand';
import { Scoreboard } from '../hud/Scoreboard';
import { TurnNotifier } from '../hud/TurnNotifier';
import { ChatPanel } from '../hud/ChatPanel';
import { TradePanel } from '../trade/TradePanel';
import { EndScreen } from '../endscreen/EndScreen';
import { GameLog } from '../log/LogPanel';
import { RobberOverlay } from '../robber/RobberOverlay';
import { useHexhavenTheme } from '../themes/themeState';
import { useBoard3d } from '../theme/board3d';
import { BarbarianAttackToasts } from '../citiesKnights/BarbarianAttackToasts';
import { CitiesKnightsHud } from '../citiesKnights/CitiesKnightsHud';
import { CkActionPanel } from '../citiesKnights/CkActionPanel';
import { flattenKnights, flattenWalls, isCitiesKnightsGame, metropolisAnchors } from '../citiesKnights/ckHelpers';
import { FooterCardsPanel } from '../controls/FooterCardsPanel';
import { HelpersHud } from '../helpers/HelpersHud';
import { TbActionPanel } from '../tradersBarbarians/TbActionPanel';
import { TbHud } from '../tradersBarbarians/TbHud';
import { isTradersBarbariansGame, tbOf } from '../tradersBarbarians/tbHelpers';
import { TradersBarbariansPieces } from '../board/TradersBarbariansPieces';
import { EpActionPanel } from '../explorersPirates/EpActionPanel';
import { EpHud } from '../explorersPirates/EpHud';
import { epHarborSettlementsFlattened, epOf, epShipsFlattened, isExplorersPiratesGame } from '../explorersPirates/epHelpers';
import { ExplorersPiratesPieces } from '../board/ExplorersPiratesPieces';
import { Panel, Tabs } from '../ui';
import { BugReportButton } from '../components/BugReportButton';
import { useGameView, useLobbyState, useStore, useUiMode } from '../store';
import { useUiInteraction } from '../store/uiMode';

function isOtherPlayerView(p: PlayerView['players'][number]): p is OtherPlayerView {
  return 'resourceCount' in p;
}

type RailTab = 'play' | 'bank' | 'ck' | 'tb' | 'ep' | 'log' | 'chat';

/** One section visible at a time (Priority 3/4 rail redesign) — `hidden` rather than unmounting, so
 *  `GameLog`'s scroll position/pinned flag (and any open dialog inside a section) survives switching
 *  tabs away and back. Each visible section owns its OWN `overflow-y-auto`; the `<aside>` never
 *  scrolls as a whole. */
function RailSection({ active, className, children }: { active: boolean; className?: string; children: ReactNode }) {
  return <div className={active ? ['flex min-h-0 flex-1 flex-col gap-2', className].filter(Boolean).join(' ') : 'hidden'}>{children}</div>;
}

export default function Game() {
  const { t } = useTranslation('game');
  const { gameId } = useParams<'gameId'>();
  const [railTab, setRailTab] = useState<RailTab>('play');
  // WIRE: T-204 — same workaround `hotseat/HotseatPage.tsx` documents: the wire-level `PlayerView`
  // type is still the `unknown` placeholder (packages/shared/src/protocol/messages.ts) until that
  // task lands the real zod schema. This casts to what `redact()` (the engine's actual PlayerView)
  // produces, which is exactly what `game.started`/`game.events`/`game.sync` carry today.
  const view = useGameView() as PlayerView | null;
  const lobby = useLobbyState();
  const uiMode = useUiMode();
  const setUiMode = useStore((s) => s.setUiMode);
  const sendAction = useStore((s) => s.sendAction);
  const deadlines = useStore((s) => s.game.deadlines);
  const { mode, targets, onPick } = useUiInteraction();
  // T-907 PM wiring: the viewer's own cosmetic-theme choice (persisted client-side, never part of
  // RoomConfig/GameConfig — see themes.ts's header) reskins the board robber + a few HUD labels.
  const { themeId } = useHexhavenTheme();
  // T-1210 "3D board": one shared `BoardProjection` instance per render, built off the viewer's
  // persisted on/off choice, threaded through every board layer (BoardView/Pieces/InteractionLayer)
  // so they all agree on the exact same tilt (or lack of one) for correct hit-testing.
  const [board3d] = useBoard3d();
  const projection = boardProjection(board3d);

  if (!view) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p className="font-ui text-14 text-ink-ondark/80">{t('waitingForGame')}</p>
      </main>
    );
  }

  const me = view.me;
  const own = view.players.find((p): p is OwnPlayerView => p.seat === me && !isOtherPlayerView(p));

  const seatName = (seat: Seat) => lobby.seats[seat]?.nickname ?? t('hud.player.seatFallback', { n: seat + 1 });

  // The board a 5–6 game renders on is the 30-hex EXT56 geometry, not the base 19-hex one — must
  // match what the server generated, else hexes/harbors render on the wrong topology.
  const geometry = boardGeometryFor(view.config);

  const roads = view.players.flatMap((p) => p.roads.map((edge) => ({ edge, seat: p.seat })));
  const settlements = view.players.flatMap((p) => p.settlements.map((vertex) => ({ vertex, seat: p.seat })));
  const cities = view.players.flatMap((p) => p.cities.map((vertex) => ({ vertex, seat: p.seat })));

  // Seafarers (T-704/T-705): public ship state + the scenario terrain map (sea/gold tiles live only
  // here). Absent in a base game, so base/EXT56 rendering is untouched.
  const seafarers = view.ext?.seafarers;
  const ships = (seafarers?.ships ?? []).flatMap((edges, seat) =>
    edges.map((edge) => ({ edge, seat: seat as Seat })),
  );

  const discardAmountFor = (seat: Seat): number | undefined =>
    view.phase.kind === 'discard' && view.phase.pending.includes(seat) ? view.phase.amounts[seat] : undefined;

  // Cities & Knights (T-806): board pieces (knights/walls/metropolis) + HUD, gated so base/
  // fiveSix/Seafarers rendering stays untouched (RK-13).
  const ck = isCitiesKnightsGame(view);
  const ckKnights = ck ? flattenKnights(view) : [];
  const ckWalls = ck ? flattenWalls(view) : [];
  const ckMetropolises = ck ? metropolisAnchors(view) : [];

  // Traders & Barbarians (T-1008): board pieces (D) + HUD (C) + action panel (B), gated so base/
  // fiveSix/Seafarers/C&K rendering stays untouched (RK-13) — T&B never combines with those (TB8.1).
  // T-1160 (FOLLOWUP from T-1051): every overlay field below reads the per-game `tbExt.*` (river/
  // oasis/route/barbarian/trade-hex positions all ride through `redact.ts`, fully public board
  // geometry) — NONE of them fall back to a static base-19-hex module constant any more. `riverEdges`
  // used to read the module-level `RIVERS_RIVER_EDGES` (always the base board's river positions), so
  // a 5-6 Rivers game (30-hex EXT56) drew the river/shore overlay in the wrong spots.
  const tb = isTradersBarbariansGame(view);
  const tbExt = tb ? tbOf(view) : undefined;
  const tbBridges = (tbExt?.bridges ?? []).flatMap((edges, seat) => edges.map((edge) => ({ edge, seat: seat as Seat })));
  const tbWagons = (tbExt?.wagons ?? []).map((w) => ({ at: w.at, seat: w.seat, cargo: w.cargo }));

  // Explorers & Pirates (T-1108): board pieces (D) + HUD (C) + action panel (B), gated so base/
  // fiveSix/Seafarers/C&K/T&B rendering stays untouched (RK-13) — E&P never combines with those
  // (EP1.2, standalone only, mirrors T&B's own gate above).
  const ep = isExplorersPiratesGame(view);
  const epExt = ep ? epOf(view) : undefined;
  const epShips = ep ? epShipsFlattened(view) : [];
  const epHarborSettlements = ep ? epHarborSettlementsFlattened(view) : [];

  // The "Play" tab only exists for a seated player (a spectator has no `own` hand) — fall back to
  // Bank so a spectator never lands on an empty section.
  const activeTab: RailTab = railTab === 'play' && !own ? 'bank' : railTab;

  return (
    // The game fills the route area and never scrolls the page. DESKTOP (`lg:`, >=1024px): the board
    // takes the full height on the left (flex-1) beside a fixed-width right sidebar holding the hand,
    // the action controls (ActionBar + Trade) and a tabbed panel — Play / Players / Bank / [C&K] / Log
    // — whose ACTIVE section scrolls internally. There is NO bottom footer any more: moving all of it
    // into the side rail lets the board use the full height instead of being squeezed by a 42vh strip
    // (playtest: "move that bottom space to a side so the board doesn't shrink"). STACKED (`< lg`,
    // covers both phone and a 768px PORTRAIT TABLET — T-506): the same pieces stack — board on top at
    // a fixed slice, the sidebar below it (which scrolls its active section). The board keeps a
    // constant footprint across turns (its flex area no longer depends on a content-sized footer), so
    // it never resizes between the viewer's turn and others'. The cutover is `lg` (1024px), not `md`
    // (768px): the sidebar's fixed 26rem (416px) width plus gaps/padding leaves a genuinely tablet-
    // portrait viewport (768x1024, this task's own tablet test size) only ~320px for the board if it
    // switched to side-by-side there — badly squeezed, and MUCH smaller than the board a full-width
    // stacked layout renders at that same width (matches the precedent `hotseat/HotseatPage.tsx`'s
    // DebugPanel column already sets for the identical reason).
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-2 lg:flex-row lg:gap-5">
      <div
        className="min-h-0 min-w-0 shrink-0 basis-[46vh] lg:shrink lg:basis-auto lg:flex-1"
        style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.35))' }}
      >
        <BoardView
          board={view.board}
          geometry={geometry}
          hexTerrain={seafarers?.hexTerrain ?? epExt?.seaMap}
          hiddenNumbers={view.hiddenNumbers}
          epUnexplored={epExt?.unexplored ?? []}
          projection={projection}
        >
          <Pieces
            geometry={geometry}
            roads={roads}
            settlements={settlements}
            cities={cities}
            robber={view.board.robber}
            ships={[...ships, ...epShips]}
            pirate={seafarers?.pirate ?? null}
            themeId={themeId}
            hexPieces={view.ext?.hexPieces?.pieces ?? []}
            projection={projection}
          />
          {ep ? (
            <ExplorersPiratesPieces
              geometry={geometry}
              harborSettlements={epHarborSettlements}
              projection={projection}
            />
          ) : null}
          {ck ? (
            <CitiesKnightsPieces
              geometry={geometry}
              knights={ckKnights}
              walls={ckWalls}
              metropolises={ckMetropolises}
              projection={projection}
            />
          ) : null}
          {tb ? (
            <TradersBarbariansPieces
              geometry={geometry}
              lakeHex={tbExt?.lakeHex ?? null}
              fishingGrounds={tbExt?.fishingGrounds ?? []}
              riverEdges={tbExt?.riverEdges ?? []}
              bridges={tbBridges}
              oasisHex={tbExt?.oasisHex ?? null}
              routeEdges={tbExt?.routeEdges ?? []}
              camels={tbExt?.camels ?? []}
              barbarianHexes={tbExt?.barbarians ?? []}
              tbKnights={tbExt?.knights ?? []}
              tradeHexes={tbExt?.tradeHexes ?? []}
              wagons={tbWagons}
              pathBarbarians={tbExt?.pathBarbarians ?? []}
              projection={projection}
            />
          ) : null}
          <InteractionLayer
            geometry={geometry}
            mode={mode}
            targets={targets}
            onPick={onPick}
            ghostColor={PLAYER_COLORS[me]}
            projection={projection}
          />
        </BoardView>
      </div>

      {/* Right sidebar (`lg:w-[26rem]`): everything that used to be the bottom footer plus the old
          rail, in one column. Only its ACTIVE tab section scrolls; the sidebar itself never does. */}
      <aside className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden lg:w-[26rem] lg:max-w-[26rem] lg:flex-none">
        {/* Scoreboard sits at the TOP, above the resources (playtest). It already carries every
            seat's VP, so there is no separate VP badge next to the hand any more ("move VP
            elsewhere") — the viewer's own VP cell shows the breakdown tooltip instead. */}
        <div className="shrink-0">
          <Scoreboard
            view={view}
            me={me}
            seatName={seatName}
            presence={lobby.presence}
            discardAmountFor={discardAmountFor}
          />
        </div>
        {own ? (
          <div className="shrink-0">
            <Hand own={own} />
          </div>
        ) : null}
        {own ? (
          // The turn controls live in their own panel so they read as one cohesive control cluster
          // instead of loose buttons floating on the sidebar background (playtest).
          <Panel className="flex shrink-0 flex-col gap-2">
            <ActionBar
              view={view}
              own={own}
              mySeat={me}
              turnPlayerName={seatName(view.turn.player)}
              seatName={seatName}
              uiMode={uiMode}
              deadlines={deadlines}
              dispatch={sendAction}
              setMode={setUiMode}
              themeId={themeId}
            />
            {/* TradePanel outside ActionBar: ActionBar early-returns off-turn, which would hide an
                incoming offer; mounted here it shows the trade trigger on your turn AND an incoming
                offer on others' turns (B-20). */}
            <TradePanel />
          </Panel>
        ) : null}
        {/* Tabs: Play (cards) · Bank (+ Helpers, merged per playtest) · [C&K] · Log. The Players tab
            is gone — the scoreboard is now always visible at the top. */}
        <Tabs
          ariaLabel={t('hud.rail.tabsLabel')}
          activeId={activeTab}
          onChange={(id) => setRailTab(id as RailTab)}
          className="shrink-0"
          tabs={[
            ...(own ? [{ id: 'play', label: t('hud.rail.tabs.play') }] : []),
            { id: 'bank', label: t('hud.rail.tabs.bank') },
            ...(ck ? [{ id: 'ck', label: t('hud.rail.tabs.citiesKnights') }] : []),
            ...(tb ? [{ id: 'tb', label: t('hud.rail.tabs.tradersBarbarians') }] : []),
            ...(ep ? [{ id: 'ep', label: t('hud.rail.tabs.explorersPirates') }] : []),
            { id: 'log', label: t('hud.rail.tabs.log') },
            { id: 'chat', label: t('hud.rail.tabs.chat') },
          ]}
        />
        {own ? (
          <RailSection active={activeTab === 'play'} className="overflow-y-auto overflow-x-hidden">
            {/* The ONE home for dev cards / special plays / knight actions (also removed from Hand).
                Nothing is playable during SETUP, so show a short hint rather than an empty panel. */}
            {view.phase.kind === 'setup' ? (
              <p className="font-ui text-12 italic text-ink-soft">{t('hud.rail.playSetupHint')}</p>
            ) : ck ? (
              <CkActionPanel
                view={view}
                own={own}
                mySeat={me}
                seatName={seatName}
                dispatch={sendAction}
                uiMode={uiMode}
                setMode={setUiMode}
              />
            ) : (
              <>
                {/* T&B action controls sit ABOVE the dev-card panel, not instead of it — unlike C&K,
                    T&B never disables base dev cards (TB8.1 standalone rules only add new actions). */}
                {tb ? (
                  <TbActionPanel
                    view={view}
                    mySeat={me}
                    seatName={seatName}
                    dispatch={sendAction}
                    uiMode={uiMode}
                    setMode={setUiMode}
                  />
                ) : null}
                {ep ? (
                  <EpActionPanel
                    view={view}
                    mySeat={me}
                    dispatch={sendAction}
                    uiMode={uiMode}
                    setMode={setUiMode}
                  />
                ) : null}
                <FooterCardsPanel
                  view={view}
                  mySeat={me}
                  seatName={seatName}
                  dispatch={sendAction}
                  uiMode={uiMode}
                  setMode={setUiMode}
                />
              </>
            )}
          </RailSection>
        ) : null}
        <RailSection active={activeTab === 'bank'} className="overflow-y-auto overflow-x-hidden">
          <BankPanel bank={view.bank} devDeckCount={view.devDeckCount} />
          {/* Helpers merged into the Bank tab (playtest): self-contained, renders nothing unless
              `view.ext.helpers` is present (the `helpers` modifier active). */}
          <HelpersHud view={view} mySeat={me} seatName={seatName} dispatch={sendAction} uiMode={uiMode} setMode={setUiMode} />
        </RailSection>
        {ck ? (
          <RailSection active={activeTab === 'ck'} className="overflow-y-auto overflow-x-hidden">
            <CitiesKnightsHud view={view} mySeat={me} seatName={seatName} />
          </RailSection>
        ) : null}
        {tb ? (
          <RailSection active={activeTab === 'tb'} className="overflow-y-auto overflow-x-hidden">
            <TbHud view={view} mySeat={me} />
          </RailSection>
        ) : null}
        {ep ? (
          <RailSection active={activeTab === 'ep'} className="overflow-y-auto overflow-x-hidden">
            <EpHud view={view} mySeat={me} />
          </RailSection>
        ) : null}
        <RailSection active={activeTab === 'log'}>
          <div data-testid="log-slot" className="flex min-h-0 flex-1 flex-col">
            <GameLog />
          </div>
        </RailSection>
        <RailSection active={activeTab === 'chat'}>
          <ChatPanel />
        </RailSection>
        {/* Compact bug-report affordance pinned to the sidebar footer — shrink-0 so it never grows the
            fixed-viewport layout or steals space from the active (scrolling) rail section above it. */}
        <div className="flex shrink-0 justify-end">
          <BugReportButton screen="game" details={{ gameId }} />
        </div>
      </aside>

      {/* Self-contained overlays: each renders only when the phase/state calls for it. */}
      <TurnNotifier />
      <RobberOverlay />
      <RoadBuildingBar />
      <EndScreen />
      <BarbarianAttackToasts />
      {/* Priority 3 UI overhaul: center-screen dice-roll celebration — self-contained, watches
          `view.turn.roll` itself, renders nothing outside the brief tumble/settle/fade window. */}
      <DiceRollOverlay />
    </div>
  );
}
