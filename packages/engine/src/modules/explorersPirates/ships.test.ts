// T-1102: Explorers & Pirates ship movement + crew/cargo engine (docs/rules/
// explorers-pirates-rules.md §EP3/§EP7/§EP12). Unit tests over CRAFTED states (testkit-style
// `craft()` + `buildLandHoBoardV0`, NOT `createGame`/a shipped scenario — no E&P scenario ships yet,
// T-1107): build/move (range, ≤1/turn, built-this-turn), cargo load/unload/cap, illegal-move
// rejection, redaction (ships public), and the module's `interceptAction`/per-turn reset wiring.
//
// ⚠ VERIFY: every numeric/location constant this file exercises (EP_SHIP_COST, SHIP_MOVE_RANGE,
// EP_MAX_SHIPS_PER_SEAT, the "coastal building substitutes for a harbor settlement" location rule)
// is a provisional v1 placeholder — see ships.ts's header comment and the task's Implementation notes.

import { describe, expect, it } from 'vitest';
import type { EdgeId, EPCargo, GameConfig, GameState, ScenarioTerrain, VertexId } from '@hexhaven/shared';
import { GEOMETRY } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { redact } from '../../redact.js';
import { buildLandHoBoardV0 } from './board.js';
import { explorersPiratesModule } from './index.js';
import { buildEPSettlerHandler } from './settling.js';
import {
  EP_MAX_SHIPS_PER_SEAT,
  EP_SHIP_COST,
  SHIP_CARGO_CAP,
  SHIP_MOVE_RANGE,
  applyExplorersPiratesTurnReset,
  buildEPShipHandler,
  isSeaEdge,
  loadCargoHandler,
  moveEPShipHandler,
  unloadCargoHandler,
} from './ships.js';
import { epExt, isExplorersPiratesState, withEpExt } from './state.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ep-ships',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const FULL_HAND = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };

function isSeaEdgeOf(seaMap: readonly ScenarioTerrain[], edgeId: EdgeId): boolean {
  const e = GEOMETRY.edges[edgeId]!;
  return e.hexes.some((h) => seaMap[h] === 'sea');
}

/** A home-island vertex with >=2 distinct sea edges incident (so ship-build/chain/move tests have
 *  real geometry to work with) — computed from the resolved `seaMap`, never hardcoded. */
function findCoastalVertex(seaMap: readonly ScenarioTerrain[]): { vertex: VertexId; seaEdges: EdgeId[] } {
  for (const v of GEOMETRY.vertices) {
    const seaEdges = v.edges.filter((e) => isSeaEdgeOf(seaMap, e));
    if (seaEdges.length >= 2) return { vertex: v.id, seaEdges };
  }
  throw new Error('BUG: no coastal vertex with >=2 sea edges found on the test board');
}

/** Sea edges NOT touching `vertex` at all (used to build "far away, unconnected" ships/edges that
 *  legally fail the junction/coastal-building checks). */
function seaEdgesAwayFrom(seaMap: readonly ScenarioTerrain[], vertex: VertexId): EdgeId[] {
  return GEOMETRY.edges
    .filter((e) => isSeaEdgeOf(seaMap, e.id) && e.a !== vertex && e.b !== vertex)
    .map((e) => e.id);
}

/** Builds a crafted E&P state: a real base game (createGame, E&P off) with its board swapped for
 *  `buildLandHoBoardV0` and `ext.explorersPirates` seeded directly — the "craft a state, don't go
 *  through createGame/a shipped scenario" discipline the task requires (no scenario ships yet). Seat
 *  0 holds a settlement at the coastal vertex (so ship-build/cargo actions have a legal anchor) and a
 *  full resource hand (so affordability never blocks a test unless it's the thing under test). */
