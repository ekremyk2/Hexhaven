// T-1108: `epHelpers.ts`'s pure lookups, exercised over a real `redact(createGame(...), seat)`
// PlayerView (never hand-faked) so the E&P ext shape matches exactly what the client receives —
// mirrors `tradersBarbarians/tbHelpers.test.ts`'s own convention.
import { describe, expect, it } from 'vitest';
import { LAND_HO_56_GEOMETRY, createGame, redact } from '@hexhaven/engine';
import { GEOMETRY, type GameConfig, type GameState, type Seat } from '@hexhaven/shared';
import {
  epHarborSettlementsFlattened,
  epOf,
  epShipsFlattened,
  isAnyEpMissionActive,
  isExplorersPiratesGame,
  isFishMissionActive,
  isLandHoGame,
  isPirateLairsMissionActive,
  isSpiceMissionActive,
  ownCrewSupplyOf,
  ownEpShipsOf,
  ownGoldOf,
  ownHarborSettlementsOf,
  ownSettlerSupplyOf,
  shipTouchesOwnBuilding,
  unexploredHexesOf,
} from './epHelpers';

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;

const BASE_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ep-helpers-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

function epConfig(): GameConfig {
  return { ...BASE_CONFIG, expansions: { ...BASE_CONFIG.expansions, explorersPirates: { scenario: 'landHo' } } };
}

describe('isExplorersPiratesGame / epOf / isLandHoGame', () => {
  it('is false/undefined for a base game', () => {
    const view = redact(createGame(BASE_CONFIG), SEAT0);
    expect(isExplorersPiratesGame(view)).toBe(false);
    expect(epOf(view)).toBeUndefined();
    expect(isLandHoGame(view)).toBe(false);
  });

  it('is true/defined for a Land Ho! game', () => {
    const view = redact(createGame(epConfig()), SEAT0);
    expect(isExplorersPiratesGame(view)).toBe(true);
    expect(epOf(view)?.scenario).toBe('landHo');
    expect(isLandHoGame(view)).toBe(true);
  });
});

describe('unexploredHexesOf', () => {
  it('non-empty on a fresh Land Ho! game (the outer ring starts fogged)', () => {
    const view = redact(createGame(epConfig()), SEAT0);
    expect(unexploredHexesOf(view).length).toBeGreaterThan(0);
  });

  it('empty outside an E&P game', () => {
    const view = redact(createGame(BASE_CONFIG), SEAT0);
    expect(unexploredHexesOf(view)).toEqual([]);
  });
});

describe('epShipsFlattened / epHarborSettlementsFlattened / ownEpShipsOf', () => {
  it('flattens ships across every seat, and filters ownEpShipsOf to just the one seat', () => {
    const state = createGame(epConfig());
    const ext = state.ext!.explorersPirates!;
    const withShips: GameState = {
      ...state,
      ext: {
        ...state.ext,
        explorersPirates: {
          ...ext,
          ships: [
            { seat: SEAT0, edge: 1 as never, cargo: ['settler'] },
            { seat: SEAT1, edge: 2 as never, cargo: [] },
          ],
        },
      },
    };
    const view = redact(withShips, SEAT0);
    expect(epShipsFlattened(view)).toEqual([
      { edge: 1, seat: SEAT0 },
      { edge: 2, seat: SEAT1 },
    ]);
    expect(ownEpShipsOf(view, SEAT0)).toEqual([{ edge: 1, cargo: ['settler'] }]);
    expect(ownEpShipsOf(view, SEAT1)).toEqual([{ edge: 2, cargo: [] }]);
  });

  it('flattens harbor settlements per seat, tagging each with its owning seat', () => {
    const state = createGame(epConfig());
    const ext = state.ext!.explorersPirates!;
    const withHarbors: GameState = {
      ...state,
      ext: {
        ...state.ext,
        explorersPirates: { ...ext, harborSettlements: [[10 as never], [], [20 as never, 21 as never], []] },
      },
    };
    const view = redact(withHarbors, SEAT0);
    expect(epHarborSettlementsFlattened(view)).toEqual([
      { vertex: 10, seat: SEAT0 },
      { vertex: 20, seat: 2 },
      { vertex: 21, seat: 2 },
    ]);
    expect(ownHarborSettlementsOf(view, SEAT0)).toEqual([10]);
  });
});

