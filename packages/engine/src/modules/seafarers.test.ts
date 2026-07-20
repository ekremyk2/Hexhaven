// T-701: Seafarers module registry gating. The scenario foundation ships, so `resolveModules` now
// RESOLVES a valid `seafarers: { scenario }` to the skeleton module (rejecting only unknown scenario
// ids). T-802 activates `citiesKnights` the same way (see the neighboring describe block below) —
// it is no longer the "still unshipped" expansion; it stays hidden from users only at the
// client/lobby layer (SHIPPED_EXPANSIONS.citiesKnights / apps/server/src/lobby.ts). Base + fiveSix
// bit-identity (RK-13, the 5–6 sim) is proven by their own suites — here we only check the gate.

import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { validateConfig } from '../createGame.js';
import { activeModules, citiesKnightsModule, resolveModules, seafarersModule } from './index.js';

function cfg(over: Partial<GameConfig> = {}): GameConfig {
  return {
    playerCount: 4,
    targetVp: 10,
    seed: 'seafarers-test',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    ...over,
  };
}

describe('seafarers module gating (T-701)', () => {
  it('resolves a valid scenario to the seafarers module', () => {
    const c = cfg({ expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false } });
    const resolved = resolveModules(c);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.modules).toContain(seafarersModule);
    expect(activeModules(c)).toContain(seafarersModule);
    expect(validateConfig(c)).toBeNull();
  });

  it('rejects an unknown scenario id with EXPANSION_NOT_AVAILABLE', () => {
    const c = cfg({ expansions: { fiveSix: false, seafarers: { scenario: 'atlantis' }, citiesKnights: false } });
    const resolved = resolveModules(c);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error.code).toBe('EXPANSION_NOT_AVAILABLE');
    expect(validateConfig(c)?.code).toBe('EXPANSION_NOT_AVAILABLE');
  });

  it('T-802: citiesKnights now resolves to its module instead of being rejected', () => {
    const c = cfg({ expansions: { fiveSix: false, seafarers: false, citiesKnights: true } });
    const resolved = resolveModules(c);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.modules).toContain(citiesKnightsModule);
    expect(activeModules(c)).toContain(citiesKnightsModule);
    expect(validateConfig(c)).toBeNull();
  });

  it('is inert with seafarers off: no modules resolved for a base config', () => {
    expect(activeModules(cfg())).toEqual([]);
  });

  it('combines with the fiveSix module at 5–6 players once the scenario ships a 5–6 board (T-750/T-751)', () => {
    // Phase 7B (T-750 framework + T-751) shipped 5/6-player boards for "Heading for New Shores", so the
    // 5–6 extension + Seafarers is now a SUPPORTED combined game at 5/6 players — the guard gates on the
    // selected scenario having a `boards[playerCount]` entry, not a blanket reject.
    const c = cfg({
      playerCount: 5,
      expansions: { fiveSix: true, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
    });
    expect(resolveModules(c).ok).toBe(true);
    expect(activeModules(c)).toContain(seafarersModule);
  });

  it('still rejects fiveSix + Seafarers at 3–4 players (the 5–6 extension needs 5–6 players)', () => {
    // The combo is only valid at 5/6 players; a fiveSix flag with a 3/4-player count is still rejected.
    const c = cfg({
      playerCount: 4,
      expansions: { fiveSix: true, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
    });
    expect(resolveModules(c).ok).toBe(false);
  });
});
