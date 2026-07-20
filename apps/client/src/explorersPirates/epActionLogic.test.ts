// T-1108: `epActionLogic.ts`'s pure enablement/reason helpers + legal-target composers, exercised
// over a real `redact(createGame(...), seat)` PlayerView with `turn`/`phase`/`ext.explorersPirates`
// overridden to the exact situation each gate checks — mirrors
// `tradersBarbarians/tbActionLogic.test.ts`'s own "never hand-fake the ext shape" convention.
import { describe, expect, it } from 'vitest';
import {
  EP_CREW_COST,
  GOLD_PER_VP,
  SPICE_TRADE_COST_GOLD,
  createGame,
  isSeaEdge,
  redact,
  vertexTouchesDiscoveredLand,
} from '@hexhaven/engine';
import { GEOMETRY, type EdgeId, type GameConfig, type GameState, type HexId, type Seat, type VertexId } from '@hexhaven/shared';
import { boardGeometryFor } from '../board/geometry';
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
  legalBuildEPShipEdges,
  legalFoundSettlementVertices,
  legalPlaceCrewOnLairTargets,
  legalTradeSpiceHexes,
  legalUpgradeToHarborVertices,
  loadCrewShipTargets,
  loadSettlerShipTargets,
  unloadSettlerShipTargets,
} from './epActionLogic';

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;

const BASE_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ep-action-logic-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

function epConfig(): GameConfig {
  return { ...BASE_CONFIG, expansions: { ...BASE_CONFIG.expansions, explorersPirates: { scenario: 'landHo' } } };
}

/** T-1154: a config for one of the four MISSION scenarios (fish/spice/pirate-lairs/full-campaign,
 *  every one of which reuses Land Ho!'s own board/movement/founding frame — `modules/explorersPirates/
 *  state.ts`'s own header) — `createGame` seeds `fishShoals`/`villages`/`councilVertex` for real via
 *  `seedFishSpiceV0`, so these tests exercise the exact same seeded shape the client actually receives. */
function missionConfig(scenario: string, seed = 'ep-mission-action-logic-test'): GameConfig {
  return { ...BASE_CONFIG, seed, expansions: { ...BASE_CONFIG.expansions, explorersPirates: { scenario } } };
}

/** `createGame` always starts in `setup` with `turn.player` from the snake draft — every gate here
 *  is about the MAIN phase, so this always overrides both to a clean, rolled seat-0 turn. */
function mainStateFrom(config: GameConfig, patch: (s: GameState) => GameState = (s) => s): GameState {
  const created = createGame(config);
  return patch({ ...created, turn: { number: 5, player: SEAT0, rolled: true, roll: [4, 2], devPlayed: false }, phase: { kind: 'main' } });
}

function mainState(patch: (s: GameState) => GameState = (s) => s): GameState {
  return mainStateFrom(epConfig(), patch);
}

function findSeaEdge(state: GameState): { edge: EdgeId; vertex: VertexId } {
  for (const e of GEOMETRY.edges) {
    if (isSeaEdge(state, e.id)) return { edge: e.id, vertex: e.a as VertexId };
  }
  throw new Error('BUG: no sea edge found on the Land Ho! v1 board');
}

function findCoastalSeaEdge(state: GameState): EdgeId {
  for (const e of GEOMETRY.edges) {
    if (isSeaEdge(state, e.id) && (vertexTouchesDiscoveredLand(state, e.a) || vertexTouchesDiscoveredLand(state, e.b))) {
      return e.id;
    }
  }
  throw new Error('BUG: no coastal sea edge found on the Land Ho! v1 board');
}

/** T-1154: any sea edge bordering `hex` (used to place a fixture ship next to a fish shoal/village/
 *  pirate lair — the composer under test only cares about edge-hex adjacency, not sea-edge-ness,
 *  mirroring the engine handlers' own `geometry.edges[s.edge].hexes.includes(hex)` checks). */
function edgeBorderingHex(state: GameState, hex: HexId): EdgeId {
  const geometry = boardGeometryFor(state.config);
  const found = geometry.edges.find((e) => e.hexes.includes(hex));
  if (!found) throw new Error(`BUG: no edge borders hex ${hex}`);
  return found.id;
}

