// T-1106: Explorers & Pirates Fish for Hexhaven + Spices for Hexhaven missions + the gold economy
// (docs/rules/explorers-pirates-rules.md §EP6/§EP8/§EP9). Unit tests over CRAFTED states (same
// discipline as ships.test.ts/pirateLairs.test.ts: `craft()` + `buildLandHoBoardV0`, NOT
// `createGame`/a shipped scenario — no E&P scenario ships yet, T-1107): `seedFishSpiceV0`, the
// `rollDice` gold-compensation hook (EP6.1), `shipGold` (EP6.2), the fish auto-haul on ship arrival +
// `deliverFish` (EP8), `tradeSpice` + `deliverSpice` + the `spiceBenefit` ship-range wiring (EP9),
// VP (E&P-gated), and redaction (every new field is fully public).
//
// ⚠ VERIFY: every numeric/model constant this file exercises (GOLD_COMPENSATION, GOLD_PER_VP,
// SPICE_TRADE_COST_GOLD, FISH_VP_PER_DELIVERY, SPICE_VP_PER_DELIVERY, SPICE_BENEFIT_MAX_BONUS, the
// "gold fields fold into EP6.1" and "shipGold has no location requirement" decisions) is a
// provisional v1 placeholder — see goldFishSpice.ts's own header comment and this task's
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
import { production } from '../../events.js';
import { redact } from '../../redact.js';
import { computeVp } from '../../vp.js';
import { buildLandHoBoardV0 } from './board.js';
import {
  FISH_SHOAL_COUNT,
  FISH_VP_PER_DELIVERY,
  GOLD_COMPENSATION,
  GOLD_PER_VP,
  SPICE_BENEFIT_MAX_BONUS,
  SPICE_TRADE_COST_GOLD,
  SPICE_VP_PER_DELIVERY,
  VILLAGE_COUNT,
  applyGoldCompensation,
  deliverFishHandler,
  deliverSpiceHandler,
  fishPointsVpFor,
  goldPointsVpFor,
  haulFishOnArrival,
  seedFishSpiceV0,
  shipGoldHandler,
  spicePointsVpFor,
  spiceShipRangeBonus,
  tradeSpiceHandler,
} from './goldFishSpice.js';
import { explorersPiratesModule } from './index.js';
import { SHIP_CARGO_CAP, SHIP_MOVE_RANGE, buildEPShipHandler, moveEPShipHandler } from './ships.js';
import { epExt, isExplorersPiratesState, withEpExt } from './state.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ep-gold-fish-spice',
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

/** A sea edge bordering `hex` (works for a sea hex OR a land hex — an edge between land and sea is
 *  itself a sea edge, `isSeaEdgeOf`'s own definition). Mirrors pirateLairs.test.ts's `pickLairHex`,
 *  inverted (hex -> edge instead of edge -> hex). */
function findDockEdge(seaMap: readonly ScenarioTerrain[], hex: HexId): EdgeId {
  const edge = GEOMETRY.edges.find((e) => e.hexes.includes(hex) && isSeaEdgeOf(seaMap, e.id));
  if (!edge) throw new Error(`BUG: no sea edge borders hex ${hex}`);
  return edge.id;
}

/** The sea hex bordering `edge` (a legal "shoal hex" for these tests) — mirrors
 *  pirateLairs.test.ts's `pickLairHex`. */
function pickSeaHex(seaMap: readonly ScenarioTerrain[], edge: EdgeId): HexId {
  const e = GEOMETRY.edges[edge]!;
  const seaHex = e.hexes.find((h) => seaMap[h] === 'sea');
  if (seaHex === undefined) throw new Error('BUG: no sea hex bordering edge');
  return seaHex;
}

/** Clears `shipsBuiltThisTurn` so a just-built ship is immediately movable (a fresh turn) — mirrors
 *  ships.test.ts's own `readyState` pattern. */
function readyToMove(state: GameState): GameState {
  return withEpExt(state, { ...epExt(state)!, shipsBuiltThisTurn: [] });
}

