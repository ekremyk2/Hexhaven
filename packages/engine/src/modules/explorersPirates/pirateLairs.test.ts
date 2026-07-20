// T-1105: Explorers & Pirates crews & the Pirate Lairs mission (docs/rules/
// explorers-pirates-rules.md §EP7/§EP10/§EP12). Unit tests over CRAFTED states (same discipline as
// ships.test.ts/settling.test.ts: `craft()` + `buildLandHoBoardV0`, NOT `createGame`/a shipped
// scenario — no E&P scenario ships yet, T-1107): `buildEPCrew`'s reserve bookkeeping + harbor-
// settlement anchor, `loadCargo`/`unloadCargo`'s crew-draw/return extension (ships.ts, mirrors
// T-1104's settler extension), `placeCrewOnLair` (lair/crew-adjacency legality, landing, capture at
// `LAIR_CAPTURE_CREWS`, the lair-capture VP split), `revealOnArrival`'s new "a pirate tile is a
// gold-field lair" behavior (exploration.ts), the lair-capture VP (E&P-gated), and redaction (all
// three new ext fields are fully public).
//
// ⚠ VERIFY: every numeric/model constant this file exercises (EP_CREW_COST, the harbor-settlement
// build anchor, "pirate tiles = lairs on gold fields", the 1-VP-per-crew capture split) is a
// provisional v1 placeholder — see pirateLairs.ts's own header comment and this task's
// Implementation notes.

import { describe, expect, it } from 'vitest';
import type {
  EdgeId,
  EPCargo,
  GameConfig,
  GameState,
  HexId,
  ScenarioTerrain,
  VertexId,
} from '@hexhaven/shared';
import { GEOMETRY } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { redact } from '../../redact.js';
import { computeVp } from '../../vp.js';
import { buildLandHoBoardV0 } from './board.js';
import { revealOnArrival } from './exploration.js';
import { explorersPiratesModule } from './index.js';
import {
  EP_CREW_COST,
  LAIR_CAPTURE_CREWS,
  LAIR_CREW_VP,
  buildEPCrewHandler,
  lairPointsVpFor,
  placeCrewOnLairHandler,
} from './pirateLairs.js';
import { upgradeToHarborHandler } from './settling.js';
import { buildEPShipHandler, loadCargoHandler, unloadCargoHandler } from './ships.js';
import { crewSupplyOf, epExt, isExplorersPiratesState, withEpExt } from './state.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ep-pirate-lairs',
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

/** The sea hex bordering `edge` (a legal "lair hex" for these tests). */
function pickLairHex(seaMap: readonly ScenarioTerrain[], edge: EdgeId): HexId {
  const e = GEOMETRY.edges[edge]!;
  const seaHex = e.hexes.find((h) => seaMap[h] === 'sea');
  if (seaHex === undefined) throw new Error('BUG: no sea hex bordering edge');
  return seaHex;
}

/** Builds a crafted E&P state (same discipline as ships.test.ts's own `craft()`): seat 0 holds a
 *  home coastal settlement + a full hand, no exploration seeded (this file injects lairs directly —
 *  its own concern is crew/lair LEGALITY, not the reveal mechanism, already covered by
 *  exploration.test.ts). */
function craft(): { state: GameState; vertex: VertexId; seaEdges: EdgeId[]; seaMap: ScenarioTerrain[] } {
  const created = createGame(CONFIG);
  const { board, seaMap, rng } = buildLandHoBoardV0(created.rng);
  const { vertex, seaEdges } = findCoastalVertex(seaMap);

  const players = created.players.map((p) =>
    p.seat === 0 || p.seat === 1 ? { ...p, settlements: p.seat === 0 ? [vertex] : p.settlements, resources: { ...FULL_HAND } } : p
  );

  const state: GameState = {
    ...created,
    rng,
    board,
    players,
    ext: {
      ...created.ext,
      explorersPirates: {
        scenario: 'landHo',
        seaMap,
        ships: [],
        shipsBuiltThisTurn: [],
        movedShipsThisTurn: [],
        gold: [0, 0, 0, 0],
      },
    },
    phase: { kind: 'main' },
    turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
  };
  return { state, vertex, seaEdges, seaMap };
}