/** T-1154: any edge incident to `vertex` (used to place a fixture ship adjacent to the council). */
function edgeIncidentToVertex(state: GameState, vertex: VertexId): EdgeId {
  const geometry = boardGeometryFor(state.config);
  const v = geometry.vertices[vertex];
  if (!v || v.edges.length === 0) throw new Error(`BUG: vertex ${vertex} has no edges`);
  return v.edges[0]!;
}

describe('turn/phase gating (shared by every E&P action)', () => {
  it('rejects a non-turn-owner seat', () => {
    const view = redact(mainState(), SEAT1);
    expect(computeBuildEPSettlerState(view, SEAT1)).toEqual({ enabled: false, reason: 'notYourTurn' });
  });

  it('rejects outside the main phase', () => {
    const created = createGame(epConfig());
    const preRoll = { ...created, turn: { number: 5, player: SEAT0, rolled: false, roll: null, devPlayed: false }, phase: { kind: 'preRoll' as const } };
    const view = redact(preRoll, SEAT0);
    expect(computeBuildEPSettlerState(view, SEAT0)).toEqual({ enabled: false, reason: 'notMainPhase' });
  });
});

describe('computeBuildEPShipState / legalBuildEPShipEdges (§EP3.1)', () => {
  it('noLegalTargets with no coastal settlement anywhere', () => {
    const view = redact(mainState(), SEAT0);
    expect(computeBuildEPShipState(view, SEAT0)).toEqual({ enabled: false, reason: 'noLegalTargets' });
    expect(legalBuildEPShipEdges(view, SEAT0)).toEqual([]);
  });

  it('cantAfford once a coastal settlement exists but wool/lumber are short', () => {
    const created = createGame(epConfig());
    const { vertex } = findSeaEdge(created);
    const state = mainState((s) => ({
      ...s,
      players: s.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [vertex] } : p)),
    }));
    const view = redact(state, SEAT0);
    const result = computeBuildEPShipState(view, SEAT0);
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('cantAfford');
  });

  it('enabled once a coastal settlement exists and wool/lumber are affordable', () => {
    const created = createGame(epConfig());
    const { edge, vertex } = findSeaEdge(created);
    const state = mainState((s) => ({
      ...s,
      players: s.players.map((p) =>
        p.seat === SEAT0 ? { ...p, settlements: [vertex], resources: { ...p.resources, wool: 1, lumber: 1 } } : p,
      ),
    }));
    const view = redact(state, SEAT0);
    expect(computeBuildEPShipState(view, SEAT0)).toEqual({ enabled: true });
    expect(legalBuildEPShipEdges(view, SEAT0)).toContain(edge);
  });
});

describe('computeMoveEPShipState (§EP3.2)', () => {
  it('noLegalTargets with no ships at all', () => {
    const view = redact(mainState(), SEAT0);
    expect(computeMoveEPShipState(view, SEAT0)).toEqual({ enabled: false, reason: 'noLegalTargets' });
  });

  it('enabled once the seat owns a ship that can still move', () => {
    const created = createGame(epConfig());
    const { edge } = findSeaEdge(created);
    const ext = created.ext!.explorersPirates!;
    const state = mainState((s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge, cargo: [] }] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeMoveEPShipState(view, SEAT0)).toEqual({ enabled: true });
  });
});

describe('computeBuildEPSettlerState (§EP4.1)', () => {
  it('cantAfford on a fresh game (0 grain/wool)', () => {
    const view = redact(mainState(), SEAT0);
    expect(computeBuildEPSettlerState(view, SEAT0)).toEqual({
      enabled: false,
      reason: 'cantAfford',
      missing: { unit: 'grain', need: 1, have: 0 },
    });
  });

  it('enabled once affordable', () => {
    const state = mainState((s) => ({
      ...s,
      players: s.players.map((p) => (p.seat === SEAT0 ? { ...p, resources: { ...p.resources, grain: 1, wool: 1 } } : p)),
    }));
    const view = redact(state, SEAT0);
    expect(computeBuildEPSettlerState(view, SEAT0)).toEqual({ enabled: true });
  });
});

