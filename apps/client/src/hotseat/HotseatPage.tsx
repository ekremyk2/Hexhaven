// HotseatPage (T-305): `/hotseat` — a full local 4-seat game against `localTransport.ts`'s
// in-browser `GameTransport`, replacing the app's registered transport for as long as this route
// is mounted (mirrors `bootstrap.ts`'s ownership of the real ws transport — the one other place
// allowed to construct/hold a `GameTransport` directly, docs/02 §8) and restoring whatever was
// registered before on unmount. Composes the SAME board components the future real game screen
// will (`BoardView`/`Pieces`/`InteractionLayer`, T-302-304) via a LOCAL copy of T-304's
// store-connected interaction hook (`useUiInteraction` in `store/uiMode.ts`) parameterised by the
// currently VIEWED seat instead of the networked client's single `lobby.mySeat` — hot-seat has no
// one "my seat", the camera moves. `SeatBar` and the collapsible `DebugPanel` supply everything
// else requirement 5 asks for until Phase-4's real HUD/build-flow screens exist.
//
// T-402 addition: the real HUD (`src/hud/**`) mounts here too, fed `redact(state, viewedSeat)` —
// a genuinely redacted `PlayerView` for whichever seat's camera is currently active — rather than
// the full `GameState` `DebugPanel` uses. Swapping seats via `SeatBar` re-renders the HUD as that
// seat would truthfully see it, which is exactly how the PM can eyeball that opponent hands never
// leak card identities (docs/02 §6) while iterating without a real server.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { redact } from '@hexhaven/engine';
import type { OtherPlayerView, OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { Action, EdgeId, GameState, Seat, VertexId } from '@hexhaven/shared';
import { BoardView } from '../board/BoardView';
import { InteractionLayer } from '../board/InteractionLayer';
import { Pieces } from '../board/Pieces';
import { CitiesKnightsPieces } from '../board/CitiesKnightsPieces';
import { boardGeometryFor } from '../board/geometry';
import { PLAYER_COLORS } from '../board/palette';
import { ActionBar } from '../controls/ActionBar';
import { BankPanel } from '../hud/BankPanel';
import { DiceRollOverlay } from '../hud/DiceRollOverlay';
import { Hand } from '../hud/Hand';
import { PlayerPanel } from '../hud/PlayerPanel';
import { VpWidget } from '../hud/VpWidget';
import { boardModeForExpansions, boardPresetsForMode } from '@hexhaven/shared';
import { BarbarianAttackToasts } from '../citiesKnights/BarbarianAttackToasts';
import { CitiesKnightsHud } from '../citiesKnights/CitiesKnightsHud';
import { CkActionPanel } from '../citiesKnights/CkActionPanel';
import { flattenKnights, flattenWalls, isCitiesKnightsGame, metropolisAnchors } from '../citiesKnights/ckHelpers';
import { TbActionPanel } from '../tradersBarbarians/TbActionPanel';
import { isTradersBarbariansGame } from '../tradersBarbarians/tbHelpers';
import { useGameView, useKnightPickFrom, useProgressCardStep1, useShipMoveFrom, useStore, useUiMode } from '../store';
import { getTransport, setTransport } from '../store/transport';
import {
  computeUiTargets,
  isKnightPickSourcePick,
  isProgressCardStep1Pick,
  isShipMoveSourcePick,
  resolvePick,
} from '../store/uiMode';
import { Button, SegmentedControl, Tabs, TextInput } from '../ui';
import { BoardPresetPicker } from '../options/BoardPresetPicker';
import { DEFAULT_FIVE_SIX_TURN_RULE, DEFAULT_SEAFARERS_SCENARIO, SBP_ENABLED } from '../options/OptionsPanel';
import { RobberOverlay } from '../robber/RobberOverlay';
import { RoadBuildingBar } from '../controls/RoadBuildingBar';
import { DebugPanel } from './DebugPanel';
import {
  createLocalTransport,
  type BoardChoice,
  type FiveSixTurnRule,
  type HotseatPlayerCount,
  type LocalTransport,
  type TokenMethod,
} from './localTransport';
import { SeatBar } from './SeatBar';

function isOtherPlayerView(p: PlayerView['players'][number]): p is OtherPlayerView {
  return 'resourceCount' in p;
}

type RailTab = 'players' | 'bank' | 'ck';

/** Mirrors `routes/Game.tsx`'s own `RailSection` (rail redesign, "make the right rail fit without
 *  scrolling") — kept as a local copy rather than a shared import since this route's rail has no
 *  log slot and a different tab set, and the two route files otherwise share no component code. */
function RailSection({ active, children }: { active: boolean; children: ReactNode }) {
  // `overflow-x-hidden` alongside `overflow-y-auto` (mirrors `routes/Game.tsx`'s own `RailSection` /
  // `ui/Modal.tsx`): `ui/Tooltip.tsx`'s hover popup is absolutely positioned and invisible by default,
  // but its layout box still inflates this scroll container's horizontal scrollable-overflow even
  // while hidden (CSS scrolling-box spec quirk — `overflow-x` computes to `auto` once `overflow-y`
  // isn't `visible`), which silently produced a horizontal scrollbar with nothing visibly overflowing.
  return (
    <div className={active ? 'flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden' : 'hidden'}>
      {children}
    </div>
  );
}

export default function HotseatPage() {
  const { t } = useTranslation('game');
  const [railTab, setRailTab] = useState<RailTab>('players');

  // Lazy-initialized once per mount (React may invoke this initializer twice under StrictMode's
  // dev double-invoke check — the discarded instance is inert, it owns no socket/timer). The
  // effect below is what actually registers/tears down the transport, exactly once per real mount.
  const [transport] = useState<LocalTransport>(() => createLocalTransport());
  const [seedInput, setSeedInput] = useState(transport.getSeed());
  const [tokenMethod, setTokenMethod] = useState<TokenMethod>(transport.getTokenMethod());
  const [playerCount, setPlayerCount] = useState<HotseatPlayerCount>(transport.getPlayerCount());
  // T-606: board-setup method. Beginner is base-19 only, so it's forced to Random at 5–6 players.
  const [board, setBoard] = useState<BoardChoice>(transport.getBoard());
  // T-705: Seafarers on/off for the hot-seat game (the one shipped scenario, 3–4 players).
  const [seafarersOn, setSeafarersOn] = useState<boolean>(transport.getSeafarers() != null);
  // T-806: Cities & Knights on/off (3–4 players, mutually exclusive with Seafarers/fiveSix, C12).
  const [citiesKnightsOn, setCitiesKnightsOn] = useState<boolean>(transport.getCitiesKnights());
  // Default to the product default (Paired Players); SBP is disabled in the picker for now.
  const [turnRule, setTurnRule] = useState<FiveSixTurnRule>(
    SBP_ENABLED ? transport.getTurnRule() : DEFAULT_FIVE_SIX_TURN_RULE
  );

  // WIRE: T-204 — same workaround `store/uiMode.ts` documents: the wire-level `PlayerView` type is
  // still the `unknown` placeholder (packages/shared/src/protocol/messages.ts), so this casts to
  // what `redact()` actually returns (`GameState`'s public shape, plus the `me: Seat` viewer tag)
  // rather than blocking on that task.
  const view = useGameView() as (GameState & { me: Seat }) | null;
  const uiMode = useUiMode();
  const shipMoveFrom = useShipMoveFrom();
  const knightPickFrom = useKnightPickFrom();
  const progressCardStep1 = useProgressCardStep1();
  const setUiMode = useStore((s) => s.setUiMode);
  const setShipMoveFrom = useStore((s) => s.setShipMoveFrom);
  const setKnightPickFrom = useStore((s) => s.setKnightPickFrom);
  const setProgressCardStep1 = useStore((s) => s.setProgressCardStep1);
  const pushToast = useStore((s) => s.pushToast);

  useEffect(() => {
    const previous = getTransport();
    const unsubscribe = transport.onUpdate((msg) => useStore.getState().applyServerMessage(msg));
    setTransport(transport);
    transport.start(); // subscriber is wired first — nothing is emitted before anyone listens
    return () => {
      unsubscribe();
      setTransport(previous);
    };
  }, [transport]);

  const viewedSeat = (view?.me ?? 0) as Seat;

  const { mode, targets } = useMemo(
    () =>
      view
        ? computeUiTargets(view, viewedSeat, uiMode, shipMoveFrom, knightPickFrom, null, progressCardStep1)
        : { mode: null, targets: new Set<number>() },
    [view, viewedSeat, uiMode, shipMoveFrom, knightPickFrom, progressCardStep1],
  );

  const onPick = useCallback(
    (id: number) => {
      if (!view) return;
      // Move-ship step 1: a valid open-ship pick only records the source edge (no engine action yet).
      if (isShipMoveSourcePick(view, viewedSeat, uiMode, shipMoveFrom, id)) {
        setShipMoveFrom(id as EdgeId);
        return;
      }
      // Knight-pick step 1 (T-806): same deal for movingKnight/displacingKnight/chasingRobber.
      if (isKnightPickSourcePick(view, viewedSeat, uiMode, knightPickFrom, id)) {
        setKnightPickFrom(id as VertexId);
        return;
      }
      // Progress-card step 1 (board-click targeting follow-up): same deal for ckPlayInventor's first
      // hex / ckPlayDeserter's opponent-knight vertex.
      if (isProgressCardStep1Pick(view, viewedSeat, uiMode, progressCardStep1, id)) {
        setProgressCardStep1(id);
        return;
      }
      const action = resolvePick(view, viewedSeat, uiMode, id, shipMoveFrom, knightPickFrom, null, progressCardStep1);
      if (action == null) return;
      transport.send(action);
      setUiMode('idle');
    },
    [
      view,
      viewedSeat,
      uiMode,
      shipMoveFrom,
      knightPickFrom,
      progressCardStep1,
      transport,
      setUiMode,
      setShipMoveFrom,
      setKnightPickFrom,
      setProgressCardStep1,
    ],
  );

  const onSendAction = useCallback((action: Action) => transport.send(action), [transport]);
  const onToast = useCallback((input: { kind: 'info' | 'error'; message: string }) => pushToast(input), [pushToast]);

  const state = transport.getGameState();
  // Genuinely redacted (docs/02 §6) for whichever seat is currently being viewed — the HUD below
  // never sees more than a real client at that seat would.
  const playerView = useMemo(() => redact(state, viewedSeat), [state, viewedSeat]);
  const own = playerView.players.find((p): p is OwnPlayerView => p.seat === viewedSeat && !isOtherPlayerView(p));
  const opponents = playerView.players.filter(isOtherPlayerView);
  const seatName = (seat: Seat) => t('hotseat.seatBar.seatLabel', { n: seat + 1 });
  const discardAmountFor = (seat: Seat): number | undefined =>
    playerView.phase.kind === 'discard' && playerView.phase.pending.includes(seat)
      ? playerView.phase.amounts[seat]
      : undefined;

  function handleNewGame() {
    // Beginner is base-19 only; at 5–6 players the effective board is Random (localTransport also
    // forces this, but keep the picker state honest so the control reflects reality).
    const effectiveBoard: BoardChoice = playerCount >= 5 ? 'random' : board;
    // C&K wins over Seafarers/fiveSix when requested (C12 single-expansion only, mirrors
    // `buildConfig`'s own precedence — kept honest here too rather than relying only on the transport).
    const ckOn = citiesKnightsOn && playerCount <= 4;
    // Seafarers only ships 3/4-player boards; ignore the toggle at 5–6 or when C&K wins (T-806, C12).
    const seafarers = !ckOn && seafarersOn && playerCount <= 4 ? DEFAULT_SEAFARERS_SCENARIO : null;
    transport.newGame({
      seed: seedInput,
      tokenMethod,
      playerCount,
      turnRule,
      board: effectiveBoard,
      seafarers,
      citiesKnights: ckOn,
    });
    setUiMode('idle');
  }

  function handleRandomSeed() {
    setSeedInput(Math.random().toString(36).slice(2, 10));
  }

  // 30-hex EXT56 geometry for a 5–6 game, base 19-hex otherwise (must match the generated board).
  const geometry = boardGeometryFor(state.config);

  const roads = state.players.flatMap((p) => p.roads.map((edge) => ({ edge, seat: p.seat })));
  const settlements = state.players.flatMap((p) => p.settlements.map((vertex) => ({ vertex, seat: p.seat })));
  const cities = state.players.flatMap((p) => p.cities.map((vertex) => ({ vertex, seat: p.seat })));

  // Cities & Knights (T-806): board pieces + HUD, gated so base/fiveSix/Seafarers rendering stays
  // untouched (RK-13). Sourced from `playerView` (already redacted for the viewed seat) exactly
  // like the online `Game.tsx` mount does.
  const ck = isCitiesKnightsGame(playerView);
  const ckKnights = ck ? flattenKnights(playerView) : [];
  const ckWalls = ck ? flattenWalls(playerView) : [];
  const ckMetropolises = ck ? metropolisAnchors(playerView) : [];

  // Traders & Barbarians (T-1008 built `TbActionPanel`, mirroring `CkActionPanel`'s role, but never
  // mounted it here — B-caravan-vote-bots: with no board.tsx to cast a caravanVote bid (or place a
  // won camel / build a bridge / recruit-move a knight / move a wagon), a T&B hot-seat game had no
  // UI for any of its new actions at all, on top of the `computeActiveSeat`/`pickBotAction` gaps
  // fixed alongside this in `localTransport.ts`/`bot.ts`). T&B never combines with C&K (TB8.1), so
  // this is mutually exclusive with `ck` above exactly like the online `routes/Game.tsx` mount.
  const tb = isTradersBarbariansGame(playerView);

  // Seafarers (T-705): public ship state + scenario terrain map, rendered exactly like the online
  // screen. Absent (undefined) in a base/EXT56 game.
  const seafarersExt = state.ext?.seafarers;
  const ships = (seafarersExt?.ships ?? []).flatMap((edges, seat) =>
    edges.map((edge) => ({ edge, seat: seat as Seat })),
  );

  return (
    // Priority 1 UI overhaul: same fixed-viewport shell as `routes/Game.tsx` — this page used to be
    // a plain flex column with no height bound at all, so the route wrapper (App.tsx) had to scroll
    // the ENTIRE page (setup toolbar + board + sidebar + debug panel + hand/action bar all stacked)
    // to reach anything below the fold; the dice/hand/action bar routinely ended up 900px+ below the
    // visible area. Now: `h-full`/`overflow-hidden` bounds the page to the viewport, the setup
    // toolbar + seat bar are `shrink-0` (their own natural height), the board/sidebar/debug row is
    // the one `flex-1 min-h-0` region (each column scrolls itself), and the hand/action-bar footer
    // is capped with its own `overflow-y-auto` so a tall Cities & Knights footer can't crush the
    // board down to nothing.
    <main className="flex h-full min-h-0 flex-col gap-2 overflow-hidden p-4">
      <div className="max-h-[22vh] shrink-0 overflow-y-auto">
        <h1 className="font-display text-20 font-bold text-ink-ondark">{t('hotseat.heading')}</h1>

        {/* `flex-nowrap` + `overflow-x-auto` (rather than wrapping across several rows) keeps this
            toolbar's footprint to one compact row regardless of viewport width, so it never eats
            the vertical space the board/HUD row below needs — it's a one-time-per-game setup
            control, reachable via a horizontal scroll instead. */}
        <div className="hexhaven-panel mt-2 flex flex-nowrap items-end gap-3 overflow-x-auto p-3 [&>*]:shrink-0">
        <TextInput
          label={t('hotseat.setup.seedLabel')}
          value={seedInput}
          onChange={(e) => setSeedInput(e.target.value)}
        />
        <Button variant="subtle" size="sm" onClick={handleRandomSeed}>
          {t('hotseat.setup.randomSeed')}
        </Button>
        <SegmentedControl
          ariaLabel={t('hotseat.setup.tokenMethodLabel')}
          value={tokenMethod}
          onChange={(value) => setTokenMethod(value as TokenMethod)}
          options={[
            { value: 'spiral', label: t('hotseat.setup.tokenSpiral') },
            { value: 'shuffled', label: t('hotseat.setup.tokenShuffled') },
          ]}
        />
        {/* T-607/T-705: same registry-driven picker as the lobby. Mode follows the toggles — Seafarers
            (3–4) shows its scenario, 5–6 shows the fiveSix board, otherwise base (Beginner at 3–4). */}
        <div className="flex flex-col gap-1">
          <p className="font-ui text-12 text-panel">{t('hotseat.setup.boardLabel')}</p>
          <BoardPresetPicker
            ariaLabel={t('hotseat.setup.boardLabel')}
            presets={boardPresetsForMode(
              boardModeForExpansions({
                fiveSix: !seafarersOn && !citiesKnightsOn && playerCount >= 5,
                seafarers:
                  !citiesKnightsOn && seafarersOn && playerCount <= 4 ? { scenario: DEFAULT_SEAFARERS_SCENARIO } : false,
                citiesKnights: citiesKnightsOn && playerCount <= 4,
              }),
            )}
            value={
              !citiesKnightsOn && seafarersOn && playerCount <= 4
                ? DEFAULT_SEAFARERS_SCENARIO
                : !citiesKnightsOn && playerCount >= 5
                  ? 'random'
                  : board
            }
            onChange={(id) => {
              if (!((seafarersOn || citiesKnightsOn) && playerCount <= 4)) setBoard(id as BoardChoice);
            }}
          />
        </div>
        <SegmentedControl
          ariaLabel={t('hotseat.setup.seafarersLabel')}
          value={seafarersOn ? 'on' : 'off'}
          onChange={(value) => {
            const on = value === 'on';
            setSeafarersOn(on);
            if (on) {
              setCitiesKnightsOn(false);
              if (playerCount > 4) setPlayerCount(4);
            }
          }}
          options={[
            { value: 'off', label: t('hotseat.setup.seafarersOff') },
            { value: 'on', label: t('hotseat.setup.seafarersOn') },
          ]}
        />
        {/* T-806: Cities & Knights on/off — 3-4p only, mutually exclusive with Seafarers/fiveSix
            (docs/rules/cities-knights-rules.md C12 "single-expansion only at M8"). */}
        <SegmentedControl
          ariaLabel={t('hotseat.setup.citiesKnightsLabel')}
          value={citiesKnightsOn ? 'on' : 'off'}
          onChange={(value) => {
            const on = value === 'on';
            setCitiesKnightsOn(on);
            if (on) {
              setSeafarersOn(false);
              if (playerCount > 4) setPlayerCount(4);
            }
          }}
          options={[
            { value: 'off', label: t('hotseat.setup.citiesKnightsOff') },
            { value: 'on', label: t('hotseat.setup.citiesKnightsOn') },
          ]}
        />
        <SegmentedControl
          ariaLabel={t('hotseat.setup.playerCountLabel')}
          value={String(playerCount)}
          onChange={(value) => setPlayerCount(Number(value) as HotseatPlayerCount)}
          options={[
            { value: '3', label: '3' },
            { value: '4', label: '4' },
            { value: '5', label: '5', disabled: seafarersOn || citiesKnightsOn },
            { value: '6', label: '6', disabled: seafarersOn || citiesKnightsOn },
          ]}
        />
        {playerCount >= 5 ? (
          <SegmentedControl
            ariaLabel={t('hotseat.setup.turnRuleLabel')}
            value={turnRule}
            onChange={(value) => setTurnRule(value as FiveSixTurnRule)}
            options={[
              { value: 'sbp', label: t('hotseat.setup.turnRuleSbp'), disabled: !SBP_ENABLED },
              { value: 'pairedPlayers', label: t('hotseat.setup.turnRulePaired') },
            ]}
          />
        ) : null}
        <Button size="sm" onClick={handleNewGame}>
          {t('hotseat.setup.newGame')}
        </Button>
        </div>

        <div className="mt-2">
          <SeatBar
            state={state}
            viewedSeat={viewedSeat}
            transport={transport}
            onToast={onToast}
            onSelectSeat={(seat) => transport.setViewedSeat(seat)}
          />
        </div>
      </div>

      {/* The one flexible region: board / HUD sidebar / debug panel, each scrolling itself.
          Priority 4: below `md` this stacks vertically (board on top, bounded by height so it never
          pushes the sidebar/debug panel off-screen); `md:` restores the original 3-column row.
          Board/aside split the row via flex-GROW ratios (`flex-[2]`/`flex-1`), not independent
          fixed `vh` heights — a fixed-vh board plus a fixed-vh debug panel could each demand more
          than this row actually has left once the setup toolbar + footer take their own share on a
          short phone screen, collapsing the aside to 0 height; ratios always sum to exactly the
          row's real height, however small. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden md:flex-row md:items-stretch md:gap-4">
        <div
          className="flex-[2] min-h-0 shrink md:h-auto md:min-h-0 md:min-w-0 md:max-w-[720px] md:flex-1"
          style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.35))' }}
        >
          <BoardView
            board={state.board}
            geometry={geometry}
            hexTerrain={seafarersExt?.hexTerrain}
            seafarersFogHidden={seafarersExt?.fog?.hidden}
          >
            <Pieces
              geometry={geometry}
              roads={roads}
              settlements={settlements}
              cities={cities}
              robber={state.board.robber}
              ships={ships}
              pirate={seafarersExt?.pirate ?? null}
              hexPieces={state.ext?.hexPieces?.pieces ?? []}
            />
            {ck ? (
              <CitiesKnightsPieces geometry={geometry} knights={ckKnights} walls={ckWalls} metropolises={ckMetropolises} />
            ) : null}
            <InteractionLayer geometry={geometry} mode={mode} targets={targets} onPick={onPick} ghostColor={PLAYER_COLORS[viewedSeat]} />
          </BoardView>
        </div>

        {/* Rail redesign (mirrors routes/Game.tsx): tabbed rail instead of a stacked/scrolling
            column — the removed DicePanel's turn info now rides a compact line above the opponent
            list instead of a standalone box. */}
        {/* `md:max-w-[21.5rem]` (was `max-w-xs`/320px, +24px): mirrors routes/Game.tsx's own rail —
            320px was 4px too narrow for the Tabs strip itself ("Players · Bank · Cities & Knights")
            to fit without its `overflow-x-auto` kicking in (worse still in Turkish). */}
        <aside className="flex flex-1 min-h-0 min-w-0 flex-col gap-2 overflow-hidden md:w-full md:max-w-[21.5rem] md:flex-none">
          <Tabs
            ariaLabel={t('hud.rail.tabsLabel')}
            activeId={railTab}
            onChange={(id) => setRailTab(id as RailTab)}
            className="shrink-0"
            tabs={[
              { id: 'players', label: t('hud.rail.tabs.players') },
              { id: 'bank', label: t('hud.rail.tabs.bank') },
              ...(ck ? [{ id: 'ck', label: t('hud.rail.tabs.citiesKnights') }] : []),
            ]}
          />
          <RailSection active={railTab === 'players'}>
            <p className="font-ui text-12 font-semibold text-ink-soft" data-testid="hotseat-turn-indicator">
              {t('hud.turn.indicator', { number: playerView.turn.number, name: seatName(playerView.turn.player) })}
            </p>
            {/* RK-17 re-flow: at 5–6 players the opponents compact into a denser two-column grid so
                five opponent panels don't push the board off-screen; ≤4 stay a single column. */}
            <div className={opponents.length > 3 ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-3'}>
              {opponents.map((entry) => (
                <PlayerPanel
                  key={entry.seat}
                  entry={entry}
                  name={seatName(entry.seat)}
                  active={playerView.turn.player === entry.seat}
                  discardAmount={discardAmountFor(entry.seat)}
                  awards={playerView.awards}
                />
              ))}
            </div>
          </RailSection>
          <RailSection active={railTab === 'bank'}>
            <BankPanel bank={playerView.bank} devDeckCount={playerView.devDeckCount} />
          </RailSection>
          {ck ? (
            <RailSection active={railTab === 'ck'}>
              <CitiesKnightsHud view={playerView} mySeat={viewedSeat} seatName={seatName} />
            </RailSection>
          ) : null}
        </aside>

        {/* DebugPanel (dev-only harness UI, not part of the actual game UI — every real gameplay
            panel/action/dialog stays reachable through the HUD/ActionBar/overlays below, which are
            unaffected by this): hidden below `lg` (1024px) — the 3rd column's own `max-w-sm` (384px)
            plus the HUD aside's `max-w-xs` (320px) already claim ~700px on their own, so showing it
            any earlier (e.g. at the `md`/768px breakpoint, a portrait tablet) leaves the flex-grow
            board with 0px and nothing to shrink into — the original layout dodged this with
            `flex-wrap` (DebugPanel simply wrapped to its own line); the fixed-viewport rewrite can't
            wrap without breaking the "no page scroll" guarantee, so it waits for genuinely wide
            (desktop-scale) viewports instead. `lg:contents` unwraps this div back to a plain
            stretched column in the desktop 3-column row, exactly as before. */}
        <div className="hidden lg:contents">
          <DebugPanel
            state={state}
            uiMode={uiMode}
            onSetUiMode={setUiMode}
            onSendAction={onSendAction}
            transport={transport}
            onToast={onToast}
          />
        </div>
      </div>

      {own ? (
        // Playtest fix (TOP PRIORITY, mirrors routes/Game.tsx): FIXED height, not `max-h-`, so this
        // footer's footprint never tracks its content (full ActionBar row on your turn vs. a short
        // "waiting for X…" line off-turn) — otherwise the board/aside row above (flex-1) grows or
        // shrinks with it and the board visibly resizes between turns. Tall content scrolls inside
        // via the existing `overflow-y-auto`; short content just leaves blank space.
        <div className="hexhaven-panel flex h-[38vh] shrink-0 flex-col gap-2 overflow-y-auto overflow-x-hidden p-2 md:h-[42vh]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Hand own={own} turnNumber={playerView.turn.number} />
            <VpWidget own={own} awards={playerView.awards} view={playerView} />
          </div>
          {/* The real ActionBar (T-403) driven for whichever seat's camera is active — gives the
              hot-seat human the SBP Pass button and the Paired-Players restricted bar (T-603). Its own
              full-width row (not squeezed beside Hand/VpWidget): a shared-row version of this layout
              gave ActionBar less width and made its button row wrap onto an extra line in a real
              Cities & Knights turn — taller footer, not shorter (mirrors routes/Game.tsx's note). */}
          <ActionBar
            view={playerView}
            own={own}
            mySeat={viewedSeat}
            turnPlayerName={seatName(playerView.turn.player)}
            seatName={seatName}
            uiMode={uiMode}
            deadlines={[]}
            dispatch={onSendAction}
            setMode={setUiMode}
          />
          {/* Mirrors routes/Game.tsx's scroll-elimination pass: nothing in the C&K action panel is
              playable during SETUP (no improvement/knight/progress card exists yet), so it waits for
              SETUP to finish before mounting at all rather than forcing footer height for nothing. */}
          {ck && playerView.phase.kind !== 'setup' ? (
            <CkActionPanel
              view={playerView}
              own={own}
              mySeat={viewedSeat}
              seatName={seatName}
              dispatch={onSendAction}
              uiMode={uiMode}
              setMode={setUiMode}
            />
          ) : null}
          {/* T&B action controls (mirrors routes/Game.tsx's mount): every new action for the active
              scenario, including the caravanVote bid form / placeCamel button — gated purely on
              `mySeat`'s own legality (e.g. `phase.pending.includes(seat)`), never on turn ownership,
              so a pending voter sees their control regardless of whose turn it is. */}
          {tb ? (
            <TbActionPanel
              view={playerView}
              mySeat={viewedSeat}
              seatName={seatName}
              dispatch={onSendAction}
              uiMode={uiMode}
              setMode={setUiMode}
            />
          ) : null}
        </div>
      ) : null}

      {/* Real robber/pirate/discard/steal/gold overlays + the Road-Building road/ship chooser, driven
          for whichever seat's camera is active (it auto-follows the actor). Lets a hot-seat Seafarers
          game be played fully through the same UI the online screen uses (T-705). */}
      <RobberOverlay />
      <RoadBuildingBar />
      <BarbarianAttackToasts />
      {/* Priority 3 UI overhaul: center-screen dice-roll celebration, same as the online screen. */}
      <DiceRollOverlay />
    </main>
  );
}
