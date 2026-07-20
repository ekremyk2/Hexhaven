// T-802: city improvements (C4), metropolis placement/capture (C4.6) + its VP (C1.3, vp.ts),
// the Trade-L3 Trading House commodity bank trade (C4.5), and the C4.4 canDrawProgress helper.

import { describe, expect, it } from 'vitest';
import type {
  Commodity,
  CitiesKnightsExt,
  GameState,
  ImprovementTrack,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { computeVp } from '../../vp.js';
import { buildImprovement, canDrawProgress, commodityBankTrade } from './improvements.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 13,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: true as const },
};

const ZERO_COMMODITIES: Record<Commodity, number> = { paper: 0, cloth: 0, coin: 0 };
const ZERO_IMPROVEMENTS: Record<ImprovementTrack, number> = { trade: 0, politics: 0, science: 0 };

interface CraftOpts {
  cities?: number[]; // seat 0's cities
  commodities?: Partial<Record<Commodity, number>>; // seat 0's commodity holdings
  improvements?: Partial<Record<ImprovementTrack, number>>; // seat 0's improvement levels
  metropolis?: Partial<Record<ImprovementTrack, Seat | null>>;
  allCommodities?: Partial<Record<Commodity, number>>[]; // full per-seat override (index = seat)
  allImprovements?: Partial<Record<ImprovementTrack, number>>[];
}

function craft(opts: CraftOpts = {}): { state: GameState; ck: CitiesKnightsExt } {
  const g = createGame({ ...CONFIG, seed: 'ck-improvements' });
  const players = g.players.map((p) => (p.seat === 0 ? { ...p, cities: (opts.cities ?? []).map((n) => n as VertexId) } : p));

  const base = g.ext!.citiesKnights!;
  const commodities =
    opts.allCommodities?.map((c) => ({ ...ZERO_COMMODITIES, ...c })) ??
    base.commodities.map((c, i) => (i === 0 ? { ...ZERO_COMMODITIES, ...opts.commodities } : c));
  const improvements =
    opts.allImprovements?.map((imp) => ({ ...ZERO_IMPROVEMENTS, ...imp })) ??
    base.improvements.map((imp, i) => (i === 0 ? { ...ZERO_IMPROVEMENTS, ...opts.improvements } : imp));
  const metropolis = { ...base.metropolis, ...opts.metropolis };

  const ck: CitiesKnightsExt = { ...base, commodities, improvements, metropolis };
  const state: GameState = { ...g, players, phase: { kind: 'main' }, ext: { ...g.ext, citiesKnights: ck } };
  return { state, ck };
}

describe('buildImprovement (C4.1–C4.3)', () => {
  it('rejects a seat with no city (NO_CITY_OWNED, C4.3)', () => {
    const { state } = craft({ cities: [], commodities: { cloth: 5 } });
    const res = buildImprovement(state, 0, 'trade');
    expect(res).toEqual({ ok: false, error: { code: 'NO_CITY_OWNED', message: expect.any(String) } });
  });

  it('rejects when the seat cannot afford the level cost (CANT_AFFORD, C4.2)', () => {
    const { state } = craft({ cities: [10], commodities: { cloth: 0 } });
    const res = buildImprovement(state, 0, 'trade');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CANT_AFFORD');
  });

  it('costs exactly L cloth/coin/paper to reach level L, one level at a time (C4.2)', () => {
    const { state } = craft({ cities: [10], commodities: { cloth: 1 } });
    const res = buildImprovement(state, 0, 'trade');
    expect(res.ok).toBe(true);
    if (res.ok) {
      const ck = res.state.ext!.citiesKnights!;
      expect(ck.improvements[0]!.trade).toBe(1);
      expect(ck.commodities[0]!.cloth).toBe(0); // paid 1 cloth for level 1
    }
  });

  it('rejects advancing past level 5 (IMPROVEMENT_MAX_LEVEL)', () => {
    const { state } = craft({ cities: [10], commodities: { coin: 6 }, improvements: { politics: 5 } });
    const res = buildImprovement(state, 0, 'politics');
    expect(res).toEqual({ ok: false, error: { code: 'IMPROVEMENT_MAX_LEVEL', message: expect.any(String) } });
  });

  it('places the metropolis for the first seat reaching level 4 (C4.6, +2 VP beyond the city)', () => {
    const { state } = craft({ cities: [10], commodities: { paper: 4 }, improvements: { science: 3 } });
    const res = buildImprovement(state, 0, 'science');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.improvements[0]!.science).toBe(4);
    expect(ck.metropolis.science).toBe(0);
    expect(res.events.some((e) => e.type === 'metropolisPlaced')).toBe(true);

    // C1.3: 1 city (2 VP) + metropolis (+2) = 4 VP.
    expect(computeVp(res.state, 0).total).toBe(4);
    expect(computeVp(res.state, 0).metropolises).toBe(2);
  });

  it('does not re-place a metropolis already held by someone else at level 4', () => {
    const { state } = craft({
      cities: [10],
      commodities: { paper: 4 },
      improvements: { science: 3 },
      metropolis: { science: 1 }, // seat 1 already holds it
      allImprovements: [{ science: 3 }, { science: 4 }, {}, {}],
    });
    const res = buildImprovement(state, 0, 'science');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.improvements[0]!.science).toBe(4);
    expect(ck.metropolis.science).toBe(1); // unchanged — still seat 1's
    expect(res.events.some((e) => e.type === 'metropolisPlaced')).toBe(false);
  });

  it('captures the metropolis at level 5 from a holder still at level 4 (C4.6)', () => {
    const { state } = craft({
      cities: [10],
      commodities: { paper: 5 },
      improvements: { science: 4 },
      metropolis: { science: 1 },
      allImprovements: [{ science: 4 }, { science: 4 }, {}, {}],
    });
    const res = buildImprovement(state, 0, 'science');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.metropolis.science).toBe(0); // captured
    expect(res.events.some((e) => e.type === 'metropolisCaptured')).toBe(true);
  });

  it('does NOT capture a metropolis whose holder has already reached level 5 (safe, C4.6)', () => {
    const { state } = craft({
      cities: [10],
      commodities: { paper: 5 },
      improvements: { science: 4 },
      metropolis: { science: 1 },
      allImprovements: [{ science: 4 }, { science: 5 }, {}, {}],
    });
    const res = buildImprovement(state, 0, 'science');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.metropolis.science).toBe(1); // still safe with the original holder
    expect(res.events.some((e) => e.type === 'metropolisCaptured')).toBe(false);
  });
});

