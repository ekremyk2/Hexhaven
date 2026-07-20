// T-410 requirement 3 tests: hand-crafted orderings `evaluate` must respect.
// B-27 regression: evaluate() used to walk the hardcoded base 19-hex/54-vertex `GEOMETRY` in three
// spots (production/expansion/robber), so Seafarers/5-6p cells beyond that range contributed nothing.

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { EdgeId, GameConfig, GameState, HexId, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { geometryForState } from '../modules/index.js';
import { hexTerrainOf } from '../modules/seafarers/index.js';
import { evaluate } from './evaluate.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  seed: 'evaluate-test',
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

/** A blank all-desert board (no production anywhere) so a test can turn on exactly the hex(es) it
 * cares about — same pattern as docs/12's "craft" example. */
function blankBoard(g: GameState): GameState['board']['hexes'] {
  return g.board.hexes.map(() => ({ terrain: 'desert' as TerrainType, token: null as number | null }));
}

function base(): GameState {
  const g = createGame(CONFIG);
  return { ...g, board: { ...g.board, hexes: blankBoard(g) }, phase: { kind: 'main' } };
}

describe('evaluate — hand-crafted orderings (task requirement 3)', () => {
  it('a clearly-winning position scores above a clearly-losing one', () => {
    const g = base();
    const players = g.players.map((p) => {
      if (p.seat === 0) {
        return {
          ...p,
          settlements: [10, 20, 30, 40] as VertexId[],
          cities: [0, 1] as VertexId[],
          playedKnights: 3,
        };
      }
      if (p.seat === 1) {
        return { ...p, settlements: [5] as VertexId[] };
      }
      return p;
    });
    const state: GameState = {
      ...g,
      players,
      awards: { longestRoad: { holder: 0, length: 6 }, largestArmy: { holder: 0, count: 3 } },
    };
    expect(evaluate(state, 0)).toBeGreaterThan(evaluate(state, 1));
  });

  it('a high-pip city beats a low-pip settlement (all else equal)', () => {
    const g = base();
    // Hex 0's vertices carry token 6 (5 pips); hex 1's carry token 3 (2 pips) — GEOMETRY is fixed
    // regardless of the random terrain assignment, so hex ids/vertex adjacency are stable.
    const hexesHighPip = g.board.hexes.map((h, i) =>
      i === 0 ? { terrain: 'hills' as TerrainType, token: 6 } : h
    );
    const hexesLowPip = g.board.hexes.map((h, i) =>
      i === 1 ? { terrain: 'hills' as TerrainType, token: 3 } : h
    );
    const highPipVertex = GEOMETRY.hexes[0 as HexId]!.vertices[0]!;
    const lowPipVertex = GEOMETRY.hexes[1 as HexId]!.vertices[0]!;

    const cityState: GameState = {
      ...g,
      board: { ...g.board, hexes: hexesHighPip },
      players: g.players.map((p) => (p.seat === 0 ? { ...p, cities: [highPipVertex] } : p)),
    };
    const settlementState: GameState = {
      ...g,
      board: { ...g.board, hexes: hexesLowPip },
      players: g.players.map((p) => (p.seat === 0 ? { ...p, settlements: [lowPipVertex] } : p)),
    };

    expect(evaluate(cityState, 0)).toBeGreaterThan(evaluate(settlementState, 0));
  });

  it('owning Longest Road scores higher than being one road short of it', () => {
    const g = base();
    const fiveRoads = [0, 1, 2, 3, 4].map((n) => n as EdgeId);
    const fourRoads = [0, 1, 2, 3].map((n) => n as EdgeId);
    const held: GameState = {
      ...g,
      players: g.players.map((p) => (p.seat === 0 ? { ...p, roads: fiveRoads } : p)),
      awards: { ...g.awards, longestRoad: { holder: 0, length: 5 } },
    };
    const oneShort: GameState = {
      ...g,
      players: g.players.map((p) => (p.seat === 0 ? { ...p, roads: fourRoads } : p)),
      awards: { ...g.awards, longestRoad: { holder: 1, length: 5 } },
    };
    expect(evaluate(held, 0)).toBeGreaterThan(evaluate(oneShort, 0));
  });

  it('owning Largest Army scores higher than being one knight short of it', () => {
    const g = base();
    const held: GameState = {
      ...g,
      players: g.players.map((p) => (p.seat === 0 ? { ...p, playedKnights: 3 } : p)),
      awards: { ...g.awards, largestArmy: { holder: 0, count: 3 } },
    };
    const oneShort: GameState = {
      ...g,
      players: g.players.map((p) => (p.seat === 0 ? { ...p, playedKnights: 2 } : p.seat === 1 ? { ...p, playedKnights: 3 } : p)),
      awards: { ...g.awards, largestArmy: { holder: 1, count: 3 } },
    };
    expect(evaluate(held, 0)).toBeGreaterThan(evaluate(oneShort, 0));
  });

  it('penalizes the robber sitting on one of the seat\'s own production hexes', () => {
    const g = base();
    const hexes = g.board.hexes.map((h, i) => (i === 2 ? { terrain: 'forest' as TerrainType, token: 8 } : h));
    const vertex = GEOMETRY.hexes[2 as HexId]!.vertices[0]!;
    const withSettlement = (robber: HexId): GameState => ({
      ...g,
      board: { ...g.board, hexes, robber },
      players: g.players.map((p) => (p.seat === 0 ? { ...p, settlements: [vertex] } : p)),
    });
    const robbed = withSettlement(2 as HexId);
    const notRobbed = withSettlement(g.board.robber === (2 as HexId) ? (3 as HexId) : g.board.robber);
    expect(evaluate(robbed, 0)).toBeLessThan(evaluate(notRobbed, 0));
  });

  it('rewards resource diversity over a single-type equivalent pip total', () => {
    const g = base();
    // Two hexes token 4 (3 pips each): one setup gives seat 0 two SEPARATE resource types, the
    // other gives the same total pips but concentrated in one type only.
    const hexesDiverse = g.board.hexes.map((h, i) => {
      if (i === 0) return { terrain: 'hills' as TerrainType, token: 4 };
      if (i === 1) return { terrain: 'pasture' as TerrainType, token: 4 };
      return h;
    });
    const hexesConcentrated = g.board.hexes.map((h, i) => {
      if (i === 0) return { terrain: 'hills' as TerrainType, token: 4 };
      if (i === 1) return { terrain: 'hills' as TerrainType, token: 4 };
      return h;
    });
    const v0 = GEOMETRY.hexes[0 as HexId]!.vertices[0]!;
    const v1 = GEOMETRY.hexes[1 as HexId]!.vertices[0]!;

    const diverse: GameState = {
      ...g,
      board: { ...g.board, hexes: hexesDiverse },
      players: g.players.map((p) => (p.seat === 0 ? { ...p, settlements: [v0, v1] } : p)),
    };
    const concentrated: GameState = {
      ...g,
      board: { ...g.board, hexes: hexesConcentrated },
      players: g.players.map((p) => (p.seat === 0 ? { ...p, settlements: [v0, v1] } : p)),
    };
    expect(evaluate(diverse, 0)).toBeGreaterThan(evaluate(concentrated, 0));
  });
});

// ---------------------------------------------------------------------------
// B-27: geometry must resolve to the ACTIVE board, not the hardcoded base GEOMETRY.
// ---------------------------------------------------------------------------

const SEAFARERS_CONFIG: Omit<GameConfig, 'seed'> = {
  playerCount: 4,
  targetVp: 14,
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
};

function seafarersGame(seed = 'b27-evaluate'): GameState {
  return createGame({ ...SEAFARERS_CONFIG, seed });
}

/** A hex beyond the base 19-hex range whose real (scenario) terrain matches `want`, carrying a
 * dice token — searched on the actual generated board rather than assumed at a fixed id. */
function findHexBeyondBase(state: GameState, want: 'land' | 'gold'): { id: HexId; vertex: VertexId } {
  const geometry = geometryForState(state);
  for (const hex of geometry.hexes) {
    if (hex.id < 19) continue;
    const tile = state.board.hexes[hex.id];
    if (!tile || tile.token == null) continue;
    const terrain = hexTerrainOf(state, hex.id);
    const isLand = terrain !== undefined && terrain !== 'sea' && terrain !== 'gold';
    if (want === 'land' && isLand) return { id: hex.id, vertex: hex.vertices[0]! };
    if (want === 'gold' && terrain === 'gold') return { id: hex.id, vertex: hex.vertices[0]! };
  }
  throw new Error(`no ${want} hex with a token found beyond the base 19-hex range`);
}

describe('evaluate — Seafarers geometry beyond the base 19-hex/54-vertex range (B-27)', () => {
  // NOTE: these tests hold VP FIXED between the two compared states (the same settlement exists in
  // BOTH — only the hex's token differs) specifically so the VP term (which dominates and doesn't
  // depend on geometry at all) can't accidentally mask whether the production term saw the hex.
  // Before the fix, evaluate() walked the base 19-hex/54-vertex GEOMETRY, so a hex id ≥ 19 was never
  // visited by productionPips and these two states would score identically; a naive "add a
  // settlement and expect a higher score" test would pass either way because of the VP term alone.

  it('counts production from a settlement on a hex id beyond the base 19-hex range', () => {
    const g = seafarersGame();
    const { id, vertex } = findHexBeyondBase(g, 'land');
    expect(id).toBeGreaterThanOrEqual(19); // sanity: this hex is outside the base 19-hex range

    const withPlayer = (state: GameState): GameState => ({
      ...state,
      players: state.players.map((p) => (p.seat === 0 ? { ...p, settlements: [vertex] } : p)),
    });
    const producing = withPlayer(g);
    const noToken = withPlayer({
      ...g,
      board: { ...g.board, hexes: g.board.hexes.map((h, i) => (i === id ? { ...h, token: null } : h)) },
    });

    expect(evaluate(producing, 0)).toBeGreaterThan(evaluate(noToken, 0));
  });

  it('counts a gold-hex settlement as productive (S9) even beyond the base range', () => {
    const g = seafarersGame();
    const { id, vertex } = findHexBeyondBase(g, 'gold');

    const withPlayer = (state: GameState): GameState => ({
      ...state,
      players: state.players.map((p) => (p.seat === 0 ? { ...p, settlements: [vertex] } : p)),
    });
    const producing = withPlayer(g);
    const noToken = withPlayer({
      ...g,
      board: { ...g.board, hexes: g.board.hexes.map((h, i) => (i === id ? { ...h, token: null } : h)) },
    });

    expect(evaluate(producing, 0)).toBeGreaterThan(evaluate(noToken, 0));
  });
});