function craft(): { state: GameState; vertex: VertexId; seaEdges: EdgeId[]; seaMap: ScenarioTerrain[] } {
  const created = createGame(CONFIG);
  const { board, seaMap, rng } = buildLandHoBoardV0(created.rng);
  const { vertex, seaEdges } = findCoastalVertex(seaMap);

  const players = created.players.map((p) =>
    p.seat === 0 ? { ...p, settlements: [vertex], resources: { ...FULL_HAND } } : p
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

describe('buildLandHoBoardV0 (T-1102 minimal test board)', () => {
  it('produces a home island (7 land hexes) surrounded by sea, with a valid robber start', () => {
    const created = createGame(CONFIG);
    const { board, seaMap } = buildLandHoBoardV0(created.rng);
    const landCount = seaMap.filter((t) => t !== 'sea').length;
    expect(landCount).toBe(7);
    expect(seaMap.filter((t) => t === 'sea')).toHaveLength(GEOMETRY.hexes.length - 7);
    expect(seaMap[board.robber]).toBe('desert');
    expect(board.hexes).toHaveLength(GEOMETRY.hexes.length);
  });

  it('is deterministic in the threaded rng (no Math.random)', () => {
    const a = buildLandHoBoardV0(12345);
    const b = buildLandHoBoardV0(12345);
    expect(a.seaMap).toEqual(b.seaMap);
    expect(a.board).toEqual(b.board);
  });
});

describe('buildEPShip (EP3.1)', () => {
  it('builds a ship on a legal coastal sea edge, paying EP_SHIP_COST and recording shipsBuiltThisTurn', () => {
    const { state, seaEdges } = craft();
    const edge = seaEdges[0]!;
    const before = state.players[0]!.resources;

    const result = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ext = epExt(result.state)!;
    expect(ext.ships).toEqual([{ seat: 0, edge, cargo: [] }]);
    expect(ext.shipsBuiltThisTurn).toEqual([edge]);
    expect(result.state.players[0]!.resources).toEqual({
      ...before,
      wool: before.wool - (EP_SHIP_COST.wool ?? 0),
      lumber: before.lumber - (EP_SHIP_COST.lumber ?? 0),
    });
    expect(result.events).toEqual([{ type: 'epShipBuilt', seat: 0, edge }]);
  });

  it('rejects a non-sea edge (NOT_A_SEA_EDGE)', () => {
    const { state, seaMap } = craft();
    const landEdge = GEOMETRY.edges.find((e) => !e.hexes.some((h) => seaMap[h] === 'sea'))!.id;
    const result = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge: landEdge });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'NOT_A_SEA_EDGE' }),
    });
  });

  it('rejects a sea edge not touching the seat\'s coast (NOT_CONNECTED)', () => {
    const { state, vertex, seaMap } = craft();
    const farEdge = seaEdgesAwayFrom(seaMap, vertex)[0]!;
    const result = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge: farEdge });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'NOT_CONNECTED' }) });
  });

  it('rejects a sea edge already carrying a ship (OCCUPIED)', () => {
    const { state, seaEdges } = craft();
    const edge = seaEdges[0]!;
    const built = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const again = buildEPShipHandler(built.state, 0, { type: 'buildEPShip', edge });
    expect(again).toEqual({ ok: false, error: expect.objectContaining({ code: 'OCCUPIED' }) });
  });

  it('rejects when the seat cannot afford EP_SHIP_COST (CANT_AFFORD)', () => {
    const { state, seaEdges } = craft();
    const broke = {
      ...state,
      players: state.players.map((p) => (p.seat === 0 ? { ...p, resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 } } : p)),
    };
    const result = buildEPShipHandler(broke, 0, { type: 'buildEPShip', edge: seaEdges[0]! });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'CANT_AFFORD' }) });
  });

  it('rejects a ship count over EP_MAX_SHIPS_PER_SEAT (NO_PIECES_LEFT)', () => {
    const { state, seaEdges, seaMap } = craft();
    const dummyEdges = seaEdgesAwayFrom(seaMap, state.players[0]!.settlements[0]!).slice(0, EP_MAX_SHIPS_PER_SEAT);
    expect(dummyEdges).toHaveLength(EP_MAX_SHIPS_PER_SEAT);
    const full = withEpExt(state, {
      ...epExt(state)!,
      ships: dummyEdges.map((edge) => ({ seat: 0 as const, edge, cargo: [] as EPCargo[] })),
    });
    const result = buildEPShipHandler(full, 0, { type: 'buildEPShip', edge: seaEdges[0]! });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'NO_PIECES_LEFT' }) });
  });

  it('rejects outside a live E&P game (EXPANSION_NOT_AVAILABLE)', () => {
    const { state, seaEdges } = craft();
    const baseState = { ...state, ext: undefined };
    expect(isExplorersPiratesState(baseState)).toBe(false);
    const result = buildEPShipHandler(baseState, 0, { type: 'buildEPShip', edge: seaEdges[0]! });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'EXPANSION_NOT_AVAILABLE' }) });
  });
});

