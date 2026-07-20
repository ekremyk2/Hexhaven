// T-1003: The Rivers of Hexhaven (docs/rules/traders-barbarians-rules.md §TB3). Unit + reducer
// integration tests over a real rivers game (createGame): ext seeding, coin awards off a
// river-shore settlement/road build, bridge building (river-edge-only, connectivity, cost, coin
// reward, Longest Road participation), coin trading (the 2:1 -> 4:1 rate cliff), the per-turn
// counter reset, Wealthiest/Poorest VP, and redaction. The heavier seeded-games-to-a-win sweep
// lives in sim/rivers.test.ts.

import { describe, expect, it } from 'vitest';
import type { EdgeId, GameConfig, GameState, Seat, VertexId } from '@hexhaven/shared';
import { GEOMETRY } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { redact } from '../../redact.js';
import { reduce } from '../../reduce.js';
import { longestRoadLength } from '../../rules/longestRoad.js';
import { computeVp } from '../../vp.js';
import {
  RIVERS_BRIDGE_COIN_REWARD,
  RIVERS_RIVER_EDGES,
  RIVERS_SHORE_COIN_REWARD,
  RIVERS_SHORE_VERTICES,
  isRiverEdge,
  isRiverShoreEdge,
  riversCoinTradeRate,
  riversVpFor,
} from './rivers.js';
import { tbExt } from './state.js';

function riversConfig(playerCount: 3 | 4 = 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'rivers' },
    },
  };
}

function newGame(seed = 't1003', playerCount: 3 | 4 = 4): GameState {
  return createGame({ ...riversConfig(playerCount), seed });
}

/** Put `patch` onto one seat's player record. */
function withSeat(state: GameState, seat: Seat, patch: Partial<GameState['players'][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p)) };
}

/** Replace the tradersBarbarians ext block. */
function withExt(state: GameState, patch: Partial<NonNullable<NonNullable<GameState['ext']>['tradersBarbarians']>>): GameState {
  const ext = state.ext!.tradersBarbarians!;
  return { ...state, ext: { ...state.ext, tradersBarbarians: { ...ext, ...patch } } };
}

const MAIN_TURN = { number: 5, player: 0 as Seat, rolled: true, roll: [1, 2] as [number, number], devPlayed: false };
const FULL_HAND = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };

/** A river-shore vertex plus one of its incident edges that is NOT itself a river edge (used to
 *  exercise the generic "incident to a river-shore vertex" road coin award without also tripping
 *  the river-edge-needs-a-bridge rejection). */
function shoreVertexWithLandEdge(state: GameState): { vertex: VertexId; edge: EdgeId } {
  for (const vertex of RIVERS_SHORE_VERTICES) {
    const vert = GEOMETRY.vertices[vertex]!;
    const landEdge = vert.edges.find((e) => !isRiverEdge(state, e));
    if (landEdge !== undefined) return { vertex, edge: landEdge };
  }
  throw new Error('BUG: no shore vertex with a non-river incident edge found');
}

// ---------------------------------------------------------------------------
// createGame seeding (§TB3.1) + RK-13
// ---------------------------------------------------------------------------

