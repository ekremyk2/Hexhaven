// Tests for T-1505's deterministic per-hex model/rotation picks — pure math + string lookups, no
// react/three/DOM needed (same `environment: "node"` convention as `coords.test.ts`).
import { describe, expect, it } from 'vitest';
import type { EdgeId, ScenarioTerrain } from '@hexhaven/shared';
import {
  hasStlCoverage,
  hexModelHeight,
  hexYaw,
  modelHeight,
  pickHarborVariant,
  pickRotationStep,
  pickTerrainVariant,
  pickVariantIndex,
  TERRAIN_FOOTPRINT,
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
