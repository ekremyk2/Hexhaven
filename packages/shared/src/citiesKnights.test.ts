// T-801: Cities & Knights data-model constants (docs/rules/cities-knights-rules.md C4, C6.5, C7.1,
// C8, C9). The module itself is dormant (not wired into resolveModules) — these tests only pin the
// shared shapes/data this task adds: constants, the progress-card catalog, and the ProgressCardId
// union's completeness.

import { describe, expect, it } from 'vitest';
import {
  CK_BARBARIAN_STEPS_TO_ATTACK,
  CK_COMMODITY_SUPPLY,
  CK_DISCARD_LIMIT_BASE,
  CK_DISCARD_LIMIT_PER_WALL,
  CK_KNIGHT_CAP,
  CK_MAX_WALLS,
  CK_PROGRESS_DECK_COMPOSITION,
  CK_PROGRESS_HAND_LIMIT,
  CK_TARGET_VP,
  ckCardDrawEligible,
  ckDeckCards,
  ckImprovementCost,
} from './index.js';
import type { ImprovementTrack, ProgressCardId } from './index.js';

// Exhaustiveness map (C6.5): TypeScript errors here if `ProgressCardId` gains/loses a member without
// this map being updated to match, so `Object.keys(ALL_PROGRESS_CARDS)` below is a compiler-checked
// list of exactly the distinct card names the union declares.
const ALL_PROGRESS_CARDS: Record<ProgressCardId, true> = {
  alchemist: true,
  crane: true,
  engineer: true,
  inventor: true,
  irrigation: true,
  medicine: true,
  mining: true,
  printer: true,
  roadBuilding: true,
  smith: true,
  merchant: true,
  merchantFleet: true,
  commercialHarbor: true,
  masterMerchant: true,
  resourceMonopoly: true,
  commodityMonopoly: true,
  bishop: true,
  constitution: true,
  deserter: true,
  diplomat: true,
  intrigue: true,
  saboteur: true,
  spy: true,
  warlord: true,
  wedding: true,
};

const TRACKS: readonly ImprovementTrack[] = ['trade', 'politics', 'science'];

describe('CK_PROGRESS_DECK_COMPOSITION (C6.5)', () => {
  it('has exactly 25 distinct card names', () => {
    expect(Object.keys(ALL_PROGRESS_CARDS)).toHaveLength(25);
  });

  it('each deck sums to 18 cards', () => {
    for (const track of TRACKS) {
      const total = CK_PROGRESS_DECK_COMPOSITION[track].reduce((sum, e) => sum + e.count, 0);
      expect(total).toBe(18);
    }
  });

  it('ckDeckCards expands each track to 18 physical cards, 54 total', () => {
    let total = 0;
    for (const track of TRACKS) {
      const cards = ckDeckCards(track);
      expect(cards).toHaveLength(18);
      total += cards.length;
    }
    expect(total).toBe(54);
  });

  it('every distinct card name is assigned to exactly one deck (no omissions, no duplicates)', () => {
    const seen = new Set<ProgressCardId>();
    for (const track of TRACKS) {
      for (const { card } of CK_PROGRESS_DECK_COMPOSITION[track]) {
        expect(seen.has(card)).toBe(false); // never assigned to two decks
        seen.add(card);
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(ALL_PROGRESS_CARDS).sort());
  });

  it('matches the exact C6.5 counts per track', () => {
    const byName = (track: ImprovementTrack) =>
      Object.fromEntries(CK_PROGRESS_DECK_COMPOSITION[track].map((e) => [e.card, e.count]));

    expect(byName('science')).toEqual({
      alchemist: 2,
      crane: 2,
      engineer: 1,
      inventor: 2,
      irrigation: 2,
      medicine: 2,
      mining: 2,
      printer: 1,
      roadBuilding: 2,
      smith: 2,
    });
    expect(byName('trade')).toEqual({
      merchant: 6,
      merchantFleet: 2,
      commercialHarbor: 2,
      masterMerchant: 2,
      resourceMonopoly: 4,
      commodityMonopoly: 2,
    });
    expect(byName('politics')).toEqual({
      bishop: 2,
      constitution: 1,
      deserter: 2,
      diplomat: 2,
      intrigue: 2,
      saboteur: 2,
      spy: 3,
      warlord: 2,
      wedding: 2,
    });
  });
});

describe('Cities & Knights numeric constants', () => {
  it('C1.1 target VP is 13', () => {
    expect(CK_TARGET_VP).toBe(13);
  });

  it('C8.2 barbarian steps-to-attack is the provisional 7', () => {
    expect(CK_BARBARIAN_STEPS_TO_ATTACK).toBe(7);
  });

  it('C3.1 commodity supply is 12 per commodity (36 total)', () => {
    expect(CK_COMMODITY_SUPPLY).toBe(12);
    expect(CK_COMMODITY_SUPPLY * 3).toBe(36);
  });

  it('C7.1 knight caps are 2 basic / 2 strong / 2 mighty', () => {
    expect(CK_KNIGHT_CAP).toEqual({ 1: 2, 2: 2, 3: 2 });
  });

  it('C6.3 progress-card hand limit is 4', () => {
    expect(CK_PROGRESS_HAND_LIMIT).toBe(4);
  });

  it('C9: discard limit is base 7 + 2/wall, max 3 walls (7/9/11/13)', () => {
    expect(CK_DISCARD_LIMIT_BASE).toBe(7);
    expect(CK_DISCARD_LIMIT_PER_WALL).toBe(2);
    expect(CK_MAX_WALLS).toBe(3);
    const limits = [0, 1, 2, 3].map((walls) => CK_DISCARD_LIMIT_BASE + walls * CK_DISCARD_LIMIT_PER_WALL);
    expect(limits).toEqual([7, 9, 11, 13]);
  });

  it('C4.2 improvement cost to level L is exactly L', () => {
    expect([1, 2, 3, 4, 5].map((l) => ckImprovementCost(l as 1 | 2 | 3 | 4 | 5))).toEqual([1, 2, 3, 4, 5]);
  });

  it('C4.4 card-draw eligibility is red <= level+1, never at level 0', () => {
    expect(ckCardDrawEligible(0, 1)).toBe(false);
    expect(ckCardDrawEligible(1, 2)).toBe(true);
    expect(ckCardDrawEligible(1, 3)).toBe(false);
    expect(ckCardDrawEligible(3, 4)).toBe(true);
    expect(ckCardDrawEligible(5, 6)).toBe(true);
  });
});