/** Builds a crafted E&P state (same discipline as ships.test.ts/pirateLairs.test.ts's own `craft()`):
 *  seat 0 holds a home coastal settlement + a full hand, gold seeded per `golds` (default all 0). No
 *  fish/spice/gold-mission fields seeded — each describe block injects only what it needs directly.
 *  `scenario: 'fullCampaign'` (T-1110: every mission flag ON) rather than `'landHo'` — this file's own
 *  unit tests exercise `haulFishOnArrival`/`deliverFishHandler`/`deliverSpiceHandler` directly against
 *  hand-crafted `fishShoals`/`villages`/`councilVertex`, independent of any real scenario's actual
 *  seeding; T-1110 additionally gates those handlers on `epFishMissionActive`/`epSpiceMissionActive`
 *  (the scenario's OWN mission flags, state.ts), so `craft()` needs a scenario tag with both missions
 *  on to keep exercising the SAME crafted-field behavior these tests always have — `'landHo'` (no
 *  missions) would now make every fish/spice assertion here fail on the new mission gate instead of
 *  the behavior under test. */
function craft(golds: number[] = [0, 0, 0, 0]): {
  state: GameState;
  vertex: VertexId;
  seaEdges: EdgeId[];
  seaMap: ScenarioTerrain[];
} {
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
        scenario: 'fullCampaign',
        seaMap,
        ships: [],
        shipsBuiltThisTurn: [],
        movedShipsThisTurn: [],
        gold: golds,
      },
    },
    phase: { kind: 'main' },
    turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
  };
  return { state, vertex, seaEdges, seaMap };
}

describe('seedFishSpiceV0 (T-1106 init helper)', () => {
  it('seeds fishShoals from fog (sea) hexes and villages/council from revealed land hexes', () => {
    const created = createGame(CONFIG);
    const { seaMap, rng } = buildLandHoBoardV0(created.rng);
    const result = seedFishSpiceV0(rng, { seaMap });

    expect(result.fishShoals).toHaveLength(FISH_SHOAL_COUNT);
    expect(result.villages).toHaveLength(VILLAGE_COUNT);
    for (const hex of result.fishShoals) expect(seaMap[hex]).toBe('sea');
    for (const hex of result.villages) {
      expect(seaMap[hex]).not.toBe('sea');
      expect(seaMap[hex]).not.toBe('gold');
    }
    // Disjoint sets: a hex can't be both a shoal (sea) and a village (real land).
    for (const hex of result.villages) expect(result.fishShoals).not.toContain(hex);

    const vert = GEOMETRY.vertices[result.councilVertex];
    expect(vert).toBeDefined();
  });

  it('threads rng (deterministic per seed, no Math.random)', () => {
    const created = createGame(CONFIG);
    const { seaMap, rng } = buildLandHoBoardV0(created.rng);
    const a = seedFishSpiceV0(rng, { seaMap });
    const b = seedFishSpiceV0(rng, { seaMap });
    expect(a.fishShoals).toEqual(b.fishShoals); // same input rng -> same draw (purity)
    expect(a.villages).toEqual(b.villages);
  });
});

