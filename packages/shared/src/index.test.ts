import { describe, it, expect } from 'vitest';
import {
  VERSION,
  TERRAIN_RESOURCE,
  TERRAIN_COUNTS,
  TOKEN_SPIRAL,
  HARBOR_MIX,
  BANK_PER_RESOURCE,
  DEV_DECK,
  PIECES_PER_PLAYER,
  COSTS,
  TARGET_VP,
  DISCARD_THRESHOLD,
  bundleTotal,
  addBundles,
  subtractBundles,
  hasAtLeast,
} from './index.js';

describe('shared', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBeDefined();
    expect(typeof VERSION).toBe('string');
  });
});

describe('constants', () => {
  describe('TERRAIN_RESOURCE', () => {
    it('maps terrain types to resources or null for desert', () => {
      expect(TERRAIN_RESOURCE.hills).toBe('brick');
      expect(TERRAIN_RESOURCE.forest).toBe('lumber');
      expect(TERRAIN_RESOURCE.pasture).toBe('wool');
      expect(TERRAIN_RESOURCE.fields).toBe('grain');
      expect(TERRAIN_RESOURCE.mountains).toBe('ore');
      expect(TERRAIN_RESOURCE.desert).toBeNull();
    });
  });

  describe('TERRAIN_COUNTS', () => {
    it('sums to 19 hexes (R1.2)', () => {
      const sum =
        TERRAIN_COUNTS.hills +
        TERRAIN_COUNTS.forest +
        TERRAIN_COUNTS.pasture +
        TERRAIN_COUNTS.fields +
        TERRAIN_COUNTS.mountains +
        TERRAIN_COUNTS.desert;
      expect(sum).toBe(19);
    });

    it('has correct per-type counts (R1.2)', () => {
      expect(TERRAIN_COUNTS.hills).toBe(3);
      expect(TERRAIN_COUNTS.forest).toBe(4);
      expect(TERRAIN_COUNTS.pasture).toBe(4);
      expect(TERRAIN_COUNTS.fields).toBe(4);
      expect(TERRAIN_COUNTS.mountains).toBe(3);
      expect(TERRAIN_COUNTS.desert).toBe(1);
    });
  });

  describe('TOKEN_SPIRAL', () => {
    it('has exactly 18 entries (R2.3)', () => {
      expect(TOKEN_SPIRAL).toHaveLength(18);
    });

    it('has correct multiset: 2x1, 3x2, 4x2, 5x2, 6x2, 8x2, 9x2, 10x2, 11x2, 12x1 (R1.2/R2.3)', () => {
      const counts: Record<number, number> = {};
      for (const token of TOKEN_SPIRAL) {
        counts[token] = (counts[token] ?? 0) + 1;
      }
      expect(counts[2]).toBe(1);
      expect(counts[3]).toBe(2);
      expect(counts[4]).toBe(2);
      expect(counts[5]).toBe(2);
      expect(counts[6]).toBe(2);
      expect(counts[8]).toBe(2);
      expect(counts[9]).toBe(2);
      expect(counts[10]).toBe(2);
      expect(counts[11]).toBe(2);
      expect(counts[12]).toBe(1);
      // No 7 (robber roll)
      expect(counts[7]).toBeUndefined();
    });
  });

  describe('HARBOR_MIX', () => {
    it('has 9 harbors total: 4 generic + 5 distinct (R1.2)', () => {
      expect(HARBOR_MIX).toHaveLength(9);
      const generics = HARBOR_MIX.filter((h) => h === 'generic').length;
      expect(generics).toBe(4);
    });

    it('has one 2:1 harbor per resource type', () => {
      const resourceHarbors = HARBOR_MIX.filter((h) => h !== 'generic');
      expect(resourceHarbors).toHaveLength(5);
      const resourceSet = new Set(resourceHarbors);
      expect(resourceSet.size).toBe(5);
      expect(resourceSet.has('brick')).toBe(true);
      expect(resourceSet.has('lumber')).toBe(true);
      expect(resourceSet.has('wool')).toBe(true);
      expect(resourceSet.has('grain')).toBe(true);
      expect(resourceSet.has('ore')).toBe(true);
    });
  });

  describe('DEV_DECK', () => {
    it('sums to 25 cards (R1.2)', () => {
      const sum = DEV_DECK.knight + DEV_DECK.roadBuilding + DEV_DECK.yearOfPlenty + DEV_DECK.monopoly + DEV_DECK.victoryPoint;
      expect(sum).toBe(25);
    });

    it('has correct composition (R1.2)', () => {
      expect(DEV_DECK.knight).toBe(14);
      expect(DEV_DECK.roadBuilding).toBe(2);
      expect(DEV_DECK.yearOfPlenty).toBe(2);
      expect(DEV_DECK.monopoly).toBe(2);
      expect(DEV_DECK.victoryPoint).toBe(5);
    });
  });

  describe('PIECES_PER_PLAYER', () => {
    it('has correct counts (R1.2)', () => {
      expect(PIECES_PER_PLAYER.roads).toBe(15);
      expect(PIECES_PER_PLAYER.settlements).toBe(5);
      expect(PIECES_PER_PLAYER.cities).toBe(4);
    });
  });

  describe('COSTS', () => {
    it('road costs 1 brick + 1 lumber (R7.1)', () => {
      expect(COSTS.road).toEqual({ brick: 1, lumber: 1 });
    });

    it('settlement costs 1 brick + 1 lumber + 1 wool + 1 grain (R7.1)', () => {
      expect(COSTS.settlement).toEqual({ brick: 1, lumber: 1, wool: 1, grain: 1 });
    });

    it('city costs 3 ore + 2 grain (R7.1)', () => {
      expect(COSTS.city).toEqual({ ore: 3, grain: 2 });
    });

    it('dev card costs 1 ore + 1 wool + 1 grain (R7.1)', () => {
      expect(COSTS.devCard).toEqual({ ore: 1, wool: 1, grain: 1 });
    });
  });

  describe('constants', () => {
    it('BANK_PER_RESOURCE is 19 (R1.2)', () => {
      expect(BANK_PER_RESOURCE).toBe(19);
    });

    it('TARGET_VP is 10 (R1.1)', () => {
      expect(TARGET_VP).toBe(10);
    });

    it('DISCARD_THRESHOLD is 7 (R6.1)', () => {
      expect(DISCARD_THRESHOLD).toBe(7);
    });
  });
});

