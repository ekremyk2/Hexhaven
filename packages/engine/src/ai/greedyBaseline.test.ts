// T-410 sanity tests for the benchmark opponent: `chooseGreedyAction` always returns a legal action
// and is deterministic given the same `(state, seat, rng)` — thin coverage since its real job is
// being the fixed target the dominance bar (ai/benchmark.test.ts) measures against.

import { describe, expect, it } from 'vitest';
import type { GameState } from '@hexhaven/shared';
import { reduce } from '../reduce.js';
import { hashSeed } from '../rng.js';
import { stateWith } from '../testkit.js';
import { chooseGreedyAction } from './greedyBaseline.js';

describe('chooseGreedyAction', () => {
  it('always returns a legal action', () => {
    const s: GameState = { ...stateWith(), phase: { kind: 'preRoll' }, turn: { number: 5, player: 0, rolled: false, roll: null, devPlayed: false } };
    const { action } = chooseGreedyAction(s, 0, hashSeed('greedy-legality'));
    const result = reduce(s, 0, action);
    expect(result.ok).toBe(true);
  });

  it('is deterministic given the same (state, seat, rng)', () => {
    const s = stateWith();
    const rng = hashSeed('greedy-determinism');
    const a = chooseGreedyAction(s, 0, rng);
    const b = chooseGreedyAction(s, 0, rng);
    expect(a).toEqual(b);
  });

  it('never proposes endTurn when a strictly better-scoring build is available', () => {
    // The testkit base has every player able to afford nothing beyond a road typically; craft a
    // state where seat 0 can clearly afford a settlement that raises its evaluate() score.
    const s: GameState = {
      ...stateWith(),
      players: stateWith().players.map((p) =>
        p.seat === 0 ? { ...p, resources: { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 0 } } : p
      ),
    };
    const { action } = chooseGreedyAction(s, 0, hashSeed('greedy-prefers-build'));
    // Not a hard assertion on WHICH action (many legal builds may exist) — just that it isn't the
    // no-op when a resource-consuming build was affordable and legal.
    expect(action.type).not.toBe('endTurn');
  });
});
