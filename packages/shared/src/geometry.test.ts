import { describe, it, expect } from 'vitest';
import {
  BASE_LAYOUT,
  GEOMETRY,
  buildGeometry,
  vertexAdjacentHexes,
  vertexAdjacentVertices,
  vertexEdges,
  edgeEndpoints,
  edgesOfHex,
  verticesOfHex,
  type BoardGeometry,
  type BoardLayout,
} from './geometry.js';
import { GEOMETRY as GEOMETRY_FROM_INDEX } from './index.js';
import type { EdgeId, HexId, VertexId } from './types.js';

/** Hex distance from the origin in axial coordinates. */
function hexDist(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

/** The single vertex shared by two edges; asserts there is exactly one. */
function sharedVertex(g: BoardGeometry, e1: EdgeId, e2: EdgeId): VertexId {
  const a = g.edges[e1];
  const b = g.edges[e2];
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  const shared = [a!.a, a!.b].filter((v) => v === b!.a || v === b!.b);
  expect(shared).toHaveLength(1);
  return shared[0]!;
}

/**
 * Structural invariants that must hold for ANY layout — run against both the
 * base board and the synthetic flower board (parametricity).
 */
function checkGeometryInvariants(g: BoardGeometry): void {
  // Vertices: 1–3 hexes, 2–3 edges, neighbors aligned with edges.
  g.vertices.forEach((v, i) => {
    expect(v.id).toBe(i);
    expect(v.hexes.length).toBeGreaterThanOrEqual(1);
    expect(v.hexes.length).toBeLessThanOrEqual(3);
    expect(new Set(v.hexes).size).toBe(v.hexes.length);
    expect([2, 3]).toContain(v.edges.length);
    expect(v.neighbors.length).toBe(v.edges.length);
    v.edges.forEach((eid, k) => {
      const e = g.edges[eid];
      expect(e).toBeDefined();
      // symmetry: e ∈ vertex.edges ⇔ v ∈ {e.a, e.b}
      expect([e!.a, e!.b]).toContain(v.id);
      // neighbors[k] is the far endpoint of edges[k]
      expect(v.neighbors[k]).toBe(e!.a === v.id ? e!.b : e!.a);
    });
    // neighbor symmetry: u ∈ v.neighbors ⇔ v ∈ u.neighbors
    for (const u of v.neighbors) {
      expect(g.vertices[u]!.neighbors).toContain(v.id);
    }
    // hex back-reference: v ∈ hex.vertices for every hex the vertex claims
    for (const h of v.hexes) {
      expect(g.hexes[h]!.vertices).toContain(v.id);
    }
  });

  // Edges: two distinct endpoints (a < b), 1–2 hexes, endpoints list the edge.
  g.edges.forEach((e, i) => {
    expect(e.id).toBe(i);
    expect(e.a).not.toBe(e.b);
    expect(e.a).toBeLessThan(e.b);
    expect(e.hexes.length).toBeGreaterThanOrEqual(1);
    expect(e.hexes.length).toBeLessThanOrEqual(2);
    expect(new Set(e.hexes).size).toBe(e.hexes.length);
    expect(g.vertices[e.a]!.edges).toContain(e.id);
    expect(g.vertices[e.b]!.edges).toContain(e.id);
    for (const h of e.hexes) {
      expect(g.hexes[h]!.edges).toContain(e.id);
    }
    // midpoint and orientation are consistent with the endpoints
    const va = g.vertices[e.a]!;
    const vb = g.vertices[e.b]!;
    expect(e.x).toBeCloseTo((va.x + vb.x) / 2, 3);
    expect(e.y).toBeCloseTo((va.y + vb.y) / 2, 3);
    expect([30, 90, 150]).toContain(e.angleDeg);
    let deg = (Math.atan2(vb.y - va.y, vb.x - va.x) * 180) / Math.PI;
    deg = ((deg % 180) + 180) % 180;
    expect(Math.abs(deg - e.angleDeg)).toBeLessThan(0.1);
  });

  // Hexes: 6 distinct vertices and edges; the two orderings are consistent —
  // edge k connects corner k to corner k+1.
  g.hexes.forEach((h, i) => {
    expect(h.id).toBe(i);
    expect(h.vertices).toHaveLength(6);
    expect(h.edges).toHaveLength(6);
    expect(new Set(h.vertices).size).toBe(6);
    expect(new Set(h.edges).size).toBe(6);
    for (let k = 0; k < 6; k++) {
      const e = g.edges[h.edges[k]!]!;
      expect(new Set([e.a, e.b])).toEqual(new Set([h.vertices[k]!, h.vertices[(k + 1) % 6]!]));
      expect(e.hexes).toContain(h.id);
    }
    for (const v of h.vertices) {
      expect(g.vertices[v]!.hexes).toContain(h.id);
    }
  });

  // coastEdges: exactly the edges bordering one hex, forming closed clockwise cycles.
  const coastSet = new Set(g.coastEdges);
  expect(coastSet.size).toBe(g.coastEdges.length);
  for (const e of g.edges) {
    expect(coastSet.has(e.id)).toBe(e.hexes.length === 1);
  }
  if (g.coastEdges.length > 0) {
    const n = g.coastEdges.length;
    // consecutive coast edges (with wraparound) share exactly one vertex
    const polygon: VertexId[] = [];
    for (let i = 0; i < n; i++) {
      polygon.push(sharedVertex(g, g.coastEdges[i]!, g.coastEdges[(i + 1) % n]!));
    }
    // clockwise on a y-down screen ⇔ positive shoelace sum
    let area2 = 0;
    for (let i = 0; i < polygon.length; i++) {
      const p = g.vertices[polygon[i]!]!;
      const q = g.vertices[polygon[(i + 1) % polygon.length]!]!;
      area2 += p.x * q.y - q.x * p.y;
    }
    expect(area2).toBeGreaterThan(0);
    // starts at the topmost-then-leftmost coastal edge (by midpoint (y, x))
    const first = g.edges[g.coastEdges[0]!]!;
    for (const id of g.coastEdges) {
      const e = g.edges[id]!;
      expect(first.y < e.y || (first.y === e.y && first.x <= e.x)).toBe(true);
    }
  }

  // harborSpots are coastal
  for (const h of g.harborSpots) {
    expect(coastSet.has(h)).toBe(true);
  }

  // hexSpiralOrder is a permutation of all hex ids
  expect([...g.hexSpiralOrder].sort((a, b) => a - b)).toEqual(g.hexes.map((h) => h.id));
}

describe('GEOMETRY (base 19-hex board)', () => {
  it('has the canonical counts: 19 hexes, 54 vertices, 72 edges, 30 coast, 9 harbors', () => {
    expect(GEOMETRY.hexes).toHaveLength(19);
    expect(GEOMETRY.vertices).toHaveLength(54);
    expect(GEOMETRY.edges).toHaveLength(72);
    expect(GEOMETRY.coastEdges).toHaveLength(30);
    expect(GEOMETRY.harborSpots).toHaveLength(9);
    expect(new Set(GEOMETRY.harborSpots).size).toBe(9);
  });

  it('satisfies all structural invariants', () => {
    checkGeometryInvariants(GEOMETRY);
  });

  it('has exactly 24 interior vertices (3 hexes), each with 3 neighbors and 3 edges', () => {
    const interior = GEOMETRY.vertices.filter((v) => v.hexes.length === 3);
    expect(interior).toHaveLength(24);
    for (const v of interior) {
      expect(v.edges).toHaveLength(3);
      expect(v.neighbors).toHaveLength(3);
    }
  });

  it('picks harborSpots at clockwise coast indices [0,3,6,10,13,16,20,23,26] (D-016)', () => {
    expect(GEOMETRY.harborSpots).toEqual(
      [0, 3, 6, 10, 13, 16, 20, 23, 26].map((i) => GEOMETRY.coastEdges[i])
    );
  });

  it('harbor spots are pairwise non-adjacent (no shared vertex)', () => {
    for (let i = 0; i < GEOMETRY.harborSpots.length; i++) {
      for (let j = i + 1; j < GEOMETRY.harborSpots.length; j++) {
        const e1 = GEOMETRY.edges[GEOMETRY.harborSpots[i]!]!;
        const e2 = GEOMETRY.edges[GEOMETRY.harborSpots[j]!]!;
        const shared = [e1.a, e1.b].filter((v) => v === e2.a || v === e2.b);
        expect(shared).toHaveLength(0);
      }
    }
  });

  it('hexSpiralOrder is a permutation of 0…18; outer ring first, center last', () => {
    const order = GEOMETRY.hexSpiralOrder;
    expect([...order].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 19 }, (_, i) => i as HexId)
    );
    const ring2 = GEOMETRY.hexes.filter((h) => hexDist(h.q, h.r) === 2).map((h) => h.id);
    expect(new Set(order.slice(0, 12))).toEqual(new Set(ring2));
    const center = GEOMETRY.hexes.find((h) => h.q === 0 && h.r === 0)!;
    expect(order[18]).toBe(center.id);
  });

  it('hexSpiralOrder starts at (0,−2) and matches the documented CCW inward traversal', () => {
    const start = GEOMETRY.hexes[GEOMETRY.hexSpiralOrder[0]!]!;
    expect({ q: start.q, r: start.r }).toEqual({ q: 0, r: -2 });
    // Derived by hand from the traversal comment in geometry.ts:
    // (0,−2) (−1,−1) (−2,0) (−2,1) (−2,2) (−1,2) (0,2) (1,1) (2,0) (2,−1) (2,−2) (1,−2)
    // → (0,−1) (−1,0) (−1,1) (0,1) (1,0) (1,−1) → (0,0)
    expect(GEOMETRY.hexSpiralOrder).toEqual([
      0, 3, 7, 12, 16, 17, 18, 15, 11, 6, 2, 1, 4, 8, 13, 14, 10, 5, 9,
    ]);
  });

  it('hexSpiralOrder is a connected path (every consecutive pair is hex-adjacent)', () => {
    for (let i = 0; i < GEOMETRY.hexSpiralOrder.length - 1; i++) {
      const h1 = GEOMETRY.hexes[GEOMETRY.hexSpiralOrder[i]!]!;
      const h2 = GEOMETRY.hexes[GEOMETRY.hexSpiralOrder[i + 1]!]!;
      const dq = h2.q - h1.q;
      const dr = h2.r - h1.r;
      const isNeighbor = [
        [1, 0],
        [-1, 0],
        [1, -1],
        [0, -1],
        [0, 1],
        [-1, 1],
      ].some(([q, r]) => dq === q && dr === r);
      expect(isNeighbor).toBe(true);
    }
  });

  it('is deterministic: building twice yields deeply-equal objects', () => {
    const g1 = buildGeometry(BASE_LAYOUT);
    const g2 = buildGeometry(BASE_LAYOUT);
    expect(g1).toEqual(g2);
    expect(g1).toEqual(GEOMETRY);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(GEOMETRY)).toBe(true);
    expect(Object.isFrozen(GEOMETRY.hexes)).toBe(true);
    expect(Object.isFrozen(GEOMETRY.hexes[0])).toBe(true);
    expect(Object.isFrozen(GEOMETRY.hexes[0]!.vertices)).toBe(true);
    expect(Object.isFrozen(GEOMETRY.vertices[0])).toBe(true);
    expect(Object.isFrozen(GEOMETRY.vertices[0]!.edges)).toBe(true);
    expect(Object.isFrozen(GEOMETRY.edges[0])).toBe(true);
    expect(Object.isFrozen(GEOMETRY.coastEdges)).toBe(true);
    expect(() => {
      (GEOMETRY.coastEdges as EdgeId[]).push(0 as EdgeId);
    }).toThrow();
    expect(() => {
      (GEOMETRY.vertices[0] as { x: number }).x = 99;
    }).toThrow();
  });

  it('is re-exported from the package index', () => {
    expect(GEOMETRY_FROM_INDEX).toBe(GEOMETRY);
  });

  it('matches the locked snapshot (canonical IDs must never change)', () => {
    expect(GEOMETRY).toMatchSnapshot();
  });
});

