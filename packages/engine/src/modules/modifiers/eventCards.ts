// Event Cards modifier (T-904b, docs/tasks/modifiers-cards-RESEARCH.md D3a "Hexhaven Event Cards" —
// OFFICIAL, standalone / Traders & Barbarians): replaces the two production dice with a shuffled
// 36-card deck whose totals match the 2d6 distribution (one 2, two 3s, three 4s, four 5s, five 6s,
// six 7s, five 8s, four 9s, three 10s, two 11s, one 12 — 36 cards total), so over a full pass the
// production odds match dice exactly but without literal streaks. The deck reshuffles from its own
// discard pile once exhausted.
//
// SIMPLIFICATION (flagged for PM review): the official deck also prints a named bonus EVENT on
// roughly a third of its cards (per-award bonuses, "cities don't double this turn," a leader
// giving away resources, etc.) plus a "New Year" card ~5 from the bottom that forces an early
// reshuffle. The research doc could not source an authoritative card-by-card list for those events
// ("effects vary... not standardized" — modifiers-cards-RESEARCH.md D3a/its Open Questions section),
// so this module ships ONLY the number-distribution deck (the doc's explicit "core deliverable"
// fallback) and reshuffles strictly on exhaustion rather than modeling the New Year early-reshuffle.
// Every drawn card still routes through the exact same production/discard/robber pipeline a real
// dice roll would.
//
// Seam: this module has no dedicated `initState` hook (`RuleModule`, modules/types.ts, doesn't
// define one) so `ext.eventCards` is lazily created the first time `interceptAction` ever sees a
// `rollDice` — the identical pattern T-905's `ensureHelpersExt` established (modules/modifiers/
// helpers/state.ts). Drawing a card threads `state.rng` exactly like any other engine randomness
// (docs/05 §2); the deck/discard/reshuffle bookkeeping lives entirely under `state.ext.eventCards`,
// never touching base fields (docs/10 §3 expansion-readiness).
//
// Downstream-consumer seam: `phases/roll.ts` exports `resolveDiceRoll(state, seat, roll)` — the
// production/7-discard/robber-handoff logic that used to live entirely inside `rollHandler`, now
// factored out (T-904b) so both the base dice roll AND this modifier's card draw share the exact
// same math, byte-for-byte, rather than this module re-deriving it (which would risk drifting out
// of sync with the base game and is exactly the "don't edit phases/roll.ts inline" rule's spirit —
// this is the one documented, minimal seam the task allows). This module builds a synthetic
// `[a, b]` pair that SUMS to the drawn card's total (split as evenly as possible: `a = ceil(total/2)`,
// `b = total - a`, e.g. 7 → [4, 3], 2 → [1, 1], 12 → [6, 6]) and hands it to `resolveDiceRoll` —
// every downstream reader of `turn.roll` (production, the 7-check, Seafarers' gold sub-phase,
// bots, the client dice display) only ever needs `roll[0] + roll[1]`, never the individual faces,
// so the synthetic split is unobservable to game logic. The base `diceRolled` event still fires
// (for any consumer keyed on it), ALONGSIDE a new `eventCardDrawn` event carrying the real total —
// the client keys off the latter to show a card face instead of two dice (see DicePanel.tsx).

import type { Action, GameState, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { eventCardDrawn } from '../../events.js';
import { resolveDiceRoll } from '../../phases/roll.js';
import { shuffle } from '../../rng.js';
import type { RuleModule } from '../types.js';

/** The 36-card 2d6-distribution deck, built once from the closed-form `count(total) = 6 -
 *  |7 - total|` (the number of 2d6 combinations summing to `total`) rather than hand-listing every
 *  entry, so the invariant is self-evident and cheaply testable. */
export const EVENT_DECK_COMPOSITION: readonly number[] = (() => {
  const deck: number[] = [];
  for (let total = 2; total <= 12; total++) {
    const count = 6 - Math.abs(7 - total);
    for (let i = 0; i < count; i++) deck.push(total);
  }
  return deck;
})();

export interface EventCardsExt {
  /** Remaining cards to draw; index 0 is the next draw. */
  deck: number[];
  /** Cards already drawn this pass, reshuffled into a fresh `deck` once `deck` empties. */
  discard: number[];
}

/** Reads `state.ext.eventCards`, or `undefined` before `ensureEventCardsExt` has run once (or when
 *  the modifier is inactive — this module is simply never in `activeModules`, so nothing ever
 *  calls it). */
export function eventCardsExt(state: GameState): EventCardsExt | undefined {
  return state.ext?.eventCards;
}

function withEventCardsExt(state: GameState, ext: EventCardsExt): GameState {
  return { ...state, ext: { ...state.ext, eventCards: ext } };
}

/**
 * Lazily initializes `ext.eventCards` the first time this module's `interceptAction` ever sees a
 * `rollDice` — the config-gate substitute for a dedicated `initState` hook (see the header). The
 * initial 36-card deck is shuffled via the seeded rng (docs/05 §2 — never `Math.random`), so it is
 * deterministic per seed. A no-op (same reference) once `ext.eventCards` already exists.
 */
export function ensureEventCardsExt(state: GameState): GameState {
  if (eventCardsExt(state)) return state;
  const shuffled = shuffle(state.rng, EVENT_DECK_COMPOSITION);
  return withEventCardsExt({ ...state, rng: shuffled.state }, { deck: shuffled.array, discard: [] });
}

/**
 * Draws the top card, reshuffling `discard` into a fresh `deck` first if `deck` is empty. Assumes
 * `ensureEventCardsExt` has already run on `state` (every call site below guarantees this).
 */
export function drawEventCard(state: GameState): { state: GameState; card: number } {
  const ext = eventCardsExt(state);
  if (!ext) throw new Error('BUG: drawEventCard called before ensureEventCardsExt');

  let deck = ext.deck;
  let discard = ext.discard;
  let rng = state.rng;
  if (deck.length === 0) {
    const reshuffled = shuffle(rng, discard);
    deck = reshuffled.array;
    discard = [];
    rng = reshuffled.state;
  }

  const card = deck[0];
  if (card === undefined) {
    throw new Error('BUG: event-card deck empty even after reshuffling the discard pile');
  }
  const newState = withEventCardsExt({ ...state, rng }, { deck: deck.slice(1), discard: [...discard, card] });
  return { state: newState, card };
}

/**
 * Pre-routing interception (docs/10 §3): a `rollDice` submitted while the actor hasn't rolled yet
 * this turn draws an event card and drives production off it instead of two real dice. Every other
 * case (wrong phase, already rolled, or any other action entirely) returns `null` so normal routing
 * produces the identical error/behavior the base engine already would — this module never
 * re-derives those checks.
 */
function interceptAction(state: GameState, seat: Seat, action: Action): EngineResult | null {
  if (action.type !== 'rollDice') return null;
  if (state.phase.kind !== 'preRoll') return null;
  if (state.turn.rolled) return null;

  const ensured = ensureEventCardsExt(state);
  const drawn = drawEventCard(ensured);
  const total = drawn.card;
  // Synthetic [a, b] pair summing to `total` — see the header for why the split (and its
  // unobservability to every downstream `roll[0] + roll[1]` reader) is safe.
  const a = Math.ceil(total / 2);
  const roll: [number, number] = [a, total - a];

  const result = resolveDiceRoll(drawn.state, seat, roll);
  if (!result.ok) return result;
  return {
    ok: true,
    state: result.state,
    events: [eventCardDrawn(seat, total), ...result.events],
  };
}

export const eventCardsModule: RuleModule = {
  id: 'eventCards',
  interceptAction,
};
