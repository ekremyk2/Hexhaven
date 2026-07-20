// Dev preview of the board renderer (T-302/T-303) — a real generated board plus demo pieces.
// T-304 extends this same fixture with a mode switcher over <InteractionLayer>, PM-eyeballing
// every interaction mode's legal-target highlighting against the engine's own `legal.ts` (via
// `computeUiTargets`/`resolvePick` — the exact functions the real client will use once T-403
// wires a live `uiMode` through). Not a game screen; the hot-seat harness (T-305) and HUD (T-402)
// compose these components for real.
//
// T-704 adds a "board variant" switch so the PM can eyeball the Seafarers "Heading for New Shores"
// scenario (3p + 4p) — sea/gold hexes, ships, the pirate, and island-chit markers — without shipping
// Seafarers (SHIPPED_EXPANSIONS.seafarers stays off; interactions are T-705). The scenario board is a
// real `createGame` output; ships/pirate/chits are sample fixtures purely to exercise the renderers.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createGame, type GameConfig } from '@hexhaven/engine';
import { getScenario } from '@hexhaven/shared';
import type { EdgeId, GameState, HexId, ScenarioTerrain, Seat, VertexId } from '@hexhaven/shared';
import { BoardView } from '../board/BoardView';
import { boardGeometryFor } from '../board/geometry';
import { InteractionLayer } from '../board/InteractionLayer';
import { Pieces } from '../board/Pieces';
import { PLAYER_COLORS } from '../board/palette';
import { computeUiTargets, resolvePick } from '../store/uiMode';
import type { UiMode } from '../store/types';
import { SegmentedControl } from '../ui';

const FIXTURE_SEAT = 0 as Seat;

// Hand-picked ids purely to show every piece type in every colour.
const DEMO = {
  roads: [
    { edge: 10 as EdgeId, seat: 0 as Seat },
    { edge: 24 as EdgeId, seat: 1 as Seat },
    { edge: 45 as EdgeId, seat: 2 as Seat },
    { edge: 60 as EdgeId, seat: 3 as Seat },
    { edge: 33 as EdgeId, seat: 0 as Seat },
  ],
  settlements: [
    { vertex: 8 as VertexId, seat: 0 as Seat },
    { vertex: 22 as VertexId, seat: 1 as Seat },
    { vertex: 40 as VertexId, seat: 2 as Seat },
    { vertex: 47 as VertexId, seat: 3 as Seat },
  ],
  cities: [
    { vertex: 15 as VertexId, seat: 1 as Seat },
    { vertex: 31 as VertexId, seat: 3 as Seat },
  ],
};

/** Two GameStates sharing one board/seed: `raw` is straight off `createGame` (fresh setup phase,
 * empty board — feeds the setup-settlement mode's `legalSetupSettlements`); `main` mirrors seat
 * 0's DEMO pieces above into its `PlayerState` (main phase) so the road/city modes' legal targets
 * line up with what `<Pieces>` actually draws — e.g. the city mode's one legal target sits right
 * on top of seat 0's existing settlement glyph. */
function fixtureStates(seed: string): { raw: GameState; main: GameState } {
  const config: GameConfig = {
    playerCount: 4,
    targetVp: 10,
    seed,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
  };
  const raw = createGame(config);
  const players = raw.players.map((p) =>
    p.seat === FIXTURE_SEAT
      ? {
          ...p,
          settlements: DEMO.settlements.filter((s) => s.seat === FIXTURE_SEAT).map((s) => s.vertex),
          roads: DEMO.roads.filter((r) => r.seat === FIXTURE_SEAT).map((r) => r.edge),
        }
      : p,
  );
  const main: GameState = {
    ...raw,
    players,
    phase: { kind: 'main' },
    turn: { ...raw.turn, player: FIXTURE_SEAT, rolled: true },
  };
  return { raw, main };
}

type PreviewMode = 'setupSettlement' | 'road' | 'city' | 'robber';

/** Which `uiMode` (store/types.ts) each preview option stands in for, and — for modes that don't
 * apply directly to `raw`/`main` as-is — how to derive the view they need. */
const PREVIEW_UI_MODE: Record<PreviewMode, UiMode> = {
  setupSettlement: 'placingSettlement',
  road: 'placingRoad',
  city: 'placingCity',
  robber: 'movingRobber',
};

function viewFor(mode: PreviewMode, states: { raw: GameState; main: GameState }): GameState {
  switch (mode) {
    case 'setupSettlement':
      return states.raw;
    case 'robber':
      return { ...states.main, phase: { kind: 'moveRobber', returnTo: 'main' } };
    case 'road':
    case 'city':
      return states.main;
    default: {
      const exhaustiveCheck: never = mode;
      return exhaustiveCheck;
    }
  }
}

type BoardVariant = 'base' | 'seafarers3' | 'seafarers4';

const SEAFARERS_PLAYER_COUNT: Record<Exclude<BoardVariant, 'base'>, 3 | 4> = {
  seafarers3: 3,
  seafarers4: 4,
};

interface SeafarersFixture {
  board: GameState['board'];
  hexTerrain: readonly ScenarioTerrain[];
  ships: { edge: EdgeId; seat: Seat }[];
  pirate: HexId;
  islandChits: { hex: HexId; seat: Seat }[];
}

/** Build a real Seafarers scenario board via `createGame`, then decorate it with SAMPLE ships, the
 * pirate, and island-chit markers so every Seafarers renderer is exercised in the preview. Ships go
 * on the first few sea edges (an edge is a sea edge when a neighbouring hex is sea, S3.1); chits sit
 * on one representative hex per small island (scenario data carries the island grouping). */