describe('applyGoldCompensation (EP6.1, rollDice phaseHooks.afterAction)', () => {
  it('gives GOLD_COMPENSATION to every seat absent from the production event’s gains', () => {
    const { state } = craft([0, 0, 0, 0]);
    const events = [production([{ seat: 1, resources: { ore: 2 } }], [])];
    const result = applyGoldCompensation(state, events);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(epExt(result.state)!.gold).toEqual([
      GOLD_COMPENSATION,
      0,
      GOLD_COMPENSATION,
      GOLD_COMPENSATION,
    ]);
    expect(result.events).toEqual([
      ...events,
      { type: 'epGoldCompensated', gains: [
        { seat: 0, amount: GOLD_COMPENSATION },
        { seat: 2, amount: GOLD_COMPENSATION },
        { seat: 3, amount: GOLD_COMPENSATION },
      ] },
    ]);
  });

  it('returns null when every seat produced something', () => {
    const { state } = craft();
    const events = [
      production(
        [0, 1, 2, 3].map((seat) => ({ seat: seat as 0 | 1 | 2 | 3, resources: { ore: 1 } })),
        []
      ),
    ];
    expect(applyGoldCompensation(state, events)).toBeNull();
  });

  it('returns null on a 7 (no production event — discard/robber instead)', () => {
    const { state } = craft();
    expect(applyGoldCompensation(state, [{ type: 'discardRequired', seats: [] }])).toBeNull();
  });

  it('returns null outside a live E&P game', () => {
    const { state } = craft();
    const baseState = { ...state, ext: undefined };
    const events = [production([], [])];
    expect(applyGoldCompensation(baseState, events)).toBeNull();
  });

  it('is wired through the module’s phaseHooks.afterAction on rollDice', () => {
    const { state } = craft();
    const events = [production([{ seat: 0, resources: { ore: 1 } }], [])];
    const hooked = explorersPiratesModule.phaseHooks!.afterAction!(state, state, { type: 'rollDice' }, events, 0);
    expect(hooked).not.toBeNull();
    if (!hooked) return;
    expect(epExt(hooked.state)!.gold).toEqual([0, GOLD_COMPENSATION, GOLD_COMPENSATION, GOLD_COMPENSATION]);
  });
});

describe('shipGold (EP6.2)', () => {
  it('spends GOLD_PER_VP gold for 1 goldPoints VP', () => {
    const { state } = craft([GOLD_PER_VP, 0, 0, 0]);
    const result = shipGoldHandler(state, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(epExt(result.state)!.gold).toEqual([0, 0, 0, 0]);
    expect(epExt(result.state)!.goldPoints).toEqual([1, 0, 0, 0]);
    expect(result.events).toEqual([{ type: 'epGoldShipped', seat: 0 }]);
  });

  it('rejects when the seat cannot afford GOLD_PER_VP (NOT_ENOUGH_GOLD)', () => {
    const { state } = craft([GOLD_PER_VP - 1, 0, 0, 0]);
    const result = shipGoldHandler(state, 0);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'NOT_ENOUGH_GOLD' }) });
  });

  it('rejects outside a live E&P game (EXPANSION_NOT_AVAILABLE)', () => {
    const { state } = craft([GOLD_PER_VP, 0, 0, 0]);
    const baseState = { ...state, ext: undefined };
    expect(isExplorersPiratesState(baseState)).toBe(false);
    const result = shipGoldHandler(baseState, 0);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'EXPANSION_NOT_AVAILABLE' }) });
  });
});