describe('moveEPShip (EP3.2)', () => {
  function craftWithShip() {
    const crafted = craft();
    const edge = crafted.seaEdges[0]!;
    const built = buildEPShipHandler(crafted.state, 0, { type: 'buildEPShip', edge });
    if (!built.ok) throw new Error('BUG: test setup failed to build a ship');
    // Clear shipsBuiltThisTurn so the ship is immediately movable (a fresh turn) unless a test wants
    // to exercise the "just built" rejection itself.
    const ext = epExt(built.state)!;
    const readyState = withEpExt(built.state, { ...ext, shipsBuiltThisTurn: [] });
    return { ...crafted, state: readyState, shipEdge: edge };
  }

  it('moves a ship to a reachable sea edge within SHIP_MOVE_RANGE, recording movedShipsThisTurn', () => {
    const { state, seaEdges, shipEdge } = craftWithShip();
    const to = seaEdges[1]!;
    const result = moveEPShipHandler(state, 0, { type: 'moveEPShip', from: shipEdge, to });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ext = epExt(result.state)!;
    expect(ext.ships).toEqual([{ seat: 0, edge: to, cargo: [] }]);
    expect(ext.movedShipsThisTurn).toEqual([to]);
    expect(result.events).toEqual([{ type: 'epShipMoved', seat: 0, from: shipEdge, to }]);
  });

  it('rejects moving an edge with no ship (SHIP_NOT_FOUND)', () => {
    const { state, seaEdges } = craftWithShip();
    const result = moveEPShipHandler(state, 0, { type: 'moveEPShip', from: seaEdges[1]!, to: seaEdges[0]! });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'SHIP_NOT_FOUND' }) });
  });

  it('rejects moving a ship built this turn (SHIP_BUILT_THIS_TURN)', () => {
    const crafted = craft();
    const edge = crafted.seaEdges[0]!;
    const built = buildEPShipHandler(crafted.state, 0, { type: 'buildEPShip', edge });
    if (!built.ok) throw new Error('BUG: test setup failed to build a ship');
    const result = moveEPShipHandler(built.state, 0, { type: 'moveEPShip', from: edge, to: crafted.seaEdges[1]! });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'SHIP_BUILT_THIS_TURN' }) });
  });

  it('rejects a second move of the same ship this turn (SHIP_ALREADY_MOVED)', () => {
    const { state, seaEdges, shipEdge } = craftWithShip();
    const firstMove = moveEPShipHandler(state, 0, { type: 'moveEPShip', from: shipEdge, to: seaEdges[1]! });
    expect(firstMove.ok).toBe(true);
    if (!firstMove.ok) return;
    // The ship's identity is now its NEW edge (seaEdges[1]) — trying to move it again this turn is
    // rejected, even back to where it started.
    const secondMove = moveEPShipHandler(firstMove.state, 0, {
      type: 'moveEPShip',
      from: seaEdges[1]!,
      to: shipEdge,
    });
    expect(secondMove).toEqual({ ok: false, error: expect.objectContaining({ code: 'SHIP_ALREADY_MOVED' }) });
  });

  it('rejects a destination already carrying a ship (OCCUPIED)', () => {
    const { state, seaEdges, shipEdge } = craftWithShip();
    // Build a second ship on seaEdges[1] (also touches the coastal vertex) so it's occupied.
    const withSecond = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge: seaEdges[1]! });
    expect(withSecond.ok).toBe(true);
    if (!withSecond.ok) return;
    const result = moveEPShipHandler(withSecond.state, 0, {
      type: 'moveEPShip',
      from: shipEdge,
      to: seaEdges[1]!,
    });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'OCCUPIED' }) });
  });

  it('rejects a destination farther than SHIP_MOVE_RANGE sea routes away (SHIP_MOVE_TOO_FAR)', () => {
    const { state, seaMap, shipEdge } = craftWithShip();
    // BFS the same sea-edge-adjacency graph independently (test-local, not a reuse of ships.ts's own
    // search) to find the farthest reachable sea edge from the ship's position.
    const dist = new Map<EdgeId, number>([[shipEdge, 0]]);
    let frontier: EdgeId[] = [shipEdge];
    for (let d = 1; frontier.length > 0; d++) {
      const next: EdgeId[] = [];
      for (const e of frontier) {
        const edge = GEOMETRY.edges[e]!;
        for (const v of [edge.a, edge.b]) {
          for (const adj of GEOMETRY.vertices[v]!.edges) {
            if (dist.has(adj) || !isSeaEdgeOf(seaMap, adj)) continue;
            dist.set(adj, d);
            next.push(adj);
          }
        }
      }
      frontier = next;
    }
    const maxDist = Math.max(...dist.values());
    expect(maxDist).toBeGreaterThan(SHIP_MOVE_RANGE); // sanity: the test board is large enough
    const farEdge = [...dist.entries()].find(([, d]) => d > SHIP_MOVE_RANGE)![0];

    const result = moveEPShipHandler(state, 0, { type: 'moveEPShip', from: shipEdge, to: farEdge });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'SHIP_MOVE_TOO_FAR' }) });
  });
});

