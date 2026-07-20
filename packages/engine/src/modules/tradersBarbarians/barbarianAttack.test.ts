// T-1005: Barbarian Attack (docs/rules/traders-barbarians-rules.md §TB5). Unit + reducer
// integration tests over a real barbarianAttack game (createGame): ext seeding, `recruitKnight`,
// `moveBarbarianKnight` (range/extended/inactive/occupied), the `rollDice` advance/combat/pillage/
// dispersal hook (`applyBarbarianAdvance`, tested directly — mirrors fishermen.test.ts's own
// `applyFishermenProduction` direct-call precedent), the once-per-turn move-extension reset,
// captured-barbarian VP, and redaction. The heavier seeded-games-to-a-win sweep lives in
// sim/barbarianAttack.test.ts.
//
// ⚠ VERIFY: every numeric/threshold constant this scenario uses (KNIGHT_COST, KNIGHT_MOVE_RANGE,
// KNIGHT_MOVE_EXTENDED_RANGE, BARBARIAN_GOLD, KNIGHT_LOSS_GOLD, CAPTURED_VP_DIVISOR,
// BARBARIAN_START_HEXES) is a provisional v1 placeholder — see barbarianAttack.ts's header comment
// and the task's Implementation notes.

import { describe, expect, it } from 'vitest';
import type { EdgeId, GameConfig, GameState, Seat } from '@hexhaven/shared';
import { GEOMETRY } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { redact } from '../../redact.js';
import { reduce } from '../../reduce.js';
import { computeVp } from '../../vp.js';
import {
  BARBARIAN_CENTER_HEX,
  BARBARIAN_GOLD,
  BARBARIAN_NEXT_HEX,
  BARBARIAN_START_HEXES,
  KNIGHT_COST,
  KNIGHT_LOSS_GOLD,
  KNIGHT_MOVE_EXTENDED_RANGE,
  KNIGHT_MOVE_RANGE,
  applyBarbarianAdvance,
  applyBarbarianAttackTurnReset,
} from './barbarianAttack.js';
import { tbExt } from './state.js';

function barbarianAttackConfig(playerCount: 3 | 4 = 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'barbarianAttack' },
    },
  };
}

function baseConfig(): GameConfig {
  return {
    playerCount: 4,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    seed: 'base',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
  };
}

function newGame(seed = 't1005', playerCount: 3 | 4 = 4): GameState {
  return createGame({ ...barbarianAttackConfig(playerCount), seed });
}

/** Put `patch` onto one seat's player record. */
function withSeat(state: GameState, seat: Seat, patch: Partial<GameState['players'][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p)) };
}

/** Replace the tradersBarbarians ext block. */
function withExt(
  state: GameState,
  patch: Partial<NonNullable<NonNullable<GameState['ext']>['tradersBarbarians']>>
): GameState {
  const ext = state.ext!.tradersBarbarians!;
  return { ...state, ext: { ...state.ext, tradersBarbarians: { ...ext, ...patch } } };
}

const MAIN_TURN = { number: 5, player: 0 as Seat, rolled: true, roll: [1, 2] as [number, number], devPlayed: false };
const FULL_HAND = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };

/** Any vertex + one of its incident edges, used to give `recruitKnight` a legal own-network target
 *  (a settlement at the vertex, R7.2's `isRoadConnected`) without also building an actual road. */
const NETWORK_VERTEX = GEOMETRY.vertices[10]!;
const NETWORK_EDGE = NETWORK_VERTEX.edges[0]!;

/** An edge one adjacency-hop from `from` (within KNIGHT_MOVE_RANGE), for the free-move tests. */
function oneHopFrom(from: EdgeId): EdgeId {
  const edge = GEOMETRY.edges[from]!;
  return GEOMETRY.vertices[edge.b]!.edges.find((e) => e !== from)!;
}

// ---------------------------------------------------------------------------
// createGame seeding (§TB5.2) + RK-13
// ---------------------------------------------------------------------------