describe('commodityBankTrade (C4.5 Trading House)', () => {
  it('trades at the base 4:1 without Trading House', () => {
    const { state } = craft({ cities: [10], commodities: { cloth: 4 } });
    const res = commodityBankTrade(state, 0, 'cloth', 'brick');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.commodities[0]!.cloth).toBe(0);
    expect(res.state.players[0]!.resources.brick).toBe(1);
  });

  it('trades at 2:1 with Trading House (trade improvement >= 3)', () => {
    const { state } = craft({ cities: [10], commodities: { cloth: 2 }, improvements: { trade: 3 } });
    const res = commodityBankTrade(state, 0, 'cloth', 'brick');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext!.citiesKnights!.commodities[0]!.cloth).toBe(0);
    expect(res.state.players[0]!.resources.brick).toBe(1);
  });

  it('can trade one commodity for a different commodity', () => {
    const { state } = craft({ cities: [10], commodities: { cloth: 4, coin: 0 } });
    const res = commodityBankTrade(state, 0, 'cloth', 'coin');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.commodities[0]!.cloth).toBe(0);
    expect(ck.commodities[0]!.coin).toBe(1);
  });

  it('rejects giving and receiving the same type (BAD_TRADE)', () => {
    const { state } = craft({ cities: [10], commodities: { cloth: 4 } });
    const res = commodityBankTrade(state, 0, 'cloth', 'cloth');
    expect(res).toEqual({ ok: false, error: { code: 'BAD_TRADE', message: expect.any(String) } });
  });

  it('rejects when the seat cannot afford the rate (CANT_AFFORD)', () => {
    const { state } = craft({ cities: [10], commodities: { cloth: 1 } });
    const res = commodityBankTrade(state, 0, 'cloth', 'brick');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CANT_AFFORD');
  });

  it('rejects when the target commodity supply is exhausted (BANK_EMPTY, C3.1)', () => {
    const { state } = craft({
      cities: [10],
      commodities: { cloth: 4 },
      allCommodities: [{ cloth: 4 }, {}, { coin: 12 }, {}],
    });
    const res = commodityBankTrade(state, 0, 'cloth', 'coin');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('BANK_EMPTY');
  });
});

describe('canDrawProgress (C4.4)', () => {
  it('never eligible at level 0', () => {
    const { state } = craft();
    expect(canDrawProgress(state, 0, 'science', 1)).toBe(false);
  });

  it('eligible when the red die <= level+1', () => {
    const { state } = craft({ improvements: { science: 2 } });
    expect(canDrawProgress(state, 0, 'science', 3)).toBe(true);
    expect(canDrawProgress(state, 0, 'science', 4)).toBe(false);
  });

  it('level 5 is eligible on any red die', () => {
    const { state } = craft({ improvements: { science: 5 } });
    expect(canDrawProgress(state, 0, 'science', 6)).toBe(true);
  });
});
