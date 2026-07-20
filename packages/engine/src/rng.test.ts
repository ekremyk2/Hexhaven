import { describe, expect, it } from 'vitest';
import { hashSeed, nextRand, pickIndex, rollDie, shuffle } from './rng.js';

describe('hashSeed (FNV-1a 32-bit)', () => {
  it('returns the offset basis for the empty string', () => {
    expect(hashSeed('')).toBe(0x811c9dc5);
  });

  it('is deterministic and produces unsigned 32-bit values', () => {
    for (const s of ['x', 'y', 'testkit', 'a longer seed with spaces', '🎲']) {
      const h = hashSeed(s);
      expect(hashSeed(s)).toBe(h);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('distinguishes different seeds', () => {
    expect(hashSeed('x')).not.toBe(hashSeed('y'));
    expect(hashSeed('ab')).not.toBe(hashSeed('ba'));
  });
});

describe('nextRand (mulberry32)', () => {
  it('yields values in [0, 1) and always advances the state', () => {
    let s = hashSeed('x');
    for (let i = 0; i < 1000; i++) {
      const r = nextRand(s);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(1);
      expect(r.state).not.toBe(s);
      s = r.state;
    }
  });

  it('is a pure function of the state', () => {
    const s = hashSeed('determinism');
    expect(nextRand(s)).toEqual(nextRand(s));
  });
});

describe('rollDie', () => {
  it('yields only 1–6 and hits every face over 200 rolls', () => {
    let s = hashSeed('dice');
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const r = rollDie(s);
      s = r.state;
      expect(r.value).toBeGreaterThanOrEqual(1);
      expect(r.value).toBeLessThanOrEqual(6);
      expect(Number.isInteger(r.value)).toBe(true);
      seen.add(r.value);
    }
    expect(seen.size).toBe(6);
  });
});

describe('pickIndex', () => {
  it('yields only 0…n−1 and hits every index over 300 draws (n = 5)', () => {
    let s = hashSeed('pick');
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const r = pickIndex(s, 5);
      s = r.state;
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(5);
      seen.add(r.value);
    }
    expect(seen.size).toBe(5);
  });

  it('n = 1 always yields 0 but still advances the state', () => {
    const s = hashSeed('one');
    const r = pickIndex(s, 1);
    expect(r.value).toBe(0);
    expect(r.state).not.toBe(s);
  });

  it('throws BUG: for non-positive or non-integer n', () => {
    expect(() => pickIndex(1, 0)).toThrow(/^BUG:/);
    expect(() => pickIndex(1, -3)).toThrow(/^BUG:/);
    expect(() => pickIndex(1, 2.5)).toThrow(/^BUG:/);
  });
});

describe('shuffle (Fisher–Yates)', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);

  it('returns a permutation and never mutates the input', () => {
    const input = Object.freeze(items.slice()) as readonly number[];
    const r = shuffle(hashSeed('x'), input);
    expect(r.array).not.toBe(input);
    expect([...r.array].sort((a, b) => a - b)).toEqual(items);
    expect(input).toEqual(items);
  });

  it('is deterministic for the same state and differs across states', () => {
    const a = shuffle(hashSeed('x'), items);
    const b = shuffle(hashSeed('x'), items);
    const c = shuffle(hashSeed('y'), items);
    expect(a.array).toEqual(b.array);
    expect(a.state).toBe(b.state);
    expect(a.array).not.toEqual(c.array);
  });

  it('consumes no rng draws for arrays of length 0 or 1', () => {
    const s = hashSeed('x');
    expect(shuffle(s, []).state).toBe(s);
    expect(shuffle(s, ['only']).state).toBe(s);
    expect(shuffle(s, ['only']).array).toEqual(['only']);
  });
});
