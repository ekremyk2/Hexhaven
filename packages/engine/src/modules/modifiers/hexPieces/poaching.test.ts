// Poaching's draw-on-move (T-903, docs/tasks/phase-9/PICKS.md "Poaching = draw from bank"): the
// mover draws 1 of the destination hex's resource, bank permitting. Shape mirrors `trader.test.ts`'s
// onMove block (minus the ongoing 3:1 port effect Poaching doesn't have).

import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState, HexId, ResourceType, TerrainType } from '@hexhaven/shared';
import { createGame } from '../../../createGame.js';
import { reduce } from '../../../reduce.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'poaching-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

interface Craft {
  tiles?: { hex: number; terrain: TerrainType; token: number | null }[];
  poachingHex: number;
  bank?: Partial<Record<ResourceType, number>>;
}

function craft(opts: Craft): GameState {
  const g = createGame({ ...CONFIG, modifiers: { hexPieces: { pieces: ['poaching'] } } });
  const hexes = g.board.hexes.map(() => ({ terrain: 'desert' as TerrainType, token: null as number | null }));
  for (const t of opts.tiles ?? []) hexes[t.hex] = { terrain: t.terrain, token: t.token };
  return {
    ...g,
    board: { ...g.board, hexes, robber: 18 as HexId },
    bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19, ...opts.bank },
    ext: { ...g.ext, hexPieces: { pieces: [{ kind: 'poaching', hex: opts.poachingHex as HexId }] } },
    turn: { ...g.turn, rolled: true, roll: [3, 4] },
    phase: { kind: 'moveRobber', returnTo: 'main' },
  };
}

describe('Poaching draw-on-move (onMove)', () => {
  it('the mover draws 1 of the destination hex\'s resource', () => {
    const state = craft({ tiles: [{ hex: 1, terrain: 'mountains', token: 8 }], poachingHex: 0 });
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'poaching', hex: 1 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const mover = res.state.players.find((p) => p.seat === state.turn.player)!;
    expect(mover.resources.ore).toBe(1);
    expect(res.state.bank.ore).toBe(18);
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(true);
  });

  it('draws nothing when moved onto the desert', () => {
    const state = craft({ poachingHex: 5 });
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'poaching', hex: 1 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });

  it('draws nothing when the bank has none of that resource left', () => {
    const state = craft({
      tiles: [{ hex: 1, terrain: 'mountains', token: 8 }],
      poachingHex: 0,
      bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 0 },
    });
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'poaching', hex: 1 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
    expect(res.state.bank.ore).toBe(0);
  });

  it('the hexPieceMoved event still fires alongside the draw', () => {
    const state = craft({ tiles: [{ hex: 1, terrain: 'mountains', token: 8 }], poachingHex: 0 });
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'poaching', hex: 1 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceMoved')).toBe(true);
  });
});