describe('loadCargo / unloadCargo (EP3.3)', () => {
  it('loads up to SHIP_CARGO_CAP pieces and rejects a further load (CARGO_FULL)', () => {
    const { state, seaEdges } = craft();
    const edge = seaEdges[0]!;
    const built = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge });
    if (!built.ok) throw new Error('BUG: test setup failed to build a ship');

    // Uses 'fish' (never reserve-gated, unlike 'settler'/'crew' — T-1104/T-1105's own extensions,
    // owned by settling.test.ts/pirateLairs.test.ts) so this test exercises only the plain 2-piece
    // cargo cap, unaffected by either reserve-pool extension.
    const loaded1 = loadCargoHandler(built.state, 0, { type: 'loadCargo', ship: edge, piece: 'fish' });
    expect(loaded1.ok).toBe(true);
    if (!loaded1.ok) return;
    expect(epExt(loaded1.state)!.ships![0]!.cargo).toEqual(['fish']);
    expect(loaded1.events).toEqual([{ type: 'epCargoLoaded', seat: 0, ship: edge, piece: 'fish' }]);

    // T-1104 (§EP4.1) extended loadCargo{piece:'settler'} to draw from the seat's settler reserve
    // (settling.ts's own tests own that behavior in depth) — build one here first so this test still
    // exercises the plain 2-piece cargo cap, unaffected by that extension.
    const settlerBuilt = buildEPSettlerHandler(loaded1.state, 0);
    if (!settlerBuilt.ok) throw new Error('BUG: test setup failed to build a settler');

    const loaded2 = loadCargoHandler(settlerBuilt.state, 0, { type: 'loadCargo', ship: edge, piece: 'settler' });
    expect(loaded2.ok).toBe(true);
    if (!loaded2.ok) return;
    expect(epExt(loaded2.state)!.ships![0]!.cargo).toEqual(['fish', 'settler']);
    expect(epExt(loaded2.state)!.ships![0]!.cargo).toHaveLength(SHIP_CARGO_CAP);

    const loaded3 = loadCargoHandler(loaded2.state, 0, { type: 'loadCargo', ship: edge, piece: 'fish' });
    expect(loaded3).toEqual({ ok: false, error: expect.objectContaining({ code: 'CARGO_FULL' }) });
  });

  it('unloads a carried piece, and rejects unloading one not aboard (CARGO_NOT_FOUND)', () => {
    const { state, seaEdges } = craft();
    const edge = seaEdges[0]!;
    const built = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge });
    if (!built.ok) throw new Error('BUG: test setup failed to build a ship');
    const loaded = loadCargoHandler(built.state, 0, { type: 'loadCargo', ship: edge, piece: 'fish' });
    if (!loaded.ok) throw new Error('BUG: test setup failed to load cargo');

    const unloaded = unloadCargoHandler(loaded.state, 0, { type: 'unloadCargo', ship: edge, piece: 'fish' });
    expect(unloaded.ok).toBe(true);
    if (!unloaded.ok) return;
    expect(epExt(unloaded.state)!.ships![0]!.cargo).toEqual([]);
    expect(unloaded.events).toEqual([{ type: 'epCargoUnloaded', seat: 0, ship: edge, piece: 'fish' }]);

    const missing = unloadCargoHandler(unloaded.state, 0, { type: 'unloadCargo', ship: edge, piece: 'spice' });
    expect(missing).toEqual({ ok: false, error: expect.objectContaining({ code: 'CARGO_NOT_FOUND' }) });
  });

  it('rejects loading a ship not found on that edge (SHIP_NOT_FOUND)', () => {
    const { state, seaEdges } = craft();
    const result = loadCargoHandler(state, 0, { type: 'loadCargo', ship: seaEdges[0]!, piece: 'fish' });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'SHIP_NOT_FOUND' }) });
  });

  it('rejects loading a ship whose edge only touches another ship, not a coastal building (NOT_CONNECTED)', () => {
    const { state, vertex, seaEdges } = craft();
    const edge0 = seaEdges[0]!;
    const ship1 = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge: edge0 });
    if (!ship1.ok) throw new Error('BUG: test setup failed to build a ship');

    // A second ship chained off ship1's OTHER endpoint (not the settlement vertex) — legal to build
    // (junction rule allows chaining off an own ship) but has no coastal building anchor of its own.
    const e0 = GEOMETRY.edges[edge0]!;
    const otherEnd = e0.a === vertex ? e0.b : e0.a;
    const chainEdge = GEOMETRY.vertices[otherEnd]!.edges.find(
      (e) => e !== edge0 && isSeaEdgeOf(epExt(ship1.state)!.seaMap!, e)
    );
    expect(chainEdge).toBeDefined();
    const ship2 = buildEPShipHandler(ship1.state, 0, { type: 'buildEPShip', edge: chainEdge! });
    expect(ship2.ok).toBe(true);
    if (!ship2.ok) return;

    const result = loadCargoHandler(ship2.state, 0, { type: 'loadCargo', ship: chainEdge!, piece: 'fish' });
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'NOT_CONNECTED' }) });
  });
});

