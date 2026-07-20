// T-803: knight board-piece actions (C7) + the robber-lock-gated chase-robber action (C7.4/C10.2).
// Built over `createGame`'s real geometry (GEOMETRY) so road-network connectivity (`ownRoadAt`,
// the multi-hop `reachableVertices`) is exercised against the actual board, not a stub.

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { EdgeId, GameState, Knight, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import {
  activateKnight,
  buildKnight,
  chaseRobber,
  chaseRobberHexTargets,
  chaseRobberKnights,
  displaceableKnights,
  knightDisplace,
  knightDisplaceTargets,
  knightMoveTargets,
  legalKnightVertices,
  movableKnights,
  moveKnight,
  promoteKnight,
} from './knights.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 13,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: true as const },
};

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as VertexId;
const edg = (hexId: number, k: number) => h(hexId).edges[k]! as EdgeId;

// hex(0)'s corners chain vtx(0,0)-edg(0,0)-vtx(0,1)-edg(0,1)-vtx(0,2)-edg(0,2)-vtx(0,3), per
// GeometryHex's contract ("edges[k] connects vertices[k] to vertices[(k+1)%6]").
const V0 = vtx(0, 0);
const V1 = vtx(0, 1);
const V2 = vtx(0, 2);
const E01 = edg(0, 0);
const E12 = edg(0, 1);

interface CraftOpts {
  seat0Roads?: EdgeId[];
  seat0Settlements?: VertexId[];
  seat0Resources?: Partial<Record<'wool' | 'ore' | 'grain', number>>;
  seat0Politics?: number;
  seat1Roads?: EdgeId[];
  seat1Settlements?: VertexId[];
  knights?: Knight[][]; // index = seat, overrides the zeroed default
  robberLocked?: boolean;
  robberHex?: number;
}

function craft(opts: CraftOpts = {}): GameState {
  const g = createGame({ ...CONFIG, seed: 'ck-knights' });
  const players = g.players.map((p) => {
    if (p.seat === 0) {
      return {
        ...p,
        roads: opts.seat0Roads ?? [],
        settlements: opts.seat0Settlements ?? [],
        resources: { brick: 0, lumber: 0, wool: 5, grain: 5, ore: 5, ...opts.seat0Resources },
      };
    }
    if (p.seat === 1) {
      return { ...p, roads: opts.seat1Roads ?? [], settlements: opts.seat1Settlements ?? [] };
    }
    return p;
  });

  const base = g.ext!.citiesKnights!;
  const knights = opts.knights ?? base.knights;
  const improvements = base.improvements.map((imp, i) => (i === 0 ? { ...imp, politics: opts.seat0Politics ?? 0 } : imp));
  const ck = { ...base, knights, improvements, robberLocked: opts.robberLocked ?? base.robberLocked };

  return {
    ...g,
    players,
    phase: { kind: 'main' },
    board: { ...g.board, robber: (opts.robberHex ?? (g.board.robber as unknown as number)) as GameState['board']['robber'] },
    ext: { ...g.ext, citiesKnights: ck },
  };
}

