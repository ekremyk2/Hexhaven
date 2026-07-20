import { describe, it, expect } from 'vitest';
import { bundleTotal, GEOMETRY } from '@hexhaven/shared';
import type { GameEvent, GameState, HexId, Phase, ResourceType, Seat, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { reduce } from '../reduce.js';
import { rollDie } from '../rng.js';
import { legalRobberHexes, pendingDiscards, stealCandidates } from '../legal.js';

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
  phase: Phase;
  turnPlayer?: Seat;
  rolled?: boolean;
  roll?: [number, number] | null;
}

/**
 * A fully controlled state: blank all-desert board + only the tiles/pieces/phase we specify.
 * Same approach as phases/roll.test.ts's `craft` (createGame then override board/players/phase/rng).
 */
function craft(opts: Craft): GameState {
  const g = createGame({ ...CONFIG, seed: 'craft-robber' });
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
  const roll: [number, number] | null = opts.roll === undefined ? [4, 3] : opts.roll;
  return {
    ...g,
    board: { ...g.board, hexes, robber: opts.robber as HexId },
    players,
    bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19, ...opts.bank },
    rng: opts.rng ?? g.rng,
    turn: { ...g.turn, player: opts.turnPlayer ?? 0, rolled: opts.rolled ?? true, roll },
    phase: opts.phase,
  };
}

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as number;

/** Smallest rng seed whose first two dice sum to 7 (or not) — same trick as roll.test.ts. */
function rngForTotal(wantSeven: boolean): number {
  for (let r = 1; r < 100000; r++) {
    const a = rollDie(r);
    const b = rollDie(a.state);
    if (a.value + b.value === 7 === wantSeven) return r;
  }
  throw new Error('BUG: no rng found');
}

/** I1: bank + every hand, summed — must stay constant across a discard or a steal. */
function totalCardsInPlay(state: GameState): number {
  const inHands = state.players.reduce((sum, p) => sum + bundleTotal(p.resources), 0);
  return inHands + bundleTotal(state.bank);
}

