// T-1002: the Fishermen scenario's mode-specific invariants (docs/rules/traders-barbarians-rules.md
// §TB2), asserted after every successful transition of a fishermen simulation on TOP of the
// generalized base I1–I10 in invariants.ts (whose I7 is already fishermen-aware via `winTargetFor`).
// Like invariants.ts, every check is a from-scratch recomputation over `next` (or `next` + a threaded
// accumulator for the one DELTA-shaped property, fish ever spent), never a read of a flag the engine
// itself set.
//
//   FISH1  fish CONSERVATION: Σ(numbered-token values still face-down in the stack) +
//          Σ(every seat's current fish hand) + Σ(every fish ever SPENT via `exchangeFish`, tracked by
//          a running accumulator like I3's `playedDevCards`) equals the fixed
//          `FISHERMEN_FISH_STACK` numbered-token total. The Old Boot (`0`) contributes 0 everywhere
//          it can sit (stack, nobody's hand — it's never added to a hand at all), so the equality
//          holds across a boot draw with no special-casing.
//   FISH2  the Old Boot holder, if any, names a REAL seat in this game.
//   FISH3  the boot-adjusted win target is honored: a winner who holds the Old Boot has reached
//          target+1, not just the base target (redundant with the general I7 check in invariants.ts,
//          re-asserted here directly against the fixed scenario rule for a scenario-scoped failure
//          message).

import type { Action, GameEvent, GameState } from '@hexhaven/shared';
import { computeVp } from '../vp.js';
import { FISHERMEN_FISH_STACK } from '../modules/tradersBarbarians/index.js';
import { tbExt } from '../modules/tradersBarbarians/state.js';

export class FishermenInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'FishermenInvariantViolationError';
  }
}

/** Running total of fish SPENT via `exchangeFish` this game (FISH1 needs it — spent fish leaves no
 *  trace in `GameState` itself, mirroring `InvariantAccumulator.playedDevCards`). */
export interface FishermenAccumulator {
  fishSpent: number;
}

export function initialFishermenAccumulator(): FishermenAccumulator {
  return { fishSpent: 0 };
}

const FISH_TOTAL = FISHERMEN_FISH_STACK.reduce((sum, v) => sum + v, 0);

function checkFishConservation(state: GameState, fishSpent: number): void {
  const ext = tbExt(state);
  if (!ext) return;
  const stackSum = (ext.fishStack ?? []).reduce((sum, v) => sum + v, 0);
  const handSum = (ext.fish ?? []).reduce((sum, v) => sum + v, 0);
  const total = stackSum + handSum + fishSpent;
  if (total !== FISH_TOTAL) {
    throw new FishermenInvariantViolationError(
      'FISH1',
      `fish value not conserved: stack(${stackSum}) + hands(${handSum}) + spent(${fishSpent}) = ${total} != ${FISH_TOTAL}`
    );
  }
}

function checkOldBootHolder(state: GameState): void {
  const ext = tbExt(state);
  if (!ext || ext.oldBoot == null) return;
  if (!state.players.some((p) => p.seat === ext.oldBoot)) {
    throw new FishermenInvariantViolationError('FISH2', `Old Boot holder ${ext.oldBoot} is not a real seat`);
  }
}

function checkBootWinTarget(state: GameState): void {
  const ext = tbExt(state);
  if (!ext || state.phase.kind !== 'ended') return;
  const winner = state.phase.winner;
  const vp = computeVp(state, winner).total;
  const target = state.config.targetVp + (ext.oldBoot === winner ? 1 : 0);
  if (vp < target) {
    throw new FishermenInvariantViolationError(
      'FISH3',
      `boot-adjusted win target not honored: winner seat ${winner} has ${vp} VP, needs >= ${target} (§TB2.5)`
    );
  }
}

/**
 * Runs FISH1–FISH3 against one successful transition, threading the running fish-spent tally FISH1
 * needs. Throws `FishermenInvariantViolationError` on the first violation; returns the accumulator
 * otherwise. No-op (immediate passthrough) outside a fishermen game.
 */
export function checkFishermenInvariants(
  next: GameState,
  _action: Action,
  events: readonly GameEvent[],
  acc: FishermenAccumulator
): FishermenAccumulator {
  let fishSpent = acc.fishSpent;
  for (const e of events) {
    if (e.type === 'fishExchanged') fishSpent += e.cost;
  }

  checkFishConservation(next, fishSpent);
  checkOldBootHolder(next);
  checkBootWinTarget(next);

  return { fishSpent };
}