/** `craft()` plus seat 0's home settlement already upgraded to a harbor settlement (the v1
 *  `buildEPCrew` anchor, this task's own decision — see pirateLairs.ts's header). */
function craftWithHarbor() {
  const base = craft();
  const upgraded = upgradeToHarborHandler(base.state, 0, { type: 'upgradeToHarbor', vertex: base.vertex });
  if (!upgraded.ok) throw new Error('BUG: test setup failed to upgrade to a harbor settlement');
  return { ...base, state: upgraded.state };
}

/** `craftWithHarbor()` plus a single active pirate lair at a hex bordering `seaEdges[0]`, and a ship
 *  of seat 0's docked at that same edge (both the harbor-settlement anchor and the lair-adjacency
 *  edge — injected directly into ext, since sailing there is T-1102/1103's own tested scope). */
function craftWithLair() {
  const base = craftWithHarbor();
  const edge = base.seaEdges[0]!;
  const lairHex = pickLairHex(base.seaMap, edge);
  const ext = epExt(base.state)!;
  const withLair = withEpExt(base.state, { ...ext, pirateLairs: [{ hex: lairHex, crews: [] }] });
  return { ...base, state: withLair, lairHex, dockEdge: edge };
}

describe('buildEPCrew (EP7.1)', () => {
  it('pays EP_CREW_COST and increments crewSupply[seat]', () => {
    const { state } = craftWithHarbor();
    const before = state.players[0]!.resources;
    const result = buildEPCrewHandler(state, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(crewSupplyOf(result.state, 0)).toBe(1);
    expect(result.state.players[0]!.resources).toEqual({
      ...before,
      ore: before.ore - (EP_CREW_COST.ore ?? 0),
      wool: before.wool - (EP_CREW_COST.wool ?? 0),
    });
    expect(result.events).toEqual([{ type: 'epCrewBuilt', seat: 0 }]);
  });

  it('stacks across repeated calls', () => {
    const { state } = craftWithHarbor();
    const first = buildEPCrewHandler(state, 0);
    if (!first.ok) throw new Error('BUG: test setup failed');
    const second = buildEPCrewHandler(first.state, 0);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(crewSupplyOf(second.state, 0)).toBe(2);
  });

  it('rejects when the seat owns no harbor settlement (NOT_CONNECTED)', () => {
    const { state } = craft(); // a plain settlement, not yet upgraded
    const result = buildEPCrewHandler(state, 0);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'NOT_CONNECTED' }) });
  });

  it('rejects when the seat cannot afford EP_CREW_COST (CANT_AFFORD)', () => {
    const { state } = craftWithHarbor();
    const broke = {
      ...state,
      players: state.players.map((p) =>
        p.seat === 0 ? { ...p, resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 } } : p
      ),
    };
    const result = buildEPCrewHandler(broke, 0);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'CANT_AFFORD' }) });
  });

  it('rejects outside a live E&P game (EXPANSION_NOT_AVAILABLE)', () => {
    const { state } = craftWithHarbor();
    const baseState = { ...state, ext: undefined };
    expect(isExplorersPiratesState(baseState)).toBe(false);
    const result = buildEPCrewHandler(baseState, 0);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'EXPANSION_NOT_AVAILABLE' }) });
  });
});