function findEvent<T extends GameEvent['type']>(
  events: readonly GameEvent[],
  type: T
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

describe('discard phase (R6.1, ER-2)', () => {
  function discardState(overrides: Partial<Craft> = {}): GameState {
    return craft({
      robber: 18,
      phase: { kind: 'discard', pending: [0, 2], amounts: { 0: 4, 1: 0, 2: 4, 3: 0, 4: 0, 5: 0 } },
      place: [
        { seat: 0, hand: { brick: 8 } }, // 8 cards, owes floor(8/2) = 4
        { seat: 2, hand: { lumber: 5, wool: 4 } }, // 9 cards, owes floor(9/2) = 4
      ],
      ...overrides,
    });
  }

  it('accepts an exact-amount discard, moves cards to the bank, and removes the seat from pending', () => {
    const state = discardState();
    const res = reduce(state, 0, { type: 'discard', cards: { brick: 4 } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.brick).toBe(4);
    expect(res.state.bank.brick).toBe(23); // 19 + 4
    expect(res.state.phase).toEqual({
      kind: 'discard',
      pending: [2],
      amounts: { 0: 4, 1: 0, 2: 4, 3: 0, 4: 0, 5: 0 },
    });
    const ev = findEvent(res.events, 'discarded');
    expect(ev).toBeTruthy();
    expect(ev?.seat).toBe(0);
    expect(ev?.cards).toEqual({ brick: 4 });
  });

  it('rejects an overflowing discard (BAD_DISCARD_COUNT)', () => {
    const res = reduce(discardState(), 0, { type: 'discard', cards: { brick: 5 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('BAD_DISCARD_COUNT');
  });

  it('rejects an underflowing discard (BAD_DISCARD_COUNT)', () => {
    const res = reduce(discardState(), 0, { type: 'discard', cards: { brick: 3 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('BAD_DISCARD_COUNT');
  });

  it('rejects discarding cards the seat does not hold (CARD_NOT_HELD)', () => {
    // Right total (4) but seat 0 holds zero ore.
    const res = reduce(discardState(), 0, { type: 'discard', cards: { ore: 4 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CARD_NOT_HELD');
  });

  it('rejects a discard from a seat that is not currently pending (NOT_YOUR_TURN)', () => {
    const res = reduce(discardState(), 1, { type: 'discard', cards: { brick: 1 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_YOUR_TURN');
  });

  it('resolves a multi-seat pending list in any order', () => {
    const state = discardState();
    const seat2First = reduce(state, 2, { type: 'discard', cards: { lumber: 4 } });
    expect(seat2First.ok).toBe(true);
    if (!seat2First.ok) return;
    expect(seat2First.state.phase).toEqual({
      kind: 'discard',
      pending: [0],
      amounts: { 0: 4, 1: 0, 2: 4, 3: 0, 4: 0, 5: 0 },
    });
    const then0 = reduce(seat2First.state, 0, { type: 'discard', cards: { brick: 4 } });
    expect(then0.ok).toBe(true);
    if (then0.ok) expect(then0.state.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });
  });

  it('the last discard flips the phase to moveRobber with returnTo main', () => {
    const state = discardState({
      phase: { kind: 'discard', pending: [0], amounts: { 0: 4, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
      place: [{ seat: 0, hand: { brick: 8 } }],
    });
    const res = reduce(state, 0, { type: 'discard', cards: { brick: 4 } });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });
  });
});

describe('moveRobber phase (R6.2, ER-8)', () => {
  it('rejects moving to the hex the robber already occupies (ROBBER_SAME_HEX)', () => {
    const state = craft({ robber: 5, phase: { kind: 'moveRobber', returnTo: 'main' } });
    const res = reduce(state, 0, { type: 'moveRobber', hex: 5 as HexId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ROBBER_SAME_HEX');
  });

  it('allows moving the robber onto the desert', () => {
    const state = craft({
      tiles: [{ hex: 3, terrain: 'desert', token: null }],
      robber: 5,
      phase: { kind: 'moveRobber', returnTo: 'main' },
    });
    const res = reduce(state, 0, { type: 'moveRobber', hex: 3 as HexId });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.board.robber).toBe(3);
      expect(findEvent(res.events, 'robberMoved')?.hex).toBe(3);
    }
  });

  it('rejects an off-board hex (BAD_LOCATION)', () => {
    const state = craft({ robber: 5, phase: { kind: 'moveRobber', returnTo: 'main' } });
    const res = reduce(state, 0, { type: 'moveRobber', hex: 999 as HexId });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('BAD_LOCATION');
  });
});

describe('steal resolution after a move (R6.3, ER-3)', () => {
  it('0 candidates (nobody adjacent): skips straight to returnTo, no stolen event', () => {
    const state = craft({
      robber: 18,
      phase: { kind: 'moveRobber', returnTo: 'main' },
      place: [{ seat: 1, hand: { brick: 3 } }], // no building anywhere
    });
    const res = reduce(state, 0, { type: 'moveRobber', hex: 5 as HexId });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toEqual({ kind: 'main' });
      expect(findEvent(res.events, 'stolen')).toBeUndefined();
    }
  });

  it('a victim with 0 cards on the hex is never a candidate (0-candidate case)', () => {
    const state = craft({
      robber: 18,
      phase: { kind: 'moveRobber', returnTo: 'main' },
      place: [{ seat: 1, settlements: [vtx(5, 0)], hand: {} }], // building present, empty hand
    });
    const res = reduce(state, 0, { type: 'moveRobber', hex: 5 as HexId });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toEqual({ kind: 'main' });
      expect(findEvent(res.events, 'stolen')).toBeUndefined();
    }
  });

  it('1 candidate: auto-steals without a separate steal action', () => {
    const state = craft({
      robber: 18,
      phase: { kind: 'moveRobber', returnTo: 'main' },
      place: [{ seat: 1, settlements: [vtx(5, 0)], hand: { brick: 2 } }],
    });
    const before = totalCardsInPlay(state);
    const res = reduce(state, 0, { type: 'moveRobber', hex: 5 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toEqual({ kind: 'main' });
    const ev = findEvent(res.events, 'stolen');
    expect(ev).toBeTruthy();
    // Seat 1 only holds brick, so the draw is deterministic regardless of rng.
    expect(ev?.from).toBe(1);
    expect(ev?.to).toBe(0);
    expect(ev?.card).toBe('brick');
    expect(res.state.players[0]!.resources.brick).toBe(1);
    expect(res.state.players[1]!.resources.brick).toBe(1);
    expect(totalCardsInPlay(res.state)).toBe(before);
  });

  it('≥2 candidates: offers a choice instead of auto-resolving', () => {
    const state = craft({
      robber: 18,
      phase: { kind: 'moveRobber', returnTo: 'main' },
      place: [
        { seat: 1, settlements: [vtx(5, 0)], hand: { brick: 2 } },
        { seat: 2, cities: [vtx(5, 3)], hand: { ore: 1 } },
      ],
    });
    const res = reduce(state, 0, { type: 'moveRobber', hex: 5 as HexId });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toEqual({ kind: 'steal', candidates: [1, 2], returnTo: 'main' });
      expect(findEvent(res.events, 'stolen')).toBeUndefined();
    }
  });

  it('resolves the offered steal choice and conserves total cards (I1)', () => {
    const state = craft({
      robber: 18,
      phase: { kind: 'steal', candidates: [1, 2], returnTo: 'main' },
      place: [
        { seat: 1, hand: { brick: 2 } },
        { seat: 2, hand: { ore: 1 } },
      ],
    });
    const before = totalCardsInPlay(state);
    const res = reduce(state, 0, { type: 'steal', from: 2 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toEqual({ kind: 'main' });
    expect(res.state.players[0]!.resources.ore).toBe(1);
    expect(res.state.players[2]!.resources.ore).toBe(0);
    expect(totalCardsInPlay(res.state)).toBe(before);
    const ev = findEvent(res.events, 'stolen');
    expect(ev?.from).toBe(2);
    expect(ev?.to).toBe(0);
    expect(ev?.card).toBe('ore');
  });

  it('rejects a steal target outside the offered candidates (NOT_A_CANDIDATE)', () => {
    const state = craft({
      robber: 18,
      phase: { kind: 'steal', candidates: [1, 2], returnTo: 'main' },
      place: [{ seat: 3, hand: { brick: 1 } }],
    });
    const res = reduce(state, 0, { type: 'steal', from: 3 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_A_CANDIDATE');
  });

  it('is deterministic under a fixed rng: same state + action → identical resulting state', () => {
    const mk = () =>
      craft({
        robber: 18,
        phase: { kind: 'steal', candidates: [1], returnTo: 'main' },
        place: [{ seat: 1, hand: { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 1 } }],
        rng: 777,
      });
    const a = reduce(mk(), 0, { type: 'steal', from: 1 });
    const b = reduce(mk(), 0, { type: 'steal', from: 1 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.state).toEqual(b.state);
  });
});

describe('full robber pipeline', () => {
  it('from a rolled 7 (returnTo main): preRoll → discard → moveRobber → main, roll untouched', () => {
    const rng7 = rngForTotal(true);
    const state = craft({
      robber: 18,
      phase: { kind: 'preRoll' },
      rolled: false,
      roll: null,
      rng: rng7,
      place: [{ seat: 0, hand: { brick: 8 } }], // fat hand → must discard
    });

    const afterRoll = reduce(state, 0, { type: 'rollDice' });
    expect(afterRoll.ok).toBe(true);
    if (!afterRoll.ok) return;
    expect(afterRoll.state.phase.kind).toBe('discard');

    const afterDiscard = reduce(afterRoll.state, 0, { type: 'discard', cards: { brick: 4 } });
    expect(afterDiscard.ok).toBe(true);
    if (!afterDiscard.ok) return;
    expect(afterDiscard.state.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });

    const afterMove = reduce(afterDiscard.state, 0, { type: 'moveRobber', hex: 5 as HexId });
    expect(afterMove.ok).toBe(true);
    if (!afterMove.ok) return;
    expect(afterMove.state.phase).toEqual({ kind: 'main' });
    // The robber pipeline must never touch the roll that got it here.
    expect(afterMove.state.turn.rolled).toBe(true);
    expect(afterMove.state.turn.roll).toEqual(afterRoll.state.turn.roll);
    expect(afterMove.state.turn.number).toBe(afterRoll.state.turn.number);
  });

  it('from a stubbed knight-before-roll state (returnTo preRoll): rolled/roll/number stay untouched', () => {
    const state = craft({
      robber: 18,
      phase: { kind: 'moveRobber', returnTo: 'preRoll' },
      rolled: false,
      roll: null,
      place: [{ seat: 1, settlements: [vtx(5, 0)], hand: { wool: 1 } }], // 1 candidate → auto-steal
    });
    const res = reduce(state, 0, { type: 'moveRobber', hex: 5 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toEqual({ kind: 'preRoll' });
    expect(res.state.turn.rolled).toBe(false);
    expect(res.state.turn.roll).toBeNull();
    expect(res.state.turn.number).toBe(state.turn.number);
    const ev = findEvent(res.events, 'stolen');
    expect(ev).toBeTruthy();
    expect(ev?.card).toBe('wool');
  });
});

describe('legal.ts additions', () => {
  it('pendingDiscards returns the seats still owing, empty outside the discard phase', () => {
    const discarding = craft({
      robber: 18,
      phase: { kind: 'discard', pending: [1, 3], amounts: { 0: 0, 1: 4, 2: 0, 3: 5, 4: 0, 5: 0 } },
    });
    expect(pendingDiscards(discarding)).toEqual([1, 3]);
    expect(pendingDiscards(craft({ robber: 18, phase: { kind: 'main' } }))).toEqual([]);
  });

  it('legalRobberHexes lists every hex except the current one, only during moveRobber', () => {
    const moving = craft({ robber: 5, phase: { kind: 'moveRobber', returnTo: 'main' } });
    const hexes = legalRobberHexes(moving);
    expect(hexes).toHaveLength(GEOMETRY.hexes.length - 1);
    expect(hexes).not.toContain(5);
    expect(legalRobberHexes(craft({ robber: 5, phase: { kind: 'main' } }))).toEqual([]);
  });

  it('stealCandidates previews an arbitrary hex and defaults to the current robber hex', () => {
    const state = craft({
      robber: 18,
      phase: { kind: 'moveRobber', returnTo: 'main' },
      place: [{ seat: 1, settlements: [vtx(5, 0)], hand: { brick: 1 } }],
    });
    expect(stealCandidates(state, 5 as HexId)).toEqual([1]);
    expect(stealCandidates(state)).toEqual([]); // defaults to hex 18 (current robber) — empty there
  });
});