describe('buildGeometry parametricity (synthetic 7-hex flower)', () => {
  // Center + ring 1, deliberately unsorted to prove the builder sorts.
  const FLOWER_LAYOUT: BoardLayout = {
    hexes: [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: -1, r: 1 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: 0, r: 1 },
      { q: -1, r: 0 },
    ],
    harborCoastIndices: [],
    spiralStart: { q: 0, r: -1 },
  };

  it('yields the derivable counts: 7 hexes, 24 vertices, 30 edges, 18 coast edges', () => {
    const g = buildGeometry(FLOWER_LAYOUT);
    expect(g.hexes).toHaveLength(7);
    expect(g.vertices).toHaveLength(24);
    expect(g.edges).toHaveLength(30);
    expect(g.coastEdges).toHaveLength(18);
    expect(g.harborSpots).toHaveLength(0);
  });

  it('satisfies all structural invariants', () => {
    checkGeometryInvariants(buildGeometry(FLOWER_LAYOUT));
  });

  it('spirals the ring first and the center last', () => {
    const g = buildGeometry(FLOWER_LAYOUT);
    const order = g.hexSpiralOrder;
    expect(order).toHaveLength(7);
    const start = g.hexes[order[0]!]!;
    expect({ q: start.q, r: start.r }).toEqual({ q: 0, r: -1 });
    const center = g.hexes.find((h) => h.q === 0 && h.r === 0)!;
    expect(order[6]).toBe(center.id);
  });

  it('is deterministic and frozen for non-base layouts too', () => {
    const g1 = buildGeometry(FLOWER_LAYOUT);
    const g2 = buildGeometry(FLOWER_LAYOUT);
    expect(g1).toEqual(g2);
    expect(Object.isFrozen(g1)).toBe(true);
    expect(Object.isFrozen(g1.vertices[0])).toBe(true);
  });
});

