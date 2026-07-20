// Board geometry (docs/03 §1) — parametric builder.
// R1.3: base board has 19 hexes, 54 intersections (vertices), 72 paths (edges).
// Pointy-top hexes, axial coordinates (q, r); pixel space has y growing DOWNWARD:
//   x = √3·(q + r/2), y = 1.5·r  (unit hex size 1).
// Construction (docs/03 §1.2): pixel corners → round(3dp) → dedupe → sort → integer IDs.
// Nothing here may assume 19 hexes — expansion boards are new BoardLayout data.

import type { HexId, VertexId, EdgeId } from './types.js';

// ---------------------------------------------------------------------------
// Public shapes (docs/03 §1.3)
// ---------------------------------------------------------------------------

export interface BoardLayout {
  hexes: { q: number; r: number }[];
  /** Positions along the clockwise coastline that carry harbors. */
  harborCoastIndices: number[];
  /** Outer-ring hex where the token spiral starts. */
  spiralStart: { q: number; r: number };
}

export interface GeometryHex {
  id: HexId;
  q: number;
  r: number;
  x: number;
  y: number;
  /** Always 6, in corner order N, NE, SE, S, SW, NW (k = 0…5). */
  vertices: VertexId[];
  /** Always 6; edges[k] connects vertices[k] to vertices[(k+1) % 6]. */
  edges: EdgeId[];
}

export interface GeometryVertex {
  id: VertexId;
  x: number;
  y: number;
  /** 1–3 touching hexes, ascending. */
  hexes: HexId[];
  /** 2–3 incident edges, ascending. */
  edges: EdgeId[];
  /** Aligned with `edges`: neighbors[i] is the far endpoint of edges[i]. */
  neighbors: VertexId[];
}

export interface GeometryEdge {
  id: EdgeId;
  /** Endpoints with a < b (by vertex id). */
  a: VertexId;
  b: VertexId;
  /** 1–2 bordering hexes, ascending; length 1 ⇔ coastal. */
  hexes: HexId[];
  /** Midpoint of the segment. */
  x: number;
  y: number;
  /** Segment orientation in degrees, one of 30 | 90 | 150 for pointy-top hexes. */
  angleDeg: number;
}

export interface BoardGeometry {
  hexes: GeometryHex[];
  vertices: GeometryVertex[];
  edges: GeometryEdge[];
  /** Edges bordering exactly one hex, ordered clockwise from the topmost-then-leftmost. */
  coastEdges: EdgeId[];
  /** coastEdges picked at layout.harborCoastIndices (base: 9 spots, D-016). */
  harborSpots: EdgeId[];
  /** Counterclockwise inward spiral of hex ids for R2.3 token placement. */
  hexSpiralOrder: HexId[];
}

// ---------------------------------------------------------------------------
// Internal constants & helpers
// ---------------------------------------------------------------------------

const SQRT3 = Math.sqrt(3);

// The 6 corners of a pointy-top hex sit at angles −90° + 60°·k (k = 0…5) from its
// center, radius 1 (docs/03 §1.1). These offsets are (cos, sin) of those angles,
// written exactly to avoid trig noise: N, NE, SE, S, SW, NW.
const CORNER_OFFSETS: readonly { x: number; y: number }[] = [
  { x: 0, y: -1 }, // N   (−90°)
  { x: SQRT3 / 2, y: -0.5 }, // NE  (−30°)
  { x: SQRT3 / 2, y: 0.5 }, // SE  (+30°)
  { x: 0, y: 1 }, // S   (+90°)
  { x: -SQRT3 / 2, y: 0.5 }, // SW  (+150°)
  { x: -SQRT3 / 2, y: -0.5 }, // NW  (+210°)
];

