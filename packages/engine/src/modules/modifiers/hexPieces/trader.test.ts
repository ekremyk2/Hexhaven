// The Trader's two effects, end-to-end (T-903): the 3:1 bank-port grant (via `bankTrade`,
// `tradeRateFor`) and the draw-on-move (`onMove`). Follows `wizard.test.ts`'s `craft`/
// `rngForRollTotal`-free pattern (no dice roll involved here at all).

import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState, HexId, ResourceType, Seat, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame } from '../../../createGame.js';
import { reduce } from '../../../reduce.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'trader-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

interface Craft {
  tiles?: { hex: number; terrain: TerrainType; token: number | null }[];
  traderHex: number;
  place?: { seat: Seat; settlements?: number[]; cities?: number[] }[];
  bank?: Partial<Record<ResourceType, number>>;
  harbors?: Record<number, 'generic' | ResourceType>;
  resources?: Partial<Record<Seat, Partial<Record<ResourceType, number>>>>;
  phase?: 'main' | 'moveRobber';
}

/** A controlled state (main or moveRobber phase) with the Trader pre-placed at `traderHex`. */
function craft(opts: Craft): GameState {
  const g = createGame({ ...CONFIG, modifiers: { hexPieces: { pieces: ['trader'] } } });
  const hexes = g.board.hexes.map(() => ({ terrain: 'desert' as TerrainType, token: null as number | null }));
  for (const t of opts.tiles ?? []) hexes[t.hex] = { terrain: t.terrain, token: t.token };
  let players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    return {
      ...p,
      settlements: (pl.settlements ?? []).map((n) => n as VertexId),
      cities: (pl.cities ?? []).map((n) => n as VertexId),
    };
  });
  players = players.map((p) => {
    const res = opts.resources?.[p.seat];
    return res ? { ...p, resources: { ...p.resources, ...res } } : p;
  });
  const harbors: Record<number, 'generic' | ResourceType> = opts.harbors ?? {};
  return {
    ...g,
    board: { ...g.board, hexes, robber: 18 as HexId, harbors: harbors as GameState['board']['harbors'] },
    players,
    bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19, ...opts.bank },
    ext: { ...g.ext, hexPieces: { pieces: [{ kind: 'trader', hex: opts.traderHex as HexId }] } },
    turn: { ...g.turn, rolled: true, roll: [3, 4] },
    phase: opts.phase === 'moveRobber' ? { kind: 'moveRobber', returnTo: 'main' } : { kind: 'main' },
  };
}

describe('Trader 3:1 bank port (tradeRateFor via bankTrade)', () => {
  it('grants 3:1 to a seat adjacent to the Trader hex with no harbor of their own (base would be 4:1)', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      traderHex: 0,
      place: [{ seat: 0, settlements: [0] }],
      resources: { 0: { brick: 3 } },
    });
    const res = reduce(state, 0, { type: 'bankTrade', give: 'brick', receive: 'ore' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players.find((p) => p.seat === 0)?.resources.brick).toBe(0);
    expect(res.state.players.find((p) => p.seat === 0)?.resources.ore).toBe(1);
    expect(res.events.some((e) => e.type === 'bankTraded' && 'rate' in e && e.rate === 3)).toBe(true);
  });

  it('rejects with CANT_AFFORD when the seat holds fewer than 3 (the Trader rate, not the base 4)', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      traderHex: 0,
      place: [{ seat: 0, settlements: [0] }],
      resources: { 0: { brick: 2 } },
    });
    const res = reduce(state, 0, { type: 'bankTrade', give: 'brick', receive: 'ore' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('CANT_AFFORD');
  });

  it("does NOT override a seat's own BETTER 2:1 harbor rate for that resource", () => {
    // Edge 0 (GEOMETRY) connects vertices 0/3, both of which sit on hex 0 — so a settlement on
    // vertex 0 is simultaneously adjacent to the Trader's hex 0 AND sits on this harbor edge.
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      traderHex: 0,
      place: [{ seat: 0, settlements: [0] }],
      resources: { 0: { brick: 2 } },
      harbors: { 0: 'brick' },
    });
    const res = reduce(state, 0, { type: 'bankTrade', give: 'brick', receive: 'ore' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Traded at the seat's OWN 2:1 harbor rate (only 2 held), not the Trader's 3:1 — proves the
    // Trader is a FLOOR, never a forced downgrade.
    expect(res.state.players.find((p) => p.seat === 0)?.resources.brick).toBe(0);
    expect(res.events.some((e) => e.type === 'bankTraded' && 'rate' in e && e.rate === 2)).toBe(true);
  });

  it('gives no rate (base 4:1 applies) to a seat NOT adjacent to the Trader hex', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      traderHex: 0,
      place: [],
      resources: { 0: { brick: 3 } },
    });
    const res = reduce(state, 0, { type: 'bankTrade', give: 'brick', receive: 'ore' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('CANT_AFFORD'); // needs 4 at the base rate, only holds 3
  });

  it('gives no rate for a DIFFERENT resource than the Trader hex produces', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'hills', token: 8 }],
      traderHex: 0,
      place: [{ seat: 0, settlements: [0] }],
      resources: { 0: { lumber: 3 } },
    });
    const res = reduce(state, 0, { type: 'bankTrade', give: 'lumber', receive: 'ore' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('CANT_AFFORD'); // lumber isn't the Trader's brick, base 4:1 applies
  });
});

describe('Trader draw-on-move (onMove)', () => {
  it('the mover draws 1 of the destination hex\'s resource', () => {
    const state = craft({
      tiles: [{ hex: 1, terrain: 'hills', token: 8 }],
      traderHex: 0,
      phase: 'moveRobber',
    });
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'trader', hex: 1 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const mover = res.state.players.find((p) => p.seat === state.turn.player)!;
    expect(mover.resources.brick).toBe(1);
    expect(res.state.bank.brick).toBe(18);
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(true);
  });

  it('draws nothing when moved onto the desert', () => {
    const state = craft({ traderHex: 5, phase: 'moveRobber' });
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'trader', hex: 1 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
  });

  it('draws nothing when the bank has none of that resource left', () => {
    const state = craft({
      tiles: [{ hex: 1, terrain: 'hills', token: 8 }],
      traderHex: 0,
      bank: { brick: 0, lumber: 19, wool: 19, grain: 19, ore: 19 },
      phase: 'moveRobber',
    });
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'trader', hex: 1 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'hexPieceProduction')).toBe(false);
    expect(res.state.bank.brick).toBe(0);
  });
});
