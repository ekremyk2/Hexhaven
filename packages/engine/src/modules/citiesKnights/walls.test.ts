// T-806: the `wallEligibleCities` client legal-target enumerator (C9.1). Mirrors
// `knights.test.ts`'s `craft()` pattern over a real `createGame` state.

import { describe, expect, it } from 'vitest';
import { CK_MAX_WALLS } from '@hexhaven/shared';
import { GEOMETRY } from '@hexhaven/shared';
import type { GameState, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { wallEligibleCities } from './walls.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 13,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: true as const },
};

const V0 = GEOMETRY.vertices[0]!.id as VertexId;
const V1 = GEOMETRY.vertices[1]!.id as VertexId;

function craft(opts: { cities?: VertexId[]; walls?: VertexId[] } = {}): GameState {
  const g = createGame({ ...CONFIG, seed: 'ck-walls' });
  const players = g.players.map((p) => (p.seat === 0 ? { ...p, cities: opts.cities ?? [] } : p));
  const base = g.ext!.citiesKnights!;
  const walls = base.walls.map((w, i) => (i === 0 ? (opts.walls ?? []) : w));
  return { ...g, players, phase: { kind: 'main' }, ext: { ...g.ext, citiesKnights: { ...base, walls } } };
}

describe('wallEligibleCities (C9.1)', () => {
  it('is empty with no cities', () => {
    const state = craft();
    expect(wallEligibleCities(state, 0)).toEqual([]);
  });

  it('offers every unwalled city', () => {
    const state = craft({ cities: [V0, V1] });
    expect(wallEligibleCities(state, 0)).toEqual([V0, V1]);
  });

  it('excludes a city that already has a wall', () => {
    const state = craft({ cities: [V0, V1], walls: [V0] });
    expect(wallEligibleCities(state, 0)).toEqual([V1]);
  });

  it('is empty once the seat is at the wall cap (CK_MAX_WALLS)', () => {
    const state = craft({ cities: [V0, V1], walls: Array.from({ length: CK_MAX_WALLS }, () => V1) });
    expect(wallEligibleCities(state, 0)).toEqual([]);
  });
});
