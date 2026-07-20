import { describe, it, expect } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type {
  Action,
  AnyDevCardId,
  DevCardType,
  EdgeId,
  GameEvent,
  GameState,
  HexId,
  ResourceType,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { reduce } from '../reduce.js';
import { rollDie } from '../rng.js';
import { playableDevCards } from '../legal.js';

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
  cities?: number[];
  roads?: number[];
  hand?: Partial<Record<ResourceType, number>>;
  devCards?: { type: DevCardType; boughtOnTurn: number }[];
  playedKnights?: number;
  piecesLeft?: { roads: number; settlements: number; cities: number };
}

interface Craft {
  place?: Place[];
  bank?: Partial<Record<ResourceType, number>>;
  devDeck?: DevCardType[];
  phase?: GameState['phase'];
  turnNumber?: number;
  turnPlayer?: Seat;
  rolled?: boolean;
  roll?: [number, number] | null;
  devPlayed?: boolean;
  robber?: number;
  trade?: GameState['trade'];
  targetVp?: number;
  rng?: number;
}

/**
 * A fully controlled state built on a real generated board — GEOMETRY (vertex/edge ids and
 * adjacency) is a fixed module-level constant independent of the seed, so tests pick real ids the
 * same way phases/main.test.ts does, while every other field (hands, dev cards, deck order,
 * phase, turn) is pinned explicitly. Same shape as the sibling `craft`/`mainState` helpers in
 * phases/main.test.ts, phases/roll.test.ts and phases/robber.test.ts.
 */
function craft(opts: Craft = {}): GameState {
  const g = createGame({ ...CONFIG, seed: 'devcards' });
  const players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    const settlements = (pl.settlements ?? []).map((n) => n as VertexId);
    const cities = (pl.cities ?? []).map((n) => n as VertexId);
    const roads = (pl.roads ?? []).map((n) => n as EdgeId);
    return {
      ...p,
      settlements,
      cities,
      roads,
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0, ...pl.hand },
      devCards: pl.devCards ?? [],
      playedKnights: pl.playedKnights ?? 0,
      piecesLeft: pl.piecesLeft ?? {
        roads: 15 - roads.length,
        settlements: 5 - settlements.length,
        cities: 4 - cities.length,
      },
    };
  });
  return {
    ...g,
    config: { ...g.config, targetVp: opts.targetVp ?? g.config.targetVp },
    players,
    bank: { ...g.bank, ...opts.bank },
    devDeck: opts.devDeck ?? g.devDeck,
    board: { ...g.board, robber: (opts.robber ?? g.board.robber) as HexId },
    rng: opts.rng ?? g.rng,
    turn: {
      number: opts.turnNumber ?? 5,
      player: opts.turnPlayer ?? 0,
      rolled: opts.rolled ?? true,
      roll: opts.roll === undefined ? [3, 4] : opts.roll,
      devPlayed: opts.devPlayed ?? false,
    },
    phase: opts.phase ?? { kind: 'main' },
    trade: opts.trade ?? null,
  };
}

function code(res: ReturnType<typeof reduce>): string | null {
  return res.ok ? null : res.error.code;
}

function findEvent<T extends GameEvent['type']>(
  events: readonly GameEvent[],
  type: T
): Extract<GameEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Smallest rng seed whose first two dice sum to 7 (or not) — same trick as roll.test.ts. */
function rngForTotal(wantSeven: boolean): number {
  for (let r = 1; r < 100000; r++) {
    const a = rollDie(r);
    const b = rollDie(a.state);
    if (a.value + b.value === 7 === wantSeven) return r;
  }
  throw new Error('BUG: no rng found');
}

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as number;

// A degree-3 (interior) vertex with nothing pre-occupied nearby — plenty of legal edges at every
// step. Used by Road Building's "happy path" tests.
const RB_HAPPY_V = GEOMETRY.vertices.find((v) => v.edges.length === 3)!.id;

