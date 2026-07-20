import { describe, it, expect } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { EdgeId, GameState, ResourceType, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { reduce } from '../reduce.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

// A vertex with two incident edges and a neighbour, plus derived geometry we build scenarios on.
const V0 = GEOMETRY.vertices.find((v) => v.edges.length >= 2 && v.neighbors.length >= 1)!.id;
const vEdges = GEOMETRY.vertices[V0]!.edges;
const eA = vEdges[0]!;
const eB = vEdges[1]!;
const eAedge = GEOMETRY.edges[eA]!;
const W = (eAedge.a === V0 ? eAedge.b : eAedge.a) as VertexId;
const NBR = GEOMETRY.vertices[V0]!.neighbors[0]!;
const FAR_EDGE = GEOMETRY.edges.find((e) => ![e.a, e.b].some((x) => x === V0 || x === W))!.id;
const FULL_HAND: Record<ResourceType, number> = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };

interface Place {
  seat: Seat;
  settlements?: number[];
  cities?: number[];
  roads?: number[];
  hand?: Partial<Record<ResourceType, number>>;
  piecesLeft?: { roads: number; settlements: number; cities: number };
}

function mainState(opts: { place?: Place[]; targetVp?: number; trade?: GameState['trade'] } = {}): GameState {
  const g = createGame({ ...CONFIG, seed: 'main' });
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
      piecesLeft: pl.piecesLeft ?? {
        roads: 15 - roads.length,
        settlements: 5 - settlements.length,
        cities: 4 - cities.length,
      },
    };
  });
  return {
    ...g,
    players,
    config: { ...g.config, targetVp: opts.targetVp ?? 10 },
    turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    phase: { kind: 'main' },
    trade: opts.trade ?? null,
  };
}

function code(res: ReturnType<typeof reduce>): string | null {
  return res.ok ? null : res.error.code;
}

describe('build road (R7.2)', () => {
  it('happy path connects via an existing road and pays the bank', () => {
    const s = mainState({ place: [{ seat: 0, roads: [eA], hand: FULL_HAND }] });
    const res = reduce(s, 0, { type: 'buildRoad', edge: eB });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.players[0]!.roads).toContain(eB);
      expect(res.state.bank.brick).toBe(20); // I1: cost returned to bank
      expect(res.state.bank.lumber).toBe(20);
      expect(res.state.players[0]!.piecesLeft.roads).toBe(13);
    }
  });

  it('connects via an own settlement with no adjacent road', () => {
    const s = mainState({ place: [{ seat: 0, settlements: [V0], hand: FULL_HAND }] });
    expect(reduce(s, 0, { type: 'buildRoad', edge: eA }).ok).toBe(true);
  });

  it('rejects an occupied edge', () => {
    const s = mainState({ place: [{ seat: 0, roads: [eA], hand: FULL_HAND }] });
    expect(code(reduce(s, 0, { type: 'buildRoad', edge: eA }))).toBe('OCCUPIED');
  });

  it('rejects a disconnected edge', () => {
    const s = mainState({ place: [{ seat: 0, roads: [eA], hand: FULL_HAND }] });
    expect(code(reduce(s, 0, { type: 'buildRoad', edge: FAR_EDGE }))).toBe('NOT_CONNECTED');
  });

  it('is blocked by an enemy building at the joint vertex (R7.2)', () => {
    const s = mainState({
      place: [
        { seat: 0, roads: [eA], hand: FULL_HAND },
        { seat: 1, settlements: [V0] },
      ],
    });
    expect(code(reduce(s, 0, { type: 'buildRoad', edge: eB }))).toBe('NOT_CONNECTED');
  });

  it('rejects when unaffordable', () => {
    const s = mainState({ place: [{ seat: 0, settlements: [V0] }] }); // empty hand
    expect(code(reduce(s, 0, { type: 'buildRoad', edge: eA }))).toBe('CANT_AFFORD');
  });

  it('rejects when no road pieces remain', () => {
    const s = mainState({
      place: [{ seat: 0, settlements: [V0], hand: FULL_HAND, piecesLeft: { roads: 0, settlements: 4, cities: 4 } }],
    });
    expect(code(reduce(s, 0, { type: 'buildRoad', edge: eA }))).toBe('NO_PIECES_LEFT');
  });
});

