// T-1006: the main scenario's mode-specific invariants (docs/rules/traders-barbarians-rules.md
// §TB6), asserted after every successful transition of a tradersBarbarians-scenario simulation on
// TOP of the generalized base I1–I10 in invariants.ts. Like invariants.ts, every check is a
// from-scratch recomputation over `next`, never a read of a flag the engine itself set. Mirrors
// barbarianAttackInvariants.ts's shape/naming convention (TBM# here vs BAR# there).
//
//   TBM1  wagon COUNT: each seat's wagon count is EXACTLY its city count (one wagon per city ever
//         built, never removed — `applyWagonPlacement` fires unconditionally on every `buildCity`).
//   TBM2  wagon SHAPE: every wagon sits on a real vertex id, names a real seat, and its cargo (if
//         any) is one of the four `TBCommodity` values.
//   TBM3  commodities/gold/deliveries all non-negative, one entry per real seat.
//   TBM4  path barbarians sit on real edge ids.
//   TBM5  delivery VP: `computeVp`'s `tradersBarbariansMainVp` matches an independent
//         recomputation from `ext.deliveries` (never trusting the engine's own value).
//
// T-1054 (5–6): `checkWagonShape`/`checkPathBarbarians` now read THIS game's resolved geometry
// (`geometryForState`, base or `GEOMETRY_EXT56`) rather than always the base `GEOMETRY` — mirrors
// caravansInvariants.ts/barbarianAttackInvariants.ts's own T-1052/T-1053 rework, so a 5–6 wagon
// vertex / path-barbarian edge on the bigger board isn't wrongly flagged as "unknown".

import type { Action, GameEvent, GameState } from '@hexhaven/shared';
import { computeVp } from '../vp.js';
import { geometryForState } from '../modules/index.js';
import { TB_COMMODITIES } from '../modules/tradersBarbarians/main.js';
import { tbExt } from '../modules/tradersBarbarians/state.js';

export class TradersBarbariansMainInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'TradersBarbariansMainInvariantViolationError';
  }
}

/** Running coverage tallies for the sim's report — never used to gate a check. */
export interface TradersBarbariansMainAccumulator {
  wagonsPlaced: number;
  wagonMoves: number;
  deliveriesCompleted: number;
}

export function initialTradersBarbariansMainAccumulator(): TradersBarbariansMainAccumulator {
  return { wagonsPlaced: 0, wagonMoves: 0, deliveriesCompleted: 0 };
}

function checkWagonCount(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  const wagons = ext.wagons ?? [];
  for (const p of state.players) {
    const mine = wagons.filter((w) => w.seat === p.seat).length;
    if (mine !== p.cities.length) {
      throw new TradersBarbariansMainInvariantViolationError(
        'TBM1',
        `seat ${p.seat} has ${mine} wagon(s) but ${p.cities.length} cities (one wagon per city, §TB6.2)`
      );
    }
  }
}

function checkWagonShape(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  const realSeats = new Set(state.players.map((p) => p.seat));
  const geometry = geometryForState(state);
  for (const w of ext.wagons ?? []) {
    if (!geometry.vertices[w.at]) {
      throw new TradersBarbariansMainInvariantViolationError('TBM2', `wagon sits on unknown vertex ${w.at}`);
    }
    if (!realSeats.has(w.seat)) {
      throw new TradersBarbariansMainInvariantViolationError('TBM2', `wagon names unknown seat ${w.seat}`);
    }
    if (w.cargo !== null && !(TB_COMMODITIES as readonly string[]).includes(w.cargo)) {
      throw new TradersBarbariansMainInvariantViolationError('TBM2', `wagon carries an unknown commodity '${w.cargo}'`);
    }
  }
}

function checkNonNegative(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  for (const p of state.players) {
    const stock = ext.commodities?.[p.seat];
    if (stock) {
      for (const commodity of TB_COMMODITIES) {
        const amount = stock[commodity] ?? 0;
        if (amount < 0) {
          throw new TradersBarbariansMainInvariantViolationError(
            'TBM3',
            `seat ${p.seat} ${commodity} stock is negative: ${amount}`
          );
        }
      }
    }
    const gold = ext.gold?.[p.seat] ?? 0;
    if (gold < 0) {
      throw new TradersBarbariansMainInvariantViolationError('TBM3', `seat ${p.seat} gold is negative: ${gold}`);
    }
    const deliveries = ext.deliveries?.[p.seat] ?? 0;
    if (deliveries < 0) {
      throw new TradersBarbariansMainInvariantViolationError(
        'TBM3',
        `seat ${p.seat} deliveries is negative: ${deliveries}`
      );
    }
  }
}

function checkPathBarbarians(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  const geometry = geometryForState(state);
  for (const edge of ext.pathBarbarians ?? []) {
    if (!geometry.edges[edge]) {
      throw new TradersBarbariansMainInvariantViolationError('TBM4', `path barbarian sits on unknown edge ${edge}`);
    }
  }
}

function checkDeliveryVp(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  for (const p of state.players) {
    const deliveries = ext.deliveries?.[p.seat] ?? 0;
    const vp = computeVp(state, p.seat);
    if ((vp.tradersBarbariansMainVp ?? 0) !== deliveries) {
      throw new TradersBarbariansMainInvariantViolationError(
        'TBM5',
        `seat ${p.seat} tradersBarbariansMainVp=${vp.tradersBarbariansMainVp} != expected deliveries=${deliveries}`
      );
    }
  }
}

/**
 * Runs TBM1–TBM5 against one successful transition, threading a running action-count tally purely
 * for the sim's coverage report (never used to gate a check). Throws
 * `TradersBarbariansMainInvariantViolationError` on the first violation; returns the accumulator
 * otherwise. No-op (immediate passthrough) outside the tradersBarbarians-scenario game.
 */
export function checkTradersBarbariansMainInvariants(
  next: GameState,
  action: Action,
  events: readonly GameEvent[],
  acc: TradersBarbariansMainAccumulator
): TradersBarbariansMainAccumulator {
  const ext = tbExt(next);
  if (!ext || ext.scenario !== 'tradersBarbarians') return acc;

  let wagonsPlaced = acc.wagonsPlaced;
  let wagonMoves = acc.wagonMoves;
  let deliveriesCompleted = acc.deliveriesCompleted;
  for (const e of events) {
    if (e.type === 'tbWagonPlaced') wagonsPlaced += 1;
    if (e.type === 'tbWagonMoved') wagonMoves += 1;
    if (e.type === 'tbDeliveryCompleted') deliveriesCompleted += 1;
  }
  void action;

  checkWagonCount(next);
  checkWagonShape(next);
  checkNonNegative(next);
  checkPathBarbarians(next);
  checkDeliveryVp(next);

  return { wagonsPlaced, wagonMoves, deliveriesCompleted };
}
