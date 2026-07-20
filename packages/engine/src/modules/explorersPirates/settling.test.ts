// T-1104: Explorers & Pirates settlers, founding & harbor settlements (docs/rules/
// explorers-pirates-rules.md §EP4/§EP12). Unit tests over CRAFTED states (same discipline as
// ships.test.ts/exploration.test.ts: `craft()` + `buildLandHoBoardV0` + `seedExplorationV0`, NOT
// `createGame`/a shipped scenario — no E&P scenario ships yet, T-1107): `buildEPSettler`'s reserve
// bookkeeping, `loadCargo`/`unloadCargo`'s settler-draw/return extension (ships.ts), `foundSettlement`
// (occupancy/distance/discovered-land/settler-adjacency legality, the piece-supply decrement, the
// `updateAwards` recompute), `upgradeToHarbor` (mirrors `buildCity`, the ship/cargo anchor extension
// in ships.ts's `ownBuildingOn`), the harbor-settlement VP (E&P-gated), and redaction (both new ext
// fields are fully public).
//
// ⚠ VERIFY: every numeric/model constant this file exercises (EP_SETTLER_COST, EP_HARBOR_COST, the
// settler reserve-pool model, "founding needs no road", "'gold' does not count as discovered land")
// is a provisional v1 placeholder — see settling.ts's own header comment and this task's
// Implementation notes.

import { describe, expect, it } from 'vitest';
import type {
  EdgeId,
  EPCargo,
  GameConfig,
  GameState,
  HexId,
  ScenarioTerrain,
  TerrainType,
  VertexId,
} from '@hexhaven/shared';
import { GEOMETRY } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { redact } from '../../redact.js';
import { isVertexOccupied, satisfiesDistanceRule } from '../../rules/placement.js';
import { computeVp } from '../../vp.js';
import { buildLandHoBoardV0 } from './board.js';
import { seedExplorationV0 } from './exploration.js';
import { explorersPiratesModule } from './index.js';
import { buildEPShipHandler, isSeaEdge, loadCargoHandler, unloadCargoHandler } from './ships.js';
import {
  EP_HARBOR_COST,
  EP_HARBOR_SETTLEMENT_VP,
  EP_SETTLER_COST,
  buildEPSettlerHandler,
  foundSettlementHandler,
  harborSettlementVpFor,
  upgradeToHarborHandler,
  vertexTouchesDiscoveredLand,
} from './settling.js';
import { epExt, harborSettlementsOf, isExplorersPiratesState, settlerSupplyOf, withEpExt } from './state.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ep-settling',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const FULL_HAND = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };

function isSeaEdgeOf(seaMap: readonly ScenarioTerrain[], edgeId: EdgeId): boolean {
  const e = GEOMETRY.edges[edgeId]!;
  return e.hexes.some((h) => seaMap[h] === 'sea');
}

function findCoastalVertex(seaMap: readonly ScenarioTerrain[]): { vertex: VertexId; seaEdges: EdgeId[] } {
  for (const v of GEOMETRY.vertices) {
    const seaEdges = v.edges.filter((e) => isSeaEdgeOf(seaMap, e));
    if (seaEdges.length >= 2) return { vertex: v.id, seaEdges };
  }
  throw new Error('BUG: no coastal vertex with >=2 sea edges found on the test board');
}

/** Builds a crafted E&P state with exploration seeded on top of T-1102's `buildLandHoBoardV0` (same
 *  discipline as ships.test.ts/exploration.test.ts). Seat 0 holds a home coastal settlement + a full
 *  hand. */
function craft(): {
  state: GameState;
  vertex: VertexId;
  seaEdges: EdgeId[];
  seaMap: ScenarioTerrain[];
} {
  const created = createGame(CONFIG);
  const built = buildLandHoBoardV0(created.rng);
  const seeded = seedExplorationV0(built.rng, built);
  const { vertex, seaEdges } = findCoastalVertex(built.seaMap);

  const players = created.players.map((p) =>
    p.seat === 0 ? { ...p, settlements: [vertex], resources: { ...FULL_HAND } } : p
  );

  const state: GameState = {
    ...created,
    rng: seeded.rng,
    board: built.board,
    players,
    ext: {
      ...created.ext,
      explorersPirates: {
        scenario: 'landHo',
        seaMap: built.seaMap,
        ships: [],
        shipsBuiltThisTurn: [],
        movedShipsThisTurn: [],
        gold: [0, 0, 0, 0],
        explorationSupply: seeded.explorationSupply,
        unexplored: seeded.unexplored,
      },
    },
    phase: { kind: 'main' },
    turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
  };
  return { state, vertex, seaEdges, seaMap: built.seaMap };
}