function seafarersFixture(playerCount: 3 | 4): SeafarersFixture {
  const config: GameConfig = {
    playerCount,
    targetVp: 14,
    seed: `heading-${playerCount}`,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
  };
  const state = createGame(config);
  const geometry = boardGeometryFor(config);
  const sea = state.ext?.seafarers;
  if (!sea) throw new Error('BUG: seafarers preview created a non-seafarers game');
  const hexTerrain = sea.hexTerrain;

  const seaEdges = geometry.edges
    .filter((e) => e.hexes.some((h) => hexTerrain[h] === 'sea'))
    .map((e) => e.id);
  const ships = seaEdges.slice(0, 6).map((edge, i) => ({ edge, seat: (i % playerCount) as Seat }));

  // One representative hex per small-island group (scenario `hexes` are HexId-aligned, carry `island`).
  const scenarioHexes = getScenario('headingForNewShores')?.boards[playerCount]?.hexes ?? [];
  const islandFirstHex = new Map<number, HexId>();
  scenarioHexes.forEach((h, hexId) => {
    if (h.island !== undefined && !islandFirstHex.has(h.island)) {
      islandFirstHex.set(h.island, hexId as HexId);
    }
  });
  const islandChits = [...islandFirstHex.entries()]
    .slice(0, playerCount)
    .map(([island, hex]) => ({ hex, seat: (island % playerCount) as Seat }));

  return { board: state.board, hexTerrain, ships, pirate: sea.pirate, islandChits };
}

export default function BoardPreview() {
  const { t } = useTranslation('game');
  const [seed, setSeed] = useState('demo-1');
  const [variant, setVariant] = useState<BoardVariant>('base');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('setupSettlement');
  const [lastPick, setLastPick] = useState<string | null>(null);

  const states = useMemo(() => fixtureStates(seed), [seed]);
  const board = states.raw.board;
  const viewState = viewFor(previewMode, states);
  const uiMode = PREVIEW_UI_MODE[previewMode];
  const { mode, targets } = computeUiTargets(viewState, FIXTURE_SEAT, uiMode);

  const isSeafarers = variant !== 'base';
  const seaFixture = useMemo(
    () => (isSeafarers ? seafarersFixture(SEAFARERS_PLAYER_COUNT[variant as Exclude<BoardVariant, 'base'>]) : null),
    [variant, isSeafarers],
  );
  const seaGeometry = useMemo(
    () =>
      isSeafarers
        ? boardGeometryFor({
            playerCount: SEAFARERS_PLAYER_COUNT[variant as Exclude<BoardVariant, 'base'>],
            expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
          })
        : undefined,
    [variant, isSeafarers],
  );

  const modeOptions = (Object.keys(PREVIEW_UI_MODE) as PreviewMode[]).map((value) => ({
    value,
    label: t(`preview.interaction.modes.${value}`),
  }));

  const variantOptions = (['base', 'seafarers3', 'seafarers4'] as BoardVariant[]).map((value) => ({
    value,
    label: t(`preview.variant.${value}`),
  }));

  function handlePick(id: number) {
    const action = resolvePick(viewState, FIXTURE_SEAT, uiMode, id);
    setLastPick(action ? JSON.stringify(action) : null);
  }

  return (
    <main className="hexhaven-table flex flex-col items-center gap-4 p-6">
      <h1 className="font-display text-3xl font-bold text-[var(--ink-ondark)]">{t('preview.title')}</h1>
      <SegmentedControl
        options={variantOptions}
        value={variant}
        onChange={(value) => {
          setVariant(value as BoardVariant);
          setLastPick(null);
        }}
        ariaLabel={t('preview.variant.ariaLabel')}
      />

      {!isSeafarers && (
        <>
          <div className="flex items-center gap-2 text-sm text-[var(--ink-ondark)]">
            <label htmlFor="seed">{t('preview.seedLabel')}</label>
            <input
              id="seed"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="rounded bg-[var(--field)] px-2 py-1 text-[var(--ink)]"
            />
            <button
              onClick={() => setSeed(Math.random().toString(36).slice(2, 8))}
              className="rounded bg-[var(--accent)] px-3 py-1 font-semibold text-white"
            >
              {t('preview.randomButton')}
            </button>
          </div>
          <SegmentedControl
            options={modeOptions}
            value={previewMode}
            onChange={(value) => {
              setPreviewMode(value as PreviewMode);
              setLastPick(null);
            }}
            ariaLabel={t('preview.interaction.ariaLabel')}
          />
          <p className="text-sm text-[var(--ink-ondark)]">
            {t('preview.interaction.lastPick', {
              value: lastPick ?? t('preview.interaction.lastPickNone'),
            })}
          </p>
        </>
      )}

      {isSeafarers && (
        <p className="text-sm text-[var(--ink-ondark)]">{t('preview.variant.seafarersNote')}</p>
      )}

      <div className="w-full max-w-[820px]" style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.35))' }}>
        {isSeafarers && seaFixture ? (
          <BoardView board={seaFixture.board} geometry={seaGeometry} hexTerrain={seaFixture.hexTerrain}>
            <Pieces
              geometry={seaGeometry}
              ships={seaFixture.ships}
              pirate={seaFixture.pirate}
              islandChits={seaFixture.islandChits}
            />
          </BoardView>
        ) : (
          <BoardView board={board}>
            <Pieces
              roads={DEMO.roads}
              settlements={DEMO.settlements}
              cities={DEMO.cities}
              robber={board.robber}
            />
            <InteractionLayer
              mode={mode}
              targets={targets}
              onPick={handlePick}
              ghostColor={PLAYER_COLORS[FIXTURE_SEAT]}
            />
          </BoardView>
        )}
      </div>
    </main>
  );
}
