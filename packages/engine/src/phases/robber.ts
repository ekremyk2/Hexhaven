// The robber pipeline (R6, R10): simultaneous discards on a rolled 7, moving the robber, and the
// random steal. Shared verbatim by the Knight development card (T-109 calls moveRobberHandler /
// stealHandler directly with returnTo:'preRoll' when a Knight is played before rolling — R9.5).
// Registered as the discard/moveRobber/steal handlers in reduce.ts. Type-only import from
// reduce.js keeps the emitted JS free of an import cycle (same pattern as setup.ts/roll.ts).

import { bundleTotal, hasAtLeast } from '@hexhaven/shared';
import type {
  EngineErrorCode,
  GameEvent,
  GameState,
  HexId,
  Phase,
  ResourceType,
  Seat,
} from '@hexhaven/shared';
import type { EngineResult, PhaseHandler } from '../reduce.js';
import { discarded, robberMoved, stolen } from '../events.js';
import { geometryForState } from '../modules/index.js';
import { pickIndex } from '../rng.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/** Resource enum order (docs/01 preamble) — the deterministic ordering for the steal draw (R6.3). */
const RESOURCE_ORDER: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

/**
 * R6.3/ER-3 candidates for a hypothetical robber hex: seats other than the active player with a
 * settlement/city on one of `hex`'s vertices AND at least 1 resource card. Exported so legal.ts
 * can preview candidates for any hex (e.g. while the robber is still being placed) without
 * duplicating this logic — see legal.ts's `stealCandidates`.
 */
export function stealCandidatesForHex(state: GameState, hex: HexId): Seat[] {
  const geomHex = geometryForState(state).hexes[hex];
  if (!geomHex) return [];
  const owner = state.turn.player;
  return state.players
    .filter((p) => p.seat !== owner)
    .filter((p) => geomHex.vertices.some((v) => p.settlements.includes(v) || p.cities.includes(v)))
    .filter((p) => bundleTotal(p.resources) > 0)
    .map((p) => p.seat);
}

/** Where the pipeline lands once the robber move (and any steal) is fully resolved. */
function returnPhase(returnTo: 'preRoll' | 'main'): Phase {
  return returnTo === 'preRoll' ? { kind: 'preRoll' } : { kind: 'main' };
}

/**
 * R6.3: move exactly 1 uniformly-random card from `victim` to `thief`. The victim's hand is
 * expanded to a flat list in RESOURCE_ORDER (deterministic under a fixed rng) and drawn via
 * `pickIndex`. Shared by the 1-candidate auto-steal in `moveRobberHandler` and the explicit
 * `steal` action in `stealHandler` — `priorEvents` lets the auto-steal case fold `robberMoved` +
 * `stolen` into a single result.
 */
export function resolveSteal(
  state: GameState,
  thief: Seat,
  victim: Seat,
  returnTo: 'preRoll' | 'main',
  priorEvents: readonly GameEvent[]
): EngineResult {
  const victimPlayer = state.players[victim];
  if (!victimPlayer) throw new Error(`BUG: steal victim seat ${victim} does not exist`);

  const flat: ResourceType[] = [];
  for (const res of RESOURCE_ORDER) {
    for (let i = 0; i < victimPlayer.resources[res]; i++) flat.push(res);
  }
  // R6.3/ER-3: a legal steal target always holds ≥1 card — `stealCandidatesForHex` filters on it, so
  // this is unreachable from real play (a human/server steal only ever names a live candidate). It IS
  // reachable from the AI's determinized SEARCH, whose sampled opponent hands can differ from the real
  // ones (ai/determinize.ts): a coded error there is pruned as an illegal branch (search.ts /
  // greedyBaseline.ts drop a `!ok` reduce), whereas a throw would abort the whole search — so return a
  // coded error, not a `BUG:` throw (F-4). NOT_A_CANDIDATE mirrors the "no cards ⇒ not a candidate"
  // rule exactly.
  if (flat.length === 0) {
    return fail('NOT_A_CANDIDATE', `steal victim seat ${victim} holds no cards (R6.3)`);
  }

  const draw = pickIndex(state.rng, flat.length);
  const card = flat[draw.value]!;

  const players = state.players.map((p) => {
    if (p.seat === victim) {
      const resources = { ...p.resources };
      resources[card] -= 1;
      return { ...p, resources };
    }
    if (p.seat === thief) {
      const resources = { ...p.resources };
      resources[card] += 1;
      return { ...p, resources };
    }
    return p;
  });

  return {
    ok: true,
    state: { ...state, rng: draw.state, players, phase: returnPhase(returnTo) },
    events: [...priorEvents, stolen(victim, thief, card)],
  };
}

