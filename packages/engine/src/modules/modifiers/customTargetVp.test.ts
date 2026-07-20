// T-901 proof modifier #1 end-to-end: customTargetVp overrides the win threshold via createGame,
// and composes with an expansion (Seafarers) — the constant-override archetype (docs/07 D-034).

import { describe, expect, it } from 'vitest';
import type { GameConfig, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { checkWin } from '../../vp.js';

function cfg(over: Partial<GameConfig> = {}): GameConfig {
  return {
    playerCount: 4,
    targetVp: 10,
    seed: 'custom-target-vp-test',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    ...over,
  };
}

/** Gives `seat` exactly `n` settlements at distinct vertex ids — enough for `computeVp` to count
 *  `n` VP without needing a legally-connected board (checkWin/computeVp only read the arrays). */
function withSettlements(state: ReturnType<typeof createGame>, seat: number, n: number) {
  return {
    ...state,
    players: state.players.map((p) =>
      p.seat === seat ? { ...p, settlements: Array.from({ length: n }, (_, i) => i as VertexId) } : p
    ),
  };
}

describe('customTargetVp (T-901 proof #1: constant-override modifier)', () => {
  it('createGame resolves state.config.targetVp to the modifier param, not the config default', () => {
    const state = createGame(cfg({ modifiers: { customTargetVp: 3 } }));
    expect(state.config.targetVp).toBe(3);
  });

  it('a base game with no modifier keeps the config target (RK-13 bit-identity)', () => {
    const state = createGame(cfg());
    expect(state.config.targetVp).toBe(10);
  });

  it('end-to-end: checkWin ends the game at the CUSTOM threshold, not the base 10', () => {
    const state = createGame(cfg({ modifiers: { customTargetVp: 3 } }));
    const at2 = withSettlements(state, 0, 2);
    expect(checkWin(at2, 0)).toBe(at2); // 2 VP < custom target 3 — no win yet
    const at3 = withSettlements(state, 0, 3);
    expect(checkWin(at3, 0).phase).toEqual({ kind: 'ended', winner: 0 });
  });

  it('the SAME VP count that wins at a low custom target does not win at the base target', () => {
    const base = createGame(cfg());
    const at3 = withSettlements(base, 0, 3);
    expect(checkWin(at3, 0)).toBe(at3); // 3 VP < base target 10
  });

  it('composes with an expansion: Seafarers scenario + customTargetVp — the modifier wins', () => {
    const state = createGame(
      cfg({
        expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
        modifiers: { customTargetVp: 5 },
      })
    );
    // The scenario alone would set targetVp to 14 (S10.1) — the modifier, folded AFTER the
    // expansion module in resolveConstants, overrides it to 5 instead.
    expect(state.config.targetVp).toBe(5);
    const at5 = withSettlements(state, 1, 5);
    expect(checkWin(at5, 1).phase).toEqual({ kind: 'ended', winner: 1 });
  });

  it('without the modifier, the same Seafarers scenario keeps its own 14-VP target', () => {
    const state = createGame(
      cfg({ expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false } })
    );
    expect(state.config.targetVp).toBe(14);
  });
});
