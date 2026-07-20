// T-1002: The Fishermen of Hexhaven (docs/rules/traders-barbarians-rules.md §TB2). Unit + reducer
// integration tests over a real fishermen game (createGame): ext seeding, fish production off the
// Lake + a fishing ground, the five `exchangeFish` benefits, the Old Boot draw/pass + win-target
// bump, and redaction. The heavier seeded-games-to-a-win sweep lives in sim/fishermen.test.ts.

import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { redact } from '../../redact.js';
import { reduce } from '../../reduce.js';
import { checkWin, computeVp } from '../../vp.js';
import { geometryForState } from '../index.js';
import {
  FISHERMEN_FISHING_GROUNDS,
  FISHERMEN_FISH_STACK,
  FISH_EXCHANGE_COST,
  applyFishermenProduction,
} from './fishermen.js';
import { fishOf, oldBootHolder, tbExt } from './state.js';

function fishermenConfig(playerCount: 3 | 4 = 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'fishermen' },
    },
  };
}

function newGame(seed = 't1002', playerCount: 3 | 4 = 4): GameState {
  return createGame({ ...fishermenConfig(playerCount), seed });
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

/** R2: a fresh game always starts the robber on the desert — which IS the Lake hex (§TB2.1) — so
 *  any test exercising Lake production must first move it off (§TB2.6 is its own dedicated test). */
function moveRobberOffLake(state: GameState): GameState {
  const lake = tbExt(state)!.lakeHex!;
  const elsewhere = state.board.hexes.findIndex((_, i) => i !== lake);
  return { ...state, board: { ...state.board, robber: elsewhere as GameState['board']['robber'] } };
}

const MAIN_TURN = { number: 5, player: 0 as Seat, rolled: true, roll: [1, 2] as [number, number], devPlayed: false };

// ---------------------------------------------------------------------------
// createGame seeding (§TB2.1) + RK-13
// ---------------------------------------------------------------------------

describe('T-1002 createGame seeding (§TB2.1)', () => {
  it('seeds ext.tradersBarbarians for a fishermen game', () => {
    const state = newGame();
    const ext = tbExt(state);
    expect(ext).toBeDefined();
    expect(ext!.scenario).toBe('fishermen');
    expect(ext!.fish).toEqual(state.players.map(() => 0));
    expect(ext!.oldBoot).toBeNull();
    // The Lake is the board's own desert hex (R2: exactly one, never numbered).
    expect(state.board.hexes[ext!.lakeHex!]!.terrain).toBe('desert');
    expect(state.board.hexes[ext!.lakeHex!]!.token).toBeNull();
    // Fish stack is a shuffled copy of the fixed multiset (same length/composition, order differs).
    expect(ext!.fishStack).toHaveLength(FISHERMEN_FISH_STACK.length);
    expect([...ext!.fishStack!].sort((a, b) => a - b)).toEqual([...FISHERMEN_FISH_STACK].sort((a, b) => a - b));
    // Fishing grounds mirror the fixed, precomputed constant.
    expect(ext!.fishingGrounds).toEqual(FISHERMEN_FISHING_GROUNDS.map((g) => ({ token: g.token, vertices: [...g.vertices] })));
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
});

// ---------------------------------------------------------------------------
// Fish production (§TB2.2/§TB2.6)
// ---------------------------------------------------------------------------

describe('T-1002 fish production (§TB2.2)', () => {
  it('the Lake produces on 2/3/11/12 for an adjacent settlement, popping 1 token off the stack', () => {
    let state = newGame();
    const ext = tbExt(state)!;
    const lakeVertex = geometryForState(state).hexes[ext.lakeHex!]!.vertices[0]!;
    state = withSeat(state, 0, { settlements: [lakeVertex] });
    state = withExt(state, { fishStack: [2, 1, 3] });
    state = moveRobberOffLake(state);
    state = { ...state, turn: { ...MAIN_TURN, roll: [1, 1] } }; // total 2

    const result = applyFishermenProduction(state, []);
    expect(result).not.toBeNull();
    const { state: next, events } = result!;
    expect(fishOf(next, 0)).toBe(2); // drew the top token (value 2)
    expect(tbExt(next)!.fishStack).toEqual([1, 3]);
    expect(events.some((e) => e.type === 'fishProduced')).toBe(true);
  });

  it('a city adjacent to the Lake draws 2 tokens', () => {
    let state = newGame();
    const ext = tbExt(state)!;
    const lakeVertex = geometryForState(state).hexes[ext.lakeHex!]!.vertices[0]!;
    state = withSeat(state, 0, { cities: [lakeVertex] });
    state = withExt(state, { fishStack: [1, 2, 3] });
    state = moveRobberOffLake(state);
    state = { ...state, turn: { ...MAIN_TURN, roll: [6, 6] } }; // total 12

    const { state: next } = applyFishermenProduction(state, [])!;
    expect(fishOf(next, 0)).toBe(3); // 1 + 2
    expect(tbExt(next)!.fishStack).toEqual([3]);
  });

  it('the robber sitting on the Lake blocks its production (§TB2.6)', () => {
    let state = newGame();
    const ext = tbExt(state)!;
    const lakeVertex = geometryForState(state).hexes[ext.lakeHex!]!.vertices[0]!;
    state = withSeat(state, 0, { settlements: [lakeVertex] });
    state = { ...state, board: { ...state.board, robber: ext.lakeHex! } };
    state = { ...state, turn: { ...MAIN_TURN, roll: [1, 1] } };

    expect(applyFishermenProduction(state, [])).toBeNull();
  });

  it('a fishing ground produces on its own token, independent of the robber', () => {
    let state = newGame();
    const ground = tbExt(state)!.fishingGrounds![0]!;
    state = withSeat(state, 1, { settlements: [ground.vertices[0] as VertexId] });
    state = withExt(state, { fishStack: [1] });
    state = { ...state, turn: { ...MAIN_TURN, roll: [1, ground.token - 1] } };

    const { state: next } = applyFishermenProduction(state, [])!;
    expect(fishOf(next, 1)).toBe(1);
  });

  it('a drawn Old Boot (0) never adds fish and is awarded to the sole VP leader', () => {
    let state = newGame();
    const ext = tbExt(state)!;
    const lakeVertex = geometryForState(state).hexes[ext.lakeHex!]!.vertices[0]!;
    // Seat 0 has an extra settlement (2 total) so it is the SOLE VP leader (2 VP vs everyone's 0).
    state = withSeat(state, 0, { settlements: [lakeVertex, geometryForState(state).vertices.find((v) => v.id !== lakeVertex)!.id] });
    state = withExt(state, { fishStack: [0, 1] }); // draws exactly 1 token: the boot
    state = moveRobberOffLake(state);
    state = { ...state, turn: { ...MAIN_TURN, roll: [1, 1] } };

    const { state: next, events } = applyFishermenProduction(state, [])!;
    expect(fishOf(next, 0)).toBe(0); // the boot itself never grants fish
    expect(oldBootHolder(next)).toBe(0);
    expect(events.some((e) => e.type === 'oldBootAwarded' && e.seat === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// exchangeFish (§TB2.4)
// ---------------------------------------------------------------------------

describe('T-1002 exchangeFish (§TB2.4)', () => {
  function mainState(fish: number[]): GameState {
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withExt(state, { fish });
    return state;
  }

  it('rejects when the seat lacks the fish', () => {
    const state = mainState([0, 0, 0, 0]);
    const r = reduce(state, 0, { type: 'exchangeFish', benefit: 'removeRobber' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_ENOUGH_FISH');
  });

  it("removeRobber (2 fish) moves the robber to the Lake and debits the cost", () => {
    const state = mainState([2, 0, 0, 0]);
    const lake = tbExt(state)!.lakeHex!;
    const r = reduce(state, 0, { type: 'exchangeFish', benefit: 'removeRobber' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.board.robber).toBe(lake);
      expect(fishOf(r.state, 0)).toBe(0);
      expect(r.events.some((e) => e.type === 'fishExchanged' && e.cost === FISH_EXCHANGE_COST.removeRobber)).toBe(true);
    }
  });

  it('bankResource (4 fish) takes 1 resource of choice from the bank', () => {
    const state = mainState([4, 0, 0, 0]);
    const before = state.bank.ore;
    const r = reduce(state, 0, { type: 'exchangeFish', benefit: 'bankResource', resource: 'ore' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.bank.ore).toBe(before - 1);
      expect(r.state.players[0]!.resources.ore).toBe(1);
      expect(fishOf(r.state, 0)).toBe(0);
    }
  });

  it('devCard (7 fish) draws a card without paying resources', () => {
    const state = mainState([7, 0, 0, 0]);
    const card = state.devDeck[0]!;
    const r = reduce(state, 0, { type: 'exchangeFish', benefit: 'devCard' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players[0]!.devCards.map((c) => c.type)).toContain(card);
      expect(r.state.devDeck.length).toBe(state.devDeck.length - 1);
      expect(fishOf(r.state, 0)).toBe(0);
    }
  });

  it('freeRoad (5 fish) places a road at no resource cost', () => {
    let state = mainState([5, 0, 0, 0]);
    const setupVertex = geometryForState(state).vertices[0]!.id;
    const edge = geometryForState(state).vertices[0]!.edges[0]!;
    state = withSeat(state, 0, { settlements: [setupVertex] });
    const r = reduce(state, 0, { type: 'exchangeFish', benefit: 'freeRoad', edge });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players[0]!.roads).toContain(edge);
      expect(fishOf(r.state, 0)).toBe(0);
    }
  });

  it("steal (3 fish) steals from a seat adjacent to the robber's hex", () => {
    let state = mainState([3, 0, 0, 0]);
    const robberHex = state.board.robber;
    const victimVertex = geometryForState(state).hexes[robberHex]!.vertices[0]!;
    state = withSeat(state, 1, { settlements: [victimVertex], resources: { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 } });
    const r = reduce(state, 0, { type: 'exchangeFish', benefit: 'steal', from: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players[0]!.resources.brick).toBe(1);
      expect(r.state.players[1]!.resources.brick).toBe(0);
      expect(fishOf(r.state, 0)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Old Boot pass + win target (§TB2.5)
// ---------------------------------------------------------------------------

describe('T-1002 Old Boot (§TB2.5)', () => {
  it('passOldBoot rejects a non-holder', () => {
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    const r = reduce(state, 0, { type: 'passOldBoot', to: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('OLD_BOOT_NOT_HELD');
  });

  it('passOldBoot rejects passing to a strictly weaker opponent', () => {
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withExt(state, { oldBoot: 0 });
    // Seat 0 has 1 settlement (1 VP); seat 1 has none (0 VP) — seat 1 is strictly weaker.
    const v = geometryForState(state).vertices[0]!.id;
    state = withSeat(state, 0, { settlements: [v] });
    const r = reduce(state, 0, { type: 'passOldBoot', to: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BAD_OLD_BOOT_TARGET');
  });

  it('passOldBoot succeeds when passing to a tied-or-ahead opponent', () => {
    let state = newGame();
    state = { ...state, phase: { kind: 'main' }, turn: MAIN_TURN };
    state = withExt(state, { oldBoot: 0 });
    const r = reduce(state, 0, { type: 'passOldBoot', to: 1 }); // both at 0 VP — tied
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(oldBootHolder(r.state)).toBe(1);
      expect(r.events.some((e) => e.type === 'oldBootPassed' && e.from === 0 && e.to === 1)).toBe(true);
    }
  });

  it('checkWin requires target+1 for the Old Boot holder', () => {
    let state = newGame();
    // 5 settlements + 2 cities + longestRoad(2) = 5 + 4 + 2 = 11... simpler: craft exactly 10 VP via
    // 10 settlements is impossible (max 5 in base supply); use settlements+cities combo instead.
    // 4 cities (8) + 2 settlements (2) = 10 VP exactly, well within the 4/4 supply.
    const vs = geometryForState(state).vertices.filter((_, i) => i % 9 === 0).map((v) => v.id).slice(0, 6);
    state = withSeat(state, 0, { cities: vs.slice(0, 4), settlements: vs.slice(4, 6) });
    expect(computeVp(state, 0).total).toBe(10);

    const notWonYet = withExt(state, { oldBoot: 0 });
    expect(checkWin(notWonYet, 0).phase.kind).not.toBe('ended');

    const noBoot = withExt(state, { oldBoot: null });
    expect(checkWin(noBoot, 0).phase.kind).toBe('ended');
  });
});

// ---------------------------------------------------------------------------
// Redaction (§TB8.4)
// ---------------------------------------------------------------------------

describe('T-1002 redaction (§TB8.4)', () => {
  it('omits fishStack entirely; surfaces oldBoot/lakeHex/fishingGrounds/scenario/fish', () => {
    const state = newGame();
    const view = redact(state, 0);
    expect(view.ext?.tradersBarbarians).toBeDefined();
    const tb = view.ext!.tradersBarbarians!;
    expect(tb.scenario).toBe('fishermen');
    expect(tb.oldBoot).toBeNull();
    expect(tb.lakeHex).toBe(tbExt(state)!.lakeHex);
    expect(tb.fishingGrounds).toEqual(tbExt(state)!.fishingGrounds);
    expect(tb.fish).toEqual(tbExt(state)!.fish);
    expect((tb as Record<string, unknown>).fishStack).toBeUndefined();
  });

  it('a base game has no tradersBarbarians view block', () => {
    const state = createGame({
      playerCount: 4,
      targetVp: 10,
      board: 'random',
      tokenMethod: 'spiral',
      seed: 'base',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    });
    const view = redact(state, 0);
    expect(view.ext?.tradersBarbarians).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T-1050 (Phase 10B): fishermen at 5–6 — fishing grounds adapt to GEOMETRY_EXT56
// ---------------------------------------------------------------------------

describe('T-1050 fishermen 5–6 (base 30-hex EXT56 board)', () => {
  function fishermen56Config(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
    return {
      playerCount,
      targetVp: 10,
      board: 'random',
      tokenMethod: 'spiral',
      expansions: {
        fiveSix: true,
        seafarers: false,
        citiesKnights: false,
        tradersBarbarians: { scenario: 'fishermen' },
      },
    };
  }

  it.each([5, 6] as const)('seeds ext.tradersBarbarians for a %i-player fishermen game on the 30-hex board', (playerCount) => {
    const state = createGame({ ...fishermen56Config(playerCount), seed: `t1050-${playerCount}` });
    const ext = tbExt(state);
    expect(ext).toBeDefined();
    expect(ext!.scenario).toBe('fishermen');
    expect(ext!.fish).toEqual(state.players.map(() => 0));
    // The board has 30 hexes (EXT56) — the Lake is still the (first) desert hex.
    expect(state.board.hexes.length).toBe(30);
    expect(state.board.hexes[ext!.lakeHex!]!.terrain).toBe('desert');
    expect(state.board.hexes[ext!.lakeHex!]!.token).toBeNull();
    // 6 fishing grounds, same as the 3–4p board — but NOT the same vertex sets (a different, longer
    // coastline), proving the grounds were computed against the resolved 30-hex geometry, not the
    // hardcoded base board's fixed 6.
    expect(ext!.fishingGrounds).toHaveLength(6);
    const baseVertexSets = FISHERMEN_FISHING_GROUNDS.map((g) => [...g.vertices].sort().join(','));
    const ext56VertexSets = ext!.fishingGrounds!.map((g) => [...g.vertices].sort().join(','));
    expect(ext56VertexSets).not.toEqual(baseVertexSets);
    // Every fishing-ground vertex is a real vertex on the 30-hex geometry (not a base-board-only id).
    const geometry = geometryForState(state);
    for (const ground of ext!.fishingGrounds!) {
      for (const v of ground.vertices) {
        expect(geometry.vertices[v]).toBeDefined();
      }
    }
  });

  it('fish production off a fishing ground works at 5–6 players (geometry-driven, unaffected by board size)', () => {
    const state = createGame({ ...fishermen56Config(6), seed: 't1050-prod' });
    const ground = tbExt(state)!.fishingGrounds![0]!;
    let s = withSeat(state, 4, { settlements: [ground.vertices[0] as VertexId] });
    s = withExt(s, { fishStack: [2] });
    s = { ...s, turn: { ...MAIN_TURN, roll: [1, ground.token - 1] as [number, number] } };

    const result = applyFishermenProduction(s, []);
    expect(result).not.toBeNull();
    expect(fishOf(result!.state, 4)).toBe(2);
  });
});