describe('buildSettlement under a knight (B-31, C7.1)', () => {
  it('rejects building a settlement on a vertex occupied by any knight (OCCUPIED)', () => {
    const crafted = craft({ knights: [[{ vertex: V0, level: 1, active: false }], [], [], []] });
    const state: GameState = { ...crafted, turn: { ...crafted.turn, player: 0, rolled: true } };
    const res = reduce(state, 0, { type: 'buildSettlement', vertex: V0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('OCCUPIED');
  });

  it('a knight-free vertex is NOT rejected by the C&K knight guard (defers to the base handler)', () => {
    const crafted = craft({ knights: [[], [], [], []] });
    const state: GameState = { ...crafted, turn: { ...crafted.turn, player: 0, rolled: true } };
    const res = reduce(state, 0, { type: 'buildSettlement', vertex: V2 });
    // Base handler may still reject for other reasons (cost/connectivity) — just never with OUR guard.
    if (!res.ok) expect(res.error.code).not.toBe('OCCUPIED');
  });
});

describe('buildKnight (C7.1/C7.2)', () => {
  it('rejects a vertex not connected to the seat road network (NOT_CONNECTED)', () => {
    const state = craft({ seat0Roads: [] });
    const res = buildKnight(state, 0, V0);
    expect(res).toEqual({ ok: false, error: { code: 'NOT_CONNECTED', message: expect.any(String) } });
  });

  it('rejects when the seat cannot afford 1 wool + 1 ore (CANT_AFFORD)', () => {
    const state = craft({ seat0Roads: [E01], seat0Resources: { wool: 0, ore: 0 } });
    const res = buildKnight(state, 0, V0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CANT_AFFORD');
  });

  it('builds a basic, inactive knight for 1 wool + 1 ore (C7.1/C7.2)', () => {
    const state = craft({ seat0Roads: [E01] });
    const res = buildKnight(state, 0, V0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.wool).toBe(4);
    expect(res.state.players[0]!.resources.ore).toBe(4);
    expect(res.state.ext!.citiesKnights!.knights[0]).toEqual([{ vertex: V0, level: 1, active: false }]);
    expect(res.events.some((e) => e.type === 'knightBuilt')).toBe(true);
  });

  it('rejects a vertex that already holds a knight (OCCUPIED)', () => {
    const state = craft({ seat0Roads: [E01], knights: [[{ vertex: V0, level: 1, active: false }], [], [], []] });
    const res = buildKnight(state, 0, V0);
    expect(res).toEqual({ ok: false, error: { code: 'OCCUPIED', message: expect.any(String) } });
  });

  it('rejects a 3rd basic knight past the cap of 2 (KNIGHT_CAP, C7.1)', () => {
    const state = craft({
      seat0Roads: [E01, E12],
      knights: [
        [
          { vertex: V0, level: 1, active: false },
          { vertex: V1, level: 1, active: false },
        ],
        [],
        [],
        [],
      ],
    });
    const res = buildKnight(state, 0, V2);
    expect(res).toEqual({ ok: false, error: { code: 'KNIGHT_CAP', message: expect.any(String) } });
  });
});

describe('activateKnight (C7.2)', () => {
  it('rejects when no knight is at the vertex (KNIGHT_NOT_FOUND)', () => {
    const state = craft();
    const res = activateKnight(state, 0, V0);
    expect(res).toEqual({ ok: false, error: { code: 'KNIGHT_NOT_FOUND', message: expect.any(String) } });
  });

  it('rejects an already-active knight (KNIGHT_ALREADY_ACTIVE)', () => {
    const state = craft({ knights: [[{ vertex: V0, level: 1, active: true }], [], [], []] });
    const res = activateKnight(state, 0, V0);
    expect(res).toEqual({ ok: false, error: { code: 'KNIGHT_ALREADY_ACTIVE', message: expect.any(String) } });
  });

  it('activates for 1 grain', () => {
    const state = craft({ knights: [[{ vertex: V0, level: 1, active: false }], [], [], []] });
    const res = activateKnight(state, 0, V0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.grain).toBe(4);
    expect(res.state.ext!.citiesKnights!.knights[0]![0]!.active).toBe(true);
  });
});

describe('promoteKnight (C7.2/C7.3)', () => {
  it('promotes basic -> strong for 1 wool + 1 ore, no Fortress needed', () => {
    const state = craft({ knights: [[{ vertex: V0, level: 1, active: false }], [], [], []] });
    const res = promoteKnight(state, 0, V0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext!.citiesKnights!.knights[0]![0]!.level).toBe(2);
    expect(res.state.players[0]!.resources.wool).toBe(4);
  });

  it('rejects strong -> mighty without Politics-L3 Fortress (FORTRESS_REQUIRED, C4.5/C7.3)', () => {
    const state = craft({ knights: [[{ vertex: V0, level: 2, active: false }], [], [], []], seat0Politics: 0 });
    const res = promoteKnight(state, 0, V0);
    expect(res).toEqual({ ok: false, error: { code: 'FORTRESS_REQUIRED', message: expect.any(String) } });
  });

  it('allows strong -> mighty WITH Fortress (politics >= 3)', () => {
    const state = craft({ knights: [[{ vertex: V0, level: 2, active: false }], [], [], []], seat0Politics: 3 });
    const res = promoteKnight(state, 0, V0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext!.citiesKnights!.knights[0]![0]!.level).toBe(3);
  });

  it('rejects promoting an already-mighty knight (KNIGHT_MAX_LEVEL)', () => {
    const state = craft({ knights: [[{ vertex: V0, level: 3, active: false }], [], [], []] });
    const res = promoteKnight(state, 0, V0);
    expect(res).toEqual({ ok: false, error: { code: 'KNIGHT_MAX_LEVEL', message: expect.any(String) } });
  });

  it('rejects a 3rd mighty knight past the cap (KNIGHT_CAP)', () => {
    const state = craft({
      seat0Politics: 3,
      knights: [
        [
          { vertex: V0, level: 2, active: false },
          { vertex: V1, level: 3, active: false },
          { vertex: V2, level: 3, active: false },
        ],
        [],
        [],
        [],
      ],
    });
    const res = promoteKnight(state, 0, V0);
    expect(res).toEqual({ ok: false, error: { code: 'KNIGHT_CAP', message: expect.any(String) } });
  });
});

describe('moveKnight (C7.4)', () => {
  it('rejects moving an inactive knight (KNIGHT_INACTIVE)', () => {
    const state = craft({ seat0Roads: [E01], knights: [[{ vertex: V0, level: 1, active: false }], [], [], []] });
    const res = moveKnight(state, 0, V0, V1);
    expect(res).toEqual({ ok: false, error: { code: 'KNIGHT_INACTIVE', message: expect.any(String) } });
  });

  it('moves an active knight through its own settlement (own pieces do not block, C7.4) and deactivates it', () => {
    const state = craft({
      seat0Roads: [E01, E12],
      seat0Settlements: [V1],
      knights: [[{ vertex: V0, level: 1, active: true }], [], [], []],
    });
    const res = moveKnight(state, 0, V0, V2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext!.citiesKnights!.knights[0]).toEqual([{ vertex: V2, level: 1, active: false }]);
  });

  it('rejects a path blocked by an opponent building (NOT_CONNECTED)', () => {
    const state = craft({
      seat0Roads: [E01, E12],
      seat1Settlements: [V1],
      knights: [[{ vertex: V0, level: 1, active: true }], [], [], []],
    });
    const res = moveKnight(state, 0, V0, V2);
    expect(res).toEqual({ ok: false, error: { code: 'NOT_CONNECTED', message: expect.any(String) } });
  });

  it('rejects a destination that already holds a knight (OCCUPIED)', () => {
    const state = craft({
      seat0Roads: [E01],
      knights: [
        [{ vertex: V0, level: 1, active: true }],
        [{ vertex: V1, level: 1, active: false }],
        [],
        [],
      ],
    });
    const res = moveKnight(state, 0, V0, V1);
    expect(res).toEqual({ ok: false, error: { code: 'OCCUPIED', message: expect.any(String) } });
  });
});

describe('knightDisplace (C7.4)', () => {
  it('rejects displacing a knight that is not strictly weaker (NOT_STRONGER)', () => {
    const state = craft({
      seat0Roads: [E01],
      knights: [
        [{ vertex: V0, level: 2, active: true }],
        [{ vertex: V1, level: 2, active: false }],
        [],
        [],
      ],
    });
    const res = knightDisplace(state, 0, V0, V1);
    expect(res).toEqual({ ok: false, error: { code: 'NOT_STRONGER', message: expect.any(String) } });
  });

  it('removes the displaced knight when no valid landing vertex exists', () => {
    const state = craft({
      seat0Roads: [E01],
      knights: [
        [{ vertex: V0, level: 3, active: true }],
        [{ vertex: V1, level: 1, active: false }],
        [],
        [],
      ],
    });
    const res = knightDisplace(state, 0, V0, V1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.knights[0]).toEqual([{ vertex: V1, level: 3, active: false }]);
    expect(ck.knights[1]).toEqual([]); // no connected empty neighbor for seat1 -> removed
    expect(res.events.some((e) => e.type === 'knightDisplaced')).toBe(true);
  });

  it('relocates the displaced knight to an adjacent vertex connected to ITS OWNER road network', () => {
    // Give seat1 a road from V1 to one of V1's neighbors, so that neighbor is a legal landing spot.
    const v1Geom = GEOMETRY.vertices[V1]!;
    const neighborIdx = v1Geom.neighbors.findIndex((n) => n !== V0); // avoid the mover's own vertex
    const landing = v1Geom.neighbors[neighborIdx]!;
    const landingEdge = v1Geom.edges[neighborIdx]!;

    const state = craft({
      seat0Roads: [E01],
      seat1Roads: [landingEdge],
      knights: [
        [{ vertex: V0, level: 3, active: true }],
        [{ vertex: V1, level: 1, active: false }],
        [],
        [],
      ],
    });
    const res = knightDisplace(state, 0, V0, V1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.knights[1]).toEqual([{ vertex: landing, level: 1, active: false }]);
  });
});

describe('chaseRobber (C7.4/C10.1/C10.2)', () => {
  it('rejects while the robber is still locked (ROBBER_LOCKED)', () => {
    const state = craft({
      robberLocked: true,
      robberHex: h(0).id as unknown as number,
      knights: [[{ vertex: V0, level: 1, active: true }], [], [], []],
    });
    const res = chaseRobber(state, 0, V0, h(1).id, undefined);
    expect(res).toEqual({ ok: false, error: { code: 'ROBBER_LOCKED', message: expect.any(String) } });
  });

  it('rejects an inactive knight (KNIGHT_INACTIVE)', () => {
    const state = craft({
      robberLocked: false,
      robberHex: h(0).id as unknown as number,
      knights: [[{ vertex: V0, level: 1, active: false }], [], [], []],
    });
    const res = chaseRobber(state, 0, V0, h(1).id, undefined);
    expect(res).toEqual({ ok: false, error: { code: 'KNIGHT_INACTIVE', message: expect.any(String) } });
  });

  it('rejects a knight not adjacent to the robber (BAD_LOCATION)', () => {
    const state = craft({
      robberLocked: false,
      robberHex: h(10).id as unknown as number,
      knights: [[{ vertex: V0, level: 1, active: true }], [], [], []],
    });
    const res = chaseRobber(state, 0, V0, h(1).id, undefined);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('BAD_LOCATION');
  });

  it('moves the robber and deactivates the knight (no adjacent victim -> no steal)', () => {
    const state = craft({
      robberLocked: false,
      robberHex: h(0).id as unknown as number,
      knights: [[{ vertex: V0, level: 1, active: true }], [], [], []],
    });
    const res = chaseRobber(state, 0, V0, h(1).id, undefined);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.board.robber).toBe(h(1).id);
    expect(res.state.ext!.citiesKnights!.knights[0]![0]!.active).toBe(false);
    expect(res.events.some((e) => e.type === 'robberMoved')).toBe(true);
  });
});

// T-806: client legal-target enumerators. Each mirrors its handler's own validation (minus
// cost/affordability, a separate client-side concern) so the UI never highlights a target the
// engine would then reject.
describe('legalKnightVertices (C7.1)', () => {
  it('is empty with no road connectivity', () => {
    const state = craft({ seat0Roads: [] });
    expect(legalKnightVertices(state, 0)).toEqual([]);
  });

  it('offers every road-connected, unoccupied vertex', () => {
    const state = craft({ seat0Roads: [E01] });
    const ids = legalKnightVertices(state, 0);
    expect(ids).toContain(V0);
    expect(ids).toContain(V1);
  });

  it('is empty once the seat is at the basic-knight cap (C7.1)', () => {
    const state = craft({
      seat0Roads: [E01, E12],
      knights: [
        [
          { vertex: V0, level: 1, active: false },
          { vertex: V1, level: 1, active: false },
        ],
        [],
        [],
        [],
      ],
    });
    expect(legalKnightVertices(state, 0)).toEqual([]);
  });
});

describe('movableKnights/knightMoveTargets (C7.4, B-28-style guard)', () => {
  it('excludes an active knight with NO legal move destination (isolated, no roads)', () => {
    const state = craft({ seat0Roads: [], knights: [[{ vertex: V0, level: 1, active: true }], [], [], []] });
    expect(knightMoveTargets(state, 0, V0)).toEqual([]);
    expect(movableKnights(state, 0)).toEqual([]);
  });

  it('includes it once a road opens a legal destination', () => {
    const state = craft({ seat0Roads: [E01], knights: [[{ vertex: V0, level: 1, active: true }], [], [], []] });
    expect(knightMoveTargets(state, 0, V0)).toContain(V1);
    expect(movableKnights(state, 0)).toEqual([V0]);
  });

  it('excludes an INACTIVE knight regardless of road connectivity', () => {
    const state = craft({ seat0Roads: [E01], knights: [[{ vertex: V0, level: 1, active: false }], [], [], []] });
    expect(movableKnights(state, 0)).toEqual([]);
  });

  it('excludes a destination already holding a knight', () => {
    const state = craft({
      seat0Roads: [E01],
      knights: [
        [{ vertex: V0, level: 1, active: true }],
        [{ vertex: V1, level: 1, active: false }],
        [],
        [],
      ],
    });
    expect(knightMoveTargets(state, 0, V0)).toEqual([]);
    expect(movableKnights(state, 0)).toEqual([]);
  });
});

describe('displaceableKnights/knightDisplaceTargets (C7.4, B-28-style guard)', () => {
  it('excludes an active knight with no weaker opponent knight in reach', () => {
    const state = craft({
      seat0Roads: [E01],
      knights: [[{ vertex: V0, level: 1, active: true }], [], [], []],
    });
    expect(knightDisplaceTargets(state, 0, V0)).toEqual([]);
    expect(displaceableKnights(state, 0)).toEqual([]);
  });

  it('includes it once a strictly weaker opponent knight is in reach', () => {
    const state = craft({
      seat0Roads: [E01],
      knights: [
        [{ vertex: V0, level: 2, active: true }],
        [{ vertex: V1, level: 1, active: false }],
        [],
        [],
      ],
    });
    expect(knightDisplaceTargets(state, 0, V0)).toEqual([V1]);
    expect(displaceableKnights(state, 0)).toEqual([V0]);
  });

  it('excludes an opponent knight that is not strictly weaker', () => {
    const state = craft({
      seat0Roads: [E01],
      knights: [
        [{ vertex: V0, level: 2, active: true }],
        [{ vertex: V1, level: 2, active: false }],
        [],
        [],
      ],
    });
    expect(knightDisplaceTargets(state, 0, V0)).toEqual([]);
    expect(displaceableKnights(state, 0)).toEqual([]);
  });
});

describe('chaseRobberKnights/chaseRobberHexTargets (C7.4/C10.1/C10.2)', () => {
  it('is empty while the robber is locked, even with an adjacent active knight', () => {
    const state = craft({
      robberLocked: true,
      robberHex: h(0).id as unknown as number,
      knights: [[{ vertex: V0, level: 1, active: true }], [], [], []],
    });
    expect(chaseRobberKnights(state, 0)).toEqual([]);
    expect(chaseRobberHexTargets(state)).toEqual([]);
  });

  it('offers an adjacent active knight and every other hex once unlocked', () => {
    const state = craft({
      robberLocked: false,
      robberHex: h(0).id as unknown as number,
      knights: [[{ vertex: V0, level: 1, active: true }], [], [], []],
    });
    expect(chaseRobberKnights(state, 0)).toEqual([V0]);
    const hexTargets = chaseRobberHexTargets(state);
    expect(hexTargets).not.toContain(h(0).id);
    expect(hexTargets.length).toBeGreaterThan(0);
  });

  it('excludes a knight not adjacent to the robber', () => {
    const state = craft({
      robberLocked: false,
      robberHex: h(10).id as unknown as number,
      knights: [[{ vertex: V0, level: 1, active: true }], [], [], []],
    });
    expect(chaseRobberKnights(state, 0)).toEqual([]);
  });

  it('excludes an inactive knight', () => {
    const state = craft({
      robberLocked: false,
      robberHex: h(0).id as unknown as number,
      knights: [[{ vertex: V0, level: 1, active: false }], [], [], []],
    });
    expect(chaseRobberKnights(state, 0)).toEqual([]);
  });
});