describe('T-1003 createGame seeding (§TB3.1)', () => {
  it('seeds ext.tradersBarbarians for a rivers game', () => {
    const state = newGame();
    const ext = tbExt(state);
    expect(ext).toBeDefined();
    expect(ext!.scenario).toBe('rivers');
    expect(ext!.coins).toEqual(state.players.map(() => 0));
    expect(ext!.bridges).toEqual(state.players.map(() => []));
    expect(ext!.coinTradesThisTurn).toBe(0);
  });

  it('a base config seeds no tradersBarbarians ext at all (RK-13)', () => {
    const state = createGame({
      playerCount: 4,
      targetVp: 10,
      board: 'random',
      tokenMethod: 'spiral',
      seed: 'base',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    });
    expect(state.ext?.tradersBarbarians).toBeUndefined();
  });

  it('RIVERS_RIVER_EDGES is a non-empty, connected, deduped edge set', () => {
    expect(RIVERS_RIVER_EDGES.length).toBeGreaterThan(0);
    expect(new Set(RIVERS_RIVER_EDGES).size).toBe(RIVERS_RIVER_EDGES.length);
    for (const edge of RIVERS_RIVER_EDGES) expect(GEOMETRY.edges[edge]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Coin awards (§TB3.1)
// ---------------------------------------------------------------------------

describe('T-1003 coin awards (§TB3.1)', () => {
  it('a settlement on a river-shore vertex earns RIVERS_SHORE_COIN_REWARD coins', () => {
    const shoreVertex = [...RIVERS_SHORE_VERTICES][0]!;
    const vert = GEOMETRY.vertices[shoreVertex]!;
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withSeat(state, 0, { roads: [vert.edges[0]!], resources: { ...FULL_HAND } });

    const r = reduce(state, 0, { type: 'buildSettlement', vertex: shoreVertex });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(tbExt(r.state)!.coins![0]).toBe(RIVERS_SHORE_COIN_REWARD);
      expect(r.events.some((e) => e.type === 'coinsAwarded' && e.seat === 0 && e.source === 'shore')).toBe(true);
    }
  });

  it('a settlement NOT on a river-shore vertex earns no coins', () => {
    const inland = GEOMETRY.vertices.find((v) => !RIVERS_SHORE_VERTICES.has(v.id))!;
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withSeat(state, 0, { roads: [inland.edges[0]!], resources: { ...FULL_HAND } });

    const r = reduce(state, 0, { type: 'buildSettlement', vertex: inland.id });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(tbExt(r.state)!.coins![0]).toBe(0);
      expect(r.events.some((e) => e.type === 'coinsAwarded')).toBe(false);
    }
  });

  it('a road incident to a river-shore vertex earns RIVERS_SHORE_COIN_REWARD coins', () => {
    let state = newGame();
    const { vertex, edge } = shoreVertexWithLandEdge(state);
    expect(isRiverShoreEdge(state, edge)).toBe(true);
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withSeat(state, 0, { settlements: [vertex], resources: { ...FULL_HAND } });

    const r = reduce(state, 0, { type: 'buildRoad', edge });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(tbExt(r.state)!.coins![0]).toBe(RIVERS_SHORE_COIN_REWARD);
    }
  });

  it('buildRoad rejects a river edge outright (must build a bridge there instead, §TB3.2)', () => {
    const riverEdge = RIVERS_RIVER_EDGES[0]!;
    const edgeGeo = GEOMETRY.edges[riverEdge]!;
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withSeat(state, 0, { settlements: [edgeGeo.a], resources: { ...FULL_HAND } });

    const r = reduce(state, 0, { type: 'buildRoad', edge: riverEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_A_RIVER_EDGE');
  });
});

// ---------------------------------------------------------------------------
// buildBridge (§TB3.2)
// ---------------------------------------------------------------------------

describe('T-1003 buildBridge (§TB3.2)', () => {
  it('rejects a non-river edge', () => {
    let state = newGame();
    const inland = GEOMETRY.edges.find((e) => !isRiverEdge(state, e.id))!;
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withSeat(state, 0, { settlements: [inland.a], resources: { ...FULL_HAND } });

    const r = reduce(state, 0, { type: 'buildBridge', edge: inland.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_A_RIVER_EDGE');
  });

  it('rejects when not connected to the seat network (R7.2/§TB3.2)', () => {
    const riverEdge = RIVERS_RIVER_EDGES[0]!;
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withSeat(state, 0, { resources: { ...FULL_HAND } });

    const r = reduce(state, 0, { type: 'buildBridge', edge: riverEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_CONNECTED');
  });

  it('rejects when unaffordable', () => {
    const riverEdge = RIVERS_RIVER_EDGES[0]!;
    const edgeGeo = GEOMETRY.edges[riverEdge]!;
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withSeat(state, 0, {
      settlements: [edgeGeo.a],
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
    });

    const r = reduce(state, 0, { type: 'buildBridge', edge: riverEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CANT_AFFORD');
  });

  it('builds a bridge: pays cost, records the edge (WITHOUT touching the road-piece supply), awards the bridge coin reward', () => {
    const riverEdge = RIVERS_RIVER_EDGES[0]!;
    const edgeGeo = GEOMETRY.edges[riverEdge]!;
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    const roadsBefore = state.players[0]!.piecesLeft.roads;
    state = withSeat(state, 0, { settlements: [edgeGeo.a], resources: { ...FULL_HAND } });

    const r = reduce(state, 0, { type: 'buildBridge', edge: riverEdge });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(tbExt(r.state)!.bridges![0]).toContain(riverEdge);
      // Bridges draw from their OWN supply (the fixed river-edge set caps them), not the 15-road
      // pool — the road-piece count is untouched (also keeps base invariant I2 meaningful).
      expect(r.state.players[0]!.piecesLeft.roads).toBe(roadsBefore);
      expect(r.state.players[0]!.resources.brick).toBe(FULL_HAND.brick - 2);
      expect(r.state.players[0]!.resources.lumber).toBe(FULL_HAND.lumber - 1);
      expect(tbExt(r.state)!.coins![0]).toBe(RIVERS_BRIDGE_COIN_REWARD);
      expect(r.events.some((e) => e.type === 'bridgeBuilt' && e.edge === riverEdge)).toBe(true);
      expect(r.events.some((e) => e.type === 'coinsAwarded' && e.source === 'bridge')).toBe(true);
    }
  });

  it('rejects a second bridge on the same edge (occupied)', () => {
    const riverEdge = RIVERS_RIVER_EDGES[0]!;
    const edgeGeo = GEOMETRY.edges[riverEdge]!;
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withSeat(state, 0, { settlements: [edgeGeo.a], resources: { ...FULL_HAND } });
    state = withExt(state, { bridges: state.players.map((p) => (p.seat === 1 ? [riverEdge] : [])) });

    const r = reduce(state, 0, { type: 'buildBridge', edge: riverEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('OCCUPIED');
  });

  it('a bridge counts toward Longest Road (joins the road network, §TB3.2)', () => {
    const riverEdge = RIVERS_RIVER_EDGES[0]!;
    const edgeGeo = GEOMETRY.edges[riverEdge]!;
    let state = newGame();
    state = withExt(state, { bridges: state.players.map((p) => (p.seat === 0 ? [riverEdge] : [])) });
    expect(longestRoadLength(state, 0)).toBe(1);
    // Extend from the bridge's far endpoint with a plain road — the trail should chain seamlessly
    // (no junction requirement, unlike a road<->ship type switch, S5.2).
    const farVertex = edgeGeo.b;
    const farVert = GEOMETRY.vertices[farVertex]!;
    const nextEdgeId = farVert.edges.find((e) => e !== riverEdge)!;
    state = withSeat(state, 0, { roads: [nextEdgeId] });
    expect(longestRoadLength(state, 0)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// tradeCoins (§TB3.3)
// ---------------------------------------------------------------------------

describe('T-1003 tradeCoins (§TB3.3)', () => {
  function mainState(coins: number[]): GameState {
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withExt(state, { coins });
    return state;
  }

  it('rejects when the seat lacks the coins for the current rate', () => {
    const state = mainState([1, 0, 0, 0]);
    const r = reduce(state, 0, { type: 'tradeCoins', give: 2, receive: 'ore' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_ENOUGH_COINS');
  });

  it('rejects a `give` that does not match the current rate', () => {
    const state = mainState([10, 0, 0, 0]);
    const r = reduce(state, 0, { type: 'tradeCoins', give: 3, receive: 'ore' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BAD_TRADE');
  });

  it('rejects when the bank is empty of the requested resource', () => {
    let state = mainState([10, 0, 0, 0]);
    state = { ...state, bank: { ...state.bank, ore: 0 } };
    const r = reduce(state, 0, { type: 'tradeCoins', give: 2, receive: 'ore' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BANK_EMPTY');
  });

  it('the first two trades are 2:1, the rest are 4:1, this turn-owner rotation', () => {
    let state = mainState([20, 0, 0, 0]);
    expect(riversCoinTradeRate(state)).toBe(2);

    let r = reduce(state, 0, { type: 'tradeCoins', give: 2, receive: 'ore' });
    expect(r.ok).toBe(true);
    state = r.ok ? r.state : state;
    expect(tbExt(state)!.coinTradesThisTurn).toBe(1);
    expect(riversCoinTradeRate(state)).toBe(2);

    r = reduce(state, 0, { type: 'tradeCoins', give: 2, receive: 'ore' });
    expect(r.ok).toBe(true);
    state = r.ok ? r.state : state;
    expect(tbExt(state)!.coinTradesThisTurn).toBe(2);
    expect(riversCoinTradeRate(state)).toBe(4);

    // A stale 2:1 attempt is now rejected — the rate has climbed to 4:1.
    r = reduce(state, 0, { type: 'tradeCoins', give: 2, receive: 'ore' });
    expect(r.ok).toBe(false);

    r = reduce(state, 0, { type: 'tradeCoins', give: 4, receive: 'ore' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players[0]!.resources.ore).toBe(3);
      expect(tbExt(r.state)!.coins![0]).toBe(20 - 2 - 2 - 4);
      expect(r.events.some((e) => e.type === 'coinsTraded' && e.rate === 4)).toBe(true);
    }
  });

  it('endTurn resets the per-turn coin-trade counter', () => {
    let state = mainState([10, 0, 0, 0]);
    state = withExt(state, { coinTradesThisTurn: 2 });
    const r = reduce(state, 0, { type: 'endTurn' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(tbExt(r.state)!.coinTradesThisTurn).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Wealthiest / Poorest Settler VP (§TB3.4)
// ---------------------------------------------------------------------------

describe('T-1003 Wealthiest/Poorest Settler (§TB3.4)', () => {
  it('nobody scores while every seat holds 0 coins', () => {
    const state = newGame();
    for (const p of state.players) {
      expect(riversVpFor(state, p.seat)).toEqual({ wealthiest: 0, poorest: 0 });
    }
  });

  it('the sole leader gets +1 (wealthiest); the sole trailer gets -2 (poorest)', () => {
    let state = newGame();
    state = withExt(state, { coins: [5, 2, 1, 1] });
    expect(computeVp(state, 0).riversWealthiest).toBe(1);
    expect(computeVp(state, 1).riversWealthiest).toBe(0);
    expect(computeVp(state, 2).riversPoorest).toBe(-2);
    expect(computeVp(state, 3).riversPoorest).toBe(-2);
    expect(computeVp(state, 1).riversPoorest).toBe(0);
    // 5 (settlements=0,cities=0,...) + wealthiest 1 = 1 total for seat 0; seat 2/3 get -2.
    expect(computeVp(state, 0).total).toBe(1);
    expect(computeVp(state, 2).total).toBe(-2);
  });

  it('a tie for the max means NOBODY is wealthiest (§TB3.4)', () => {
    let state = newGame();
    state = withExt(state, { coins: [3, 3, 1, 1] });
    expect(computeVp(state, 0).riversWealthiest).toBe(0);
    expect(computeVp(state, 1).riversWealthiest).toBe(0);
    // Poorest still applies to every tied-lowest seat regardless of the wealthiest tie.
    expect(computeVp(state, 2).riversPoorest).toBe(-2);
    expect(computeVp(state, 3).riversPoorest).toBe(-2);
  });

  it('a base (non-rivers) game omits riversWealthiest/riversPoorest entirely', () => {
    const state = createGame({
      playerCount: 4,
      targetVp: 10,
      board: 'random',
      tokenMethod: 'spiral',
      seed: 'base',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    });
    const vp = computeVp(state, 0);
    expect(vp.riversWealthiest).toBeUndefined();
    expect(vp.riversPoorest).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Redaction (§TB8.4)
// ---------------------------------------------------------------------------

describe('T-1003 redaction (§TB8.4)', () => {
  it('surfaces coins/bridges/coinTradesThisTurn — all fully public', () => {
    let state = newGame();
    state = withExt(state, { coins: [3, 1, 0, 0], coinTradesThisTurn: 1 });
    const view = redact(state, 1); // a non-owner viewer
    expect(view.ext?.tradersBarbarians).toBeDefined();
    const tb = view.ext!.tradersBarbarians!;
    expect(tb.scenario).toBe('rivers');
    expect(tb.coins).toEqual([3, 1, 0, 0]);
    expect(tb.bridges).toEqual(tbExt(state)!.bridges);
    expect(tb.coinTradesThisTurn).toBe(1);
  });
});
