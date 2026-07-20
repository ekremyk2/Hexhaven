// "The Pirate Islands" (T-758, Seafarers 5–6 extension) pirate-lair capture. Mirrors chits.ts's
// `grantIslandChit` per-seat VP-chit shape (folded into the SAME afterAction hook, on a ship OR
// settlement placement, modules/seafarers/index.ts) — NO new event/action/phase/error code. Unlike
// `grantIslandChit` (which reuses the existing `islandSettled` event), lair capture emits NO event at
// all — the existing event doesn't fit the semantics, and T-757's cloth-production hook already
// established the precedent that a silently-applied ext update needs no event of its own (the client
// reads the new PUBLIC `ext.seafarers.lairs` field straight off state, exactly like `cloth`).
//
// Model (PM-decided, task spec): the FIRST seat to place a ship or settlement on an edge/vertex
// touching a scenario-marked lair hex (`board.ts`'s `scenarioLairHexesFor`) captures it — recorded
// under `ext.seafarers.lairs[seat]` (mirrors `islandChits`' per-seat shape). `lairVp` folds
// `lairs[seat].length * LAIR_VP` into the VP breakdown (vp.ts), gated on `ext.seafarers.lairs`
// presence (Pirate Islands only) so every other scenario's `VpBreakdown` shape stays byte-identical.

import type { GameState, HexId, Seat } from '@hexhaven/shared';
import { scenarioLairHexesFor } from './board.js';
import { seafarersExt, withSeafarersExt } from './state.js';

/** ⚠ VERIFY (T-758's own v1 DECISION — no printed booklet in hand): VP awarded for capturing one
 *  pirate lair. */
export const LAIR_VP = 1;

/** Is `state` a Pirate Islands game? (`ext.seafarers.lairs` present.) Used by `vp.ts` to gate the
 *  `lairVp` breakdown field's PRESENCE (not just its value), same bit-identity discipline as
 *  `isClothForHexhavenState`. */
export function isPirateIslandsState(state: GameState): boolean {
  return seafarersExt(state)?.lairs !== undefined;
}

/** `seat`'s lair-capture VP (T-758): `LAIR_VP` per captured lair. `0` for a base game, a seat with no
 *  captures, or any scenario other than Pirate Islands (`ext.seafarers.lairs` absent). */
export function lairVp(state: GameState, seat: Seat): number {
  const lairs = seafarersExt(state)?.lairs?.[seat];
  return (lairs?.length ?? 0) * LAIR_VP;
}

/** Every lair hex already captured by ANY seat (a lair is captured once, globally — "first seat to
 *  touch it", not a per-seat repeatable chit like `islandChits`). */
function capturedLairHexes(lairs: readonly (readonly HexId[])[]): Set<HexId> {
  const out = new Set<HexId>();
  for (const list of lairs) for (const h of list) out.add(h);
  return out;
}

/**
 * If any of `touchedHexes` (the hexes adjacent to `seat`'s newly-placed ship edge / settlement
 * vertex) is a not-yet-captured Pirate Islands lair, capture it (record under
 * `ext.seafarers.lairs[seat]`) and return the updated state. Captures EVERY newly-touched lair at
 * once (placements rarely touch more than one, but nothing forbids it). Returns `null` when there is
 * nothing to grant (no Pirate Islands ext, no touched lair, or every touched lair already captured by
 * some seat) — callers can skip the state update cheaply, exactly like `computeClothGains`'s `null`.
 */
export function grantLairCapture(
  state: GameState,
  seat: Seat,
  touchedHexes: readonly HexId[]
): { state: GameState } | null {
  const ext = seafarersExt(state);
  if (!ext?.lairs) return null;
  const lairHexes = scenarioLairHexesFor(state.config);
  if (lairHexes.length === 0) return null;

  const captured = capturedLairHexes(ext.lairs);
  const newlyCaptured = touchedHexes.filter((h) => lairHexes.includes(h) && !captured.has(h));
  if (newlyCaptured.length === 0) return null;

  const lairs = ext.lairs.map((list, s) => (s === seat ? [...list, ...newlyCaptured] : list));
  return { state: withSeafarersExt(state, { ...ext, lairs }) };
}
