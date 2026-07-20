// T-801: initCitiesKnightsExt shape + shuffle determinism (docs/rules/cities-knights-rules.md
// C2.2/C6.5/C12). The citiesKnights module isn't wired into resolveModules yet (T-802+), so these
// are pure unit tests of the exported ext-state helpers, not full-game integration tests.

import { describe, expect, it } from 'vitest';
import { CK_PROGRESS_DECK_COMPOSITION } from '@hexhaven/shared';
import type { ImprovementTrack } from '@hexhaven/shared';
import { stateWith } from '../../testkit.js';
import { hashSeed } from '../../rng.js';
import { citiesKnightsExt, commoditiesOf, initCitiesKnightsExt, isCitiesKnightsState } from './state.js';

const TRACKS: readonly ImprovementTrack[] = ['trade', 'politics', 'science'];

describe('initCitiesKnightsExt (T-801)', () => {
  it('builds zeroed per-seat state sized to playerCount (C2.2)', () => {
    const { ext } = initCitiesKnightsExt(4, hashSeed('ck-test'));

    expect(ext.commodities).toHaveLength(4);
    expect(ext.commodities).toEqual([
      { paper: 0, cloth: 0, coin: 0 },
      { paper: 0, cloth: 0, coin: 0 },
      { paper: 0, cloth: 0, coin: 0 },
      { paper: 0, cloth: 0, coin: 0 },
    ]);

    expect(ext.improvements).toHaveLength(4);
    expect(ext.improvements.every((i) => i.trade === 0 && i.politics === 0 && i.science === 0)).toBe(
      true
    );

    expect(ext.knights).toEqual([[], [], [], []]);
    expect(ext.walls).toEqual([[], [], [], []]);
    expect(ext.progressHand).toEqual([[], [], [], []]);
    expect(ext.defenderVp).toEqual([0, 0, 0, 0]);
  });

  it('sizes per-seat arrays to a 3-player game too', () => {
    const { ext } = initCitiesKnightsExt(3, hashSeed('ck-3p'));
    expect(ext.commodities).toHaveLength(3);
    expect(ext.improvements).toHaveLength(3);
    expect(ext.knights).toHaveLength(3);
    expect(ext.walls).toHaveLength(3);
    expect(ext.progressHand).toHaveLength(3);
    expect(ext.defenderVp).toHaveLength(3);
  });

  it('barbarian starts at the beginning of its track, no attacks resolved (C8.1)', () => {
    const { ext } = initCitiesKnightsExt(4, hashSeed('ck-barbarian'));
    expect(ext.barbarian).toEqual({ position: 0, attacksResolved: 0 });
  });

  it('no metropolis is placed yet (C4.6)', () => {
    const { ext } = initCitiesKnightsExt(4, hashSeed('ck-metropolis'));
    expect(ext.metropolis).toEqual({ trade: null, politics: null, science: null });
  });

  it('robber is locked and no merchant is placed (C10.1/C6.5)', () => {
    const { ext } = initCitiesKnightsExt(4, hashSeed('ck-robber'));
    expect(ext.robberLocked).toBe(true);
    expect(ext.merchant).toBeNull();
  });

  it('each progress deck has 18 cards matching the C6.5 composition, 54 total', () => {
    const { ext } = initCitiesKnightsExt(4, hashSeed('ck-decks'));

    let total = 0;
    for (const track of TRACKS) {
      const deck = ext.progressDecks[track];
      expect(deck).toHaveLength(18);
      total += deck.length;

      const counts = new Map<string, number>();
      for (const card of deck) counts.set(card, (counts.get(card) ?? 0) + 1);
      for (const { card, count } of CK_PROGRESS_DECK_COMPOSITION[track]) {
        expect(counts.get(card)).toBe(count);
      }
    }
    expect(total).toBe(54);
  });

  it('shuffles deterministically from the seeded rng: same seed -> same order', () => {
    const a = initCitiesKnightsExt(4, hashSeed('same-seed'));
    const b = initCitiesKnightsExt(4, hashSeed('same-seed'));
    expect(a.ext.progressDecks).toEqual(b.ext.progressDecks);
    expect(a.rng).toBe(b.rng);
  });

  it('a different seed produces a different deck order (at least one track differs)', () => {
    const a = initCitiesKnightsExt(4, hashSeed('seed-one'));
    const b = initCitiesKnightsExt(4, hashSeed('seed-two'));
    const anyDifferent = TRACKS.some(
      (t) => JSON.stringify(a.ext.progressDecks[t]) !== JSON.stringify(b.ext.progressDecks[t])
    );
    expect(anyDifferent).toBe(true);
  });

  it('advances the rng state (threading, docs/03 §6)', () => {
    const start = hashSeed('advance-check');
    const { rng } = initCitiesKnightsExt(4, start);
    expect(rng).not.toBe(start);
  });
});

describe('accessors default safely for a non-C&K state', () => {
  const base = stateWith(); // base config: expansions.citiesKnights: false — ext.citiesKnights is undefined

  it('isCitiesKnightsState is false', () => {
    expect(isCitiesKnightsState(base)).toBe(false);
  });

  it('citiesKnightsExt is undefined', () => {
    expect(citiesKnightsExt(base)).toBeUndefined();
  });

  it('commoditiesOf defaults to all-zero', () => {
    expect(commoditiesOf(base, 0)).toEqual({ paper: 0, cloth: 0, coin: 0 });
  });
});
