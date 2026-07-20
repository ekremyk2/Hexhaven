import { describe, it, expect } from 'vitest';
import type { GameState, ResourceType, Seat } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { reduce } from '../reduce.js';
import { tradeOfferSummary } from '../legal.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

interface Place {
  seat: Seat;
  hand?: Partial<Record<ResourceType, number>>;
}

/** A `main`-phase state (turn.player 0, already rolled) with only hands under test control. */
function tradeState(
  opts: { place?: Place[]; trade?: GameState['trade']; phase?: GameState['phase'] } = {}
): GameState {
  const g = createGame({ ...CONFIG, seed: 'domesticTrade' });
  const players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    return { ...p, resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0, ...pl.hand } };
  });
  return {
    ...g,
    players,
    turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    phase: opts.phase ?? { kind: 'main' },
    trade: opts.trade ?? null,
  };
}

function code(res: ReturnType<typeof reduce>): string | null {
  return res.ok ? null : res.error.code;
}

describe('offerTrade (R8.1/ER-4)', () => {
  it('rejects an empty give side (BAD_TRADE)', () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 3 } }] });
    expect(code(reduce(s, 0, { type: 'offerTrade', give: {}, receive: { wool: 1 } }))).toBe('BAD_TRADE');
  });

  it('rejects an empty receive side (BAD_TRADE)', () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 3 } }] });
    expect(code(reduce(s, 0, { type: 'offerTrade', give: { brick: 1 }, receive: {} }))).toBe('BAD_TRADE');
  });

  it('rejects overlapping resource types between give and receive (ER-4)', () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 3, wool: 2 } }] });
    const res = reduce(s, 0, {
      type: 'offerTrade',
      give: { brick: 1, wool: 1 },
      receive: { wool: 1, grain: 1 },
    });
    expect(code(res)).toBe('BAD_TRADE');
  });

  it("rejects when the offerer doesn't hold the give side (CANT_AFFORD)", () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 1 } }] }); // give needs 2
    const res = reduce(s, 0, { type: 'offerTrade', give: { brick: 2 }, receive: { wool: 1 } });
    expect(code(res)).toBe('CANT_AFFORD');
  });

  it('opens an offer, sets state.trade with empty responses, and emits tradeOffered', () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 2 } }] });
    const res = reduce(s, 0, { type: 'offerTrade', give: { brick: 1 }, receive: { wool: 1 } });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.trade).toEqual({ give: { brick: 1 }, receive: { wool: 1 }, responses: {} });
      expect(res.events).toEqual([
        { type: 'tradeOffered', from: 0, give: { brick: 1 }, receive: { wool: 1 } },
      ]);
    }
  });

  it('replaces a previous open offer, emitting tradeCancelled before the new tradeOffered', () => {
    const s = tradeState({
      place: [{ seat: 0, hand: { brick: 2, ore: 1 } }],
      trade: { give: { brick: 1 }, receive: { grain: 1 }, responses: { 1: 'accepted' } },
    });
    const res = reduce(s, 0, { type: 'offerTrade', give: { ore: 1 }, receive: { wool: 1 } });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.trade).toEqual({ give: { ore: 1 }, receive: { wool: 1 }, responses: {} });
      expect(res.events.map((e) => e.type)).toEqual(['tradeCancelled', 'tradeOffered']);
    }
  });

  it('rejects a non-owner offering a trade (NOT_YOUR_TURN)', () => {
    const s = tradeState({ place: [{ seat: 1, hand: { brick: 2 } }] }); // turn.player is seat 0
    const res = reduce(s, 1, { type: 'offerTrade', give: { brick: 1 }, receive: { wool: 1 } });
    expect(code(res)).toBe('NOT_YOUR_TURN');
  });

  it('is only legal in the main phase (WRONG_PHASE elsewhere)', () => {
    const s = tradeState({ place: [{ seat: 0, hand: { brick: 2 } }], phase: { kind: 'preRoll' } });
    const res = reduce(s, 0, { type: 'offerTrade', give: { brick: 1 }, receive: { wool: 1 } });
    expect(code(res)).toBe('WRONG_PHASE');
  });
});

