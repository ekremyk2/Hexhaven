// Robin Hood's on-move redistribution (T-903): steal 1 card from the wealthiest seat, give it to the
// poorest, with the deterministic tie-break rules documented in robinHood.ts's header (lowest seat
// number for ties on either side; first-held resource in a fixed brick/lumber/wool/grain/ore order).

import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState, HexId, ResourceType, Seat } from '@hexhaven/shared';
import { createGame } from '../../../createGame.js';
import { reduce } from '../../../reduce.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'robinhood-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

/** A controlled `moveRobber`-phase state, hexPieces enabled with just Robin Hood, with each seat's
 *  resources set from `resources` (defaulting every unset seat to an empty hand). */
function craft(resources: Partial<Record<Seat, Partial<Record<ResourceType, number>>>>): GameState {
  const g = createGame({ ...CONFIG, modifiers: { hexPieces: { pieces: ['robinHood'] } } });
  const players = g.players.map((p) => {
    const res = resources[p.seat];
    return res ? { ...p, resources: { ...p.resources, ...res } } : p;
  });
  return {
    ...g,
    players,
    ext: { ...g.ext, hexPieces: { pieces: [{ kind: 'robinHood', hex: g.board.robber }] } },
    turn: { ...g.turn, rolled: true, roll: [3, 4] },
    phase: { kind: 'moveRobber', returnTo: 'main' },
  };
}

function move(state: GameState, hex: number = (state.board.robber === 0 ? 1 : 0)) {
  return reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'robinHood', hex: hex as HexId });
}

describe('Robin Hood redistribution (onMove)', () => {
  it('steals 1 card from the wealthiest seat and gives it to the poorest', () => {
    const state = craft({ 0: { brick: 5 }, 1: { brick: 0 } });
    const res = move(state);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players.find((p) => p.seat === 0)?.resources.brick).toBe(4);
    expect(res.state.players.find((p) => p.seat === 1)?.resources.brick).toBe(1);
    const ev = res.events.find((e) => e.type === 'stolen');
    expect(ev).toMatchObject({ type: 'stolen', from: 0, to: 1 });
  });

  it('ties for wealthiest resolve to the LOWEST tied seat number', () => {
    // Seats 1 and 2 are tied for wealthiest (3 cards each); seat 0 is poorest (0 cards).
    const state = craft({ 0: { brick: 0 }, 1: { brick: 3 }, 2: { lumber: 3 }, 3: { brick: 1 } });
    const res = move(state);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ev = res.events.find((e) => e.type === 'stolen');
    expect(ev).toMatchObject({ type: 'stolen', from: 1, to: 0 });
  });

  it('picks the wealthiest seat\'s first held resource in a fixed brick/lumber/wool/grain/ore order', () => {
    const state = craft({ 0: { ore: 2, grain: 1 }, 1: { brick: 0 } });
    const res = move(state);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Seat 0 holds grain(1)+ore(2)=3 total; fixed order picks grain (before ore) even though ore is
    // the larger stack.
    const ev = res.events.find((e) => e.type === 'stolen');
    expect(ev).toMatchObject({ from: 0, to: 1, card: 'grain' } as never);
  });

  it('no-op when every seat holds the same total (no strictly poorer seat to give to)', () => {
    const state = craft({ 0: { brick: 2 }, 1: { lumber: 2 }, 2: { wool: 2 }, 3: { grain: 2 } });
    const res = move(state);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'stolen')).toBe(false);
    // Nobody's hand changed.
    for (const seat of [0, 1, 2, 3] as const) {
      expect(res.state.players[seat]).toEqual(state.players[seat]);
    }
  });

  it('no-op when nobody holds a single card', () => {
    const state = craft({});
    const res = move(state);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'stolen')).toBe(false);
  });

  it('the hexPieceMoved event still fires even when the redistribution is a no-op', () => {
    const state = craft({});
    const res = move(state);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceMoved')).toBe(true);
  });
});
