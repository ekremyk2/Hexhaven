// T-1101 skeleton: the Explorers & Pirates scenario registry + resolveModules gating. No scenario is
// shipped yet, so every E&P selection is rejected "coming soon"; a base config is unaffected (RK-13).
import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { geometryForConfig, resolveBoardParams, resolveModules } from '../index.js';
import { EP_SCENARIO_IDS, EP_SCENARIO_SUPPORTS_56, LAND_HO_56_GEOMETRY, isEPScenarioId } from './index.js';

function cfg(over: Partial<GameConfig['expansions']> = {}, playerCount: 3 | 4 | 5 | 6 = 4): Pick<GameConfig, 'expansions' | 'playerCount'> {
  return {
    playerCount,
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false, ...over },
  };
}

describe('Explorers & Pirates scenario registry (EP1.1)', () => {
  it('declares the scenarios', () => {
    expect([...EP_SCENARIO_IDS]).toEqual(['landHo', 'fishForHexhaven', 'spicesForHexhaven', 'pirateLairs', 'fullCampaign']);
  });

  it('isEPScenarioId accepts declared ids, rejects others', () => {
    expect(isEPScenarioId('landHo')).toBe(true);
    expect(isEPScenarioId('fullCampaign')).toBe(true);
    expect(isEPScenarioId('nope')).toBe(false);
  });
});

describe('resolveModules — E&P gating (T-1101/T-1107)', () => {
  it('accepts landHo now that it has shipped (T-1107)', () => {
    const r = resolveModules(cfg({ explorersPirates: { scenario: 'landHo' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules).toHaveLength(1);
  });

  it('accepts fishForHexhaven now that it has shipped (T-1111)', () => {
    const r = resolveModules(cfg({ explorersPirates: { scenario: 'fishForHexhaven' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules).toHaveLength(1);
  });

  it('accepts spicesForHexhaven now that it has shipped (T-1112)', () => {
    const r = resolveModules(cfg({ explorersPirates: { scenario: 'spicesForHexhaven' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules).toHaveLength(1);
  });

  it('accepts pirateLairs now that it has shipped (T-1113)', () => {
    const r = resolveModules(cfg({ explorersPirates: { scenario: 'pirateLairs' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules).toHaveLength(1);
  });

  it('accepts fullCampaign now that it has shipped (T-1114) — every declared E&P scenario is shipped', () => {
    const r = resolveModules(cfg({ explorersPirates: { scenario: 'fullCampaign' } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules).toHaveLength(1);
  });

  it('rejects an unknown E&P scenario id', () => {
    const r = resolveModules(cfg({ explorersPirates: { scenario: 'atlantis' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('EXPANSION_NOT_AVAILABLE');
  });

  it('rejects E&P combined with another expansion (standalone only for now)', () => {
    const r = resolveModules(cfg({ explorersPirates: { scenario: 'landHo' }, citiesKnights: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('EXPANSION_NOT_AVAILABLE');
  });

  it('a base config (no E&P) resolves no modules — RK-13-safe', () => {
    const r = resolveModules(cfg());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules).toEqual([]);
  });
});

describe('resolveModules — E&P 5–6 gating (T-1150/T-1152, Phase 11B)', () => {
  it('declares every shipped E&P scenario as 5–6-capable (T-1152 extended landHo-only to all five)', () => {
    expect(EP_SCENARIO_SUPPORTS_56).toEqual({
      landHo: true,
      fishForHexhaven: true,
      spicesForHexhaven: true,
      pirateLairs: true,
      fullCampaign: true,
    });
  });

  it('accepts landHo + fiveSix at 5 players', () => {
    const r = resolveModules(cfg({ explorersPirates: { scenario: 'landHo' }, fiveSix: true }, 5));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules).toHaveLength(2); // fiveSixModule + explorersPiratesModule
  });

  it('accepts landHo + fiveSix at 6 players', () => {
    const r = resolveModules(cfg({ explorersPirates: { scenario: 'landHo' }, fiveSix: true }, 6));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules).toHaveLength(2);
  });

  it('rejects landHo + fiveSix at 3/4 players (defense in depth — the client never sends this)', () => {
    const r = resolveModules(cfg({ explorersPirates: { scenario: 'landHo' }, fiveSix: true }, 3));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('EXPANSION_NOT_AVAILABLE');
  });

  it('T-1152: accepts every shipped E&P scenario + fiveSix at 5/6 players (all now 5–6-capable)', () => {
    for (const scenario of EP_SCENARIO_IDS) {
      for (const pc of [5, 6] as const) {
        const r = resolveModules(cfg({ explorersPirates: { scenario }, fiveSix: true }, pc));
        expect(r.ok).toBe(true);
      }
    }
  });

  it('still rejects E&P + Seafarers/C&K/T&B even with fiveSix on', () => {
    const r = resolveModules(
      cfg({ explorersPirates: { scenario: 'landHo' }, fiveSix: true, citiesKnights: true }, 5)
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('EXPANSION_NOT_AVAILABLE');
  });

  it('every existing 3–4 E&P scenario is unaffected (fiveSix off, RK-13)', () => {
    for (const scenario of EP_SCENARIO_IDS) {
      const r = resolveModules(cfg({ explorersPirates: { scenario } }));
      expect(r.ok).toBe(true);
    }
  });
});

describe('geometryForConfig / resolveBoardParams — E&P 5–6 (T-1150)', () => {
  const base3p = cfg({ explorersPirates: { scenario: 'landHo' } }, 4);
  const fiveSix5p = {
    ...base3p,
    playerCount: 5 as const,
    expansions: { ...base3p.expansions, explorersPirates: { scenario: 'landHo' }, fiveSix: true },
  };

  it('a 3–4 E&P config resolves the base 19-hex GEOMETRY (unchanged)', () => {
    const geo = geometryForConfig(base3p);
    expect(geo.hexes).toHaveLength(19);
  });

  it('a 5–6 E&P (landHo) config resolves the bigger 37-hex LAND_HO_56_GEOMETRY', () => {
    const geo = geometryForConfig(fiveSix5p);
    expect(geo).toBe(LAND_HO_56_GEOMETRY);
    expect(geo.hexes).toHaveLength(37);
  });

  it('resolveBoardParams scales the terrain/token multiset for a 5–6 E&P config', () => {
    const params34 = resolveBoardParams(base3p);
    const params56 = resolveBoardParams(fiveSix5p);
    const total34 = Object.values(params34.terrainCounts).reduce((a, b) => a + b, 0);
    const total56 = Object.values(params56.terrainCounts).reduce((a, b) => a + b, 0);
    expect(total34).toBe(7);
    expect(total56).toBe(19);
    expect(params56.tokenSpiral).toHaveLength(18);
  });
});