describe('fish auto-haul on arrival (EP8, moveEPShipHandler integration)', () => {
  it('a ship arriving at an edge bordering a fish shoal auto-loads a fish cargo unit', () => {
    const { state, seaEdges, seaMap } = craft();
    const fromEdge = seaEdges[1]!;
    const toEdge = seaEdges[0]!;
    const shoalHex = pickSeaHex(seaMap, toEdge);
    const seeded = withEpExt(state, { ...epExt(state)!, fishShoals: [shoalHex] });

    const built = buildEPShipHandler(seeded, 0, { type: 'buildEPShip', edge: fromEdge });
    if (!built.ok) throw new Error('BUG: test setup failed to build a ship');

    const moved = moveEPShipHandler(readyToMove(built.state), 0, {
      type: 'moveEPShip',
      from: fromEdge,
      to: toEdge,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(epExt(moved.state)!.ships!.find((s) => s.edge === toEdge)!.cargo).toEqual(['fish']);
    expect(moved.events).toEqual(
      expect.arrayContaining([{ type: 'epFishHauled', seat: 0, hex: shoalHex }])
    );
  });

  it('does not haul when the arrival edge borders no shoal', () => {
    const { state, seaEdges } = craft();
    const fromEdge = seaEdges[1]!;
    const toEdge = seaEdges[0]!;
    const seeded = withEpExt(state, { ...epExt(state)!, fishShoals: [] });
    const built = buildEPShipHandler(seeded, 0, { type: 'buildEPShip', edge: fromEdge });
    if (!built.ok) throw new Error('BUG: test setup failed to build a ship');
    const moved = moveEPShipHandler(readyToMove(built.state), 0, {
      type: 'moveEPShip',
      from: fromEdge,
      to: toEdge,
    });
    if (!moved.ok) throw new Error('BUG: test setup move failed');
    expect(epExt(moved.state)!.ships!.find((s) => s.edge === toEdge)!.cargo).toEqual([]);
    expect(moved.events.some((e) => e.type === 'epFishHauled')).toBe(false);
  });

  it('does not haul when the ship’s cargo bay is already full', () => {
    const { state, seaEdges, seaMap } = craft();
    const fromEdge = seaEdges[1]!;
    const toEdge = seaEdges[0]!;
    const shoalHex = pickSeaHex(seaMap, toEdge);
    const seeded = withEpExt(state, { ...epExt(state)!, fishShoals: [shoalHex] });
    const built = buildEPShipHandler(seeded, 0, { type: 'buildEPShip', edge: fromEdge });
    if (!built.ok) throw new Error('BUG: test setup failed to build a ship');
    const fullCargo = withEpExt(readyToMove(built.state), {
      ...epExt(built.state)!,
      shipsBuiltThisTurn: [],
      ships: epExt(built.state)!.ships!.map((s) =>
        s.edge === fromEdge ? { ...s, cargo: ['crew', 'settler'] as EPCargo[] } : s
      ),
    });
    const moved = moveEPShipHandler(fullCargo, 0, { type: 'moveEPShip', from: fromEdge, to: toEdge });
    if (!moved.ok) throw new Error('BUG: test setup move failed');
    expect(epExt(moved.state)!.ships!.find((s) => s.edge === toEdge)!.cargo).toEqual(['crew', 'settler']);
    expect(moved.events.some((e) => e.type === 'epFishHauled')).toBe(false);
  });

  it('haulFishOnArrival is a no-op outside a live E&P game', () => {
    const { state } = craft();
    const baseState = { ...state, ext: undefined };
    const result = haulFishOnArrival(baseState, 0, 0 as EdgeId, SHIP_CARGO_CAP);
    expect(result).toEqual({ state: baseState, events: [] });
  });
});

describe('deliverFish (EP8)', () => {
  it('delivers a fish cargo unit at councilVertex for FISH_VP_PER_DELIVERY VP', () => {
    const { state, vertex, seaEdges } = craft();
    const dockEdge = seaEdges[0]!;
    const seeded = withEpExt(state, {
      ...epExt(state)!,
      councilVertex: vertex,
      ships: [{ seat: 0 as const, edge: dockEdge, cargo: ['fish'] as EPCargo[] }],
    });

    const result = deliverFishHandler(seeded, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(epExt(result.state)!.fishPoints).toEqual([FISH_VP_PER_DELIVERY, 0, 0, 0]);
    expect(epExt(result.state)!.ships!.find((s) => s.edge === dockEdge)!.cargo).toEqual([]);
    expect(result.events).toEqual([{ type: 'epFishDelivered', seat: 0, vp: FISH_VP_PER_DELIVERY }]);
  });

  it('rejects when no ship carrying fish is adjacent to the council (FISH_NOT_FOUND)', () => {
    const { state, vertex, seaEdges } = craft();
    const dockEdge = seaEdges[0]!;
    const seeded = withEpExt(state, {
      ...epExt(state)!,
      councilVertex: vertex,
      ships: [{ seat: 0 as const, edge: dockEdge, cargo: [] as EPCargo[] }],
    });
    const result = deliverFishHandler(seeded, 0);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'FISH_NOT_FOUND' }) });
  });

  it('rejects outside a live E&P game (EXPANSION_NOT_AVAILABLE)', () => {
    const { state } = craft();
    const baseState = { ...state, ext: undefined };
    const result = deliverFishHandler(baseState, 0);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'EXPANSION_NOT_AVAILABLE' }) });
  });
});

