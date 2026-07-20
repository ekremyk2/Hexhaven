// "Cloth for Hexhaven" (T-757, Seafarers 5–6 extension, docs/tasks/phase-7b/T-757-cloth-for-hexhaven-56.md).
// NEW MECHANIC: small islands carry VILLAGES; producing near a village earns CLOTH tokens, and every
// 2 cloth = 1 VP. Combines two existing patterns rather than inventing a third:
//   - production-on-roll (gold.ts's shape): folded into the SAME dice-roll hook gold production uses
//     (modules/seafarers/index.ts's `afterAction`) — NO new Action.
//   - a per-seat VP contribution (chits.ts's shape): `clothVp` is derived from `ext.seafarers.cloth`
//     and folded into `vp.ts`'s `computeVp`, exactly like `islandChitVp` — NO new event/phase.
//
// Model (PM-decided, task spec): a village hex is a specific small-island position
// (`scenarioVillageHexesFor`, board.ts). On a dice roll `n`, for each village whose CURRENT board
// token equals `n` (S10.4 re-randomizes terrain/tokens within region every game, exactly like a gold
// hex — see scenario.ts's CLOTH_FOR_HEXHAVEN header), every seat with a settlement/city on ANY vertex
// touching that hex gains 1 cloth — a documented SIMPLIFICATION of the official "nearest two players
// split the cloth" rule (flagged in scenario.ts's `verify[]`). A seat with two buildings on the SAME
// village hex still earns only 1 cloth (deduped per hex/seat), matching "each seat ... gains 1 cloth"
// literally. A village hex under the robber produces no cloth (mirrors R5.2/gold.ts's S9.3 check).
//
// `ext.seafarers.cloth` is `undefined` for every scenario OTHER than Cloth for Hexhaven (state.ts's
// `initialSeafarersExt`), so every function here is a no-op for them — RK-13/other-scenario byte
// identity.

import type { GameState, Seat } from '@hexhaven/shared';
import { geometryForState } from '../index.js';
import { scenarioVillageHexesFor } from './board.js';
import { clothOf, seafarersExt } from './state.js';

/**
 * Per-seat cloth GAINED (not cumulative) for dice `total` (T-757 model above). Returns `null` when
 * there is nothing to grant — no Cloth for Hexhaven ext (`ext.seafarers.cloth` absent), no village hex's
 * CURRENT token matches `total`, the robber sits on the only matching village, or no seat touches one
 * — so callers can skip the state update cheaply, exactly like `computeGoldOwed`'s `pending`.
 */
export function computeClothGains(state: GameState, total: number): Partial<Record<Seat, number>> | null {
  const ext = seafarersExt(state);
  if (!ext?.cloth) return null;
  const villages = scenarioVillageHexesFor(state.config);
  if (villages.length === 0) return null;

  const geometry = geometryForState(state);
  const gains: Partial<Record<Seat, number>> = {};
  let any = false;
  for (const hex of villages) {
    if (hex === state.board.robber) continue; // R5.2/S9.3-style: the robber blocks its hex's production
    const tile = state.board.hexes[hex];
    if (!tile || tile.token !== total) continue;
    const geomHex = geometry.hexes[hex];
    if (!geomHex) continue;

    // Dedup per hex/seat: a seat with two buildings touching the SAME village still earns 1 cloth
    // from it this roll (the task spec's literal "each seat ... gains 1 cloth", not per-building).
    const touchingSeats = new Set<Seat>();
    for (const vId of geomHex.vertices) {
      for (const p of state.players) {
        if (p.cities.includes(vId) || p.settlements.includes(vId)) touchingSeats.add(p.seat);
      }
    }
    for (const seat of touchingSeats) {
      gains[seat] = (gains[seat] ?? 0) + 1;
      any = true;
    }
  }
  return any ? gains : null;
}

/** Applies `gains` (from `computeClothGains`) to `ext.seafarers.cloth`, immutably (spread-copy only
 *  that branch). Returns `state` unchanged (reference-equal) when `gains` is `null` or there is no
 *  Cloth for Hexhaven ext — callers can call this unconditionally. */
export function applyClothGains(state: GameState, gains: Partial<Record<Seat, number>> | null): GameState {
  if (!gains) return state;
  const ext = seafarersExt(state);
  if (!ext?.cloth) return state;
  const cloth = ext.cloth.map((c, seat) => c + (gains[seat as Seat] ?? 0));
  return { ...state, ext: { ...state.ext, seafarers: { ...ext, cloth } } };
}

/** Is `state` a Cloth for Hexhaven game? (`ext.seafarers.cloth` present.) Used by `vp.ts` to gate the
 *  `clothVp` breakdown field's PRESENCE (not just its value) so every other scenario's `VpBreakdown`
 *  shape stays byte-identical (same bit-identity discipline as `metropolises`/`caravansVp`/etc). */
export function isClothForHexhavenState(state: GameState): boolean {
  return seafarersExt(state)?.cloth !== undefined;
}

/** Cloth for Hexhaven VP (T-757): "every 2 cloth = 1 VP" — `floor(cloth / 2)`. `0` for a base game, a
 *  seat with no cloth, or any scenario other than Cloth for Hexhaven (`clothOf` already defaults to 0). */
export function clothVp(state: GameState, seat: Seat): number {
  return Math.floor(clothOf(state, seat) / 2);
}