describe('computeFoundSettlementState / legalFoundSettlementVertices (§EP4.1)', () => {
  it('noLegalTargets with no settler-carrying ship anywhere', () => {
    const view = redact(mainState(), SEAT0);
    expect(computeFoundSettlementState(view, SEAT0)).toEqual({ enabled: false, reason: 'noLegalTargets' });
  });

  it('enabled once a ship carrying a settler sits at a coastal edge', () => {
    const created = createGame(epConfig());
    const shipEdge = findCoastalSeaEdge(created);
    const ext = created.ext!.explorersPirates!;
    const state = mainState((s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge: shipEdge, cargo: ['settler'] }] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeFoundSettlementState(view, SEAT0)).toEqual({ enabled: true });
    expect(legalFoundSettlementVertices(view, SEAT0).length).toBeGreaterThan(0);
  });
});

describe('computeUpgradeToHarborState / legalUpgradeToHarborVertices (§EP4.2)', () => {
  it('noOwnSettlements with no settlements yet', () => {
    const view = redact(mainState(), SEAT0);
    expect(computeUpgradeToHarborState(view, SEAT0)).toEqual({ enabled: false, reason: 'noOwnSettlements' });
    expect(legalUpgradeToHarborVertices(view, SEAT0)).toEqual([]);
  });

  it('cantAfford with a settlement but short on ore/grain', () => {
    const state = mainState((s) => ({
      ...s,
      players: s.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [10 as VertexId] } : p)),
    }));
    const view = redact(state, SEAT0);
    expect(legalUpgradeToHarborVertices(view, SEAT0)).toEqual([10]);
    expect(computeUpgradeToHarborState(view, SEAT0).reason).toBe('cantAfford');
  });

  it('enabled with a settlement and enough ore/grain', () => {
    const state = mainState((s) => ({
      ...s,
      players: s.players.map((p) =>
        p.seat === SEAT0 ? { ...p, settlements: [10 as VertexId], resources: { ...p.resources, ore: 2, grain: 1 } } : p,
      ),
    }));
    const view = redact(state, SEAT0);
    expect(computeUpgradeToHarborState(view, SEAT0)).toEqual({ enabled: true });
  });
});

describe('load/unload settler targets + gates (§EP3.3)', () => {
  it('noReserve when no settler has been built yet, even with a ship at a coastal building', () => {
    const created = createGame(epConfig());
    const { edge, vertex } = findSeaEdge(created);
    const ext = created.ext!.explorersPirates!;
    const state = mainState((s) => ({
      ...s,
      players: s.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [vertex] } : p)),
      ext: { ...s.ext, explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge, cargo: [] }] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeLoadSettlerState(view, SEAT0)).toEqual({ enabled: false, reason: 'noReserve' });
  });

  it('noShipHere once a settler is reserved but no ship sits at a coastal building', () => {
    const created = createGame(epConfig());
    const ext = created.ext!.explorersPirates!;
    const state = mainState((s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...ext, settlerSupply: [1, 0, 0, 0] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeLoadSettlerState(view, SEAT0)).toEqual({ enabled: false, reason: 'noShipHere' });
    expect(loadSettlerShipTargets(view, SEAT0)).toEqual([]);
  });

  it('enabled to load once a settler is reserved and a ship sits at a coastal building', () => {
    const created = createGame(epConfig());
    const { edge, vertex } = findSeaEdge(created);
    const ext = created.ext!.explorersPirates!;
    const state = mainState((s) => ({
      ...s,
      players: s.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [vertex] } : p)),
      ext: {
        ...s.ext,
        explorersPirates: { ...ext, settlerSupply: [1, 0, 0, 0], ships: [{ seat: SEAT0, edge, cargo: [] }] },
      },
    }));
    const view = redact(state, SEAT0);
    expect(computeLoadSettlerState(view, SEAT0)).toEqual({ enabled: true });
    expect(loadSettlerShipTargets(view, SEAT0)).toEqual([edge]);
    // Not carrying a settler yet, so unload offers nothing.
    expect(computeUnloadSettlerState(view, SEAT0)).toEqual({ enabled: false, reason: 'noShipHere' });
  });

  it('enabled to unload once the ship actually carries a settler', () => {
    const created = createGame(epConfig());
    const { edge, vertex } = findSeaEdge(created);
    const ext = created.ext!.explorersPirates!;
    const state = mainState((s) => ({
      ...s,
      players: s.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [vertex] } : p)),
      ext: { ...s.ext, explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge, cargo: ['settler'] }] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeUnloadSettlerState(view, SEAT0)).toEqual({ enabled: true });
    expect(unloadSettlerShipTargets(view, SEAT0)).toEqual([edge]);
  });
});

