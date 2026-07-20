// EpActionPanel (T-1108 requirement B, widened by T-1154): every E&P action, gated on legality
// straight off the redacted `view` (never invented client-side) and routed through the store's
// `sendAction`/`setMode`, mirroring `tradersBarbarians/TbActionPanel.tsx`'s role for T&B. The EP3/EP4
// core-loop controls (build/move ship, build settler, load/unload it onto a ship, found a settlement,
// upgrade to a harbor settlement) are shared by EVERY E&P scenario (they all reuse Land Ho!'s own
// board/movement/founding frame, `modules/explorersPirates/state.ts`'s own header) — T-1154 widens this
// panel's top-level gate from "Land Ho! only" to "any live E&P game" accordingly, then appends one
// section per MISSION (fish/spice/pirate lairs) plus a gold section, each shown only when that
// scenario's own `EP_SCENARIO_CONFIG` flag turns it on (`epHelpers.ts`'s `is*MissionActive`) — Land
// Ho! shows none of the new sections, the full campaign shows all three plus gold. Base
// build/trade/dev-card actions are UNCHANGED (E&P never disables them) — `routes/Game.tsx` mounts this
// ABOVE `FooterCardsPanel`, not instead of it (same slot T&B uses).
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Action, PlayerView } from '@hexhaven/engine';
import type { EPCargo, Seat } from '@hexhaven/shared';
import { Button, Tooltip } from '../ui';
import type { UiMode } from '../store/types';
import {
  computeBuildEPCrewState,
  computeBuildEPShipState,
  computeBuildEPSettlerState,
  computeDeliverFishState,
  computeDeliverSpiceState,
  computeFoundSettlementState,
  computeLoadCrewState,
  computeLoadSettlerState,
  computeMoveEPShipState,
  computePlaceCrewOnLairState,
  computeShipGoldState,
  computeTradeSpiceState,
  computeUnloadSettlerState,
  computeUpgradeToHarborState,
  legalPlaceCrewOnLairTargets,
  legalTradeSpiceHexes,
  loadCrewShipTargets,
  loadSettlerShipTargets,
  unloadSettlerShipTargets,
  type EpControlState,
} from './epActionLogic';
import {
  epOf,
  isExplorersPiratesGame,
  isAnyEpMissionActive,
  isFishMissionActive,
  isPirateLairsMissionActive,
  isSpiceMissionActive,
} from './epHelpers';

type Translator = (key: string, opts?: Record<string, unknown>) => string;

function reasonText(t: Translator, state: EpControlState): string {
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
  state: EpControlState;
  testId: string;
  onClick: () => void;
  children: ReactNode;
  t: Translator;
}) {
  const button = (
    <Button fullWidth variant="subtle" data-testid={testId} disabled={!state.enabled} onClick={onClick}>
      {children}
    </Button>
  );
  return state.enabled ? button : <Tooltip content={reasonText(t, state)}>{button}</Tooltip>;
}

/** T-1154: the ships list (below) used to assume a ship's only possible cargo was `'settler'` (true
 *  when only Land Ho! was wired up) — now that mission ships can also carry `'crew'`/`'fish'`/`'spice'`,
 *  every cargo piece actually in the bay is named, joined, rather than mislabeling any non-empty bay
 *  as "settler". */
function cargoLabel(t: Translator, cargo: readonly EPCargo[]): string {
  if (cargo.length === 0) return t('landHo.cargoEmpty');
  return cargo.map((piece) => t(`landHo.cargo${piece[0]!.toUpperCase()}${piece.slice(1)}`)).join(', ');
}

export interface EpActionPanelProps {
  view: PlayerView;
  mySeat: Seat;
  dispatch: (action: Action) => void;
  uiMode: UiMode;
  setMode: (mode: UiMode) => void;
}

type Picking = 'load' | 'unload' | 'loadCrew' | 'tradeSpice' | 'placeCrewOnLair' | null;