// Axial neighbor deltas (docs/03 §1.1): E, W, NE, NW, SE, SW.
const NEIGHBOR_DELTAS: readonly { q: number; r: number }[] = [
  { q: 1, r: 0 },
  { q: -1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
];

/** Round to 3 decimals and normalize -0 → 0 so dedupe keys and snapshots are stable. */
function round3(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Coastline ordering
// ---------------------------------------------------------------------------

/**
 * Order the coastal edges (exactly 1 bordering hex) as a clockwise cycle starting
 * at the topmost (then leftmost) coastal edge, by midpoint (y, x).
 *
 * Robust for any simply-bordered layout: walk the coast cycle vertex-to-vertex,
 * orient it clockwise via the shoelace sign (y grows downward, so a clockwise
 * traversal has positive signed area), then rotate to the canonical start.
 * Layouts with several coastlines (future multi-island maps) yield each cycle
 * clockwise, concatenated in (y, x) order of their start edges.
 */
function orderCoastClockwise(edges: GeometryEdge[], vertices: GeometryVertex[]): EdgeId[] {
  const coastIds = edges.filter((e) => e.hexes.length === 1).map((e) => e.id);
  if (coastIds.length === 0) return [];

  // Coastal edges incident to each coastal vertex — must be exactly 2 (simple cycle).
  const atVertex = new Map<number, EdgeId[]>();
  for (const id of coastIds) {
    const e = edges[id];
    if (!e) throw new Error(`BUG: missing edge ${id}`);
    for (const v of [e.a, e.b]) {
      const list = atVertex.get(v);
      if (list) list.push(id);
      else atVertex.set(v, [id]);
    }
  }
  for (const [v, list] of atVertex) {
    if (list.length !== 2) throw new Error(`BUG: coastline is not a simple cycle at vertex ${v}`);
  }

  const visited = new Set<EdgeId>();
  const cycles: EdgeId[][] = [];
  for (const startId of coastIds) {
    if (visited.has(startId)) continue;
    const cycle: EdgeId[] = [];
    const walkVerts: number[] = [];
    let curEdge = startId;
    const startEdge = edges[startId];
    if (!startEdge) throw new Error(`BUG: missing edge ${startId}`);
    let curVert: number = startEdge.a;
    do {
      cycle.push(curEdge);
      visited.add(curEdge);
      walkVerts.push(curVert);
      const e = edges[curEdge];
      if (!e) throw new Error(`BUG: missing edge ${curEdge}`);
      const nextVert = e.a === curVert ? e.b : e.a;
      const pair = atVertex.get(nextVert);
      if (!pair || pair.length !== 2) throw new Error(`BUG: broken coast at vertex ${nextVert}`);
      const first = pair[0];
      const second = pair[1];
      if (first === undefined || second === undefined) {
        throw new Error(`BUG: broken coast at vertex ${nextVert}`);
      }
      curVert = nextVert;
      curEdge = first === curEdge ? second : first;
    } while (curEdge !== startId);

    // Shoelace over the walked vertex polygon; with y-down screen coordinates a
    // clockwise-on-screen traversal has a positive sum. Reverse if we walked CCW.
    let area2 = 0;
    for (let i = 0; i < walkVerts.length; i++) {
      const pi = walkVerts[i];
      const pj = walkVerts[(i + 1) % walkVerts.length];
      if (pi === undefined || pj === undefined) throw new Error('BUG: broken coast walk');
      const p = vertices[pi];
      const q = vertices[pj];
      if (!p || !q) throw new Error('BUG: broken coast walk');
      area2 += p.x * q.y - q.x * p.y;
    }
    if (area2 < 0) cycle.reverse();

    // Rotate so the topmost-then-leftmost edge (midpoint (y, x) minimal) is first.
    let best = 0;
    for (let i = 1; i < cycle.length; i++) {
      const ei = edges[cycle[i] as number];
      const eb = edges[cycle[best] as number];
      if (!ei || !eb) throw new Error('BUG: broken coast cycle');
      if (ei.y < eb.y || (ei.y === eb.y && ei.x < eb.x)) best = i;
    }
    cycles.push(cycle.slice(best).concat(cycle.slice(0, best)));
  }

  cycles.sort((c1, c2) => {
    const e1 = edges[c1[0] as number];
    const e2 = edges[c2[0] as number];
    if (!e1 || !e2) throw new Error('BUG: empty coast cycle');
    return e1.y - e2.y || e1.x - e2.x;
  });
  return cycles.flat();
}

// ---------------------------------------------------------------------------
// Token spiral (R2.3)
// ---------------------------------------------------------------------------

/**
 * Counterclockwise inward spiral of hex ids, starting at `layout.spiralStart`.
 *
 * Traversal (documenting requirement 4):
 *  1. Peel the layout into concentric rings: repeatedly remove every hex that has
 *     fewer than 6 neighbors still remaining (base board: outer 12 → middle 6 → center).
 *  2. Order each ring counterclockwise by pixel angle around the layout centroid
 *     (y grows downward, so counterclockwise on screen = descending atan2 angle).
 *  3. The outermost ring starts at `spiralStart` (must lie on it). Each inner ring
 *     starts at the hex adjacent to BOTH the previous ring's last and first hex —
 *     the printed spiral "tucks in" under its starting corner (falls back to any
 *     hex adjacent to the previous ring's last hex, then to the ring's first hex
 *     in angular order; the fallbacks never trigger for base/5–6 style boards).
 *
 * For the base board this yields, in axial coordinates:
 *   (0,−2) (−1,−1) (−2,0) (−2,1) (−2,2) (−1,2) (0,2) (1,1) (2,0) (2,−1) (2,−2) (1,−2)
 *   → (0,−1) (−1,0) (−1,1) (0,1) (1,0) (1,−1) → (0,0)
 * i.e. HexIds [0,3,7,12,16,17,18,15,11,6,2,1,4,8,13,14,10,5,9].
 */
function computeSpiralOrder(
  hexCoords: { q: number; r: number }[],
  spiralStart: { q: number; r: number }
): HexId[] {
  const n = hexCoords.length;
  if (n === 0) return [];

  const idOf = new Map<string, number>();
  hexCoords.forEach((h, i) => idOf.set(`${h.q},${h.r}`, i));

  let cx = 0;
  let cy = 0;
  for (const h of hexCoords) {
    cx += SQRT3 * (h.q + h.r / 2);
    cy += 1.5 * h.r;
  }
  cx /= n;
  cy /= n;

  const neighborIds = (i: number): number[] => {
    const h = hexCoords[i];
    if (!h) throw new Error(`BUG: missing hex ${i}`);
    const out: number[] = [];
    for (const d of NEIGHBOR_DELTAS) {
      const j = idOf.get(`${h.q + d.q},${h.r + d.r}`);
      if (j !== undefined) out.push(j);
    }
    return out;
  };

  // 1. Peel concentric rings. A finite nonempty hex set always has hexes with
  //    fewer than 6 remaining neighbors, so every pass removes at least one.
  const remaining = new Set<number>(hexCoords.map((_, i) => i));
  const rings: number[][] = [];
  while (remaining.size > 0) {
    const ring = [...remaining].filter(
      (i) => neighborIds(i).filter((j) => remaining.has(j)).length < 6
    );
    for (const i of ring) remaining.delete(i);
    rings.push(ring);
  }

  // 2. Counterclockwise ordering within a ring.
  const angleOf = (i: number): number => {
    const h = hexCoords[i];
    if (!h) throw new Error(`BUG: missing hex ${i}`);
    return Math.atan2(1.5 * h.r - cy, SQRT3 * (h.q + h.r / 2) - cx);
  };
  const ccwSort = (ring: number[]): number[] =>
    [...ring].sort((i, j) => {
      const d = angleOf(j) - angleOf(i); // descending angle = CCW on screen
      if (d !== 0) return d;
      const hi = hexCoords[i];
      const hj = hexCoords[j];
      if (!hi || !hj) throw new Error('BUG: missing hex in ring sort');
      return hi.r - hj.r || hi.q - hj.q; // deterministic tiebreak (convex boards never tie)
    });

  // 3. Chain the rings into one inward spiral.
  const order: number[] = [];
  let prevFirst = -1;
  let prevLast = -1;
  for (let ri = 0; ri < rings.length; ri++) {
    const cycle = ccwSort(rings[ri] ?? []);
    let startIdx: number;
    if (ri === 0) {
      startIdx = cycle.findIndex((i) => {
        const h = hexCoords[i];
        return h !== undefined && h.q === spiralStart.q && h.r === spiralStart.r;
      });
      if (startIdx < 0) {
        throw new Error('BUG: layout.spiralStart is not on the outermost ring');
      }
    } else {
      const lastN = new Set(neighborIds(prevLast));
      const firstN = new Set(neighborIds(prevFirst));
      startIdx = cycle.findIndex((i) => lastN.has(i) && firstN.has(i));
      if (startIdx < 0) startIdx = cycle.findIndex((i) => lastN.has(i));
      if (startIdx < 0) startIdx = 0;
    }
    const rotated = cycle.slice(startIdx).concat(cycle.slice(0, startIdx));
    order.push(...rotated);
    const first = rotated[0];
    const last = rotated[rotated.length - 1];
    if (first === undefined || last === undefined) throw new Error('BUG: empty spiral ring');
    prevFirst = first;
    prevLast = last;
  }
  return order.map((i) => i as HexId);
}

// ---------------------------------------------------------------------------
// Builder (docs/03 §1.2)
// ---------------------------------------------------------------------------

/**
 * Build the full board geometry for a layout. Deterministic — same layout in,
 * deeply-equal (and deeply-frozen) geometry out. IDs are assigned by sorting:
 * vertices by (y, x), edges by their sorted endpoint pair, hexes by (r, q).
 */
export function buildGeometry(layout: BoardLayout): BoardGeometry {
  // Hexes sorted by (r, q) → HexId = index.
  const hexCoords = [...layout.hexes].sort((h1, h2) => h1.r - h2.r || h1.q - h2.q);
  const seen = new Set<string>();
  for (const h of hexCoords) {
    const key = `${h.q},${h.r}`;
    if (seen.has(key)) throw new Error(`BUG: duplicate hex (${h.q},${h.r}) in layout`);
    seen.add(key);
  }

  // Raw (unrounded) centers feed the corner math so every corner position is
  // rounded exactly once; published center coordinates are rounded copies.
  const centers = hexCoords.map(({ q, r }) => ({ x: SQRT3 * (q + r / 2), y: 1.5 * r }));

  // §1.2 steps 1–2: corner pixels → round(3dp) → dedupe → vertex set.
  const vertexKeyToTemp = new Map<string, number>();
  const tempVerts: { x: number; y: number; hexes: number[] }[] = [];
  const cornerTempVert: number[][] = []; // [hexIndex][k] → temp vertex index
  hexCoords.forEach((_, hi) => {
    const c = centers[hi];
    if (!c) throw new Error(`BUG: missing center ${hi}`);
    const row: number[] = [];
    for (let k = 0; k < 6; k++) {
      const off = CORNER_OFFSETS[k];
      if (!off) throw new Error(`BUG: missing corner offset ${k}`);
      const x = round3(c.x + off.x);
      const y = round3(c.y + off.y);
      const key = `${x},${y}`;
      let t = vertexKeyToTemp.get(key);
      if (t === undefined) {
        t = tempVerts.length;
        vertexKeyToTemp.set(key, t);
        tempVerts.push({ x, y, hexes: [] });
      }
      const tv = tempVerts[t];
      if (!tv) throw new Error('BUG: missing temp vertex');
      tv.hexes.push(hi);
      row.push(t);
    }
    cornerTempVert.push(row);
  });

  // §1.2 step 4: vertices sorted by (y, x) → VertexId = index.
  const vertOrder = tempVerts
    .map((_, i) => i)
    .sort((i, j) => {
      const vi = tempVerts[i];
      const vj = tempVerts[j];
      if (!vi || !vj) throw new Error('BUG: missing temp vertex in sort');
      return vi.y - vj.y || vi.x - vj.x;
    });
  const tempToVert: number[] = new Array<number>(tempVerts.length);
  vertOrder.forEach((t, finalId) => {
    tempToVert[t] = finalId;
  });

  // §1.2 step 3: each hex's adjacent corner pairs are edges; dedupe by endpoint pair.
  const edgeKeyToTemp = new Map<string, number>();
  const tempEdges: { a: number; b: number; hexes: number[]; angleDeg: number }[] = [];
  const hexTempEdges: number[][] = [];
  hexCoords.forEach((_, hi) => {
    const cornerRow = cornerTempVert[hi];
    if (!cornerRow) throw new Error(`BUG: missing corners for hex ${hi}`);
    const row: number[] = [];
    for (let k = 0; k < 6; k++) {
      const t1 = cornerRow[k];
      const t2 = cornerRow[(k + 1) % 6];
      if (t1 === undefined || t2 === undefined) throw new Error('BUG: missing corner');
      const v1 = tempToVert[t1];
      const v2 = tempToVert[t2];
      if (v1 === undefined || v2 === undefined) throw new Error('BUG: unmapped corner vertex');
      const a = Math.min(v1, v2);
      const b = Math.max(v1, v2);
      const key = `${a},${b}`;
      let t = edgeKeyToTemp.get(key);
      if (t === undefined) {
        t = tempEdges.length;
        edgeKeyToTemp.set(key, t);
        // Orientation is exact from the corner index: the chord from corner k to
        // corner k+1 points at 30° + 60°·k (mod 180) — 30/90/150, no float trig.
        tempEdges.push({ a, b, hexes: [], angleDeg: (30 + 60 * k) % 180 });
      }
      const te = tempEdges[t];
      if (!te) throw new Error('BUG: missing temp edge');
      te.hexes.push(hi);
      row.push(t);
    }
    hexTempEdges.push(row);
  });

  // §1.2 step 4: edges sorted by their (already-sorted) endpoint pair → EdgeId = index.
  const edgeOrder = tempEdges
    .map((_, i) => i)
    .sort((i, j) => {
      const ei = tempEdges[i];
      const ej = tempEdges[j];
      if (!ei || !ej) throw new Error('BUG: missing temp edge in sort');
      return ei.a - ej.a || ei.b - ej.b;
    });
  const tempToEdge: number[] = new Array<number>(tempEdges.length);
  edgeOrder.forEach((t, finalId) => {
    tempToEdge[t] = finalId;
  });

  // Final tables.
  const vertices: GeometryVertex[] = vertOrder.map((t, id) => {
    const v = tempVerts[t];
    if (!v) throw new Error('BUG: missing temp vertex at assembly');
    return {
      id: id as VertexId,
      x: v.x,
      y: v.y,
      hexes: v.hexes.map((h) => h as HexId), // pushed in ascending hex order
      edges: [] as EdgeId[],
      neighbors: [] as VertexId[],
    };
  });

  const edges: GeometryEdge[] = edgeOrder.map((t, id) => {
    const e = tempEdges[t];
    if (!e) throw new Error('BUG: missing temp edge at assembly');
    const va = vertices[e.a];
    const vb = vertices[e.b];
    if (!va || !vb) throw new Error('BUG: edge endpoint out of range');
    return {
      id: id as EdgeId,
      a: e.a as VertexId,
      b: e.b as VertexId,
      hexes: e.hexes.map((h) => h as HexId),
      x: round3((va.x + vb.x) / 2),
      y: round3((va.y + vb.y) / 2),
      angleDeg: e.angleDeg,
    };
  });

  // Incidence lists: ascending EdgeId per vertex, neighbors aligned with edges.
  for (const e of edges) {
    const va = vertices[e.a];
    const vb = vertices[e.b];
    if (!va || !vb) throw new Error('BUG: edge endpoint out of range');
    va.edges.push(e.id);
    va.neighbors.push(e.b);
    vb.edges.push(e.id);
    vb.neighbors.push(e.a);
  }

  const hexes: GeometryHex[] = hexCoords.map((hc, hi) => {
    const c = centers[hi];
    const cornerRow = cornerTempVert[hi];
    const edgeRow = hexTempEdges[hi];
    if (!c || !cornerRow || !edgeRow) throw new Error(`BUG: missing hex data ${hi}`);
    return {
      id: hi as HexId,
      q: hc.q,
      r: hc.r,
      x: round3(c.x),
      y: round3(c.y),
      vertices: cornerRow.map((t) => {
        const v = tempToVert[t];
        if (v === undefined) throw new Error('BUG: unmapped hex corner');
        return v as VertexId;
      }),
      edges: edgeRow.map((t) => {
        const e = tempToEdge[t];
        if (e === undefined) throw new Error('BUG: unmapped hex edge');
        return e as EdgeId;
      }),
    };
  });

  const coastEdges = orderCoastClockwise(edges, vertices);
  const harborSpots = layout.harborCoastIndices.map((i) => {
    const e = coastEdges[i];
    if (e === undefined) throw new Error(`BUG: harborCoastIndices out of range: ${i}`);
    return e;
  });
  const hexSpiralOrder = computeSpiralOrder(hexCoords, layout.spiralStart);

  return deepFreeze({ hexes, vertices, edges, coastEdges, harborSpots, hexSpiralOrder });
}

// ---------------------------------------------------------------------------
// Base layout & convenience constant
// ---------------------------------------------------------------------------

/** All (q, r) with max(|q|, |r|, |q+r|) ≤ radius — the standard hexagonal board shape. */
function hexagonHexes(radius: number): { q: number; r: number }[] {
  const out: { q: number; r: number }[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= radius) out.push({ q, r });
    }
  }
  return out;
}