describe('T-1005 createGame seeding (§TB5.2)', () => {
  it('seeds ext.tradersBarbarians for a barbarianAttack game', () => {
    const state = newGame();
    const ext = tbExt(state);
    expect(ext).toBeDefined();
    expect(ext!.scenario).toBe('barbarianAttack');
    expect(ext!.barbarians).toEqual([...BARBARIAN_START_HEXES]);
    expect(ext!.knights).toEqual([]);
    expect(ext!.capturedBarbarians).toEqual(state.players.map(() => 0));
    expect(ext!.gold).toEqual(state.players.map(() => 0));
    expect(ext!.knightMovedThisTurn).toBe(false);
  });

  it('a base config seeds no tradersBarbarians ext at all (RK-13)', () => {
    const state = createGame(baseConfig());
    expect(state.ext?.tradersBarbarians).toBeUndefined();
  });

  it('BARBARIAN_START_HEXES/BARBARIAN_NEXT_HEX/BARBARIAN_CENTER_HEX are valid, non-empty, deterministic', () => {
    expect(BARBARIAN_START_HEXES.length).toBeGreaterThan(0);
    for (const hex of BARBARIAN_START_HEXES) expect(GEOMETRY.hexes[hex]).toBeDefined();
    expect(GEOMETRY.hexes[BARBARIAN_CENTER_HEX]).toBeDefined();
    expect(BARBARIAN_NEXT_HEX.has(BARBARIAN_CENTER_HEX)).toBe(false);
    for (const hex of BARBARIAN_START_HEXES) expect(BARBARIAN_NEXT_HEX.has(hex)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recruitKnight (§TB5.2)
// ---------------------------------------------------------------------------

describe('T-1005 recruitKnight (§TB5.2)', () => {
  function mainState(): GameState {
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    return withSeat(state, 0, {
      settlements: [NETWORK_VERTEX.id],
      resources: { ...FULL_HAND },
    });
  }

  it('rejects an edge not connected to the seat network', () => {
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withSeat(state, 0, { resources: { ...FULL_HAND } });

    const someOtherEdge = GEOMETRY.edges.find((e) => e.id !== NETWORK_EDGE)!.id;
    const r = reduce(state, 0, { type: 'recruitKnight', edge: someOtherEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_CONNECTED');
  });

  it('rejects when unaffordable', () => {
    const state = withSeat(mainState(), 0, {
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
    });
    const r = reduce(state, 0, { type: 'recruitKnight', edge: NETWORK_EDGE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CANT_AFFORD');
  });

  it('recruits a knight: pays cost, records edge active:true, emits tbKnightRecruited', () => {
    const state = mainState();
    const r = reduce(state, 0, { type: 'recruitKnight', edge: NETWORK_EDGE });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(tbExt(r.state)!.knights).toEqual([{ seat: 0, edge: NETWORK_EDGE, active: true }]);
      expect(r.state.players[0]!.resources).toEqual({
        brick: FULL_HAND.brick,
        lumber: FULL_HAND.lumber,
        wool: FULL_HAND.wool - KNIGHT_COST.wool,
        grain: FULL_HAND.grain - KNIGHT_COST.grain,
        ore: FULL_HAND.ore - KNIGHT_COST.ore,
      });
      expect(r.events.some((e) => e.type === 'tbKnightRecruited' && e.seat === 0 && e.edge === NETWORK_EDGE)).toBe(
        true
      );
    }
  });

  it('rejects a second knight on the same edge (occupied)', () => {
    let state = mainState();
    state = withExt(state, { knights: [{ seat: 1 as Seat, edge: NETWORK_EDGE, active: true }] });

    const r = reduce(state, 0, { type: 'recruitKnight', edge: NETWORK_EDGE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('OCCUPIED');
  });
});

// ---------------------------------------------------------------------------
// moveBarbarianKnight (§TB5.2)
// ---------------------------------------------------------------------------

describe('T-1005 moveBarbarianKnight (§TB5.2)', () => {
  function stateWithKnight(seat: Seat, edge: EdgeId, active = true): GameState {
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: { ...MAIN_TURN, player: seat } };
    state = withSeat(state, seat, { resources: { ...FULL_HAND } });
    state = withExt(state, { knights: [{ seat, edge, active }] });
    return state;
  }

  it('rejects from === to', () => {
    const state = stateWithKnight(0, NETWORK_EDGE);
    const r = reduce(state, 0, { type: 'moveBarbarianKnight', from: NETWORK_EDGE, to: NETWORK_EDGE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BAD_LOCATION');
  });

  it('rejects when no knight sits on `from` for the acting seat', () => {
    // The knight sits under seat 1, but seat 0 (the turn owner, acting) tries to move it.
    let state = stateWithKnight(0, NETWORK_EDGE);
    state = withExt(state, { knights: [{ seat: 1 as Seat, edge: NETWORK_EDGE, active: true }] });
    const toEdge = oneHopFrom(NETWORK_EDGE);
    const r = reduce(state, 0, { type: 'moveBarbarianKnight', from: NETWORK_EDGE, to: toEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('KNIGHT_NOT_FOUND');
  });

  it('rejects an inactive knight', () => {
    const state = stateWithKnight(0, NETWORK_EDGE, false);
    const toEdge = oneHopFrom(NETWORK_EDGE);
    const r = reduce(state, 0, { type: 'moveBarbarianKnight', from: NETWORK_EDGE, to: toEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('KNIGHT_INACTIVE');
  });

  it('moves within KNIGHT_MOVE_RANGE for free: deactivates the knight, emits tbKnightMoved', () => {
    const toEdge = oneHopFrom(NETWORK_EDGE);
    const state = stateWithKnight(0, NETWORK_EDGE);
    const r = reduce(state, 0, { type: 'moveBarbarianKnight', from: NETWORK_EDGE, to: toEdge });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(tbExt(r.state)!.knights).toEqual([{ seat: 0, edge: toEdge, active: false }]);
      expect(r.events.some((e) => e.type === 'tbKnightMoved' && e.extended === false)).toBe(true);
      expect(tbExt(r.state)!.knightMovedThisTurn).toBe(false);
    }
  });

  it('rejects a target beyond KNIGHT_MOVE_RANGE without the paid extension, accepts it with `extended: true`', () => {
    // Walk the edge-adjacency graph far enough from NETWORK_EDGE to find a target strictly beyond
    // KNIGHT_MOVE_RANGE but within KNIGHT_MOVE_EXTENDED_RANGE hops, on the small base board.
    let frontier = [NETWORK_EDGE];
    const seen = new Set<EdgeId>(frontier);
    let farEdge: EdgeId | null = null;
    for (let d = 0; d < KNIGHT_MOVE_EXTENDED_RANGE && farEdge === null; d++) {
      const next: EdgeId[] = [];
      for (const e of frontier) {
        const edge = GEOMETRY.edges[e]!;
        for (const v of [edge.a, edge.b]) {
          for (const adj of GEOMETRY.vertices[v]!.edges) {
            if (seen.has(adj)) continue;
            seen.add(adj);
            next.push(adj);
            if (d + 1 > KNIGHT_MOVE_RANGE && d + 1 <= KNIGHT_MOVE_EXTENDED_RANGE) farEdge = adj;
          }
        }
      }
      frontier = next;
    }
    expect(farEdge).not.toBeNull();
    const target = farEdge!;

    const state = stateWithKnight(0, NETWORK_EDGE);
    const r = reduce(state, 0, { type: 'moveBarbarianKnight', from: NETWORK_EDGE, to: target });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('KNIGHT_MOVE_TOO_FAR');

    const r2 = reduce(state, 0, {
      type: 'moveBarbarianKnight',
      from: NETWORK_EDGE,
      to: target,
      extended: true,
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.state.players[0]!.resources.grain).toBe(FULL_HAND.grain - 1);
      expect(tbExt(r2.state)!.knightMovedThisTurn).toBe(true);
      expect(r2.events.some((e) => e.type === 'tbKnightMoved' && e.extended === true)).toBe(true);
    }
  });

  it('rejects a second extended move the same turn-owner rotation', () => {
    let state = stateWithKnight(0, NETWORK_EDGE);
    state = withExt(state, { knightMovedThisTurn: true });
    const toEdge = oneHopFrom(NETWORK_EDGE);
    const r = reduce(state, 0, {
      type: 'moveBarbarianKnight',
      from: NETWORK_EDGE,
      to: toEdge,
      extended: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('KNIGHT_MOVE_EXTEND_UNAVAILABLE');
  });

  it('endTurn resets knightMovedThisTurn', () => {
    let state = stateWithKnight(0, NETWORK_EDGE);
    state = withExt(state, { knightMovedThisTurn: true });
    const r = reduce(state, 0, { type: 'endTurn' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(tbExt(r.state)!.knightMovedThisTurn).toBe(false);
  });

  it('applyBarbarianAttackTurnReset is a no-op outside the scenario / when already reset', () => {
    const base = createGame(baseConfig());
    expect(applyBarbarianAttackTurnReset(base, [])).toBeNull();
    const state = stateWithKnight(0, NETWORK_EDGE);
    expect(applyBarbarianAttackTurnReset(state, [])).toBeNull(); // already false
  });
});

// ---------------------------------------------------------------------------
// applyBarbarianAdvance (§TB5.2) — tested directly (mirrors fishermen.test.ts's
// applyFishermenProduction precedent), since it's a phaseHooks.afterAction hook, not a phase
// handler reachable through a single clean reducer call.
// ---------------------------------------------------------------------------

describe('T-1005 applyBarbarianAdvance (§TB5.2)', () => {
  it("reactivates the acting seat's own inactive knights even with zero barbarians left", () => {
    let state = newGame();
    state = withExt(state, {
      barbarians: [],
      knights: [
        { seat: 0, edge: 0 as EdgeId, active: false },
        { seat: 1, edge: 1 as EdgeId, active: false },
      ],
    });
    const result = applyBarbarianAdvance(state, [], 0 as Seat)!;
    expect(result).not.toBeNull();
    const knights = tbExt(result.state)!.knights!;
    expect(knights.find((k) => k.seat === 0)!.active).toBe(true);
    expect(knights.find((k) => k.seat === 1)!.active).toBe(false);
  });

  it('a barbarian with nothing in its way advances one hex toward the center and survives', () => {
    const startHex = BARBARIAN_START_HEXES[0]!;
    const nextHex = BARBARIAN_NEXT_HEX.get(startHex)!;
    let state = newGame();
    state = withExt(state, { barbarians: [startHex], knights: [] });

    const result = applyBarbarianAdvance(state, [], 0 as Seat)!;
    expect(tbExt(result.state)!.barbarians).toEqual([nextHex]);
    expect(
      result.events.some(
        (e) => e.type === 'tbBarbariansAdvanced' && e.moves.some((m) => m.from === startHex && m.to === nextHex)
      )
    ).toBe(true);
  });

  it('active knights outnumbering the barbarian drive it off: capture + gold reward, knights deactivate', () => {
    const startHex = BARBARIAN_START_HEXES[0]!;
    const nextHex = BARBARIAN_NEXT_HEX.get(startHex)!;
    const hexGeo = GEOMETRY.hexes[nextHex]!;
    const [edgeA, edgeB] = [...hexGeo.edges].sort((a, b) => a - b);

    let state = newGame();
    state = withExt(state, {
      barbarians: [startHex],
      knights: [
        { seat: 0, edge: edgeA!, active: true },
        { seat: 1, edge: edgeB!, active: true },
      ],
    });

    const result = applyBarbarianAdvance(state, [], 0 as Seat)!;
    const ext = tbExt(result.state)!;
    expect(ext.barbarians).toEqual([]);
    expect(ext.knights!.every((k) => k.active === false)).toBe(true);
    expect(ext.capturedBarbarians![0]).toBe(1); // lowest edge id captures
    expect(ext.gold![1]).toBe(BARBARIAN_GOLD); // no barbarian left for the 2nd defender -> gold

    const combatEvent = result.events.find((e) => e.type === 'tbBarbarianCombatResolved');
    expect(combatEvent).toBeDefined();
    if (combatEvent && combatEvent.type === 'tbBarbarianCombatResolved') {
      expect(combatEvent.hex).toBe(nextHex);
      expect(combatEvent.barbariansDefeated).toBe(1);
      expect(combatEvent.rewards).toHaveLength(2);
    }
  });

  it('an unopposed barbarian reaching a city downgrades it to a settlement; a knight there is destroyed for gold', () => {
    const startHex = BARBARIAN_START_HEXES[0]!;
    const nextHex = BARBARIAN_NEXT_HEX.get(startHex)!;
    const hexGeo = GEOMETRY.hexes[nextHex]!;
    const cityVertex = hexGeo.vertices[0]!;
    const guardEdge = hexGeo.edges[0]!;

    let state = newGame();
    state = withSeat(state, 2 as Seat, {
      cities: [cityVertex],
      settlements: [],
      piecesLeft: { roads: 15, settlements: 4, cities: 3 },
    });
    state = withExt(state, {
      barbarians: [startHex],
      // One knight present but NOT outnumbering (1 knight <= 1 barbarian) — fails to stop the
      // pillage and is destroyed for it (§TB5.2).
      knights: [{ seat: 3 as Seat, edge: guardEdge, active: true }],
    });

    const result = applyBarbarianAdvance(state, [], 0 as Seat)!;
    const ext = tbExt(result.state)!;
    expect(ext.barbarians).toEqual([]); // consumed by the pillage
    expect(ext.knights).toEqual([]); // destroyed
    expect(ext.gold![3]).toBe(KNIGHT_LOSS_GOLD);

    const seat2 = result.state.players[2]!;
    expect(seat2.cities).toEqual([]);
    expect(seat2.settlements).toEqual([cityVertex]);
    expect(seat2.piecesLeft).toEqual({ roads: 15, settlements: 3, cities: 4 });

    const pillageEvent = result.events.find((e) => e.type === 'tbBarbarianPillaged');
    expect(pillageEvent).toBeDefined();
    if (pillageEvent && pillageEvent.type === 'tbBarbarianPillaged') {
      expect(pillageEvent.seat).toBe(2);
      expect(pillageEvent.vertex).toBe(cityVertex);
      expect(pillageEvent.downgraded).toBe('city');
      expect(pillageEvent.knightsLost).toEqual([{ seat: 3, edge: guardEdge, gold: KNIGHT_LOSS_GOLD }]);
    }
  });

  it('an unopposed barbarian reaching a settlement removes it outright', () => {
    const startHex = BARBARIAN_START_HEXES[0]!;
    const nextHex = BARBARIAN_NEXT_HEX.get(startHex)!;
    const hexGeo = GEOMETRY.hexes[nextHex]!;
    const settlementVertex = hexGeo.vertices[1]!;

    let state = newGame();
    state = withSeat(state, 2 as Seat, {
      settlements: [settlementVertex],
      piecesLeft: { roads: 15, settlements: 4, cities: 4 },
    });
    state = withExt(state, { barbarians: [startHex], knights: [] });

    const result = applyBarbarianAdvance(state, [], 0 as Seat)!;
    const seat2 = result.state.players[2]!;
    expect(seat2.settlements).toEqual([]);
    expect(seat2.piecesLeft.settlements).toBe(5);

    const pillageEvent = result.events.find((e) => e.type === 'tbBarbarianPillaged');
    expect(pillageEvent).toBeDefined();
    if (pillageEvent && pillageEvent.type === 'tbBarbarianPillaged') {
      expect(pillageEvent.downgraded).toBe('settlement');
    }
  });

  it('a barbarian reaching the center hex with nothing to pillage disperses harmlessly', () => {
    // A hex whose next-hop IS the center — the center hosts no building on a fresh board (true by
    // construction: createGame's setup phase never ran here).
    const feeder = [...BARBARIAN_NEXT_HEX.entries()].find(([, to]) => to === BARBARIAN_CENTER_HEX)![0];
    let state = newGame();
    state = withExt(state, { barbarians: [feeder], knights: [] });

    const result = applyBarbarianAdvance(state, [], 0 as Seat)!;
    expect(tbExt(result.state)!.barbarians).toEqual([]);
    expect(result.events.some((e) => e.type === 'tbBarbarianDispersed' && e.hex === BARBARIAN_CENTER_HEX)).toBe(true);
  });

  it('returns null outside a barbarianAttack game', () => {
    const base = createGame(baseConfig());
    expect(applyBarbarianAdvance(base, [], 0 as Seat)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// VP (§TB5)
// ---------------------------------------------------------------------------

describe('T-1005 captured-barbarian VP (§TB5)', () => {
  it('floor(capturedBarbarians / 2) VP, 0 with none captured', () => {
    let state = newGame();
    expect(computeVp(state, 0).barbarianAttackVp).toBe(0);
    state = withExt(state, { capturedBarbarians: [1, 2, 3, 4] });
    expect(computeVp(state, 0).barbarianAttackVp).toBe(0);
    expect(computeVp(state, 1).barbarianAttackVp).toBe(1);
    expect(computeVp(state, 2).barbarianAttackVp).toBe(1);
    expect(computeVp(state, 3).barbarianAttackVp).toBe(2);
  });

  it('a base (non-barbarianAttack) game omits barbarianAttackVp entirely', () => {
    const state = createGame(baseConfig());
    expect(computeVp(state, 0).barbarianAttackVp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Redaction (§TB8.4)
// ---------------------------------------------------------------------------

describe('T-1005 redaction (§TB8.4)', () => {
  it('surfaces barbarians/knights/capturedBarbarians/gold/knightMovedThisTurn — all fully public', () => {
    let state = newGame();
    state = withExt(state, {
      barbarians: [BARBARIAN_START_HEXES[0]!],
      knights: [{ seat: 1, edge: 3 as EdgeId, active: true }],
      capturedBarbarians: [0, 2, 0, 0],
      gold: [0, 0, 3, 0],
      knightMovedThisTurn: true,
    });
    const view = redact(state, 2 as Seat); // a non-owner viewer
    const tb = view.ext!.tradersBarbarians!;
    expect(tb.scenario).toBe('barbarianAttack');
    expect(tb.barbarians).toEqual([BARBARIAN_START_HEXES[0]!]);
    expect(tb.knights).toEqual([{ seat: 1, edge: 3, active: true }]);
    expect(tb.capturedBarbarians).toEqual([0, 2, 0, 0]);
    expect(tb.gold).toEqual([0, 0, 3, 0]);
    expect(tb.knightMovedThisTurn).toBe(true);
  });
});
