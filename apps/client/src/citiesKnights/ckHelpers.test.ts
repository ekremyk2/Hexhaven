// T-806: `ckHelpers.ts`'s pure lookups, exercised over a real `redact(createGame(...), seat)`
// PlayerView (never hand-faked) so the C&K ext shape matches exactly what the client receives.
import { describe, expect, it } from 'vitest';
import { createGame, redact } from '@hexhaven/engine';
import { GEOMETRY, type GameConfig, type Seat, type VertexId } from '@hexhaven/shared';
import {
  activatableKnightVertices,
  bishopHexes,
  ckOf,
  flattenKnights,
  flattenWalls,
  inventorHexes,
  isCitiesKnightsGame,
  masterMerchantSeats,
  medicineVertices,
  metropolisAnchors,
  promotableKnightVertices,
  publicVpInView,
  spyTargetSeats,
} from './ckHelpers';

const SEAT0 = 0 as Seat;

const BASE_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ck-helpers-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const CK_CONFIG: GameConfig = { ...BASE_CONFIG, targetVp: 13, expansions: { ...BASE_CONFIG.expansions, citiesKnights: true } };

describe('isCitiesKnightsGame / ckOf', () => {
  it('is false/undefined for a base game', () => {
    const view = redact(createGame(BASE_CONFIG), SEAT0);
    expect(isCitiesKnightsGame(view)).toBe(false);
    expect(ckOf(view)).toBeUndefined();
  });

  it('is true/defined for a C&K game', () => {
    const view = redact(createGame(CK_CONFIG), SEAT0);
    expect(isCitiesKnightsGame(view)).toBe(true);
    expect(ckOf(view)).toBeDefined();
  });
});

describe('flattenKnights / flattenWalls', () => {
  it('flattens per-seat knight/wall arrays with the seat attached', () => {
    const state = createGame(CK_CONFIG);
    const v0 = GEOMETRY.vertices[0]!.id as VertexId;
    const v1 = GEOMETRY.vertices[1]!.id as VertexId;
    const ck = state.ext!.citiesKnights!;
    const withPieces = {
      ...state,
      ext: {
        ...state.ext,
        citiesKnights: {
          ...ck,
          knights: ck.knights.map((list, i) => (i === 0 ? [{ vertex: v0, level: 1 as const, active: false }] : list)),
          walls: ck.walls.map((list, i) => (i === 1 ? [v1] : list)),
        },
      },
    };
    const view = redact(withPieces, SEAT0);
    expect(flattenKnights(view)).toEqual([{ vertex: v0, level: 1, active: false, seat: 0 }]);
    expect(flattenWalls(view)).toEqual([{ vertex: v1, seat: 1 }]);
  });

  it('is empty in a base game', () => {
    const view = redact(createGame(BASE_CONFIG), SEAT0);
    expect(flattenKnights(view)).toEqual([]);
    expect(flattenWalls(view)).toEqual([]);
  });
});

describe('metropolisAnchors', () => {
  it('is empty when no metropolis has been placed yet', () => {
    const view = redact(createGame(CK_CONFIG), SEAT0);
    expect(metropolisAnchors(view)).toEqual([]);
  });

  it('anchors a placed metropolis on the owner\'s LOWEST-id city', () => {
    const state = createGame(CK_CONFIG);
    const cityHigh = GEOMETRY.vertices[5]!.id as VertexId;
    const cityLow = GEOMETRY.vertices[2]!.id as VertexId;
    const players = state.players.map((p) => (p.seat === 0 ? { ...p, cities: [cityHigh, cityLow] } : p));
    const ck = state.ext!.citiesKnights!;
    const withMetropolis = {
      ...state,
      players,
      ext: { ...state.ext, citiesKnights: { ...ck, metropolis: { ...ck.metropolis, trade: 0 as Seat } } },
    };
    const view = redact(withMetropolis, SEAT0);
    expect(metropolisAnchors(view)).toEqual([{ vertex: cityLow, track: 'trade' }]);
  });
});