/**
 * Discard sub-phase (R6.1, ER-2): legal for any seat still in `phase.pending`, in any order —
 * reduce.ts exempts `discard` from the turn-owner guard, so a non-active seat may reach here and
 * this handler validates eligibility itself. `action.cards` must sum to exactly that seat's owed
 * amount and not exceed their hand.
 */
export const discardHandler: PhaseHandler = (state, seat, action): EngineResult => {
  if (state.phase.kind !== 'discard') return fail('WRONG_PHASE', 'not in the discard phase');
  const phase = state.phase;
  if (action.type !== 'discard') {
    return fail('WRONG_PHASE', `action ${action.type} is not legal during discards`);
  }
  if (!phase.pending.includes(seat)) {
    return fail('NOT_YOUR_TURN', `seat ${seat} does not owe a discard right now (R6.1/ER-2)`);
  }

  const owed = phase.amounts[seat];
  const offered = bundleTotal(action.cards);
  if (offered !== owed) {
    return fail(
      'BAD_DISCARD_COUNT',
      `seat ${seat} must discard exactly ${owed} cards, offered ${offered}`
    );
  }
  const player = state.players[seat];
  if (!player) throw new Error(`BUG: discard from unknown seat ${seat}`);
  if (!hasAtLeast(player.resources, action.cards)) {
    return fail('CARD_NOT_HELD', `seat ${seat} does not hold the offered cards`);
  }

  const bank = { ...state.bank };
  const players = state.players.map((p) => {
    if (p.seat !== seat) return p;
    const resources = { ...p.resources };
    for (const res of Object.keys(action.cards) as ResourceType[]) {
      const amt = action.cards[res] ?? 0;
      resources[res] -= amt;
      bank[res] += amt;
    }
    return { ...p, resources };
  });

  const pending = phase.pending.filter((s) => s !== seat);
  const events: GameEvent[] = [discarded(seat, action.cards)];

  if (pending.length > 0) {
    return { ok: true, state: { ...state, players, bank, phase: { ...phase, pending } }, events };
  }
  // R6.1 → R6.2: every pending discard resolved. Discards only ever follow a rolled 7, whose
  // moveRobber sub-phase always carries returnTo:'main' (a Knight play, R9.5, never triggers a
  // discard sub-phase in the first place).
  return {
    ok: true,
    state: { ...state, players, bank, phase: { kind: 'moveRobber', returnTo: 'main' } },
    events,
  };
};

/**
 * Move-robber sub-phase (R6.2/ER-8): turn owner only (enforced by reduce.ts's actor guard, so
 * this handler can assume `seat === state.turn.player`). Any hex other than the robber's current
 * one, desert included. Resolves the steal per ER-3 immediately after the move.
 */
export const moveRobberHandler: PhaseHandler = (state, seat, action): EngineResult => {
  if (state.phase.kind !== 'moveRobber') return fail('WRONG_PHASE', 'not in the moveRobber phase');
  const phase = state.phase;
  if (action.type !== 'moveRobber') {
    return fail('WRONG_PHASE', `action ${action.type} is not legal while moving the robber`);
  }
  if (!geometryForState(state).hexes[action.hex]) {
    return fail('BAD_LOCATION', `hex ${action.hex} is off the board`);
  }
  if (action.hex === state.board.robber) {
    return fail('ROBBER_SAME_HEX', 'the robber must move to a different hex (ER-8)');
  }

  const moved: GameState = { ...state, board: { ...state.board, robber: action.hex } };
  const events: GameEvent[] = [robberMoved(seat, action.hex)];
  const candidates = stealCandidatesForHex(moved, action.hex);

  if (candidates.length === 0) {
    // FAQ #63: nobody adjacent with cards — skip straight past the steal.
    return { ok: true, state: { ...moved, phase: returnPhase(phase.returnTo) }, events };
  }
  if (candidates.length === 1) {
    // ER-3: exactly one eligible victim auto-resolves, no choice offered.
    return resolveSteal(moved, seat, candidates[0]!, phase.returnTo, events);
  }
  return {
    ok: true,
    state: { ...moved, phase: { kind: 'steal', candidates, returnTo: phase.returnTo } },
    events,
  };
};

/**
 * Steal sub-phase (R6.3/ER-3): offered only when ≥2 candidates existed after the move. Turn
 * owner only (enforced by reduce.ts). `action.from` must be one of the offered candidates.
 */
export const stealHandler: PhaseHandler = (state, seat, action): EngineResult => {
  if (state.phase.kind !== 'steal') return fail('WRONG_PHASE', 'not in the steal phase');
  const phase = state.phase;
  if (action.type !== 'steal') {
    return fail('WRONG_PHASE', `action ${action.type} is not legal while choosing a steal target`);
  }
  if (!phase.candidates.includes(action.from)) {
    return fail('NOT_A_CANDIDATE', `seat ${action.from} is not a legal steal target`);
  }
  return resolveSteal(state, seat, action.from, phase.returnTo, []);
};