describe('per-turn reset (applyExplorersPiratesTurnReset, EP3.2)', () => {
  it('clears shipsBuiltThisTurn/movedShipsThisTurn, and is a no-op when both are already empty', () => {
    const { state, seaEdges } = craft();
    const dirty = withEpExt(state, {
      ...epExt(state)!,
      shipsBuiltThisTurn: [seaEdges[0]!],
      movedShipsThisTurn: [seaEdges[1]!],
    });
    const reset = applyExplorersPiratesTurnReset(dirty);
    expect(reset).not.toBeNull();
    expect(epExt(reset!.state)!.shipsBuiltThisTurn).toEqual([]);
    expect(epExt(reset!.state)!.movedShipsThisTurn).toEqual([]);

    expect(applyExplorersPiratesTurnReset(reset!.state)).toBeNull();
  });

  it('is a no-op outside a live E&P game', () => {
    const { state } = craft();
    expect(applyExplorersPiratesTurnReset({ ...state, ext: undefined })).toBeNull();
  });
});

describe('module wiring (interceptAction / phaseHooks.afterAction)', () => {
  it('interceptAction routes buildEPShip/moveEPShip/loadCargo/unloadCargo in a live E&P game', () => {
    const { state, seaEdges } = craft();
    const edge = seaEdges[0]!;
    const result = explorersPiratesModule.interceptAction!(state, 0, { type: 'buildEPShip', edge });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
  });

  it('interceptAction falls through (null) outside a live E&P game or for other actions', () => {
    const { state, seaEdges } = craft();
    expect(explorersPiratesModule.interceptAction!({ ...state, ext: undefined }, 0, {
      type: 'buildEPShip',
      edge: seaEdges[0]!,
    })).toBeNull();
    expect(explorersPiratesModule.interceptAction!(state, 0, { type: 'endTurn' })).toBeNull();
  });

  it('phaseHooks.afterAction clears the per-turn bookkeeping after endTurn', () => {
    const { state, seaEdges } = craft();
    const built = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge: seaEdges[0]! });
    if (!built.ok) throw new Error('BUG: test setup failed to build a ship');
    expect(epExt(built.state)!.shipsBuiltThisTurn).toEqual([seaEdges[0]!]);

    const hooked = explorersPiratesModule.phaseHooks!.afterAction!(
      state,
      built.state,
      { type: 'endTurn' },
      [],
      0
    );
    expect(hooked).not.toBeNull();
    expect(epExt(hooked!.state)!.shipsBuiltThisTurn).toEqual([]);
  });
});