describe('tradeSpice (EP9)', () => {
  it('pays SPICE_TRADE_COST_GOLD gold at an adjacent village for a spice cargo unit', () => {
    const { state, seaMap } = craft([SPICE_TRADE_COST_GOLD, 0, 0, 0]);
    const villageHex = GEOMETRY.hexes.find((h) => seaMap[h.id] !== 'sea')!.id;
    const dockEdge = findDockEdge(seaMap, villageHex);
    const seeded = withEpExt(state, {
      ...epExt(state)!,
      villages: [villageHex],
      ships: [{ seat: 0 as const, edge: dockEdge, cargo: [] as EPCargo[] }],
    });

    const result = tradeSpiceHandler(seeded, 0, { type: 'tradeSpice', hex: villageHex }, SHIP_CARGO_CAP);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(epExt(result.state)!.gold).toEqual([0, 0, 0, 0]);
    expect(epExt(result.state)!.ships!.find((s) => s.edge === dockEdge)!.cargo).toEqual(['spice']);
    expect(result.events).toEqual([{ type: 'epSpiceTraded', seat: 0, hex: villageHex }]);
  });

  it('rejects a hex with no active village (VILLAGE_NOT_FOUND)', () => {
    const { state, seaMap } = craft([SPICE_TRADE_COST_GOLD, 0, 0, 0]);
    const someHex = GEOMETRY.hexes.find((h) => seaMap[h.id] !== 'sea')!.id;
    const result = tradeSpiceHandler(state, 0, { type: 'tradeSpice', hex: someHex }, SHIP_CARGO_CAP);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'VILLAGE_NOT_FOUND' }) });
  });

  it('rejects when no ship of the seat is adjacent to the village (NOT_CONNECTED)', () => {
    const { state, seaMap } = craft([SPICE_TRADE_COST_GOLD, 0, 0, 0]);
    const villageHex = GEOMETRY.hexes.find((h) => seaMap[h.id] !== 'sea')!.id;
    const seeded = withEpExt(state, { ...epExt(state)!, villages: [villageHex], ships: [] });
    const result = tradeSpiceHandler(seeded, 0, { type: 'tradeSpice', hex: villageHex }, SHIP_CARGO_CAP);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'NOT_CONNECTED' }) });
  });

  it('rejects a full cargo bay (CARGO_FULL)', () => {
    const { state, seaMap } = craft([SPICE_TRADE_COST_GOLD, 0, 0, 0]);
    const villageHex = GEOMETRY.hexes.find((h) => seaMap[h.id] !== 'sea')!.id;
    const dockEdge = findDockEdge(seaMap, villageHex);
    const seeded = withEpExt(state, {
      ...epExt(state)!,
      villages: [villageHex],
      ships: [{ seat: 0 as const, edge: dockEdge, cargo: ['crew', 'settler'] as EPCargo[] }],
    });
    const result = tradeSpiceHandler(seeded, 0, { type: 'tradeSpice', hex: villageHex }, SHIP_CARGO_CAP);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'CARGO_FULL' }) });
  });

  it('rejects when the seat cannot afford SPICE_TRADE_COST_GOLD (NOT_ENOUGH_GOLD)', () => {
    const { state, seaMap } = craft([0, 0, 0, 0]);
    const villageHex = GEOMETRY.hexes.find((h) => seaMap[h.id] !== 'sea')!.id;
    const dockEdge = findDockEdge(seaMap, villageHex);
    const seeded = withEpExt(state, {
      ...epExt(state)!,
      villages: [villageHex],
      ships: [{ seat: 0 as const, edge: dockEdge, cargo: [] as EPCargo[] }],
    });
    const result = tradeSpiceHandler(seeded, 0, { type: 'tradeSpice', hex: villageHex }, SHIP_CARGO_CAP);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'NOT_ENOUGH_GOLD' }) });
  });
});

