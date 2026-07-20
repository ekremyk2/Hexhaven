// RK-13 base-game regression oracle (docs/10 §3, §7): base-game behavior with all expansion
// toggles OFF must be BIT-IDENTICAL before and after a module merges. This pins a fingerprint of
// the full simulation trajectory (winner, turn/action counts, awards, and a digest of the entire
// action log) over a fixed seed set. The baseline digest below was verified to match pristine
// pre-T-601 code (an independent SHA-256 capture agreed); if any base code path changed
// observably, this test fails.
//
// The 5–6 module threads geometry/constants through the engine via config-driven resolvers that
// return the SAME frozen base objects when fiveSix is off — so this fingerprint is unchanged.
// (node:crypto is banned in packages/engine for purity, so the digest uses a deterministic
// FNV-1a/xorshift string hash — pure arithmetic, no I/O or nondeterminism.)

import { describe, expect, it } from 'vitest';
import { simulate } from './sim/runGame.js';

// Re-pinned when bot-initiated domestic trades were re-enabled (B-21 → B-48): the sim's bots now
// offer/confirm/cancel and only accept when they can fulfill, so the fixed-seed base trajectories
// legitimately changed. Previous baseline (bot trades disabled): '104ce29186683e48'. The re-pin was
// verified alongside the 1000-game invariant sim passing (games complete, no trade loop, I1 bank/hand
// conservation holds) — i.e. this is an intentional AI-behavior change, not an engine regression.
const RK13_BASELINE = '9f18620a924f5596';

/** Deterministic 64-bit-ish string digest as 16 hex chars (two chained FNV-1a passes). */
function digest(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc9dc5118;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 3) | (c >>> 5)), 0x01000193) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

describe('RK-13 base-game regression oracle', () => {
  it('fixed-seed base-game simulation is bit-identical to the pre-module baseline', () => {
    const per: string[] = [];
    for (let i = 0; i < 50; i++) {
      const r = simulate(`sim-${i}`);
      per.push(
        `${r.seed}|w${r.winner}|t${r.turns}|a${r.actions}|lr${r.longestRoadHolder}:${r.longestRoadLength}|la${r.largestArmyHolder}:${r.largestArmyCount}|${digest(JSON.stringify(r.log))}`
      );
    }
    expect(digest(per.join('\n'))).toBe(RK13_BASELINE);
  }, 60_000);
});
