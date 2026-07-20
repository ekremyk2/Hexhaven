import { describe, it, expect } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { GameState, HexId, ResourceType, Seat, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { reduce } from '../reduce.js';
import { rollDie } from '../rng.js';
import { computeProduction } from '../rules/production.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

interface Craft {
  tiles?: { hex: number; terrain: TerrainType; token: number | null }[];
  robber: number;
  place?: {
    seat: Seat;
    settlements?: number[];
    cities?: number[];
    hand?: Partial<Record<ResourceType, number>>;
  }[];
  bank?: Partial<Record<ResourceType, number>>;
  rng?: number;
  rolled?: boolean;
}

/** A fully controlled preRoll state: blank all-desert board + only the tiles/pieces we specify. */
function craft(opts: Craft): GameState {
  const g = createGame({ ...CONFIG, seed: 'craft' });
  const hexes = g.board.hexes.map(() => ({ terrain: 'desert' as TerrainType, token: null as number | null }));
  for (const t of opts.tiles ?? []) hexes[t.hex] = { terrain: t.terrain, token: t.token };
  const players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    return {
      ...p,
      settlements: (pl.settlements ?? []).map((n) => n as VertexId),
      cities: (pl.cities ?? []).map((n) => n as VertexId),
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0, ...pl.hand },
    };
  });
  return {
    ...g,
    board: { ...g.board, hexes, robber: opts.robber as HexId },
    players,
    bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19, ...opts.bank },
    rng: opts.rng ?? g.rng,
    turn: { ...g.turn, rolled: opts.rolled ?? false, roll: null },
    phase: { kind: 'preRoll' },
  };
}

/** Smallest rng seed whose first two dice sum to 7 (or not), so we can force the 7 branch. */
function rngForTotal(wantSeven: boolean): number {
  for (let r = 1; r < 100000; r++) {
    const a = rollDie(r);
    const b = rollDie(a.state);
    if (a.value + b.value === 7 === wantSeven) return r;
  }
  throw new Error('BUG: no rng found');
}

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as number;

describe('production (R5, computeProduction)', () => {
  it('pays 1 per settlement, 2 per city, sums across hexes, and skips the robber hex', () => {
    const state = craft({
      tiles: [
        { hex: 0, terrain: 'forest', token: 8 },
        { hex: 9, terrain: 'forest', token: 8 },
      ],
      robber: 18,
      place: [
        { seat: 0, settlements: [vtx(0, 0), vtx(9, 3)] },
        { seat: 1, cities: [vtx(9, 0)] },
      ],
    });
    const { gains, shortages } = computeProduction(state, 8);
    expect(shortages).toEqual([]);
    expect(gains.find((g) => g.seat === 0)?.resources.lumber).toBe(2); // two settlements
    expect(gains.find((g) => g.seat === 1)?.resources.lumber).toBe(2); // one city
  });

  it('produces nothing from a hex under the robber (R5.2)', () => {
    const state = craft({
      tiles: [{ hex: 9, terrain: 'forest', token: 8 }],
      robber: 9,
      place: [{ seat: 0, settlements: [vtx(9, 0)] }],
    });
    expect(computeProduction(state, 8).gains).toEqual([]);
  });

  it('shortage with ≥2 entitled: nobody gets that type, others unaffected (R5.3)', () => {
    const state = craft({
      tiles: [
        { hex: 9, terrain: 'fields', token: 8 }, // grain
        { hex: 0, terrain: 'forest', token: 8 }, // lumber
      ],
      robber: 18,
      place: [
        { seat: 0, settlements: [vtx(9, 0), vtx(0, 0)] },
        { seat: 1, settlements: [vtx(9, 1)] },
      ],
      bank: { grain: 1 },
    });
    const { gains, shortages } = computeProduction(state, 8);
    expect(shortages).toEqual(['grain']);
    expect(gains.find((g) => g.seat === 0)?.resources.grain).toBeUndefined();
    expect(gains.find((g) => g.seat === 1)).toBeUndefined();
    expect(gains.find((g) => g.seat === 0)?.resources.lumber).toBe(1); // lumber unaffected
  });

  it('shortage with exactly 1 entitled: they take what remains (R5.3)', () => {
    const state = craft({
      tiles: [{ hex: 9, terrain: 'fields', token: 8 }],
      robber: 18,
      place: [{ seat: 0, settlements: [vtx(9, 0)], cities: [vtx(9, 1)] }], // demand 1 + 2 = 3
      bank: { grain: 2 },
    });
    const { gains, shortages } = computeProduction(state, 8);
    expect(shortages).toEqual([]);
    expect(gains.find((g) => g.seat === 0)?.resources.grain).toBe(2);
  });
});

describe('roll handler (R4/R6)', () => {
  it('rejects a second roll (ALREADY_ROLLED)', () => {
    const state = craft({ robber: 18, rolled: true });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ALREADY_ROLLED');
  });

  it('is deterministic: same state + rng → identical dice and state', () => {
    const mk = () => craft({ robber: 18, rng: rngForTotal(false) });
    const a = reduce(mk(), 0, { type: 'rollDice' });
    const b = reduce(mk(), 0, { type: 'rollDice' });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.state.turn.roll).toEqual(b.state.turn.roll);
      expect(a.state).toEqual(b.state);
    }
  });

  it('applies production on a non-7 and moves to main', () => {
    const R = rngForTotal(false);
    const a = rollDie(R);
    const b = rollDie(a.state);
    const total = a.value + b.value;
    const state = craft({
      tiles: [{ hex: 9, terrain: 'forest', token: total }],
      robber: 18,
      place: [{ seat: 0, settlements: [vtx(9, 0)] }],
      rng: R,
    });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toEqual({ kind: 'main' });
      expect(res.state.turn.rolled).toBe(true);
      expect(res.state.turn.roll).toEqual([a.value, b.value]);
      expect(res.state.players[0]!.resources.lumber).toBe(1);
      expect(res.state.bank.lumber).toBe(18);
      expect(res.events.some((e) => e.type === 'diceRolled')).toBe(true);
      expect(res.events.some((e) => e.type === 'production')).toBe(true);
    }
  });

  it('rolls a 7 → discard sub-phase for players over the hand limit (R6.1)', () => {
    const state = craft({
      robber: 18,
      rng: rngForTotal(true),
      place: [
        { seat: 0, hand: { brick: 8 } }, // discards 4
        { seat: 1, hand: { brick: 7 } }, // safe
        { seat: 2, hand: { brick: 9 } }, // discards 4
        { seat: 3, hand: { brick: 2 } }, // safe
      ],
    });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase.kind).toBe('discard');
      if (res.state.phase.kind === 'discard') {
        expect(res.state.phase.pending).toEqual([0, 2]);
        expect(res.state.phase.amounts[0]).toBe(4);
        expect(res.state.phase.amounts[2]).toBe(4);
      }
      const req = res.events.find((e) => e.type === 'discardRequired');
      expect(req).toBeTruthy();
    }
  });

  it('rolls a 7 with no fat hands → straight to moveRobber (returnTo main)', () => {
    const state = craft({
      robber: 18,
      rng: rngForTotal(true),
      place: [{ seat: 0, hand: { brick: 2 } }],
    });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });
  });
});
