// T-1003: the Rivers scenario's mode-specific invariants (docs/rules/traders-barbarians-rules.md
// §TB3), asserted after every successful transition of a rivers simulation on TOP of the
// generalized base I1–I10 in invariants.ts. Like invariants.ts, every check is a from-scratch
// recomputation over `next` (or `next` + a threaded accumulator for the DELTA-shaped coin ledger),
// never a read of a flag the engine itself set.
//
//   RIV1  coin LEDGER: Σ(every seat's current coin total) equals Σ(coins ever AWARDED via
//         `coinsAwarded` events, running accumulator like I3's `playedDevCards`) minus Σ(coins ever
//         SPENT via `coinsTraded` events) — coins are minted/destroyed rather than drawn from a
//         fixed pool (unlike fishermen's FISH1), so the ledger is additive/subtractive, not a fixed
//         total.
//   RIV2  Wealthiest Settler: `computeVp`'s `riversWealthiest` is 1 for a seat iff it SOLELY holds
//         the max coin total (recomputed independently from `ext.coins`, never trusting the
//         engine's own value).
//   RIV3  Poorest Settler: `computeVp`'s `riversPoorest` is -2 for EVERY seat tied at the min coin
//         total (no sole-leader requirement), 0 for every other seat.
//   RIV4  bridges only ever sit on THIS game's river edges (T-1051: `isRiverEdge(state, edge)`,
//         geometry-resolved per-game rather than always the base board's fixed set), each edge
//         carries at most one bridge, and no edge carries both a road and a bridge.
//   RIV5  `coinTradesThisTurn` is never negative and is exactly 0 immediately after any transition
//         whose events include `turnEnded` (the module's `endTurn` reset, §TB3.3).

import type { Action, GameEvent, GameState } from '@hexhaven/shared';
import { computeVp } from '../vp.js';
import { isRiverEdge, tbExt } from '../modules/tradersBarbarians/state.js';

export class RiversInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'RiversInvariantViolationError';
  }
}

/** Running coin ledger (RIV1 needs it — awarded/spent coins leave no trace in `GameState` itself,
 *  mirroring `FishermenAccumulator.fishSpent`). */
export interface RiversAccumulator {
  coinsAwardedTotal: number;
  coinsSpentTotal: number;
}

export function initialRiversAccumulator(): RiversAccumulator {
  return { coinsAwardedTotal: 0, coinsSpentTotal: 0 };
}

function checkCoinLedger(state: GameState, acc: RiversAccumulator): void {
  const ext = tbExt(state);
  if (!ext) return;
  const handSum = (ext.coins ?? []).reduce((sum, c) => sum + c, 0);
  const expected = acc.coinsAwardedTotal - acc.coinsSpentTotal;
  if (handSum !== expected) {
    throw new RiversInvariantViolationError(
      'RIV1',
      `coin ledger mismatch: hands(${handSum}) != awarded(${acc.coinsAwardedTotal}) - spent(${acc.coinsSpentTotal}) = ${expected}`
    );
  }
}

function checkWealthiestPoorest(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  const coins = ext.coins ?? [];
  if (coins.length === 0) return;
  const maxCoins = Math.max(...coins);
  const minCoins = Math.min(...coins);

  for (const p of state.players) {
    const vp = computeVp(state, p.seat);
    const mine = coins[p.seat] ?? 0;
    const soleLeader = maxCoins > 0 && mine === maxCoins && coins.filter((c) => c === maxCoins).length === 1;
    const expectedWealthiest = soleLeader ? 1 : 0;
    if ((vp.riversWealthiest ?? 0) !== expectedWealthiest) {
      throw new RiversInvariantViolationError(
        'RIV2',
        `seat ${p.seat} riversWealthiest=${vp.riversWealthiest} != expected ${expectedWealthiest} (coins=${JSON.stringify(coins)})`
      );
    }
    const expectedPoorest = maxCoins > 0 && mine === minCoins ? -2 : 0;
    if ((vp.riversPoorest ?? 0) !== expectedPoorest) {
      throw new RiversInvariantViolationError(
        'RIV3',
        `seat ${p.seat} riversPoorest=${vp.riversPoorest} != expected ${expectedPoorest} (coins=${JSON.stringify(coins)})`
      );
    }
  }
}

function checkBridgesOnRiverEdges(state: GameState): void {
  const ext = tbExt(state);
  if (!ext?.bridges) return;
  const seen = new Set<number>();
  for (const list of ext.bridges) {
    for (const edge of list) {
      if (!isRiverEdge(state, edge)) {
        throw new RiversInvariantViolationError('RIV4', `bridge on non-river edge ${edge}`);
      }
      if (seen.has(edge)) {
        throw new RiversInvariantViolationError('RIV4', `edge ${edge} carries more than one bridge`);
      }
      seen.add(edge);
    }
  }
  for (const p of state.players) {
    for (const edge of p.roads) {
      if (seen.has(edge)) {
        throw new RiversInvariantViolationError('RIV4', `edge ${edge} carries both a road and a bridge`);
      }
    }
  }
}

function checkCoinTradesReset(state: GameState, events: readonly GameEvent[]): void {
  const ext = tbExt(state);
  if (!ext) return;
  const made = ext.coinTradesThisTurn ?? 0;
  if (made < 0) {
    throw new RiversInvariantViolationError('RIV5', `coinTradesThisTurn negative: ${made}`);
  }
  if (events.some((e) => e.type === 'turnEnded') && made !== 0) {
    throw new RiversInvariantViolationError('RIV5', `coinTradesThisTurn not reset after turnEnded: ${made}`);
  }
}

/**
 * Runs RIV1–RIV5 against one successful transition, threading the running coin ledger RIV1 needs.
 * Throws `RiversInvariantViolationError` on the first violation; returns the accumulator otherwise.
 * No-op (immediate passthrough) outside a rivers game.
 */
export function checkRiversInvariants(
  next: GameState,
  _action: Action,
  events: readonly GameEvent[],
  acc: RiversAccumulator
): RiversAccumulator {
  const ext = tbExt(next);
  if (!ext || ext.scenario !== 'rivers') return acc;

  let coinsAwardedTotal = acc.coinsAwardedTotal;
  let coinsSpentTotal = acc.coinsSpentTotal;
  for (const e of events) {
    if (e.type === 'coinsAwarded') coinsAwardedTotal += e.amount;
    if (e.type === 'coinsTraded') coinsSpentTotal += e.gave;
  }
  const nextAcc: RiversAccumulator = { coinsAwardedTotal, coinsSpentTotal };

  checkCoinLedger(next, nextAcc);
  checkWealthiestPoorest(next);
  checkBridgesOnRiverEdges(next);
  checkCoinTradesReset(next, events);

  return nextAcc;
}