// ---- T-1154: mission action controls (§EP6/§EP7/§EP8/§EP9) ----------------------------------------

describe('computeBuildEPCrewState (§EP7.1)', () => {
  it('noHarborSettlement with no harbor settlement at all (even with resources on hand)', () => {
    const state = mainStateFrom(missionConfig('pirateLairs'), (s) => ({
      ...s,
      players: s.players.map((p) => (p.seat === SEAT0 ? { ...p, resources: { ...p.resources, ore: 5, wool: 5 } } : p)),
    }));
    const view = redact(state, SEAT0);
    expect(computeBuildEPCrewState(view, SEAT0)).toEqual({ enabled: false, reason: 'noHarborSettlement' });
  });

  it('cantAfford with a harbor settlement but short on ore/wool', () => {
    const state = mainStateFrom(missionConfig('pirateLairs'), (s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...s.ext!.explorersPirates!, harborSettlements: [[10 as VertexId], [], [], []] } },
    }));
    const view = redact(state, SEAT0);
    const result = computeBuildEPCrewState(view, SEAT0);
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('cantAfford');
    expect(result.missing).toEqual({ unit: 'ore', need: EP_CREW_COST.ore, have: 0 });
  });

  it('enabled with a harbor settlement and enough ore/wool', () => {
    const state = mainStateFrom(missionConfig('pirateLairs'), (s) => ({
      ...s,
      players: s.players.map((p) => (p.seat === SEAT0 ? { ...p, resources: { ...p.resources, ore: 1, wool: 1 } } : p)),
      ext: { ...s.ext, explorersPirates: { ...s.ext!.explorersPirates!, harborSettlements: [[10 as VertexId], [], [], []] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeBuildEPCrewState(view, SEAT0)).toEqual({ enabled: true });
  });
});

describe('loadCrewShipTargets / computeLoadCrewState (§EP7.1, mirrors load-settler)', () => {
  it('noReserve when no crew has been built yet, even with a ship at a coastal building', () => {
    const created = createGame(missionConfig('pirateLairs'));
    const { edge, vertex } = findSeaEdge(created);
    const ext = created.ext!.explorersPirates!;
    const state = mainStateFrom(missionConfig('pirateLairs'), (s) => ({
      ...s,
      players: s.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [vertex] } : p)),
      ext: { ...s.ext, explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge, cargo: [] }] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeLoadCrewState(view, SEAT0)).toEqual({ enabled: false, reason: 'noReserve' });
  });

  it('noShipHere once a crew is reserved but no ship sits at a coastal building', () => {
    const created = createGame(missionConfig('pirateLairs'));
    const ext = created.ext!.explorersPirates!;
    const state = mainStateFrom(missionConfig('pirateLairs'), (s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...ext, crewSupply: [1, 0, 0, 0] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeLoadCrewState(view, SEAT0)).toEqual({ enabled: false, reason: 'noShipHere' });
    expect(loadCrewShipTargets(view, SEAT0)).toEqual([]);
  });

  it('enabled to load once a crew is reserved and a ship sits at a coastal building', () => {
    const created = createGame(missionConfig('pirateLairs'));
    const { edge, vertex } = findSeaEdge(created);
    const ext = created.ext!.explorersPirates!;
    const state = mainStateFrom(missionConfig('pirateLairs'), (s) => ({
      ...s,
      players: s.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [vertex] } : p)),
      ext: {
        ...s.ext,
        explorersPirates: { ...ext, crewSupply: [1, 0, 0, 0], ships: [{ seat: SEAT0, edge, cargo: [] }] },
      },
    }));
    const view = redact(state, SEAT0);
    expect(computeLoadCrewState(view, SEAT0)).toEqual({ enabled: true });
    expect(loadCrewShipTargets(view, SEAT0)).toEqual([edge]);
  });
});

