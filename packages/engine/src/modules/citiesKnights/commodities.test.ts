// T-802: commodity production (C3.3) + the Science-L3 Aqueduct (C4.5). Pure unit tests over
// `computeCkProduction`/`applyAqueduct` with a fully controlled board — same `craft()` pattern as
// `phases/roll.test.ts`'s base `computeProduction` tests, but with `expansions.citiesKnights: true`
// and per-seat improvement/commodity holdings supplied for the cap/Aqueduct cases.

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type {
  Commodity,
  CitiesKnightsExt,
  GameState,
  ImprovementTrack,
  ResourceType,
  Seat,
  TerrainType,
  VertexId,
} from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { applyAqueduct, computeCkProduction } from './commodities.js';
import { initCitiesKnightsExt } from './state.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 13,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: true as const },
};

const ZERO_COMMODITIES: Record<Commodity, number> = { paper: 0, cloth: 0, coin: 0 };
const ZERO_IMPROVEMENTS: Record<ImprovementTrack, number> = { trade: 0, politics: 0, science: 0 };

interface Craft {
  tiles?: { hex: number; terrain: TerrainType; token: number | null }[];
  robber: number;
  place?: { seat: Seat; settlements?: number[]; cities?: number[] }[];
  bank?: Partial<Record<ResourceType, number>>;
  commodities?: Partial<Record<Commodity, number>>[]; // index = seat
  improvements?: Partial<Record<ImprovementTrack, number>>[]; // index = seat
}

/** A fully controlled board (blank all-desert + the tiles we specify) with a live C&K ext. */
function craft(opts: Craft): { state: GameState; ck: CitiesKnightsExt } {
  const g = createGame({ ...CONFIG, seed: 'ck-commodities' });
  const hexes = g.board.hexes.map(() => ({ terrain: 'desert' as TerrainType, token: null as number | null }));
  for (const t of opts.tiles ?? []) hexes[t.hex] = { terrain: t.terrain, token: t.token };
  const players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    return {
      ...p,
      settlements: (pl.settlements ?? []).map((n) => n as VertexId),
      cities: (pl.cities ?? []).map((n) => n as VertexId),
    };
  });
  const bank = { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19, ...opts.bank };

  const baseExt = initCitiesKnightsExt(4, g.rng).ext;
  const commodities = baseExt.commodities.map((c, i) => ({ ...ZERO_COMMODITIES, ...c, ...(opts.commodities?.[i] ?? {}) }));
  const improvements = baseExt.improvements.map((imp, i) => ({
    ...ZERO_IMPROVEMENTS,
    ...imp,
    ...(opts.improvements?.[i] ?? {}),
  }));
  const ck: CitiesKnightsExt = { ...baseExt, commodities, improvements };

  const state: GameState = {
    ...g,
    board: { ...g.board, hexes, robber: opts.robber as GameState['board']['robber'] },
    players,
    bank,
    ext: { ...g.ext, citiesKnights: ck },
  };
  return { state, ck };
}

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as number;