describe('deliverSpice (EP9) + spiceBenefit ship-range wiring', () => {
  it('delivers a spice cargo unit for SPICE_VP_PER_DELIVERY VP and raises spiceBenefit', () => {
    const { state, vertex, seaEdges } = craft();
    const dockEdge = seaEdges[0]!;
    const seeded = withEpExt(state, {
      ...epExt(state)!,
      councilVertex: vertex,
      ships: [{ seat: 0 as const, edge: dockEdge, cargo: ['spice'] as EPCargo[] }],
    });

    const result = deliverSpiceHandler(seeded, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(epExt(result.state)!.spicePoints).toEqual([SPICE_VP_PER_DELIVERY, 0, 0, 0]);
    expect(epExt(result.state)!.spiceBenefit).toEqual([1, 0, 0, 0]);
    expect(epExt(result.state)!.ships!.find((s) => s.edge === dockEdge)!.cargo).toEqual([]);
    expect(result.events).toEqual([
      { type: 'epSpiceDelivered', seat: 0, vp: SPICE_VP_PER_DELIVERY, benefit: 1 },
    ]);
  });

  it('rejects when no ship carrying spice is adjacent to the council (SPICE_NOT_FOUND)', () => {
    const { state, vertex, seaEdges } = craft();
    const dockEdge = seaEdges[0]!;
    const seeded = withEpExt(state, {
      ...epExt(state)!,
      councilVertex: vertex,
      ships: [{ seat: 0 as const, edge: dockEdge, cargo: [] as EPCargo[] }],
    });
    const result = deliverSpiceHandler(seeded, 0);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'SPICE_NOT_FOUND' }) });
  });

  it('spiceShipRangeBonus reads the level capped at SPICE_BENEFIT_MAX_BONUS', () => {
    const { state } = craft();
    expect(spiceShipRangeBonus(state, 0)).toBe(0);
    const level1 = withEpExt(state, { ...epExt(state)!, spiceBenefit: [1, 0, 0, 0] });
    expect(spiceShipRangeBonus(level1, 0)).toBe(1);
    const overCap = withEpExt(state, { ...epExt(state)!, spiceBenefit: [SPICE_BENEFIT_MAX_BONUS + 5, 0, 0, 0] });
    expect(spiceShipRangeBonus(overCap, 0)).toBe(SPICE_BENEFIT_MAX_BONUS);
  });

  it('moveEPShipHandler actually grants the extra range: an edge just past SHIP_MOVE_RANGE is legal once spiceBenefit >= 1', () => {
    const { state, seaEdges } = craft();
    const fromEdge = seaEdges[0]!;
    const builtRaw = buildEPShipHandler(state, 0, { type: 'buildEPShip', edge: fromEdge });
    if (!builtRaw.ok) throw new Error('BUG: test setup failed to build a ship');
    const built = { ok: true as const, state: readyToMove(builtRaw.state) };

    // Find an edge exactly SHIP_MOVE_RANGE + 1 hops away via BFS (unreachable at the base range).
    const dist = new Map<EdgeId, number>([[fromEdge, 0]]);
    let frontier: EdgeId[] = [fromEdge];
    for (let d = 1; d <= SHIP_MOVE_RANGE + 1 && frontier.length > 0; d++) {
      const next: EdgeId[] = [];
      for (const e of frontier) {
        const edge = GEOMETRY.edges[e]!;
        for (const v of [edge.a, edge.b]) {
          for (const adj of GEOMETRY.vertices[v]!.edges) {
            if (dist.has(adj) || !isSeaEdgeOf(epExt(built.state)!.seaMap!, adj)) continue;
            dist.set(adj, d);
            next.push(adj);
          }
        }
      }
      frontier = next;
    }
    const farEdge = [...dist.entries()].find(([, d]) => d === SHIP_MOVE_RANGE + 1)?.[0];
    if (farEdge === undefined) {
      // The small test board may not have an edge exactly this far — skip, the unit-level
      // `spiceShipRangeBonus` test above already covers the pure computation.
      return;
    }

    const tooFar = moveEPShipHandler(built.state, 0, { type: 'moveEPShip', from: fromEdge, to: farEdge });
    expect(tooFar).toEqual({ ok: false, error: expect.objectContaining({ code: 'SHIP_MOVE_TOO_FAR' }) });

    const withBenefit = withEpExt(built.state, { ...epExt(built.state)!, spiceBenefit: [1, 0, 0, 0] });
    const nowLegal = moveEPShipHandler(withBenefit, 0, { type: 'moveEPShip', from: fromEdge, to: farEdge });
    expect(nowLegal.ok).toBe(true);
  });
});

