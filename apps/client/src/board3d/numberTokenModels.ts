// T-1506 — 3D socket number-token inserts. The user supplied ONE STL containing all 18 base-game
// number-token faces laid out on a flat sheet (`models/opt/number-tokens.stl`, ~9.5k tris, no
// decimation needed — see `apps/client/scripts/optimize-models.mjs`'s header for the raw->opt
// pipeline this asset skips because it's already light). This module slices that sheet into 18
// per-value `BufferGeometry`s, ONCE, so `NumberTokenInsert3D.tsx` can mount the right value's mesh at
// an STL-terrain hex's sculpted socket recess instead of `NumberToken3D`'s flat billboard.
//
// Measured off the real asset (not guessed): the sheet has NO surrounding disc/puck geometry at all —
// each grid cell is just a raised digit + pip-dot relief (the disc/socket shape lives in the terrain
// model itself). Because of that, this module deliberately does NOT reuse `stlModels.ts`'s
// `normalizeStlGeometry` (which fits EACH model independently to a shared target footprint — correct
// when every model is its own separate file at its own scale, wrong here: all 18 tokens are cut from
// ONE sheet at ONE scale, and fitting each cell's bounding box independently would blow a narrow "1"
// up to match a wide "11", destroying their relative proportions). Every token here is scaled by the
// SAME single factor instead (`sliceNumberTokens`'s `scale`, derived from the sheet's own measured
// grid pitch), preserving the sheet's original relative sizing.
//
// Slicing pipeline:
//  1. Weld coincident vertices (`mergeVertices`) so triangles sharing a stroke/dot edge actually
//     share vertex INDICES — a raw STL duplicates every vertex per face, so flood-fill over the
//     as-parsed geometry would never find any connectivity at all.
//  2. Flood-fill the welded topology into connected components. MEASURED RESULT: this is NOT 18
//     components. Each digit character and each pip dot is its own disconnected island (token "12" is
//     2 digit components + 1 pip component; token "6" is 1 digit + 5 pip components), AND the sheet
//     carries ~2500 near-degenerate debris islands (1-2 triangle stray fragments — ordinary STL-export
//     noise) alongside the ~150 real glyph/pip pieces. `NOISE_VERTEX_THRESHOLD` drops the debris by
//     welded-vertex count (measured: every real glyph/pip piece has >= 8-9 welded vertices; every
//     debris fragment has far fewer).
//  3. Cluster the surviving real components' centroids into a grid (`clusterCentroidsIntoGrid`, pure
//     — no three.js — so it's unit-tested directly against plain {x,y} arrays; see
//     numberTokenModels.test.ts). One axis has a bucket with only 2 members (matches the grid's own
//     top row, "12"/"2", the only row with just the two middle cells) — MEASURED to sit at that axis's
//     own extreme, which is what lets the row order self-determine (see that function's doc) instead
//     of needing a guessed "which end is top" flag.
//  4. Assign each grid cell its Catan token value via `VALUE_GRID`, merge that cell's component(s)
//     into one flat triangle-soup `BufferGeometry`, and re-center/rotate/scale it into the app's Y-up
//     placement convention (`placeTokenGeometry`).
//
// TUNABLE / TO VERIFY ON :8080 (the user's eyes, not this sandbox — see task doc):
//  - `MIRROR_COLUMNS` — flips left/right column assignment across the WHOLE grid. The clearest way to
//    check this: token "2" and "12" are UNIQUE (each appears on exactly one physical token) — if they
//    land on the wrong hexes (swapped with each other, which only happens if the column read is
//    reversed), flip this.
//  - `WELD_TOLERANCE`, `NOISE_VERTEX_THRESHOLD`, `GRID_GAP_THRESHOLD` — measured against the shipped
//    asset (see comments at each), should not need retuning unless the STL is replaced.
//  - `TOKEN_INSERT_DIAMETER` — this module's own sheet-relative sizing; `constants.ts`'s
//    `TOKEN_SOCKET_SCALE` is the easier day-to-day dial, kept separate on purpose.
import { BufferGeometry, Float32BufferAttribute, Vector3, type BufferAttribute } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import numberTokensUrl from './models/opt/number-tokens.stl?url';
import { TOKEN_RADIUS } from './constants';