describe('loadCargo/unloadCargo crew reserve extension (EP7.1, ships.ts, mirrors settler)', () => {
  it('loadCargo{piece:"crew"} draws from crewSupply, rejecting once empty (NO_PIECES_LEFT)', () => {
    const { state, seaEdges } = craftWithHarbor();
    const edge = seaEdges[0]!;
    const shipBuilt = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge });
    if (!shipBuilt.ok) throw new Error('BUG: test setup failed to build a ship');
    const crewBuilt = buildEPCrewHandler(shipBuilt.state, 0);
    if (!crewBuilt.ok) throw new Error('BUG: test setup failed to build a crew');
    expect(crewSupplyOf(crewBuilt.state, 0)).toBe(1);

    const loaded = loadCargoHandler(crewBuilt.state, 0, { type: 'loadCargo', ship: edge, piece: 'crew' });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(crewSupplyOf(loaded.state, 0)).toBe(0);
    expect(epExt(loaded.state)!.ships![0]!.cargo).toEqual(['crew']);

    const again = loadCargoHandler(loaded.state, 0, { type: 'loadCargo', ship: edge, piece: 'crew' });
    expect(again).toEqual({ ok: false, error: expect.objectContaining({ code: 'NO_PIECES_LEFT' }) });
  });

  it('unloadCargo{piece:"crew"} returns the unit to crewSupply', () => {
    const { state, seaEdges } = craftWithHarbor();
    const edge = seaEdges[0]!;
    const shipBuilt = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge });
    if (!shipBuilt.ok) throw new Error('BUG: test setup failed to build a ship');
    const crewBuilt = buildEPCrewHandler(shipBuilt.state, 0);
    if (!crewBuilt.ok) throw new Error('BUG: test setup failed to build a crew');
    const loaded = loadCargoHandler(crewBuilt.state, 0, { type: 'loadCargo', ship: edge, piece: 'crew' });
    if (!loaded.ok) throw new Error('BUG: test setup failed to load a crew');

    const unloaded = unloadCargoHandler(loaded.state, 0, { type: 'unloadCargo', ship: edge, piece: 'crew' });
    expect(unloaded.ok).toBe(true);
    if (!unloaded.ok) return;
    expect(crewSupplyOf(unloaded.state, 0)).toBe(1);
    expect(epExt(unloaded.state)!.ships![0]!.cargo).toEqual([]);
  });
});

