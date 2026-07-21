// Tests for T-1505's deterministic per-hex model/rotation picks — pure math + string lookups, no
// react/three/DOM needed (same `environment: "node"` convention as `coords.test.ts`).
import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three';
import type { EdgeId, ScenarioTerrain } from '@hexhaven/shared';
import {
  applyHeightBandVertexColors,
  HARBOR_HEIGHT_BAND,
  hasStlCoverage,
  heightBandWeight,
  HEIGHT_BAND_BLEND_FRACTION,
  hexModelHeight,
  hexYaw,
  modelHeight,
  pickHarborVariant,
  pickRotationStep,
  pickTerrainVariant,
  pickVariantIndex,
  TERRAIN_FOOTPRINT,
  TERRAIN_HEIGHT_BAND,
  type HeightBandPalette,
} from './terrainStlModels';

const STL_TERRAINS: ScenarioTerrain[] = ['hills', 'forest', 'pasture', 'fields', 'mountains', 'desert', 'sea'];

describe('hasStlCoverage', () => {
  it('every terrain the user supplied a model for is covered', () => {
    for (const t of STL_TERRAINS) expect(hasStlCoverage(t)).toBe(true);
  });

  it('gold (Seafarers, no supplied model) is NOT covered — HexTiles falls back to the procedural prism', () => {
    expect(hasStlCoverage('gold')).toBe(false);
  });
});

describe('pickVariantIndex', () => {
  it('is deterministic — the same seed always returns the same index', () => {
    for (const seed of [0, 1, 2, 7, 41, 1000]) {
      expect(pickVariantIndex(seed, 3)).toBe(pickVariantIndex(seed, 3));
    }
  });

  it('always returns an index within [0, variantCount)', () => {
    for (const count of [1, 2, 3]) {
      for (let seed = 0; seed < 50; seed++) {
        const idx = pickVariantIndex(seed, count);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(count);
      }
    }
  });

  it('a single-variant terrain always picks index 0 (no division-by-nothing weirdness)', () => {
    for (let seed = 0; seed < 10; seed++) expect(pickVariantIndex(seed, 1)).toBe(0);
  });

  it('varies across at least some hex ids (not a constant function) when there are multiple variants', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 30; seed++) seen.add(pickVariantIndex(seed, 3));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('pickRotationStep', () => {
  it('is deterministic and always in [0, 6)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const step = pickRotationStep(seed);
      expect(step).toBe(pickRotationStep(seed));
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThan(6);
    }
  });

  it('is independent of pickVariantIndex — the two draws off the same seed are not forced equal', () => {
    // Not a strict guarantee for every seed, but across a spread of seeds the two sequences should
    // disagree somewhere (proves they're not accidentally the same hash/salt).
    let disagreement = false;
    for (let seed = 0; seed < 20; seed++) {
      if (pickRotationStep(seed) !== pickVariantIndex(seed, 6)) disagreement = true;
    }
    expect(disagreement).toBe(true);
  });
});

describe('hexYaw', () => {
  it('step 0 is the confirmed 30deg base orientation', () => {
    expect(hexYaw(0)).toBeCloseTo(Math.PI / 6, 12);
  });

  it('each step adds 60deg — the hexagon\'s own 6-fold symmetry', () => {
    for (let step = 0; step < 6; step++) {
      expect(hexYaw(step)).toBeCloseTo(Math.PI / 6 + step * (Math.PI / 3), 12);
    }
  });
});

describe('pickTerrainVariant / hexModelHeight', () => {
  it('returns undefined (no coverage) for gold, and 0 height', () => {
    expect(pickTerrainVariant('gold', 0)).toBeUndefined();
    expect(hexModelHeight('gold', 0)).toBe(0);
  });

  it('returns one of the terrain\'s own variant URLs for a covered terrain', () => {
    const variant = pickTerrainVariant('forest', 3);
    expect(variant).toBeDefined();
    expect(variant!.url).toMatch(/forest[123]?\.stl/i);
  });

  it('a single-variant terrain (desert) always returns that one variant', () => {
    const a = pickTerrainVariant('desert', 1);
    const b = pickTerrainVariant('desert', 999);
    expect(a!.url).toBe(b!.url);
  });

  it('hexModelHeight matches modelHeight(pickTerrainVariant(...)) exactly', () => {
    for (const terrain of STL_TERRAINS) {
      const variant = pickTerrainVariant(terrain, 5)!;
      expect(hexModelHeight(terrain, 5)).toBeCloseTo(modelHeight(variant), 12);
    }
  });

  it('modelHeight scales the measured heightRatio by TERRAIN_FOOTPRINT', () => {
    const variant = { url: 'x', heightRatio: 0.2 };
    expect(modelHeight(variant)).toBeCloseTo(TERRAIN_FOOTPRINT * 0.2, 12);
  });
});

describe('pickHarborVariant', () => {
  const HARBOR_URL_PATTERN = /harbor(Ship[123]|Lighthouse)\.stl/i;
  const eid = (n: number) => n as EdgeId;

  it('is deterministic per edge id', () => {
    for (const edgeId of [0, 1, 2, 10, 50]) {
      expect(pickHarborVariant(eid(edgeId)).url).toBe(pickHarborVariant(eid(edgeId)).url);
    }
  });

  it('always returns a known harbor model url', () => {
    for (let edgeId = 0; edgeId < 30; edgeId++) {
      expect(pickHarborVariant(eid(edgeId)).url).toMatch(HARBOR_URL_PATTERN);
    }
  });

  it('picks more than one distinct model across a range of edges (ship variety + occasional lighthouse)', () => {
    const seen = new Set<string>();
    for (let edgeId = 0; edgeId < 40; edgeId++) seen.add(pickHarborVariant(eid(edgeId)).url);
    expect(seen.size).toBeGreaterThan(1);
  });
});