/** Simulates `hex` already being explored to a real land terrain — same "manufacture the post-reveal
 *  shape directly" trick exploration.test.ts's own fog-redaction test uses, since this file's own
 *  concern is founding LEGALITY, not the reveal mechanism (already covered by T-1103's own tests). */
function revealHexAsLand(state: GameState, hex: HexId, terrain: TerrainType, token: number): GameState {
  const ext = epExt(state)!;
  return withEpExt(
    {
      ...state,
      board: {
        ...state.board,
        hexes: state.board.hexes.map((h, i) => (i === hex ? { terrain, token } : h)),
      },
    },
    {
      ...ext,
      seaMap: (ext.seaMap ?? []).map((t, i) => (i === hex ? terrain : t)),
      unexplored: (ext.unexplored ?? []).filter((h) => h !== hex),
    }
  );
}

/** Finds an unoccupied, distance-rule-legal vertex on `hex` with >=1 incident sea edge (for a ship
 *  to dock at) — computed from the resolved board, never hardcoded. */
function findFoundableVertex(state: GameState, hex: HexId): { vertex: VertexId; dockEdge: EdgeId } {
  for (const v of GEOMETRY.vertices) {
    if (!v.hexes.includes(hex)) continue;
    if (isVertexOccupied(state, v.id)) continue;
    if (!satisfiesDistanceRule(state, v.id)) continue;
    const dockEdge = v.edges.find((e) => isSeaEdge(state, e));
    if (dockEdge !== undefined) return { vertex: v.id, dockEdge };
  }
  throw new Error(`BUG: no foundable vertex found on hex ${hex}`);
}

/** Crafts a state with one outer-ring hex already revealed as land, plus a ship of seat 0's carrying
 *  a `'settler'` cargo docked adjacent to a legal founding vertex there (injected directly into ext —
 *  actually sailing/loading there is T-1102/1103's own tested scope, not this file's). */
function craftReadyToFound() {
  const base = craft();
  const hex = epExt(base.state)!.unexplored![0]!;
  const revealed = revealHexAsLand(base.state, hex, 'hills', 4);
  const { vertex, dockEdge } = findFoundableVertex(revealed, hex);
  const ready = withEpExt(revealed, {
    ...epExt(revealed)!,
    ships: [{ seat: 0 as const, edge: dockEdge, cargo: ['settler'] as EPCargo[] }],
  });
  return { ...base, state: ready, hex, foundVertex: vertex, dockEdge };
}

describe('buildEPSettler (EP4.1)', () => {
  it('pays EP_SETTLER_COST and increments settlerSupply[seat]', () => {
    const { state } = craft();
    const before = state.players[0]!.resources;
    const result = buildEPSettlerHandler(state, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(settlerSupplyOf(result.state, 0)).toBe(1);
    expect(result.state.players[0]!.resources).toEqual({
      ...before,
      grain: before.grain - (EP_SETTLER_COST.grain ?? 0),
      wool: before.wool - (EP_SETTLER_COST.wool ?? 0),
    });
    expect(result.events).toEqual([{ type: 'epSettlerBuilt', seat: 0 }]);
  });

  it('stacks across repeated calls', () => {
    const { state } = craft();
    const first = buildEPSettlerHandler(state, 0);
    if (!first.ok) throw new Error('BUG: test setup failed');
    const second = buildEPSettlerHandler(first.state, 0);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(settlerSupplyOf(second.state, 0)).toBe(2);
  });

  it('rejects when the seat cannot afford EP_SETTLER_COST (CANT_AFFORD)', () => {
    const { state } = craft();
    const broke = {
      ...state,
      players: state.players.map((p) =>
        p.seat === 0 ? { ...p, resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 } } : p
      ),
    };
    const result = buildEPSettlerHandler(broke, 0);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'CANT_AFFORD' }) });
  });

  it('rejects outside a live E&P game (EXPANSION_NOT_AVAILABLE)', () => {
    const { state } = craft();
    const baseState = { ...state, ext: undefined };
    expect(isExplorersPiratesState(baseState)).toBe(false);
    const result = buildEPSettlerHandler(baseState, 0);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'EXPANSION_NOT_AVAILABLE' }) });
  });
});

