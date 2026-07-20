// Special awards (Longest Road / Largest Army). T-105 shipped this as an identity STUB so build
// and dev-card modules could call the wiring point before the real logic existed. T-110 replaced
// the body with the real Longest Road recompute + `awardMoved` emission. T-111 (this update) adds
// the Largest Army half and composes both into `updateAwards`.

import type { GameEvent, GameState, Seat } from '@hexhaven/shared';
import { awardMoved } from '../events.js';
import { updateLongestRoad } from './longestRoad.js';

/**
 * R12 recompute: first seat to reach **3 played knights** takes the card; another seat takes it
 * only with **strictly more** played knights than the current holder; ties keep the holder; the
 * card is **never set aside** once claimed (unlike Longest Road — a seat's `playedKnights` only
 * ever increases, so there is no "break" case to unwind). Returns a NEW state with
 * `awards.largestArmy` set correctly, or the SAME reference when nothing changes.
 *
 * Mirrors `updateLongestRoad`'s shape: a full recompute from `state.players[*].playedKnights`
 * every call, with the SAME "only a sole leader at the max may claim/steal" guard the Longest
 * Road side uses — one seat's count changes per call in practice (dev cards are played one at a
 * time), so a genuine multi-way tie for the max only arises from a hand-crafted test state; in
 * that case nobody (re)claims/steals until a single leader emerges, same as R11.3's tie handling.
 */
export function updateLargestArmy(state: GameState): GameState {
  const counts = new Map<Seat, number>(state.players.map((p) => [p.seat, p.playedKnights]));
  const maxCount = Math.max(0, ...counts.values());
  const current = state.awards.largestArmy;

  const holderCount = current.holder !== null ? (counts.get(current.holder) ?? 0) : 0;

  let holder: Seat | null;
  let count: number;

  if (current.holder !== null && maxCount <= holderCount) {
    // R12: nobody strictly exceeds the current holder (ties included) — they keep the card;
    // refresh `count` in case the holder's own tally is what grew.
    holder = current.holder;
    count = holderCount;
  } else if (maxCount >= 3) {
    // Either unclaimed so far, or a challenger's tally exceeds the holder's — but claiming
    // (first-to-3) and stealing (strictly-more) both require a SOLE leader at the new max.
    const leaders = [...counts.entries()].filter(([, c]) => c === maxCount);
    if (leaders.length === 1) {
      holder = leaders[0]![0];
      count = maxCount;
    } else {
      holder = current.holder;
      count = holderCount;
    }
  } else {
    // Nobody has reached 3 played knights yet.
    holder = null;
    count = 0;
  }

  if (holder === current.holder && count === current.count) return state;
  return { ...state, awards: { ...state.awards, largestArmy: { holder, count } } };
}

/**
 * Recompute BOTH award holders after a state change and return any `awardMoved` events.
 * Longest Road half (R11.2/R11.3): delegates to `updateLongestRoad`. Largest Army half (R12):
 * delegates to `updateLargestArmy`, composed on TOP of the Longest Road result so a single call
 * covers both — each sub-recompute independently returns the same state reference when nothing
 * changed, so the whole function is a no-op (same reference) when neither award moves.
 */
export function updateAwards(state: GameState): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  const beforeLR = state.awards.longestRoad;
  const afterRoad = updateLongestRoad(state);
  const afterLR = afterRoad.awards.longestRoad;
  if (afterLR.holder !== beforeLR.holder || afterLR.length !== beforeLR.length) {
    events.push(awardMoved('longestRoad', afterLR.holder, afterLR.length));
  }

  const beforeLA = afterRoad.awards.largestArmy;
  const afterArmy = updateLargestArmy(afterRoad);
  const afterLA = afterArmy.awards.largestArmy;
  if (afterLA.holder !== beforeLA.holder || afterLA.count !== beforeLA.count) {
    events.push(awardMoved('largestArmy', afterLA.holder, afterLA.count));
  }

  return { state: afterArmy, events };
}
