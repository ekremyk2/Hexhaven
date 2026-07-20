// T-702 step 1: Seafarers scenario "Heading for New Shores" — REAL board geometry (research §B).
// The MULTISETS (S10.2) stay verified; these tests now also pin the traced FRAME: cell counts per
// region, single simple coastline, small-island partition, harbor resolution to edges, and the
// pirate/robber starts. Terrain within a region is an example fill (S10.4 randomizes it at game-gen),
// so terrain is asserted only as a multiset and for the fixed 4p desert.

import { describe, expect, it } from 'vitest';
import {
  HEADING_FOR_NEW_SHORES,
  NEW_WORLD,
  THROUGH_THE_DESERT,
  FORGOTTEN_TRIBE,
  SIX_ISLANDS,
  FOG_ISLANDS,
  CLOTH_FOR_HEXHAVEN,
  PIRATE_ISLANDS,
  WONDERS_OF_HEXHAVEN,
  SCENARIOS,
  getScenario,
  isScenarioId,
  buildGeometry,
  resolveScenarioHarbors,
} from './index.js';
import type { Cell, Scenario, ScenarioBoard, ScenarioTerrain, ScenarioHex, HexRegion } from './index.js';
import { ExpansionsConfigSchema } from './protocol/messages.js';

function terrainCounts(board: ScenarioBoard): Partial<Record<ScenarioTerrain, number>> {
  const counts: Partial<Record<ScenarioTerrain, number>> = {};
  for (const h of board.hexes) counts[h.terrain] = (counts[h.terrain] ?? 0) + 1;
  return counts;
}

function regionCounts(board: ScenarioBoard): Record<HexRegion, number> {
  const counts: Record<HexRegion, number> = { main: 0, small: 0, sea: 0 };
  for (const h of board.hexes) counts[h.region]++;
  return counts;
}

const AXIAL_DELTAS: readonly [number, number][] = [
  [1, 0], [-1, 0], [1, -1], [0, -1], [0, 1], [-1, 1],
];

/** Count connected components of a cell set under axial adjacency. */
function components(cells: Cell[]): number {
  const keys = new Set(cells.map((c) => `${c.q},${c.r}`));
  const seen = new Set<string>();
  let comps = 0;
  for (const c of cells) {
    const start = `${c.q},${c.r}`;
    if (seen.has(start)) continue;
    comps++;
    const stack = [c];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop() as Cell;
      for (const [dq, dr] of AXIAL_DELTAS) {
        const nk = `${cur.q + dq},${cur.r + dr}`;
        if (keys.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push({ q: cur.q + dq, r: cur.r + dr });
        }
      }
    }
  }
  return comps;
}