describe('placeCrewOnLair (EP7.2)', () => {
  it('lands one crew on the lair (below capture threshold): consumes the cargo, appends the seat', () => {
    const { state, lairHex, dockEdge } = craftWithLair();
    const withShip = withEpExt(state, {
      ...epExt(state)!,
      ships: [{ seat: 0 as const, edge: dockEdge, cargo: ['crew'] as EPCargo[] }],
    });

    const result = placeCrewOnLairHandler(withShip, 0, { type: 'placeCrewOnLair', hex: lairHex });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'epCrewPlacedOnLair', seat: 0, hex: lairHex }]);
    const ext = epExt(result.state)!;
    expect(ext.pirateLairs).toEqual([{ hex: lairHex, crews: [0] }]);
    expect(ext.ships!.find((s) => s.edge === dockEdge)!.cargo).toEqual([]);
    expect(ext.lairPoints ?? []).toEqual([]);
  });

  it('captures the lair at LAIR_CAPTURE_CREWS, splitting VP 1-per-crew across contributing seats', () => {
    expect(LAIR_CAPTURE_CREWS).toBe(3); // sanity: this test lands exactly 3 crews (2 + 1)
    const { state, lairHex, dockEdge } = craftWithLair();
    // Seat 0 lands 2 crews (a second ship of its own, also docked adjacent to the lair), seat 1
    // lands the 3rd (the capturing crew) — LAIR_CAPTURE_CREWS (3) total. Three DISTINCT edges (one
    // ship per edge, EP3.1) all bordering the lair hex.
    const otherLairEdges = GEOMETRY.edges
      .filter((e) => e.id !== dockEdge && e.hexes.includes(lairHex))
      .map((e) => e.id);
    expect(otherLairEdges.length).toBeGreaterThanOrEqual(2);
    const secondEdge = otherLairEdges[0]!;
    const thirdEdge = otherLairEdges[1]!;
    const ext = epExt(state)!;
    const withShips = withEpExt(state, {
      ...ext,
      ships: [
        { seat: 0 as const, edge: dockEdge, cargo: ['crew'] as EPCargo[] },
        { seat: 0 as const, edge: secondEdge, cargo: ['crew'] as EPCargo[] },
        { seat: 1 as const, edge: thirdEdge, cargo: ['crew'] as EPCargo[] },
      ],
    });

    const first = placeCrewOnLairHandler(withShips, 0, { type: 'placeCrewOnLair', hex: lairHex });
    if (!first.ok) throw new Error('BUG: test setup failed to land the 1st crew');
    expect(epExt(first.state)!.pirateLairs).toEqual([{ hex: lairHex, crews: [0] }]);

    const second = placeCrewOnLairHandler(first.state, 0, { type: 'placeCrewOnLair', hex: lairHex });
    if (!second.ok) throw new Error('BUG: test setup failed to land the 2nd crew');
    expect(epExt(second.state)!.pirateLairs).toEqual([{ hex: lairHex, crews: [0, 0] }]);

    const third = placeCrewOnLairHandler(second.state, 1, { type: 'placeCrewOnLair', hex: lairHex });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.events).toEqual([
      { type: 'epCrewPlacedOnLair', seat: 1, hex: lairHex },
      {
        type: 'epLairCaptured',
        hex: lairHex,
        awards: [
          { seat: 0, vp: 2 * LAIR_CREW_VP },
          { seat: 1, vp: 1 * LAIR_CREW_VP },
        ],
      },
    ]);
    const finalExt = epExt(third.state)!;
    expect(finalExt.pirateLairs).toEqual([]); // removed from the active list
    expect(finalExt.lairPoints).toEqual([2 * LAIR_CREW_VP, 1 * LAIR_CREW_VP, 0, 0]);
  });

  it('rejects a hex with no active pirate lair (LAIR_NOT_FOUND)', () => {
    const { state, seaEdges } = craftWithHarbor();
    const notALairHex = pickLairHex(epExt(state)!.seaMap!, seaEdges[0]!);
    const result = placeCrewOnLairHandler(state, 0, { type: 'placeCrewOnLair', hex: notALairHex });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'LAIR_NOT_FOUND' }) });
  });

  it('rejects when no ship of the seat carries a crew adjacent to the lair (CREW_NOT_FOUND)', () => {
    const { state, lairHex, dockEdge } = craftWithLair();
    const noCrew = withEpExt(state, {
      ...epExt(state)!,
      ships: [{ seat: 0 as const, edge: dockEdge, cargo: [] as EPCargo[] }],
    });
    const result = placeCrewOnLairHandler(noCrew, 0, { type: 'placeCrewOnLair', hex: lairHex });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'CREW_NOT_FOUND' }) });
  });

  it('rejects outside a live E&P game (EXPANSION_NOT_AVAILABLE)', () => {
    const { state, lairHex } = craftWithLair();
    const baseState = { ...state, ext: undefined };
    const result = placeCrewOnLairHandler(baseState, 0, { type: 'placeCrewOnLair', hex: lairHex });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'EXPANSION_NOT_AVAILABLE' }) });
  });
});

describe('revealOnArrival: a pirate tile is a gold-field lair (T-1105, exploration.ts integration)', () => {
  it('writes seaMap[hex] = "gold" and appends a fresh, uncaptured pirateLairs entry', () => {
    const { state, seaEdges, seaMap } = craft();
    const edge = seaEdges[0]!;
    const hex = pickLairHex(seaMap, edge);
    const ext = epExt(state)!;
    const withSupply = withEpExt(state, {
      ...ext,
      unexplored: [hex],
      explorationSupply: [{ kind: 'pirate' }],
    });

    const result = revealOnArrival(withSupply, 0, edge);
    expect(result.events).toEqual([{ type: 'epTileRevealed', seat: 0, hex, tile: { kind: 'pirate' } }]);
    const after = epExt(result.state)!;
    expect(after.seaMap![hex]).toBe('gold');
    expect(after.pirateLairs).toEqual([{ hex, crews: [] }]);
    expect(after.unexplored).toEqual([]);
    expect(result.state.board.hexes[hex]).toEqual({ terrain: 'desert', token: null }); // still the sea proxy
  });
});

