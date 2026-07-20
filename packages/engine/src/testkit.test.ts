import { describe, expect, it } from 'vitest';
import { BANK_PER_RESOURCE, GEOMETRY, PIECES_PER_PLAYER } from '@hexhaven/shared';
import type { ResourceType } from '@hexhaven/shared';
import { stateWith } from './testkit.js';

const RESOURCES: ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

describe('testkit base state legality', () => {
  const s = stateWith();

  it('is a deterministic 4-player main-phase state from seed "testkit"', () => {
    expect(s.config.seed).toBe('testkit');
    expect(s.players).toHaveLength(4);
    expect(s.phase).toEqual({ kind: 'main' });
    expect(s.turn.player).toBe(0);
    expect(s.turn.rolled).toBe(true);
    expect(stateWith()).toEqual(stateWith());
  });

  it('keeps I1: bank + all hands = 19 per resource', () => {
    for (const res of RESOURCES) {
      const inHands = s.players.reduce((sum, p) => sum + p.resources[res], 0);
      expect(s.bank[res] + inHands).toBe(BANK_PER_RESOURCE);
    }
  });

  it('keeps I2: placed pieces + piecesLeft = per-player totals', () => {
    for (const p of s.players) {
      expect(p.roads.length + p.piecesLeft.roads).toBe(PIECES_PER_PLAYER.roads);
      expect(p.settlements.length + p.piecesLeft.settlements).toBe(PIECES_PER_PLAYER.settlements);
      expect(p.cities.length + p.piecesLeft.cities).toBe(PIECES_PER_PLAYER.cities);
    }
  });

  it('places 8 distinct settlements that all satisfy the distance rule (R7.3)', () => {
    const all = s.players.flatMap((p) => p.settlements);
    expect(all).toHaveLength(8);
    expect(new Set(all).size).toBe(8);
    for (const a of all) {
      const vertex = GEOMETRY.vertices[a];
      if (!vertex) throw new Error(`unknown vertex ${a}`);
      for (const b of all) {
        expect(vertex.neighbors.includes(b)).toBe(false);
      }
    }
  });

  it('attaches every road to its player’s matching settlement (R3.3), no road reuse', () => {
    const allRoads = s.players.flatMap((p) => p.roads);
    expect(new Set(allRoads).size).toBe(allRoads.length);
    for (const p of s.players) {
      expect(p.roads).toHaveLength(p.settlements.length);
      p.roads.forEach((roadId, i) => {
        const edge = GEOMETRY.edges[roadId];
        if (!edge) throw new Error(`unknown edge ${roadId}`);
        expect([edge.a, edge.b]).toContain(p.settlements[i]);
      });
    }
  });
});

describe('stateWith override semantics', () => {
  it('merges nested plain objects per key', () => {
    const s = stateWith({ turn: { player: 2 } });
    expect(s.turn.player).toBe(2);
    expect(s.turn.number).toBe(stateWith().turn.number); // untouched siblings survive
    expect(s.turn.rolled).toBe(true);
  });

  it('replaces arrays and tuples wholesale', () => {
    const s = stateWith({ turn: { roll: [6, 6] } });
    expect(s.turn.roll).toEqual([6, 6]);
  });

  it('replaces a kind-tagged object of a different kind wholesale', () => {
    const s = stateWith({ phase: { kind: 'moveRobber', returnTo: 'main' } });
    expect(s.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });
    expect(Object.keys(s.phase).sort()).toEqual(['kind', 'returnTo']);
  });

  it('lets null and objects replace each other (trade)', () => {
    const offer = { give: { brick: 1 }, receive: { wool: 1 }, responses: {} };
    expect(stateWith({ trade: offer }).trade).toEqual(offer);
    expect(stateWith().trade).toBeNull();
  });

  it('never leaks overrides across calls', () => {
    stateWith({ turn: { player: 3 }, stateVersion: 99 });
    const fresh = stateWith();
    expect(fresh.turn.player).toBe(0);
    expect(fresh.stateVersion).toBe(25);
  });
});
