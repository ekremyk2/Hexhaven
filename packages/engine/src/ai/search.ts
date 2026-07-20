// T-410 requirement 4: the search core. A determinized Monte-Carlo search whose ROOT is the current
// decision's legal actions (candidates.ts) — a single-level UCB1 bandit ("MCTS with one real ply"):
// each iteration samples a FRESH determinization (determinize.ts — the only place hidden information
// is invented), applies one candidate action via the real `reduce`, continues play with a HEAVY
// rollout policy (greedyBaseline.ts) for a fixed number of further actions, and scores the result
// with `evaluate` (evaluate.ts) from the searching seat's standing.
//
// Why a flat root instead of a deep recursive tree: Hexhaven's branching factor at a main-phase
// decision can be dozens of build/trade/dev candidates, several of which stay live turn after turn
// — a second full ply of UCB1 expansion would multiply the already-large per-move cost by that same
// factor again, which is incompatible with a CI-reasonable, ITERATION-COUNTED (never wall-clock)
// budget. Extending each root candidate with a heavy-policy rollout instead of a bare single-turn
// score is exactly the "rollout algorithm" idea (policy improvement via simulation, Bertsekas) and
// is what lets a fixed, modest iteration budget still see several turns ahead — the dominance-bar
// benchmark (ai/benchmark.test.ts) is the empirical check that this clears both bars.

import type { Action, GameState, Seat } from '@hexhaven/shared';
import type { PlayerView } from '../redact.js';
import { reduce } from '../reduce.js';
import { shuffle } from '../rng.js';
import { sampleDeterminization } from './determinize.js';
import { evaluate } from './evaluate.js';
import { tryChooseGreedyAction } from './greedyBaseline.js';
import type { Rng } from './types.js';

/** How many further actions the heavy rollout policy plays past the root action before `evaluate`
 * scores the resulting position (task requirement 4's search cutoff) — enough to reach at least the
 * next production roll and a couple of follow-up build/trade decisions without letting one search
 * iteration re-simulate an entire game. */
export const DEFAULT_ROLLOUT_DEPTH = 6;

/** UCB1 exploration constant, scaled against `evaluate`'s VP-dominated magnitude (`WEIGHTS.VP` =
 * 1000 in evaluate.ts) so the exploration bonus is worth a small, comparable fraction of one VP's
 * score — tuned empirically against ai/benchmark.test.ts's measured win rates (see the task file's
 * Implementation notes for the numbers this produced). */
const EXPLORATION_CONSTANT = 260;

/** Mirrors sim/runGame.ts's `nextActor` (T-112): a still-pending discard seat first (R6.1), else an
 * unresponded seat while a domestic trade offer is open (R8.1), else the turn owner. Reimplemented
 * here (rather than imported) because `nextActor` is not exported from sim/runGame.ts and this
 * task's scope is limited to packages/engine/src/ai/**. */
function nextActor(state: GameState): Seat {
  if (state.phase.kind === 'discard') {
    const seat = state.phase.pending[0];
    if (seat === undefined) throw new Error('BUG: discard phase entered with no pending seats');
    return seat;
  }
  // 5–6 SBP (X12): the special builder acts while `turn.player` is still the seat whose turn just
  // ended. Without this the rollout would hand `specialBuild` to `turn.player`, whose candidate list
  // is empty (candidates.ts gates specialBuild on `phase.builder === seat`) → greedyBaseline throws.
  // (Paired Players makes `turn.player` the paired builder, so it falls through to the base return.)
  if (state.phase.kind === 'specialBuild') return state.phase.builder;
  if (state.phase.kind === 'main' && state.trade != null) {
    const owner = state.turn.player;
    const trade = state.trade;
    const responder = state.players.map((p) => p.seat).find((s) => s !== owner && trade.responses[s] === undefined);
    if (responder !== undefined) return responder;
  }
  return state.turn.player;
}

/** Plays up to `depth` further actions from `state` using the heavy greedy rollout policy for EVERY
 * seat (opponents included — a strong, non-adversarial "everyone plays well" model), stopping early
 * if the game ends. */
