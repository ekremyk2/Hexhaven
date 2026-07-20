// T-1005: the Barbarian Attack scenario's mode-specific invariants (docs/rules/traders-barbarians-
// rules.md §TB5), asserted after every successful transition of a barbarianAttack simulation on TOP
// of the generalized base I1–I10 in invariants.ts. Like invariants.ts, every check is a from-scratch
// recomputation over `next`, never a read of a flag the engine itself set.
//
//   BAR1  barbarian PLACEMENT: every barbarian sits on a real hex id, and the list never grows past
//         the single starting wave (T-1052, 5–6: `barbarianGeometryFor`'s `startHexes.length`,
//         recomputed from THIS game's geometry + player count, not always the base 3-4p constant)
//         — the v1 "no respawn" design that guarantees this mechanic terminates.
//   BAR2  knight SHAPE: every knight sits on a real edge id, names a real seat, and at most one
//         knight occupies any given edge.
//   BAR3  captured/gold non-negative, one entry per real seat.
//   BAR4  captured-barbarian VP: `computeVp`'s `barbarianAttackVp` matches an independent
//         recomputation from `ext.capturedBarbarians` (never trusting the engine's own value).

import type { Action, GameEvent, GameState } from '@hexhaven/shared';
import { computeVp } from '../vp.js';
import { geometryForState } from '../modules/index.js';
import {
  CAPTURED_VP_DIVISOR,
  barbarianGeometryFor,
  barbarianWaveSizeFor,
} from '../modules/tradersBarbarians/barbarianAttack.js';
import { tbExt } from '../modules/tradersBarbarians/state.js';

export class BarbarianAttackInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'BarbarianAttackInvariantViolationError';
  }
}

/** Running coverage tallies for the sim's report — never used to gate a check. */
export interface BarbarianAttackAccumulator {
  knightsRecruited: number;
  knightMoves: number;
  combatsResolved: number;
  pillages: number;
  dispersals: number;
}

export function initialBarbarianAttackAccumulator(): BarbarianAttackAccumulator {
  return { knightsRecruited: 0, knightMoves: 0, combatsResolved: 0, pillages: 0, dispersals: 0 };
}

function checkBarbarianPlacement(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  const barbarians = ext.barbarians ?? [];
  // T-1052 (5–6): the starting wave is a function of THIS game's geometry + player count (bigger
  // board/more seats scale the wave up, `barbarianWaveSizeFor`) rather than always the base
  // module's fixed 3-piece constant — recompute the expected bound the same way `createGame`
  // seeded it, never trusting a stored value.
  const geometry = geometryForState(state);
  const expectedWave = barbarianGeometryFor(geometry, barbarianWaveSizeFor(state.players.length)).startHexes.length;
  if (barbarians.length > expectedWave) {
    throw new BarbarianAttackInvariantViolationError(
      'BAR1',
      `${barbarians.length} barbarians on the board exceeds the ${expectedWave}-piece starting wave (v1: no respawn)`
    );
  }
  for (const hex of barbarians) {
    if (!geometry.hexes[hex]) {
      throw new BarbarianAttackInvariantViolationError('BAR1', `barbarian sits on unknown hex ${hex}`);
    }
  }
}

function checkKnightShape(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  const geometry = geometryForState(state);
  const realSeats = new Set(state.players.map((p) => p.seat));
  const seenEdges = new Set<number>();
  for (const k of ext.knights ?? []) {
    if (!geometry.edges[k.edge]) {
      throw new BarbarianAttackInvariantViolationError('BAR2', `knight sits on unknown edge ${k.edge}`);
    }
    if (!realSeats.has(k.seat)) {
      throw new BarbarianAttackInvariantViolationError('BAR2', `knight names unknown seat ${k.seat}`);
    }
    if (seenEdges.has(k.edge)) {
      throw new BarbarianAttackInvariantViolationError('BAR2', `edge ${k.edge} carries more than one knight`);
    }
    seenEdges.add(k.edge);
  }
}

function checkNonNegative(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  const captured = ext.capturedBarbarians ?? [];
  const gold = ext.gold ?? [];
  for (const p of state.players) {
    const c = captured[p.seat] ?? 0;
    if (c < 0) throw new BarbarianAttackInvariantViolationError('BAR3', `seat ${p.seat} capturedBarbarians is negative: ${c}`);
    const g = gold[p.seat] ?? 0;
    if (g < 0) throw new BarbarianAttackInvariantViolationError('BAR3', `seat ${p.seat} gold is negative: ${g}`);
  }
}

function checkCapturedVp(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  for (const p of state.players) {
    const captured = ext.capturedBarbarians?.[p.seat] ?? 0;
    const expected = Math.floor(captured / CAPTURED_VP_DIVISOR);
    const vp = computeVp(state, p.seat);
    if ((vp.barbarianAttackVp ?? 0) !== expected) {
      throw new BarbarianAttackInvariantViolationError(
        'BAR4',
        `seat ${p.seat} barbarianAttackVp=${vp.barbarianAttackVp} != expected floor(${captured}/${CAPTURED_VP_DIVISOR})=${expected}`
      );
    }
  }
}

/**
 * Runs BAR1–BAR4 against one successful transition, threading a running action-count tally purely
 * for the sim's coverage report (never used to gate a check). Throws
 * `BarbarianAttackInvariantViolationError` on the first violation; returns the accumulator
 * otherwise. No-op (immediate passthrough) outside a barbarianAttack game.
 */
export function checkBarbarianAttackInvariants(
  next: GameState,
  action: Action,
  events: readonly GameEvent[],
  acc: BarbarianAttackAccumulator
): BarbarianAttackAccumulator {
  const ext = tbExt(next);
  if (!ext || ext.scenario !== 'barbarianAttack') return acc;

  let knightsRecruited = acc.knightsRecruited;
  let knightMoves = acc.knightMoves;
  let combatsResolved = acc.combatsResolved;
  let pillages = acc.pillages;
  let dispersals = acc.dispersals;
  for (const e of events) {
    if (e.type === 'tbKnightRecruited') knightsRecruited += 1;
    if (e.type === 'tbKnightMoved') knightMoves += 1;
    if (e.type === 'tbBarbarianCombatResolved') combatsResolved += 1;
    if (e.type === 'tbBarbarianPillaged') pillages += 1;
    if (e.type === 'tbBarbarianDispersed') dispersals += 1;
  }
  void action;

  checkBarbarianPlacement(next);
  checkKnightShape(next);
  checkNonNegative(next);
  checkCapturedVp(next);

  return { knightsRecruited, knightMoves, combatsResolved, pillages, dispersals };
}