describe('ownGoldOf / ownSettlerSupplyOf', () => {
  it('reads the seat\'s own tally, defaulting to 0 when unseeded', () => {
    const state = createGame(epConfig());
    const ext = state.ext!.explorersPirates!;
    const withGold: GameState = {
      ...state,
      ext: { ...state.ext, explorersPirates: { ...ext, gold: [3, 0, 0, 0], settlerSupply: [1, 0, 0, 0] } },
    };
    const view = redact(withGold, SEAT0);
    expect(ownGoldOf(view, SEAT0)).toBe(3);
    expect(ownGoldOf(view, SEAT1)).toBe(0);
    expect(ownSettlerSupplyOf(view, SEAT0)).toBe(1);

    const fresh = redact(createGame(epConfig()), SEAT0);
    expect(ownGoldOf(fresh, SEAT0)).toBe(0);
    expect(ownSettlerSupplyOf(fresh, SEAT0)).toBe(0);
  });
});

// T-1154 (§EP1.3/§EP11): which mission sections `EpActionPanel` shows, per scenario — mirrors
// `EP_SCENARIO_CONFIG`'s own table (modules/explorersPirates/state.ts) exactly, exercised over a
// real `createGame` for every shipped scenario id (never hand-faked `scenario` strings) so this can
// never drift from what the picker/server actually offer.
describe('isFishMissionActive / isSpiceMissionActive / isPirateLairsMissionActive / isAnyEpMissionActive', () => {
  function scenarioConfig(scenario: string): GameConfig {
    return { ...BASE_CONFIG, expansions: { ...BASE_CONFIG.expansions, explorersPirates: { scenario } } };
  }

  it('Land Ho!: every mission off, so no mission control ever shows', () => {
    const view = redact(createGame(scenarioConfig('landHo')), SEAT0);
    expect(isFishMissionActive(view)).toBe(false);
    expect(isSpiceMissionActive(view)).toBe(false);
    expect(isPirateLairsMissionActive(view)).toBe(false);
    expect(isAnyEpMissionActive(view)).toBe(false);
  });

  it('Fish for Hexhaven: only the fish mission is on', () => {
    const view = redact(createGame(scenarioConfig('fishForHexhaven')), SEAT0);
    expect(isFishMissionActive(view)).toBe(true);
    expect(isSpiceMissionActive(view)).toBe(false);
    expect(isPirateLairsMissionActive(view)).toBe(false);
    expect(isAnyEpMissionActive(view)).toBe(true);
  });

  it('Spices for Hexhaven: only the spice mission is on', () => {
    const view = redact(createGame(scenarioConfig('spicesForHexhaven')), SEAT0);
    expect(isFishMissionActive(view)).toBe(false);
    expect(isSpiceMissionActive(view)).toBe(true);
    expect(isPirateLairsMissionActive(view)).toBe(false);
    expect(isAnyEpMissionActive(view)).toBe(true);
  });

  it('The Pirate Lairs: only the pirate-lairs mission is on', () => {
    const view = redact(createGame(scenarioConfig('pirateLairs')), SEAT0);
    expect(isFishMissionActive(view)).toBe(false);
    expect(isSpiceMissionActive(view)).toBe(false);
    expect(isPirateLairsMissionActive(view)).toBe(true);
    expect(isAnyEpMissionActive(view)).toBe(true);
  });

  it('the full campaign: all three missions on at once', () => {
    const view = redact(createGame(scenarioConfig('fullCampaign')), SEAT0);
    expect(isFishMissionActive(view)).toBe(true);
    expect(isSpiceMissionActive(view)).toBe(true);
    expect(isPirateLairsMissionActive(view)).toBe(true);
    expect(isAnyEpMissionActive(view)).toBe(true);
  });

  it('is false outside any E&P game', () => {
    const view = redact(createGame(BASE_CONFIG), SEAT0);
    expect(isFishMissionActive(view)).toBe(false);
    expect(isSpiceMissionActive(view)).toBe(false);
    expect(isPirateLairsMissionActive(view)).toBe(false);
    expect(isAnyEpMissionActive(view)).toBe(false);
  });
});

