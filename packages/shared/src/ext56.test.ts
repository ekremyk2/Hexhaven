// T-601: the 5–6 Player Extension layout, geometry, and constants (docs/10 §4,
// docs/rules/fivesix-rules.md). The parametric geometry's second real consumer after BASE_LAYOUT.

import { describe, expect, it } from 'vitest';
import {
  EXT56_BANK_PER_RESOURCE,
  EXT56_DEV_DECK,
  EXT56_HARBOR_MIX,
  EXT56_LAYOUT,
  EXT56_TERRAIN_COUNTS,
  EXT56_TOKEN_SPIRAL,
  GEOMETRY_EXT56,
  buildGeometry,
} from './index.js';
import type { HarborType } from './index.js';

describe('EXT56_LAYOUT geometry (X1)', () => {
  const g = GEOMETRY_EXT56;

  it('is the 30-hex 3-4-5-6-5-4-3 board', () => {
    expect(EXT56_LAYOUT.hexes).toHaveLength(30);
    expect(g.hexes).toHaveLength(30);
    // Row (constant r) widths, top to bottom.
    const widthByRow = new Map<number, number>();
    for (const h of g.hexes) widthByRow.set(h.r, (widthByRow.get(h.r) ?? 0) + 1);
    const widths = [...widthByRow.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w);
    expect(widths).toEqual([3, 4, 5, 6, 5, 4, 3]);
  });

  it('has the expected vertex/edge/coast counts (single simple coastline)', () => {
    // buildGeometry throws if the coastline is not a simple cycle — reaching here proves it is.
    expect(g.vertices).toHaveLength(80);
    expect(g.edges).toHaveLength(109);
    expect(g.coastEdges).toHaveLength(38);
  });

  it('places 11 distinct harbor spots, all on coastal edges', () => {
    expect(g.harborSpots).toHaveLength(11);
    expect(new Set(g.harborSpots).size).toBe(11);
    for (const spot of g.harborSpots) expect(g.coastEdges).toContain(spot);
  });

  it('spiral order visits all 30 hexes exactly once, starting at the (3,-3) corner', () => {
    expect(g.hexSpiralOrder).toHaveLength(30);
    expect(new Set(g.hexSpiralOrder).size).toBe(30);
    const startHex = g.hexes[g.hexSpiralOrder[0]!]!;
    expect({ q: startHex.q, r: startHex.r }).toEqual(EXT56_LAYOUT.spiralStart);
  });

  it('is a fresh build equal to the exported GEOMETRY_EXT56', () => {
    expect(buildGeometry(EXT56_LAYOUT)).toEqual(g);
  });
});

describe('EXT56 constants (docs/10 §4)', () => {
  it('terrain multiset totals 30 with two deserts (X2/X3)', () => {
    const total = Object.values(EXT56_TERRAIN_COUNTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(30);
    expect(EXT56_TERRAIN_COUNTS).toEqual({
      hills: 5,
      forest: 6,
      pasture: 6,
      fields: 6,
      mountains: 5,
      desert: 2,
    });
  });

  it('token spiral is the 28-token multiset — two 2/12, three of the rest, no 7 (X4)', () => {
    expect(EXT56_TOKEN_SPIRAL).toHaveLength(28);
    expect([...EXT56_TOKEN_SPIRAL].sort((a, b) => a - b)).toEqual([
      2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
    ]);
    // 28 numbered hexes == 30 minus the two deserts.
    expect(EXT56_TOKEN_SPIRAL).toHaveLength(30 - EXT56_TERRAIN_COUNTS.desert);
  });

  it('harbor mix is 11: 5 generic + 2 wool + 1 each other resource (X5)', () => {
    expect(EXT56_HARBOR_MIX).toHaveLength(11);
    const counts: Partial<Record<HarborType, number>> = {};
    for (const h of EXT56_HARBOR_MIX) counts[h] = (counts[h] ?? 0) + 1;
    expect(counts).toEqual({ generic: 5, wool: 2, brick: 1, lumber: 1, grain: 1, ore: 1 });
  });

  it('bank 24/resource and dev deck 34 (20/3/3/3/5) (X6/X7)', () => {
    expect(EXT56_BANK_PER_RESOURCE).toBe(24);
    expect(EXT56_DEV_DECK).toEqual({
      knight: 20,
      roadBuilding: 3,
      yearOfPlenty: 3,
      monopoly: 3,
      victoryPoint: 5,
    });
    const deckTotal = Object.values(EXT56_DEV_DECK).reduce((a, b) => a + b, 0);
    expect(deckTotal).toBe(34);
  });
});
