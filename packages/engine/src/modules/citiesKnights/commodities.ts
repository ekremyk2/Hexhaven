// Cities & Knights commodity production (T-802, docs/rules/cities-knights-rules.md C3). A pure,
// from-scratch recomputation of a roll's production under C&K rules — NOT a patch over the base
// `computeProduction` (rules/production.ts), because C3.3 changes what a CITY yields on three
// terrains (1 resource + 1 commodity instead of the base "2 resources"); settlements and cities on
// hills/fields are unchanged. The citiesKnights module's `afterAction` hook (index.ts) calls this
// with the PRE-roll state (so `state.bank` and every player's holdings are the exact snapshot the
// base engine's own `computeProduction` used) and replaces the base roll's (base-incorrect, for a
// C&K game) resource application with the result here — the seam documented at the top of index.ts.

import { CK_COMMODITY_SUPPLY, TERRAIN_RESOURCE } from '@hexhaven/shared';
import type {
  Commodity,
  CitiesKnightsExt,
  GameState,
  ResourceBundle,
  ResourceType,
  Seat,
  TerrainType,
} from '@hexhaven/shared';
import { geometryForState } from '../index.js';

const RESOURCES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
const COMMODITIES: readonly Commodity[] = ['paper', 'cloth', 'coin'];

/** C3.2: only these three terrains ever yield a commodity (from a CITY only, C3.3). */
const COMMODITY_TERRAIN: Partial<Record<TerrainType, Commodity>> = {
  forest: 'paper',
  pasture: 'cloth',
  mountains: 'coin',
};

export interface CkProductionResult {
  /** C3.3: resource gains, already CK-adjusted (a city on a commodity terrain contributes only 1,
   *  not the base 2 — the other 1 became a commodity below). Same bank-shortage rule as base R5.3. */
  resourceGains: { seat: Seat; resources: ResourceBundle }[];
  resourceShortages: ResourceType[];
  /** C3.3: commodity gains — 1 per city on a matching terrain per matching hex. */
  commodityGains: { seat: Seat; commodities: Partial<Record<Commodity, number>> }[];
  /** C3.1: a commodity type whose 12-unit supply couldn't cover 2+ entitled seats this roll (the
   *  commodity analogue of a bank resource shortage). */
  commodityShortages: Commodity[];
}

function addAmt(map: Map<Seat, number>, seat: Seat, amt: number): void {
  map.set(seat, (map.get(seat) ?? 0) + amt);
}

/**
 * C3.3 production for dice `total`, from `state` (read as a PRE-roll snapshot — same contract as
 * `rules/production.ts`'s `computeProduction`: `state.bank`/players are the "before this roll"
 * values). `ck` supplies the CURRENT per-seat commodity holdings for the 12-supply cap (C3.1),
 * shared across all seats — the same shortage shape as a resource bank running out (R5.3), applied
 * per commodity type.
 */