export { numberTokensUrl };

/** Plain (non-normalizing) loader — deliberately NOT one of `stlModels.ts`'s per-model-normalizing
 *  subclasses: this module needs the RAW sheet geometry (all 18 tokens, un-rotated, un-scaled) to
 *  slice, not a single model already fit to a target footprint. A stable module-level class (rather
 *  than one constructed per render) keeps `useLoader`'s `(Proto, url)` cache key stable across
 *  renders — same rationale as every other loader subclass in this directory. */
export class NumberTokenSheetSTLLoader extends STLLoader {}

// --- Pure grid-mapping (no three.js) — unit-tested directly ----------------------------------------

export interface Centroid2D {
  x: number;
  y: number;
}

export interface GridCell {
  row: number;
  col: number;
}

/** Gap (in the sheet's own raw units) above which two sorted axis values are treated as belonging to
 *  DIFFERENT grid rows/columns rather than the same one — measured off the real asset: row/column
 *  pitch is ~27-30 units, individual glyph/pip pieces within one cell spread across at most ~15 units,
 *  so this comfortably separates cells without merging adjacent ones. */
export const GRID_GAP_THRESHOLD = 8;

/** Sorts `values`, then greedily buckets consecutive values into groups whenever the gap to the next
 *  value exceeds `gapThreshold` — returns each bucket's mean as that bucket's "center". Values need
 *  not be unique or pre-sorted; used to find a sheet axis's row/column centers from many components'
 *  centroids (several components legitimately share the same row/column). */
export function bin1D(values: readonly number[], gapThreshold: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const bins: number[][] = [];
  let current: number[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i]!;
    if (v - current[current.length - 1]! > gapThreshold) {
      bins.push(current);
      current = [v];
    } else {
      current.push(v);
    }
  }
  bins.push(current);
  return bins.map((bin) => bin.reduce((a, c) => a + c, 0) / bin.length);
}