describe('ownCrewSupplyOf', () => {
  it('reads the seat\'s own tally, defaulting to 0 when unseeded', () => {
    const state = createGame(epConfig());
    const ext = state.ext!.explorersPirates!;
    const withCrew: GameState = {
      ...state,
      ext: { ...state.ext, explorersPirates: { ...ext, crewSupply: [2, 0, 0, 0] } },
    };
    const view = redact(withCrew, SEAT0);
    expect(ownCrewSupplyOf(view, SEAT0)).toBe(2);
    expect(ownCrewSupplyOf(view, SEAT1)).toBe(0);

    const fresh = redact(createGame(epConfig()), SEAT0);
    expect(ownCrewSupplyOf(fresh, SEAT0)).toBe(0);
  });
});

describe('shipTouchesOwnBuilding', () => {
  it('true when the ship edge touches one of the seat\'s own settlements', () => {
    const state = createGame(epConfig());
    const anchorVertex = GEOMETRY.vertices[0]!.id;
    const anchorEdge = GEOMETRY.vertices[0]!.edges[0]!;
    const withSettlement: GameState = {
      ...state,
      players: state.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [anchorVertex as never] } : p)),
    };
    const view = redact(withSettlement, SEAT0);
    expect(shipTouchesOwnBuilding(view, SEAT0, anchorEdge)).toBe(true);
    expect(shipTouchesOwnBuilding(view, SEAT1, anchorEdge)).toBe(false);
  });

  it('true when the ship edge touches one of the seat\'s own harbor settlements', () => {
    const state = createGame(epConfig());
    const ext = state.ext!.explorersPirates!;
    const anchorVertex = GEOMETRY.vertices[0]!.id;
    const anchorEdge = GEOMETRY.vertices[0]!.edges[0]!;
    const withHarbor: GameState = {
      ...state,
      ext: {
        ...state.ext,
        explorersPirates: { ...ext, harborSettlements: [[anchorVertex as never], [], [], []] },
      },
    };
    const view = redact(withHarbor, SEAT0);
    expect(shipTouchesOwnBuilding(view, SEAT0, anchorEdge)).toBe(true);
  });

  it('false for an edge touching no building at all', () => {
    const view = redact(createGame(epConfig()), SEAT0);
    expect(shipTouchesOwnBuilding(view, SEAT0, GEOMETRY.edges[0]!.id)).toBe(false);
  });

  // T-1154 fix: this used to index the fixed base `GEOMETRY` (72 edges) directly regardless of
  // `view.config`, so any edge unique to the bigger 5–6 frame (`LAND_HO_56_GEOMETRY`, 109 edges)
  // always looked up `undefined` and silently returned `false` — breaking load/unload-settler (and
  // the new T-1154 load-crew control) legality for a 5–6 ship past edge id 71. Edge 72 (a=49) is one
  // such beyond-base-range edge — impossible to produce via the old hardcoded `GEOMETRY.edges` array,
  // which tops out at id 71.
  it('resolves the 5-6 board instead of silently indexing the base 72-edge GEOMETRY (T-1154 fix)', () => {
    const EP_56_CONFIG: GameConfig = {
      playerCount: 5,
      targetVp: 8,
      seed: 'ep-helpers-56-test',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: true, seafarers: false, citiesKnights: false, explorersPirates: { scenario: 'landHo' } },
    };
    const beyondBaseEdge = LAND_HO_56_GEOMETRY.edges[72]!;
    expect(GEOMETRY.edges[beyondBaseEdge.id]).toBeUndefined();

    const state = createGame(EP_56_CONFIG);
    const withSettlement: GameState = {
      ...state,
      players: state.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [beyondBaseEdge.a as never] } : p)),
    };
    const view = redact(withSettlement, SEAT0);
    expect(shipTouchesOwnBuilding(view, SEAT0, beyondBaseEdge.id as never)).toBe(true);
  });
});