/** The standard 19-hex board (docs/03 §1.1); harbors per D-016; spiral starts at (0,−2). */
export const BASE_LAYOUT: BoardLayout = deepFreeze({
  hexes: hexagonHexes(2),
  harborCoastIndices: [0, 3, 6, 10, 13, 16, 20, 23, 26], // D-016
  spiralStart: { q: 0, r: -2 },
});

/** Base-board geometry, built once at module load. Deep-frozen. */
export const GEOMETRY: BoardGeometry = buildGeometry(BASE_LAYOUT);

// ---------------------------------------------------------------------------
// 5–6 Player Extension layout (docs/10 §4, docs/rules/fivesix-rules.md X1)
// ---------------------------------------------------------------------------

/**
 * The 30 axial coordinates of the 5–6 board: a radius-3 hexagon (37 hexes) with the
 * leftmost hex of each row removed → the official 3-4-5-6-5-4-3 row profile (30 hexes),
 * symmetric about the r=0 axis. Verified to build a single simple coastline
 * (80 vertices, 109 edges, 38 coastal edges) via buildGeometry.
 */
function ext56Hexes(): { q: number; r: number }[] {
  const ranges: Record<number, [number, number]> = {
    [-3]: [1, 3],
    [-2]: [0, 3],
    [-1]: [-1, 3],
    [0]: [-2, 3],
    [1]: [-2, 2],
    [2]: [-2, 1],
    [3]: [-2, 0],
  };
  const out: { q: number; r: number }[] = [];
  for (let r = -3; r <= 3; r++) {
    const range = ranges[r];
    if (!range) throw new Error(`BUG: no EXT56 range for row ${r}`);
    for (let q = range[0]; q <= range[1]; q++) out.push({ q, r });
  }
  return out;
}