describe('bundle helpers', () => {
  describe('bundleTotal', () => {
    it('sums all resource counts', () => {
      expect(bundleTotal({ brick: 1, lumber: 2, ore: 3 })).toBe(6);
    });

    it('returns 0 for empty bundle', () => {
      expect(bundleTotal({})).toBe(0);
    });

    it('ignores undefined values', () => {
      expect(bundleTotal({ brick: 2 })).toBe(2);
    });
  });

  describe('addBundles', () => {
    it('combines resources from two bundles', () => {
      const result = addBundles({ brick: 1, lumber: 2 }, { brick: 1, ore: 3 });
      expect(result).toEqual({ brick: 2, lumber: 2, ore: 3 });
    });

    it('preserves structure with undefined for zero counts', () => {
      const result = addBundles({ brick: 0 }, {});
      expect(result.brick).toBe(0);
    });

    it('handles empty bundles', () => {
      expect(addBundles({}, { brick: 1 })).toEqual({ brick: 1 });
      expect(addBundles({ brick: 1 }, {})).toEqual({ brick: 1 });
    });
  });

  describe('subtractBundles', () => {
    it('subtracts second bundle from first', () => {
      const result = subtractBundles({ brick: 3, lumber: 2, ore: 1 }, { brick: 1, lumber: 1 });
      expect(result).toEqual({ brick: 2, lumber: 1, ore: 1 });
    });

    it('removes resource keys when count reaches 0', () => {
      const result = subtractBundles({ brick: 1 }, { brick: 1 });
      expect(result.brick).toBeUndefined();
    });

    it('throws BUG: error on negative result', () => {
      expect(() => subtractBundles({ brick: 1 }, { brick: 2 })).toThrow('BUG: negative bundle result for brick');
    });

    it('handles zero in input gracefully', () => {
      const result = subtractBundles({ brick: 0, lumber: 2 }, { brick: 0 });
      expect(result.brick).toBeUndefined();
      expect(result.lumber).toBe(2);
    });
  });

  describe('hasAtLeast', () => {
    it('returns true when hand has all required resources', () => {
      expect(hasAtLeast({ brick: 2, lumber: 1, ore: 3 }, { brick: 1, ore: 2 })).toBe(true);
    });

    it('returns true when hand exactly matches requirement', () => {
      expect(hasAtLeast({ brick: 1, ore: 2 }, { brick: 1, ore: 2 })).toBe(true);
    });

    it('returns false when hand lacks a required resource', () => {
      expect(hasAtLeast({ brick: 1, ore: 1 }, { brick: 1, lumber: 1 })).toBe(false);
    });

    it('returns false when hand has insufficient count', () => {
      expect(hasAtLeast({ brick: 1 }, { brick: 2 })).toBe(false);
    });

    it('returns true for empty requirement', () => {
      expect(hasAtLeast({ brick: 1 }, {})).toBe(true);
    });

    it('returns true when hand is empty and requirement is empty', () => {
      expect(hasAtLeast({}, {})).toBe(true);
    });
  });
});

describe('type-level tests', () => {
  // These verify the branded types and union discriminators are well-formed
  // They are compile-time checks that verify type coverage
  it('Seat type covers 0-5 and GameConfig.expansions covers expansion toggles', () => {
    // Seat type verification
    const seatValues: ReadonlyArray<Parameters<(s: import('./index.js').Seat) => void>[0]> = [0, 1, 2, 3, 4, 5] as const;
    expect(seatValues).toContain(0);
    expect(seatValues).toContain(5);

    // PlayerColor type verification includes green and brown
    const colors: ReadonlyArray<import('./index.js').PlayerColor> = [
      'red',
      'blue',
      'white',
      'orange',
      'green',
      'brown',
    ] as const;
    expect(colors).toContain('green');
    expect(colors).toContain('brown');

    // GameConfig.expansions type verification
    const config: import('./index.js').GameConfig = {
      playerCount: 4,
      targetVp: 10,
      seed: 'test',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: {
        fiveSix: false,
        seafarers: false,
        citiesKnights: false,
      },
    };
    expect(config.playerCount).toBe(4);

    // Verify seafarers expansion can have scenario
    const configWithSeafarers: import('./index.js').GameConfig = {
      playerCount: 4,
      targetVp: 10,
      seed: 'test',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: {
        fiveSix: true,
        seafarers: { scenario: 'headingForNewShores' },
        citiesKnights: true,
      },
    };
    expect(configWithSeafarers.expansions.fiveSix).toBe(true);
  });
});