describe('activatableKnightVertices / promotableKnightVertices', () => {
  it('activatable = inactive knights only; promotable = below-max-level knights (Fortress-gated for 2->3)', () => {
    const ck = {
      knights: [
        [
          { vertex: 0 as VertexId, level: 1 as const, active: false },
          { vertex: 1 as VertexId, level: 2 as const, active: true },
          { vertex: 2 as VertexId, level: 3 as const, active: false },
        ],
      ],
      improvements: [{ trade: 0, politics: 0, science: 0 }],
    };
    // Both the level-1 and level-3 knights are inactive — activation doesn't care about level.
    expect(activatableKnightVertices(ck, SEAT0)).toEqual([0, 2]);
    expect(promotableKnightVertices(ck, SEAT0)).toEqual([0]); // level-2->3 needs Fortress, not held

    const withFortress = { ...ck, improvements: [{ trade: 0, politics: 3, science: 0 }] };
    expect(promotableKnightVertices(withFortress, SEAT0)).toEqual([0, 1]);
  });

  it('excludes a knight whose TARGET level is already at the C7.1 cap (bug fix: offer must equal engine legality)', () => {
    // 2 strong (level 2) knights already at the cap (CK_KNIGHT_CAP[2] === 2) + 1 basic (level 1).
    // The basic's promotion target (level 2) has no room left, so it must NOT be offered even
    // though a naive "level < 3" check would include it — the engine's promoteKnight would reject
    // it with KNIGHT_CAP. The two strong knights themselves still qualify (target level 3, cap not
    // yet reached, Fortress held).
    const ck = {
      knights: [
        [
          { vertex: 0 as VertexId, level: 1 as const, active: false },
          { vertex: 1 as VertexId, level: 2 as const, active: true },
          { vertex: 2 as VertexId, level: 2 as const, active: true },
        ],
      ],
      improvements: [{ trade: 0, politics: 3, science: 0 }], // Fortress held — not the blocker here
    };
    expect(promotableKnightVertices(ck, SEAT0)).toEqual([1, 2]);
  });
});

describe('progress-card play-dialog target lists (client-side)', () => {
  it('medicineVertices returns own settlements when a city piece is left, empty otherwise', () => {
    const g = createGame(CK_CONFIG);
    const v = GEOMETRY.vertices[3]!.id as VertexId;
    const players = g.players.map((p) => (p.seat === 0 ? { ...p, settlements: [v] } : p));
    const view = redact({ ...g, players }, SEAT0);
    expect(medicineVertices(view, SEAT0)).toEqual([v]);

    const noPieces = g.players.map((p) =>
      p.seat === 0 ? { ...p, settlements: [v], piecesLeft: { ...p.piecesLeft, cities: 0 } } : p,
    );
    expect(medicineVertices(redact({ ...g, players: noPieces }, SEAT0), SEAT0)).toEqual([]);
  });

  it('inventorHexes excludes 6/8 tokens and untokened hexes', () => {
    const g = createGame(CK_CONFIG);
    const hexes = g.board.hexes.map((tile, i) =>
      i === 0 ? { ...tile, token: 6 } : i === 1 ? { ...tile, token: 5 } : i === 2 ? { ...tile, token: null } : tile,
    );
    const view = redact({ ...g, board: { ...g.board, hexes } }, SEAT0);
    const ids = inventorHexes(view);
    expect(ids).not.toContain(0); // token 6 excluded
    expect(ids).toContain(1); // token 5 allowed
    expect(ids).not.toContain(2); // no token excluded
  });

  it('bishopHexes is empty while the robber is locked, non-empty (minus the robber hex) once unlocked', () => {
    const g = createGame(CK_CONFIG);
    const locked = redact(g, SEAT0);
    expect(bishopHexes(locked)).toEqual([]); // robber starts locked (C10.1)

    const ck = g.ext!.citiesKnights!;
    const unlocked = redact({ ...g, ext: { ...g.ext, citiesKnights: { ...ck, robberLocked: false } } }, SEAT0);
    const ids = bishopHexes(unlocked);
    expect(ids).not.toContain(g.board.robber);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('spyTargetSeats lists opponents holding ≥1 progress card', () => {
    const g = createGame(CK_CONFIG);
    const ck = g.ext!.citiesKnights!;
    const progressHand = ck.progressHand.map((h, i) => (i === 1 ? ['bishop' as const] : h));
    const view = redact({ ...g, ext: { ...g.ext, citiesKnights: { ...ck, progressHand } } }, SEAT0);
    expect(spyTargetSeats(view, SEAT0)).toEqual([1]);
  });

  it('masterMerchantSeats lists only opponents with strictly more (C&K-aware) VP', () => {
    const g = createGame(CK_CONFIG);
    const c1 = GEOMETRY.vertices[3]!.id as VertexId;
    const c2 = GEOMETRY.vertices[6]!.id as VertexId;
    // Seat1 has 2 cities (4 VP) > seat0's 0; seat2 has nothing.
    const players = g.players.map((p) => (p.seat === 1 ? { ...p, cities: [c1, c2] } : p));
    const view = redact({ ...g, players }, SEAT0);
    expect(masterMerchantSeats(view, SEAT0)).toEqual([1]);
    expect(publicVpInView(view, 1 as Seat)).toBe(4);
  });
});
