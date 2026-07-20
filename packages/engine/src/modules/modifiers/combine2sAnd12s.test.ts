// T-901 proof modifier #2 end-to-end: combine2sAnd12s makes a roll of 2 ALSO produce the 12-token
// hexes (and vice versa) — the production-hook archetype (docs/07 D-034). Follows the same
// `craft`/`rngForTotal` pattern as phases/roll.test.ts, generalized to a specific target total.

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { GameConfig, GameState, HexId, ResourceType, Seat, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { rollDie } from '../../rng.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'combine-2-12-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

interface Craft {
  tiles?: { hex: number; terrain: TerrainType; token: number | null }[];
  robber: number;
  place?: { seat: Seat; settlements?: number[]; cities?: number[] }[];
  bank?: Partial<Record<ResourceType, number>>;
  rng?: number;
  modifiers?: GameConfig['modifiers'];
}

/** A fully controlled preRoll state: blank all-desert board + only the tiles/pieces specified. */
function craft(opts: Craft): GameState {
  const g = createGame({ ...CONFIG, modifiers: opts.modifiers });
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
  return {
    ...g,
    board: { ...g.board, hexes, robber: opts.robber as HexId },
    players,
    bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19, ...opts.bank },
    rng: opts.rng ?? g.rng,
    turn: { ...g.turn, rolled: false, roll: null },
    phase: { kind: 'preRoll' },
  };
}

/** Smallest rng seed whose first two dice sum to exactly `total`. */
function rngForRollTotal(total: number): number {
  for (let r = 1; r < 200_000; r++) {
    const a = rollDie(r);
    const b = rollDie(a.state);
    if (a.value + b.value === total) return r;
  }
  throw new Error(`BUG: no rng found producing total ${total}`);
}

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as number;

describe('combine2sAnd12s (T-901 proof #2: production-hook modifier)', () => {
  it('a roll of 2 ALSO produces the 12-token hexes when enabled', () => {
    const state = craft({
      tiles: [
        { hex: 0, terrain: 'forest', token: 2 },
        { hex: 9, terrain: 'fields', token: 12 },
      ],
      robber: 18,
      place: [{ seat: 0, settlements: [vtx(0, 0)] }, { seat: 1, settlements: [vtx(9, 0)] }],
      rng: rngForRollTotal(2),
      modifiers: { combine2sAnd12s: true },
    });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Seat 0 produces from the 2-hex (lumber); seat 1 ALSO produces from the 12-hex (grain).
    expect(res.state.players.find((p) => p.seat === 0)?.resources.lumber).toBe(1);
    expect(res.state.players.find((p) => p.seat === 1)?.resources.grain).toBe(1);
    // Two production events: the base roll's own, plus the modifier's complement pass.
    expect(res.events.filter((e) => e.type === 'production')).toHaveLength(2);
  });

  it('a roll of 12 ALSO produces the 2-token hexes when enabled', () => {
    const state = craft({
      tiles: [
        { hex: 0, terrain: 'forest', token: 2 },
        { hex: 9, terrain: 'fields', token: 12 },
      ],
      robber: 18,
      place: [{ seat: 0, settlements: [vtx(0, 0)] }, { seat: 1, settlements: [vtx(9, 0)] }],
      rng: rngForRollTotal(12),
      modifiers: { combine2sAnd12s: true },
    });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players.find((p) => p.seat === 1)?.resources.grain).toBe(1);
    expect(res.state.players.find((p) => p.seat === 0)?.resources.lumber).toBe(1);
    expect(res.events.filter((e) => e.type === 'production')).toHaveLength(2);
  });

  it('WITHOUT the modifier, a roll of 2 does NOT touch the 12-token hex (RK-13 baseline)', () => {
    const state = craft({
      tiles: [
        { hex: 0, terrain: 'forest', token: 2 },
        { hex: 9, terrain: 'fields', token: 12 },
      ],
      robber: 18,
      place: [{ seat: 0, settlements: [vtx(0, 0)] }, { seat: 1, settlements: [vtx(9, 0)] }],
      rng: rngForRollTotal(2),
    });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players.find((p) => p.seat === 0)?.resources.lumber).toBe(1);
    expect(res.state.players.find((p) => p.seat === 1)?.resources.grain).toBe(0);
    expect(res.events.filter((e) => e.type === 'production')).toHaveLength(1);
  });

  it('does not touch production on any other roll total', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'forest', token: 8 }],
      robber: 18,
      place: [{ seat: 0, settlements: [vtx(0, 0)] }],
      rng: rngForRollTotal(8),
      modifiers: { combine2sAnd12s: true },
    });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.filter((e) => e.type === 'production')).toHaveLength(1);
  });

  it('respects the bank: the complement pass never double-spends stock the base pass already took', () => {
    const state = craft({
      tiles: [
        { hex: 0, terrain: 'forest', token: 2 },
        { hex: 9, terrain: 'forest', token: 12 },
      ],
      robber: 18,
      place: [{ seat: 0, settlements: [vtx(0, 0)] }, { seat: 1, settlements: [vtx(9, 0)] }],
      bank: { lumber: 1 },
      rng: rngForRollTotal(2),
      modifiers: { combine2sAnd12s: true },
    });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Only 1 lumber existed in the bank; seat 0's base-2 production takes it, leaving seat 1's
    // complement-12 production a genuine shortage (R5.3) rather than a negative bank balance.
    expect(res.state.bank.lumber).toBe(0);
    expect(res.state.players.find((p) => p.seat === 0)?.resources.lumber).toBe(1);
    expect(res.state.players.find((p) => p.seat === 1)?.resources.lumber ?? 0).toBe(0);
  });
});