describe('legalPlaceCrewOnLairTargets / computePlaceCrewOnLairState (§EP7.2)', () => {
  it('noLegalTargets with no active pirate lair at all', () => {
    const view = redact(mainStateFrom(missionConfig('pirateLairs')), SEAT0);
    expect(computePlaceCrewOnLairState(view, SEAT0)).toEqual({ enabled: false, reason: 'noLegalTargets' });
    expect(legalPlaceCrewOnLairTargets(view, SEAT0)).toEqual([]);
  });

  it('noLegalTargets with an active lair but no crew-carrying ship adjacent to it', () => {
    const created = createGame(missionConfig('pirateLairs'));
    const { edge } = findSeaEdge(created);
    const hex = boardGeometryFor(created.config).edges[edge]!.hexes[0]!;
    const ext = created.ext!.explorersPirates!;
    const state = mainStateFrom(missionConfig('pirateLairs'), (s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...ext, pirateLairs: [{ hex, crews: [] }] } },
    }));
    const view = redact(state, SEAT0);
    expect(computePlaceCrewOnLairState(view, SEAT0)).toEqual({ enabled: false, reason: 'noLegalTargets' });
  });

  it('enabled once a ship carrying a crew is adjacent to an active lair', () => {
    const created = createGame(missionConfig('pirateLairs'));
    const { edge } = findSeaEdge(created);
    const hex = boardGeometryFor(created.config).edges[edge]!.hexes[0]!;
    const ext = created.ext!.explorersPirates!;
    const state = mainStateFrom(missionConfig('pirateLairs'), (s) => ({
      ...s,
      ext: {
        ...s.ext,
        explorersPirates: {
          ...ext,
          pirateLairs: [{ hex, crews: [] }],
          ships: [{ seat: SEAT0, edge, cargo: ['crew'] }],
        },
      },
    }));
    const view = redact(state, SEAT0);
    expect(computePlaceCrewOnLairState(view, SEAT0)).toEqual({ enabled: true });
    expect(legalPlaceCrewOnLairTargets(view, SEAT0)).toEqual([{ hex, crews: 0 }]);
  });
});

describe('computeDeliverFishState (§EP8)', () => {
  it('noLegalTargets with no fish cargo anywhere', () => {
    const view = redact(mainStateFrom(missionConfig('fishForHexhaven')), SEAT0);
    expect(computeDeliverFishState(view, SEAT0)).toEqual({ enabled: false, reason: 'noLegalTargets' });
  });

  it('enabled once a ship carrying fish sits adjacent to the council', () => {
    const created = createGame(missionConfig('fishForHexhaven'));
    const ext = created.ext!.explorersPirates!;
    const council = ext.councilVertex!;
    const edge = edgeIncidentToVertex(created, council);
    const state = mainStateFrom(missionConfig('fishForHexhaven'), (s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge, cargo: ['fish'] }] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeDeliverFishState(view, SEAT0)).toEqual({ enabled: true });
  });
});

describe('computeDeliverSpiceState (§EP9, mirrors computeDeliverFishState)', () => {
  it('noLegalTargets with no spice cargo anywhere', () => {
    const view = redact(mainStateFrom(missionConfig('spicesForHexhaven')), SEAT0);
    expect(computeDeliverSpiceState(view, SEAT0)).toEqual({ enabled: false, reason: 'noLegalTargets' });
  });

  it('enabled once a ship carrying spice sits adjacent to the council', () => {
    const created = createGame(missionConfig('spicesForHexhaven'));
    const ext = created.ext!.explorersPirates!;
    const council = ext.councilVertex!;
    const edge = edgeIncidentToVertex(created, council);
    const state = mainStateFrom(missionConfig('spicesForHexhaven'), (s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge, cargo: ['spice'] }] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeDeliverSpiceState(view, SEAT0)).toEqual({ enabled: true });
  });
});

