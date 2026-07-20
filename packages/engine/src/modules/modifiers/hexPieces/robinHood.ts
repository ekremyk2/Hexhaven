// Robin Hood (T-903, docs/tasks/modifiers-RESEARCH.md Bucket A "Robin Hood", docs/tasks/phase-9/
// PICKS.md "Robin Hood = steal-to-poorest"): purely an `onMove` effect — moving the piece redistributes
// exactly 1 resource card from the seat holding the MOST cards to the seat holding the FEWEST, with
// no block/steal tied to the hex it sits on at all (unlike the base robber, this piece's own hex
// location is otherwise inert — no production hook, no trade-rate hook).
//
// Deterministic tie-break rule (documented per the task brief, since the research doc doesn't spell
// one out): ties for "wealthiest"/"poorest" resolve to the LOWEST seat number among the tied seats
// (`state.players` is already seat-ordered, so a plain `.find` naturally picks it). The specific card
// type taken from the wealthiest seat is the first held type in a fixed resource order (brick, lumber,
// wool, grain, ore) — arbitrary but deterministic, mirroring `cardMods/shared.ts`'s own
// `RESOURCE_ORDER` precedent for "pick a definite resource when the rule doesn't name one".
//
// No-op cases (no redistribution, no event): nobody holds any cards at all (nothing to steal), or the
// wealthiest and poorest seat are the SAME seat (every seat tied on hand size — there is no
// "poorest-that-isn't-the-wealthiest" to give to).
import type { GameState, ResourceType, Seat } from '@hexhaven/shared';
import { bundleTotal } from '@hexhaven/shared';
import { stolen } from '../../../events.js';
import type { HexPieceHookResult, HexPieceKind } from './types.js';

const RESOURCE_ORDER: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

/** The (wealthiest, poorest) seat pair for this redistribution, or `null` when there's nothing to
 *  redistribute (see header). */
function wealthiestAndPoorest(state: GameState): { wealthiest: Seat; poorest: Seat } | null {
  const totals = state.players.map((p) => ({ seat: p.seat, total: bundleTotal(p.resources) }));
  const maxTotal = Math.max(...totals.map((t) => t.total));
  if (maxTotal === 0) return null; // nobody holds a single card
  const minTotal = Math.min(...totals.map((t) => t.total));
  // `.find` over seat-ordered `players` picks the LOWEST tied seat for each side (documented above).
  const wealthiest = totals.find((t) => t.total === maxTotal)!.seat;
  const poorest = totals.find((t) => t.total === minTotal)!.seat;
  if (wealthiest === poorest) return null; // every seat tied — nobody strictly "poorer"
  return { wealthiest, poorest };
}

function robinHoodOnMove(state: GameState): HexPieceHookResult {
  const pair = wealthiestAndPoorest(state);
  if (!pair) return { state, events: [] };
  const { wealthiest, poorest } = pair;
  const wealthyPlayer = state.players[wealthiest]!;
  const card = RESOURCE_ORDER.find((r) => wealthyPlayer.resources[r] > 0);
  if (!card) return { state, events: [] }; // defensive: maxTotal>0 above guarantees this is unreachable

  const players = state.players.map((p) => {
    if (p.seat === wealthiest) return { ...p, resources: { ...p.resources, [card]: p.resources[card] - 1 } };
    if (p.seat === poorest) return { ...p, resources: { ...p.resources, [card]: p.resources[card] + 1 } };
    return p;
  });
  return { state: { ...state, players }, events: [stolen(wealthiest, poorest, card)] };
}

export const robinHoodKind: HexPieceKind = {
  id: 'robinHood',
  onMove: robinHoodOnMove,
};
