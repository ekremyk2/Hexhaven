// T-410 requirement 1: the entry point. `chooseAction` is THE strongest-play bot (no difficulty
// tiers, per the task's explicit "Out of scope") — a determinized Monte-Carlo search (search.ts)
// over a strong evaluation function (evaluate.ts), fed only the redacted `PlayerView` (redact.ts,
// T-204) so it decides using exactly what a human in that seat could see.

import type { Action } from '@hexhaven/shared';
import type { PlayerView } from '../redact.js';
import { enumerateCandidates } from './candidates.js';
import { sampleDeterminization } from './determinize.js';
import { search } from './search.js';
import type { Rng } from './types.js';

/**
 * Production search budget: strong play at an acceptable per-move cost (median cost measured in
 * ai/benchmark.test.ts / the task file's Implementation notes). Tests pass a much smaller
 * `opts.budget` to keep the suite CI-reasonable while still clearing the dominance bar.
 */
export const DEFAULT_BUDGET = 240;

export interface ChooseActionOpts {
  budget?: number;
}

/**
 * `chooseAction(view, rng, opts)` — pure and deterministic in its inputs (the RETURNED `rng` is the
 * only thing that changes between two calls given the same `(view, rng, opts)`; same call twice
 * gives the same action, task requirement 1's replay contract). Takes ONLY a `PlayerView`: there is
 * no `GameState` parameter anywhere in this module's signatures, so a hidden-information read would
 * be a compile error, not merely a discipline violation — the one place hidden info is ever
 * invented is `sampleDeterminization` (determinize.ts), which this function calls but never
 * inspects the hidden parts of.
 *
 * Handles every decision point (setup, preRoll, main, moveRobber, steal, discard, roadBuilding,
 * pending trade response) uniformly: `enumerateCandidates` (candidates.ts) lists every legal action
 * for `view.me` in `view.phase`, and `search` picks among them — there is no phase-specific
 * hand-written special case here (task requirement 5).
 */
export function chooseAction(
  view: PlayerView,
  rng: Rng,
  opts?: ChooseActionOpts
): { action: Action; rng: Rng } {
  const budget = opts?.budget ?? DEFAULT_BUDGET;

  // Bot-initiated domestic trades (BUGS.md B-21, re-enabled). Two guards make this safe now:
  //  1. Confirm safety: `respondTrade` (phases/main.ts) now REJECTS an accept unless the responder
  //     holds the `receive` cards, so any `responses[s] === 'accepted'` is guaranteed confirmable —
  //     the offerer no longer needs to see hidden hands to confirm.
  //  2. No re-offer loop: `offerTrade` sets `turn.offeredThisTurn`, and `offerTradeCandidates`
  //     (candidates.ts) is gated on it, so a bot offers at most once per turn.
  // Resolve the bot's OWN open offer here, deterministically, instead of via search — by the time
  // `pendingActors` (server botDrive / sim nextActor) routes back to the owner, every responder has
  // answered. Confirm the first accepter; if none accepted, cancel and move on (the loop guard then
  // stops it re-offering). Search never sees `confirmTrade` at the root, so its determinized-sample
  // "does the accepter hold receive?" uncertainty (candidates.ts) never drives the real decision.
  if (view.trade != null && view.turn.player === view.me) {
    const trade = view.trade;
    const accepters = view.players
      .map((p) => p.seat)
      .filter((s) => s !== view.me && trade.responses[s] === 'accepted');
    if (accepters.length > 0) {
      return { action: { type: 'confirmTrade', with: accepters[0]! }, rng };
    }
    const allResponded = view.players
      .filter((p) => p.seat !== view.me)
      .every((p) => trade.responses[p.seat] !== undefined);
    if (allResponded) return { action: { type: 'cancelTrade' }, rng };
    // else: responses still pending — `pendingActors` routes to the responders first, so this is
    // unreachable in the real drive; fall through to the normal search as a defensive default.
  }

  const seed = sampleDeterminization(view, rng);
  // `offerTrade` candidates are now allowed through (the search decides whether an offer beats every
  // other main-phase option). `confirmTrade` only ever appears for an owner with an open offer, which
  // the deterministic branch above already handled — so it never reaches the search at the root.
  const candidates = enumerateCandidates(seed.state, view.me);
  if (candidates.length === 0) {
    throw new Error(`BUG: chooseAction found no legal action for seat ${view.me} in phase ${view.phase.kind}`);
  }
  if (candidates.length === 1) return { action: candidates[0]!, rng: seed.rng };

  return search(view, seed.rng, candidates, view.me, { budget });
}