/**
 * The 5–6 Player Extension board (30 hexes). Harbor positions are spread ~evenly over the
 * 38 coastal edges (D-016 precedent: gameplay-equivalent, exact printed frame is a stretch
 * verification). `spiralStart` is the top-right corner hex (3,−3), matching the rulebook's
 * "place A on a corner, spiral counter-clockwise inward" example.
 */
export const EXT56_LAYOUT: BoardLayout = deepFreeze({
  hexes: ext56Hexes(),
  harborCoastIndices: [0, 3, 7, 10, 14, 17, 21, 24, 28, 31, 35], // 11 spots over 38 coast edges
  spiralStart: { q: 3, r: -3 },
});

/** 5–6 board geometry, built once at module load. Deep-frozen. */
export const GEOMETRY_EXT56: BoardGeometry = buildGeometry(EXT56_LAYOUT);

// ---------------------------------------------------------------------------
// Lookup helpers — thin accessors over the tables (docs/03 §1.3).
// Default to the base GEOMETRY; pass an explicit geometry for other layouts.
// ---------------------------------------------------------------------------

function vertexAt(v: VertexId, g: BoardGeometry): GeometryVertex {
  const vert = g.vertices[v];
  if (!vert) throw new Error(`BUG: unknown vertex id ${v}`);
  return vert;
}

