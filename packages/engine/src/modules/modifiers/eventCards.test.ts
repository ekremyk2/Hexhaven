// Event Cards modifier tests (T-904b, docs/tasks/modifiers-cards-RESEARCH.md D3a): deck
// composition, deterministic seeded draw + reshuffle-on-exhaust, a drawn 7 routing to
// discard/robber exactly like a rolled 7, production off the drawn number, and composition with
// fiveSix/Seafarers. The citiesKnights incompatibility itself is the registry/matrix's job — see
// registry.test.ts's "compatibility matrix" describe block — this file only re-confirms it holds
// for the now-real module (not just the reserved id).

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { GameConfig, GameState, HexId, ResourceType, Seat, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame, validateConfig } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { resolveModules } from '../index.js';
import { drawEventCard, ensureEventCardsExt, EVENT_DECK_COMPOSITION, eventCardsExt } from './eventCards.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'event-cards-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

interface Craft {
  tiles?: { hex: number; terrain: TerrainType; token: number | null }[];
  robber: number;
  place?: { seat: Seat; settlements?: number[]; cities?: number[] }[];
  bank?: Partial<Record<ResourceType, number>>;
  ext?: GameState['ext'];
  seed?: string;
}

/** A fully controlled preRoll state (mirrors combine2sAnd12s.test.ts's `craft`), with `eventCards`
 *  always enabled and `ext.eventCards` overridable so a test can force a specific next draw without
 *  reverse-searching an rng seed. */
function craft(opts: Craft): GameState {
  const g = createGame({ ...CONFIG, seed: opts.seed ?? CONFIG.seed, modifiers: { eventCards: true } });
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
    ext: opts.ext ?? g.ext,
    turn: { ...g.turn, rolled: false, roll: null },
    phase: { kind: 'preRoll' },
  };
}

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as number;

describe('EVENT_DECK_COMPOSITION (docs/tasks/modifiers-cards-RESEARCH.md D3a)', () => {
  it('has 36 cards matching the 2d6 distribution', () => {
    expect(EVENT_DECK_COMPOSITION).toHaveLength(36);
    const counts = new Map<number, number>();
    for (const n of EVENT_DECK_COMPOSITION) counts.set(n, (counts.get(n) ?? 0) + 1);
    expect(counts.get(2)).toBe(1);
    expect(counts.get(3)).toBe(2);
    expect(counts.get(4)).toBe(3);
    expect(counts.get(5)).toBe(4);
    expect(counts.get(6)).toBe(5);
    expect(counts.get(7)).toBe(6);
    expect(counts.get(8)).toBe(5);
    expect(counts.get(9)).toBe(4);
    expect(counts.get(10)).toBe(3);
    expect(counts.get(11)).toBe(2);
    expect(counts.get(12)).toBe(1);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(36);
  });
});

describe('seeded draw is deterministic', () => {
  it('the same seed shuffles the same initial deck and draws the same sequence', () => {
    const g1 = createGame({ ...CONFIG, modifiers: { eventCards: true } });
    const g2 = createGame({ ...CONFIG, modifiers: { eventCards: true } });
    const e1 = ensureEventCardsExt(g1);
    const e2 = ensureEventCardsExt(g2);
    expect(eventCardsExt(e1)?.deck).toEqual(eventCardsExt(e2)?.deck);

    let s1 = e1;
    let s2 = e2;
    const drawn1: number[] = [];
    const drawn2: number[] = [];
    for (let i = 0; i < 10; i++) {
      const d1 = drawEventCard(s1);
      s1 = d1.state;
      drawn1.push(d1.card);
      const d2 = drawEventCard(s2);
      s2 = d2.state;
      drawn2.push(d2.card);
    }
    expect(drawn1).toEqual(drawn2);
  });

  it('a different seed shuffles a different order (genuinely shuffled, not fixed)', () => {
    const gA = ensureEventCardsExt(createGame({ ...CONFIG, seed: 'seed-a', modifiers: { eventCards: true } }));
    const gB = ensureEventCardsExt(createGame({ ...CONFIG, seed: 'seed-b', modifiers: { eventCards: true } }));
    expect(eventCardsExt(gA)?.deck).not.toEqual(eventCardsExt(gB)?.deck);
  });
});