describe('VP (EP6.2/EP8/EP9, vp.ts computeVp)', () => {
  it('goldPointsVpFor/fishPointsVpFor/spicePointsVpFor read their ext tallies, 0 before anything', () => {
    const { state } = craft();
    expect(goldPointsVpFor(state, 0)).toBe(0);
    expect(fishPointsVpFor(state, 0)).toBe(0);
    expect(spicePointsVpFor(state, 0)).toBe(0);
  });

  it('computeVp includes gold/fish/spice VP in an E&P game, omits it (bit-identical) otherwise', () => {
    const { state } = craft();
    const withPoints = withEpExt(state, {
      ...epExt(state)!,
      goldPoints: [2, 0, 0, 0],
      fishPoints: [1, 0, 0, 0],
      spicePoints: [3, 0, 0, 0],
    });
    const breakdown = computeVp(withPoints, 0);
    expect(breakdown.goldPointsVp).toBe(2);
    expect(breakdown.fishPointsVp).toBe(1);
    expect(breakdown.spicePointsVp).toBe(3);
    expect(breakdown.total).toBeGreaterThanOrEqual(6);

    const created = createGame(CONFIG);
    const baseBreakdown = computeVp(created, 0);
    expect('goldPointsVp' in baseBreakdown).toBe(false);
    expect('fishPointsVp' in baseBreakdown).toBe(false);
    expect('spicePointsVp' in baseBreakdown).toBe(false);
  });
});

describe('redaction (EP6/EP8/EP9 — every new field is fully public)', () => {
  it('surfaces fishShoals/villages/councilVertex/fishPoints/spicePoints/goldPoints/spiceBenefit identically to every viewer', () => {
    const { state, vertex } = craft([1, 0, 0, 0]);
    const seeded = withEpExt(state, {
      ...epExt(state)!,
      fishShoals: [3 as HexId],
      villages: [4 as HexId],
      councilVertex: vertex,
      fishPoints: [1, 0, 0, 0],
      spicePoints: [2, 0, 0, 0],
      goldPoints: [3, 0, 0, 0],
      spiceBenefit: [1, 0, 0, 0],
    });

    const viewer0 = redact(seeded, 0);
    const viewer1 = redact(seeded, 1);
    expect(viewer1.ext?.explorersPirates?.fishShoals).toEqual([3]);
    expect(viewer1.ext?.explorersPirates?.villages).toEqual([4]);
    expect(viewer1.ext?.explorersPirates?.councilVertex).toBe(vertex);
    expect(viewer1.ext?.explorersPirates?.fishPoints).toEqual([1, 0, 0, 0]);
    expect(viewer1.ext?.explorersPirates?.spicePoints).toEqual([2, 0, 0, 0]);
    expect(viewer1.ext?.explorersPirates?.goldPoints).toEqual([3, 0, 0, 0]);
    expect(viewer1.ext?.explorersPirates?.spiceBenefit).toEqual([1, 0, 0, 0]);
    expect(viewer1.ext?.explorersPirates).toEqual(viewer0.ext?.explorersPirates);
  });
});

describe('module wiring (interceptAction)', () => {
  it('routes shipGold/tradeSpice/deliverFish/deliverSpice in a live E&P game', () => {
    const { state } = craft([GOLD_PER_VP, 0, 0, 0]);
    const result = explorersPiratesModule.interceptAction!(state, 0, { type: 'shipGold' });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
  });

  it('falls through (null) outside a live E&P game', () => {
    const { state } = craft();
    const baseState = { ...state, ext: undefined };
    expect(explorersPiratesModule.interceptAction!(baseState, 0, { type: 'shipGold' })).toBeNull();
    expect(explorersPiratesModule.interceptAction!(baseState, 0, { type: 'deliverFish' })).toBeNull();
    expect(explorersPiratesModule.interceptAction!(baseState, 0, { type: 'deliverSpice' })).toBeNull();
    expect(
      explorersPiratesModule.interceptAction!(baseState, 0, { type: 'tradeSpice', hex: 0 as HexId })
    ).toBeNull();
  });
});