describe('redaction (EP3, ships/gold/seaMap are fully public)', () => {
  it('surfaces the whole explorersPirates ext block to every viewer, unredacted', () => {
    const { state, seaEdges } = craft();
    const built = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge: seaEdges[0]! });
    if (!built.ok) throw new Error('BUG: test setup failed to build a ship');

    const viewer1 = redact(built.state, 1);
    const viewer0 = redact(built.state, 0);
    expect(viewer1.ext?.explorersPirates).toEqual(viewer0.ext?.explorersPirates);
    expect(viewer1.ext?.explorersPirates?.ships).toEqual([{ seat: 0, edge: seaEdges[0]!, cargo: [] }]);
    expect(viewer1.ext?.explorersPirates?.shipsBuiltThisTurn).toEqual([seaEdges[0]!]);
    expect(viewer1.ext?.explorersPirates?.seaMap).toEqual(epExt(built.state)!.seaMap);
    expect(viewer1.ext?.explorersPirates?.gold).toEqual([0, 0, 0, 0]);
  });

  it('is absent for a base (non-E&P) game', () => {
    const created = createGame(CONFIG);
    const view = redact(created, 0);
    expect(view.ext?.explorersPirates).toBeUndefined();
  });
});

describe('isSeaEdge', () => {
  it('is true only for edges bordering a sea hex (per the resolved seaMap)', () => {
    const { state, seaEdges, seaMap } = craft();
    expect(isSeaEdge(state, seaEdges[0]!)).toBe(true);
    const landEdge = GEOMETRY.edges.find((e) => !e.hexes.some((h) => seaMap[h] === 'sea'))!.id;
    expect(isSeaEdge(state, landEdge)).toBe(false);
  });
});
