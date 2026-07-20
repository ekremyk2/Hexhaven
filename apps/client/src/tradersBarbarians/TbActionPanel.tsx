// TbActionPanel (T-1008 requirement B): every new Traders & Barbarians action for the ACTIVE
// scenario, gated on legality straight off the redacted `view` (never invented client-side) and
// routed through the store's `sendAction`, mirroring `citiesKnights/CkActionPanel.tsx`'s role for
// C&K. T&B is a COMPILATION of 5 STANDALONE scenarios (TB8.1) — exactly one is ever active per game,
// so this renders one section, not a tab strip. Base build/trade/dev-card actions are UNCHANGED (T&B
// never disables them, unlike C&K) — `routes/Game.tsx` mounts this ABOVE `FooterCardsPanel`, not
// instead of it.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FISH_EXCHANGE_COST, stealCandidates } from '@hexhaven/engine';
import type { Action, GameState, PlayerView } from '@hexhaven/engine';
import type { FishBenefit, ResourceType, Seat, TBCommodity } from '@hexhaven/shared';
import { PLAYER_BADGES, PLAYER_COLORS } from '../board/palette';
import { ResourceIcon } from '../trade/ResourceIcon';
import { TbCommodityIcon } from './TbCommodityIcon';
import { Button, Tooltip } from '../ui';
import type { UiMode } from '../store/types';
import {
  camelsRemaining,
  computeBuildBridgeState,
  computeCaravanVoteState,
  computeExchangeFishState,
  computeMoveKnightState,
  computeMoveWagonState,
  computePassOldBootState,
  computePlaceCamelState,
  computeRecruitKnightState,
  computeTradeCoinsState,
  wagonDestinations,
  type TbControlState,
} from './tbActionLogic';
import { isBarbarianAttackGame, isCaravansGame, isFishermenGame, isRiversGame, isTradersBarbariansMainGame, oldBootPassTargets, ownWagons, tbOf } from './tbHelpers';

const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const TB_COMMODITY_TYPES: readonly TBCommodity[] = ['marble', 'glass', 'sand', 'tools'];
const FISH_BENEFITS: readonly FishBenefit[] = ['removeRobber', 'steal', 'bankResource', 'freeRoad', 'devCard'];

export interface TbActionPanelProps {
  view: PlayerView;
  mySeat: Seat;
  seatName: (seat: Seat) => string;
  dispatch: (action: Action) => void;
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
}

function reasonText(t: (key: string, opts?: Record<string, unknown>) => string, state: TbControlState): string {
  if (state.enabled || !state.reason) return '';
  if (state.reason === 'cantAfford' && state.missing) {
    return t('reason.cantAfford', { unit: state.missing.unit, need: state.missing.need, have: state.missing.have });
  }
  return t(`reason.${state.reason}`);
}