function edgeAt(e: EdgeId, g: BoardGeometry): GeometryEdge {
  const edge = g.edges[e];
  if (!edge) throw new Error(`BUG: unknown edge id ${e}`);
  return edge;
}

function hexAt(h: HexId, g: BoardGeometry): GeometryHex {
  const hex = g.hexes[h];
  if (!hex) throw new Error(`BUG: unknown hex id ${h}`);
  return hex;
}

/** Hexes touching a vertex (1–3). */
export function vertexAdjacentHexes(v: VertexId, geometry: BoardGeometry = GEOMETRY): HexId[] {
  return vertexAt(v, geometry).hexes;
}

/** Vertices one edge away from a vertex (2–3), aligned with vertexEdges(v). */
export function vertexAdjacentVertices(
  v: VertexId,
  geometry: BoardGeometry = GEOMETRY
): VertexId[] {
  return vertexAt(v, geometry).neighbors;
}

/** Edges incident to a vertex (2–3), ascending. */
export function vertexEdges(v: VertexId, geometry: BoardGeometry = GEOMETRY): EdgeId[] {
  return vertexAt(v, geometry).edges;
}

/** The two endpoints of an edge, as [a, b] with a < b. */
export function edgeEndpoints(e: EdgeId, geometry: BoardGeometry = GEOMETRY): [VertexId, VertexId] {
  const edge = edgeAt(e, geometry);
  return [edge.a, edge.b];
}

/** The 6 edges of a hex, in corner order (edge k joins corners k and k+1). */
export function edgesOfHex(h: HexId, geometry: BoardGeometry = GEOMETRY): EdgeId[] {
  return hexAt(h, geometry).edges;
}

/** The 6 corner vertices of a hex, in corner order N, NE, SE, S, SW, NW. */
export function verticesOfHex(h: HexId, geometry: BoardGeometry = GEOMETRY): VertexId[] {
  return hexAt(h, geometry).vertices;
}
