// winnability.ts (docs/07 D-034 "limits + winnability", the B-26-adjacent bugfix — a host who set
// targetVp above what the configured limits could ever deliver had no way to discover the game
// would soft-lock). Covers `maxAchievableVp`'s per-mode formula (base/fiveSix/Seafarers vs Cities &
// Knights), `effectiveTargetVp`'s resolution order (module override > scenario > config), the
// `'unbounded'` case (a limitless piece cap), the endless-game case (`targetVp: null`), and
// `isConfigWinnable`'s winnable/unwinnable/endless classification.

import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { LIMITLESS_CAP } from '@hexhaven/shared';
import { effectiveTargetVp, isConfigWinnable, maxAchievableVp } from './winnability.js';

function cfg(over: Partial<GameConfig> = {}): GameConfig {
  return {
    playerCount: 4,
    targetVp: 10,
    seed: 'winnability-test',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    ...over,
  };
}

describe('maxAchievableVp: base game', () => {
  it('sums buildings (4 cities x 2 + 5 settlements x 1) + longest road + largest army + dev VP', () => {
    const result = maxAchievableVp(cfg());
    expect(result.breakdown).toEqual({
      buildings: 13, // 4*2 + 5*1
      longestRoad: 2,
      largestArmy: 2,
      devCardVp: 5, // base DEV_DECK.victoryPoint
      metropolises: 0,
      progressCardVp: 0,
      harbormaster: 0,
    });
    expect(result.max).toBe(22);
    expect(result.notes).toEqual([]);
  });

  it('a raised piece cap (customConstants.maxCities/maxSettlements) raises the buildings component', () => {
    const result = maxAchievableVp(
      cfg({ modifiers: { customConstants: { maxCities: 6, maxSettlements: 8 } } })
    );
    expect(result.breakdown.buildings).toBe(6 * 2 + 8 * 1);
    expect(result.max).toBe(6 * 2 + 8 * 1 + 2 + 2 + 5);
  });

  it('a limitless piece cap (null) makes the total unbounded', () => {
    const result = maxAchievableVp(cfg({ modifiers: { customConstants: { maxCities: null } } }));
    expect(result.max).toBe('unbounded');
  });

  it('the harbormaster modifier adds its +2 VP award to the breakdown/total', () => {
    const result = maxAchievableVp(cfg({ modifiers: { harbormaster: true } }));
    expect(result.breakdown.harbormaster).toBe(2);
    expect(result.max).toBe(22 + 2);
  });

  it('Seafarers notes the excluded island-chit VP but does not change the numeric bound', () => {
    const base = maxAchievableVp(cfg());
    const sea = maxAchievableVp(
      cfg({ expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false } })
    );
    expect(sea.max).toBe(base.max);
    expect(sea.notes).toContain('seafarersIslandChitsUncounted');
  });
});

describe('maxAchievableVp: Cities & Knights', () => {
  const CK = cfg({ expansions: { fiveSix: false, seafarers: false, citiesKnights: true } });

  it('largestArmy and devCardVp are 0 (no Largest Army award, no dev deck, C11)', () => {
    const result = maxAchievableVp(CK);
    expect(result.breakdown.largestArmy).toBe(0);
    expect(result.breakdown.devCardVp).toBe(0);
  });

  it('adds 6 VP for 3 metropolises (+2 each) and 2 VP for Printer + Constitution', () => {
    const result = maxAchievableVp(CK);
    expect(result.breakdown.metropolises).toBe(6);
    expect(result.breakdown.progressCardVp).toBe(2);
  });

  it('longestRoad still contributes +2 (NOT removed in Cities & Knights, only Largest Army is)', () => {
    const result = maxAchievableVp(CK);
    expect(result.breakdown.longestRoad).toBe(2);
  });

  it('notes Defender of Hexhaven as an excluded, open-ended VP source', () => {
    const result = maxAchievableVp(CK);
    expect(result.notes).toContain('citiesKnightsDefenderUncapped');
  });

  it('sums to buildings(13) + longestRoad(2) + metropolises(6) + progressCardVp(2) = 23', () => {
    const result = maxAchievableVp(CK);
    expect(result.max).toBe(23);
  });
});

