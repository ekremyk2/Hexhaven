// Resource production for a dice total (R5). Pure computation: returns per-seat gains and the
// list of resource types that hit the bank-shortage rule (R5.3). The caller (roll.ts) applies it.

import { TERRAIN_RESOURCE } from '@hexhaven/shared';
import type { GameState, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import { geometryForState } from '../modules/index.js';
import { harborSettlementsOf } from '../modules/explorersPirates/state.js';

const RESOURCES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function addGain(map: Map<Seat, ResourceBundle>, seat: Seat, res: ResourceType, amt: number): void {
  const bundle = map.get(seat) ?? {};
  bundle[res] = (bundle[res] ?? 0) + amt;
  map.set(seat, bundle);
}

export interface ProductionResult {
  gains: { seat: Seat; resources: ResourceBundle }[];
  shortages: ResourceType[];
}

/**
 * R5.1–R5.3: every non-robber hex whose token matches `total` pays each adjacent building
 * (settlement 1, city 2). If the bank cannot cover the total demand for a resource type this
 * roll: ≥2 entitled players → nobody gets that type (a "shortage"); exactly 1 entitled player →
 * they receive whatever remains (R5.3).
 *
 * `multiplier` (T-906, docs/07 D-034 `customConstants.productionMultiplier`) scales every
 * per-building yield BEFORE the bank-shortage check runs, so the shortage rule still sees the
 * true (multiplied) demand. Defaults to `1` — every existing call site that doesn't pass it stays
 * bit-identical (RK-13), since multiplying by 1 changes nothing.
 */
export function computeProduction(state: GameState, total: number, multiplier = 1): ProductionResult {
  // demand[res] : Seat -> amount owed this roll
  const demand: Record<ResourceType, Map<Seat, number>> = {
    brick: new Map(),
    lumber: new Map(),
    wool: new Map(),
    grain: new Map(),
    ore: new Map(),
  };

  for (const hex of geometryForState(state).hexes) {
    if (hex.id === state.board.robber) continue; // R5.2: robber blocks its hex
    const tile = state.board.hexes[hex.id];
    if (!tile || tile.token !== total) continue;
    const res = TERRAIN_RESOURCE[tile.terrain];
    if (res == null) continue; // desert never has a token, but be defensive
    for (const vId of hex.vertices) {
      for (const p of state.players) {
        // T-1107 (§EP4.2, ⚠ VERIFY): a harbor settlement produces at the SETTLEMENT rate (1x) — E&P
        // has no cities, and nothing in the rules doc suggests the upgrade doubles production the
        // way a base city does (its bonus is 2 VP + a ship/crew building anchor, not extra yield).
        // `harborSettlementsOf` is `[]` outside a live E&P game, so base/other-expansion production
        // is unchanged (RK-13).
        const harborHere = harborSettlementsOf(state, p.seat).includes(vId);
        const amt =
          (p.cities.includes(vId) ? 2 : p.settlements.includes(vId) || harborHere ? 1 : 0) * multiplier;
        if (amt > 0) demand[res].set(p.seat, (demand[res].get(p.seat) ?? 0) + amt);
      }
    }
  }

  const gainsBySeat = new Map<Seat, ResourceBundle>();
  const shortages: ResourceType[] = [];

  for (const res of RESOURCES) {
    const perSeat = demand[res];
    let totalDemand = 0;
    for (const amt of perSeat.values()) totalDemand += amt;
    if (totalDemand === 0) continue;

    const available = state.bank[res];
    if (totalDemand <= available) {
      for (const [seat, amt] of perSeat) addGain(gainsBySeat, seat, res, amt);
    } else if (perSeat.size === 1) {
      // Exactly one entitled player: they take whatever the bank has left (R5.3).
      const seat = [...perSeat.keys()][0]!;
      if (available > 0) addGain(gainsBySeat, seat, res, available);
    } else {
      // Two or more entitled and the bank can't cover everyone: nobody gets this type (R5.3).
      shortages.push(res);
    }
  }

  const gains = [...gainsBySeat.entries()]
    .map(([seat, resources]) => ({ seat, resources }))
    .sort((a, b) => a.seat - b.seat);
  return { gains, shortages };
}