// A second, unrelated degree-3 vertex (A) used to build a deliberate dead end for Road Building:
// block every one of A's edges except `deadEndE1`, and every one of B's (the far endpoint of
// `deadEndE1`) edges except `deadEndE1` itself — so placing that ONE legal road immediately
// exhausts every legal edge, regardless of how many pieces/`remaining` are left afterward.
const DEADEND_A = GEOMETRY.vertices.find(
  (v) => v.edges.length === 3 && v.id !== RB_HAPPY_V && !v.neighbors.includes(RB_HAPPY_V as VertexId)
)!.id;
const deadEndAEdges = GEOMETRY.vertices[DEADEND_A]!.edges;
const deadEndE1 = deadEndAEdges[0]!;
const deadEndBlockedAtA = deadEndAEdges.slice(1);
const deadEndE1Edge = GEOMETRY.edges[deadEndE1]!;
const DEADEND_B = (deadEndE1Edge.a === DEADEND_A ? deadEndE1Edge.b : deadEndE1Edge.a) as VertexId;
const deadEndBlockedAtB = GEOMETRY.vertices[DEADEND_B]!.edges.filter((e) => e !== deadEndE1);

describe('buyDevCard (R9.1/R9.2)', () => {
  it('pays the cost, draws devDeck[0], records boughtOnTurn, and cancels an open trade (ER-11)', () => {
    const s = craft({
      turnNumber: 9,
      devDeck: ['monopoly', 'knight'],
      place: [{ seat: 0, hand: { ore: 1, wool: 1, grain: 1 } }],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    const res = reduce(s, 0, { type: 'buyDevCard' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources).toEqual({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
    expect(res.state.bank.ore).toBe(s.bank.ore + 1);
    expect(res.state.bank.wool).toBe(s.bank.wool + 1);
    expect(res.state.bank.grain).toBe(s.bank.grain + 1);
    expect(res.state.players[0]!.devCards).toEqual([{ type: 'monopoly', boughtOnTurn: 9 }]);
    expect(res.state.devDeck).toEqual(['knight']);
    expect(res.state.trade).toBeNull();
    expect(res.events.map((e) => e.type)).toEqual(['devBought', 'tradeCancelled']);
    expect(findEvent(res.events, 'devBought')).toMatchObject({ seat: 0, card: 'monopoly' });
  });

  it('rejects when unaffordable (CANT_AFFORD)', () => {
    const s = craft({ devDeck: ['knight'], place: [{ seat: 0, hand: {} }] });
    expect(code(reduce(s, 0, { type: 'buyDevCard' }))).toBe('CANT_AFFORD');
  });

  it('rejects when the deck is empty (DECK_EMPTY)', () => {
    const s = craft({ devDeck: [], place: [{ seat: 0, hand: { ore: 1, wool: 1, grain: 1 } }] });
    expect(code(reduce(s, 0, { type: 'buyDevCard' }))).toBe('DECK_EMPTY');
  });

  it('buying all 25 cards depletes the deck; the 26th purchase is DECK_EMPTY; composition matches R1.2', () => {
    let s = craft({ place: [{ seat: 0, hand: { ore: 25, wool: 25, grain: 25 } }] });
    const drawn: AnyDevCardId[] = [];
    for (let i = 0; i < 25; i++) {
      const res = reduce(s, 0, { type: 'buyDevCard' });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const ev = findEvent(res.events, 'devBought');
      if (ev) drawn.push(ev.card);
      s = res.state;
    }
    expect(s.devDeck).toEqual([]);
    expect(drawn).toHaveLength(25);
    const counts = drawn.reduce<Record<string, number>>((acc, c) => {
      acc[c] = (acc[c] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ knight: 14, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2, victoryPoint: 5 });

    expect(code(reduce(s, 0, { type: 'buyDevCard' }))).toBe('DECK_EMPTY');
  });

  it('is illegal outside the main phase (WRONG_PHASE)', () => {
    const s = craft({
      phase: { kind: 'preRoll' },
      rolled: false,
      roll: null,
      place: [{ seat: 0, hand: { ore: 1, wool: 1, grain: 1 } }],
    });
    expect(code(reduce(s, 0, { type: 'buyDevCard' }))).toBe('WRONG_PHASE');
  });
});

describe('common play guards (R9.3/R9.4)', () => {
  it('CARD_NOT_HELD when the seat holds no card of that type', () => {
    const s = craft({ place: [{ seat: 0 }] });
    expect(code(reduce(s, 0, { type: 'playKnight' }))).toBe('CARD_NOT_HELD');
  });

  it('DEV_ALREADY_PLAYED when a dev card was already played this turn (R9.3)', () => {
    const s = craft({
      devPlayed: true,
      place: [{ seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 1 }] }],
    });
    expect(code(reduce(s, 0, { type: 'playKnight' }))).toBe('DEV_ALREADY_PLAYED');
  });

  it('DEV_BOUGHT_THIS_TURN when the only held copy was bought this turn (R9.4)', () => {
    const s = craft({
      turnNumber: 7,
      place: [{ seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 7 }] }],
    });
    expect(code(reduce(s, 0, { type: 'playKnight' }))).toBe('DEV_BOUGHT_THIS_TURN');
  });

  it('an older copy stays playable even while a same-type copy bought this turn also sits in hand', () => {
    const s = craft({
      turnNumber: 7,
      place: [
        {
          seat: 0,
          devCards: [
            { type: 'knight', boughtOnTurn: 3 },
            { type: 'knight', boughtOnTurn: 7 },
          ],
        },
      ],
    });
    const res = reduce(s, 0, { type: 'playKnight' });
    expect(res.ok).toBe(true);
    // Exactly the this-turn copy remains — the older one was the one consumed.
    if (res.ok) expect(res.state.players[0]!.devCards).toEqual([{ type: 'knight', boughtOnTurn: 7 }]);
  });
});

describe('playKnight (R9.5)', () => {
  it('preRoll flow: moves phase to moveRobber(returnTo:preRoll), then back to preRoll; roll still required (ER-7)', () => {
    const s = craft({
      phase: { kind: 'preRoll' },
      rolled: false,
      roll: null,
      robber: 0,
      place: [
        { seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 1 }] },
        { seat: 1, settlements: [vtx(5, 0)], hand: { brick: 2 } },
      ],
    });
    const afterKnight = reduce(s, 0, { type: 'playKnight' });
    expect(afterKnight.ok).toBe(true);
    if (!afterKnight.ok) return;
    expect(afterKnight.state.phase).toEqual({ kind: 'moveRobber', returnTo: 'preRoll' });
    expect(afterKnight.state.turn.devPlayed).toBe(true);
    expect(afterKnight.state.players[0]!.playedKnights).toBe(1);
    expect(afterKnight.state.players[0]!.devCards).toEqual([]);
    expect(findEvent(afterKnight.events, 'devPlayed')).toMatchObject({ seat: 0, card: 'knight' });

    const afterMove = reduce(afterKnight.state, 0, { type: 'moveRobber', hex: 5 as HexId });
    expect(afterMove.ok).toBe(true);
    if (!afterMove.ok) return;
    expect(afterMove.state.phase).toEqual({ kind: 'preRoll' });
    expect(afterMove.state.turn.rolled).toBe(false);
    expect(afterMove.state.turn.roll).toBeNull();
    expect(findEvent(afterMove.events, 'stolen')).toBeTruthy();
    expect(findEvent(afterMove.events, 'discardRequired')).toBeUndefined();

    // The roll is still owed (ER-7): ending the turn now must fail, rolling must still work.
    expect(code(reduce(afterMove.state, 0, { type: 'endTurn' }))).toBe('MUST_ROLL_FIRST');
    expect(reduce(afterMove.state, 0, { type: 'rollDice' }).ok).toBe(true);
  });

  it('main flow: moves phase to moveRobber(returnTo:main), then back to main', () => {
    const s = craft({
      phase: { kind: 'main' },
      rolled: true,
      robber: 0,
      place: [
        { seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 1 }], playedKnights: 2 },
        { seat: 1, settlements: [vtx(5, 0)], hand: { brick: 2 } },
      ],
    });
    const afterKnight = reduce(s, 0, { type: 'playKnight' });
    expect(afterKnight.ok).toBe(true);
    if (!afterKnight.ok) return;
    expect(afterKnight.state.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });
    expect(afterKnight.state.players[0]!.playedKnights).toBe(3); // increments from a nonzero count too

    const afterMove = reduce(afterKnight.state, 0, { type: 'moveRobber', hex: 5 as HexId });
    expect(afterMove.ok).toBe(true);
    if (afterMove.ok) expect(afterMove.state.phase).toEqual({ kind: 'main' });
  });

  it('never triggers discards even with an over-limit hand — only a rolled 7 discards', () => {
    const s = craft({
      phase: { kind: 'main' },
      rolled: true,
      robber: 0,
      place: [
        { seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 1 }], hand: { brick: 9 } }, // 9 > 7
        { seat: 1, settlements: [vtx(5, 0)], hand: { brick: 2 } },
      ],
    });
    const afterKnight = reduce(s, 0, { type: 'playKnight' });
    expect(afterKnight.ok).toBe(true);
    if (!afterKnight.ok) return;
    expect(afterKnight.state.phase.kind).toBe('moveRobber'); // never 'discard'

    const afterMove = reduce(afterKnight.state, 0, { type: 'moveRobber', hex: 5 as HexId });
    expect(afterMove.ok).toBe(true);
    if (afterMove.ok) {
      expect(afterMove.state.phase.kind).toBe('main');
      expect(findEvent(afterMove.events, 'discardRequired')).toBeUndefined();
    }
  });

  it('rejects a second dev-card play the same turn, across preRoll → main (knight, then road building)', () => {
    const s = craft({
      phase: { kind: 'preRoll' },
      rolled: false,
      roll: null,
      rng: rngForTotal(false), // guarantees the later rollDice below is not a 7
      robber: 0,
      place: [
        {
          seat: 0,
          devCards: [
            { type: 'knight', boughtOnTurn: 1 },
            { type: 'roadBuilding', boughtOnTurn: 1 },
          ],
        },
        // No other seats placed anywhere → 0 steal candidates → the robber move consumes no rng.
      ],
    });
    const afterKnight = reduce(s, 0, { type: 'playKnight' });
    expect(afterKnight.ok).toBe(true);
    if (!afterKnight.ok) return;

    const afterMove = reduce(afterKnight.state, 0, { type: 'moveRobber', hex: 5 as HexId });
    expect(afterMove.ok).toBe(true);
    if (!afterMove.ok) return;
    expect(afterMove.state.phase).toEqual({ kind: 'preRoll' });

    const afterRoll = reduce(afterMove.state, 0, { type: 'rollDice' });
    expect(afterRoll.ok).toBe(true);
    if (!afterRoll.ok) return;
    expect(afterRoll.state.phase).toEqual({ kind: 'main' });
    // devPlayed persists across preRoll → robber pipeline → preRoll → rollDice → main (same turn).
    expect(afterRoll.state.turn.devPlayed).toBe(true);
    expect(afterRoll.state.turn.number).toBe(s.turn.number);

    expect(code(reduce(afterRoll.state, 0, { type: 'playRoadBuilding' }))).toBe('DEV_ALREADY_PLAYED');
  });
});