describe('build settlement (R7.3)', () => {
  it('happy path on a distance-legal vertex touching an own road', () => {
    const s = mainState({ place: [{ seat: 0, roads: [eA], hand: FULL_HAND }] });
    const res = reduce(s, 0, { type: 'buildSettlement', vertex: V0 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.players[0]!.settlements).toContain(V0);
  });

  it('rejects a distance-rule violation', () => {
    const s = mainState({
      place: [
        { seat: 0, roads: [eA], hand: FULL_HAND },
        { seat: 1, settlements: [NBR] },
      ],
    });
    expect(code(reduce(s, 0, { type: 'buildSettlement', vertex: V0 }))).toBe('DISTANCE_RULE');
  });

  it('rejects a settlement with no connecting road', () => {
    const s = mainState({ place: [{ seat: 0, hand: FULL_HAND }] });
    expect(code(reduce(s, 0, { type: 'buildSettlement', vertex: V0 }))).toBe('NOT_CONNECTED');
  });

  it('rejects an occupied vertex', () => {
    const s = mainState({ place: [{ seat: 0, roads: [eA], settlements: [V0], hand: FULL_HAND }] });
    expect(code(reduce(s, 0, { type: 'buildSettlement', vertex: V0 }))).toBe('OCCUPIED');
  });

  it('honours the 5-settlement limit, and a city frees a piece for a 6th (R7.5)', () => {
    const S = 0;
    const far = GEOMETRY.vertices.find(
      (v) => v.id !== S && !v.neighbors.includes(S as VertexId) && !GEOMETRY.vertices[S]!.neighbors.includes(v.id)
    )!;
    const Vfar = far.id;
    const roadForVfar = far.edges[0]!;
    const s = mainState({
      place: [
        {
          seat: 0,
          settlements: [S],
          roads: [roadForVfar],
          hand: { brick: 1, lumber: 1, wool: 1, grain: 3, ore: 3 },
          piecesLeft: { roads: 14, settlements: 0, cities: 4 },
        },
      ],
    });
    // No settlement pieces left.
    expect(code(reduce(s, 0, { type: 'buildSettlement', vertex: Vfar }))).toBe('NO_PIECES_LEFT');
    // Upgrade S to a city → frees a settlement piece.
    const afterCity = reduce(s, 0, { type: 'buildCity', vertex: S as VertexId });
    expect(afterCity.ok).toBe(true);
    if (afterCity.ok) {
      expect(afterCity.state.players[0]!.piecesLeft.settlements).toBe(1);
      // Now the 6th settlement is possible.
      expect(reduce(afterCity.state, 0, { type: 'buildSettlement', vertex: Vfar }).ok).toBe(true);
    }
  });
});

describe('build city (R7.4/R7.5)', () => {
  it('happy path replaces an own settlement and returns the piece to supply', () => {
    const s = mainState({ place: [{ seat: 0, settlements: [V0], hand: { ore: 3, grain: 2 } }] });
    const res = reduce(s, 0, { type: 'buildCity', vertex: V0 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.players[0]!.cities).toContain(V0);
      expect(res.state.players[0]!.settlements).not.toContain(V0);
      expect(res.state.players[0]!.piecesLeft.settlements).toBe(5); // 4 + 1 returned
      expect(res.state.players[0]!.piecesLeft.cities).toBe(3);
      expect(res.state.bank.ore).toBe(22);
      expect(res.state.bank.grain).toBe(21);
    }
  });

  it('wins the game when the city reaches the VP target on the owner’s turn (R13)', () => {
    const s = mainState({ place: [{ seat: 0, settlements: [V0], hand: { ore: 3, grain: 2 } }], targetVp: 2 });
    const res = reduce(s, 0, { type: 'buildCity', vertex: V0 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.phase).toEqual({ kind: 'ended', winner: 0 });
      expect(res.events.some((e) => e.type === 'gameWon')).toBe(true);
    }
  });

  it('rejects an empty vertex, an opponent settlement, and an own city', () => {
    const empty = mainState({ place: [{ seat: 0, hand: { ore: 3, grain: 2 } }] });
    expect(code(reduce(empty, 0, { type: 'buildCity', vertex: V0 }))).toBe('BAD_LOCATION');

    const enemy = mainState({
      place: [
        { seat: 0, hand: { ore: 3, grain: 2 } },
        { seat: 1, settlements: [V0] },
      ],
    });
    expect(code(reduce(enemy, 0, { type: 'buildCity', vertex: V0 }))).toBe('BAD_LOCATION');

    const ownCity = mainState({ place: [{ seat: 0, cities: [V0], hand: { ore: 3, grain: 2 } }] });
    expect(code(reduce(ownCity, 0, { type: 'buildCity', vertex: V0 }))).toBe('BAD_LOCATION');
  });

  it('honours the 4-city limit', () => {
    const s = mainState({
      place: [{ seat: 0, settlements: [V0], hand: { ore: 3, grain: 2 }, piecesLeft: { roads: 15, settlements: 4, cities: 0 } }],
    });
    expect(code(reduce(s, 0, { type: 'buildCity', vertex: V0 }))).toBe('NO_PIECES_LEFT');
  });
});

describe('build side effects', () => {
  it('a successful build cancels an open trade offer (ER-11)', () => {
    const s = mainState({
      place: [{ seat: 0, settlements: [V0], hand: FULL_HAND }],
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    const res = reduce(s, 0, { type: 'buildRoad', edge: eA });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.trade).toBeNull();
      expect(res.events.some((e) => e.type === 'tradeCancelled')).toBe(true);
    }
  });
});
