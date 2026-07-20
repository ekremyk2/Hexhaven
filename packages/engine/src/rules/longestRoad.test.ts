// T-110: the 9 shape vectors from the task table, the R11.2/R11.3 award lifecycle, the R13.2
// non-owner-can't-win-off-turn interaction, `updateAwards` wiring (awards.ts), and a seeded
// brute-force cross-check (sim/longestRoadBruteForce.ts) — a DIFFERENT algorithm that must agree
// with `longestRoadLength` on random road-sets (I6, T-112's concern, exercised here early).
//
// Shapes are built by searching the REAL frozen board geometry at test-run time (backtracking
// path/loop finders below) rather than hand-picked literal ids — the exact numbering of
// GEOMETRY's 54 vertices/72 edges is an implementation detail this file shouldn't hard-code.

import { describe, it, expect } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { EdgeId, GameState, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { hashSeed, pickIndex, shuffle } from '../rng.js';
import { checkWin } from '../vp.js';
import { awardMoved } from '../events.js';
import { longestRoadLength, updateLongestRoad } from './longestRoad.js';
import { updateAwards } from './awards.js';
import { longestRoadBruteForce } from '../sim/longestRoadBruteForce.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

interface SeatPieces {
  roads?: EdgeId[];
  settlements?: VertexId[];
  cities?: VertexId[];
}

/** A `main`-phase state with hand-picked roads/settlements/cities per seat (docs/05 §4 pattern). */
function craft(
  pieces: Partial<Record<Seat, SeatPieces>>,
  opts: { turnPlayer?: Seat; awards?: GameState['awards'] } = {}
): GameState {
  const g = createGame({ ...CONFIG, seed: 'longest-road' });
  const players = g.players.map((p) => {
    const o = pieces[p.seat];
    return {
      ...p,
      roads: o?.roads ?? [],
      settlements: o?.settlements ?? [],
      cities: o?.cities ?? [],
    };
  });
  return {
    ...g,
    players,
    phase: { kind: 'main' },
    turn: { ...g.turn, player: opts.turnPlayer ?? 0, rolled: true },
    awards: opts.awards ?? g.awards,
  };
}

// ---------------------------------------------------------------------------------------------
// Geometry search helpers — all operate on the real, frozen `GEOMETRY` (docs/03 §1.3): 54
// vertices (18 of degree 2, 36 of degree 3), 72 edges, 19 hexes.
// ---------------------------------------------------------------------------------------------

/** Backtracking search for a SIMPLE path (no repeated vertex) of exactly `edgeCount` edges. */
function findChain(
  start: VertexId,
  edgeCount: number,
  avoid: ReadonlySet<VertexId> = new Set()
): { vertices: VertexId[]; edges: EdgeId[] } {
  const path: VertexId[] = [start];
  const edges: EdgeId[] = [];
  function rec(): boolean {
    if (edges.length === edgeCount) return true;
    const v = path[path.length - 1]!;
    const vertex = GEOMETRY.vertices[v]!;
    for (let i = 0; i < vertex.neighbors.length; i++) {
      const next = vertex.neighbors[i]!;
      const edge = vertex.edges[i]!;
      if (path.includes(next) || avoid.has(next)) continue;
      path.push(next);
      edges.push(edge);
      if (rec()) return true;
      path.pop();
      edges.pop();
    }
    return false;
  }
  if (!rec()) throw new Error(`BUG: test setup — no ${edgeCount}-edge chain from vertex ${start}`);
  return { vertices: [...path], edges: [...edges] };
}

function findDegreeVertex(degree: number): VertexId {
  const v = GEOMETRY.vertices.find((candidate) => candidate.neighbors.length === degree);
  if (!v) throw new Error(`BUG: no vertex of degree ${degree} on this board`);
  return v.id;
}

/** The 6 edges bordering hex `hexIndex` — a closed hexagon loop of 6 (R11.1/FAQ #22). */
function hexLoopEdges(hexIndex: number): EdgeId[] {
  const hex = GEOMETRY.hexes[hexIndex];
  if (!hex) throw new Error(`BUG: no hex ${hexIndex}`);
  return [...hex.edges];
}

/** A hex-loop vertex with a 3rd edge leading OFF the loop, for the "loop + tail" vector. */
function hexWithExternalVertex(): { hexIndex: number; outEdge: EdgeId; outTo: VertexId } {
  for (let h = 0; h < GEOMETRY.hexes.length; h++) {
    const hex = GEOMETRY.hexes[h]!;
    const loopEdges = new Set(hex.edges);
    for (const vId of hex.vertices) {
      const vertex = GEOMETRY.vertices[vId]!;
      for (let i = 0; i < vertex.edges.length; i++) {
        const e = vertex.edges[i]!;
        if (!loopEdges.has(e)) {
          return { hexIndex: h, outEdge: e, outTo: vertex.neighbors[i]! };
        }
      }
    }
  }
  throw new Error('BUG: no hex on this board has an external (off-loop) vertex');
}

/**
 * Two boundary-adjacent hexes' combined edge sets (6 + 6 − 1 shared = 11 distinct edges).
 *
 * Deviation from the task table's literal vector #9 ("figure-eight, two loops sharing A vertex"):
 * on THIS board every vertex has degree ≤ 3 (confirmed: 18 boundary vertices at degree 2, 36
 * interior at degree 3 — docs/03 §1.3). Two fully separate loops meeting at a single vertex would
 * need 4 roads at that vertex (2 per loop) — structurally impossible here, not a gap in the
 * algorithm. The closest real analogue is two hex-boundary loops sharing an EDGE (2 vertices):
 * that shared edge's two endpoints each sit at degree 3 (exactly 2 odd-degree vertices in the
 * combined subgraph), so an Euler trail across all 11 edges exists — same "count every edge once,
 * loops are legal" property the vector is really probing. See Implementation notes for T-110.
 */
function twoAdjacentHexLoops(): EdgeId[] {
  for (const hexA of GEOMETRY.hexes) {
    for (const edgeId of hexA.edges) {
      const edge = GEOMETRY.edges[edgeId]!;
      if (edge.hexes.length === 2) {
        const hexBId = edge.hexes.find((h) => h !== hexA.id)!;
        const hexB = GEOMETRY.hexes[hexBId]!;
        return [...new Set([...hexA.edges, ...hexB.edges])];
      }
    }
  }
  throw new Error('BUG: no two adjacent hexes found');
}

// ---------------------------------------------------------------------------------------------
// 1-9: the task table's shape vectors.
// ---------------------------------------------------------------------------------------------

describe('longestRoadLength — shape vectors (R11.1/R11.3)', () => {
  it('1. straight chain of 5 -> 5', () => {
    const { edges } = findChain(GEOMETRY.vertices[0]!.id, 5);
    const state = craft({ 0: { roads: edges } });
    expect(longestRoadLength(state, 0)).toBe(5);
  });

  it('2. chain of 4 -> 4 (below the 5 threshold, no award)', () => {
    const { edges } = findChain(GEOMETRY.vertices[0]!.id, 4);
    const state = craft({ 0: { roads: edges } });
    expect(longestRoadLength(state, 0)).toBe(4);
    expect(updateLongestRoad(state).awards.longestRoad).toEqual({ holder: null, length: 0 });
  });

  it('3. Y: three 3-edge arms from one junction -> 6 (best two arms)', () => {
    const center = findDegreeVertex(3);
    const centerVertex = GEOMETRY.vertices[center]!;
    const used = new Set<VertexId>([center]);
    const edges: EdgeId[] = [];
    for (let i = 0; i < 3; i++) {
      const neighbor = centerVertex.neighbors[i]!;
      const centerEdge = centerVertex.edges[i]!;
      const rest = findChain(neighbor, 2, used);
      edges.push(centerEdge, ...rest.edges);
      for (const v of rest.vertices) used.add(v);
    }
    expect(edges.length).toBe(9);
    const state = craft({ 0: { roads: edges } });
    expect(longestRoadLength(state, 0)).toBe(6);
  });

  it('4. closed hexagon loop of 6 -> 6', () => {
    const edges = hexLoopEdges(0);
    const state = craft({ 0: { roads: edges } });
    expect(longestRoadLength(state, 0)).toBe(6);
  });

  it('5. loop of 6 + tail of 2 -> 8', () => {
    const { hexIndex, outEdge, outTo } = hexWithExternalVertex();
    const loop = hexLoopEdges(hexIndex);
    const loopVertices = new Set(GEOMETRY.hexes[hexIndex]!.vertices);
    const tailRest = findChain(outTo, 1, loopVertices);
    const edges = [...loop, outEdge, ...tailRest.edges];
    expect(edges.length).toBe(8);
    const state = craft({ 0: { roads: edges } });
    expect(longestRoadLength(state, 0)).toBe(8);
  });

  it('6. two disconnected chains 4 & 3 -> 4 (the longer one)', () => {
    const chainA = findChain(GEOMETRY.vertices[0]!.id, 4);
    const usedByA = new Set(chainA.vertices);
    let startB: VertexId | null = null;
    for (let i = GEOMETRY.vertices.length - 1; i >= 0; i--) {
      const id = GEOMETRY.vertices[i]!.id;
      if (!usedByA.has(id)) {
        startB = id;
        break;
      }
    }
    if (startB === null) throw new Error('BUG: no free vertex for the second chain');
    const chainB = findChain(startB, 3, usedByA);
    const state = craft({ 0: { roads: [...chainA.edges, ...chainB.edges] } });
    expect(longestRoadLength(state, 0)).toBe(4);
  });

  it('7. chain of 7 with an enemy settlement on its 4th vertex -> 4 (3+4 split, max side)', () => {
    const chain = findChain(GEOMETRY.vertices[0]!.id, 7);
    const fourthVertex = chain.vertices[3]!; // 0-indexed: v0,v1,v2,v3 is the 4th vertex.
    const state = craft({
      0: { roads: chain.edges },
      1: { settlements: [fourthVertex] }, // seat 1 (enemy, from seat 0's POV) blocks passthrough.
    });
    expect(longestRoadLength(state, 0)).toBe(4);
  });

  it('8. chain of 5 crossing OWN settlement -> 5 (unbroken; own buildings never block)', () => {
    const chain = findChain(GEOMETRY.vertices[0]!.id, 5);
    const interiorVertex = chain.vertices[2]!;
    const state = craft({ 0: { roads: chain.edges, settlements: [interiorVertex] } });
    expect(longestRoadLength(state, 0)).toBe(5);
  });

  it('9. figure-eight analogue: two loops meeting at a pinch -> counts every edge once', () => {
    const edges = twoAdjacentHexLoops();
    expect(edges.length).toBe(11);
    const state = craft({ 0: { roads: edges } });
    expect(longestRoadLength(state, 0)).toBe(11);
  });
});

// ---------------------------------------------------------------------------------------------
// Award lifecycle (R11.2/R11.3).
// ---------------------------------------------------------------------------------------------

describe('updateLongestRoad — award lifecycle (R11.2/R11.3)', () => {
  it('first-to-5 takes the card', () => {
    const { edges } = findChain(GEOMETRY.vertices[0]!.id, 5);
    const state = craft({ 0: { roads: edges } });
    const next = updateLongestRoad(state);
    expect(next.awards.longestRoad).toEqual({ holder: 0, length: 5 });
  });

  it('6 vs 5 steals it (strictly greater required)', () => {
    const chainHolder = findChain(GEOMETRY.vertices[0]!.id, 5);
    const usedByHolder = new Set(chainHolder.vertices);
    const start2 = GEOMETRY.vertices[GEOMETRY.vertices.length - 1]!.id;
    const chainChallenger = findChain(start2, 6, usedByHolder);
    const state = craft(
      { 1: { roads: chainHolder.edges }, 0: { roads: chainChallenger.edges } },
      { awards: { longestRoad: { holder: 1, length: 5 }, largestArmy: { holder: null, count: 0 } } }
    );
    const next = updateLongestRoad(state);
    expect(next.awards.longestRoad).toEqual({ holder: 0, length: 6 });
  });

  it('tie 6=6 keeps the current holder', () => {
    const chainHolder = findChain(GEOMETRY.vertices[0]!.id, 6);
    const usedByHolder = new Set(chainHolder.vertices);
    const start2 = GEOMETRY.vertices[GEOMETRY.vertices.length - 1]!.id;
    const chainChallenger = findChain(start2, 6, usedByHolder);
    const state = craft(
      { 1: { roads: chainHolder.edges }, 0: { roads: chainChallenger.edges } },
      { awards: { longestRoad: { holder: 1, length: 6 }, largestArmy: { holder: null, count: 0 } } }
    );
    const next = updateLongestRoad(state);
    expect(next.awards.longestRoad).toEqual({ holder: 1, length: 6 }); // unchanged despite the tie
  });

  it('enemy settlement breaks the holder to <5 with a second player at 5 -> transfers', () => {
    const chain = findChain(GEOMETRY.vertices[0]!.id, 6); // 7 vertices v0..v6
    const usedByChain = new Set(chain.vertices);
    const start2 = GEOMETRY.vertices[GEOMETRY.vertices.length - 1]!.id;
    const chainOther = findChain(start2, 5, usedByChain);
    const breakVertex = chain.vertices[3]!; // splits the 6-chain into 3 + 3
    const state = craft(
      { 1: { roads: chain.edges }, 2: { roads: chainOther.edges }, 0: { settlements: [breakVertex] } },
      { awards: { longestRoad: { holder: 1, length: 6 }, largestArmy: { holder: null, count: 0 } } }
    );
    expect(longestRoadLength(state, 1)).toBeLessThan(5); // sanity: the break really lands <5
    const next = updateLongestRoad(state);
    expect(next.awards.longestRoad).toEqual({ holder: 2, length: 5 });
  });

  it('a break causing a 5=5 tie sets the card aside (holder: null); both lose the +2VP', () => {
    const chain = findChain(GEOMETRY.vertices[0]!.id, 6); // 7 vertices v0..v6
    const usedByChain = new Set(chain.vertices);
    const start2 = GEOMETRY.vertices[GEOMETRY.vertices.length - 1]!.id;
    const chainOther = findChain(start2, 5, usedByChain);
    const breakVertex = chain.vertices[1]!; // splits into 1 + 5 -> remainder is exactly 5
    const state = craft(
      { 1: { roads: chain.edges }, 2: { roads: chainOther.edges }, 0: { settlements: [breakVertex] } },
      { awards: { longestRoad: { holder: 1, length: 6 }, largestArmy: { holder: null, count: 0 } } }
    );
    expect(longestRoadLength(state, 1)).toBe(5);
    expect(longestRoadLength(state, 2)).toBe(5);
    const next = updateLongestRoad(state);
    expect(next.awards.longestRoad).toEqual({ holder: null, length: 0 });

    // Reclaim: seat 2 extends by one more edge and becomes the SOLE 6 -> reclaims from set-aside.
    const extension = findChain(
      chainOther.vertices[chainOther.vertices.length - 1]!,
      1,
      new Set([...usedByChain, ...chainOther.vertices])
    );
    const reclaimed = craft(
      {
        1: { roads: chain.edges },
        2: { roads: [...chainOther.edges, ...extension.edges] },
        0: { settlements: [breakVertex] },
      },
      { awards: next.awards }
    );
    const afterReclaim = updateLongestRoad(reclaimed);
    expect(afterReclaim.awards.longestRoad).toEqual({ holder: 2, length: 6 });
  });
});

describe('updateAwards (rules/awards.ts) — Longest Road wiring', () => {
  it('emits awardMoved only when the holder or length actually changes', () => {
    const { edges } = findChain(GEOMETRY.vertices[0]!.id, 5);
    const state = craft({ 0: { roads: edges } });

    const first = updateAwards(state);
    expect(first.state.awards.longestRoad).toEqual({ holder: 0, length: 5 });
    expect(first.events).toEqual([awardMoved('longestRoad', 0, 5)]);

    // Calling again on the settled state (nothing changed) emits nothing.
    const second = updateAwards(first.state);
    expect(second.events).toEqual([]);
    expect(second.state).toBe(first.state); // same reference — updateLongestRoad is a no-op here
  });
});

describe('R13.2 — an award moving to a non-owner never wins for them off their own turn', () => {
  it('seat reaching target VP via a stolen Longest Road only wins once it becomes their turn', () => {
    const { edges } = findChain(GEOMETRY.vertices[0]!.id, 5);
    // Seat 2: 4 cities (8 VP) + about-to-claim Longest Road (+2 VP) = 10 = TARGET_VP.
    const cities = [0, 1, 2, 3].map((n) => GEOMETRY.vertices[n]!.id);
    const state = craft(
      { 2: { roads: edges, cities } },
      { turnPlayer: 0 } // seat 0 is the active player, not seat 2
    );

    const awarded = updateLongestRoad(state);
    expect(awarded.awards.longestRoad.holder).toBe(2);

    // Not seat 2's turn -> no win, even though seat 2's total already reached target.
    const stillPlaying = checkWin(awarded);
    expect(stillPlaying.phase.kind).not.toBe('ended');

    // Now it's seat 2's turn -> checkWin (R13.2) ends the game for them.
    const seat2Turn: GameState = { ...awarded, turn: { ...awarded.turn, player: 2 } };
    const ended = checkWin(seat2Turn);
    expect(ended.phase).toEqual({ kind: 'ended', winner: 2 });
  });
});

// ---------------------------------------------------------------------------------------------
// Independent cross-check: sim/longestRoadBruteForce.ts must agree with longestRoadLength.
// ---------------------------------------------------------------------------------------------

describe('longestRoadBruteForce cross-check (I6)', () => {
  it('agrees with longestRoadLength on 500 random road-sets (seeded)', () => {
    let rngState = hashSeed('lr-crosscheck-500');
    const allEdgeIds = GEOMETRY.edges.map((e) => e.id);

    for (let trial = 0; trial < 500; trial++) {
      const sizeRoll = pickIndex(rngState, 15);
      rngState = sizeRoll.state;
      const size = sizeRoll.value + 1; // 1..15 (PIECES_PER_PLAYER.roads)

      const shuffled = shuffle(rngState, allEdgeIds);
      rngState = shuffled.state;
      const roads = shuffled.array.slice(0, size);

      const state = craft({ 0: { roads } });
      expect(longestRoadBruteForce(state, 0)).toBe(longestRoadLength(state, 0));
    }
  });

  it('agrees on the blocked-vertex case too (chain #7 above)', () => {
    const chain = findChain(GEOMETRY.vertices[0]!.id, 7);
    const fourthVertex = chain.vertices[3]!;
    const state = craft({ 0: { roads: chain.edges }, 1: { settlements: [fourthVertex] } });
    expect(longestRoadBruteForce(state, 0)).toBe(longestRoadLength(state, 0));
    expect(longestRoadBruteForce(state, 0)).toBe(4);
  });
});