describe('loadCargo/unloadCargo settler reserve extension (EP4.1, ships.ts)', () => {
  it('loadCargo{piece:"settler"} draws from settlerSupply, rejecting once empty (NO_PIECES_LEFT)', () => {
    const { state, seaEdges } = craft();
    const edge = seaEdges[0]!;
    const shipBuilt = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge });
    if (!shipBuilt.ok) throw new Error('BUG: test setup failed to build a ship');
    const settlerBuilt = buildEPSettlerHandler(shipBuilt.state, 0);
    if (!settlerBuilt.ok) throw new Error('BUG: test setup failed to build a settler');
    expect(settlerSupplyOf(settlerBuilt.state, 0)).toBe(1);

    const loaded = loadCargoHandler(settlerBuilt.state, 0, { type: 'loadCargo', ship: edge, piece: 'settler' });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(settlerSupplyOf(loaded.state, 0)).toBe(0);
    expect(epExt(loaded.state)!.ships![0]!.cargo).toEqual(['settler']);

    const again = loadCargoHandler(loaded.state, 0, { type: 'loadCargo', ship: edge, piece: 'settler' });
    expect(again).toEqual({ ok: false, error: expect.objectContaining({ code: 'NO_PIECES_LEFT' }) });
  });

  it('unloadCargo{piece:"settler"} returns the unit to settlerSupply', () => {
    const { state, seaEdges } = craft();
    const edge = seaEdges[0]!;
    const shipBuilt = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge });
    if (!shipBuilt.ok) throw new Error('BUG: test setup failed to build a ship');
    const settlerBuilt = buildEPSettlerHandler(shipBuilt.state, 0);
    if (!settlerBuilt.ok) throw new Error('BUG: test setup failed to build a settler');
    const loaded = loadCargoHandler(settlerBuilt.state, 0, { type: 'loadCargo', ship: edge, piece: 'settler' });
    if (!loaded.ok) throw new Error('BUG: test setup failed to load a settler');

    const unloaded = unloadCargoHandler(loaded.state, 0, { type: 'unloadCargo', ship: edge, piece: 'settler' });
    expect(unloaded.ok).toBe(true);
    if (!unloaded.ok) return;
    expect(settlerSupplyOf(unloaded.state, 0)).toBe(1);
    expect(epExt(unloaded.state)!.ships![0]!.cargo).toEqual([]);
  });

  it('other cargo kinds are unaffected (a crew load never touches settlerSupply)', () => {
    const { state, seaEdges } = craft();
    const edge = seaEdges[0]!;
    const shipBuilt = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge });
    if (!shipBuilt.ok) throw new Error('BUG: test setup failed to build a ship');
    // T-1105 gates loadCargo{piece:'crew'} on crewSupply (mirrors settlerSupply, pirateLairs.test.ts
    // owns that behavior in depth) — inject a reserve unit directly so this test still exercises only
    // the "settlerSupply is untouched by a crew load" claim, unaffected by that extension.
    const withCrew = withEpExt(shipBuilt.state, { ...epExt(shipBuilt.state)!, crewSupply: [1, 0, 0, 0] });
    const loaded = loadCargoHandler(withCrew, 0, { type: 'loadCargo', ship: edge, piece: 'crew' });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(settlerSupplyOf(loaded.state, 0)).toBe(0);
    expect(epExt(loaded.state)!.crewSupply).toEqual([0, 0, 0, 0]);
  });
});

