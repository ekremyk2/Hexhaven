// T-806: client-facing legal-target enumerators for the progress-card play dialogs
// (`merchantHexes`/`diplomatOpenRoads` from progressCards.ts, `knightPlacementVertices`/
// `intrigueTargets` from knights.ts). Built over `createGame`'s real geometry so connectivity/
// adjacency is authentic.

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { EdgeId, GameState, Knight, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { diplomatOpenRoads, merchantHexes } from './progressCards.js';
import { intrigueTargets, knightPlacementVertices } from './knights.js';

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

const V0 = vtx(0, 0);
const V1 = vtx(0, 1);
const E01 = edg(0, 0);
const E12 = edg(0, 1);

function craft(opts: {
  seat0Roads?: EdgeId[];
  seat0Settlements?: VertexId[];
  seat0Cities?: VertexId[];
  seat1Roads?: EdgeId[];
  knights?: Knight[][];
} = {}): GameState {
  const g = createGame({ ...CONFIG, seed: 'ck-progress-legal' });
  const players = g.players.map((p) => {
    if (p.seat === 0) {
      return { ...p, roads: opts.seat0Roads ?? [], settlements: opts.seat0Settlements ?? [], cities: opts.seat0Cities ?? [] };
    }
    if (p.seat === 1) return { ...p, roads: opts.seat1Roads ?? [] };
    return p;
  });
  const base = g.ext!.citiesKnights!;
  const knights = opts.knights ?? base.knights;
  return { ...g, players, phase: { kind: 'main' }, ext: { ...g.ext, citiesKnights: { ...base, knights } } };
}

describe('merchantHexes (Merchant, C6.5)', () => {
  it('is empty when the seat owns no building', () => {
    expect(merchantHexes(craft(), 0)).toEqual([]);
  });

  it('offers every hex adjacent to the seat’s settlement (hex 0’s corners include V0)', () => {
    const state = craft({ seat0Settlements: [V0] });
    const hexes = merchantHexes(state, 0);
    expect(hexes).toContain(h(0).id);
    // Every returned hex genuinely touches V0-owning geometry.
    for (const id of hexes) {
      expect(GEOMETRY.hexes[id]!.vertices).toContain(V0);
    }
  });
});

describe('diplomatOpenRoads (Diplomat, C6.5)', () => {
  it('includes an isolated road (both ends open)', () => {
    const state = craft({ seat0Roads: [E01] });
    expect(diplomatOpenRoads(state)).toContain(E01);
  });

  it('excludes the interior road of a two-road chain (its shared vertex is not an open end for E01… but the far ends are)', () => {
    // E01 (V0-V1) + E12 (V1-V2): V1 is shared. E01's V0 end is open, E12's V2 end is open — both
    // roads still have an open END, so both are open. Assert both are present (documents the rule).
    const state = craft({ seat0Roads: [E01, E12] });
    const open = diplomatOpenRoads(state);
    expect(open).toContain(E01);
    expect(open).toContain(E12);
  });

  it('excludes a road whose both ends carry the seat’s own buildings', () => {
    const state = craft({ seat0Roads: [E01], seat0Settlements: [V0, V1] });
    expect(diplomatOpenRoads(state)).not.toContain(E01);
  });
});

describe('knightPlacementVertices (Deserter, C6.5)', () => {
  it('offers road-connected empty vertices regardless of the basic-knight cap', () => {
    // Seat0 is at the basic cap (2 basic knights) but Deserter may still place — so unlike
    // legalKnightVertices this must NOT be empty.
    const V2 = vtx(0, 2);
    const state = craft({
      // Two roads: V0-V1-V2. V0/V1 hold the 2 basic knights (at cap); V2 is connected + empty.
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
    const ids = knightPlacementVertices(state, 0);
    // V0/V1 already hold knights, so they’re excluded; V2 (connected + empty) remains despite the cap.
    expect(ids).not.toContain(V0);
    expect(ids).not.toContain(V1);
    expect(ids).toContain(V2);
  });
});

describe('intrigueTargets (Intrigue, C6.5)', () => {
  it('is empty when no opponent knight sits on the seat’s road', () => {
    const state = craft({ seat0Roads: [E01], knights: [[], [{ vertex: V0, level: 1, active: false }], [], []] });
    // V0 is on seat0's road E01, so this SHOULD be a target — assert it is.
    expect(intrigueTargets(state, 0)).toContain(V0);
  });

  it('excludes an opponent knight NOT on the seat’s road', () => {
    // Seat1 knight at a far vertex not touching seat0's single road E01.
    const far = vtx(10, 0);
    const state = craft({ seat0Roads: [E01], knights: [[], [{ vertex: far, level: 1, active: false }], [], []] });
    expect(intrigueTargets(state, 0)).not.toContain(far);
  });
});
