// Deterministic RNG (docs/03 §6) — the only randomness source in the engine (docs/05 §2).
// The rng state is a plain 32-bit unsigned integer living in `GameState.rng`; every function
// here is pure and returns the advanced state alongside its value, so consumers thread it.
// hashSeed/nextRand are the docs/03 §6 reference implementation, used verbatim.

/** FNV-1a 32-bit string hash — turns `GameConfig.seed` into the initial rng state. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 step: advances the state and yields a float in [0, 1). */
// Identical to the docs/03 §6 reference except `const a` (its `let a` trips prefer-const).
export function nextRand(state: number): { state: number; value: number } {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { state: a, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

/** One d6 roll, 1–6 (R1.2: two of these summed give 2–12). */
export function rollDie(state: number): { state: number; value: number } {
  const r = nextRand(state);
  return { state: r.state, value: 1 + Math.floor(r.value * 6) };
}

/** Uniform integer in 0…n−1. `n` must be a positive integer. */
export function pickIndex(state: number, n: number): { state: number; value: number } {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`BUG: pickIndex requires a positive integer n, got ${n}`);
  }
  const r = nextRand(state);
  return { state: r.state, value: Math.floor(r.value * n) };
}

/**
 * Fisher–Yates shuffle. Returns a NEW array (input untouched). Arrays of length 0 or 1
 * consume no rng draws.
 */
export function shuffle<T>(state: number, array: readonly T[]): { state: number; array: T[] } {
  const out = array.slice();
  let s = state;
  for (let i = out.length - 1; i >= 1; i--) {
    const r = pickIndex(s, i + 1);
    s = r.state;
    const j = r.value;
    // Indices are in range by construction; casts only strip `| undefined` from
    // noUncheckedIndexedAccess.
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return { state: s, array: out };
}