function nearestBinIndex(value: number, centers: readonly number[]): number {
  let best = 0;
  let bestDist = Infinity;
  centers.forEach((c, i) => {
    const d = Math.abs(value - c);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/** Flips column order left<->right — the one genuinely unresolvable ambiguity (see module doc):
 *  whether ascending sheet-X reads left-to-right in the STL's authored orientation. USER-TUNABLE —
 *  flip if "2"/"12" (the two unique-value tokens) land mirrored. */
export const MIRROR_COLUMNS = false;

/** Clusters raw component centroids into `{row, col}` grid cells. Row axis is ALWAYS the sheet's Y
 *  (measured: only Y has a bucket with a distinctly smaller member count than the others — the
 *  grid's 2-cell top row; X's 4 buckets are all roughly equal-sized) and row ORDER self-determines
 *  from that same asymmetry: whichever axis extreme (first or last row-bucket, by sheet-Y) has fewer
 *  distinct columns represented is `VALUE_GRID`'s row 0 (the "12"/"2" row) — since that row sits at an
 *  axis EXTREME rather than the middle, moving away from it has only one possible direction, so the
 *  rest of the row order follows with no additional guesswork/flag needed. Column order is ascending
 *  sheet-X (left-to-right), mirrored by `MIRROR_COLUMNS` if that guess is wrong. */
export function clusterCentroidsIntoGrid(
  centroids: readonly Centroid2D[],
  gapThreshold: number = GRID_GAP_THRESHOLD,
): GridCell[] {
  const rowCenters = bin1D(centroids.map((c) => c.y), gapThreshold);
  const colCenters = bin1D(centroids.map((c) => c.x), gapThreshold);
  const rawRows = centroids.map((c) => nearestBinIndex(c.y, rowCenters));
  const rawCols = centroids.map((c) => nearestBinIndex(c.x, colCenters));

  const colsPerRawRow = new Map<number, Set<number>>();
  rawRows.forEach((rawRow, i) => {
    if (!colsPerRawRow.has(rawRow)) colsPerRawRow.set(rawRow, new Set());
    colsPerRawRow.get(rawRow)!.add(rawCols[i]!);
  });
  const rowCount = rowCenters.length;
  const firstRowSize = colsPerRawRow.get(0)?.size ?? 0;
  const lastRowSize = colsPerRawRow.get(rowCount - 1)?.size ?? 0;
  // The anchor (VALUE_GRID row 0) is whichever extreme has FEWER distinct columns — true for the
  // shipped asset regardless of which physical direction the STL's Y axis happens to point.
  const anchorAtStart = firstRowSize <= lastRowSize;

  return centroids.map((_, i) => {
    const row = anchorAtStart ? rawRows[i]! : rowCount - 1 - rawRows[i]!;
    const rawCol = rawCols[i]!;
    const col = MIRROR_COLUMNS ? colCenters.length - 1 - rawCol : rawCol;
    return { row, col };
  });
}

/** The physical base-game token sheet, row 0 = top (the only row with just the 2 middle cells),
 *  column 0 = left. `null` = an empty grid cell (the two outer top-row slots). Matches the exact
 *  layout the user gave (T-1506 task doc). */
export const VALUE_GRID: ReadonlyArray<ReadonlyArray<number | null>> = [
  [null, 12, 2, null],
  [4, 3, 4, 3],
  [5, 5, 6, 6],
  [9, 8, 9, 8],
  [10, 11, 10, 11],
];

export function valueForCell(row: number, col: number): number | null {
  return VALUE_GRID[row]?.[col] ?? null;
}

// --- Geometry slicing (three.js) -------------------------------------------------------------------

/** Weld tolerance for `mergeVertices` — the sheet's own units are large (grid pitch ~28-30 units), so
 *  this only needs to be tight enough to not falsely merge genuinely distinct nearby vertices, which
 *  1e-3 comfortably is (three's own default is 1e-4; loosened slightly since STL binary export only
 *  keeps float32 precision, measured to weld cleanly on the shipped asset without over-merging). */
export const WELD_TOLERANCE = 1e-3;

/** Welded-vertex-count floor a connected component must clear to be treated as a real glyph/pip piece
 *  rather than STL-export debris (measured: the shipped sheet's real pieces all have >= ~9 welded
 *  vertices; ~2500 stray 1-2 triangle fragments sit well below this). */
export const NOISE_VERTEX_THRESHOLD = 8;

/** Target world-diameter (before `constants.ts`'s `TOKEN_SOCKET_SCALE`) a token's digit+pip cluster
 *  normalizes to — smaller than the OLD billboard's full disc (`TOKEN_RADIUS * 2`) since, per this
 *  module's doc, the sheet has no surrounding disc of its own; the socket recess in the terrain model
 *  supplies that. USER-CALIBRATED STARTING GUESS. */
export const TOKEN_INSERT_DIAMETER = TOKEN_RADIUS * 1.5;

interface TokenComponent {
  vertexIndices: number[];
  centroid: Vector3;
}

/** Welds `rawGeometry` and flood-fills it into connected components, discarding anything under
 *  `NOISE_VERTEX_THRESHOLD` welded vertices (see module doc on why that filter is needed at all).
 *  Returns the welded (indexed) geometry alongside the surviving components — callers extract each
 *  cell's triangles back out of `merged` via `TokenComponent.vertexIndices`. */
function weldAndFindComponents(
  rawGeometry: BufferGeometry,
  weldTolerance: number,
  noiseThreshold: number,
): { merged: BufferGeometry; components: TokenComponent[] } {
  const merged = mergeVertices(rawGeometry.clone(), weldTolerance);
  const index = merged.index;
  const position = merged.getAttribute('position') as BufferAttribute;
  if (!index || !position) return { merged, components: [] }; // defensive: a degenerate/empty sheet.

  const vertexCount = position.count;
  const adjacency: Array<Set<number>> = Array.from({ length: vertexCount }, () => new Set());
  const idxArr = index.array;
  for (let i = 0; i < idxArr.length; i += 3) {
    const a = idxArr[i]!;
    const b = idxArr[i + 1]!;
    const c = idxArr[i + 2]!;
    adjacency[a]!.add(b);
    adjacency[a]!.add(c);
    adjacency[b]!.add(a);
    adjacency[b]!.add(c);
    adjacency[c]!.add(a);
    adjacency[c]!.add(b);
  }

  const visited = new Uint8Array(vertexCount);
  const components: TokenComponent[] = [];
  for (let start = 0; start < vertexCount; start++) {
    if (visited[start]) continue;
    const stack = [start];
    visited[start] = 1;
    const members: number[] = [start];
    while (stack.length > 0) {
      const v = stack.pop()!;
      for (const n of adjacency[v]!) {
        if (!visited[n]) {
          visited[n] = 1;
          stack.push(n);
          members.push(n);
        }
      }
    }
    if (members.length < noiseThreshold) continue; // debris fragment — discard.
    const centroid = new Vector3();
    for (const v of members) centroid.add(new Vector3(position.getX(v), position.getY(v), position.getZ(v)));
    centroid.divideScalar(members.length);
    components.push({ vertexIndices: members, centroid });
  }
  return { merged, components };
}

/** Builds a flat (non-indexed) triangle-soup geometry containing exactly the triangles whose 3 welded
 *  vertices all belong to one of `cellComponents` — every triangle in a welded mesh has all 3 vertices
 *  in the SAME connected component (that's what connectivity means), so this membership test never
 *  needs to split a triangle across cells. */
function extractCellGeometry(merged: BufferGeometry, cellComponents: readonly TokenComponent[]): BufferGeometry {
  const position = merged.getAttribute('position') as BufferAttribute;
  const index = merged.index!;
  const idxArr = index.array;
  const inCell = new Set<number>();
  for (const comp of cellComponents) for (const v of comp.vertexIndices) inCell.add(v);

  const positions: number[] = [];
  for (let i = 0; i < idxArr.length; i += 3) {
    const a = idxArr[i]!;
    const b = idxArr[i + 1]!;
    const c = idxArr[i + 2]!;
    if (inCell.has(a) && inCell.has(b) && inCell.has(c)) {
      positions.push(position.getX(a), position.getY(a), position.getZ(a));
      positions.push(position.getX(b), position.getY(b), position.getZ(b));
      positions.push(position.getX(c), position.getY(c), position.getZ(c));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

/** Centers a cell's extracted geometry on its OWN centroid, remaps the sheet's Z-up thickness axis to
 *  the app's Y-up "sits at y=0, up is +Y" convention (`stlModels.ts`'s `normalizeStlGeometry` does the
 *  same `rotateX(-90deg)` remap; duplicated here rather than reused because that function also FITS
 *  the model to a target size independently, which this module deliberately does NOT do per-piece —
 *  see module doc), and applies `scale` (the SAME factor for every token, computed once in
 *  `sliceNumberTokens`, not per-piece). Mutates and returns `geometry`. */
function placeTokenGeometry(geometry: BufferGeometry, centroidX: number, centroidY: number, scale: number): BufferGeometry {
  geometry.translate(-centroidX, -centroidY, 0);
  geometry.rotateX(-Math.PI / 2); // old +Z (thickness) -> new +Y (up); old Y (centered) -> new -Z.
  geometry.scale(scale, scale, scale);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** The sheet's own row/column pitch (mean gap between adjacent bucket centers, averaged over both
 *  axes) — the "how big is one grid cell, in the sheet's own raw units" measurement `sliceNumberTokens`
 *  scales against to land every token at `TOKEN_INSERT_DIAMETER` world units, independent of the raw
 *  STL's arbitrary export units. */
function measureCellPitch(centroids: readonly Centroid2D[], gapThreshold: number): number {
  const rowCenters = bin1D(centroids.map((c) => c.y), gapThreshold);
  const colCenters = bin1D(centroids.map((c) => c.x), gapThreshold);
  const gaps: number[] = [];
  for (let i = 1; i < rowCenters.length; i++) gaps.push(rowCenters[i]! - rowCenters[i - 1]!);
  for (let i = 1; i < colCenters.length; i++) gaps.push(colCenters[i]! - colCenters[i - 1]!);
  if (gaps.length === 0) return 1; // defensive: a degenerate sheet with < 2 rows/cols of pieces.
  return gaps.reduce((a, c) => a + c, 0) / gaps.length;
}

/** The one-time slicing entry point: raw loaded sheet geometry -> value -> placed, scaled, Y-up
 *  `BufferGeometry` ready to mount directly on a `<mesh>`. Callers (`NumberTokenInsert3D.tsx`) MUST
 *  cache this by the loaded geometry's identity (`getSlicedNumberTokenGeometries`, below) rather than
 *  calling it per-render/per-hex — welding + flood-fill over ~14k vertices is one-time work, not
 *  frame-budget work. */
export function sliceNumberTokens(rawGeometry: BufferGeometry): Map<number, BufferGeometry> {
  const { merged, components } = weldAndFindComponents(rawGeometry, WELD_TOLERANCE, NOISE_VERTEX_THRESHOLD);
  if (components.length === 0) return new Map();

  const centroids2D = components.map((c) => ({ x: c.centroid.x, y: c.centroid.y }));
  const cells = clusterCentroidsIntoGrid(centroids2D);
  const pitch = measureCellPitch(centroids2D, GRID_GAP_THRESHOLD);
  const scale = pitch > 1e-6 ? TOKEN_INSERT_DIAMETER / pitch : 1;

  const byCell = new Map<string, TokenComponent[]>();
  cells.forEach((cell, i) => {
    const key = `${cell.row},${cell.col}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key)!.push(components[i]!);
  });

  const result = new Map<number, BufferGeometry>();
  for (const [key, cellComponents] of byCell) {
    const [rowStr, colStr] = key.split(',');
    const value = valueForCell(Number(rowStr), Number(colStr));
    if (value == null) continue; // an empty grid cell (shouldn't gather real pieces, defensive).
    if (result.has(value)) continue; // duplicate value already sliced — any instance is equally valid.

    const centroid = new Vector3();
    for (const comp of cellComponents) centroid.add(comp.centroid);
    centroid.divideScalar(cellComponents.length);

    const geometry = extractCellGeometry(merged, cellComponents);
    placeTokenGeometry(geometry, centroid.x, centroid.y, scale);
    result.set(value, geometry);
  }
  return result;
}

/** Module-scope cache keyed by the LOADED geometry object's identity — `useLoader(NumberTokenSheetSTLLoader,
 *  numberTokensUrl)` returns the same object to every hex instance (three's own url-keyed cache), so
 *  this WeakMap guarantees `sliceNumberTokens`'s weld+flood-fill work runs exactly once per app session
 *  no matter how many STL-terrain hexes mount a socket token. */
const slicedCache = new WeakMap<BufferGeometry, Map<number, BufferGeometry>>();

export function getSlicedNumberTokenGeometries(rawGeometry: BufferGeometry): Map<number, BufferGeometry> {
  const cached = slicedCache.get(rawGeometry);
  if (cached) return cached;
  const sliced = sliceNumberTokens(rawGeometry);
  slicedCache.set(rawGeometry, sliced);
  return sliced;
}