describe('foundSettlement (EP4.1)', () => {
  it('unloads the settler and founds a real settlement on discovered land, decrementing piecesLeft.settlements and recomputing awards', () => {
    const { state, foundVertex, dockEdge } = craftReadyToFound();
    const before = state.players[0]!;

    const result = foundSettlementHandler(state, 0, { type: 'foundSettlement', vertex: foundVertex });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.players[0]!.settlements).toContain(foundVertex);
    expect(result.state.players[0]!.piecesLeft.settlements).toBe(before.piecesLeft.settlements - 1);
    const ship = epExt(result.state)!.ships!.find((s) => s.edge === dockEdge)!;
    expect(ship.cargo).toEqual([]);
    expect(result.events[0]).toEqual({ type: 'epSettlementFounded', seat: 0, vertex: foundVertex });
  });

  it('rejects an already-occupied vertex (OCCUPIED)', () => {
    const { state, vertex } = craftReadyToFound();
    const result = foundSettlementHandler(state, 0, { type: 'foundSettlement', vertex });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'OCCUPIED' }) });
  });

  it('rejects a vertex adjacent to an existing building (DISTANCE_RULE)', () => {
    const { state, vertex, foundVertex } = craftReadyToFound();
    const neighbor = GEOMETRY.vertices[vertex]!.neighbors[0];
    if (neighbor === undefined || neighbor === foundVertex) return; // sanity-skip on odd geometry
    const result = foundSettlementHandler(state, 0, { type: 'foundSettlement', vertex: neighbor });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'DISTANCE_RULE' }) });
  });

  it('rejects a vertex touching no discovered land (NOT_DISCOVERED_LAND)', () => {
    const { state } = craft();
    const ext = epExt(state)!;
    const unexplored = new Set(ext.unexplored ?? []);
    // A vertex touching ONLY still-fog hexes — distance-rule-legal and unoccupied (the home
    // settlement is the only occupied vertex on this crafted board), unlike a vertex directly off
    // the home coast (which would fail DISTANCE_RULE first, not the check this test targets).
    const fogVertex = GEOMETRY.vertices.find(
      (v) => !isVertexOccupied(state, v.id) && satisfiesDistanceRule(state, v.id) && v.hexes.every((h) => unexplored.has(h))
    )?.id;
    expect(fogVertex).toBeDefined();
    if (fogVertex === undefined) return;
    expect(vertexTouchesDiscoveredLand(state, fogVertex)).toBe(false);

    const dockEdge = GEOMETRY.vertices[fogVertex]!.edges.find((e) => isSeaEdge(state, e))!;
    const withShip = withEpExt(state, {
      ...ext,
      ships: [{ seat: 0 as const, edge: dockEdge, cargo: ['settler'] as EPCargo[] }],
    });
    const result = foundSettlementHandler(withShip, 0, { type: 'foundSettlement', vertex: fogVertex });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'NOT_DISCOVERED_LAND' }) });
  });

  it('rejects when no ship of the seat carries a settler adjacent to the vertex (SETTLER_NOT_FOUND)', () => {
    const { state, hex } = craftReadyToFound();
    const noShip = withEpExt(state, { ...epExt(state)!, ships: [] });
    const { vertex } = findFoundableVertex(noShip, hex);
    const result = foundSettlementHandler(noShip, 0, { type: 'foundSettlement', vertex });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'SETTLER_NOT_FOUND' }) });
  });

  it('rejects once the seat has no settlement pieces left (NO_PIECES_LEFT)', () => {
    const { state, foundVertex } = craftReadyToFound();
    const noPieces = {
      ...state,
      players: state.players.map((p) =>
        p.seat === 0 ? { ...p, piecesLeft: { ...p.piecesLeft, settlements: 0 } } : p
      ),
    };
    const result = foundSettlementHandler(noPieces, 0, { type: 'foundSettlement', vertex: foundVertex });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'NO_PIECES_LEFT' }) });
  });

  it('rejects outside a live E&P game (EXPANSION_NOT_AVAILABLE)', () => {
    const { state, foundVertex } = craftReadyToFound();
    const baseState = { ...state, ext: undefined };
    const result = foundSettlementHandler(baseState, 0, { type: 'foundSettlement', vertex: foundVertex });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'EXPANSION_NOT_AVAILABLE' }) });
  });
});

describe('upgradeToHarbor (EP4.2)', () => {
  it('mirrors buildCity: pays EP_HARBOR_COST, returns the settlement piece to supply, records the harbor settlement', () => {
    const { state, vertex } = craft();
    const before = state.players[0]!;

    const result = upgradeToHarborHandler(state, 0, { type: 'upgradeToHarbor', vertex });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.players[0]!.settlements).not.toContain(vertex);
    expect(result.state.players[0]!.piecesLeft.settlements).toBe(before.piecesLeft.settlements + 1);
    expect(harborSettlementsOf(result.state, 0)).toEqual([vertex]);
    expect(result.events).toEqual([{ type: 'epHarborSettlementBuilt', seat: 0, vertex }]);
    expect(result.state.players[0]!.resources).toEqual({
      ...before.resources,
      ore: before.resources.ore - (EP_HARBOR_COST.ore ?? 0),
      grain: before.resources.grain - (EP_HARBOR_COST.grain ?? 0),
    });
  });

  it('rejects a vertex that is not the seat\'s own settlement (BAD_LOCATION)', () => {
    const { state, vertex, seaEdges } = craft();
    const e = GEOMETRY.edges[seaEdges[0]!]!;
    const otherVertex = e.a === vertex ? e.b : e.a;
    const result = upgradeToHarborHandler(state, 0, { type: 'upgradeToHarbor', vertex: otherVertex });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'BAD_LOCATION' }) });
  });

  it('rejects when the seat cannot afford EP_HARBOR_COST (CANT_AFFORD)', () => {
    const { state, vertex } = craft();
    const broke = {
      ...state,
      players: state.players.map((p) =>
        p.seat === 0 ? { ...p, resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 } } : p
      ),
    };
    const result = upgradeToHarborHandler(broke, 0, { type: 'upgradeToHarbor', vertex });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'CANT_AFFORD' }) });
  });

  it('rejects outside a live E&P game (EXPANSION_NOT_AVAILABLE)', () => {
    const { state, vertex } = craft();
    const baseState = { ...state, ext: undefined };
    const result = upgradeToHarborHandler(baseState, 0, { type: 'upgradeToHarbor', vertex });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'EXPANSION_NOT_AVAILABLE' }) });
  });

  it('a harbor settlement anchors buildEPShip/loadCargo, same as a plain settlement (ships.ts ownBuildingOn)', () => {
    const { state, vertex, seaEdges } = craft();
    const upgraded = upgradeToHarborHandler(state, 0, { type: 'upgradeToHarbor', vertex });
    if (!upgraded.ok) throw new Error('BUG: test setup failed to upgrade');
    expect(upgraded.state.players[0]!.settlements).not.toContain(vertex); // the plain-settlement anchor is gone

    const built = buildEPShipHandler(upgraded.state, 0, { type: 'buildEPShip', edge: seaEdges[0]! });
    expect(built.ok).toBe(true);
  });
});

