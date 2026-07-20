// The Banker's owner-scoped production (T-903, docs/tasks/phase-9/PICKS.md "Banker = hex produces
// its resource for the placer"): NOT adjacency-based (unlike the Wizard) — only whoever most
// recently moved the piece there benefits, and only once it's actually been moved at least once.

import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState, HexId, ResourceType, Seat, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame } from '../../../createGame.js';
import { reduce } from '../../../reduce.js';
import { rollDie } from '../../../rng.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'banker-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

interface Craft {
  tiles?: { hex: number; terrain: TerrainType; token: number | null }[];
  bankerHex: number;
  owner?: Seat;
  place?: { seat: Seat; settlements?: number[]; cities?: number[] }[];
  bank?: Partial<Record<ResourceType, number>>;
  rng?: number;
}

/** A fully controlled preRoll state, the Banker pre-placed at `bankerHex` with an optional `owner`
 *  (bypassing lazy init/move, same as `wizard.test.ts`'s `craft`). */
function craft(opts: Craft): GameState {
  const g = createGame({ ...CONFIG, modifiers: { hexPieces: { pieces: ['banker'] } } });
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
    ext: {
      ...g.ext,
      hexPieces: { pieces: [{ kind: 'banker', hex: opts.bankerHex as HexId, owner: opts.owner }] },
    },
    rng: opts.rng ?? g.rng,
    turn: { ...g.turn, rolled: false, roll: null },
    phase: { kind: 'preRoll' },
  };
}

/** Smallest rng seed whose first two dice sum to exactly `total` (mirrors `wizard.test.ts`). */
function rngForRollTotal(total: number): number {
  for (let r = 1; r < 200_000; r++) {
    const a = rollDie(r);
    const b = rollDie(a.state);
    if (a.value + b.value === total) return r;
  }
  throw new Error(`BUG: no rng found producing total ${total}`);
}

describe('Banker owner-scoped production', () => {
  it('grants the OWNER +1 of the hex resource when its number rolls, with no building required', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      bankerHex: 0,
      owner: 2 as Seat,
      rng: rngForRollTotal(8),
    });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players.find((p) => p.seat === 2)?.resources.brick).toBe(1);
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(true);
  });

  it('grants NOTHING before the piece has ever been moved (owner undefined)', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      bankerHex: 0,
      rng: rngForRollTotal(8),
    });
    expect(state.ext?.hexPieces?.pieces[0]?.owner).toBeUndefined();
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });

  it('does nothing when the token does not match the roll', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      bankerHex: 0,
      owner: 0 as Seat,
      rng: rngForRollTotal(6),
    });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });

  it('does nothing on the desert', () => {
    const state = craft({ bankerHex: 0, owner: 0 as Seat, rng: rngForRollTotal(6) });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });

  it('grants nothing when the bank has none of that resource left', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      bankerHex: 0,
      owner: 0 as Seat,
      bank: { brick: 0, lumber: 19, wool: 19, grain: 19, ore: 19 },
      rng: rngForRollTotal(8),
    });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
    expect(res.state.bank.brick).toBe(0);
  });

  it('never fires on a rolled 7', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 6 }],
      bankerHex: 0,
      owner: 0 as Seat,
      rng: rngForRollTotal(7),
    });
    const res = reduce(state, state.turn.player, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });

  it('the owner is stamped once the piece is actually moved via moveHexPiece', () => {
    const state: GameState = {
      ...craft({ tiles: [{ hex: 0, terrain: 'hills', token: 8 }], bankerHex: 0 }),
      turn: { number: 1, player: 1 as Seat, rolled: true, roll: [3, 4], devPlayed: false },
      phase: { kind: 'moveRobber', returnTo: 'main' },
    };
    const res = reduce(state, 1, { type: 'moveHexPiece', piece: 'banker', hex: 1 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext?.hexPieces?.pieces).toEqual([{ kind: 'banker', hex: 1, owner: 1 }]);
  });
});