export function computeCkProduction(state: GameState, total: number, ck: CitiesKnightsExt): CkProductionResult {
  const resDemand: Record<ResourceType, Map<Seat, number>> = {
    brick: new Map(),
    lumber: new Map(),
    wool: new Map(),
    grain: new Map(),
    ore: new Map(),
  };
  const commodityDemand: Record<Commodity, Map<Seat, number>> = {
    paper: new Map(),
    cloth: new Map(),
    coin: new Map(),
  };

  for (const hex of geometryForState(state).hexes) {
    if (hex.id === state.board.robber) continue; // R5.2: robber blocks its hex
    const tile = state.board.hexes[hex.id];
    if (!tile || tile.token !== total) continue;
    const res = TERRAIN_RESOURCE[tile.terrain];
    if (res == null) continue; // desert never has a token, but be defensive
    const commodity = COMMODITY_TERRAIN[tile.terrain];

    for (const vId of hex.vertices) {
      for (const p of state.players) {
        const isCity = p.cities.includes(vId);
        const isSettlement = !isCity && p.settlements.includes(vId);
        if (isCity && commodity) {
          // C3.3: city on forest/pasture/mountains -> 1 resource + 1 commodity (not the base 2).
          addAmt(resDemand[res], p.seat, 1);
          addAmt(commodityDemand[commodity], p.seat, 1);
        } else if (isCity) {
          // C3.3: city on hills/fields -> 2 resources, unchanged from base.
          addAmt(resDemand[res], p.seat, 2);
        } else if (isSettlement) {
          addAmt(resDemand[res], p.seat, 1);
        }
      }
    }
  }

  // Resources: identical bank-shortage rule to base R5.3 (rules/production.ts), over the
  // CK-adjusted demand computed above.
  const gainsBySeat = new Map<Seat, ResourceBundle>();
  const resourceShortages: ResourceType[] = [];
  for (const res of RESOURCES) {
    const perSeat = resDemand[res];
    let totalDemand = 0;
    for (const amt of perSeat.values()) totalDemand += amt;
    if (totalDemand === 0) continue;

    const available = state.bank[res];
    if (totalDemand <= available) {
      for (const [seat, amt] of perSeat) {
        const bundle = gainsBySeat.get(seat) ?? {};
        bundle[res] = (bundle[res] ?? 0) + amt;
        gainsBySeat.set(seat, bundle);
      }
    } else if (perSeat.size === 1) {
      const seat = [...perSeat.keys()][0]!;
      if (available > 0) {
        const bundle = gainsBySeat.get(seat) ?? {};
        bundle[res] = (bundle[res] ?? 0) + available;
        gainsBySeat.set(seat, bundle);
      }
    } else {
      resourceShortages.push(res);
    }
  }

  // Commodities: the same shortage SHAPE (R5.3), but the "bank" is the shared 12-per-commodity
  // supply (C3.1) — available = 12 minus what's already out among all seats' current holdings.
  const commodityGainsBySeat = new Map<Seat, Partial<Record<Commodity, number>>>();
  const commodityShortages: Commodity[] = [];
  for (const commodity of COMMODITIES) {
    const perSeat = commodityDemand[commodity];
    let totalDemand = 0;
    for (const amt of perSeat.values()) totalDemand += amt;
    if (totalDemand === 0) continue;

    const currentTotal = ck.commodities.reduce((sum, c) => sum + c[commodity], 0);
    const available = CK_COMMODITY_SUPPLY - currentTotal;
    if (totalDemand <= available) {
      for (const [seat, amt] of perSeat) {
        const bundle = commodityGainsBySeat.get(seat) ?? {};
        bundle[commodity] = (bundle[commodity] ?? 0) + amt;
        commodityGainsBySeat.set(seat, bundle);
      }
    } else if (perSeat.size === 1) {
      const seat = [...perSeat.keys()][0]!;
      if (available > 0) {
        const bundle = commodityGainsBySeat.get(seat) ?? {};
        bundle[commodity] = (bundle[commodity] ?? 0) + available;
        commodityGainsBySeat.set(seat, bundle);
      }
    } else {
      commodityShortages.push(commodity);
    }
  }

  return {
    resourceGains: [...gainsBySeat.entries()]
      .map(([seat, resources]) => ({ seat, resources }))
      .sort((a, b) => a.seat - b.seat),
    resourceShortages,
    commodityGains: [...commodityGainsBySeat.entries()]
      .map(([seat, commodities]) => ({ seat, commodities }))
      .sort((a, b) => a.seat - b.seat),
    commodityShortages,
  };
}

const RESOURCE_PRIORITY: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

/**
 * C4.5 Science-L3 Aqueduct: a seat with science improvement >= 3 who produced NOTHING this roll
 * (no resource AND no commodity) takes 1 resource of their choice from the bank. The official rule
 * is an interactive choice; simplified here (per T-802 scope) to an automatic "most-needed" pick —
 * the resource type the seat currently holds the fewest of, tie-broken by a fixed priority order,
 * skipped entirely if the bank has none of anything left. Returns the (possibly) updated players
 * and bank plus one `aqueductGranted` per seat that received a card — call AFTER resource/commodity
 * gains from `computeCkProduction` have already been applied to `players`/`bank`.
 */
export function applyAqueduct(
  players: GameState['players'],
  bank: GameState['bank'],
  improvements: CitiesKnightsExt['improvements'],
  result: CkProductionResult
): { players: GameState['players']; bank: GameState['bank']; grants: { seat: Seat; resource: ResourceType }[] } {
  let outPlayers = players;
  const outBank = { ...bank };
  const grants: { seat: Seat; resource: ResourceType }[] = [];

  for (const p of players) {
    const scienceLevel = improvements[p.seat]?.science ?? 0;
    if (scienceLevel < 3) continue;

    const resGain = result.resourceGains.find((g) => g.seat === p.seat);
    const comGain = result.commodityGains.find((g) => g.seat === p.seat);
    const gotResource = resGain ? Object.values(resGain.resources).some((v) => (v ?? 0) > 0) : false;
    const gotCommodity = comGain ? Object.values(comGain.commodities).some((v) => (v ?? 0) > 0) : false;
    if (gotResource || gotCommodity) continue;

    const sortedByNeed = [...RESOURCE_PRIORITY].sort((a, b) => p.resources[a] - p.resources[b]);
    const pick = sortedByNeed.find((r) => outBank[r] > 0);
    if (!pick) continue; // bank fully empty of every resource — nothing to grant

    outPlayers = outPlayers.map((pl) =>
      pl.seat === p.seat ? { ...pl, resources: { ...pl.resources, [pick]: pl.resources[pick] + 1 } } : pl
    );
    outBank[pick] -= 1;
    grants.push({ seat: p.seat, resource: pick });
  }

  return { players: outPlayers, bank: outBank, grants };
}
