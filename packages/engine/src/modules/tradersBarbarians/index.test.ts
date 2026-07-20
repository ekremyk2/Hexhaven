// T-1001 skeleton (scenario registry + config gating) + T-1002 (`fishermen` ships) + T-1003
// (`rivers` ships) + T-1004 (`caravans` ships) + T-1005 (`barbarianAttack` ships) + T-1006
// (`tradersBarbarians`, the main scenario, ships — LAST of the five): all five now resolve to the
// module; every other declared scenario stays rejected "coming soon" until its own task lands. A
// base config is unaffected (RK-13).
import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { resolveModules } from '../index.js';
import { SHIPPED_TB_SCENARIOS, TB_SCENARIO_IDS, TB_SCENARIO_SUPPORTS_56, isTBScenarioId } from './index.js';

function cfg(over: Partial<GameConfig['expansions']> = {}, playerCount: 3 | 4 | 5 | 6 = 4): Pick<GameConfig, 'expansions' | 'playerCount'> {
  return {
    playerCount,
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false, ...over },
  };
}

describe('Traders & Barbarians scenario registry (TB1.1)', () => {
  it('declares the five scenarios', () => {
    expect([...TB_SCENARIO_IDS]).toEqual(['fishermen', 'rivers', 'caravans', 'barbarianAttack', 'tradersBarbarians']);
  });

  it('isTBScenarioId accepts declared ids, rejects others', () => {
    expect(isTBScenarioId('fishermen')).toBe(true);
    expect(isTBScenarioId('tradersBarbarians')).toBe(true);
    expect(isTBScenarioId('nope')).toBe(false);
  });
});

describe('resolveModules — T&B gating (T-1001/T-1002)', () => {
  it('resolves the fishermen module now that T-1002 ships it', () => {
    const r = resolveModules(cfg({ tradersBarbarians: { scenario: 'fishermen' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules.map((m) => m.id)).toEqual(['tradersBarbarians']);
  });

  it('resolves the rivers module now that T-1003 ships it', () => {
    expect(SHIPPED_TB_SCENARIOS.has('rivers')).toBe(true);
    const r = resolveModules(cfg({ tradersBarbarians: { scenario: 'rivers' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules.map((m) => m.id)).toEqual(['tradersBarbarians']);
  });

  it('resolves the caravans module now that T-1004 ships it', () => {
    expect(SHIPPED_TB_SCENARIOS.has('caravans')).toBe(true);
    const r = resolveModules(cfg({ tradersBarbarians: { scenario: 'caravans' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules.map((m) => m.id)).toEqual(['tradersBarbarians']);
  });

  it('resolves the barbarianAttack module now that T-1005 ships it', () => {
    expect(SHIPPED_TB_SCENARIOS.has('barbarianAttack')).toBe(true);
    const r = resolveModules(cfg({ tradersBarbarians: { scenario: 'barbarianAttack' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules.map((m) => m.id)).toEqual(['tradersBarbarians']);
  });

  it('resolves the tradersBarbarians (main scenario) module now that T-1006 ships it', () => {
    expect(SHIPPED_TB_SCENARIOS.has('tradersBarbarians')).toBe(true);
    const r = resolveModules(cfg({ tradersBarbarians: { scenario: 'tradersBarbarians' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules.map((m) => m.id)).toEqual(['tradersBarbarians']);
  });

  it('rejects an unknown T&B scenario id', () => {
    const r = resolveModules(cfg({ tradersBarbarians: { scenario: 'atlantis' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('EXPANSION_NOT_AVAILABLE');
  });

  it('rejects T&B combined with another expansion (standalone only for now)', () => {
    const r = resolveModules(cfg({ tradersBarbarians: { scenario: 'fishermen' }, citiesKnights: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('EXPANSION_NOT_AVAILABLE');
  });

  it('a base config (no T&B) resolves no modules — RK-13-safe', () => {
    const r = resolveModules(cfg());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules).toEqual([]);
  });
});

describe('resolveModules — T&B 5–6 framework (T-1050, Phase 10B)', () => {
  it('declares every T&B scenario as 5–6-capable (T-1050 fishermen, T-1051 rivers, T-1052 barbarianAttack, T-1053 caravans, T-1054 tradersBarbarians — the last one)', () => {
    expect(TB_SCENARIO_SUPPORTS_56).toEqual({
      fishermen: true,
      rivers: true,
      caravans: true,
      barbarianAttack: true,
      tradersBarbarians: true,
    });
  });

  for (const playerCount of [5, 6] as const) {
    it(`resolves fishermen + fiveSix at ${playerCount} players (T-1050 base 30-hex EXT56 board)`, () => {
      const r = resolveModules(cfg({ fiveSix: true, tradersBarbarians: { scenario: 'fishermen' } }, playerCount));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.modules.map((m) => m.id)).toEqual(['fiveSix', 'tradersBarbarians']);
    });

    it(`resolves rivers + fiveSix at ${playerCount} players (T-1051 base 30-hex EXT56 board)`, () => {
      const r = resolveModules(cfg({ fiveSix: true, tradersBarbarians: { scenario: 'rivers' } }, playerCount));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.modules.map((m) => m.id)).toEqual(['fiveSix', 'tradersBarbarians']);
    });

    it(`resolves caravans + fiveSix at ${playerCount} players (T-1053 base 30-hex EXT56 board)`, () => {
      const r = resolveModules(cfg({ fiveSix: true, tradersBarbarians: { scenario: 'caravans' } }, playerCount));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.modules.map((m) => m.id)).toEqual(['fiveSix', 'tradersBarbarians']);
    });

    it(`resolves tradersBarbarians (main scenario) + fiveSix at ${playerCount} players (T-1054 base 30-hex EXT56 board — the last T&B scenario to gain 5–6 support)`, () => {
      const r = resolveModules(cfg({ fiveSix: true, tradersBarbarians: { scenario: 'tradersBarbarians' } }, playerCount));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.modules.map((m) => m.id)).toEqual(['fiveSix', 'tradersBarbarians']);
    });
  }

  it('rejects fishermen + fiveSix at 3/4 players (fiveSix always needs 5/6)', () => {
    const r = resolveModules(cfg({ fiveSix: true, tradersBarbarians: { scenario: 'fishermen' } }, 4));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('EXPANSION_NOT_AVAILABLE');
  });

  it('still rejects T&B + fiveSix + Seafarers/C&K all at once', () => {
    const r = resolveModules(cfg({ fiveSix: true, citiesKnights: true, tradersBarbarians: { scenario: 'fishermen' } }, 5));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('EXPANSION_NOT_AVAILABLE');
  });

  it('a 3–4p fishermen config is unaffected (RK-13: fiveSix off plays exactly as before)', () => {
    const r = resolveModules(cfg({ tradersBarbarians: { scenario: 'fishermen' } }, 4));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules.map((m) => m.id)).toEqual(['tradersBarbarians']);
  });
});