describe('computeCkProduction (C3.3)', () => {
  it('a city on forest yields 1 lumber + 1 paper (not the base 2 lumber)', () => {
    const { state, ck } = craft({
      tiles: [{ hex: 0, terrain: 'forest', token: 8 }],
      robber: 18,
      place: [{ seat: 0, cities: [vtx(0, 0)] }],
    });
    const result = computeCkProduction(state, 8, ck);
    expect(result.resourceGains.find((g) => g.seat === 0)?.resources.lumber).toBe(1);
    expect(result.commodityGains.find((g) => g.seat === 0)?.commodities.paper).toBe(1);
  });

  it('a city on pasture yields 1 wool + 1 cloth', () => {
    const { state, ck } = craft({
      tiles: [{ hex: 0, terrain: 'pasture', token: 8 }],
      robber: 18,
      place: [{ seat: 0, cities: [vtx(0, 0)] }],
    });
    const result = computeCkProduction(state, 8, ck);
    expect(result.resourceGains.find((g) => g.seat === 0)?.resources.wool).toBe(1);
    expect(result.commodityGains.find((g) => g.seat === 0)?.commodities.cloth).toBe(1);
  });

  it('a city on mountains yields 1 ore + 1 coin', () => {
    const { state, ck } = craft({
      tiles: [{ hex: 0, terrain: 'mountains', token: 8 }],
      robber: 18,
      place: [{ seat: 0, cities: [vtx(0, 0)] }],
    });
    const result = computeCkProduction(state, 8, ck);
    expect(result.resourceGains.find((g) => g.seat === 0)?.resources.ore).toBe(1);
    expect(result.commodityGains.find((g) => g.seat === 0)?.commodities.coin).toBe(1);
  });

  it('a city on hills yields 2 brick, no commodity (base behavior unchanged, C3.3)', () => {
    const { state, ck } = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      robber: 18,
      place: [{ seat: 0, cities: [vtx(0, 0)] }],
    });
    const result = computeCkProduction(state, 8, ck);
    expect(result.resourceGains.find((g) => g.seat === 0)?.resources.brick).toBe(2);
    expect(result.commodityGains.find((g) => g.seat === 0)).toBeUndefined();
  });

  it('a city on fields yields 2 grain, no commodity', () => {
    const { state, ck } = craft({
      tiles: [{ hex: 0, terrain: 'fields', token: 8 }],
      robber: 18,
      place: [{ seat: 0, cities: [vtx(0, 0)] }],
    });
    const result = computeCkProduction(state, 8, ck);
    expect(result.resourceGains.find((g) => g.seat === 0)?.resources.grain).toBe(2);
    expect(result.commodityGains.find((g) => g.seat === 0)).toBeUndefined();
  });

  it('a settlement on forest yields 1 lumber and NO commodity (only cities produce commodities)', () => {
    const { state, ck } = craft({
      tiles: [{ hex: 0, terrain: 'forest', token: 8 }],
      robber: 18,
      place: [{ seat: 0, settlements: [vtx(0, 0)] }],
    });
    const result = computeCkProduction(state, 8, ck);
    expect(result.resourceGains.find((g) => g.seat === 0)?.resources.lumber).toBe(1);
    expect(result.commodityGains).toEqual([]);
  });

  it('the robber blocks its hex (R5.2) for both resource and commodity production', () => {
    const { state, ck } = craft({
      tiles: [{ hex: 0, terrain: 'forest', token: 8 }],
      robber: 0,
      place: [{ seat: 0, cities: [vtx(0, 0)] }],
    });
    const result = computeCkProduction(state, 8, ck);
    expect(result.resourceGains).toEqual([]);
    expect(result.commodityGains).toEqual([]);
  });

  it('commodity supply cap (C3.1): 2+ entitled seats over the 12 cap -> nobody gets that commodity', () => {
    const { state, ck } = craft({
      tiles: [
        { hex: 0, terrain: 'forest', token: 8 },
        { hex: 9, terrain: 'forest', token: 8 },
      ],
      robber: 18,
      place: [
        { seat: 0, cities: [vtx(0, 0)] },
        { seat: 1, cities: [vtx(9, 0)] },
      ],
      // 11 paper already out (seat 2 holds them) -- only 1 left, but 2 seats each demand 1 this roll.
      commodities: [{}, {}, { paper: 11 }],
    });
    const result = computeCkProduction(state, 8, ck);
    expect(result.commodityShortages).toEqual(['paper']);
    expect(result.commodityGains.find((g) => g.seat === 0)).toBeUndefined();
    expect(result.commodityGains.find((g) => g.seat === 1)).toBeUndefined();
    // The resource half of production is unaffected by the commodity cap.
    expect(result.resourceGains.find((g) => g.seat === 0)?.resources.lumber).toBe(1);
  });

  it('commodity supply cap: exactly 1 entitled seat takes whatever remains', () => {
    const { state, ck } = craft({
      tiles: [{ hex: 0, terrain: 'forest', token: 8 }],
      robber: 18,
      place: [{ seat: 0, cities: [vtx(0, 0)] }],
      commodities: [{}, {}, { paper: 12 }],
    });
    expect(ck.commodities[2]!.paper).toBe(12); // supply already exhausted
    const result = computeCkProduction(state, 8, ck);
    expect(result.commodityShortages).toEqual([]);
    expect(result.commodityGains.find((g) => g.seat === 0)?.commodities.paper).toBeUndefined();
  });
});

describe('applyAqueduct (C4.5, Science-L3)', () => {
  const emptyResult = { resourceGains: [], commodityGains: [], resourceShortages: [], commodityShortages: [] };

  it('grants 1 resource of choice to a science-L3 seat that produced nothing', () => {
    const g = createGame({ ...CONFIG, seed: 'ck-aqueduct' });
    const players = g.players.map((p) => (p.seat === 0 ? { ...p, resources: { brick: 3, lumber: 0, wool: 3, grain: 3, ore: 3 } } : p));
    const improvements = g.players.map((_, i) => (i === 0 ? { ...ZERO_IMPROVEMENTS, science: 3 } : { ...ZERO_IMPROVEMENTS }));

    const { players: outPlayers, bank: outBank, grants } = applyAqueduct(players, g.bank, improvements, emptyResult);
    expect(grants).toEqual([{ seat: 0, resource: 'lumber' }]); // fewest held -> most needed
    expect(outPlayers.find((p) => p.seat === 0)?.resources.lumber).toBe(1);
    expect(outBank.lumber).toBe(g.bank.lumber - 1);
  });

  it('does nothing for a seat below science level 3', () => {
    const g = createGame({ ...CONFIG, seed: 'ck-aqueduct-2' });
    const improvements = g.players.map(() => ({ ...ZERO_IMPROVEMENTS, science: 2 }));
    const { grants } = applyAqueduct(g.players, g.bank, improvements, emptyResult);
    expect(grants).toEqual([]);
  });

  it('does nothing for a seat that DID produce something this roll', () => {
    const g = createGame({ ...CONFIG, seed: 'ck-aqueduct-3' });
    const improvements = g.players.map(() => ({ ...ZERO_IMPROVEMENTS, science: 3 }));
    const result = { ...emptyResult, resourceGains: [{ seat: 0 as Seat, resources: { ore: 1 } }] };
    const { grants } = applyAqueduct(g.players, g.bank, improvements, result);
    expect(grants.find((x) => x.seat === 0)).toBeUndefined();
  });

  it('skips a seat when the bank is fully empty', () => {
    const g = createGame({ ...CONFIG, seed: 'ck-aqueduct-4' });
    const improvements = g.players.map((_, i) => (i === 0 ? { ...ZERO_IMPROVEMENTS, science: 3 } : { ...ZERO_IMPROVEMENTS }));
    const emptyBank = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    const { grants } = applyAqueduct(g.players, emptyBank, improvements, emptyResult);
    expect(grants).toEqual([]);
  });
});