describe('reshuffle when the deck is exhausted', () => {
  it('draws the discard pile reshuffled once the deck empties, with every card still accounted for', () => {
    const base = createGame({ ...CONFIG, modifiers: { eventCards: true } });
    const last = EVENT_DECK_COMPOSITION[0]!;
    const rest = EVENT_DECK_COMPOSITION.slice(1); // the OTHER 35 cards, already sitting in `discard`
    const seeded: GameState = { ...base, ext: { ...base.ext, eventCards: { deck: [last], discard: rest } } };
    const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

    // `deck` has exactly one card left: drawing it does NOT trigger a reshuffle yet — it just moves
    // to `discard` (which already held the other 35), so all 36 now sit in `discard`.
    const draw1 = drawEventCard(seeded);
    expect(draw1.card).toBe(last);
    const afterDraw1 = eventCardsExt(draw1.state)!;
    expect(afterDraw1.deck).toEqual([]);
    expect(afterDraw1.discard).toHaveLength(36);
    expect(sorted(afterDraw1.discard)).toEqual(sorted(EVENT_DECK_COMPOSITION as number[]));

    // NOW `deck` is empty: this draw reshuffles all 36 `discard` cards into a fresh `deck` FIRST,
    // then draws its top card — `deck` ends at 35, `discard` restarts at just this one card, and
    // every card is still accounted for across the two piles (no card lost/duplicated).
    const draw2 = drawEventCard(draw1.state);
    const afterDraw2 = eventCardsExt(draw2.state)!;
    expect(afterDraw2.deck).toHaveLength(35);
    expect(afterDraw2.discard).toEqual([draw2.card]);
    const allCards = [...afterDraw2.deck, ...afterDraw2.discard];
    expect(sorted(allCards)).toEqual(sorted(EVENT_DECK_COMPOSITION as number[]));
  });
});

describe('a drawn 7 routes to discard/robber exactly like a rolled 7', () => {
  it('routes straight to moveRobber when nobody is over the hand limit', () => {
    const state = craft({ robber: 18, ext: { eventCards: { deck: [7], discard: [] } } });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });
    expect(res.state.turn.roll).not.toBeNull();
    expect((res.state.turn.roll![0]) + (res.state.turn.roll![1])).toBe(7);
    expect(res.events.some((e) => e.type === 'eventCardDrawn' && e.total === 7)).toBe(true);
    expect(res.events.some((e) => e.type === 'diceRolled')).toBe(true);
  });

  it('routes to discard when a seat is over the hand limit, with the usual discardRequired event', () => {
    const state = craft({ robber: 18, ext: { eventCards: { deck: [7], discard: [] } } });
    const withHand: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.seat === 0 ? { ...p, resources: { brick: 8, lumber: 0, wool: 0, grain: 0, ore: 0 } } : p
      ),
    };
    const res = reduce(withHand, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase.kind).toBe('discard');
    expect(res.events.some((e) => e.type === 'discardRequired')).toBe(true);
    expect(res.events.some((e) => e.type === 'eventCardDrawn' && e.total === 7)).toBe(true);
  });
});

describe('production works off the drawn number', () => {
  it('a non-7 draw produces resources exactly like that dice total would', () => {
    const state = craft({
      tiles: [{ hex: 0, terrain: 'forest', token: 9 }],
      robber: 18,
      place: [{ seat: 0, settlements: [vtx(0, 0)] }],
      ext: { eventCards: { deck: [9], discard: [] } },
    });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players.find((p) => p.seat === 0)?.resources.lumber).toBe(1);
    // The synthetic [a, b] pair sums to the drawn total (a = ceil(total/2)).
    expect(res.state.turn.roll).toEqual([5, 4]);
    expect(res.events.some((e) => e.type === 'production')).toBe(true);
    expect(res.events.some((e) => e.type === 'eventCardDrawn' && e.total === 9)).toBe(true);
  });
});

describe('composes with fiveSix and Seafarers', () => {
  it('resolves and rolls cleanly together with fiveSix', () => {
    const g = createGame({
      ...CONFIG,
      seed: 'ec-fivesix',
      playerCount: 6,
      expansions: { fiveSix: true, seafarers: false, citiesKnights: false },
      modifiers: { eventCards: true },
    });
    const preRoll: GameState = { ...g, phase: { kind: 'preRoll' } };
    const res = reduce(preRoll, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'eventCardDrawn')).toBe(true);
    expect(res.state.turn.rolled).toBe(true);
  });

  it('resolves and rolls cleanly together with a Seafarers scenario', () => {
    const g = createGame({
      ...CONFIG,
      seed: 'ec-seafarers',
      expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
      modifiers: { eventCards: true },
    });
    const preRoll: GameState = { ...g, phase: { kind: 'preRoll' } };
    const res = reduce(preRoll, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.some((e) => e.type === 'eventCardDrawn')).toBe(true);
    // roll[0]+roll[1] still equals the production total everywhere it's read — including inside
    // the Seafarers module's own afterAction hook, which opens `chooseGoldResource` off exactly
    // that sum (modules/seafarers/index.ts).
    expect(['main', 'discard', 'moveRobber', 'chooseGoldResource']).toContain(res.state.phase.kind);
  });
});

describe('compatibility matrix: still rejects Cities & Knights (docs/07 D-034)', () => {
  it('resolveModules/validateConfig reject eventCards + citiesKnights with MODIFIER_INCOMPATIBLE', () => {
    const c: GameConfig = {
      ...CONFIG,
      expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
      modifiers: { eventCards: true },
    };
    const resolved = resolveModules(c);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.error.code).toBe('MODIFIER_INCOMPATIBLE');
    expect(validateConfig(c)?.code).toBe('MODIFIER_INCOMPATIBLE');
  });
});
