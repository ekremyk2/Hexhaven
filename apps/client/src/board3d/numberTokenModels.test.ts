// Tests for T-1506's pure grid-clustering/value-mapping logic (`bin1D`, `clusterCentroidsIntoGrid`,
// `valueForCell`) — no STL file, no three.js geometry needed for these; plain {x,y} arrays exercise
// exactly the same code path `sliceNumberTokens` runs against the real asset's measured component
// centroids. `sliceNumberTokens` itself (the three.js weld/flood-fill/extract pipeline) is exercised
// against synthetic BufferGeometry fixtures separately below, mirroring `terrainStlModels.test.ts`'s
// `applyHeightBandVertexColors` tests (environment: "node", three's pure geometry math needs no DOM).
import { describe, expect, it } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import {
  bin1D,
  clusterCentroidsIntoGrid,
  GRID_GAP_THRESHOLD,
  MIRROR_COLUMNS,
  sliceNumberTokens,
  valueForCell,
  VALUE_GRID,
} from './numberTokenModels';

describe('bin1D', () => {
  it('buckets values within gapThreshold of each other into one bin, returning the mean', () => {
    const centers = bin1D([1, 1.5, 2, 30, 31], 8);
    expect(centers).toHaveLength(2);
    expect(centers[0]).toBeCloseTo((1 + 1.5 + 2) / 3, 6);
    expect(centers[1]).toBeCloseTo((30 + 31) / 2, 6);
  });

  it('a gap exactly at the threshold stays in the same bin (> threshold splits, not >=)', () => {
    const centers = bin1D([0, 8], 8);
    expect(centers).toHaveLength(1);
  });

  it('a gap just over the threshold splits into two bins', () => {
    const centers = bin1D([0, 8.01], 8);
    expect(centers).toHaveLength(2);
  });

  it('is order-independent (unsorted input gives the same bins as sorted)', () => {
    const a = bin1D([5, 1, 30, 2, 31], 8);
    const b = bin1D([1, 2, 5, 30, 31], 8);
    expect(a).toEqual(b);
  });

  it('handles a single value', () => {
    expect(bin1D([42], 8)).toEqual([42]);
  });

  it('handles an empty array', () => {
    expect(bin1D([], 8)).toEqual([]);
  });
});

describe('VALUE_GRID', () => {
  it('matches the exact layout the user supplied — row 0 is the 2-cell top row', () => {
    expect(VALUE_GRID[0]).toEqual([null, 12, 2, null]);
    expect(VALUE_GRID[1]).toEqual([4, 3, 4, 3]);
    expect(VALUE_GRID[2]).toEqual([5, 5, 6, 6]);
    expect(VALUE_GRID[3]).toEqual([9, 8, 9, 8]);
    expect(VALUE_GRID[4]).toEqual([10, 11, 10, 11]);
  });

  it('contains exactly the 18 physical base-game tokens (value -> count)', () => {
    const counts = new Map<number, number>();
    for (const row of VALUE_GRID) for (const v of row) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
    const expected: Record<number, number> = { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 };
    expect(Object.fromEntries(counts)).toEqual(expected);
  });

  it('valueForCell mirrors direct grid indexing, and null outside the grid', () => {
    expect(valueForCell(0, 1)).toBe(12);
    expect(valueForCell(0, 2)).toBe(2);
    expect(valueForCell(0, 0)).toBeNull();
    expect(valueForCell(4, 3)).toBe(11);
    expect(valueForCell(99, 99)).toBeNull();
  });
});

/** Builds a synthetic set of component centroids shaped like the REAL measured sheet: 5 rows along Y
 *  (one row — the anchor — with only 2 columns, the rest with all 4), spaced well past
 *  `GRID_GAP_THRESHOLD` so `bin1D` cleanly separates every row/column, with `piecesPerCell` centroids
 *  jittered slightly around each cell's nominal center (mimicking "digit + several pip" pieces
 *  landing near, but not exactly on, one point). */
function syntheticSheetCentroids(opts: {
  anchorAtMaxY: boolean;
  piecesPerCell?: number;
  rowPitch?: number;
  colPitch?: number;
}) {
  const { anchorAtMaxY, piecesPerCell = 3, rowPitch = 28, colPitch = 30 } = opts;
  const rowYs = [0, 1, 2, 3, 4].map((r) => r * rowPitch);
  const colXs = [0, 1, 2, 3].map((c) => c * colPitch);
  const anchorRowIndex = anchorAtMaxY ? 4 : 0;
  const centroids: { x: number; y: number }[] = [];
  for (let r = 0; r < 5; r++) {
    const cols = r === anchorRowIndex ? [1, 2] : [0, 1, 2, 3];
    for (const c of cols) {
      for (let p = 0; p < piecesPerCell; p++) {
        // small jitter, well within one cell but never exactly on the nominal center.
        centroids.push({ x: colXs[c]! + (p - 1) * 2, y: rowYs[r]! + (p - 1) * 1.5 });
      }
    }
  }
  return centroids;
}