describe('playRoadBuilding / roadBuilding sub-phase (R9.6/ER-5)', () => {
  it('places 2 free roads back-to-back for free, then returns to main', () => {
    const s = craft({
      place: [{ seat: 0, settlements: [RB_HAPPY_V as number], devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }] }],
    });
    const afterPlay = reduce(s, 0, { type: 'playRoadBuilding' });
    expect(afterPlay.ok).toBe(true);
    if (!afterPlay.ok) return;
    expect(afterPlay.state.phase).toEqual({ kind: 'roadBuilding', remaining: 2 });
    expect(findEvent(afterPlay.events, 'devPlayed')).toMatchObject({ seat: 0, card: 'roadBuilding' });

    const bankBefore = afterPlay.state.bank;
    const edges = GEOMETRY.vertices[RB_HAPPY_V]!.edges;

    const first = reduce(afterPlay.state, 0, { type: 'placeFreeRoad', edge: edges[0]! });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.phase).toEqual({ kind: 'roadBuilding', remaining: 1 });
    expect(findEvent(first.events, 'built')).toBeTruthy();

    const second = reduce(first.state, 0, { type: 'placeFreeRoad', edge: edges[1]! });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.phase).toEqual({ kind: 'main' });
    expect(second.state.players[0]!.roads).toEqual(expect.arrayContaining([edges[0], edges[1]]));
    expect(second.state.players[0]!.piecesLeft.roads).toBe(13); // 15 - 2
    expect(second.state.bank).toEqual(bankBefore); // free — no cost, ever
  });

  it('with exactly 1 road piece left, opens with remaining 1 (not 2), then returns to main', () => {
    const s = craft({
      place: [
        {
          seat: 0,
          settlements: [RB_HAPPY_V as number],
          devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }],
          piecesLeft: { roads: 1, settlements: 4, cities: 4 },
        },
      ],
    });
    const afterPlay = reduce(s, 0, { type: 'playRoadBuilding' });
    expect(afterPlay.ok).toBe(true);
    if (!afterPlay.ok) return;
    expect(afterPlay.state.phase).toEqual({ kind: 'roadBuilding', remaining: 1 });

    const edge = GEOMETRY.vertices[RB_HAPPY_V]!.edges[0]!;
    const afterPlace = reduce(afterPlay.state, 0, { type: 'placeFreeRoad', edge });
    expect(afterPlace.ok).toBe(true);
    if (afterPlace.ok) expect(afterPlace.state.phase).toEqual({ kind: 'main' });
  });

  it('0 road pieces left → CANNOT_PLAY (state/allowance untouched — the same play succeeds with pieces)', () => {
    const noPieces = craft({
      place: [
        {
          seat: 0,
          settlements: [RB_HAPPY_V as number],
          devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }],
          piecesLeft: { roads: 0, settlements: 4, cities: 4 },
        },
      ],
    });
    expect(code(reduce(noPieces, 0, { type: 'playRoadBuilding' }))).toBe('CANNOT_PLAY');

    const withPieces = craft({
      place: [
        {
          seat: 0,
          settlements: [RB_HAPPY_V as number],
          devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }],
          piecesLeft: { roads: 2, settlements: 4, cities: 4 },
        },
      ],
    });
    expect(reduce(withPieces, 0, { type: 'playRoadBuilding' }).ok).toBe(true);
  });

  it('0 legal edges (fully boxed in) → CANNOT_PLAY even with plenty of pieces', () => {
    const s = craft({
      place: [
        { seat: 0, settlements: [DEADEND_A as number], devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }] },
        { seat: 1, roads: deadEndAEdges }, // every edge touching A is already occupied
      ],
    });
    expect(code(reduce(s, 0, { type: 'playRoadBuilding' }))).toBe('CANNOT_PLAY');
  });

  it('running out of legal edges after the 1st placement auto-returns even though remaining > 0', () => {
    const s = craft({
      place: [
        {
          seat: 0,
          settlements: [DEADEND_A as number],
          devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }],
          piecesLeft: { roads: 10, settlements: 4, cities: 4 },
        },
        { seat: 1, roads: [...deadEndBlockedAtA, ...deadEndBlockedAtB] },
      ],
    });
    const afterPlay = reduce(s, 0, { type: 'playRoadBuilding' });
    expect(afterPlay.ok).toBe(true);
    if (!afterPlay.ok) return;
    expect(afterPlay.state.phase).toEqual({ kind: 'roadBuilding', remaining: 2 }); // min(2, 10)

    const bankBefore = afterPlay.state.bank;
    const afterPlace = reduce(afterPlay.state, 0, { type: 'placeFreeRoad', edge: deadEndE1 });
    expect(afterPlace.ok).toBe(true);
    if (!afterPlace.ok) return;
    // remaining would be 1, but every legal edge is now gone → auto-return anyway.
    expect(afterPlace.state.phase).toEqual({ kind: 'main' });
    expect(afterPlace.state.players[0]!.roads).toContain(deadEndE1);
    expect(afterPlace.state.bank).toEqual(bankBefore);
  });

  it('started in preRoll returns to preRoll when done (returnTo derived from turn.rolled)', () => {
    const s = craft({
      phase: { kind: 'preRoll' },
      rolled: false,
      roll: null,
      place: [
        {
          seat: 0,
          settlements: [RB_HAPPY_V as number],
          devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }],
          piecesLeft: { roads: 1, settlements: 4, cities: 4 },
        },
      ],
    });
    const afterPlay = reduce(s, 0, { type: 'playRoadBuilding' });
    expect(afterPlay.ok).toBe(true);
    if (!afterPlay.ok) return;
    const edge = GEOMETRY.vertices[RB_HAPPY_V]!.edges[0]!;
    const afterPlace = reduce(afterPlay.state, 0, { type: 'placeFreeRoad', edge });
    expect(afterPlace.ok).toBe(true);
    if (afterPlace.ok) expect(afterPlace.state.phase).toEqual({ kind: 'preRoll' });
  });

  it('rejects an illegal free-road edge (BAD_LOCATION)', () => {
    const s = craft({
      place: [{ seat: 0, settlements: [RB_HAPPY_V as number], devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }] }],
    });
    const afterPlay = reduce(s, 0, { type: 'playRoadBuilding' });
    expect(afterPlay.ok).toBe(true);
    if (!afterPlay.ok) return;
    const disconnected = GEOMETRY.edges.find((e) => !GEOMETRY.vertices[RB_HAPPY_V]!.edges.includes(e.id))!.id;
    expect(code(reduce(afterPlay.state, 0, { type: 'placeFreeRoad', edge: disconnected }))).toBe('BAD_LOCATION');
  });

  it('rejects any action other than placeFreeRoad while the sub-phase is open (WRONG_PHASE)', () => {
    const s = craft({
      place: [{ seat: 0, settlements: [RB_HAPPY_V as number], devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }] }],
    });
    const afterPlay = reduce(s, 0, { type: 'playRoadBuilding' });
    expect(afterPlay.ok).toBe(true);
    if (afterPlay.ok) expect(code(reduce(afterPlay.state, 0, { type: 'rollDice' }))).toBe('WRONG_PHASE');
  });

  it('placeFreeRoad is illegal outside the roadBuilding phase (WRONG_PHASE)', () => {
    const s = craft({ phase: { kind: 'main' } });
    expect(code(reduce(s, 0, { type: 'placeFreeRoad', edge: GEOMETRY.edges[0]!.id }))).toBe('WRONG_PHASE');
  });
});

