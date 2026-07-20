import { describe, it, expect } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { EdgeId, GameState, HarborType, ResourceType, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { reduce } from '../reduce.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

interface Place {
  seat: Seat;
  settlements?: number[];
  hand?: Partial<Record<ResourceType, number>>;
}

function tradeState(
  opts: {
    place?: Place[];
    harbors?: Record<EdgeId, HarborType>;
    bank?: Partial<Record<ResourceType, number>>;
    trade?: GameState['trade'];
    phase?: GameState['phase'];
  } = {}
): GameState {
  const g = createGame({ ...CONFIG, seed: 'bankTrade' });
  const players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    return {
      ...p,
      settlements: (pl.settlements ?? []).map((n) => n as VertexId),
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0, ...pl.hand },
    };
  });
  return {
    ...g,
    board: { ...g.board, harbors: opts.harbors ?? {} },
    players,
    bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19, ...opts.bank },
    turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    phase: opts.phase ?? { kind: 'main' },
    trade: opts.trade ?? null,
  };
}

function code(res: ReturnType<typeof reduce>): string | null {
  return res.ok ? null : res.error.code;
}

const HARBOR_EDGE = GEOMETRY.edges[0]!;

describe('bankTrade action (R8.2)', () => {
  it('base 4:1 exchange pays the bank and receives 1, no harbor needed', () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 4 } }] });
    const res = reduce(s, 0, { type: 'bankTrade', give: 'brick', receive: 'ore' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.players[0]!.resources.brick).toBe(0);
      expect(res.state.players[0]!.resources.ore).toBe(1);
      expect(res.state.bank.brick).toBe(23); // 19 + 4: the 4 paid cards return to the bank
      expect(res.state.bank.ore).toBe(18); // 19 - 1
      const ev = res.events.find((e) => e.type === 'bankTraded');
      expect(ev).toMatchObject({
        type: 'bankTraded',
        seat: 0,
        gave: { brick: 4 },
        got: { ore: 1 },
        rate: 4,
      });
    }
  });

  it('a 2:1 harbor lowers the rate for its own resource (wired through rules/harbors.ts)', () => {
    const s = tradeState({
      harbors: { [HARBOR_EDGE.id]: 'brick' },
      place: [{ seat: 0, settlements: [HARBOR_EDGE.a], hand: { brick: 2 } }],
    });
    const res = reduce(s, 0, { type: 'bankTrade', give: 'brick', receive: 'wool' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.players[0]!.resources.brick).toBe(0);
      expect(res.state.players[0]!.resources.wool).toBe(1);
      expect(res.state.bank.brick).toBe(21); // 19 + 2
      expect(res.state.bank.wool).toBe(18); // 19 - 1
      const ev = res.events.find((e) => e.type === 'bankTraded');
      expect(ev).toMatchObject({ rate: 2 });
    }
  });

  it('rejects give === receive (BAD_TRADE)', () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 4 } }] });
    expect(code(reduce(s, 0, { type: 'bankTrade', give: 'brick', receive: 'brick' }))).toBe('BAD_TRADE');
  });

  it('rejects when the seat holds fewer than the rate (CANT_AFFORD)', () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 3 } }] }); // rate 4, only 3 held
    expect(code(reduce(s, 0, { type: 'bankTrade', give: 'brick', receive: 'ore' }))).toBe('CANT_AFFORD');
  });

  it('rejects when the bank has none of the requested resource (BANK_EMPTY)', () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 4 } }], bank: { ore: 0 } });
    expect(code(reduce(s, 0, { type: 'bankTrade', give: 'brick', receive: 'ore' }))).toBe('BANK_EMPTY');
  });

  it('rejects a seat other than the turn owner (NOT_YOUR_TURN)', () => {
    const s = tradeState({ place: [{ seat: 1, hand: { brick: 4 } }] }); // turn.player is seat 0
    expect(code(reduce(s, 1, { type: 'bankTrade', give: 'brick', receive: 'ore' }))).toBe('NOT_YOUR_TURN');
  });

  it('is only legal in the main phase (WRONG_PHASE elsewhere)', () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 4 } }], phase: { kind: 'preRoll' } });
    expect(code(reduce(s, 0, { type: 'bankTrade', give: 'brick', receive: 'ore' }))).toBe('WRONG_PHASE');
  });

  it('cancels an open domestic trade offer (ER-11)', () => {
    const s = tradeState({
      place: [{ seat: 0, hand: { brick: 4 } }],
      trade: { give: { wool: 1 }, receive: { grain: 1 }, responses: {} },
    });
    const res = reduce(s, 0, { type: 'bankTrade', give: 'brick', receive: 'ore' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.trade).toBeNull();
      expect(res.events.some((e) => e.type === 'tradeCancelled')).toBe(true);
    }
  });

  it('allows multiple bank trades in the same turn (no per-turn cap)', () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 8 } }] });
    const first = reduce(s, 0, { type: 'bankTrade', give: 'brick', receive: 'ore' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.players[0]!.resources.brick).toBe(4);

    const second = reduce(first.state, 0, { type: 'bankTrade', give: 'brick', receive: 'wool' });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.state.players[0]!.resources.brick).toBe(0);
      expect(second.state.players[0]!.resources.ore).toBe(1);
      expect(second.state.players[0]!.resources.wool).toBe(1);
    }
  });
});
