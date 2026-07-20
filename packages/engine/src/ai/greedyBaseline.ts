// T-410's one-ply greedy heuristic. Per the task's "Out of scope" note this is explicitly NOT the
// shipped bot — it exists only to (a) serve as the search's heavy rollout policy (search.ts,
// requirement 4: "a heavy playout policy (greedy-heuristic, not uniform-random)"), and (b) be the
// benchmark opponent the dominance bar (docs/tasks/phase-4/T-410-bot-ai.md §Acceptance) is measured
// against. `chooseGreedyAction` operates on a full `GameState` (unlike `chooseAction`, which only
// ever sees a `PlayerView`) because both of its callers already hold one: the rollout is running
// inside a determinized hypothetical world, and the benchmark drives real games directly.

import type { Action, GameState, Seat } from '@hexhaven/shared';
import { reduce } from '../reduce.js';
import { pickIndex, shuffle } from '../rng.js';
import { enumerateCandidates } from './candidates.js';
import { evaluate } from './evaluate.js';
import type { Rng } from './types.js';

/**
 * Upper bound on how many candidates one `chooseGreedyAction` call fully scores (applies via
 * `reduce` + `evaluate`). This function is the search's ROLLOUT policy (search.ts) — called for
 * EVERY actor at EVERY rollout step, every search iteration — so its own cost multiplies the whole
 * search's cost directly. A wide main-phase decision can offer dozens of build/trade candidates;
 * scoring a bounded, shuffled SAMPLE of them (instead of every one) keeps one greedy decision's cost
 * roughly constant regardless of branching factor, at the cost of occasionally missing the single
 * best of many similar options — an acceptable trade for a rollout policy whose job is to be a
 * decent, not optimal, stand-in for "everyone plays reasonably" (the shipped bot's OWN root
 * decisions never go through this cap — `search.ts` scores every one of the bot's own candidates).
 */
const MAX_CANDIDATES_SCORED = 4;

/**
 * Enumerates every legal action for `seat` (candidates.ts, itself built on legal.ts), scores a
 * bounded sample of them (see `MAX_CANDIDATES_SCORED`) by applying each via the real `reduce` and
 * reading `evaluate(next, seat)`, and keeps the highest-scoring one — ties broken by the threaded
 * rng so a genuinely tied position doesn't always resolve to `candidates[0]`.
 */
export function chooseGreedyAction(state: GameState, seat: Seat, rng: Rng): { action: Action; rng: Rng } {
  const decision = tryChooseGreedyAction(state, seat, rng);
  if (decision === null) {
    throw new Error(`BUG: greedyBaseline had no legal action for seat ${seat} in phase ${state.phase.kind}`);
  }
  return decision;
}

/**
 * Like `chooseGreedyAction` but returns `null` instead of throwing when `seat` has no legal action
 * on `state` — the SEARCH's rollout (search.ts) uses this so a determinized dead-end (a hypothetical
 * world where the acting seat genuinely has nothing legal) PRUNES the rollout (stop and evaluate)
 * rather than aborting the whole search with a throw (F-4). Every real crash class was root-caused
 * (actor selection + determinize constants + board geometry); this only guards a residual edge state
 * the vast 5–6 determinized space might still reach, matching robber.ts's coded-error prune style.
 * `chooseGreedyAction` (the benchmark opponent / harness policy) keeps throwing so a real bug there
 * still surfaces loudly.
 */
export function tryChooseGreedyAction(
  state: GameState,
  seat: Seat,
  rng: Rng
): { action: Action; rng: Rng } | null {
  const candidates = enumerateCandidates(state, seat);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return { action: candidates[0]!, rng };

  let pool = candidates;
  let r = rng;
  if (pool.length > MAX_CANDIDATES_SCORED) {
    // `endTurn` (always candidates[0] in the main phase, candidates.ts) is kept unconditionally so
    // a heavily-populated main phase always has a legal fallback even if every scored sample turns
    // out illegal against `state` (defensive; see candidates.ts's confirmTrade note).
    const alwaysKeep = pool[0]!;
    const shuffled = shuffle(r, pool.slice(1));
    r = shuffled.state;
    pool = [alwaysKeep, ...shuffled.array.slice(0, MAX_CANDIDATES_SCORED - 1)];
  }

  let bestScore = -Infinity;
  let bestActions: Action[] = [];
  for (const action of pool) {
    const result = reduce(state, seat, action);
    if (!result.ok) continue; // defensive: candidates.ts only emits legal.ts-backed actions
    const score = evaluate(result.state, seat);
    if (score > bestScore) {
      bestScore = score;
      bestActions = [action];
    } else if (score === bestScore) {
      bestActions.push(action);
    }
  }
  // Every sampled candidate was rejected by `reduce`. Effectively unreachable — the main phase always
  // keeps `endTurn`/`passSpecialBuild` (always legal) as `alwaysKeep`, and every other phase's
  // candidates are legal by construction — but return `null` (prune) rather than throw so the search
  // can never crash on a residual determinized inconsistency (F-4). See `tryChooseGreedyAction`.
  if (bestActions.length === 0) return null;
  if (bestActions.length === 1) return { action: bestActions[0]!, rng: r };

  const draw = pickIndex(r, bestActions.length);
  return { action: bestActions[draw.value]!, rng: draw.state };
}
