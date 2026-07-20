// T-754: per-island reward VP (chits.ts's `islandRewards` extension). "The Forgotten Tribe" defines
// a per-island VP table consumed by the EXISTING `grantIslandChit`/`islandChitVp` hook — no new event/
// action/phase. These tests prove: (1) a scenario WITHOUT `islandRewards` (e.g. Heading for New
// Shores) keeps the flat `smallIslandVp`-per-island behaviour byte-for-byte; (2) a scenario WITH the
// table (Forgotten Tribe) grants each island's specific reward, and `islandChitVp` sums per-island
// rewards for a seat (not `count × flat`).

import { describe, expect, it } from 'vitest';
import type { EdgeId, GameConfig, GameState, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { computeVp } from '../../vp.js';
import { geometryForState } from '../index.js';
import { scenarioFor } from './board.js';
import { grantIslandChit, islandChitVp, islandOfVertex, islandRewardVp } from './chits.js';
import { hexTerrainOf } from './state.js';

/** A base-box (3/4p, no fiveSix) Heading for New Shores config — mirrors t703.test.ts's helper. */
function headingForNewShoresConfig(playerCount: 3 | 4 = 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
  };
}

/** A Seafarers 5–6 extension config for a given scenario id. */
function fiveSixSeafarersConfig(scenario: string, playerCount: 5 | 6 = 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario }, citiesKnights: false },
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

/** Put `patch` onto one seat's player record. */
function withSeat(state: GameState, seat: Seat, patch: Partial<GameState['players'][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p)) };
}

/** Replace the seafarers ext block. */
function withExt(state: GameState, patch: Partial<NonNullable<NonNullable<GameState['ext']>['seafarers']>>): GameState {
  const ext = state.ext!.seafarers!;
  return { ...state, ext: { ...state.ext, seafarers: { ...ext, ...patch } } };
}

function setShip(state: GameState, seat: Seat, edges: EdgeId[]): GameState {
  const ext = state.ext!.seafarers!;
  return withExt(state, { ships: ext.ships.map((list, s) => (s === seat ? edges : list)) });
}

function isSeaEdge(state: GameState, edge: EdgeId): boolean {
  return geometryForState(state).edges[edge]!.hexes.some((h) => hexTerrainOf(state, h) === 'sea');
}

/** The first land vertex found on small island `island`, plus one incident sea edge (ship anchor). */
function findVertexOnIsland(state: GameState, island: number): { vertex: VertexId; seaEdge: EdgeId } {
  const geo = geometryForState(state);
  for (const v of geo.vertices) {
    if (islandOfVertex(state, v.id) !== island) continue;
    const seaEdge = v.edges.find((e) => isSeaEdge(state, e));
    if (seaEdge !== undefined) return { vertex: v.id, seaEdge };
  }
  throw new Error(`no vertex on island ${island} with an incident sea edge`);
}

/** Any small-island vertex plus one incident sea edge (island id not fixed). */
function findAnyIslandVertex(state: GameState): { vertex: VertexId; seaEdge: EdgeId; island: number } {
  const geo = geometryForState(state);
  for (const v of geo.vertices) {
    const island = islandOfVertex(state, v.id);
    if (island === null) continue;
    const seaEdge = v.edges.find((e) => isSeaEdge(state, e));
    if (seaEdge !== undefined) return { vertex: v.id, seaEdge, island };
  }
  throw new Error('no small-island vertex with an incident sea edge');
}

const MAIN_TURN = { number: 5, player: 0 as Seat, rolled: true, roll: [3, 4] as [number, number], devPlayed: false };

describe('T-754 per-island reward VP — gated by scenario.islandRewards', () => {
  it('a scenario without islandRewards resolves islandRewardVp to the flat smallIslandVp', () => {
    const g = createGame({ ...headingForNewShoresConfig(), seed: 'ft-helper' });
    const scenario = scenarioFor(g.config)!;
    expect(scenario.islandRewards).toBeUndefined();
    expect(islandRewardVp(scenario, 0)).toBe(scenario.smallIslandVp);
    expect(islandRewardVp(scenario, 4)).toBe(scenario.smallIslandVp);
  });

  it('Heading for New Shores (no islandRewards) still grants the flat smallIslandVp, unchanged by T-754', () => {
    const g = createGame({ ...headingForNewShoresConfig(), seed: 'ft-baseline' });
    const { vertex, seaEdge, island } = findAnyIslandVertex(g);

    let s = setShip(g, 0, [seaEdge]);
    s = withSeat(s, 0, { resources: { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 0 } });
    s = { ...s, phase: { kind: 'main' }, turn: { ...MAIN_TURN } };

    const r = reduce(s, 0, { type: 'buildSettlement', vertex });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const evt = r.events.find((e) => e.type === 'islandSettled');
    expect(evt).toMatchObject({ type: 'islandSettled', seat: 0, island, vp: 2 }); // flat smallIslandVp
    expect(computeVp(r.state, 0).islandChits).toBe(2);
    expect(islandChitVp(r.state, 0)).toBe(2);
  });

  it("Forgotten Tribe grants each island's specific reward VP (1/1/2/2/3), not the flat smallIslandVp", () => {
    const g = createGame({ ...fiveSixSeafarersConfig('forgottenTribe'), seed: 'ft-rewards' });
    const table: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 3 };
    for (const [islandStr, expectedVp] of Object.entries(table)) {
      const island = Number(islandStr);
      const { vertex, seaEdge } = findVertexOnIsland(g, island);
      let s = setShip(g, 0, [seaEdge]);
      s = withSeat(s, 0, { resources: { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 0 } });
      s = { ...s, phase: { kind: 'main' }, turn: { ...MAIN_TURN } };

      const r = reduce(s, 0, { type: 'buildSettlement', vertex });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const evt = r.events.find((e) => e.type === 'islandSettled');
      expect(evt).toMatchObject({ type: 'islandSettled', seat: 0, island, vp: expectedVp });
    }
  });

  it('islandChitVp SUMS per-island rewards for a seat under Forgotten Tribe (not count × flat)', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('forgottenTribe'), seed: 'ft-sum' });
    // Seat 0 has already earned islands 2 (2 VP) and 4 (3 VP) — sum should be 5, not 2 × smallIslandVp.
    const s = withExt(g, { islandChits: g.ext!.seafarers!.islandChits.map((l, i) => (i === 0 ? [2, 4] : l)) });
    expect(islandChitVp(s, 0)).toBe(5);
    expect(computeVp(s, 0).islandChits).toBe(5);
  });

  it('grantIslandChit is idempotent per island under Forgotten Tribe too (no double-grant)', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('forgottenTribe'), seed: 'ft-idempotent' });
    const { vertex } = findVertexOnIsland(g, 3);
    const s = withExt(g, { islandChits: g.ext!.seafarers!.islandChits.map((l, i) => (i === 0 ? [3] : l)) });
    expect(grantIslandChit(s, 0, vertex)).toBeNull();
    expect(islandChitVp(s, 0)).toBe(2); // island 3's reward (2 VP), granted once
  });
});