describe('playYearOfPlenty (R9.7/ER-6)', () => {
  it('rejects the same type twice when the bank only holds 1 (BANK_EMPTY)', () => {
    const s = craft({
      bank: { brick: 1 },
      place: [{ seat: 0, devCards: [{ type: 'yearOfPlenty', boughtOnTurn: 1 }] }],
    });
    expect(code(reduce(s, 0, { type: 'playYearOfPlenty', a: 'brick', b: 'brick' }))).toBe('BANK_EMPTY');
  });

  it('the same type twice succeeds when the bank holds exactly 2', () => {
    const s = craft({
      bank: { brick: 2 },
      place: [{ seat: 0, devCards: [{ type: 'yearOfPlenty', boughtOnTurn: 1 }] }],
    });
    const res = reduce(s, 0, { type: 'playYearOfPlenty', a: 'brick', b: 'brick' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.players[0]!.resources.brick).toBe(2);
      expect(res.state.bank.brick).toBe(0);
    }
  });

  it('grants two different resources and decrements the bank for each', () => {
    const s = craft({ place: [{ seat: 0, devCards: [{ type: 'yearOfPlenty', boughtOnTurn: 1 }] }] });
    const bankBefore = s.bank;
    const res = reduce(s, 0, { type: 'playYearOfPlenty', a: 'brick', b: 'ore' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.brick).toBe(1);
    expect(res.state.players[0]!.resources.ore).toBe(1);
    expect(res.state.bank.brick).toBe(bankBefore.brick - 1);
    expect(res.state.bank.ore).toBe(bankBefore.ore - 1);
    expect(res.state.turn.devPlayed).toBe(true);
    expect(findEvent(res.events, 'devPlayed')).toMatchObject({
      seat: 0,
      card: 'yearOfPlenty',
      detail: { a: 'brick', b: 'ore' },
    });
  });

  it('rejects when not holding a Year of Plenty card (CARD_NOT_HELD)', () => {
    const s = craft({ place: [{ seat: 0 }] });
    expect(code(reduce(s, 0, { type: 'playYearOfPlenty', a: 'brick', b: 'ore' }))).toBe('CARD_NOT_HELD');
  });
});

describe('playMonopoly (R9.7)', () => {
  it('collects a resource from every other seat, including 0-holders; hands conserved (I1)', () => {
    const s = craft({
      place: [
        { seat: 0, devCards: [{ type: 'monopoly', boughtOnTurn: 1 }] },
        { seat: 1, hand: { wool: 3 } },
        { seat: 2, hand: { wool: 0 } },
        { seat: 3, hand: { wool: 2, brick: 4 } },
      ],
    });
    const totalWoolBefore = s.players.reduce((sum, p) => sum + p.resources.wool, 0);
    const res = reduce(s, 0, { type: 'playMonopoly', resource: 'wool' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.wool).toBe(5); // 3 + 0 + 2
    expect(res.state.players[1]!.resources.wool).toBe(0);
    expect(res.state.players[2]!.resources.wool).toBe(0);
    expect(res.state.players[3]!.resources.wool).toBe(0);
    expect(res.state.players[3]!.resources.brick).toBe(4); // untouched — different resource
    const totalWoolAfter = res.state.players.reduce((sum, p) => sum + p.resources.wool, 0);
    expect(totalWoolAfter).toBe(totalWoolBefore);
    expect(res.state.bank).toEqual(s.bank); // bank never touched by a domestic-style transfer

    expect(findEvent(res.events, 'monopolyResolved')).toEqual({
      type: 'monopolyResolved',
      seat: 0,
      resource: 'wool',
      taken: [
        { seat: 1, count: 3 },
        { seat: 2, count: 0 },
        { seat: 3, count: 2 },
      ],
    });
    expect(res.state.turn.devPlayed).toBe(true);
  });

  it('rejects a second dev play the same turn (DEV_ALREADY_PLAYED)', () => {
    const s = craft({
      devPlayed: true,
      place: [{ seat: 0, devCards: [{ type: 'monopoly', boughtOnTurn: 1 }] }],
    });
    expect(code(reduce(s, 0, { type: 'playMonopoly', resource: 'wool' }))).toBe('DEV_ALREADY_PLAYED');
  });
});

describe('legal.ts: playableDevCards', () => {
  it('reports true when playable, and a specific reason when not', () => {
    const holds = craft({ place: [{ seat: 0, devCards: [{ type: 'knight', boughtOnTurn: 1 }] }] });
    expect(playableDevCards(holds, 0).knight).toEqual({ playable: true });

    const none = craft({ place: [{ seat: 0 }] });
    expect(playableDevCards(none, 0).knight).toEqual({ playable: false, reason: 'CARD_NOT_HELD' });

    const noPieces = craft({
      place: [
        {
          seat: 0,
          settlements: [RB_HAPPY_V as number],
          devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }],
          piecesLeft: { roads: 0, settlements: 4, cities: 4 },
        },
      ],
    });
    expect(playableDevCards(noPieces, 0).roadBuilding).toEqual({ playable: false, reason: 'CANNOT_PLAY' });

    const emptyBank = craft({
      bank: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
      place: [{ seat: 0, devCards: [{ type: 'yearOfPlenty', boughtOnTurn: 1 }] }],
    });
    expect(playableDevCards(emptyBank, 0).yearOfPlenty).toEqual({ playable: false, reason: 'BANK_EMPTY' });
  });
});

