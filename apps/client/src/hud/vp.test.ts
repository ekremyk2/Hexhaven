import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@hexhaven/engine';
import type { Seat, VertexId } from '@hexhaven/shared';
import { makeAwards, makeOtherPlayerView, makeOwnPlayerView } from './testFixtures';
import {
  computeEpFishVp,
  computeEpGoldVp,
  computeEpHarborVp,
  computeEpLairVp,
  computeEpSpiceVp,
  computeOwnVp,
  computePublicVp,
  epCapturedLairCount,
  epSpiceBenefitLevel,
} from './vp';

describe('computePublicVp (R13.1, settlements/cities/awards only)', () => {
  it('counts settlements ×1 and cities ×2', () => {
    const entry = makeOtherPlayerView(0 as Seat, {
      settlements: [1, 2] as VertexId[],
      cities: [3] as VertexId[],
    });
    const vp = computePublicVp(entry, makeAwards());
    expect(vp).toEqual({ settlements: 2, cities: 1, longestRoad: 0, largestArmy: 0, total: 4 });
  });

  it('adds the longest-road and largest-army bonuses only for the holder', () => {
    const holder = makeOtherPlayerView(1 as Seat);
    const other = makeOtherPlayerView(2 as Seat);
    const awards = makeAwards({
      longestRoad: { holder: 1 as Seat, length: 6 },
      largestArmy: { holder: 1 as Seat, count: 3 },
    });
    expect(computePublicVp(holder, awards).total).toBe(4);
    expect(computePublicVp(other, awards).total).toBe(0);
  });
});

describe('computeOwnVp (adds hidden VP cards — only ever safe for the viewer\'s own seat)', () => {
  it('adds one hidden VP per victoryPoint dev card', () => {
    const own = makeOwnPlayerView(0 as Seat, {
      settlements: [1] as VertexId[],
      devCards: [
        { type: 'victoryPoint', boughtOnTurn: 2 },
        { type: 'knight', boughtOnTurn: 3 },
        { type: 'victoryPoint', boughtOnTurn: 4 },
      ],
    });
    const vp = computeOwnVp(own, makeAwards());
    expect(vp.total).toBe(1); // public: 1 settlement
    expect(vp.vpCards).toBe(2);
    expect(vp.totalWithHidden).toBe(3);
  });
});

describe('Explorers & Pirates mission VP getters (T-1155)', () => {
  const SEAT0 = 0 as Seat;
  const SEAT1 = 1 as Seat;

  function epView(ext: Record<string, unknown>): PlayerView {
    return { ext: { explorersPirates: ext } } as unknown as PlayerView;
  }

  it('computeEpFishVp/computeEpSpiceVp/computeEpLairVp/computeEpGoldVp read the per-seat tally directly', () => {
    const view = epView({ fishPoints: [3, 0], spicePoints: [0, 2], lairPoints: [1, 0], goldPoints: [0, 4] });
    expect(computeEpFishVp(view, SEAT0)).toBe(3);
    expect(computeEpFishVp(view, SEAT1)).toBe(0);
    expect(computeEpSpiceVp(view, SEAT1)).toBe(2);
    expect(computeEpLairVp(view, SEAT0)).toBe(1);
    expect(computeEpGoldVp(view, SEAT1)).toBe(4);
  });

  it('returns 0 outside a live E&P game (no ext.explorersPirates at all)', () => {
    const view = { ext: {} } as unknown as PlayerView;
    expect(computeEpFishVp(view, SEAT0)).toBe(0);
    expect(computeEpSpiceVp(view, SEAT0)).toBe(0);
    expect(computeEpLairVp(view, SEAT0)).toBe(0);
    expect(computeEpGoldVp(view, SEAT0)).toBe(0);
    expect(epSpiceBenefitLevel(view, SEAT0)).toBe(0);
    expect(computeEpHarborVp(view, SEAT0)).toBe(0);
    expect(epCapturedLairCount(view)).toBe(0);
  });

  it('epSpiceBenefitLevel reads the ladder level, not a VP amount', () => {
    const view = epView({ spiceBenefit: [2, 0] });
    expect(epSpiceBenefitLevel(view, SEAT0)).toBe(2);
  });

  it('computeEpHarborVp is harborSettlements.length × EP_HARBOR_SETTLEMENT_VP (2 each)', () => {
    const view = epView({ harborSettlements: [[10, 11], [12]] });
    expect(computeEpHarborVp(view, SEAT0)).toBe(4);
    expect(computeEpHarborVp(view, SEAT1)).toBe(2);
  });

  it('epCapturedLairCount recovers the capture count from summed lairPoints ÷ LAIR_CAPTURE_CREWS', () => {
    // One capture split 2/1 across two seats = 3 total = exactly one captured lair.
    expect(epCapturedLairCount(epView({ lairPoints: [2, 1] }))).toBe(1);
    // Two full captures (6 total) = two captured lairs.
    expect(epCapturedLairCount(epView({ lairPoints: [3, 3] }))).toBe(2);
    // No captures yet.
    expect(epCapturedLairCount(epView({ lairPoints: [0, 0] }))).toBe(0);
  });
});