// --- T-1505 polish: height-banded vertex colouring --------------------------------------------------

describe('heightBandWeight', () => {
  const HEIGHT = 100;
  const THRESHOLD = 0.4; // threshold Y = 40

  it('is fully base (weight 0) well below the threshold', () => {
    expect(heightBandWeight(0, HEIGHT, THRESHOLD)).toBe(0);
  });

  it('is fully feature (weight 1) well above the threshold', () => {
    expect(heightBandWeight(HEIGHT, HEIGHT, THRESHOLD)).toBe(1);
  });

  it('sits at the midpoint (weight 0.5) exactly at the threshold', () => {
    const thresholdY = THRESHOLD * HEIGHT;
    expect(heightBandWeight(thresholdY, HEIGHT, THRESHOLD)).toBeCloseTo(0.5, 6);
  });

  it('is monotonically non-decreasing as y rises (no reversal within the blend band)', () => {
    let prev = -Infinity;
    for (let y = 0; y <= HEIGHT; y += HEIGHT / 40) {
      const w = heightBandWeight(y, HEIGHT, THRESHOLD);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = w;
    }
  });

  it('stays within [0, 1] everywhere', () => {
    for (let y = -HEIGHT; y <= HEIGHT * 2; y += HEIGHT / 20) {
      const w = heightBandWeight(y, HEIGHT, THRESHOLD);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('a wider blend band spreads the transition further from the threshold', () => {
    const thresholdY = THRESHOLD * HEIGHT;
    const narrow = heightBandWeight(thresholdY + HEIGHT * 0.02, HEIGHT, THRESHOLD, 0.02);
    const wide = heightBandWeight(thresholdY + HEIGHT * 0.02, HEIGHT, THRESHOLD, 0.5);
    // Same offset above threshold: the wide band hasn't fully transitioned yet, the narrow one has.
    expect(narrow).toBeGreaterThan(wide);
  });

  it('a degenerate zero/negative model height reads as fully base, never NaN/divide-by-zero', () => {
    expect(heightBandWeight(5, 0, THRESHOLD)).toBe(0);
    expect(heightBandWeight(5, -1, THRESHOLD)).toBe(0);
  });

  it('the module default blend fraction is a small (soft, not abrupt) band', () => {
    expect(HEIGHT_BAND_BLEND_FRACTION).toBeGreaterThan(0);
    expect(HEIGHT_BAND_BLEND_FRACTION).toBeLessThan(0.5);
  });
});

describe('applyHeightBandVertexColors', () => {
  const PALETTE: HeightBandPalette = { base: '#000000', feature: '#ffffff', thresholdFraction: 0.5 };
  const MODEL_HEIGHT = 10;

  function geometryWithYs(ys: number[]): BufferGeometry {
    const geometry = new BufferGeometry();
    const positions = new Float32Array(ys.length * 3);
    ys.forEach((y, i) => {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;
    });
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return geometry;
  }

  // `getAttribute` types as `BufferAttribute | InterleavedBufferAttribute | GLBufferAttribute` for any
  // key — every attribute built by `geometryWithYs`/`applyHeightBandVertexColors` is a plain
  // `BufferAttribute`, so this cast is safe and is what lets `.getX()` type-check below.
  function colorAttr(geometry: BufferGeometry): BufferAttribute {
    return geometry.getAttribute('color') as BufferAttribute;
  }

  it('sets a color attribute with one RGB triple per vertex', () => {
    const geometry = geometryWithYs([0, 5, 10]);
    applyHeightBandVertexColors(geometry, MODEL_HEIGHT, PALETTE);
    const color = colorAttr(geometry);
    expect(color).toBeDefined();
    expect(color.count).toBe(3);
    expect(color.itemSize).toBe(3);
  });

  it('a vertex at y=0 gets (close to) the base colour; one at the model top gets the feature colour', () => {
    const geometry = geometryWithYs([0, MODEL_HEIGHT]);
    applyHeightBandVertexColors(geometry, MODEL_HEIGHT, PALETTE);
    const color = colorAttr(geometry);
    // base = black (0,0,0), feature = white (1,1,1).
    expect(color.getX(0)).toBeCloseTo(0, 2);
    expect(color.getX(1)).toBeCloseTo(1, 2);
  });

  it('is idempotent — a second call on a geometry that already has colours is a no-op', () => {
    const geometry = geometryWithYs([0, MODEL_HEIGHT]);
    applyHeightBandVertexColors(geometry, MODEL_HEIGHT, PALETTE);
    const first = colorAttr(geometry);
    // Call again with a wildly different palette — if the guard works, colours must NOT change.
    applyHeightBandVertexColors(geometry, MODEL_HEIGHT, { base: '#ff00ff', feature: '#00ff00', thresholdFraction: 0.1 });
    const second = colorAttr(geometry);
    expect(second).toBe(first); // same attribute object — never replaced.
    expect(second.getX(0)).toBeCloseTo(0, 2);
  });

  it('every terrain with a height-band palette has a threshold within (0, 1)', () => {
    for (const terrain of Object.keys(TERRAIN_HEIGHT_BAND) as ScenarioTerrain[]) {
      const palette = TERRAIN_HEIGHT_BAND[terrain]!;
      expect(palette.thresholdFraction).toBeGreaterThan(0);
      expect(palette.thresholdFraction).toBeLessThan(1);
    }
  });

  it('the harbour palette also has a threshold within (0, 1)', () => {
    expect(HARBOR_HEIGHT_BAND.thresholdFraction).toBeGreaterThan(0);
    expect(HARBOR_HEIGHT_BAND.thresholdFraction).toBeLessThan(1);
  });
});
