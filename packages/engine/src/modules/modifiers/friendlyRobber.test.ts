// friendlyRobber modifier tests (T-903a wave A-1, docs/07 D-034): the ≤2 VP steal-candidate filter,
// the round-1 gentle-seven skip, a genuinely robbable >2 VP victim, and composition with Cities &
// Knights' robber-lock (C10.1).

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { GameConfig, GameState, HexId, ResourceType, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { rollDie } from '../../rng.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'friendly-robber-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

interface Place {
  seat: Seat;
  settlements?: number[];
  cities?: number[];
  hand?: Partial<Record<ResourceType, number>>;
}

interface Craft {
  place?: Place[];
  robber?: number;
  turnNumber?: number;
  modifiers?: GameConfig['modifiers'];
  citiesKnights?: boolean;
}

/** A controlled `moveRobber`-phase state: real base geometry (GEOMETRY), only the settlements/
 *  cities/hands/robber position we specify. */
function craft(opts: Craft = {}): GameState {
  const g = createGame({
    ...CONFIG,
    modifiers: opts.modifiers,
    expansions: { ...CONFIG.expansions, citiesKnights: opts.citiesKnights ?? false },
  });
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
    players,
    board: { ...g.board, robber: (opts.robber ?? 18) as HexId },
    turn: { ...g.turn, number: opts.turnNumber ?? 5, rolled: true, roll: [3, 4] },
    phase: { kind: 'moveRobber', returnTo: 'main' },
  };
}

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as number;

/** Smallest rng seed whose first two dice sum to `total` — same trick as roll.test.ts. */
function rngForRollTotal(total: number): number {
  for (let r = 1; r < 200_000; r++) {
    const a = rollDie(r);
    const b = rollDie(a.state);
    if (a.value + b.value === total) return r;
  }
  throw new Error(`BUG: no rng found producing total ${total}`);
}

describe('friendlyRobber (a): ≤2 VP steal-candidate filter', () => {
  it('filters a ≤2 VP seat out — auto no-steal when only such a player is adjacent', () => {
    const state = craft({
      place: [{ seat: 1, settlements: [vtx(0, 0), vtx(0, 2)], hand: { brick: 3 } }], // 2 VP, holds cards
      modifiers: { friendlyRobber: true },
    });
    const res = reduce(state, 0, { type: 'moveRobber', hex: 0 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toEqual({ kind: 'main' });
    expect(res.events.some((e) => e.type === 'stolen')).toBe(false);
    expect(res.state.players.find((p) => p.seat === 1)?.resources.brick).toBe(3); // untouched
  });

  it('a >2 VP victim IS robbable even with a ≤2 VP seat on the same hex', () => {
    const state = craft({
      place: [
        { seat: 1, settlements: [vtx(0, 0), vtx(0, 2)], hand: { brick: 3 } }, // 2 VP, protected
        { seat: 2, settlements: [vtx(0, 4)], cities: [vtx(0, 5)], hand: { lumber: 2 } }, // 3 VP
      ],
      modifiers: { friendlyRobber: true },
    });
    const res = reduce(state, 0, { type: 'moveRobber', hex: 0 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const stolen = res.events.find((e) => e.type === 'stolen');
    expect(stolen).toBeTruthy();
    if (stolen?.type === 'stolen') expect(stolen.from).toBe(2);
    // Seat 1 (≤2 VP) is never touched, even though they were adjacent too.
    expect(res.state.players.find((p) => p.seat === 1)?.resources.brick).toBe(3);
  });

  it('WITHOUT the modifier, a ≤2 VP seat is a legal steal target (RK-13 baseline)', () => {
    const state = craft({
      place: [{ seat: 1, settlements: [vtx(0, 0), vtx(0, 2)], hand: { brick: 3 } }],
    });
    const res = reduce(state, 0, { type: 'moveRobber', hex: 0 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'stolen')).toBe(true);
  });
});

describe('friendlyRobber (b): round-1 seven skips the robber entirely', () => {
  it('a 7 rolled on turn 1 moves nobody and steals nothing', () => {
    const g = createGame({ ...CONFIG, modifiers: { friendlyRobber: true } });
    const state: GameState = {
      ...g,
      rng: rngForRollTotal(7),
      turn: { ...g.turn, number: 1, rolled: false, roll: null },
      phase: { kind: 'preRoll' },
    };
    const initialRobberHex = state.board.robber;
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toEqual({ kind: 'main' });
    expect(res.state.board.robber).toBe(initialRobberHex);
    expect(res.events.some((e) => e.type === 'robberMoved')).toBe(false);
    expect(res.events.some((e) => e.type === 'stolen')).toBe(false);
  });

  it('the same 7, one round later (turn.number > playerCount), moves the robber normally', () => {
    const g = createGame({ ...CONFIG, modifiers: { friendlyRobber: true } });
    const state: GameState = {
      ...g,
      rng: rngForRollTotal(7),
      turn: { ...g.turn, number: CONFIG.playerCount + 1, rolled: false, roll: null },
      phase: { kind: 'preRoll' },
    };
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase.kind).toBe('moveRobber');
  });

  it('WITHOUT the modifier, a round-1 7 moves the robber normally (RK-13 baseline)', () => {
    const g = createGame({ ...CONFIG });
    const state: GameState = {
      ...g,
      rng: rngForRollTotal(7),
      turn: { ...g.turn, number: 1, rolled: false, roll: null },
      phase: { kind: 'preRoll' },
    };
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase.kind).toBe('moveRobber');
  });
});

describe('friendlyRobber composes with Cities & Knights (C10.1 robber-lock)', () => {
  it('moveRobber stays ROBBER_LOCKED while locked — C&K intercepts before friendlyRobber ever runs', () => {
    const g = createGame({
      ...CONFIG,
      expansions: { ...CONFIG.expansions, citiesKnights: true },
      modifiers: { friendlyRobber: true },
    });
    expect(g.ext!.citiesKnights!.robberLocked).toBe(true);
    const state: GameState = { ...g, phase: { kind: 'moveRobber', returnTo: 'main' } };
    const otherHex = state.board.robber === 0 ? 1 : 0;
    const res = reduce(state, state.turn.player, { type: 'moveRobber', hex: otherHex as HexId });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('ROBBER_LOCKED');
  });
});