describe('harbor-settlement VP (EP4.2, vp.ts computeVp)', () => {
  it('harborSettlementVpFor counts EP_HARBOR_SETTLEMENT_VP per harbor settlement', () => {
    const { state, vertex } = craft();
    expect(harborSettlementVpFor(state, 0)).toBe(0);
    const upgraded = upgradeToHarborHandler(state, 0, { type: 'upgradeToHarbor', vertex });
    if (!upgraded.ok) throw new Error('BUG: test setup failed to upgrade');
    expect(harborSettlementVpFor(upgraded.state, 0)).toBe(EP_HARBOR_SETTLEMENT_VP);
  });

  it('computeVp includes harborSettlementsVp in an E&P game, omits it (bit-identical) otherwise', () => {
    const { state, vertex } = craft();
    const upgraded = upgradeToHarborHandler(state, 0, { type: 'upgradeToHarbor', vertex });
    if (!upgraded.ok) throw new Error('BUG: test setup failed to upgrade');
    const breakdown = computeVp(upgraded.state, 0);
    expect(breakdown.harborSettlementsVp).toBe(EP_HARBOR_SETTLEMENT_VP);
    expect(breakdown.total).toBeGreaterThanOrEqual(EP_HARBOR_SETTLEMENT_VP);

    const created = createGame(CONFIG);
    const baseBreakdown = computeVp(created, 0);
    expect('harborSettlementsVp' in baseBreakdown).toBe(false);
  });
});

describe('redaction (EP4.1/4.2 — harborSettlements/settlerSupply are fully public)', () => {
  it('surfaces harborSettlements/settlerSupply identically to every viewer', () => {
    const { state, vertex } = craft();
    const upgraded = upgradeToHarborHandler(state, 0, { type: 'upgradeToHarbor', vertex });
    if (!upgraded.ok) throw new Error('BUG: test setup failed to upgrade');
    const settlerBuilt = buildEPSettlerHandler(upgraded.state, 0);
    if (!settlerBuilt.ok) throw new Error('BUG: test setup failed to build a settler');

    const viewer0 = redact(settlerBuilt.state, 0);
    const viewer1 = redact(settlerBuilt.state, 1);
    expect(viewer1.ext?.explorersPirates?.harborSettlements).toEqual([[vertex], [], [], []]);
    expect(viewer1.ext?.explorersPirates?.settlerSupply).toEqual([1, 0, 0, 0]);
    expect(viewer1.ext?.explorersPirates).toEqual(viewer0.ext?.explorersPirates);
  });
});

describe('module wiring (interceptAction)', () => {
  it('routes buildEPSettler/foundSettlement/upgradeToHarbor in a live E&P game', () => {
    const { state } = craft();
    const settlerResult = explorersPiratesModule.interceptAction!(state, 0, { type: 'buildEPSettler' });
    expect(settlerResult).not.toBeNull();
    expect(settlerResult!.ok).toBe(true);
  });

  it('falls through (null) outside a live E&P game', () => {
    const { state } = craft();
    const baseState = { ...state, ext: undefined };
    expect(explorersPiratesModule.interceptAction!(baseState, 0, { type: 'buildEPSettler' })).toBeNull();
  });
});