function rollout(state: GameState, depth: number, rng: Rng): { state: GameState; rng: Rng } {
  let s = state;
  let r = rng;
  for (let i = 0; i < depth; i++) {
    if (s.phase.kind === 'ended') break;
    const actor = nextActor(s);
    const decision = tryChooseGreedyAction(s, actor, r);
    // A determinized dead-end (no legal action for the acting seat) prunes the rollout — stop and let
    // `evaluate` score the position reached so far, rather than crashing the whole search (F-4). Every
    // known crash class is root-caused; this is the residual-edge-state backstop.
    if (decision === null) break;
    r = decision.rng;
    const result = reduce(s, actor, decision.action);
    if (!result.ok) break; // defensive: tryChooseGreedyAction only emits legal.ts-backed actions
    s = result.state;
  }
  return { state: s, rng: r };
}

export interface SearchOpts {
  /** Fixed iteration count (never wall-clock — task requirement 4's determinism contract). */
  budget: number;
  rolloutDepth?: number;
}

/**
 * Runs the determinized Monte-Carlo search over `candidates` (the searching seat's legal actions
 * right now) and returns the best one found within `opts.budget` iterations. Deterministic in
 * `(view, rng, candidates, seat, opts)` — the only randomness is the threaded `rng`.
 */
export function search(
  view: PlayerView,
  rng: Rng,
  candidates: readonly Action[],
  seat: Seat,
  opts: SearchOpts
): { action: Action; rng: Rng } {
  if (candidates.length === 0) throw new Error('BUG: search called with no candidate actions');
  if (candidates.length === 1) return { action: candidates[0]!, rng };

  const depth = opts.rolloutDepth ?? DEFAULT_ROLLOUT_DEPTH;
  // The iteration count is EXACTLY `opts.budget` (never inflated by a large candidate set — a wide
  // main-phase decision can offer dozens of build/trade options, and letting the arm count silently
  // raise the iteration count would make the "fixed budget" promise meaningless for cost purposes).
  // When `budget >= candidates.length` every arm still gets its guaranteed round-robin sample before
  // UCB1 takes over; when `budget < candidates.length` the search simply cannot sample every arm and
  // only explores `budget` of them — an expected, honest consequence of a small budget, not a bug.
  const iterations = Math.max(1, opts.budget);

  const visits = new Array<number>(candidates.length).fill(0);
  const total = new Array<number>(candidates.length).fill(0);
  let totalVisits = 0;
  let r = rng;

  // The guaranteed round-robin pass below visits arms in THIS order — shuffled, not candidates'
  // original array order. candidates.ts always puts a few actions first structurally (`endTurn`,
  // then low-ID vertices/edges); without shuffling, a `budget` smaller than the candidate count
  // would systematically starve every candidate past index `budget`, no matter how strong, instead
  // of sampling a representative subset of them.
  const armOrder = shuffle(r, candidates.map((_, i) => i));
  r = armOrder.state;
  const order = armOrder.array;

  for (let iter = 0; iter < iterations; iter++) {
    let armIndex: number;
    if (iter < candidates.length) {
      armIndex = order[iter]!;
    } else {
      let best = 0;
      let bestUcb = -Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const v = visits[i]!;
        const avg = total[i]! / v;
        const ucb = avg + EXPLORATION_CONSTANT * Math.sqrt(Math.log(totalVisits) / v);
        if (ucb > bestUcb) {
          bestUcb = ucb;
          best = i;
        }
      }
      armIndex = best;
    }

    const sample = sampleDeterminization(view, r);
    r = sample.rng;
    const action = candidates[armIndex]!;
    const applied = reduce(sample.state, seat, action);

    visits[armIndex] = visits[armIndex]! + 1;
    totalVisits += 1;
    if (!applied.ok) {
      // Candidate legality never depends on hidden information (see candidates.ts's header note),
      // so every candidate is legal against every fresh determinization too — this should never
      // actually fire; kept as a defensive skip (score 0 for this draw) rather than a crash.
      continue;
    }
    const played = rollout(applied.state, depth, r);
    r = played.rng;
    total[armIndex] = total[armIndex]! + evaluate(played.state, seat);
  }

  let best = 0;
  let bestAvg = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const v = visits[i]!;
    const avg = v > 0 ? total[i]! / v : -Infinity;
    if (avg > bestAvg) {
      bestAvg = avg;
      best = i;
    }
  }

  return { action: candidates[best]!, rng: r };
}