describe('Scenario schema — Heading for New Shores (S10)', () => {
  const s: Scenario = HEADING_FOR_NEW_SHORES;

  it('has the scenario-level rules: target 14 VP, +2 small-island VP', () => {
    expect(s.id).toBe('headingForNewShores');
    expect(s.targetVp).toBe(14); // S10.1
    expect(s.smallIslandVp).toBe(2); // S10.6
  });

  it('carries verification flags for the residual (MEDIUM) items (S10.7)', () => {
    expect(s.verify.length).toBeGreaterThan(0);
  });

  it('registry resolves the id and rejects unknown ids', () => {
    expect(SCENARIOS.headingForNewShores).toBe(s);
    expect(getScenario('headingForNewShores')).toBe(s);
    expect(getScenario('nope')).toBeUndefined();
    expect(isScenarioId('headingForNewShores')).toBe(true);
    expect(isScenarioId('nope')).toBe(false);
  });

  describe.each([
    {
      count: 3 as const,
      hexes: 35,
      tokens: 22,
      harbors: 8,
      terrain: { sea: 13, fields: 4, hills: 4, mountains: 4, pasture: 5, forest: 3, gold: 2 },
      regions: { main: 14, small: 8, sea: 13 },
      islands: { 0: 2, 1: 4, 2: 2 },
      robber: { q: 3, r: -3, region: 'small' as HexRegion },
    },
    {
      count: 4 as const,
      hexes: 42,
      tokens: 27,
      harbors: 9,
      terrain: { sea: 14, desert: 1, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5, gold: 2 },
      regions: { main: 19, small: 9, sea: 14 },
      islands: { 0: 2, 1: 5, 2: 2 },
      robber: { q: -1, r: 0, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
    },
    {
      // T-751, ⚠ VERIFY — best-effort (no printed 5p diagram available at all, see verify[]).
      count: 5 as const,
      hexes: 48,
      tokens: 32,
      harbors: 10,
      terrain: { sea: 14, desert: 2, fields: 6, hills: 6, mountains: 6, pasture: 6, forest: 6, gold: 2 },
      regions: { main: 22, small: 12, sea: 14 },
      islands: { 0: 4, 1: 4, 2: 4 },
      robber: { q: 0, r: 0, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
    },
    {
      // T-751, ⚠ VERIFY — the 56/16/3/7/7/7/7/7/2 totals are the one verified figure; rest best-effort.
      // 11 harbors = 6 resource 2:1 (wool doubled, ⚠ VERIFY which — see verify[]) + 5 generic.
      count: 6 as const,
      hexes: 56,
      tokens: 38,
      harbors: 11,
      terrain: { sea: 16, desert: 2, fields: 7, hills: 7, mountains: 7, pasture: 7, forest: 7, gold: 3 },
      regions: { main: 27, small: 13, sea: 16 },
      islands: { 0: 4, 1: 5, 2: 4 },
      robber: { q: 0, r: 0, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
      doubledHarbor: 'wool' as const,
    },
  ])('$count-player board (research §B / T-751 best-effort for 5p/6p)', ({ count, hexes, tokens, harbors, terrain, regions, islands, robber, doubledHarbor }) => {
    const board = s.boards[count]!; // headingForNewShores ships both 3p and 4p boards (Phase 7B made boards a partial record)

    it(`is ${hexes} hexes with the verified terrain multiset`, () => {
      expect(board.layout.hexes).toHaveLength(hexes);
      expect(board.hexes).toHaveLength(hexes);
      expect(terrainCounts(board)).toEqual(terrain);
    });

    it('has the verified per-region cell counts (S10.2)', () => {
      expect(regionCounts(board)).toEqual(regions);
    });

    it(`has ${tokens} tokens and ${harbors} harbor tokens`, () => {
      expect(board.tokens).toHaveLength(tokens);
      expect(board.harborMix).toHaveLength(harbors);
      const hc: Record<string, number> = {};
      for (const h of board.harborMix) hc[h] = (hc[h] ?? 0) + 1;
      // One resource 2:1 per resource, except `doubledHarbor` (6p, T-751 ⚠ VERIFY) which gets 2.
      const resourceCounts: Record<string, number> = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 };
      if (doubledHarbor) resourceCounts[doubledHarbor] = 2;
      expect(hc).toMatchObject(resourceCounts);
      const resourceTotal = Object.values(resourceCounts).reduce((a, b) => a + b, 0);
      expect(hc.generic).toBe(harbors - resourceTotal);
    });

    it('token multiset never contains a 7', () => {
      expect(board.tokens).not.toContain(7);
    });

    it('the frame builds a single simple coastline via buildGeometry', () => {
      const g = buildGeometry(board.layout);
      expect(g.hexes).toHaveLength(hexes);
      expect(g.coastEdges.length).toBeGreaterThan(0);
      // harborCoastIndices is empty — Seafarers harbors are interior coasts (see `harbors`).
      expect(g.harborSpots).toHaveLength(0);
      expect(g.hexSpiralOrder).toHaveLength(hexes);
    });

    it('hexes align with layout coords in HexId (r,q) order', () => {
      const sorted = [...board.layout.hexes].sort((a, b) => a.r - b.r || a.q - b.q);
      expect(board.hexes.map((h) => ({ q: h.q, r: h.r }))).toEqual(sorted);
    });

    it('the main island is a single connected blob (S10.5)', () => {
      const main = board.hexes.filter((h) => h.region === 'main').map((h) => ({ q: h.q, r: h.r }));
      expect(main).toHaveLength(regions.main);
      expect(components(main)).toBe(1);
    });

    it('has 3 small islands (A/B/C), each connected, with the verified sizes (S10.6)', () => {
      const byIsland = new Map<number, Cell[]>();
      for (const h of board.hexes) {
        if (h.region !== 'small') continue;
        expect(typeof h.island).toBe('number');
        const id = h.island as number;
        const list = byIsland.get(id) ?? [];
        list.push({ q: h.q, r: h.r });
        byIsland.set(id, list);
      }
      expect([...byIsland.keys()].sort()).toEqual([0, 1, 2]);
      for (const [id, cells] of byIsland) {
        expect(cells).toHaveLength((islands as Record<number, number>)[id]!);
        expect(components(cells)).toBe(1); // each island is its own connected group
      }
      // main-land cells never carry an island id
      for (const h of board.hexes) if (h.region !== 'small') expect(h.island).toBeUndefined();
    });

    it('resolves every harbor to a distinct sea↔main coastal edge', () => {
      const g = buildGeometry(board.layout);
      const resolved = resolveScenarioHarbors(board, g);
      expect(resolved).toHaveLength(board.harbors.length);
      expect(resolved).toHaveLength(board.harborMix.length);

      const edgeIds = new Set(resolved.map((r) => r.edge));
      expect(edgeIds.size).toBe(resolved.length); // no two harbors share an edge

      const regionOf = (h: number): HexRegion => {
        const hex = g.hexes[h]!;
        const cell = board.hexes.find((c) => c.q === hex.q && c.r === hex.r)!;
        return cell.region;
      };
      for (const r of resolved) {
        const edge = g.edges[r.edge]!;
        expect(edge.hexes).toHaveLength(2); // interior sea↔land edge, not an outer-coast edge
        expect(edge.hexes).toContain(r.seaHex);
        expect(edge.hexes).toContain(r.landHex);
        expect(regionOf(r.seaHex)).toBe('sea');
        expect(regionOf(r.landHex)).toBe('main');
      }
    });

    it('pirate starts on a sea cell; robber start matches the diagram', () => {
      const at = (p: Cell | null) =>
        p ? board.hexes.find((h) => h.q === p.q && h.r === p.r) : undefined;
      expect(at(board.pirateStart)?.terrain).toBe('sea');

      expect(board.robberStart).toEqual({ q: robber.q, r: robber.r });
      const rob = at(board.robberStart);
      expect(rob?.region).toBe(robber.region);
      if ('terrain' in robber) expect(rob?.terrain).toBe(robber.terrain);
    });
  });
});

describe('Scenario schema — New World (T-752, 5-6 players only, RANDOM-BY-DESIGN)', () => {
  const s: Scenario = NEW_WORLD;

  it('has the scenario-level rules: target 14 VP, +2 small-island VP', () => {
    expect(s.id).toBe('newWorld');
    expect(s.targetVp).toBe(14); // S10.1
    expect(s.smallIslandVp).toBe(2); // S10.6
  });

  it('carries a verification flag for the residual (random-by-design) items', () => {
    expect(s.verify.length).toBeGreaterThan(0);
  });

  it('registry resolves the id and rejects unknown ids', () => {
    expect(SCENARIOS.newWorld).toBe(s);
    expect(getScenario('newWorld')).toBe(s);
    expect(isScenarioId('newWorld')).toBe(true);
  });

  it('ships ONLY 5p/6p boards — no 3p/4p entries (5-6-only scenario)', () => {
    expect(s.boards[3]).toBeUndefined();
    expect(s.boards[4]).toBeUndefined();
    expect(s.boards[5]).toBeDefined();
    expect(s.boards[6]).toBeDefined();
  });

  describe.each([
    {
      count: 5 as const,
      hexes: 54,
      tokens: 37,
      harbors: 10,
      terrain: { sea: 15, desert: 2, fields: 7, hills: 7, mountains: 7, pasture: 7, forest: 7, gold: 2 },
      regions: { main: 27, small: 12, sea: 15 },
      islands: { 0: 4, 1: 4, 2: 4 },
      robber: { q: 1, r: 0, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
    },
    {
      count: 6 as const,
      hexes: 63,
      tokens: 43,
      harbors: 11,
      terrain: { sea: 18, desert: 2, fields: 8, hills: 8, mountains: 8, pasture: 8, forest: 8, gold: 3 },
      regions: { main: 32, small: 13, sea: 18 },
      islands: { 0: 4, 1: 5, 2: 4 },
      robber: { q: 1, r: 0, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
      doubledHarbor: 'ore' as const,
    },
  ])('$count-player board (T-752, best-effort / random-by-design)', ({ count, hexes, tokens, harbors, terrain, regions, islands, robber, doubledHarbor }) => {
    const board = s.boards[count]!;

    it(`is ${hexes} hexes with the chosen terrain multiset`, () => {
      expect(board.layout.hexes).toHaveLength(hexes);
      expect(board.hexes).toHaveLength(hexes);
      expect(terrainCounts(board)).toEqual(terrain);
    });

    it('has the chosen per-region cell counts', () => {
      expect(regionCounts(board)).toEqual(regions);
    });

    it(`has ${tokens} tokens and ${harbors} harbor tokens`, () => {
      expect(board.tokens).toHaveLength(tokens);
      expect(board.harborMix).toHaveLength(harbors);
      const hc: Record<string, number> = {};
      for (const h of board.harborMix) hc[h] = (hc[h] ?? 0) + 1;
      const resourceCounts: Record<string, number> = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 };
      if (doubledHarbor) resourceCounts[doubledHarbor] = 2;
      expect(hc).toMatchObject(resourceCounts);
      const resourceTotal = Object.values(resourceCounts).reduce((a, b) => a + b, 0);
      expect(hc.generic).toBe(harbors - resourceTotal);
    });

    it('token multiset never contains a 7', () => {
      expect(board.tokens).not.toContain(7);
    });

    it('the frame builds a single simple coastline via buildGeometry', () => {
      const g = buildGeometry(board.layout);
      expect(g.hexes).toHaveLength(hexes);
      expect(g.coastEdges.length).toBeGreaterThan(0);
      expect(g.harborSpots).toHaveLength(0);
      expect(g.hexSpiralOrder).toHaveLength(hexes);
    });

    it('hexes align with layout coords in HexId (r,q) order', () => {
      const sorted = [...board.layout.hexes].sort((a, b) => a.r - b.r || a.q - b.q);
      expect(board.hexes.map((h) => ({ q: h.q, r: h.r }))).toEqual(sorted);
    });

    it('the main island is a single connected blob (S10.5)', () => {
      const main = board.hexes.filter((h) => h.region === 'main').map((h) => ({ q: h.q, r: h.r }));
      expect(main).toHaveLength(regions.main);
      expect(components(main)).toBe(1);
    });

    it('has 3 small islands (A/B/C), each connected, with the chosen sizes (S10.6)', () => {
      const byIsland = new Map<number, Cell[]>();
      for (const h of board.hexes) {
        if (h.region !== 'small') continue;
        expect(typeof h.island).toBe('number');
        const id = h.island as number;
        const list = byIsland.get(id) ?? [];
        list.push({ q: h.q, r: h.r });
        byIsland.set(id, list);
      }
      expect([...byIsland.keys()].sort()).toEqual([0, 1, 2]);
      for (const [id, cells] of byIsland) {
        expect(cells).toHaveLength((islands as Record<number, number>)[id]!);
        expect(components(cells)).toBe(1);
      }
      for (const h of board.hexes) if (h.region !== 'small') expect(h.island).toBeUndefined();
    });

    it('resolves every harbor to a distinct sea↔land coastal edge', () => {
      const g = buildGeometry(board.layout);
      const resolved = resolveScenarioHarbors(board, g);
      expect(resolved).toHaveLength(board.harbors.length);
      expect(resolved).toHaveLength(board.harborMix.length);

      const edgeIds = new Set(resolved.map((r) => r.edge));
      expect(edgeIds.size).toBe(resolved.length);

      const regionOf = (h: number): HexRegion => {
        const hex = g.hexes[h]!;
        const cell = board.hexes.find((c) => c.q === hex.q && c.r === hex.r)!;
        return cell.region;
      };
      for (const r of resolved) {
        const edge = g.edges[r.edge]!;
        expect(edge.hexes).toHaveLength(2);
        expect(edge.hexes).toContain(r.seaHex);
        expect(edge.hexes).toContain(r.landHex);
        expect(regionOf(r.seaHex)).toBe('sea');
        // T-752: New World's harbors face either the main island or a small island (unlike
        // HEADING_FOR_NEW_SHORES, which only ever faces main) — accept either.
        expect(['main', 'small']).toContain(regionOf(r.landHex));
      }
    });

    it('pirate starts on a sea cell; robber starts on the chosen desert cell', () => {
      const at = (p: Cell | null) =>
        p ? board.hexes.find((h) => h.q === p.q && h.r === p.r) : undefined;
      expect(at(board.pirateStart)?.terrain).toBe('sea');

      expect(board.robberStart).toEqual({ q: robber.q, r: robber.r });
      const rob = at(board.robberStart);
      expect(rob?.region).toBe(robber.region);
      expect(rob?.terrain).toBe(robber.terrain);
    });
  });
});

describe('Scenario schema — Through the Desert (T-753, 5-6 players only, BEST-EFFORT)', () => {
  const s: Scenario = THROUGH_THE_DESERT;

  it('has the scenario-level rules: target 14 VP, +2 small-island VP', () => {
    expect(s.id).toBe('throughTheDesert');
    expect(s.targetVp).toBe(14); // S10.1 (⚠ VERIFY)
    expect(s.smallIslandVp).toBe(2); // S10.6 (⚠ VERIFY)
  });

  it('carries verification flags for the residual (best-effort) items', () => {
    expect(s.verify.length).toBeGreaterThan(0);
  });

  it('registry resolves the id and rejects unknown ids', () => {
    expect(SCENARIOS.throughTheDesert).toBe(s);
    expect(getScenario('throughTheDesert')).toBe(s);
    expect(isScenarioId('throughTheDesert')).toBe(true);
  });

  it('ships ONLY 5p/6p boards — no 3p/4p entries (5-6-only scenario)', () => {
    expect(s.boards[3]).toBeUndefined();
    expect(s.boards[4]).toBeUndefined();
    expect(s.boards[5]).toBeDefined();
    expect(s.boards[6]).toBeDefined();
  });

  describe.each([
    {
      count: 5 as const,
      hexes: 54,
      tokens: 37,
      harbors: 10,
      terrain: { sea: 15, desert: 2, fields: 7, hills: 7, mountains: 7, pasture: 7, forest: 7, gold: 2 },
      regions: { main: 27, small: 12, sea: 15 },
      islands: { 0: 4, 1: 4, 2: 4 },
      robber: { q: 1, r: 0, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
    },
    {
      count: 6 as const,
      hexes: 63,
      tokens: 42,
      harbors: 11,
      terrain: { sea: 18, desert: 3, fields: 8, hills: 8, mountains: 8, pasture: 7, forest: 8, gold: 3 },
      regions: { main: 32, small: 13, sea: 18 },
      islands: { 0: 4, 1: 5, 2: 4 },
      robber: { q: 1, r: 0, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
      doubledHarbor: 'grain' as const,
    },
  ])('$count-player board (T-753, best-effort)', ({ count, hexes, tokens, harbors, terrain, regions, islands, robber, doubledHarbor }) => {
    const board = s.boards[count]!;

    it(`is ${hexes} hexes with the chosen terrain multiset`, () => {
      expect(board.layout.hexes).toHaveLength(hexes);
      expect(board.hexes).toHaveLength(hexes);
      expect(terrainCounts(board)).toEqual(terrain);
    });

    it('has the chosen per-region cell counts', () => {
      expect(regionCounts(board)).toEqual(regions);
    });

    it(`has ${tokens} tokens and ${harbors} harbor tokens`, () => {
      expect(board.tokens).toHaveLength(tokens);
      expect(board.harborMix).toHaveLength(harbors);
      const hc: Record<string, number> = {};
      for (const h of board.harborMix) hc[h] = (hc[h] ?? 0) + 1;
      const resourceCounts: Record<string, number> = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 };
      if (doubledHarbor) resourceCounts[doubledHarbor] = 2;
      expect(hc).toMatchObject(resourceCounts);
      const resourceTotal = Object.values(resourceCounts).reduce((a, b) => a + b, 0);
      expect(hc.generic).toBe(harbors - resourceTotal);
    });

    it('token multiset never contains a 7', () => {
      expect(board.tokens).not.toContain(7);
    });

    it('the frame builds a single simple coastline via buildGeometry', () => {
      const g = buildGeometry(board.layout);
      expect(g.hexes).toHaveLength(hexes);
      expect(g.coastEdges.length).toBeGreaterThan(0);
      expect(g.harborSpots).toHaveLength(0);
      expect(g.hexSpiralOrder).toHaveLength(hexes);
    });

    it('hexes align with layout coords in HexId (r,q) order', () => {
      const sorted = [...board.layout.hexes].sort((a, b) => a.r - b.r || a.q - b.q);
      expect(board.hexes.map((h) => ({ q: h.q, r: h.r }))).toEqual(sorted);
    });

    it('the main island is a single connected blob (S10.5), the desert band sits inside it', () => {
      const main = board.hexes.filter((h) => h.region === 'main').map((h) => ({ q: h.q, r: h.r }));
      expect(main).toHaveLength(regions.main);
      expect(components(main)).toBe(1);
      const desertCells = board.hexes.filter((h) => h.region === 'main' && h.terrain === 'desert');
      expect(desertCells).toHaveLength(terrain.desert);
    });

    it('has 3 small islands (A/B/C), each connected, with the chosen sizes (S10.6)', () => {
      const byIsland = new Map<number, Cell[]>();
      for (const h of board.hexes) {
        if (h.region !== 'small') continue;
        expect(typeof h.island).toBe('number');
        const id = h.island as number;
        const list = byIsland.get(id) ?? [];
        list.push({ q: h.q, r: h.r });
        byIsland.set(id, list);
      }
      expect([...byIsland.keys()].sort()).toEqual([0, 1, 2]);
      for (const [id, cells] of byIsland) {
        expect(cells).toHaveLength((islands as Record<number, number>)[id]!);
        expect(components(cells)).toBe(1);
      }
      for (const h of board.hexes) if (h.region !== 'small') expect(h.island).toBeUndefined();
    });

    it('resolves every harbor to a distinct sea↔land coastal edge', () => {
      const g = buildGeometry(board.layout);
      const resolved = resolveScenarioHarbors(board, g);
      expect(resolved).toHaveLength(board.harbors.length);
      expect(resolved).toHaveLength(board.harborMix.length);

      const edgeIds = new Set(resolved.map((r) => r.edge));
      expect(edgeIds.size).toBe(resolved.length);

      const regionOf = (h: number): HexRegion => {
        const hex = g.hexes[h]!;
        const cell = board.hexes.find((c) => c.q === hex.q && c.r === hex.r)!;
        return cell.region;
      };
      for (const r of resolved) {
        const edge = g.edges[r.edge]!;
        expect(edge.hexes).toHaveLength(2);
        expect(edge.hexes).toContain(r.seaHex);
        expect(edge.hexes).toContain(r.landHex);
        expect(regionOf(r.seaHex)).toBe('sea');
        expect(['main', 'small']).toContain(regionOf(r.landHex));
      }
    });

    it('pirate starts on a sea cell; robber starts on a desert cell of the crossing band', () => {
      const at = (p: Cell | null) =>
        p ? board.hexes.find((h) => h.q === p.q && h.r === p.r) : undefined;
      expect(at(board.pirateStart)?.terrain).toBe('sea');

      expect(board.robberStart).toEqual({ q: robber.q, r: robber.r });
      const rob = at(board.robberStart);
      expect(rob?.region).toBe(robber.region);
      expect(rob?.terrain).toBe(robber.terrain);
    });
  });
});

describe('Scenario schema — The Forgotten Tribe (T-754, 5-6 players only, BEST-EFFORT, per-island reward VP)', () => {
  const s: Scenario = FORGOTTEN_TRIBE;

  it('has the scenario-level rules: target 14 VP, +2 fallback small-island VP', () => {
    expect(s.id).toBe('forgottenTribe');
    expect(s.targetVp).toBe(14); // S10.1 (⚠ VERIFY)
    expect(s.smallIslandVp).toBe(2); // fallback for an island absent from islandRewards (⚠ VERIFY)
  });

  it('defines the per-island reward table for all 5 islands (T-754 mechanic)', () => {
    expect(s.islandRewards).toEqual({ 0: 1, 1: 1, 2: 2, 3: 2, 4: 3 });
  });

  it('carries verification flags for the residual (best-effort) items', () => {
    expect(s.verify.length).toBeGreaterThan(0);
  });

  it('registry resolves the id and rejects unknown ids', () => {
    expect(SCENARIOS.forgottenTribe).toBe(s);
    expect(getScenario('forgottenTribe')).toBe(s);
    expect(isScenarioId('forgottenTribe')).toBe(true);
  });

  it('ships ONLY 5p/6p boards — no 3p/4p entries (5-6-only scenario)', () => {
    expect(s.boards[3]).toBeUndefined();
    expect(s.boards[4]).toBeUndefined();
    expect(s.boards[5]).toBeDefined();
    expect(s.boards[6]).toBeDefined();
  });

  describe.each([
    {
      count: 5 as const,
      hexes: 54,
      tokens: 34,
      harbors: 7,
      terrain: { sea: 18, desert: 2, fields: 7, hills: 6, mountains: 6, pasture: 6, forest: 6, gold: 3 },
      regions: { main: 27, small: 9, sea: 18 },
      robber: { q: 0, r: -2, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
    },
    {
      count: 6 as const,
      hexes: 63,
      tokens: 39,
      harbors: 9,
      terrain: { sea: 22, desert: 2, fields: 8, hills: 7, mountains: 7, pasture: 7, forest: 7, gold: 3 },
      regions: { main: 32, small: 9, sea: 22 },
      robber: { q: 0, r: -2, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
    },
  ])('$count-player board (T-754, best-effort)', ({ count, hexes, tokens, harbors, terrain, regions, robber }) => {
    const board = s.boards[count]!;
    const islands = { 0: 2, 1: 2, 2: 2, 3: 2, 4: 1 };

    it(`is ${hexes} hexes with the chosen terrain multiset`, () => {
      expect(board.layout.hexes).toHaveLength(hexes);
      expect(board.hexes).toHaveLength(hexes);
      expect(terrainCounts(board)).toEqual(terrain);
    });

    it('has the chosen per-region cell counts', () => {
      expect(regionCounts(board)).toEqual(regions);
    });

    it(`has ${tokens} tokens and ${harbors} harbor tokens`, () => {
      expect(board.tokens).toHaveLength(tokens);
      expect(board.harborMix).toHaveLength(harbors);
      const hc: Record<string, number> = {};
      for (const h of board.harborMix) hc[h] = (hc[h] ?? 0) + 1;
      const resourceCounts: Record<string, number> = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 };
      expect(hc).toMatchObject(resourceCounts);
      const resourceTotal = Object.values(resourceCounts).reduce((a, b) => a + b, 0);
      expect(hc.generic).toBe(harbors - resourceTotal);
    });

    it('token multiset never contains a 7', () => {
      expect(board.tokens).not.toContain(7);
    });

    it('the frame builds a single simple coastline via buildGeometry', () => {
      const g = buildGeometry(board.layout);
      expect(g.hexes).toHaveLength(hexes);
      expect(g.coastEdges.length).toBeGreaterThan(0);
      expect(g.harborSpots).toHaveLength(0);
      expect(g.hexSpiralOrder).toHaveLength(hexes);
    });

    it('hexes align with layout coords in HexId (r,q) order', () => {
      const sorted = [...board.layout.hexes].sort((a, b) => a.r - b.r || a.q - b.q);
      expect(board.hexes.map((h) => ({ q: h.q, r: h.r }))).toEqual(sorted);
    });

    it('the main island is a single connected blob (S10.5)', () => {
      const main = board.hexes.filter((h) => h.region === 'main').map((h) => ({ q: h.q, r: h.r }));
      expect(main).toHaveLength(regions.main);
      expect(components(main)).toBe(1);
    });

    it('has 5 small islands (ids 0-4), each connected, with the chosen sizes (S10.6/T-754)', () => {
      const byIsland = new Map<number, Cell[]>();
      for (const h of board.hexes) {
        if (h.region !== 'small') continue;
        expect(typeof h.island).toBe('number');
        const id = h.island as number;
        const list = byIsland.get(id) ?? [];
        list.push({ q: h.q, r: h.r });
        byIsland.set(id, list);
      }
      expect([...byIsland.keys()].sort()).toEqual([0, 1, 2, 3, 4]);
      for (const [id, cells] of byIsland) {
        expect(cells).toHaveLength((islands as Record<number, number>)[id]!);
        expect(components(cells)).toBe(1);
      }
      for (const h of board.hexes) if (h.region !== 'small') expect(h.island).toBeUndefined();
    });

    it('resolves every harbor to a distinct sea↔land coastal edge', () => {
      const g = buildGeometry(board.layout);
      const resolved = resolveScenarioHarbors(board, g);
      expect(resolved).toHaveLength(board.harbors.length);
      expect(resolved).toHaveLength(board.harborMix.length);

      const edgeIds = new Set(resolved.map((r) => r.edge));
      expect(edgeIds.size).toBe(resolved.length);

      const regionOf = (h: number): HexRegion => {
        const hex = g.hexes[h]!;
        const cell = board.hexes.find((c) => c.q === hex.q && c.r === hex.r)!;
        return cell.region;
      };
      for (const r of resolved) {
        const edge = g.edges[r.edge]!;
        expect(edge.hexes).toHaveLength(2);
        expect(edge.hexes).toContain(r.seaHex);
        expect(edge.hexes).toContain(r.landHex);
        expect(regionOf(r.seaHex)).toBe('sea');
        expect(regionOf(r.landHex)).toBe('main');
      }
    });

    it('pirate starts on a sea cell; robber starts on the chosen desert cell', () => {
      const at = (p: Cell | null) =>
        p ? board.hexes.find((h) => h.q === p.q && h.r === p.r) : undefined;
      expect(at(board.pirateStart)?.terrain).toBe('sea');

      expect(board.robberStart).toEqual({ q: robber.q, r: robber.r });
      const rob = at(board.robberStart);
      expect(rob?.region).toBe(robber.region);
      expect(rob?.terrain).toBe(robber.terrain);
    });
  });
});

describe('Scenario schema — The Six Islands (T-755, 5-6 players only, NO main island)', () => {
  const s: Scenario = SIX_ISLANDS;

  it('has the scenario-level rules: target 18 VP (raised — starting settlements earn island chits here), +2 small-island VP', () => {
    expect(s.id).toBe('sixIslands');
    expect(s.targetVp).toBe(18); // ⚠ VERIFY (T-755) — raised from the usual 14, see scenario.ts
    expect(s.smallIslandVp).toBe(2); // S10.6, flat rate — no per-island `islandRewards` table here
    expect(s.islandRewards).toBeUndefined();
  });

  it('carries verification flags for the residual (best-effort) items', () => {
    expect(s.verify.length).toBeGreaterThan(0);
  });

  it('registry resolves the id and rejects unknown ids', () => {
    expect(SCENARIOS.sixIslands).toBe(s);
    expect(getScenario('sixIslands')).toBe(s);
    expect(isScenarioId('sixIslands')).toBe(true);
  });

  it('ships ONLY 5p/6p boards — no 3p/4p entries (5-6-only scenario)', () => {
    expect(s.boards[3]).toBeUndefined();
    expect(s.boards[4]).toBeUndefined();
    expect(s.boards[5]).toBeDefined();
    expect(s.boards[6]).toBeDefined();
  });

  describe.each([
    {
      count: 5 as const,
      hexes: 51,
      tokens: 36,
      harbors: 7,
      terrain: { sea: 15, gold: 3, fields: 7, hills: 7, mountains: 7, pasture: 6, forest: 6 },
      regions: { main: 0, small: 36, sea: 15 },
      robber: { q: 1, r: 0, terrain: 'fields' as ScenarioTerrain },
    },
    {
      count: 6 as const,
      hexes: 56,
      tokens: 36,
      harbors: 9,
      terrain: { sea: 20, gold: 3, fields: 7, hills: 7, mountains: 7, pasture: 6, forest: 6 },
      regions: { main: 0, small: 36, sea: 20 },
      robber: { q: 0, r: -1, terrain: 'fields' as ScenarioTerrain },
    },
  ])('$count-player board (T-755, best-effort, no main island)', ({ count, hexes, tokens, harbors, terrain, regions, robber }) => {
    const board = s.boards[count]!;

    it(`is ${hexes} hexes with the chosen terrain multiset`, () => {
      expect(board.layout.hexes).toHaveLength(hexes);
      expect(board.hexes).toHaveLength(hexes);
      expect(terrainCounts(board)).toEqual(terrain);
    });

    it('has the chosen per-region cell counts — regions.main === 0 (the model\'s defining break)', () => {
      expect(regionCounts(board)).toEqual(regions);
      expect(regions.main).toBe(0);
    });

    it(`has ${tokens} tokens and ${harbors} harbor tokens`, () => {
      expect(board.tokens).toHaveLength(tokens);
      expect(board.harborMix).toHaveLength(harbors);
      const hc: Record<string, number> = {};
      for (const h of board.harborMix) hc[h] = (hc[h] ?? 0) + 1;
      const resourceCounts: Record<string, number> = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 };
      expect(hc).toMatchObject(resourceCounts);
      const resourceTotal = Object.values(resourceCounts).reduce((a, b) => a + b, 0);
      expect(hc.generic).toBe(harbors - resourceTotal);
    });

    it('token multiset never contains a 7', () => {
      expect(board.tokens).not.toContain(7);
    });

    it('the frame builds a single simple coastline via buildGeometry', () => {
      const g = buildGeometry(board.layout);
      expect(g.hexes).toHaveLength(hexes);
      expect(g.coastEdges.length).toBeGreaterThan(0);
      expect(g.harborSpots).toHaveLength(0);
      expect(g.hexSpiralOrder).toHaveLength(hexes);
    });

    it('hexes align with layout coords in HexId (r,q) order', () => {
      const sorted = [...board.layout.hexes].sort((a, b) => a.r - b.r || a.q - b.q);
      expect(board.hexes.map((h) => ({ q: h.q, r: h.r }))).toEqual(sorted);
    });

    // T-755: this scenario BREAKS the "main island is a single connected blob" assertion every other
    // shipped scenario's describe block asserts (see the ones above) — there IS no main island here
    // (PM-decided, docs/tasks/phase-7b/T-755 "The model"). This is the INVERTED/conditional form the
    // task's read-first item 4 calls for: assert `regions.main === 0` and NO main cells at all, instead
    // of the single-connected-blob check. Every OTHER scenario's own "main island" test above is
    // untouched (a diff of this file shows no edits inside their describe blocks) — this is a
    // freestanding, self-contained assertion for this scenario only, not a shared helper the others
    // also call, so nothing about their assertions was weakened to make this pass.
    it('has NO main island (regions.main === 0) — the model\'s defining break, not a single blob', () => {
      const main = board.hexes.filter((h) => h.region === 'main');
      expect(main).toHaveLength(0);
      expect(regionCounts(board).main).toBe(0);
    });

    it('has 6 small islands (ids 0-5), each connected, 6 hexes each, and no two DIFFERENT islands are hex-adjacent (S10.6)', () => {
      const byIsland = new Map<number, Cell[]>();
      for (const h of board.hexes) {
        if (h.region !== 'small') continue;
        expect(typeof h.island).toBe('number');
        const id = h.island as number;
        const list = byIsland.get(id) ?? [];
        list.push({ q: h.q, r: h.r });
        byIsland.set(id, list);
      }
      expect([...byIsland.keys()].sort()).toEqual([0, 1, 2, 3, 4, 5]);
      for (const [, cells] of byIsland) {
        expect(cells).toHaveLength(6);
        expect(components(cells)).toBe(1); // each island is its own connected group
      }
      // main-land cells never carry an island id (there are none — see the test above)
      for (const h of board.hexes) if (h.region !== 'small') expect(h.island).toBeUndefined();

      // No two DIFFERENT islands are hex-adjacent (each island is isolated by at least one sea cell) —
      // the defining structural property that keeps 6 DISTINCT islands distinct, not one big landmass.
      const hexOf = new Map<string, ScenarioHex>();
      for (const h of board.hexes) hexOf.set(`${h.q},${h.r}`, h);
      for (const h of board.hexes) {
        if (h.region !== 'small') continue;
        for (const [dq, dr] of [[1, 0], [-1, 0], [1, -1], [0, -1], [0, 1], [-1, 1]] as const) {
          const neighbor = hexOf.get(`${h.q + dq},${h.r + dr}`);
          if (neighbor && neighbor.region === 'small') expect(neighbor.island).toBe(h.island);
        }
      }
    });

    it('resolves every harbor to a distinct sea↔small coastal edge (no main region to face here)', () => {
      const g = buildGeometry(board.layout);
      const resolved = resolveScenarioHarbors(board, g);
      expect(resolved).toHaveLength(board.harbors.length);
      expect(resolved).toHaveLength(board.harborMix.length);

      const edgeIds = new Set(resolved.map((r) => r.edge));
      expect(edgeIds.size).toBe(resolved.length); // no two harbors share an edge

      const regionOf = (h: number): HexRegion => {
        const hex = g.hexes[h]!;
        const cell = board.hexes.find((c) => c.q === hex.q && c.r === hex.r)!;
        return cell.region;
      };
      for (const r of resolved) {
        const edge = g.edges[r.edge]!;
        expect(edge.hexes).toHaveLength(2); // interior sea↔land edge, not an outer-coast edge
        expect(edge.hexes).toContain(r.seaHex);
        expect(edge.hexes).toContain(r.landHex);
        expect(regionOf(r.seaHex)).toBe('sea');
        // T-755: every harbor faces a SMALL island here — there is no main region to face.
        expect(regionOf(r.landHex)).toBe('small');
      }
    });

    it('pirate starts on a sea cell; robber starts on the chosen (desert-less) land cell', () => {
      const at = (p: Cell | null) =>
        p ? board.hexes.find((h) => h.q === p.q && h.r === p.r) : undefined;
      expect(at(board.pirateStart)?.terrain).toBe('sea');

      expect(board.robberStart).toEqual({ q: robber.q, r: robber.r });
      const rob = at(board.robberStart);
      expect(rob?.region).toBe('small'); // no main region on this board
      expect(rob?.terrain).toBe(robber.terrain);
    });
  });
});

describe('Scenario schema — The Fog Islands (T-756, 5-6 players only, NEW MECHANIC: fog exploration)', () => {
  const s: Scenario = FOG_ISLANDS;

  it('has the scenario-level rules: standard 14 VP target, +2 small-island VP (never granted — no small islands on this board)', () => {
    expect(s.id).toBe('fogIslands');
    expect(s.targetVp).toBe(14); // ⚠ VERIFY (T-756) — assumed standard, see scenario.ts
    expect(s.smallIslandVp).toBe(2);
    expect(s.islandRewards).toBeUndefined();
  });

  it('carries verification flags for the residual (best-effort) items', () => {
    expect(s.verify.length).toBeGreaterThan(0);
  });

  it('registry resolves the id and rejects unknown ids', () => {
    expect(SCENARIOS.fogIslands).toBe(s);
    expect(getScenario('fogIslands')).toBe(s);
    expect(isScenarioId('fogIslands')).toBe(true);
  });

  it('ships ONLY 5p/6p boards — no 3p/4p entries (5-6-only scenario)', () => {
    expect(s.boards[3]).toBeUndefined();
    expect(s.boards[4]).toBeUndefined();
    expect(s.boards[5]).toBeDefined();
    expect(s.boards[6]).toBeDefined();
  });

  describe.each([
    {
      count: 5 as const,
      hexes: 54,
      mainHexes: 18,
      seaHexes: 36,
      fogHexes: 5,
      tokens: 17,
      harbors: 6,
      robber: { q: 1, r: 0 },
    },
    {
      count: 6 as const,
      hexes: 63,
      mainHexes: 21,
      seaHexes: 42,
      fogHexes: 6,
      tokens: 20,
      harbors: 7,
      robber: { q: 1, r: 0 },
    },
  ])('$count-player board (T-756, best-effort, fog exploration)', ({ count, hexes, mainHexes, seaHexes, fogHexes, tokens, harbors, robber }) => {
    const board = s.boards[count]!;

    it(`is ${hexes} hexes total (${mainHexes} starting island + ${seaHexes} sea, of which ${fogHexes} fog)`, () => {
      expect(board.layout.hexes).toHaveLength(hexes);
      expect(board.hexes).toHaveLength(hexes);
      expect(regionCounts(board)).toEqual({ main: mainHexes, small: 0, sea: seaHexes });
    });

    it(`has ${tokens} tokens (starting island only — fog tokens live in the fog stack, not here) and ${harbors} harbor tokens`, () => {
      expect(board.tokens).toHaveLength(tokens);
      expect(board.harborMix).toHaveLength(harbors);
      const hc: Record<string, number> = {};
      for (const h of board.harborMix) hc[h] = (hc[h] ?? 0) + 1;
      const resourceCounts: Record<string, number> = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 };
      expect(hc).toMatchObject(resourceCounts);
    });

    it('token multiset never contains a 7', () => {
      expect(board.tokens).not.toContain(7);
    });

    it('the frame builds a single simple coastline via buildGeometry', () => {
      const g = buildGeometry(board.layout);
      expect(g.hexes).toHaveLength(hexes);
      expect(g.coastEdges.length).toBeGreaterThan(0);
      expect(g.harborSpots).toHaveLength(0);
      expect(g.hexSpiralOrder).toHaveLength(hexes);
    });

    it('hexes align with layout coords in HexId (r,q) order', () => {
      const sorted = [...board.layout.hexes].sort((a, b) => a.r - b.r || a.q - b.q);
      expect(board.hexes.map((h) => ({ q: h.q, r: h.r }))).toEqual(sorted);
    });

    it('has NO small islands (regions.small === 0) — the fog mechanic\'s model simplification', () => {
      expect(regionCounts(board).small).toBe(0);
      for (const h of board.hexes) expect(h.island).toBeUndefined();
    });

    it(`carries a fog block: ${fogHexes} fog cells + a same-length tile stack multiset, no token 7`, () => {
      expect(board.fog).toBeDefined();
      const fog = board.fog!;
      expect(fog.cells).toHaveLength(fogHexes);
      expect(fog.tiles).toHaveLength(fogHexes);
      // Every fog cell IS one of the board's `region: 'sea'` cells (structurally indistinguishable
      // from open water until revealed — see the `ScenarioBoard.fog` field comment).
      const seaKeys = new Set(
        board.hexes.filter((h) => h.region === 'sea').map((h) => `${h.q},${h.r}`)
      );
      for (const c of fog.cells) expect(seaKeys.has(`${c.q},${c.r}`)).toBe(true);
      // Fog cells are a SUBSET of the sea cells (an open-sea buffer separates them from the frame's
      // OTHER sea cells at both player counts — see the frame's own header comment in scenario.ts).
      expect(fog.cells.length).toBeLessThan(seaKeys.size);
      // No fog tile ever resolves to plain 'sea' (a fog tile always reveals real land or gold, S9).
      for (const t of fog.tiles) expect(t.terrain).not.toBe('sea');
      // Tokens: no 7, and every non-desert tile IS numbered (gold included, S9.1).
      for (const t of fog.tiles) {
        expect(t.token).not.toBe(7);
        if (t.terrain !== 'desert') expect(t.token).not.toBeNull();
      }
    });

    // ★ The stranding-constraint invariant (T-756 review fix): every fog cell must be an ISOLATED
    // interior sea hex — all 6 axial neighbours on-board AND real (non-fog, non-land) sea. This is
    // what makes revealing a fog hex to land provably unable to strand a ship (I5-ships): every
    // fog-bordering edge also borders a real sea hex. scenario.ts's `assertFogIsolated` enforces it
    // at module load; this test pins it against regressions from the data side too.
    it('every fog cell is an isolated interior sea hex — surrounded by 6 real (non-fog, non-land) sea hexes', () => {
      const fog = board.fog!;
      const cellAt = new Map<string, ScenarioHex>();
      for (const h of board.hexes) cellAt.set(`${h.q},${h.r}`, h);
      const fogKeys = new Set(fog.cells.map((c) => `${c.q},${c.r}`));
      const NEIGHBORS: readonly [number, number][] = [[1, 0], [-1, 0], [1, -1], [-1, 1], [0, 1], [0, -1]];
      for (const c of fog.cells) {
        for (const [dq, dr] of NEIGHBORS) {
          const nk = `${c.q + dq},${c.r + dr}`;
          const neighbor = cellAt.get(nk);
          expect(neighbor, `fog cell (${c.q},${c.r}) neighbour ${nk} must be on-board (interior)`).toBeDefined();
          expect(neighbor!.region, `fog cell (${c.q},${c.r}) neighbour ${nk} must be sea (not land)`).toBe('sea');
          expect(fogKeys.has(nk), `fog cell (${c.q},${c.r}) must not touch another fog cell ${nk}`).toBe(false);
        }
      }
    });

    it('resolves every harbor to a distinct sea<->main coastal edge', () => {
      const g = buildGeometry(board.layout);
      const resolved = resolveScenarioHarbors(board, g);
      expect(resolved).toHaveLength(board.harbors.length);
      expect(resolved).toHaveLength(board.harborMix.length);

      const edgeIds = new Set(resolved.map((r) => r.edge));
      expect(edgeIds.size).toBe(resolved.length); // no two harbors share an edge

      const regionOf = (h: number): HexRegion => {
        const hex = g.hexes[h]!;
        const cell = board.hexes.find((c) => c.q === hex.q && c.r === hex.r)!;
        return cell.region;
      };
      for (const r of resolved) {
        const edge = g.edges[r.edge]!;
        expect(edge.hexes).toHaveLength(2); // interior sea<->land edge, not an outer-coast edge
        expect(edge.hexes).toContain(r.seaHex);
        expect(edge.hexes).toContain(r.landHex);
        expect(regionOf(r.seaHex)).toBe('sea');
        expect(regionOf(r.landHex)).toBe('main');
      }
    });

    it('pirate starts on a sea cell; robber starts on the chosen (fixed desert) land cell', () => {
      const at = (p: Cell | null) =>
        p ? board.hexes.find((h) => h.q === p.q && h.r === p.r) : undefined;
      expect(at(board.pirateStart)?.terrain).toBe('sea');

      expect(board.robberStart).toEqual({ q: robber.q, r: robber.r });
      const rob = at(board.robberStart);
      expect(rob?.region).toBe('main');
      expect(rob?.terrain).toBe('desert'); // the fixed desert cell (robberStart pins it, per scenario.ts)
    });
  });
});

describe('Scenario schema — Cloth for Hexhaven (T-757, 5-6 players only, NEW MECHANIC: cloth villages -> VP)', () => {
  const s: Scenario = CLOTH_FOR_HEXHAVEN;

  it('has the scenario-level rules: target 14 VP, +2 small-island VP (unaffected by the cloth mechanic)', () => {
    expect(s.id).toBe('clothForHexhaven');
    expect(s.targetVp).toBe(14); // ⚠ VERIFY
    expect(s.smallIslandVp).toBe(2); // S10.6, additive to cloth VP — unchanged
    expect(s.islandRewards).toBeUndefined();
  });

  it('carries verification flags for the residual (best-effort) items, incl. the cloth simplification', () => {
    expect(s.verify.length).toBeGreaterThan(0);
  });

  it('registry resolves the id and rejects unknown ids', () => {
    expect(SCENARIOS.clothForHexhaven).toBe(s);
    expect(getScenario('clothForHexhaven')).toBe(s);
    expect(isScenarioId('clothForHexhaven')).toBe(true);
  });

  it('ships ONLY 5p/6p boards — no 3p/4p entries (5-6-only scenario)', () => {
    expect(s.boards[3]).toBeUndefined();
    expect(s.boards[4]).toBeUndefined();
    expect(s.boards[5]).toBeDefined();
    expect(s.boards[6]).toBeDefined();
  });

  describe.each([
    {
      count: 5 as const,
      hexes: 54,
      tokens: 37,
      harbors: 10,
      terrain: { sea: 15, desert: 2, fields: 7, hills: 7, mountains: 7, pasture: 7, forest: 7, gold: 2 },
      regions: { main: 27, small: 12, sea: 15 },
      islands: { 0: 4, 1: 4, 2: 4 },
      robber: { q: 1, r: 0, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
    },
    {
      count: 6 as const,
      hexes: 63,
      tokens: 43,
      harbors: 11,
      terrain: { sea: 18, desert: 2, fields: 8, hills: 8, mountains: 8, pasture: 8, forest: 8, gold: 3 },
      regions: { main: 32, small: 13, sea: 18 },
      islands: { 0: 4, 1: 5, 2: 4 },
      robber: { q: 1, r: 0, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
      doubledHarbor: 'ore' as const,
    },
  ])('$count-player board (T-757, reuses New World\'s T-752 multiset/frame + 3 villages)', ({ count, hexes, tokens, harbors, terrain, regions, islands, robber, doubledHarbor }) => {
    const board = s.boards[count]!;

    it(`is ${hexes} hexes with the chosen terrain multiset (same as New World, T-752)`, () => {
      expect(board.layout.hexes).toHaveLength(hexes);
      expect(board.hexes).toHaveLength(hexes);
      expect(terrainCounts(board)).toEqual(terrain);
    });

    it('has the chosen per-region cell counts', () => {
      expect(regionCounts(board)).toEqual(regions);
    });

    it(`has ${tokens} tokens and ${harbors} harbor tokens`, () => {
      expect(board.tokens).toHaveLength(tokens);
      expect(board.harborMix).toHaveLength(harbors);
      const hc: Record<string, number> = {};
      for (const h of board.harborMix) hc[h] = (hc[h] ?? 0) + 1;
      const resourceCounts: Record<string, number> = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 };
      if (doubledHarbor) resourceCounts[doubledHarbor] = 2;
      expect(hc).toMatchObject(resourceCounts);
      const resourceTotal = Object.values(resourceCounts).reduce((a, b) => a + b, 0);
      expect(hc.generic).toBe(harbors - resourceTotal);
    });

    it('token multiset never contains a 7', () => {
      expect(board.tokens).not.toContain(7);
    });

    it('the frame builds a single simple coastline via buildGeometry', () => {
      const g = buildGeometry(board.layout);
      expect(g.hexes).toHaveLength(hexes);
      expect(g.coastEdges.length).toBeGreaterThan(0);
      expect(g.harborSpots).toHaveLength(0);
      expect(g.hexSpiralOrder).toHaveLength(hexes);
    });

    it('the main island is a single connected blob (S10.5)', () => {
      const main = board.hexes.filter((h) => h.region === 'main').map((h) => ({ q: h.q, r: h.r }));
      expect(main).toHaveLength(regions.main);
      expect(components(main)).toBe(1);
    });

    it('has 3 small islands (A/B/C), each connected, with the chosen sizes (S10.6)', () => {
      const byIsland = new Map<number, Cell[]>();
      for (const h of board.hexes) {
        if (h.region !== 'small') continue;
        expect(typeof h.island).toBe('number');
        const id = h.island as number;
        const list = byIsland.get(id) ?? [];
        list.push({ q: h.q, r: h.r });
        byIsland.set(id, list);
      }
      expect([...byIsland.keys()].sort()).toEqual([0, 1, 2]);
      for (const [id, cells] of byIsland) {
        expect(cells).toHaveLength((islands as Record<number, number>)[id]!);
        expect(components(cells)).toBe(1);
      }
    });

    it('resolves every harbor to a distinct sea<->land coastal edge', () => {
      const g = buildGeometry(board.layout);
      const resolved = resolveScenarioHarbors(board, g);
      expect(resolved).toHaveLength(board.harbors.length);
      expect(resolved).toHaveLength(board.harborMix.length);
      const edgeIds = new Set(resolved.map((r) => r.edge));
      expect(edgeIds.size).toBe(resolved.length);
    });

    it('pirate starts on a sea cell; robber starts on the chosen desert cell', () => {
      const at = (p: Cell | null) => (p ? board.hexes.find((h) => h.q === p.q && h.r === p.r) : undefined);
      expect(at(board.pirateStart)?.terrain).toBe('sea');
      expect(board.robberStart).toEqual({ q: robber.q, r: robber.r });
      const rob = at(board.robberStart);
      expect(rob?.region).toBe(robber.region);
      expect(rob?.terrain).toBe(robber.terrain);
    });

    // ---- T-757's own new data: `villages` ------------------------------------------------------
    it('tags EVERY small-island hex as a village (sim-driven density, see scenario.ts header)', () => {
      expect(board.villages).toBeDefined();
      const villages = board.villages!;
      const smallCells = board.hexes.filter((h) => h.region === 'small').map((h) => ({ q: h.q, r: h.r }));
      expect(villages).toHaveLength(smallCells.length); // every small-island cell, none extra

      const villageKeys = new Set(villages.map((v) => `${v.q},${v.r}`));
      for (const c of smallCells) expect(villageKeys.has(`${c.q},${c.r}`)).toBe(true);

      // Covers all 3 distinct islands (0/1/2) — not just one.
      const islandsHit = new Set(board.hexes.filter((h) => h.region === 'small').map((h) => h.island as number));
      expect([...islandsHit].sort()).toEqual([0, 1, 2]);
    });

    it('every OTHER shipped scenario omits `villages` entirely (isolation, RK-13-adjacent)', () => {
      expect(HEADING_FOR_NEW_SHORES.boards[count]?.villages).toBeUndefined();
      expect(NEW_WORLD.boards[count]?.villages).toBeUndefined();
      expect(THROUGH_THE_DESERT.boards[count]?.villages).toBeUndefined();
      expect(FORGOTTEN_TRIBE.boards[count]?.villages).toBeUndefined();
      expect(SIX_ISLANDS.boards[count]?.villages).toBeUndefined();
      expect(FOG_ISLANDS.boards[count]?.villages).toBeUndefined();
    });
  });
});

describe('Scenario schema — The Pirate Islands (T-758, 5-6 players only, NEW MECHANIC: auto-moving pirate track + lairs)', () => {
  const s: Scenario = PIRATE_ISLANDS;

  it('has the scenario-level rules: target 14 VP, +2 small-island VP (unaffected by the lair mechanic)', () => {
    expect(s.id).toBe('pirateIslands');
    expect(s.targetVp).toBe(14); // ⚠ VERIFY
    expect(s.smallIslandVp).toBe(2); // S10.6, additive to lair VP — unchanged
    expect(s.islandRewards).toBeUndefined();
  });

  it('carries verification flags for the residual (best-effort) items, incl. the track/lair mechanics', () => {
    expect(s.verify.length).toBeGreaterThan(0);
  });

  it('registry resolves the id and rejects unknown ids', () => {
    expect(SCENARIOS.pirateIslands).toBe(s);
    expect(getScenario('pirateIslands')).toBe(s);
    expect(isScenarioId('pirateIslands')).toBe(true);
  });

  it('ships ONLY 5p/6p boards — no 3p/4p entries (5-6-only scenario)', () => {
    expect(s.boards[3]).toBeUndefined();
    expect(s.boards[4]).toBeUndefined();
    expect(s.boards[5]).toBeDefined();
    expect(s.boards[6]).toBeDefined();
  });

  describe.each([
    {
      count: 5 as const,
      hexes: 54,
      tokens: 37,
      harbors: 10,
      terrain: { sea: 15, desert: 2, fields: 7, hills: 7, mountains: 7, pasture: 7, forest: 7, gold: 2 },
      regions: { main: 27, small: 12, sea: 15 },
      islands: { 0: 4, 1: 4, 2: 4 },
      robber: { q: 1, r: 0, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
      trackLength: 4,
      trackSafeCount: 1,
    },
    {
      count: 6 as const,
      hexes: 63,
      tokens: 43,
      harbors: 11,
      terrain: { sea: 18, desert: 2, fields: 8, hills: 8, mountains: 8, pasture: 8, forest: 8, gold: 3 },
      regions: { main: 32, small: 13, sea: 18 },
      islands: { 0: 4, 1: 5, 2: 4 },
      robber: { q: 1, r: 0, region: 'main' as HexRegion, terrain: 'desert' as ScenarioTerrain },
      doubledHarbor: 'ore' as const,
      trackLength: 7,
      trackSafeCount: 2,
    },
  ])('$count-player board (T-758, reuses New World\'s T-752 multiset/frame + a pirate track + island-C lairs)', ({ count, hexes, tokens, harbors, terrain, regions, islands, robber, doubledHarbor, trackLength, trackSafeCount }) => {
    const board = s.boards[count]!;

    it(`is ${hexes} hexes with the chosen terrain multiset (same as New World, T-752)`, () => {
      expect(board.layout.hexes).toHaveLength(hexes);
      expect(board.hexes).toHaveLength(hexes);
      expect(terrainCounts(board)).toEqual(terrain);
    });

    it('has the chosen per-region cell counts', () => {
      expect(regionCounts(board)).toEqual(regions);
    });

    it(`has ${tokens} tokens and ${harbors} harbor tokens`, () => {
      expect(board.tokens).toHaveLength(tokens);
      expect(board.harborMix).toHaveLength(harbors);
      const hc: Record<string, number> = {};
      for (const h of board.harborMix) hc[h] = (hc[h] ?? 0) + 1;
      const resourceCounts: Record<string, number> = { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 };
      if (doubledHarbor) resourceCounts[doubledHarbor] = 2;
      expect(hc).toMatchObject(resourceCounts);
      const resourceTotal = Object.values(resourceCounts).reduce((a, b) => a + b, 0);
      expect(hc.generic).toBe(harbors - resourceTotal);
    });

    it('token multiset never contains a 7', () => {
      expect(board.tokens).not.toContain(7);
    });

    it('the frame builds a single simple coastline via buildGeometry', () => {
      const g = buildGeometry(board.layout);
      expect(g.hexes).toHaveLength(hexes);
      expect(g.coastEdges.length).toBeGreaterThan(0);
      expect(g.harborSpots).toHaveLength(0);
      expect(g.hexSpiralOrder).toHaveLength(hexes);
    });

    it('the main island is a single connected blob (S10.5)', () => {
      const main = board.hexes.filter((h) => h.region === 'main').map((h) => ({ q: h.q, r: h.r }));
      expect(main).toHaveLength(regions.main);
      expect(components(main)).toBe(1);
    });

    it('has 3 small islands (A/B/C), each connected, with the chosen sizes (S10.6)', () => {
      const byIsland = new Map<number, Cell[]>();
      for (const h of board.hexes) {
        if (h.region !== 'small') continue;
        expect(typeof h.island).toBe('number');
        const id = h.island as number;
        const list = byIsland.get(id) ?? [];
        list.push({ q: h.q, r: h.r });
        byIsland.set(id, list);
      }
      expect([...byIsland.keys()].sort()).toEqual([0, 1, 2]);
      for (const [id, cells] of byIsland) {
        expect(cells).toHaveLength((islands as Record<number, number>)[id]!);
        expect(components(cells)).toBe(1);
      }
    });

    it('resolves every harbor to a distinct sea<->land coastal edge', () => {
      const g = buildGeometry(board.layout);
      const resolved = resolveScenarioHarbors(board, g);
      expect(resolved).toHaveLength(board.harbors.length);
      expect(resolved).toHaveLength(board.harborMix.length);
      const edgeIds = new Set(resolved.map((r) => r.edge));
      expect(edgeIds.size).toBe(resolved.length);
    });

    it('pirate starts on a sea cell; robber starts on the chosen desert cell', () => {
      const at = (p: Cell | null) => (p ? board.hexes.find((h) => h.q === p.q && h.r === p.r) : undefined);
      expect(at(board.pirateStart)?.terrain).toBe('sea');
      expect(board.robberStart).toEqual({ q: robber.q, r: robber.r });
      const rob = at(board.robberStart);
      expect(rob?.region).toBe(robber.region);
      expect(rob?.terrain).toBe(robber.terrain);
    });

    // ---- T-758's own new data: `pirateTrack` / `lairs` -----------------------------------------
    it(`carries an ordered pirate track of ${trackLength} sea cells, starting at pirateStart, with ${trackSafeCount} safe cell(s)`, () => {
      expect(board.pirateTrack).toBeDefined();
      const track = board.pirateTrack!;
      expect(track).toHaveLength(trackLength);
      expect(track[0]!.cell).toEqual(board.pirateStart);

      // Every track cell is a real `sea`-region cell on this board (never main/small/off-board).
      const seaKeys = new Set(
        board.hexes.filter((h) => h.region === 'sea').map((h) => `${h.q},${h.r}`)
      );
      for (const t of track) expect(seaKeys.has(`${t.cell.q},${t.cell.r}`)).toBe(true);

      // No duplicate cells (the pirate visits each stop exactly once per lap).
      const keys = track.map((t) => `${t.cell.q},${t.cell.r}`);
      expect(new Set(keys).size).toBe(track.length);

      expect(track.filter((t) => t.safe).length).toBe(trackSafeCount);
    });

    it('the pirate track NEVER touches a harbor cell (deadlock avoidance — see scenario.ts header)', () => {
      const harborKeys = new Set(board.harbors.map((h) => `${h.sea.q},${h.sea.r}`));
      for (const t of board.pirateTrack!) {
        expect(harborKeys.has(`${t.cell.q},${t.cell.r}`)).toBe(false);
      }
    });

    it('marks every cell of small island C (group id 2) as a lair, and nothing else', () => {
      expect(board.lairs).toBeDefined();
      const lairs = board.lairs!;
      const islandCCells = board.hexes
        .filter((h) => h.region === 'small' && h.island === 2)
        .map((h) => ({ q: h.q, r: h.r }));
      expect(lairs).toHaveLength(islandCCells.length);
      const lairKeys = new Set(lairs.map((c) => `${c.q},${c.r}`));
      for (const c of islandCCells) expect(lairKeys.has(`${c.q},${c.r}`)).toBe(true);

      // Islands A/B (0/1) carry no lairs.
      const islandABCells = board.hexes.filter(
        (h) => h.region === 'small' && (h.island === 0 || h.island === 1)
      );
      for (const h of islandABCells) expect(lairKeys.has(`${h.q},${h.r}`)).toBe(false);
    });

    it('every OTHER shipped scenario omits `pirateTrack`/`lairs` entirely (isolation, RK-13-adjacent)', () => {
      expect(HEADING_FOR_NEW_SHORES.boards[count]?.pirateTrack).toBeUndefined();
      expect(NEW_WORLD.boards[count]?.pirateTrack).toBeUndefined();
      expect(THROUGH_THE_DESERT.boards[count]?.pirateTrack).toBeUndefined();
      expect(FORGOTTEN_TRIBE.boards[count]?.pirateTrack).toBeUndefined();
      expect(SIX_ISLANDS.boards[count]?.pirateTrack).toBeUndefined();
      expect(FOG_ISLANDS.boards[count]?.pirateTrack).toBeUndefined();
      expect(CLOTH_FOR_HEXHAVEN.boards[count]?.pirateTrack).toBeUndefined();
      expect(HEADING_FOR_NEW_SHORES.boards[count]?.lairs).toBeUndefined();
      expect(NEW_WORLD.boards[count]?.lairs).toBeUndefined();
      expect(THROUGH_THE_DESERT.boards[count]?.lairs).toBeUndefined();
      expect(FORGOTTEN_TRIBE.boards[count]?.lairs).toBeUndefined();
      expect(SIX_ISLANDS.boards[count]?.lairs).toBeUndefined();
      expect(FOG_ISLANDS.boards[count]?.lairs).toBeUndefined();
      expect(CLOTH_FOR_HEXHAVEN.boards[count]?.lairs).toBeUndefined();
    });
  });
});

describe('Scenario schema — The Wonders of Hexhaven (T-759, 5-6 players only, FINAL scenario, NEW MECHANIC: build-a-wonder alternate win)', () => {
  const s: Scenario = WONDERS_OF_HEXHAVEN;

  it('has the scenario-level rules: target 14 VP, +2 small-island VP (unaffected by the wonder mechanic)', () => {
    expect(s.id).toBe('wondersOfHexhaven');
    expect(s.targetVp).toBe(14); // ⚠ VERIFY
    expect(s.smallIslandVp).toBe(2); // S10.6, additive to the wonder mechanic — unchanged
    expect(s.islandRewards).toBeUndefined();
  });

  it('carries verification flags for the residual (best-effort) items, incl. the wonder mechanic', () => {
    expect(s.verify.length).toBeGreaterThan(0);
  });

  it('registry resolves the id and rejects unknown ids', () => {
    expect(SCENARIOS.wondersOfHexhaven).toBe(s);
    expect(getScenario('wondersOfHexhaven')).toBe(s);
    expect(isScenarioId('wondersOfHexhaven')).toBe(true);
  });

  it('ships ONLY 5p/6p boards — no 3p/4p entries (5-6-only scenario)', () => {
    expect(s.boards[3]).toBeUndefined();
    expect(s.boards[4]).toBeUndefined();
    expect(s.boards[5]).toBeDefined();
    expect(s.boards[6]).toBeDefined();
  });

  it("reuses New World's (T-752) exact 5p/6p board data wholesale — no new ScenarioBoard field at all (the mechanic is purely per-seat bookkeeping, never tied to the board)", () => {
    expect(s.boards[5]).toEqual(NEW_WORLD.boards[5]);
    expect(s.boards[6]).toEqual(NEW_WORLD.boards[6]);
    for (const count of [5, 6] as const) {
      expect(s.boards[count]).not.toHaveProperty('villages');
      expect(s.boards[count]).not.toHaveProperty('pirateTrack');
      expect(s.boards[count]).not.toHaveProperty('lairs');
    }
  });

  describe.each([
    { count: 5 as const, hexes: 54, tokens: 37, harbors: 10 },
    { count: 6 as const, hexes: 63, tokens: 43, harbors: 11 },
  ])("$count-player board sanity (T-759, reuses New World's T-752 multiset/frame verbatim)", ({ count, hexes, tokens, harbors }) => {
    const board = s.boards[count]!;

    it(`is ${hexes} hexes, ${tokens} tokens, ${harbors} harbor tokens, no 7`, () => {
      expect(board.layout.hexes).toHaveLength(hexes);
      expect(board.hexes).toHaveLength(hexes);
      expect(board.tokens).toHaveLength(tokens);
      expect(board.harborMix).toHaveLength(harbors);
      expect(board.tokens).not.toContain(7);
    });

    it('the frame builds a single simple coastline via buildGeometry', () => {
      const g = buildGeometry(board.layout);
      expect(g.hexes).toHaveLength(hexes);
      expect(g.coastEdges.length).toBeGreaterThan(0);
    });

    it('the main island is a single connected blob (S10.5)', () => {
      const main = board.hexes.filter((h) => h.region === 'main').map((h) => ({ q: h.q, r: h.r }));
      expect(components(main)).toBe(1);
    });

    it('resolves every harbor to a distinct sea<->land coastal edge', () => {
      const g = buildGeometry(board.layout);
      const resolved = resolveScenarioHarbors(board, g);
      expect(resolved).toHaveLength(board.harbors.length);
      const edgeIds = new Set(resolved.map((r) => r.edge));
      expect(edgeIds.size).toBe(resolved.length);
    });
  });
});

describe('scenario id crosses the wire (zod)', () => {
  it('accepts a known scenario id and round-trips it', () => {
    const cfg = { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false };
    const parsed = ExpansionsConfigSchema.parse(cfg);
    expect(parsed).toEqual(cfg);
  });

  it('accepts the newWorld scenario id (T-752) and round-trips it', () => {
    const cfg = { fiveSix: true, seafarers: { scenario: 'newWorld' }, citiesKnights: false };
    const parsed = ExpansionsConfigSchema.parse(cfg);
    expect(parsed).toEqual(cfg);
  });

  it('accepts the throughTheDesert scenario id (T-753) and round-trips it', () => {
    const cfg = { fiveSix: true, seafarers: { scenario: 'throughTheDesert' }, citiesKnights: false };
    const parsed = ExpansionsConfigSchema.parse(cfg);
    expect(parsed).toEqual(cfg);
  });

  it('accepts the forgottenTribe scenario id (T-754) and round-trips it', () => {
    const cfg = { fiveSix: true, seafarers: { scenario: 'forgottenTribe' }, citiesKnights: false };
    const parsed = ExpansionsConfigSchema.parse(cfg);
    expect(parsed).toEqual(cfg);
  });

  it('accepts the sixIslands scenario id (T-755) and round-trips it', () => {
    const cfg = { fiveSix: true, seafarers: { scenario: 'sixIslands' }, citiesKnights: false };
    const parsed = ExpansionsConfigSchema.parse(cfg);
    expect(parsed).toEqual(cfg);
  });

  it('accepts the fogIslands scenario id (T-756) and round-trips it', () => {
    const cfg = { fiveSix: true, seafarers: { scenario: 'fogIslands' }, citiesKnights: false };
    const parsed = ExpansionsConfigSchema.parse(cfg);
    expect(parsed).toEqual(cfg);
  });

  it('accepts the clothForHexhaven scenario id (T-757) and round-trips it', () => {
    const cfg = { fiveSix: true, seafarers: { scenario: 'clothForHexhaven' }, citiesKnights: false };
    const parsed = ExpansionsConfigSchema.parse(cfg);
    expect(parsed).toEqual(cfg);
  });

  it('accepts the pirateIslands scenario id (T-758) and round-trips it', () => {
    const cfg = { fiveSix: true, seafarers: { scenario: 'pirateIslands' }, citiesKnights: false };
    const parsed = ExpansionsConfigSchema.parse(cfg);
    expect(parsed).toEqual(cfg);
  });

  it('accepts the wondersOfHexhaven scenario id (T-759) and round-trips it', () => {
    const cfg = { fiveSix: true, seafarers: { scenario: 'wondersOfHexhaven' }, citiesKnights: false };
    const parsed = ExpansionsConfigSchema.parse(cfg);
    expect(parsed).toEqual(cfg);
  });

  it('accepts seafarers off', () => {
    const cfg = { fiveSix: false, seafarers: false as const, citiesKnights: false };
    expect(ExpansionsConfigSchema.parse(cfg)).toEqual(cfg);
  });

  it('rejects an unknown scenario id', () => {
    const cfg = { fiveSix: false, seafarers: { scenario: 'atlantis' }, citiesKnights: false };
    expect(ExpansionsConfigSchema.safeParse(cfg).success).toBe(false);
  });
});