describe('legalTradeSpiceHexes / computeTradeSpiceState (§EP9)', () => {
  it('cantAfford with no gold, even with a village and an adjacent ship', () => {
    const created = createGame(missionConfig('spicesForHexhaven'));
    const ext = created.ext!.explorersPirates!;
    const village = ext.villages![0]!;
    const edge = edgeBorderingHex(created, village);
    const state = mainStateFrom(missionConfig('spicesForHexhaven'), (s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge, cargo: [] }] } },
    }));
    const view = redact(state, SEAT0);
    const result = computeTradeSpiceState(view, SEAT0);
    expect(result).toEqual({
      enabled: false,
      reason: 'cantAfford',
      missing: { unit: 'gold', need: SPICE_TRADE_COST_GOLD, have: 0 },
    });
    expect(legalTradeSpiceHexes(view, SEAT0)).toEqual([]);
  });

  it('noLegalTargets with gold but no ship adjacent to any active village', () => {
    const created = createGame(missionConfig('spicesForHexhaven'));
    const ext = created.ext!.explorersPirates!;
    const state = mainStateFrom(missionConfig('spicesForHexhaven'), (s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...ext, gold: [5, 0, 0, 0] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeTradeSpiceState(view, SEAT0)).toEqual({ enabled: false, reason: 'noLegalTargets' });
  });

  it('enabled with gold and a ship (with cargo room) adjacent to an active village', () => {
    const created = createGame(missionConfig('spicesForHexhaven'));
    const ext = created.ext!.explorersPirates!;
    const village = ext.villages![0]!;
    const edge = edgeBorderingHex(created, village);
    const state = mainStateFrom(missionConfig('spicesForHexhaven'), (s) => ({
      ...s,
      ext: {
        ...s.ext,
        explorersPirates: { ...ext, gold: [5, 0, 0, 0], ships: [{ seat: SEAT0, edge, cargo: [] }] },
      },
    }));
    const view = redact(state, SEAT0);
    expect(computeTradeSpiceState(view, SEAT0)).toEqual({ enabled: true });
    expect(legalTradeSpiceHexes(view, SEAT0)).toEqual([village]);
  });
});

describe('computeShipGoldState (§EP6.2)', () => {
  it('cantAfford with less than GOLD_PER_VP gold', () => {
    const view = redact(mainStateFrom(missionConfig('pirateLairs')), SEAT0);
    expect(computeShipGoldState(view, SEAT0)).toEqual({
      enabled: false,
      reason: 'cantAfford',
      missing: { unit: 'gold', need: GOLD_PER_VP, have: 0 },
    });
  });

  it('enabled with at least GOLD_PER_VP gold', () => {
    const state = mainStateFrom(missionConfig('pirateLairs'), (s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...s.ext!.explorersPirates!, gold: [GOLD_PER_VP, 0, 0, 0] } },
    }));
    const view = redact(state, SEAT0);
    expect(computeShipGoldState(view, SEAT0)).toEqual({ enabled: true });
  });
});

