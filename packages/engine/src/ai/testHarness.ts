// T-410 test support: a per-seat-policy game runner, reusing the T-112 invariant suite
// (sim/invariants.ts) and mirroring sim/runGame.ts's `nextActor`/loop shape WITHOUT modifying those
// files (this task's scope is limited to packages/engine/src/ai/**; sim/runGame.ts's own `simulate`
// is hard-wired to the random-legal-move bot for every seat, which can't drive `chooseAction` or
// `chooseGreedyAction` for a mix of seats). Used by both the legality/termination fuzz and the
// dominance-bar benchmark (ai/benchmark.test.ts).

import type { Action, GameConfig, GameState, Seat } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { reduce } from '../reduce.js';
import { redact } from '../redact.js';
import { hashSeed } from '../rng.js';
import { checkInvariants, initialInvariantAccumulator } from '../sim/invariants.js';
import type { InvariantAccumulator } from '../sim/invariants.js';
import { randomBot } from '../sim/bot.js';
import { chooseAction } from './bot.js';
import { chooseGreedyAction } from './greedyBaseline.js';
import type { Rng } from './types.js';

export type SeatPolicy = 'bot' | 'greedy' | 'random';

/** Fixed base-game config (docs/10 §3: no expansions ship yet), mirroring sim/runGame.ts's CONFIG —
 * only `seed` varies per game. */
const CONFIG: Omit<GameConfig, 'seed'> = {
  playerCount: 4,
  targetVp: 10,
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

/** I10: a game must terminate before this many actions (same cap sim/runGame.ts uses). */
const MAX_ACTIONS = 4000;

/** The search budget used by every 'bot'-policy seat in the test suite (legality fuzz + benchmark)
 * — small enough to keep ≥200-game suites CI-reasonable; DEFAULT_BUDGET (bot.ts) is the production
 * value reported separately in the task file's Implementation notes. */
export const TEST_BUDGET = 12;

function nextActor(state: GameState): Seat {
  if (state.phase.kind === 'discard') {
    const seat = state.phase.pending[0];
    if (seat === undefined) throw new Error('BUG: discard phase entered with no pending seats');
    return seat;
  }
  // 5–6 SBP (X12): the special builder acts while `turn.player` is the seat whose turn just ended
  // (mirrors sim/runGame.ts + search.ts's own nextActor). Base-game harness runs never reach this.
  if (state.phase.kind === 'specialBuild') return state.phase.builder;
  if (state.phase.kind === 'main' && state.trade != null) {
    const owner = state.turn.player;
    const trade = state.trade;
    const responder = state.players.map((p) => p.seat).find((s) => s !== owner && trade.responses[s] === undefined);
    if (responder !== undefined) return responder;
  }
  return state.turn.player;
}

function decide(state: GameState, seat: Seat, policy: SeatPolicy, rng: Rng, botBudget: number): { action: Action; rng: Rng } {
  switch (policy) {
    case 'random':
      return randomBot(state, seat, rng);
    case 'greedy':
      return chooseGreedyAction(state, seat, rng);
    case 'bot':
      return chooseAction(redact(state, seat), rng, { budget: botBudget });
  }
}

export interface PlayedGame {
  seed: string;
  winner: Seat;
  actions: number;
  turns: number;
}

/**
 * Plays one full game to `ended`, seat `s` deciding via `policies[s]`. Asserts the T-112 invariant
 * suite after every transition (I1–I9 + event sanity) and throws a detailed error on an I10
 * non-termination or an illegal action from any policy — the same contract sim/runGame.ts's
 * `simulate` gives the random-bot-only case, generalized to a per-seat policy mix.
 */
export function playGame(
  seed: string,
  policies: Record<Seat, SeatPolicy>,
  botBudget: number = TEST_BUDGET
): PlayedGame {
  let state = createGame({ ...CONFIG, seed });
  let rng = hashSeed(`${seed}#ai-harness`);
  let acc: InvariantAccumulator = initialInvariantAccumulator();
  let actions = 0;

  while (state.phase.kind !== 'ended') {
    if (actions >= MAX_ACTIONS) {
      throw new Error(`I10 violation: seed "${seed}" did not terminate within ${MAX_ACTIONS} actions`);
    }
    const actor = nextActor(state);
    const policy = policies[actor] ?? 'random';
    const decision = decide(state, actor, policy, rng, botBudget);
    rng = decision.rng;

    const result = reduce(state, actor, decision.action);
    if (!result.ok) {
      throw new Error(
        `BUG: seat ${actor} (${policy}) proposed an illegal action for seed "${seed}" at action ${actions}: ` +
          `${JSON.stringify(decision.action)} -> ${result.error.code} (${result.error.message})`
      );
    }

    const prev = state;
    state = result.state;
    actions += 1;
    acc = checkInvariants(prev, decision.action, state, result.events, acc);
  }

  return { seed, winner: state.phase.winner, actions, turns: state.turn.number };
}