describe('respondTrade (R8.1)', () => {
  it('rejects responding when no offer is open (NO_OPEN_OFFER)', () => {
    const s = tradeState({ place: [{ seat: 1 }] });
    expect(code(reduce(s, 1, { type: 'respondTrade', response: 'accept' }))).toBe('NO_OPEN_OFFER');
  });

  it('rejects the active player responding to their own offer', () => {
    const s = tradeState({
      place: [{ seat: 0 }],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    expect(code(reduce(s, 0, { type: 'respondTrade', response: 'accept' }))).toBe('NO_OPEN_OFFER');
  });

  it('rejects a response from a seat that does not exist in this game', () => {
    const s = tradeState({
      place: [{ seat: 0 }],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    // CONFIG seats 4 players (0-3); seat 4 is a valid `Seat` value but not an actual player here.
    const res = reduce(s, 4 as Seat, { type: 'respondTrade', response: 'accept' });
    expect(code(res)).toBe('NO_OPEN_OFFER');
  });

  it('records a response and emits tradeResponded', () => {
    const s = tradeState({
      place: [{ seat: 1, hand: { wool: 1 } }], // must hold `receive` to accept (B-21 confirm-safety)
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    const res = reduce(s, 1, { type: 'respondTrade', response: 'accept' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.trade?.responses).toEqual({ 1: 'accepted' });
      expect(res.events).toEqual([{ type: 'tradeResponded', responder: 1, response: 'accepted' }]);
    }
  });

  it('lets a seat switch their response from declined to accepted (idempotent overwrite)', () => {
    const s = tradeState({
      place: [{ seat: 1, hand: { wool: 1 } }],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: { 1: 'declined' } },
    });
    const res = reduce(s, 1, { type: 'respondTrade', response: 'accept' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.trade?.responses).toEqual({ 1: 'accepted' });
  });

  it('REJECTS an accept from a responder that does not hold the receive side (B-21 confirm-safety)', () => {
    const s = tradeState({
      place: [{ seat: 1, hand: {} }], // holds nothing at all
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    // Was previously allowed (deferred to confirmTrade); now an unfulfillable accept is rejected up
    // front so any 'accepted' is guaranteed confirmable — this is what makes bot offers safe.
    expect(code(reduce(s, 1, { type: 'respondTrade', response: 'accept' }))).toBe('CANT_AFFORD');
    // Declining is still always allowed, even holding nothing.
    expect(reduce(s, 1, { type: 'respondTrade', response: 'decline' }).ok).toBe(true);
  });

  it('is only legal in the main phase (WRONG_PHASE elsewhere)', () => {
    const s = tradeState({ place: [{ seat: 1 }], phase: { kind: 'preRoll' } });
    const res = reduce(s, 1, { type: 'respondTrade', response: 'accept' });
    expect(code(res)).toBe('WRONG_PHASE');
  });
});

describe('confirmTrade (R8.1)', () => {
  it('executes the swap in both directions with hand conservation (I1)', () => {
    const s = tradeState({
      place: [
        { seat: 0, hand: { brick: 3 } },
        { seat: 1, hand: { wool: 2 } },
      ],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: { 1: 'accepted' } },
    });
    const res = reduce(s, 0, { type: 'confirmTrade', with: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.players[0]!.resources.brick).toBe(2);
      expect(res.state.players[0]!.resources.wool).toBe(1);
      expect(res.state.players[1]!.resources.wool).toBe(1);
      expect(res.state.players[1]!.resources.brick).toBe(1);
      expect(res.state.trade).toBeNull();
      // I1: a domestic trade never touches the bank.
      expect(res.state.bank).toEqual(s.bank);
      expect(res.events).toEqual([
        { type: 'tradeCompleted', from: 0, with: 1, give: { brick: 1 }, receive: { wool: 1 } },
      ]);
    }
  });

  it('executes the swap correctly with resource roles reversed and multi-count bundles', () => {
    const s = tradeState({
      place: [
        { seat: 0, hand: { wool: 2 } },
        { seat: 1, hand: { brick: 3 } },
      ],
      trade: { give: { wool: 1 }, receive: { brick: 2 }, responses: { 1: 'accepted' } },
    });
    const res = reduce(s, 0, { type: 'confirmTrade', with: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.players[0]!.resources).toEqual({ brick: 2, lumber: 0, wool: 1, grain: 0, ore: 0 });
      expect(res.state.players[1]!.resources).toEqual({ brick: 1, lumber: 0, wool: 1, grain: 0, ore: 0 });
    }
  });

  it('keeps a fully-spent resource at 0 (not undefined) after the swap', () => {
    const s = tradeState({
      place: [
        { seat: 0, hand: { brick: 1, ore: 2 } }, // brick hits exactly 0 after giving it away
        { seat: 1, hand: { wool: 1 } },
      ],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: { 1: 'accepted' } },
    });
    const res = reduce(s, 0, { type: 'confirmTrade', with: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.players[0]!.resources).toEqual({ brick: 0, lumber: 0, wool: 1, grain: 0, ore: 2 });
      expect(res.state.players[1]!.resources).toEqual({ brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 });
    }
  });

  it('rejects confirming a seat that declined (NOT_A_CANDIDATE)', () => {
    const s = tradeState({
      place: [
        { seat: 0, hand: { brick: 1 } },
        { seat: 1, hand: { wool: 1 } },
      ],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: { 1: 'declined' } },
    });
    expect(code(reduce(s, 0, { type: 'confirmTrade', with: 1 }))).toBe('NOT_A_CANDIDATE');
  });

  it('rejects confirming a seat that never responded (NOT_A_CANDIDATE)', () => {
    const s = tradeState({
      place: [
        { seat: 0, hand: { brick: 1 } },
        { seat: 1, hand: { wool: 1 } },
      ],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    expect(code(reduce(s, 0, { type: 'confirmTrade', with: 1 }))).toBe('NOT_A_CANDIDATE');
  });

  it('rejects confirming when the owner no longer holds the give side (CANT_AFFORD)', () => {
    const s = tradeState({
      place: [
        { seat: 0, hand: {} }, // hand-crafted: owner no longer holds the offered brick
        { seat: 1, hand: { wool: 1 } },
      ],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: { 1: 'accepted' } },
    });
    expect(code(reduce(s, 0, { type: 'confirmTrade', with: 1 }))).toBe('CANT_AFFORD');
  });

  it('an accepter who spent their cards meanwhile → CANT_AFFORD, offer stays open, owner confirms another', () => {
    const s = tradeState({
      place: [
        { seat: 0, hand: { brick: 1 } },
        { seat: 1, hand: {} }, // accepted, but has since spent the wool
        { seat: 2, hand: { wool: 1 } }, // also accepted, still holds it
      ],
      trade: {
        give: { brick: 1 },
        receive: { wool: 1 },
        responses: { 1: 'accepted', 2: 'accepted' },
      },
    });

    const failed = reduce(s, 0, { type: 'confirmTrade', with: 1 });
    expect(code(failed)).toBe('CANT_AFFORD');
    // Offer intact — `s` was never mutated (reducers are pure), so it can be retried as-is.
    expect(s.trade).toEqual({
      give: { brick: 1 },
      receive: { wool: 1 },
      responses: { 1: 'accepted', 2: 'accepted' },
    });

    const succeeded = reduce(s, 0, { type: 'confirmTrade', with: 2 });
    expect(succeeded.ok).toBe(true);
    if (succeeded.ok) {
      expect(succeeded.state.players[0]!.resources.wool).toBe(1);
      expect(succeeded.state.players[2]!.resources.brick).toBe(1);
      expect(succeeded.state.trade).toBeNull();
    }
  });

  it('rejects a non-owner confirming (NOT_YOUR_TURN)', () => {
    const s = tradeState({
      place: [
        { seat: 0, hand: { brick: 1 } },
        { seat: 1, hand: { wool: 1 } },
      ],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: { 1: 'accepted' } },
    });
    expect(code(reduce(s, 1, { type: 'confirmTrade', with: 1 }))).toBe('NOT_YOUR_TURN');
  });

  it('is only legal in the main phase (WRONG_PHASE elsewhere)', () => {
    const s = tradeState({ place: [{ seat: 0 }], phase: { kind: 'preRoll' } });
    expect(code(reduce(s, 0, { type: 'confirmTrade', with: 1 }))).toBe('WRONG_PHASE');
  });
});

describe('cancelTrade (R8.1) and ER-11 implicit cancellation', () => {
  it('cancels an explicit open offer and emits tradeCancelled', () => {
    const s = tradeState({
      place: [{ seat: 0 }],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    const res = reduce(s, 0, { type: 'cancelTrade' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.trade).toBeNull();
      expect(res.events).toEqual([{ type: 'tradeCancelled' }]);
    }
  });

  it('rejects cancelling when no offer is open (NO_OPEN_OFFER)', () => {
    const s = tradeState({ place: [{ seat: 0 }] });
    expect(code(reduce(s, 0, { type: 'cancelTrade' }))).toBe('NO_OPEN_OFFER');
  });

  it('rejects a non-owner cancelling (NOT_YOUR_TURN)', () => {
    const s = tradeState({
      place: [{ seat: 1 }],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    expect(code(reduce(s, 1, { type: 'cancelTrade' }))).toBe('NOT_YOUR_TURN');
  });

  it('is only legal in the main phase (WRONG_PHASE elsewhere)', () => {
    const s = tradeState({ place: [{ seat: 0 }], phase: { kind: 'preRoll' } });
    expect(code(reduce(s, 0, { type: 'cancelTrade' }))).toBe('WRONG_PHASE');
  });

  it('ending the turn cancels an open offer and emits tradeCancelled alongside turnEnded (ER-11)', () => {
    const s = tradeState({
      place: [{ seat: 0 }],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    const res = reduce(s, 0, { type: 'endTurn' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.trade).toBeNull();
      expect(res.events).toEqual([
        { type: 'turnEnded', seat: 0, next: 1 },
        { type: 'tradeCancelled' },
      ]);
    }
  });

  it('ending the turn with no open offer does not emit a spurious tradeCancelled', () => {
    const s = tradeState({ place: [{ seat: 0 }] }); // trade: null
    const res = reduce(s, 0, { type: 'endTurn' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.events.some((e) => e.type === 'tradeCancelled')).toBe(false);
    }
  });
});

describe('tradeOfferSummary (legal.ts)', () => {
  it('is null when no offer is open', () => {
    const s = tradeState({ place: [{ seat: 0 }] });
    expect(tradeOfferSummary(s)).toBeNull();
  });

  it('lists every non-owner seat as able to respond, and only accepted+affordable seats as confirmable', () => {
    const s = tradeState({
      place: [
        { seat: 0, hand: { brick: 1 } },
        { seat: 1, hand: { wool: 1 } }, // accepted, can afford
        { seat: 2, hand: {} }, // accepted, but can no longer afford
        { seat: 3, hand: { wool: 1 } }, // declined
      ],
      trade: {
        give: { brick: 1 },
        receive: { wool: 1 },
        responses: { 1: 'accepted', 2: 'accepted', 3: 'declined' },
      },
    });
    const summary = tradeOfferSummary(s);
    expect(summary?.from).toBe(0);
    expect(summary?.give).toEqual({ brick: 1 });
    expect(summary?.receive).toEqual({ wool: 1 });
    expect(summary?.canRespond).toEqual([1, 2, 3]);
    expect(summary?.confirmable).toEqual([1]);
  });
});