// T-1160 (FOLLOWUP from T-1150): `legalBuildEPShipEdges`/`legalFoundSettlementVertices` used to
// iterate the base 19-hex `GEOMETRY` (72 edges / 54 vertices) directly, no matter which board the
// game actually resolved to. At 5-6 a Land Ho! game plays on `LAND_HO_56_GEOMETRY` (37 hexes, 132
// edges, 96 vertices) — so this suite deliberately exercises edge/vertex ids that ONLY exist on the
// bigger board (id >= 72 for edges, id >= 54 for vertices — impossible to produce by filtering the
// old hardcoded base `GEOMETRY.edges`/`GEOMETRY.vertices` arrays, which top out at 71/53) to prove
// the composers now resolve `boardGeometryFor(view.config)` instead.
describe('5-6 Land Ho! (T-1160): move/found candidates resolve the 37-hex LAND_HO_56_GEOMETRY', () => {
  const EP_56_CONFIG: GameConfig = {
    playerCount: 5,
    targetVp: 8,
    seed: 'ep-action-logic-56-test',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: false, citiesKnights: false, explorersPirates: { scenario: 'landHo' } },
  };

  function mainState56(patch: (s: GameState) => GameState = (s) => s): GameState {
    const created = createGame(EP_56_CONFIG);
    return patch({ ...created, turn: { number: 5, player: SEAT0, rolled: true, roll: [4, 2], devPlayed: false }, phase: { kind: 'main' } });
  }

  // Edge 72 (a=49, b=57) on this scenario's 37-hex board (seed `ep-action-logic-56-test`): a coastal
  // sea edge whose BOTH endpoints touch discovered (home-island) land and satisfy the distance rule
  // — verified once here so the tests below don't silently pass for the wrong reason if the board
  // generator ever changes. Vertex 57 and edge 72 are both indices the base 19-hex geometry (54
  // vertices, 72 edges) cannot produce at all.
  const COASTAL_EDGE = 72 as EdgeId;
  const COASTAL_VERTEX = 57 as VertexId;

  it('sanity: the base 19-hex geometry cannot address edge 72 / vertex 57 (proves the fixture actually exercises the bigger board)', () => {
    expect(GEOMETRY.edges.length).toBe(72);
    expect(GEOMETRY.vertices.length).toBe(54);
    expect(GEOMETRY.edges[COASTAL_EDGE]).toBeUndefined();
    expect(GEOMETRY.vertices[COASTAL_VERTEX]).toBeUndefined();
  });

  it('resolves the 37-hex geometry for this config (boardGeometryFor, T-1150)', () => {
    const geometry = boardGeometryFor(EP_56_CONFIG);
    expect(geometry.hexes.length).toBe(37);
    expect(geometry.edges.length).toBe(132);
    expect(geometry.vertices.length).toBe(96);
  });

  it('legalBuildEPShipEdges includes a beyond-base-range edge once a settlement anchors it', () => {
    const state = mainState56((s) => ({
      ...s,
      players: s.players.map((p) =>
        p.seat === SEAT0
          ? { ...p, settlements: [COASTAL_VERTEX], resources: { ...p.resources, wool: 1, lumber: 1 } }
          : p,
      ),
    }));
    // Confirm the fixture: edge 72 really is a legal sea edge for a settlement at vertex 57 in THIS
    // scenario/seed (isSeaEdge is itself geometry-resolving, so this doubles as an engine sanity check).
    expect(isSeaEdge(state, COASTAL_EDGE)).toBe(true);
    expect(vertexTouchesDiscoveredLand(state, COASTAL_VERTEX)).toBe(true);

    const view = redact(state, SEAT0);
    const edges = legalBuildEPShipEdges(view, SEAT0);
    expect(edges).toContain(COASTAL_EDGE);
    expect(computeBuildEPShipState(view, SEAT0)).toEqual({ enabled: true });
    // Every candidate must be a valid index into the ACTUAL (132-edge) geometry — the old code could
    // only ever have produced ids 0-71.
    for (const e of edges) expect(e).toBeLessThan(132);
  });

  it('legalFoundSettlementVertices includes a beyond-base-range vertex once a settler-carrying ship sits there', () => {
    const created = createGame(EP_56_CONFIG);
    const ext = created.ext!.explorersPirates!;
    const state = mainState56((s) => ({
      ...s,
      ext: { ...s.ext, explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge: COASTAL_EDGE, cargo: ['settler'] }] } },
    }));
    const view = redact(state, SEAT0);
    const vertices = legalFoundSettlementVertices(view, SEAT0);
    expect(vertices).toContain(COASTAL_VERTEX);
    expect(computeFoundSettlementState(view, SEAT0)).toEqual({ enabled: true });
    // Every candidate must be a valid index into the ACTUAL (96-vertex) geometry — the old code could
    // only ever have produced ids 0-53.
    for (const v of vertices) expect(v).toBeLessThan(96);
  });
});