describe('lair-capture VP (EP7.2, vp.ts computeVp)', () => {
  it('lairPointsVpFor reads ext.lairPoints, 0 before any capture', () => {
    const { state } = craftWithLair();
    expect(lairPointsVpFor(state, 0)).toBe(0);
  });

  it('computeVp includes lairPointsVp in a pirateLairs-mission game, omits it (bit-identical) otherwise', () => {
    const { state } = craftWithHarbor();
    // T-1113: lairPointsVp is gated on the scenario's own `missions.pirateLairs` flag (vp.ts's
    // `epPirateLairsMissionActive`) — `craft()`'s own `scenario: 'landHo'` tag has that flag OFF, so
    // this test explicitly overrides it to the (now-shipped) `pirateLairs` scenario to exercise the
    // gate's "on" branch; the "off" branch (Land Ho!/Fish/Spice never score lair VP) is covered below.
    const withPoints = withEpExt(state, {
      ...epExt(state)!,
      scenario: 'pirateLairs',
      lairPoints: [3, 0, 0, 0],
    });
    const breakdown = computeVp(withPoints, 0);
    expect(breakdown.lairPointsVp).toBe(3);
    expect(breakdown.total).toBeGreaterThanOrEqual(3);

    const created = createGame(CONFIG);
    const baseBreakdown = computeVp(created, 0);
    expect('lairPointsVp' in baseBreakdown).toBe(false);
  });

  it('computeVp omits lairPointsVp from the total (0) when the scenario never enables the mission (Land Ho!)', () => {
    // The pre-existing `craft()` state tags `scenario: 'landHo'` (missions.pirateLairs off) — even
    // with `ext.lairPoints` somehow populated (e.g. a captured lair the mission flag says shouldn't
    // exist), computeVp must never surface it as VP there (this task's own requirement 2).
    const { state } = craftWithHarbor();
    const withPoints = withEpExt(state, { ...epExt(state)!, lairPoints: [3, 0, 0, 0] });
    const breakdown = computeVp(withPoints, 0);
    expect(breakdown.lairPointsVp).toBe(0);
  });
});

describe('redaction (EP7.1/7.2 — crewSupply/pirateLairs/lairPoints are fully public)', () => {
  it('surfaces crewSupply/pirateLairs/lairPoints identically to every viewer', () => {
    const { state, lairHex } = craftWithLair();
    const crewBuilt = buildEPCrewHandler(state, 0);
    if (!crewBuilt.ok) throw new Error('BUG: test setup failed to build a crew');
    const withPoints = withEpExt(crewBuilt.state, { ...epExt(crewBuilt.state)!, lairPoints: [1, 0, 0, 0] });

    const viewer0 = redact(withPoints, 0);
    const viewer1 = redact(withPoints, 1);
    expect(viewer1.ext?.explorersPirates?.crewSupply).toEqual([1, 0, 0, 0]);
    expect(viewer1.ext?.explorersPirates?.pirateLairs).toEqual([{ hex: lairHex, crews: [] }]);
    expect(viewer1.ext?.explorersPirates?.lairPoints).toEqual([1, 0, 0, 0]);
    expect(viewer1.ext?.explorersPirates).toEqual(viewer0.ext?.explorersPirates);
  });
});

describe('module wiring (interceptAction)', () => {
  it('routes buildEPCrew/placeCrewOnLair in a live E&P game', () => {
    const { state } = craftWithHarbor();
    const result = explorersPiratesModule.interceptAction!(state, 0, { type: 'buildEPCrew' });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
  });

  it('falls through (null) outside a live E&P game', () => {
    const { state } = craftWithHarbor();
    const baseState = { ...state, ext: undefined };
    expect(explorersPiratesModule.interceptAction!(baseState, 0, { type: 'buildEPCrew' })).toBeNull();
  });
});
