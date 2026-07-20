// friendlyRobber modifier (T-903a wave A-1, docs/07 D-034 / docs/tasks/modifiers-RESEARCH.md
// "Friendly Robber", OFFICIAL Traders & Barbarians / Atlantis). Two independent anti-frustration
// rules, both hooked WITHOUT editing `phases/robber.ts` inline (expansion-readiness, docs/10 §3):
//
// (a) A seat at ≤2 VP is never a legal steal target — filters `stealCandidatesForHex`'s (phases/
//     robber.ts, exported for exactly this reuse) output before deciding the 0/1/multi-candidate
//     branch, via `interceptAction` on the `moveRobber` action. The branching below necessarily
//     duplicates `moveRobberHandler`'s SHAPE (its candidate list is computed inline, so it can't be
//     partially reused) but calls the same exported helpers (`stealCandidatesForHex`,
//     `resolveSteal`) for the actual move/steal accounting — only the candidate list is filtered.
// (b) A 7 rolled during round 1 (every seat's own first turn: `turn.number <= playerCount`, before
//     anyone could realistically be robbed) skips the robber entirely — no move, no steal. Per the
//     task brief this ships as the simpler, RNG-free "skip" variant rather than a re-roll (a re-roll
//     would consume extra `state.rng` draws and complicate determinism for no real benefit).
//     Hooked via `phaseHooks.afterAction`, redirecting the `moveRobber` phase straight back to
//     `main` — deliberately mirroring how Cities & Knights' own robber-lock already does exactly
//     this (`modules/citiesKnights/index.ts`'s `handleRollDice` / its sibling `discard` branch in
//     `phaseHooks.afterAction`): the same two entry points (`rollDice` landing directly in
//     `moveRobber` when nobody owed a discard, or the LAST pending `discard` resolving into it).
//
// Compatibility: no matrix entry needed (registry.ts). Composes with Cities & Knights' robber-lock
// (C10.1) for free: C&K's own `interceptAction` rejects `moveRobber`/`steal` outright while locked,
// and — because `resolveModules` always appends modifiers AFTER expansion modules (registry.ts) —
// C&K's intercept runs first in `reduce`'s loop, so THIS module's `moveRobber` intercept never even
// runs during that window; once unlocked, C&K's intercept returns `null` and this module's
// filtering applies normally. The round-1 hook is likewise harmless under C&K: its own robberLocked
// mechanism already redirects those early 7s to `main` before this hook gets a look, and re-checking
// an already-`main` phase here is a no-op. Seafarers' pirate (`movePirate`) is a different
// action/piece this module never touches.

import type { Action, GameEvent, GameState, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { err } from '../../reduce.js';
import { robberMoved } from '../../events.js';
import { geometryForState } from '../index.js';
import { resolveSteal, stealCandidatesForHex } from '../../phases/robber.js';
import { computeVp } from '../../vp.js';
import type { RuleModule } from '../types.js';

/** D-034: a seat at ≤2 VP is never a legal Friendly-Robber steal target. */
function aboveVpThreshold(state: GameState, seat: Seat): boolean {
  return computeVp(state, seat).total > 2;
}

/**
 * `moveRobber` handled with a VP-filtered candidate list — the (a) half of Friendly Robber. `null`
 * for anything but a `moveRobber` action in the `moveRobber` phase, falling through to normal
 * routing (`phases/robber.ts`'s `moveRobberHandler`, unmodified).
 */
function moveRobberFiltered(state: GameState, seat: Seat, action: Action): EngineResult | null {
  if (state.phase.kind !== 'moveRobber' || action.type !== 'moveRobber') return null;
  const phase = state.phase;
  if (!geometryForState(state).hexes[action.hex]) {
    return err('BAD_LOCATION', `hex ${action.hex} is off the board`);
  }
  if (action.hex === state.board.robber) {
    return err('ROBBER_SAME_HEX', 'the robber must move to a different hex (ER-8)');
  }

  const moved: GameState = { ...state, board: { ...state.board, robber: action.hex } };
  const events: GameEvent[] = [robberMoved(seat, action.hex)];
  const candidates = stealCandidatesForHex(moved, action.hex).filter((s) => aboveVpThreshold(moved, s));

  if (candidates.length === 0) {
    const returnPhase = phase.returnTo === 'preRoll' ? ({ kind: 'preRoll' } as const) : ({ kind: 'main' } as const);
    return { ok: true, state: { ...moved, phase: returnPhase }, events };
  }
  if (candidates.length === 1) {
    return resolveSteal(moved, seat, candidates[0]!, phase.returnTo, events);
  }
  return {
    ok: true,
    state: { ...moved, phase: { kind: 'steal', candidates, returnTo: phase.returnTo } },
    events,
  };
}

export const friendlyRobberModule: RuleModule = {
  id: 'friendlyRobber',
  interceptAction: moveRobberFiltered,
  phaseHooks: {
    afterAction(_prev, next, action, events) {
      // The natural 7 pipeline reaches `moveRobber` only via `rollDice` (nobody owed a discard) or
      // the LAST pending `discard` resolving — never via a Knight play (`playKnight`), which is how
      // this stays scoped to "a 7 rolled", not any robber move.
      if (action.type !== 'rollDice' && action.type !== 'discard') return null;
      if (next.phase.kind !== 'moveRobber' || next.phase.returnTo !== 'main') return null;
      const roll = next.turn.roll;
      if (!roll || roll[0] + roll[1] !== 7) return null;
      // Round 1 = every seat's own first turn (docs/07 D-034 "before anyone could realistically be
      // robbed"): `turn.number` runs 1..playerCount for those first turns before wrapping.
      if (next.turn.number > next.config.playerCount) return null;
      return { state: { ...next, phase: { kind: 'main' } }, events: [...events] };
    },
  },
};
