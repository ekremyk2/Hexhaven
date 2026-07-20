import { describe, it, expect } from 'vitest';
import { GEOMETRY, TERRAIN_RESOURCE } from '@hexhaven/shared';
import type { Action, GameState, ResourceBundle, ResourceType, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { reduce } from '../reduce.js';
import { legalSetupSettlements, legalSetupRoads } from '../legal.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

function game(seed: string): GameState {
  return createGame({ ...CONFIG, seed });
}

/** Non-desert resources adjacent to a vertex — the R3.4 starting grant for a settlement there. */
function adjacentGrant(state: GameState, v: VertexId): ResourceBundle {
  const out: ResourceBundle = {};
  const vert = GEOMETRY.vertices[v]!;
  for (const hexId of vert.hexes) {
    const res = TERRAIN_RESOURCE[state.board.hexes[hexId]!.terrain];
    if (res) out[res] = (out[res] ?? 0) + 1;
  }
  return out;
}

/** Drive a legal 16-action snake draft, greedily taking the first legal target each step. */
function driveFullSetup(seed: string) {
  let state = game(seed);
  const settlementSeats: Seat[] = [];
  const grants: { seat: Seat; gained: ResourceBundle }[] = [];
  for (let step = 0; step < 16; step++) {
    const seat = state.turn.player;
    const expectSettlement = state.phase.kind === 'setup' && state.phase.expect === 'settlement';
    let action: Action;
    if (expectSettlement) {
      const vs = legalSetupSettlements(state);
      expect(vs.length).toBeGreaterThan(0);
      action = { type: 'placeSetupSettlement', vertex: vs[0]! };
      settlementSeats.push(seat);
    } else {
      const es = legalSetupRoads(state);
      expect(es.length).toBeGreaterThan(0);
      action = { type: 'placeSetupRoad', edge: es[0]! };
    }
    const res = reduce(state, seat, action);
    if (!res.ok) throw new Error(`step ${step}: ${res.error.code} ${res.error.message}`);
    for (const ev of res.events) {
      if (ev.type === 'startingResources') grants.push({ seat: ev.seat, gained: ev.gained });
    }
    state = res.state;
  }
  return { state, settlementSeats, grants };
}

describe('setup phase (R3)', () => {
  it('runs the full snake draft and hands off to preRoll', () => {
    const { state, settlementSeats } = driveFullSetup('setup-1');

    expect(settlementSeats).toEqual([0, 1, 2, 3, 3, 2, 1, 0]); // R3.1 snake
    expect(state.phase).toEqual({ kind: 'preRoll' });
    expect(state.turn.player).toBe(0); // R3.5
    expect(state.turn.number).toBe(1);
    expect(state.turn.rolled).toBe(false);

    for (const p of state.players) {
      expect(p.settlements).toHaveLength(2);
      expect(p.roads).toHaveLength(2);
      expect(p.piecesLeft).toEqual({ roads: 13, settlements: 3, cities: 4 });
    }
  });

  it('grants starting resources only for the second settlement (R3.4)', () => {
    const { state, grants } = driveFullSetup('setup-2');

    // Exactly one grant per player, from their round-2 (second) settlement.
    expect(grants).toHaveLength(4);

    let bankGiven = 0;
    for (const p of state.players) {
      const second = p.settlements[1]!;
      const expected = adjacentGrant(state, second);
      // A player's whole hand comes from that one settlement (round 1 grants nothing).
      for (const r of ['brick', 'lumber', 'wool', 'grain', 'ore'] as ResourceType[]) {
        expect(p.resources[r]).toBe(expected[r] ?? 0);
        bankGiven += expected[r] ?? 0;
      }
    }
    // Bank conserved: what left the bank equals what players hold (I1, locally).
    const held = state.players.reduce(
      (s, p) => s + p.resources.brick + p.resources.lumber + p.resources.wool + p.resources.grain + p.resources.ore,
      0
    );
    expect(held).toBe(bankGiven);
    const bankTotal = state.bank.brick + state.bank.lumber + state.bank.wool + state.bank.grain + state.bank.ore;
    expect(bankTotal).toBe(19 * 5 - held);
  });

  it('rejects a placement from the wrong seat (NOT_YOUR_TURN)', () => {
    const state = game('setup-3');
    const v = legalSetupSettlements(state)[0]!;
    const res = reduce(state, 1, { type: 'placeSetupSettlement', vertex: v });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_YOUR_TURN');
  });

  it('rejects a road before the first settlement (WRONG_PHASE)', () => {
    const state = game('setup-4');
    const res = reduce(state, 0, { type: 'placeSetupRoad', edge: GEOMETRY.edges[0]!.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('WRONG_PHASE');
  });

  it('enforces the distance rule and occupancy on the next settlement', () => {
    let state = game('setup-5');
    const v0 = legalSetupSettlements(state)[0]!;
    state = expectOk(reduce(state, 0, { type: 'placeSetupSettlement', vertex: v0 }));
    state = expectOk(reduce(state, 0, { type: 'placeSetupRoad', edge: legalSetupRoads(state)[0]! }));

    // Now seat 1 to place a settlement. A neighbour of v0 violates the distance rule.
    const neighbour = GEOMETRY.vertices[v0]!.neighbors[0]!;
    const adj = reduce(state, 1, { type: 'placeSetupSettlement', vertex: neighbour });
    expect(adj.ok).toBe(false);
    if (!adj.ok) expect(adj.error.code).toBe('DISTANCE_RULE');

    // v0 itself is occupied.
    const occ = reduce(state, 1, { type: 'placeSetupSettlement', vertex: v0 });
    expect(occ.ok).toBe(false);
    if (!occ.ok) expect(occ.error.code).toBe('OCCUPIED');

    // A distance-legal vertex is accepted.
    const far = legalSetupSettlements(state)[0]!;
    expect(reduce(state, 1, { type: 'placeSetupSettlement', vertex: far }).ok).toBe(true);
  });

  it('requires the setup road to touch the settlement just placed (NOT_CONNECTED)', () => {
    let state = game('setup-6');
    const v0 = legalSetupSettlements(state)[0]!;
    state = expectOk(reduce(state, 0, { type: 'placeSetupSettlement', vertex: v0 }));

    // Find an edge not incident to v0.
    const detached = GEOMETRY.edges.find((e) => e.a !== v0 && e.b !== v0)!;
    const res = reduce(state, 0, { type: 'placeSetupRoad', edge: detached.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_CONNECTED');
  });
});

function expectOk(res: ReturnType<typeof reduce>): GameState {
  if (!res.ok) throw new Error(`unexpected error: ${res.error.code} ${res.error.message}`);
  return res.state;
}