describe('clusterCentroidsIntoGrid', () => {
  it('groups every synthetic piece into exactly the 18 expected grid cells (anchor at max Y)', () => {
    const centroids = syntheticSheetCentroids({ anchorAtMaxY: true });
    const cells = clusterCentroidsIntoGrid(centroids, GRID_GAP_THRESHOLD);
    expect(cells).toHaveLength(centroids.length);
    const uniqueCells = new Set(cells.map((c) => `${c.row},${c.col}`));
    expect(uniqueCells.size).toBe(18);
    // Every resolved cell must be non-empty in VALUE_GRID (no piece lands in an outer top-row slot).
    for (const cell of cells) expect(valueForCell(cell.row, cell.col)).not.toBeNull();
  });

  it('self-determines row order regardless of which physical Y extreme the anchor sits at', () => {
    const rowPitch = 28;
    for (const anchorAtMaxY of [true, false]) {
      const centroids = syntheticSheetCentroids({ anchorAtMaxY, rowPitch });
      const cells = clusterCentroidsIntoGrid(centroids, GRID_GAP_THRESHOLD);
      const anchorY = (anchorAtMaxY ? 4 : 0) * rowPitch;
      // Every centroid whose nominal Y is the anchor row's must resolve to grid row 0, regardless of
      // whether that row sits at the physical Y maximum or minimum of the sheet.
      const anchorRows = new Set(
        centroids.map((c, i) => (Math.abs(c.y - anchorY) < rowPitch / 2 ? cells[i]!.row : -1)).filter((r) => r !== -1),
      );
      expect(anchorRows).toEqual(new Set([0]));
      // And the row furthest from the anchor is always grid row 4.
      const farY = (anchorAtMaxY ? 0 : 4) * rowPitch;
      const farRows = new Set(
        centroids.map((c, i) => (Math.abs(c.y - farY) < rowPitch / 2 ? cells[i]!.row : -1)).filter((r) => r !== -1),
      );
      expect(farRows).toEqual(new Set([4]));
    }
  });

  it('MIRROR_COLUMNS is false by default (ascending sheet-X reads left-to-right, unflipped)', () => {
    expect(MIRROR_COLUMNS).toBe(false);
  });

  it('an empty input produces an empty output', () => {
    expect(clusterCentroidsIntoGrid([], GRID_GAP_THRESHOLD)).toEqual([]);
  });
});

// --- sliceNumberTokens: exercised against a full synthetic 18-cell sheet -----------------------
// Not the real STL (that's exercised live at runtime) — a synthetic sheet SHAPED like the real one
// (5 rows, one 2-column anchor row, four 4-column rows, uniform pitch) proves the weld -> flood-fill
// -> cluster -> extract -> place pipeline runs end-to-end and lands the right value on the right
// cell, without loading the actual asset.

/** A dense fan (`rim` + 1 unique welded vertices) — a plain 2-triangle quad only welds to 4 unique
 *  vertices, under `NOISE_VERTEX_THRESHOLD` (8), which this module's real debris filter would
 *  (correctly) discard as noise; a fan gives enough distinct vertices to clear it. */
function denseFanAt(cx: number, cy: number, radius: number, z: number, rim = 10): number[] {
  const positions: number[] = [];
  for (let i = 0; i < rim; i++) {
    const a0 = (i / rim) * Math.PI * 2;
    const a1 = ((i + 1) / rim) * Math.PI * 2;
    positions.push(cx, cy, z);
    positions.push(cx + radius * Math.cos(a0), cy + radius * Math.sin(a0), z);
    positions.push(cx + radius * Math.cos(a1), cy + radius * Math.sin(a1), z);
  }
  return positions;
}

/** Builds a full 18-cell synthetic sheet matching `VALUE_GRID`'s own shape (row 0 = 2 cells at
 *  columns 1/2, rows 1-4 = all 4 columns), one dense fan per cell, at `rowPitch`/`colPitch` spacing —
 *  well past `GRID_GAP_THRESHOLD` so every cell resolves to its own row/col bucket. */
function syntheticSheetGeometry(rowPitch = 28, colPitch = 30): BufferGeometry {
  const positions: number[] = [];
  for (let row = 0; row < 5; row++) {
    const cols = row === 0 ? [1, 2] : [0, 1, 2, 3];
    for (const col of cols) {
      positions.push(...denseFanAt(col * colPitch, row * rowPitch, 5, 0));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

describe('sliceNumberTokens (synthetic 18-cell fixture)', () => {
  it('produces exactly the 10 distinct token values VALUE_GRID defines', () => {
    const sliced = sliceNumberTokens(syntheticSheetGeometry());
    const values = [...sliced.keys()].sort((a, b) => a - b);
    expect(values).toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
  });

  it('every produced geometry has a non-empty position attribute', () => {
    const sliced = sliceNumberTokens(syntheticSheetGeometry());
    for (const [, geo] of sliced) {
      const position = geo.getAttribute('position');
      expect(position).toBeDefined();
      expect(position.count).toBeGreaterThan(0);
    }
  });

  it('each placed geometry is centered near its own local origin (placeTokenGeometry recentered it)', () => {
    const sliced = sliceNumberTokens(syntheticSheetGeometry());
    for (const [, geo] of sliced) {
      geo.computeBoundingBox();
      const center = geo.boundingBox!.getCenter(new Vector3());
      expect(Math.abs(center.x)).toBeLessThan(1);
      expect(Math.abs(center.z)).toBeLessThan(1);
    }
  });

  it('an empty/degenerate geometry slices to an empty map, never throws', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array([]), 3));
    expect(() => sliceNumberTokens(geometry)).not.toThrow();
    expect(sliceNumberTokens(geometry).size).toBe(0);
  });
});