describe('R9.8: Victory Point cards have no play action', () => {
  // Compile-time proof (checked by `pnpm -w typecheck`; vitest's own transpile-only run does not
  // enforce types): the Action union has no member whose `type` is a VP-play. If one were ever
  // added, the assignment below stops compiling.
  type PlayActionTypes = Extract<Action, { type: `play${string}` }>['type'];
  type NoVpPlay = 'playVictoryPoint' extends PlayActionTypes ? never : true;
  const assertNoVpPlay: NoVpPlay = true;

  it('has no VP-play action at the type level (see the type alias above)', () => {
    expect(assertNoVpPlay).toBe(true);
  });
});

describe('win via buyDevCard (R9.4 exception, R13.2)', () => {
  it('drawing a Victory Point card that reaches targetVp wins immediately, even though it was just bought', () => {
    const s = craft({
      targetVp: 1,
      devDeck: ['victoryPoint'],
      place: [{ seat: 0, hand: { ore: 1, wool: 1, grain: 1 } }],
    });
    const res = reduce(s, 0, { type: 'buyDevCard' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toEqual({ kind: 'ended', winner: 0 });
    expect(res.events.map((e) => e.type)).toEqual(['devBought', 'gameWon']);
    expect(findEvent(res.events, 'gameWon')?.seat).toBe(0);
  });
});