export function EpActionPanel({ view, mySeat, dispatch, uiMode, setMode }: EpActionPanelProps) {
  const { t } = useTranslation('explorersPirates');
  const [picking, setPicking] = useState<Picking>(null);
  const ep = epOf(view);
  if (!ep || !isExplorersPiratesGame(view)) return null;

  const buildShipState = computeBuildEPShipState(view, mySeat);
  const moveShipState = computeMoveEPShipState(view, mySeat);
  const buildSettlerState = computeBuildEPSettlerState(view, mySeat);
  const foundSettlementState = computeFoundSettlementState(view, mySeat);
  const upgradeHarborState = computeUpgradeToHarborState(view, mySeat);
  const loadSettlerState = computeLoadSettlerState(view, mySeat);
  const unloadSettlerState = computeUnloadSettlerState(view, mySeat);

  const fishMissionActive = isFishMissionActive(view);
  const spiceMissionActive = isSpiceMissionActive(view);
  const pirateLairsMissionActive = isPirateLairsMissionActive(view);
  const goldMissionActive = isAnyEpMissionActive(view);

  const deliverFishState = fishMissionActive ? computeDeliverFishState(view, mySeat) : null;
  const deliverSpiceState = spiceMissionActive ? computeDeliverSpiceState(view, mySeat) : null;
  const tradeSpiceState = spiceMissionActive ? computeTradeSpiceState(view, mySeat) : null;
  const tradeSpiceTargets = tradeSpiceState?.enabled ? legalTradeSpiceHexes(view, mySeat) : [];
  const buildCrewState = pirateLairsMissionActive ? computeBuildEPCrewState(view, mySeat) : null;
  const loadCrewState = pirateLairsMissionActive ? computeLoadCrewState(view, mySeat) : null;
  const loadCrewTargets = loadCrewState?.enabled ? loadCrewShipTargets(view, mySeat) : [];
  const placeCrewOnLairState = pirateLairsMissionActive ? computePlaceCrewOnLairState(view, mySeat) : null;
  const placeCrewOnLairTargets = placeCrewOnLairState?.enabled
    ? legalPlaceCrewOnLairTargets(view, mySeat)
    : [];
  const shipGoldState = goldMissionActive ? computeShipGoldState(view, mySeat) : null;

  const buildingShipActive = uiMode === 'epBuildingShip';
  const movingShipActive = uiMode === 'epMovingShip';
  const foundingActive = uiMode === 'epFoundingSettlement';
  const upgradingActive = uiMode === 'epUpgradingHarbor';

  const loadTargets = loadSettlerState.enabled ? loadSettlerShipTargets(view, mySeat) : [];
  const unloadTargets = unloadSettlerState.enabled ? unloadSettlerShipTargets(view, mySeat) : [];

  return (
    <div className="hexhaven-panel flex flex-col gap-2 p-2" data-testid="ep-action-panel">
      <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('landHo.title')}</p>

      <GatedButton
        testId="ep-build-ship"
        state={buildShipState}
        onClick={() => setMode(buildingShipActive ? 'idle' : 'epBuildingShip')}
        t={t}
      >
        {t('landHo.buildShip')}
      </GatedButton>

      <GatedButton
        testId="ep-move-ship"
        state={moveShipState}
        onClick={() => setMode(movingShipActive ? 'idle' : 'epMovingShip')}
        t={t}
      >
        {movingShipActive ? `${t('landHo.moveShip')} — ${t('landHo.moveShipHint')}` : t('landHo.moveShip')}
      </GatedButton>

      <GatedButton
        testId="ep-build-settler"
        state={buildSettlerState}
        onClick={() => dispatch({ type: 'buildEPSettler' })}
        t={t}
      >
        {t('landHo.buildSettler')}
      </GatedButton>

      <GatedButton
        testId="ep-load-settler"
        state={loadSettlerState}
        onClick={() => {
          // A single eligible ship dispatches straight away; more than one opens a small picker
          // (mirrors `TbActionPanel`'s fish steal-target/bank-resource pickers) rather than silently
          // guessing which ship the player meant.
          if (loadTargets.length === 1) {
            dispatch({ type: 'loadCargo', ship: loadTargets[0]!, piece: 'settler' });
          } else {
            setPicking(picking === 'load' ? null : 'load');
          }
        }}
        t={t}
      >
        {t('landHo.loadSettler')}
      </GatedButton>
      {picking === 'load' ? (
        <div className="flex flex-wrap gap-1" data-testid="ep-load-settler-picker">
          {loadTargets.map((edge) => (
            <button
              key={edge}
              type="button"
              data-testid={`ep-load-settler-target-${edge}`}
              className="rounded-card border border-panel-edge px-2 py-1 font-ui text-12"
              onClick={() => {
                dispatch({ type: 'loadCargo', ship: edge, piece: 'settler' });
                setPicking(null);
              }}
            >
              {t('landHo.shipAt', { edge, cargo: t('landHo.cargoEmpty') })}
            </button>
          ))}
        </div>
      ) : null}

      <GatedButton
        testId="ep-unload-settler"
        state={unloadSettlerState}
        onClick={() => {
          if (unloadTargets.length === 1) {
            dispatch({ type: 'unloadCargo', ship: unloadTargets[0]!, piece: 'settler' });
          } else {
            setPicking(picking === 'unload' ? null : 'unload');
          }
        }}
        t={t}
      >
        {t('landHo.unloadSettler')}
      </GatedButton>
      {picking === 'unload' ? (
        <div className="flex flex-wrap gap-1" data-testid="ep-unload-settler-picker">
          {unloadTargets.map((edge) => (
            <button
              key={edge}
              type="button"
              data-testid={`ep-unload-settler-target-${edge}`}
              className="rounded-card border border-panel-edge px-2 py-1 font-ui text-12"
              onClick={() => {
                dispatch({ type: 'unloadCargo', ship: edge, piece: 'settler' });
                setPicking(null);
              }}
            >
              {t('landHo.shipAt', { edge, cargo: t('landHo.cargoSettler') })}
            </button>
          ))}
        </div>
      ) : null}

      <GatedButton
        testId="ep-found-settlement"
        state={foundSettlementState}
        onClick={() => setMode(foundingActive ? 'idle' : 'epFoundingSettlement')}
        t={t}
      >
        {foundingActive
          ? `${t('landHo.foundSettlement')} — ${t('landHo.foundSettlementHint')}`
          : t('landHo.foundSettlement')}
      </GatedButton>

      <GatedButton
        testId="ep-upgrade-to-harbor"
        state={upgradeHarborState}
        onClick={() => setMode(upgradingActive ? 'idle' : 'epUpgradingHarbor')}
        t={t}
      >
        {upgradingActive
          ? `${t('landHo.upgradeToHarbor')} — ${t('landHo.upgradeToHarborHint')}`
          : t('landHo.upgradeToHarbor')}
      </GatedButton>

      <div className="flex flex-col gap-1 border-t border-panel-edge pt-1.5" data-testid="ep-ships-list">
        <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('landHo.shipsTitle')}</p>
        {ep.ships.filter((s) => s.seat === mySeat).length === 0 ? (
          <p className="font-ui text-12 italic text-ink-soft">{t('landHo.noShips')}</p>
        ) : (
          ep.ships
            .filter((s) => s.seat === mySeat)
            .map((s) => (
              <p key={s.edge} className="font-ui text-12 text-ink" data-testid={`ep-ship-${s.edge}`}>
                {t('landHo.shipAt', { edge: s.edge, cargo: cargoLabel(t, s.cargo) })}
              </p>
            ))
        )}
      </div>

      {fishMissionActive && deliverFishState ? (
        <div className="flex flex-col gap-2 border-t border-panel-edge pt-1.5" data-testid="ep-fish-controls">
          <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('fish.title')}</p>
          <GatedButton
            testId="ep-deliver-fish"
            state={deliverFishState}
            onClick={() => dispatch({ type: 'deliverFish' })}
            t={t}
          >
            {t('fish.deliverFish')}
          </GatedButton>
        </div>
      ) : null}

      {spiceMissionActive && tradeSpiceState && deliverSpiceState ? (
        <div className="flex flex-col gap-2 border-t border-panel-edge pt-1.5" data-testid="ep-spice-controls">
          <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('spice.title')}</p>
          <GatedButton
            testId="ep-trade-spice"
            state={tradeSpiceState}
            onClick={() => setPicking(picking === 'tradeSpice' ? null : 'tradeSpice')}
            t={t}
          >
            {t('spice.tradeSpice')}
          </GatedButton>
          {picking === 'tradeSpice' ? (
            <div className="flex flex-wrap gap-1" data-testid="ep-trade-spice-picker">
              {tradeSpiceTargets.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  data-testid={`ep-trade-spice-target-${hex}`}
                  className="rounded-card border border-panel-edge px-2 py-1 font-ui text-12"
                  onClick={() => {
                    dispatch({ type: 'tradeSpice', hex });
                    setPicking(null);
                  }}
                >
                  {t('spice.villageAt', { hex })}
                </button>
              ))}
            </div>
          ) : null}
          <GatedButton
            testId="ep-deliver-spice"
            state={deliverSpiceState}
            onClick={() => dispatch({ type: 'deliverSpice' })}
            t={t}
          >
            {t('spice.deliverSpice')}
          </GatedButton>
        </div>
      ) : null}

      {pirateLairsMissionActive && buildCrewState && loadCrewState && placeCrewOnLairState ? (
        <div className="flex flex-col gap-2 border-t border-panel-edge pt-1.5" data-testid="ep-pirate-lairs-controls">
          <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('pirateLairs.title')}</p>
          <GatedButton
            testId="ep-build-crew"
            state={buildCrewState}
            onClick={() => dispatch({ type: 'buildEPCrew' })}
            t={t}
          >
            {t('pirateLairs.buildCrew')}
          </GatedButton>
          <GatedButton
            testId="ep-load-crew"
            state={loadCrewState}
            onClick={() => {
              if (loadCrewTargets.length === 1) {
                dispatch({ type: 'loadCargo', ship: loadCrewTargets[0]!, piece: 'crew' });
              } else {
                setPicking(picking === 'loadCrew' ? null : 'loadCrew');
              }
            }}
            t={t}
          >
            {t('pirateLairs.loadCrew')}
          </GatedButton>
          {picking === 'loadCrew' ? (
            <div className="flex flex-wrap gap-1" data-testid="ep-load-crew-picker">
              {loadCrewTargets.map((edge) => (
                <button
                  key={edge}
                  type="button"
                  data-testid={`ep-load-crew-target-${edge}`}
                  className="rounded-card border border-panel-edge px-2 py-1 font-ui text-12"
                  onClick={() => {
                    dispatch({ type: 'loadCargo', ship: edge, piece: 'crew' });
                    setPicking(null);
                  }}
                >
                  {t('landHo.shipAt', { edge, cargo: t('landHo.cargoEmpty') })}
                </button>
              ))}
            </div>
          ) : null}
          <GatedButton
            testId="ep-place-crew-on-lair"
            state={placeCrewOnLairState}
            onClick={() => setPicking(picking === 'placeCrewOnLair' ? null : 'placeCrewOnLair')}
            t={t}
          >
            {t('pirateLairs.placeCrewOnLair')}
          </GatedButton>
          {picking === 'placeCrewOnLair' ? (
            <div className="flex flex-wrap gap-1" data-testid="ep-place-crew-on-lair-picker">
              {placeCrewOnLairTargets.map(({ hex, crews }) => (
                <button
                  key={hex}
                  type="button"
                  data-testid={`ep-place-crew-on-lair-target-${hex}`}
                  className="rounded-card border border-panel-edge px-2 py-1 font-ui text-12"
                  onClick={() => {
                    dispatch({ type: 'placeCrewOnLair', hex });
                    setPicking(null);
                  }}
                >
                  {t('pirateLairs.lairAt', { hex, crews })}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {goldMissionActive && shipGoldState ? (
        <div className="flex flex-col gap-2 border-t border-panel-edge pt-1.5" data-testid="ep-gold-controls">
          <GatedButton testId="ep-ship-gold" state={shipGoldState} onClick={() => dispatch({ type: 'shipGold' })} t={t}>
            {t('gold.shipGold')}
          </GatedButton>
        </div>
      ) : null}
    </div>
  );
}
