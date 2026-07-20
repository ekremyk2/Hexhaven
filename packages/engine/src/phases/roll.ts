// The preRoll phase (R4): the mandatory dice roll, then either resource production (R5) or the
// handoff to the robber pipeline on a 7 (R6). Also routes the four development-card play actions
// (R4.1: one dev card may be played before rolling — R9.3/phases/devCards.ts). Registered as the
// `preRoll` handler.

import { DISCARD_THRESHOLD } from '@hexhaven/shared';
import type {
  EngineErrorCode,
  GameEvent,
  GameState,
  PlayerState,
  ResourceType,
  Seat,
} from '@hexhaven/shared';
import type { EngineResult, PhaseHandler } from '../reduce.js';
import { diceRolled, discardRequired, production } from '../events.js';
import { resolveConstants } from '../modules/index.js';
import { rollDie } from '../rng.js';
import { computeProduction } from '../rules/production.js';
import { playKnight, playMonopoly, playRoadBuilding, playYearOfPlenty } from './devCards.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

function handSize(p: PlayerState): number {
  return p.resources.brick + p.resources.lumber + p.resources.wool + p.resources.grain + p.resources.ore;
}

/** A full Seat-keyed record (the Phase.discard.amounts type needs every seat present). */
function zeroSeatAmounts(): Record<Seat, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

export const rollHandler: PhaseHandler = (state, seat, action): EngineResult => {
  if (state.phase.kind !== 'preRoll') return fail('WRONG_PHASE', 'not in the preRoll phase');

  // R4.1: one development card may be played before rolling; everything else must wait.
  switch (action.type) {
    case 'playKnight':
      return playKnight(state, seat);
    case 'playRoadBuilding':
      return playRoadBuilding(state, seat);
    case 'playYearOfPlenty':
      return playYearOfPlenty(state, seat, action.a, action.b, action.extra);
    case 'playMonopoly':
      return playMonopoly(state, seat, action.resource);
    case 'rollDice':
      break; // falls through to the roll itself, below
    default:
      return fail('WRONG_PHASE', `action ${action.type} is not legal before rolling`);
  }

  if (state.turn.rolled) return fail('ALREADY_ROLLED', 'the dice were already rolled this turn');

  const d1 = rollDie(state.rng);
  const d2 = rollDie(d1.state);
  const roll: [number, number] = [d1.value, d2.value];

  return resolveDiceRoll({ ...state, rng: d2.state }, seat, roll);
};

/**
 * Everything AFTER the two numbers are known (R5/R6): sets `turn.rolled`/`turn.roll`, then either
 * production or the 7 → discard/robber handoff. Factored out of `rollHandler` above (T-904b,
 * docs/tasks/modifiers-cards-RESEARCH.md D3a "Hexhaven Event Cards") so the `eventCards` modifier can
 * drive this exact same resolution off a card draw instead of two `rollDie` calls, WITHOUT
 * duplicating the discard/production math — `modules/modifiers/eventCards.ts`'s `interceptAction`
 * builds its own synthetic `[a, b]` pair (summing to the drawn card's number) and calls this
 * function directly. `state.rng` must already reflect whatever randomness produced `roll` (the two
 * `rollDie` draws above, or the modifier's own deck shuffle/reshuffle) — this function itself draws
 * no further randomness. Exported ONLY for that seam; every other caller goes through `rollHandler`.
 */
export function resolveDiceRoll(state: GameState, seat: Seat, roll: [number, number]): EngineResult {
  // T-906 (docs/07 D-034 `customConstants`): the base 7-discard hand limit and the R5 production
  // yield both resolve through the module-tunable constants — absent (the base game / every
  // expansion before this task) falls back to the exact literals used before (RK-13 bit-identity).
  const constants = resolveConstants(state.config);
  const handLimit = constants.discardHandLimit ?? DISCARD_THRESHOLD;
  const productionMultiplier = constants.productionMultiplier ?? 1;
  const total = roll[0] + roll[1];

  const base: GameState = {
    ...state,
    turn: { ...state.turn, rolled: true, roll },
  };
  const events: GameEvent[] = [diceRolled(seat, roll)];

  if (total === 7) {
    // R6.1: no production; anyone over the hand limit discards half (rounded down).
    const amounts = zeroSeatAmounts();
    const pending: Seat[] = [];
    for (const p of state.players) {
      const hand = handSize(p);
      if (hand > handLimit) {
        amounts[p.seat] = Math.floor(hand / 2);
        pending.push(p.seat);
      }
    }
    if (pending.length > 0) {
      events.push(discardRequired(pending.map((s) => ({ seat: s, amount: amounts[s] }))));
      return {
        ok: true,
        state: { ...base, phase: { kind: 'discard', pending, amounts } },
        events,
      };
    }
    // Nobody discards → straight to moving the robber (R6.2). returnTo 'main': a rolled 7.
    return {
      ok: true,
      state: { ...base, phase: { kind: 'moveRobber', returnTo: 'main' } },
      events,
    };
  }

  // R5: distribute production, applying the bank-shortage rule.
  const { gains, shortages } = computeProduction(base, total, productionMultiplier);
  const bank = { ...base.bank };
  const players: PlayerState[] = base.players.map((p) => {
    const gain = gains.find((g) => g.seat === p.seat);
    if (!gain) return p;
    const resources = { ...p.resources };
    for (const res of Object.keys(gain.resources) as ResourceType[]) {
      const amt = gain.resources[res] ?? 0;
      resources[res] += amt;
      bank[res] -= amt;
    }
    return { ...p, resources };
  });

  events.push(production(gains, shortages));
  return {
    ok: true,
    state: { ...base, players, bank, phase: { kind: 'main' } },
    events,
  };
}
