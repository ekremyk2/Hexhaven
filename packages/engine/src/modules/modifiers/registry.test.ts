// T-901 (docs/07 D-034, docs/tasks/phase-9/PICKS.md): the modifier framework's resolution +
// compatibility-matrix tests. Mirrors modules/seafarers.test.ts's `cfg()` helper pattern. Proof-
// modifier END-TO-END behavior (customTargetVp changing the win threshold, combine2sAnd12s
// producing on 2/12, composing with an expansion) lives in the sibling customTargetVp.test.ts /
// combine2sAnd12s.test.ts — this file is the registry/matrix/RK-13-bit-identity layer.

import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { validateConfig } from '../../createGame.js';
import { simulate } from '../../sim/runGame.js';
import {
  citiesKnightsModule,
  MODIFIER_IDS,
  modifierAvailability,
  resolveConstants,
  resolveModules,
  seafarersModule,
} from '../index.js';
import { MODIFIERS } from './registry.js';

function cfg(over: Partial<GameConfig> = {}): GameConfig {
  return {
    playerCount: 4,
    targetVp: 10,
    seed: 'modifiers-test',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    ...over,
  };
}

describe('MODIFIER_IDS / MODIFIERS registry', () => {
  it('declares the two proof modifiers, the reserved eventCards id, wave A-1, cardMods/helpers, and customConstants', () => {
    expect(MODIFIER_IDS).toEqual([
      'customTargetVp',
      'combine2sAnd12s',
      'eventCards',
      'friendlyRobber',
      'playDevSameTurn',
      'harbormaster',
      'cardMods',
      'helpers',
      'customConstants',
      'hexPieces',
      'shuffleNumbers',
      'hiddenSetupNumbers',
    ]);
    expect(Object.keys(MODIFIERS).sort()).toEqual(
      [
        'combine2sAnd12s',
        'customTargetVp',
        'eventCards',
        'friendlyRobber',
        'playDevSameTurn',
        'harbormaster',
        'cardMods',
        'helpers',
        'customConstants',
        'hexPieces',
        'shuffleNumbers',
        'hiddenSetupNumbers',
      ].sort()
    );
  });
});

describe('resolveModules: modifiers stack AFTER expansion modules (T-901)', () => {
  it('a base config with no modifiers resolves the same [] as before (RK-13)', () => {
    const resolved = resolveModules(cfg());
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.modules).toEqual([]);
  });

  it('appends an enabled modifier after an active expansion, in MODIFIER_IDS order', () => {
    const c = cfg({
      expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
      modifiers: { combine2sAnd12s: true, customTargetVp: 12 },
    });
    const resolved = resolveModules(c);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.modules[0]).toBe(seafarersModule);
    // MODIFIER_IDS order is ['customTargetVp', 'combine2sAnd12s', ...], independent of the object
    // literal's key order above (D-004 determinism).
    expect(resolved.modules.map((m) => m.id)).toEqual(['seafarers', 'customTargetVp', 'combine2sAnd12s']);
  });

  it('a modifiers-empty config resolves identically to an absent modifiers key', () => {
    const withKey = resolveModules(cfg({ modifiers: {} }));
    const withoutKey = resolveModules(cfg());
    expect(withKey).toEqual(withoutKey);
  });
});

describe('resolveConstants: modifier constants fold on top of expansion + base (T-901)', () => {
  it('customTargetVp overrides the base targetVp', () => {
    const c = cfg({ modifiers: { customTargetVp: 7 } });
    expect(resolveConstants(c).targetVp).toBe(7);
  });

  it("customTargetVp overrides even Cities & Knights's own 13-VP target — modifiers fold last", () => {
    const c = cfg({
      expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
      modifiers: { customTargetVp: 20 },
    });
    expect(resolveConstants(c).targetVp).toBe(20);
  });

  it('is a no-op (base constants only) when no modifiers are enabled', () => {
    expect(resolveConstants(cfg()).targetVp).toBeUndefined();
  });
});

describe('compatibility matrix: MODIFIER_INCOMPATIBLE (docs/07 D-034)', () => {
  it('modifierAvailability marks eventCards unavailable once citiesKnights is active', () => {
    const withoutCk = modifierAvailability(cfg());
    expect(withoutCk.eventCards.available).toBe(true);

    const withCk = modifierAvailability(
      cfg({ expansions: { fiveSix: false, seafarers: false, citiesKnights: true } })
    );
    expect(withCk.eventCards.available).toBe(false);
    expect(withCk.eventCards.reason).toBe('eventCardsVsCitiesKnights');
    // The two proof modifiers are unaffected by the C&K/eventCards conflict.
    expect(withCk.customTargetVp.available).toBe(true);
    expect(withCk.combine2sAnd12s.available).toBe(true);
  });

  it('resolveModules rejects citiesKnights + eventCards with MODIFIER_INCOMPATIBLE', () => {
    const c = cfg({
      expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
      modifiers: { eventCards: true },
    });
    const resolved = resolveModules(c);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error.code).toBe('MODIFIER_INCOMPATIBLE');
    expect(validateConfig(c)?.code).toBe('MODIFIER_INCOMPATIBLE');
  });

  it('eventCards alone (no citiesKnights) is NOT rejected by resolveModules (only the combo is)', () => {
    const c = cfg({ modifiers: { eventCards: true } });
    const resolved = resolveModules(c);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.modules.map((m) => m.id)).toEqual(['eventCards']);
  });

  it('citiesKnights alone (no eventCards) is unaffected', () => {
    const c = cfg({ expansions: { fiveSix: false, seafarers: false, citiesKnights: true } });
    const resolved = resolveModules(c);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.modules).toEqual([citiesKnightsModule]);
  });
});

describe('RK-13: base/expansion sims are unaffected with no modifiers enabled', () => {
  it('a base-config simulation runs to completion exactly as without this task', () => {
    const r = simulate('modifiers-rk13-smoke');
    expect(r.turns).toBeGreaterThan(0);
  });
});