function GatedButton({
  state,
  testId,
  onClick,
  children,
  t,
}: {
  state: TbControlState;
  testId: string;
  onClick: () => void;
  children: ReactNode;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const button = (
    <Button fullWidth variant="subtle" data-testid={testId} disabled={!state.enabled} onClick={onClick}>
      {children}
    </Button>
  );
  return state.enabled ? button : <Tooltip content={reasonText(t, state)}>{button}</Tooltip>;
}

export function TbActionPanel({ view, mySeat, seatName, dispatch, uiMode, setMode }: TbActionPanelProps) {
  const { t } = useTranslation('tradersBarbarians');
  const tb = tbOf(view);
  if (!tb) return null;

  return (
    <div className="hexhaven-panel flex flex-col gap-2 p-2" data-testid="tb-action-panel">
      {isFishermenGame(view) ? (
        <FishermenControls view={view} mySeat={mySeat} seatName={seatName} dispatch={dispatch} uiMode={uiMode} setMode={setMode} t={t} />
      ) : null}
      {isRiversGame(view) ? (
        <RiversControls view={view} mySeat={mySeat} dispatch={dispatch} uiMode={uiMode} setMode={setMode} t={t} />
      ) : null}
      {isCaravansGame(view) ? (
        <CaravansControls view={view} mySeat={mySeat} seatName={seatName} dispatch={dispatch} uiMode={uiMode} setMode={setMode} t={t} />
      ) : null}
      {isBarbarianAttackGame(view) ? (
        <BarbarianAttackControls view={view} mySeat={mySeat} dispatch={dispatch} uiMode={uiMode} setMode={setMode} t={t} />
      ) : null}
      {isTradersBarbariansMainGame(view) ? (
        <MainScenarioControls view={view} mySeat={mySeat} dispatch={dispatch} t={t} />
      ) : null}
    </div>
  );
}

type Translator = (key: string, opts?: Record<string, unknown>) => string;

// ---- Fishermen (§TB2.4/§TB2.5) --------------------------------------------------------------------

function FishermenControls({
  view,
  mySeat,
  seatName,
  dispatch,
  uiMode,
  setMode,
  t,
}: {
  view: PlayerView;
  mySeat: Seat;
  seatName: (seat: Seat) => string;
  dispatch: (action: Action) => void;
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
  t: Translator;
}) {
  const [picking, setPicking] = useState<'steal' | 'bankResource' | 'oldBoot' | null>(null);
  const tb = tbOf(view);
  const state = view as unknown as GameState;
  const stealTargets = stealCandidates(state);
  const bootTargets = oldBootPassTargets(view, mySeat);

  function benefitClick(benefit: FishBenefit) {
    if (benefit === 'steal' || benefit === 'bankResource') {
      setPicking(benefit);
      return;
    }
    if (benefit === 'freeRoad') {
      setMode(uiMode === 'tbExchangeFishRoad' ? 'idle' : 'tbExchangeFishRoad');
      return;
    }
    dispatch({ type: 'exchangeFish', benefit });
  }

  return (
    <div className="flex flex-col gap-2" data-testid="tb-fishermen-controls">
      <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('fishermen.title')}</p>
      <div className="grid grid-cols-1 gap-1.5">
        {FISH_BENEFITS.map((benefit) => {
          const control = computeExchangeFishState(view, mySeat, benefit);
          const active = benefit === 'freeRoad' && uiMode === 'tbExchangeFishRoad';
          return (
            <GatedButton
              key={benefit}
              testId={`tb-exchange-fish-${benefit}`}
              state={control}
              onClick={() => benefitClick(benefit)}
              t={t}
            >
              {`${t(`fishermen.exchange.${benefit}`, { cost: FISH_EXCHANGE_COST[benefit] })}${active ? ` (${t('fishermen.pickRoadHint')})` : ''}`}
            </GatedButton>
          );
        })}
      </div>
      {picking === 'steal' ? (
        <div className="flex flex-col gap-1" data-testid="tb-fish-steal-picker">
          <p className="font-ui text-12 text-ink-soft">{t('fishermen.pickSteal')}</p>
          <div className="flex flex-wrap gap-1">
            {stealTargets.map((seat) => (
              <button
                key={seat}
                type="button"
                data-testid={`tb-fish-steal-target-${seat}`}
                className="flex items-center gap-1 rounded-card border border-panel-edge px-2 py-1 font-ui text-12"
                onClick={() => {
                  dispatch({ type: 'exchangeFish', benefit: 'steal', from: seat });
                  setPicking(null);
                }}
              >
                <span aria-hidden="true" style={{ color: PLAYER_COLORS[seat] }}>{PLAYER_BADGES[seat]}</span>
                {seatName(seat)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {picking === 'bankResource' ? (
        <div className="flex flex-col gap-1" data-testid="tb-fish-bank-resource-picker">
          <p className="font-ui text-12 text-ink-soft">{t('fishermen.pickResource')}</p>
          <div className="flex flex-wrap gap-1">
            {RESOURCE_TYPES.map((resource) => (
              <button
                key={resource}
                type="button"
                data-testid={`tb-fish-bank-resource-${resource}`}
                onClick={() => {
                  dispatch({ type: 'exchangeFish', benefit: 'bankResource', resource });
                  setPicking(null);
                }}
              >
                <ResourceIcon resource={resource} />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {tb?.oldBoot === mySeat ? (
        <div className="flex flex-col gap-1 border-t border-panel-edge pt-1.5">
          <GatedButton
            testId="tb-pass-old-boot"
            state={computePassOldBootState(view, mySeat)}
            onClick={() => setPicking(picking === 'oldBoot' ? null : 'oldBoot')}
            t={t}
          >
            {t('fishermen.passOldBoot')}
          </GatedButton>
          {picking === 'oldBoot' ? (
            <div className="flex flex-wrap gap-1" data-testid="tb-old-boot-target-picker">
              {bootTargets.map((seat) => (
                <button
                  key={seat}
                  type="button"
                  data-testid={`tb-old-boot-target-${seat}`}
                  className="flex items-center gap-1 rounded-card border border-panel-edge px-2 py-1 font-ui text-12"
                  onClick={() => {
                    dispatch({ type: 'passOldBoot', to: seat });
                    setPicking(null);
                  }}
                >
                  <span aria-hidden="true" style={{ color: PLAYER_COLORS[seat] }}>{PLAYER_BADGES[seat]}</span>
                  {seatName(seat)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---- Rivers (§TB3.2/§TB3.3) -----------------------------------------------------------------------

function RiversControls({
  view,
  mySeat,
  dispatch,
  uiMode,
  setMode,
  t,
}: {
  view: PlayerView;
  mySeat: Seat;
  dispatch: (action: Action) => void;
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
  t: Translator;
}) {
  const [tradeOpen, setTradeOpen] = useState(false);
  const rate = (view.ext?.tradersBarbarians?.coinTradesThisTurn ?? 0) < 2 ? 2 : 4;
  const bridgeState = computeBuildBridgeState(view, mySeat);
  const tradeState = computeTradeCoinsState(view, mySeat);
  const active = uiMode === 'tbBuildingBridge';

  return (
    <div className="flex flex-col gap-2" data-testid="tb-rivers-controls">
      <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('rivers.title')}</p>
      <GatedButton
        testId="tb-build-bridge"
        state={bridgeState}
        onClick={() => setMode(active ? 'idle' : 'tbBuildingBridge')}
        t={t}
      >
        {t('rivers.buildBridge')}
      </GatedButton>
      <GatedButton testId="tb-trade-coins" state={tradeState} onClick={() => setTradeOpen((v) => !v)} t={t}>
        {`${t('rivers.tradeCoins')} — ${t('rivers.tradeRate', { rate })}`}
      </GatedButton>
      {tradeOpen ? (
        <div className="flex flex-col gap-1" data-testid="tb-trade-coins-picker">
          <p className="font-ui text-12 text-ink-soft">{t('rivers.pickReceive')}</p>
          <div className="flex flex-wrap gap-1">
            {RESOURCE_TYPES.map((resource) => (
              <button
                key={resource}
                type="button"
                data-testid={`tb-trade-coins-receive-${resource}`}
                onClick={() => {
                  dispatch({ type: 'tradeCoins', give: rate, receive: resource });
                  setTradeOpen(false);
                }}
              >
                <ResourceIcon resource={resource} />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---- Caravans (§TB4.2) ----------------------------------------------------------------------------

function CaravansControls({
  view,
  mySeat,
  seatName,
  dispatch,
  uiMode,
  setMode,
  t,
}: {
  view: PlayerView;
  mySeat: Seat;
  seatName: (seat: Seat) => string;
  dispatch: (action: Action) => void;
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
  t: Translator;
}) {
  const [grain, setGrain] = useState(0);
  const [wool, setWool] = useState(0);
  const phase = view.phase;
  const voteState = computeCaravanVoteState(view, mySeat);
  const camelState = computePlaceCamelState(view, mySeat);
  const active = uiMode === 'tbPlacingCamel';

  return (
    <div className="flex flex-col gap-2" data-testid="tb-caravans-controls">
      <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('caravans.title')}</p>
      <p className="font-ui text-12 text-ink-soft">{t('caravans.camelsRemaining', { count: camelsRemaining(view) })}</p>
      {phase.kind === 'caravanVote' ? (
        voteState.enabled ? (
          <div className="flex flex-col gap-1.5" data-testid="tb-caravan-bid">
            <p className="font-ui text-12 text-ink-soft">{t('caravans.bidLabel')}</p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 font-ui text-12">
                {t('caravans.grain')}
                <input
                  type="number"
                  min={0}
                  value={grain}
                  data-testid="tb-caravan-bid-grain"
                  onChange={(e) => setGrain(Math.max(0, Number(e.target.value) || 0))}
                  className="w-14 rounded border border-panel-edge px-1"
                />
              </label>
              <label className="flex items-center gap-1 font-ui text-12">
                {t('caravans.wool')}
                <input
                  type="number"
                  min={0}
                  value={wool}
                  data-testid="tb-caravan-bid-wool"
                  onChange={(e) => setWool(Math.max(0, Number(e.target.value) || 0))}
                  className="w-14 rounded border border-panel-edge px-1"
                />
              </label>
            </div>
            <Button
              data-testid="tb-caravan-bid-submit"
              onClick={() => {
                dispatch({ type: 'caravanVote', grain, wool });
                setGrain(0);
                setWool(0);
              }}
            >
              {t('caravans.submitBid')}
            </Button>
          </div>
        ) : camelState.enabled || active ? (
          <GatedButton
            testId="tb-place-camel"
            state={camelState}
            onClick={() => setMode(active ? 'idle' : 'tbPlacingCamel')}
            t={t}
          >
            {active ? t('caravans.placeCamelHint') : t('caravans.youWon')}
          </GatedButton>
        ) : (
          <p className="font-ui text-12 italic text-ink-soft" data-testid="tb-caravan-waiting">
            {phase.winner != null
              ? t('caravans.winnerIs', { name: seatName(phase.winner) })
              : t('caravans.waitingForOthers')}
          </p>
        )
      ) : null}
    </div>
  );
}

// ---- Barbarian Attack (§TB5.2) --------------------------------------------------------------------

function BarbarianAttackControls({
  view,
  mySeat,
  dispatch,
  uiMode,
  setMode,
  t,
}: {
  view: PlayerView;
  mySeat: Seat;
  dispatch: (action: Action) => void;
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
  t: Translator;
}) {
  void dispatch; // board-mode actions dispatch via `store/uiMode.ts`'s `useUiInteraction`, not here.
  const recruitState = computeRecruitKnightState(view, mySeat);
  const moveState = computeMoveKnightState(view, mySeat);
  const recruitActive = uiMode === 'tbRecruitingKnight';
  const moveActive = uiMode === 'tbMovingKnight';

  return (
    <div className="flex flex-col gap-2" data-testid="tb-barbarian-attack-controls">
      <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('barbarianAttack.title')}</p>
      <GatedButton
        testId="tb-recruit-knight"
        state={recruitState}
        onClick={() => setMode(recruitActive ? 'idle' : 'tbRecruitingKnight')}
        t={t}
      >
        {t('barbarianAttack.recruitKnight')}
      </GatedButton>
      <GatedButton
        testId="tb-move-knight"
        state={moveState}
        onClick={() => setMode(moveActive ? 'idle' : 'tbMovingKnight')}
        t={t}
      >
        {t('barbarianAttack.moveKnight')}
      </GatedButton>
      {moveActive ? (
        <p className="font-ui text-12 italic text-ink-soft">{t('barbarianAttack.extendHint')}</p>
      ) : null}
    </div>
  );
}

// ---- The main scenario (§TB6.2/§TB6.3) -------------------------------------------------------------

function MainScenarioControls({
  view,
  mySeat,
  dispatch,
  t,
}: {
  view: PlayerView;
  mySeat: Seat;
  dispatch: (action: Action) => void;
  t: Translator;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [load, setLoad] = useState<TBCommodity | ''>('');
  const wagons = ownWagons(view, mySeat);
  const moveState = computeMoveWagonState(view, mySeat);
  const destinations = selected != null ? wagonDestinations(view, mySeat, selected) : [];

  return (
    <div className="flex flex-col gap-2" data-testid="tb-main-controls">
      <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('main.title')}</p>
      {wagons.length === 0 ? (
        <p className="font-ui text-12 italic text-ink-soft">{t('main.noWagons')}</p>
      ) : !moveState.enabled ? (
        <p className="font-ui text-12 italic text-ink-soft">{reasonText(t, moveState)}</p>
      ) : (
        <div className="flex flex-col gap-1.5" data-testid="tb-wagon-list">
          <div className="flex flex-wrap gap-1">
            {wagons.map((w) => (
              <button
                key={w.index}
                type="button"
                data-testid={`tb-wagon-${w.index}`}
                onClick={() => setSelected(selected === w.index ? null : w.index)}
                className={[
                  'rounded-card border px-2 py-1 font-ui text-12',
                  selected === w.index ? 'border-accent bg-accent/10' : 'border-panel-edge',
                ].join(' ')}
              >
                {t('main.wagonAt', { vertex: w.at })}
                {w.cargo ? ` — ${t(`main.commodity.${w.cargo}`)}` : ''}
              </button>
            ))}
          </div>
          {selected != null ? (
            <>
              <div className="flex items-center gap-1 font-ui text-12" data-testid="tb-wagon-load-picker">
                <span className="text-ink-soft">{t('main.loadLabel')}</span>
                <select
                  value={load}
                  data-testid="tb-wagon-load-select"
                  onChange={(e) => setLoad(e.target.value as TBCommodity | '')}
                  className="rounded border border-panel-edge px-1"
                >
                  <option value="">{t('main.loadNone')}</option>
                  {TB_COMMODITY_TYPES.map((c) => (
                    <option key={c} value={c}>
                      {t(`main.commodity.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1" data-testid="tb-wagon-destinations">
                {destinations.map((d) => (
                  <Button
                    key={d.to}
                    variant="subtle"
                    fullWidth
                    data-testid={`tb-wagon-destination-${d.to}`}
                    onClick={() => {
                      dispatch({
                        type: 'moveWagon',
                        wagon: selected,
                        path: d.path,
                        ...(load ? { load } : {}),
                      });
                      setSelected(null);
                      setLoad('');
                    }}
                  >
                    {t('main.destination', { mp: d.mpCost, gold: d.goldCost })}
                  </Button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap gap-1 border-t border-panel-edge pt-1.5" data-testid="tb-commodities">
        {TB_COMMODITY_TYPES.map((c) => (
          <TbCommodityIcon key={c} commodity={c} count={view.ext?.tradersBarbarians?.commodities?.[mySeat]?.[c] ?? 0} />
        ))}
      </div>
    </div>
  );
}
