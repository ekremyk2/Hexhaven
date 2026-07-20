// T-803: the event die (C5.1) + barbarian attack resolution (C8.2-C8.7) as pure functions, decoupled
// from `reduce`/`createGame` (the end-to-end wiring is covered by t803.test.ts).

import { describe, expect, it } from 'vitest';
import type { CitiesKnightsExt, Knight, PlayerState, Seat, VertexId } from '@hexhaven/shared';
import { hashSeed } from '../../rng.js';
import { resolveBarbarianAttack, rollEventDie } from './barbarian.js';
import { initCitiesKnightsExt } from './state.js';

function basePlayer(seat: Seat, cities: number[] = []): PlayerState {
  return {
    seat,
    color: 'red',
    resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
    devCards: [],
    playedKnights: 0,
    piecesLeft: { roads: 15, settlements: 5, cities: 4 },
    roads: [],
    settlements: [],
    cities: cities.map((n) => n as VertexId),
  };
}

function baseExt(overrides: Partial<CitiesKnightsExt> = {}): CitiesKnightsExt {
  const { ext } = initCitiesKnightsExt(4, hashSeed('barbarian-test'));
  return { ...ext, ...overrides };
}

function knight(vertex: number, level: 1 | 2 | 3, active: boolean): Knight {
  return { vertex: vertex as VertexId, level, active };
}

describe('rollEventDie (C5.1)', () => {
  it('is deterministic for a fixed rng state', () => {
    const a = rollEventDie(12345);
    const b = rollEventDie(12345);
    expect(a).toEqual(b);
  });

  it('only ever yields the 4 documented faces (3 ship + trade/politics/science)', () => {
    let rng = hashSeed('faces');
    const faces = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const draw = rollEventDie(rng);
      rng = draw.state;
      faces.add(draw.face);
    }
    expect([...faces].sort()).toEqual(['politics', 'science', 'ship', 'trade']);
  });
});

describe('resolveBarbarianAttack (C8.3-C8.6)', () => {
  it('defends when defense >= attack (ties defend, C8.4), and the sole highest seat becomes Defender (C8.5)', () => {
    const players = [basePlayer(0, [1]), basePlayer(1, [2]), basePlayer(2, []), basePlayer(3, [])];
    const knights = [[knight(10, 2, true)], [], [], []]; // seat0: strength 2
    const ck = baseExt({ knights });

    const result = resolveBarbarianAttack(players, ck);
    expect(result.attackStrength).toBe(2); // 2 cities total, no metropolis
    expect(result.defenseStrength).toBe(2);
    expect(result.result).toBe('defended');
    expect(result.defenderSeat).toBe(0);
    expect(result.tiedSeats).toEqual([]);
    expect(result.pillaged).toEqual([]);
  });

  it('an INACTIVE knight never counts toward defense (C7.5)', () => {
    const players = [basePlayer(0, [1]), basePlayer(1, []), basePlayer(2, []), basePlayer(3, [])];
    const knights = [[knight(10, 3, false)], [], [], []]; // mighty but inactive -> counts as 0
    const ck = baseExt({ knights });

    const result = resolveBarbarianAttack(players, ck);
    expect(result.defenseStrength).toBe(0);
    expect(result.result).toBe('defeated'); // 0 defense < 1 attack (1 city)
  });

  it('a tie for highest defense means no defender at all (C8.5)', () => {
    const players = [basePlayer(0, [1, 2]), basePlayer(1, []), basePlayer(2, []), basePlayer(3, [])];
    const knights = [
      [knight(10, 2, true)], // seat0: 2
      [knight(11, 1, true), knight(12, 1, true)], // seat1: 2
      [],
      [],
    ];
    const ck = baseExt({ knights });

    const result = resolveBarbarianAttack(players, ck);
    expect(result.attackStrength).toBe(2);
    expect(result.defenseStrength).toBe(4);
    expect(result.result).toBe('defended');
    expect(result.defenderSeat).toBeNull();
    expect([...result.tiedSeats].sort()).toEqual([0, 1]);
  });

  it('barbarians win when defense < attack; the lowest-defense seat loses their lowest-VertexId city, wall destroyed (C8.6)', () => {
    const players = [
      basePlayer(0, [5, 3]), // seat0: 2 cities, 0 defense (lowest)
      basePlayer(1, [10]), // seat1: 1 city, higher defense
      basePlayer(2, []),
      basePlayer(3, []),
    ];
    const knights = [
      [], // seat0: 0
      [knight(20, 2, true)], // seat1: 2
      [],
      [],
    ];
    const walls: VertexId[][] = [[3 as VertexId], [], [], []];
    const ck = baseExt({ knights, walls });

    const result = resolveBarbarianAttack(players, ck);
    expect(result.attackStrength).toBe(3); // 3 cities total
    expect(result.defenseStrength).toBe(2);
    expect(result.result).toBe('defeated');
    expect(result.defenderSeat).toBeNull();
    // seat2/seat3 also sit at 0 defense but own no cities -> C8.6 "no city -> loses nothing".
    expect(result.pillaged).toEqual([{ seat: 0, vertex: 3 }]);

    const seat0 = result.players[0]!;
    expect(seat0.cities).toEqual([5]);
    expect(seat0.settlements).toEqual([3]);
    expect(seat0.piecesLeft.settlements).toBe(4); // consumed one from supply
    expect(seat0.piecesLeft.cities).toBe(5); // returned to supply
    expect(result.walls[0]).toEqual([]); // C9.3: the wall is destroyed
  });

  it('a seat whose only city is a metropolis loses nothing even when tied for lowest (C8.6)', () => {
    const players = [
      basePlayer(0, [5]), // seat0: 1 city, which IS the metropolis (immune)
      basePlayer(1, [10, 11]), // seat1: 2 ordinary cities
      basePlayer(2, []),
      basePlayer(3, []),
    ];
    const knights = [[], [], [], []]; // everyone at 0 defense -> all tied lowest
    const ck = baseExt({ knights, metropolis: { trade: 0 as Seat, politics: null, science: null } });

    const result = resolveBarbarianAttack(players, ck);
    expect(result.result).toBe('defeated'); // 0 defense < 3 attack (3 cities total)
    expect(result.pillaged.some((p) => p.seat === 0)).toBe(false); // immune
    expect(result.pillaged.some((p) => p.seat === 1)).toBe(true); // loses one of their 2 cities
  });
});
