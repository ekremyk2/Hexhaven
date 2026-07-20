// The Wizard's production hook, end-to-end (T-902, docs/tasks/modifiers-RESEARCH.md Bucket A):
// +1 flat per adjacent settlement/city ON TOP of base production, the R5.3-style bank-shortage
// rule, "nothing to do" cases (wrong token, desert, no adjacent buildings), and that it never fires
// on a rolled 7. Follows `combine2sAnd12s.test.ts`'s `craft`/`rngForRollTotal` pattern.

import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState, HexId, ResourceType, Seat, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame } from '../../../createGame.js';
import { reduce } from '../../../reduce.js';
import { rollDie } from '../../../rng.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'wizard-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

interface Craft {
  tiles?: { hex: number; terrain: TerrainType; token: number | null }[];
  wizardHex: number;
  place?: { seat: Seat; settlements?: number[]; cities?: number[] }[];
  bank?: Partial<Record<ResourceType, number>>;
  rng?: number;
}

/** A fully controlled preRoll state: blank all-desert board + the tiles/pieces specified, the
 *  Wizard pre-placed at `wizardHex` (bypassing lazy init the same way other modifier tests set
 *  `board.robber` directly). */
function craft(opts: Craft): GameState {
  const g = createGame({ ...CONFIG, modifiers: { hexPieces: { pieces: ['wizard'] } } });
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
    board: { ...g.board, hexes, robber: 18 as HexId },
    players,
    bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19, ...opts.bank },
    ext: { ...g.ext, hexPieces: { pieces: [{ kind: 'wizard', hex: opts.wizardHex as HexId }] } },
    rng: opts.rng ?? g.rng,
    turn: { ...g.turn, rolled: false, roll: null },
    phase: { kind: 'preRoll' },
  };
}

/** Smallest rng seed whose first two dice sum to exactly `total` (mirrors sibling modifier tests). */
function rngForRollTotal(total: number): number {
  for (let r = 1; r < 200_000; r++) {
    const a = rollDie(r);
    const b = rollDie(a.state);
    if (a.value + b.value === total) return r;
  }
  throw new Error(`BUG: no rng found producing total ${total}`);
}

describe('Wizard production top-up', () => {
  it('grants +1 flat to a settlement AND a city adjacent to the Wizard hex, on top of base production', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      wizardHex: 0,
      // vertex 0 of hex 0 for a settlement (owner 0), vertex 3 for a city (owner 1).
      place: [
        { seat: 0, settlements: [0] },
        { seat: 1, cities: [3] },
      ],
      rng: rngForRollTotal(8),
    });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Base production: settlement=1, city=2. Wizard top-up: +1 flat each (not scaled by city count).
    expect(res.state.players.find((p) => p.seat === 0)?.resources.brick).toBe(1 + 1);
    expect(res.state.players.find((p) => p.seat === 1)?.resources.brick).toBe(2 + 1);
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(true);
  });

  it('does nothing when the Wizard hex token does not match the roll', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      wizardHex: 0,
      place: [{ seat: 0, settlements: [0] }],
      rng: rngForRollTotal(6),
    });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });

  it('does nothing when the Wizard sits on the desert (no resource)', () => {
    const state = craft({ wizardHex: 0, rng: rngForRollTotal(6) });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });

  it('does nothing when no settlement/city sits adjacent to the Wizard hex', () => {
    const state = craft({ tiles: [{ hex: 0, terrain: 'hills', token: 8 }], wizardHex: 0, rng: rngForRollTotal(8) });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });

  it('never fires on a rolled 7 (no production at all, R6.1)', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 6 }],
      wizardHex: 0,
      place: [{ seat: 0, settlements: [0] }],
      rng: rngForRollTotal(7),
    });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });

  it('R5.3-style shortage: >=2 entitled owners and an insufficient bank grant nobody the Wizard bonus', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      wizardHex: 0,
      place: [
        { seat: 0, settlements: [0] },
        { seat: 1, settlements: [3] },
      ],
      bank: { brick: 1, lumber: 19, wool: 19, grain: 19, ore: 19 }, // only 1 left after base production takes 2
      rng: rngForRollTotal(8),
    });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // R5.3: base production ALSO grants nobody here (2 entitled, only 1 in the bank) — the shortage
    // is real, not something the Wizard would otherwise "steal" from base production.
    expect(res.state.players.find((p) => p.seat === 0)?.resources.brick).toBe(0);
    expect(res.state.players.find((p) => p.seat === 1)?.resources.brick).toBe(0);
    expect(res.state.bank.brick).toBe(1); // untouched — nobody drew anything at all
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });

  it('a single entitled owner facing an already-drained bank gets nothing from the Wizard (no partial grant — every owner\'s Wizard demand is exactly 1, never a fractional grant)', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      wizardHex: 0,
      place: [{ seat: 0, settlements: [0] }],
      bank: { brick: 1, lumber: 19, wool: 19, grain: 19, ore: 19 }, // base production takes the 1 brick
      rng: rngForRollTotal(8),
    });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Base production already drained the bank to 0 brick — the Wizard has nothing left to grant.
    expect(res.state.bank.brick).toBe(0);
    expect(res.state.players.find((p) => p.seat === 0)?.resources.brick).toBe(1); // base's 1, no Wizard top-up
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });
});