describe('lookup helpers', () => {
  it('vertexAdjacentHexes / vertexAdjacentVertices / vertexEdges read the vertex tables', () => {
    for (const v of GEOMETRY.vertices) {
      expect(vertexAdjacentHexes(v.id)).toEqual(v.hexes);
      expect(vertexAdjacentVertices(v.id)).toEqual(v.neighbors);
      expect(vertexEdges(v.id)).toEqual(v.edges);
    }
  });

  it('edgeEndpoints returns [a, b] with a < b', () => {
    for (const e of GEOMETRY.edges) {
      const [a, b] = edgeEndpoints(e.id);
      expect(a).toBe(e.a);
      expect(b).toBe(e.b);
      expect(a).toBeLessThan(b);
    }
  });

  it('edgesOfHex / verticesOfHex read the hex tables', () => {
    for (const h of GEOMETRY.hexes) {
      expect(edgesOfHex(h.id)).toEqual(h.edges);
      expect(verticesOfHex(h.id)).toEqual(h.vertices);
    }
  });

  it('accepts an explicit geometry for non-base layouts', () => {
    const g = buildGeometry({
      hexes: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
      harborCoastIndices: [],
      spiralStart: { q: 0, r: 0 },
    });
    expect(g.vertices).toHaveLength(10);
    expect(g.edges).toHaveLength(11);
    const v0 = g.vertices[0]!;
    expect(vertexEdges(v0.id, g)).toEqual(v0.edges);
    expect(edgeEndpoints(g.edges[0]!.id, g)).toEqual([g.edges[0]!.a, g.edges[0]!.b]);
    expect(verticesOfHex(g.hexes[0]!.id, g)).toEqual(g.hexes[0]!.vertices);
  });

  it('throws BUG: on unknown ids (programmer error, docs/05 §2)', () => {
    expect(() => vertexAdjacentHexes(999 as VertexId)).toThrow(/^BUG:/);
    expect(() => vertexAdjacentVertices(-1 as VertexId)).toThrow(/^BUG:/);
    expect(() => vertexEdges(54 as VertexId)).toThrow(/^BUG:/);
    expect(() => edgeEndpoints(72 as EdgeId)).toThrow(/^BUG:/);
    expect(() => edgesOfHex(19 as HexId)).toThrow(/^BUG:/);
    expect(() => verticesOfHex(999 as HexId)).toThrow(/^BUG:/);
  });
});