describe('effectiveTargetVp', () => {
  it('base config: the plain config.targetVp', () => {
    expect(effectiveTargetVp(cfg({ targetVp: 11 }))).toBe(11);
  });

  it('Cities & Knights: the module-resolved 13-VP target overrides config.targetVp', () => {
    const CK = cfg({ targetVp: 10, expansions: { fiveSix: false, seafarers: false, citiesKnights: true } });
    expect(effectiveTargetVp(CK)).toBe(13);
  });

  it('a Seafarers scenario resolves its own target (14 for Heading for New Shores)', () => {
    const sea = cfg({
      targetVp: 10,
      expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
    });
    expect(effectiveTargetVp(sea)).toBe(14);
  });

  it('customConstants.targetVp overrides everything, including a Cities & Knights game', () => {
    const CK = cfg({
      expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
      modifiers: { customConstants: { targetVp: 20 } },
    });
    expect(effectiveTargetVp(CK)).toBe(20);
  });

  it('customConstants.targetVp: null resolves to the finite LIMITLESS_CAP sentinel (endless game)', () => {
    const endless = cfg({ modifiers: { customConstants: { targetVp: null } } });
    // A large FINITE cap, not Infinity (Infinity can't cross JSON — see shared/constants.ts);
    // `isConfigWinnable` detects "endless" via the >= LIMITLESS_CAP threshold, not `!isFinite`.
    expect(effectiveTargetVp(endless)).toBe(LIMITLESS_CAP);
  });
});

describe('isConfigWinnable', () => {
  it('the default base config (target 10, max 22) is winnable', () => {
    const result = isConfigWinnable(cfg());
    expect(result).toEqual({ winnable: true, endless: false, maxAchievable: 22, reason: null });
  });

  it('a too-high target (25 > 22) is flagged unwinnable, with the reachable ceiling and a reason', () => {
    const result = isConfigWinnable(cfg({ targetVp: 25 }));
    expect(result.winnable).toBe(false);
    expect(result.endless).toBe(false);
    expect(result.maxAchievable).toBe(22);
    expect(result.reason).not.toBeNull();
  });

  it('exactly at the ceiling is winnable (the target IS reachable)', () => {
    const result = isConfigWinnable(cfg({ targetVp: 22 }));
    expect(result.winnable).toBe(true);
  });

  it('Cities & Knights at the real 13-VP target is winnable (max 23) — the bug this closes', () => {
    // The original bug report: a host reached 10/13 VP in a Cities & Knights-shaped game with no
    // path to more — this proves the DEFAULT C&K config is genuinely winnable (13 <= 23), so the
    // calculator only warns for configs that are ACTUALLY misconfigured (e.g. an inflated custom
    // target), not the shipped default.
    const CK = cfg({ expansions: { fiveSix: false, seafarers: false, citiesKnights: true } });
    const result = isConfigWinnable(CK);
    expect(result.winnable).toBe(true);
    expect(result.maxAchievable).toBe(23);
  });

  it('a Cities & Knights game with an inflated custom target (30 > 23) is flagged unwinnable', () => {
    const CK = cfg({
      expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
      modifiers: { customConstants: { targetVp: 30 } },
    });
    const result = isConfigWinnable(CK);
    expect(result.winnable).toBe(false);
    expect(result.maxAchievable).toBe(23);
  });

  it('a limitless piece cap reports maxAchievable "unbounded" and is always winnable', () => {
    const result = isConfigWinnable(cfg({ targetVp: 999, modifiers: { customConstants: { maxCities: null } } }));
    expect(result.winnable).toBe(true);
    expect(result.maxAchievable).toBe('unbounded');
  });

  it('an endless (limitless targetVp) config reports endless: true and winnable: true regardless of the max', () => {
    const result = isConfigWinnable(cfg({ modifiers: { customConstants: { targetVp: null } } }));
    expect(result.endless).toBe(true);
    expect(result.winnable).toBe(true);
    expect(result.reason).toBeNull();
  });
});
