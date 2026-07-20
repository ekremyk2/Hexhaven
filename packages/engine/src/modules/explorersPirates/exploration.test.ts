// T-1103: Explorers & Pirates exploration + fog redaction (docs/rules/explorers-pirates-rules.md
// §EP5/§EP12.4). Unit tests over CRAFTED states (same discipline as ships.test.ts: `craft()` +
// `buildLandHoBoardV0` + this task's own `seedExplorationV0`, NOT `createGame`/a shipped scenario —
// no E&P scenario ships yet, T-1107): `seedExplorationV0`'s init shape, the reveal-on-arrival trigger
// folded into `moveEPShipHandler`, and — the load-bearing part — the fog REDACTION boundary (EP12.4):
// `explorationSupply` never appears in any view, `unexplored` hexes' real content is unconditionally
// stripped even if a future scenario pre-stores it, and a revealed hex's real content rides through.
//
// ⚠ VERIFY: every constant this file exercises (`EP_EXPLORATION_TILES`'s die->tile table, the
// "destination-edge-only" reveal-adjacency trigger, "non-home hex" == "sea" at seed time) is a
// provisional v1 placeholder — see exploration.ts's header comment and the task's Implementation
// notes.

import { describe, expect, it } from 'vitest';
import type { EdgeId, GameConfig, GameState, HexId, ScenarioTerrain, Seat, VertexId } from '@hexhaven/shared';
import { GEOMETRY } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { redact } from '../../redact.js';
import { buildLandHoBoard56, buildLandHoBoardV0 } from './board.js';
import { EP_EXPLORATION_TILES, EP_EXPLORATION_TILES_56, revealOnArrival, seedExplorationV0 } from './exploration.js';
import { buildEPShipHandler, moveEPShipHandler } from './ships.js';
import { epExt, withEpExt } from './state.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ep-exploration',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const FULL_HAND = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };

function isSeaEdgeOf(seaMap: readonly ScenarioTerrain[], edgeId: EdgeId): boolean {
  const e = GEOMETRY.edges[edgeId]!;
  return e.hexes.some((h) => seaMap[h] === 'sea');
}

function findCoastalVertex(seaMap: readonly ScenarioTerrain[]): { vertex: VertexId; seaEdges: EdgeId[] } {
  for (const v of GEOMETRY.vertices) {
    const seaEdges = v.edges.filter((e) => isSeaEdgeOf(seaMap, e));
    if (seaEdges.length >= 2) return { vertex: v.id, seaEdges };
  }
  throw new Error('BUG: no coastal vertex with >=2 sea edges found on the test board');
}

/** Builds a crafted E&P state with exploration SEEDED on top of T-1102's `buildLandHoBoardV0` (same
 *  "craft a state, don't go through createGame/a shipped scenario" discipline as ships.test.ts). */
function craft(): {
  state: GameState;
  vertex: VertexId;
  seaEdges: EdgeId[];
  seaMap: ScenarioTerrain[];
} {
  const created = createGame(CONFIG);
  const built = buildLandHoBoardV0(created.rng);
  const seeded = seedExplorationV0(built.rng, built);
  const { vertex, seaEdges } = findCoastalVertex(built.seaMap);

  const players = created.players.map((p) =>
    p.seat === 0 ? { ...p, settlements: [vertex], resources: { ...FULL_HAND } } : p
  );

  const state: GameState = {
    ...created,
    rng: seeded.rng,
    board: built.board,
    players,
    ext: {
      ...created.ext,
      explorersPirates: {
        scenario: 'landHo',
        seaMap: built.seaMap,
        ships: [],
        shipsBuiltThisTurn: [],
        movedShipsThisTurn: [],
        gold: [0, 0, 0, 0],
        explorationSupply: seeded.explorationSupply,
        unexplored: seeded.unexplored,
      },
    },
    phase: { kind: 'main' },
    turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
  };
  return { state, vertex, seaEdges, seaMap: built.seaMap };
}

function craftWithShip() {
  const crafted = craft();
  const edge = crafted.seaEdges[0]!;
  const built = buildEPShipHandler(crafted.state, 0, { type: 'buildEPShip', edge });
  if (!built.ok) throw new Error('BUG: test setup failed to build a ship');
  const ext = epExt(built.state)!;
  const readyState = withEpExt(built.state, { ...ext, shipsBuiltThisTurn: [] });
  return { ...crafted, state: readyState, shipEdge: edge };
}

describe('seedExplorationV0 (T-1103 init helper)', () => {
  it('marks every sea (non-home) hex unexplored and shuffles EP_EXPLORATION_TILES into the supply', () => {
    const created = createGame(CONFIG);
    const built = buildLandHoBoardV0(created.rng);
    const seeded = seedExplorationV0(built.rng, built);

    const seaHexes = built.seaMap
      .map((t, i) => ({ t, i: i as HexId }))
      .filter(({ t }) => t === 'sea')
      .map(({ i }) => i);
    expect(seeded.unexplored.slice().sort((a, b) => a - b)).toEqual(seaHexes.slice().sort((a, b) => a - b));
    expect(seeded.explorationSupply).toHaveLength(EP_EXPLORATION_TILES.length);
    // A shuffled PERMUTATION of the named multiset (same elements, order not required to match).
    expect([...seeded.explorationSupply].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual(
      [...EP_EXPLORATION_TILES].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    );
  });

  it('is deterministic in the threaded rng (no Math.random)', () => {
    const a = seedExplorationV0(12345, { seaMap: buildLandHoBoardV0(12345).seaMap });
    const b = seedExplorationV0(12345, { seaMap: buildLandHoBoardV0(12345).seaMap });
    expect(a.explorationSupply).toEqual(b.explorationSupply);
    expect(a.unexplored).toEqual(b.unexplored);
  });

  it('throws (BUG:) when the board sea-hex count does not match EP_EXPLORATION_TILES', () => {
    const tinySeaMap: ScenarioTerrain[] = ['sea', 'sea', 'sea'];
    expect(() => seedExplorationV0(1, { seaMap: tinySeaMap })).toThrow(/BUG:/);
  });
});

describe('seedExplorationV0 with the 5–6 tile table (T-1150, Phase 11B)', () => {
  it('EP_EXPLORATION_TILES_56 has 18 entries (matches buildLandHoBoard56s open-sea-ring hex count)', () => {
    expect(EP_EXPLORATION_TILES_56).toHaveLength(18);
    const built = buildLandHoBoard56(12345);
    const seaHexes = built.seaMap.filter((t) => t === 'sea').length;
    expect(seaHexes).toBe(EP_EXPLORATION_TILES_56.length);
  });

  it('seeds every 5–6 fog hex + shuffles EP_EXPLORATION_TILES_56 into the supply when passed explicitly', () => {
    const built = buildLandHoBoard56(12345);
    const seeded = seedExplorationV0(built.rng, built, EP_EXPLORATION_TILES_56);
    expect(seeded.explorationSupply).toHaveLength(EP_EXPLORATION_TILES_56.length);
    expect(seeded.unexplored).toHaveLength(EP_EXPLORATION_TILES_56.length);
    expect([...seeded.explorationSupply].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))).toEqual(
      [...EP_EXPLORATION_TILES_56].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    );
  });

  it('the default (no 3rd arg) still uses EP_EXPLORATION_TILES, unaffected by the new param (RK-13)', () => {
    const built = buildLandHoBoardV0(12345);
    const seeded = seedExplorationV0(built.rng, built);
    expect(seeded.explorationSupply).toHaveLength(EP_EXPLORATION_TILES.length);
  });

  it('throws (BUG:) if EP_EXPLORATION_TILES_56 is passed against a 3–4 (12-fog-hex) board', () => {
    const built = buildLandHoBoardV0(12345);
    expect(() => seedExplorationV0(built.rng, built, EP_EXPLORATION_TILES_56)).toThrow(/BUG:/);
  });
});

describe('revealOnArrival / moveEPShip reveal trigger (EP5.1)', () => {
  it('reveals every still-unexplored hex bordering the destination edge, draws from the front of the supply, and updates board+seaMap', () => {
    const { state, seaEdges, shipEdge } = craftWithShip();
    const to = seaEdges[1]!;
    const before = epExt(state)!;
    const geomEdge = GEOMETRY.edges[to]!;
    const expectedHexes = geomEdge.hexes.filter((h) => (before.unexplored ?? []).includes(h));
    expect(expectedHexes.length).toBeGreaterThan(0); // sanity: every sea edge borders >=1 fog hex pre-reveal

    const expectedDraws = before.explorationSupply!.slice(0, expectedHexes.length);

    const result = moveEPShipHandler(state, 0, { type: 'moveEPShip', from: shipEdge, to });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events).toEqual([
      { type: 'epShipMoved', seat: 0, from: shipEdge, to },
      ...expectedHexes.map((hex, i) => ({ type: 'epTileRevealed', seat: 0, hex, tile: expectedDraws[i] })),
    ]);

    const after = epExt(result.state)!;
    expect(after.unexplored).toEqual((before.unexplored ?? []).filter((h) => !expectedHexes.includes(h)));
    expect(after.explorationSupply).toEqual(before.explorationSupply!.slice(expectedHexes.length));

    expectedHexes.forEach((hex, i) => {
      const tile = expectedDraws[i]!;
      if (tile.kind === 'terrain') {
        expect(result.state.board.hexes[hex]).toEqual({ terrain: tile.terrain, token: tile.token });
        expect(after.seaMap![hex]).toBe(tile.terrain);
      } else if (tile.kind === 'gold') {
        expect(result.state.board.hexes[hex]).toEqual({ terrain: 'desert', token: null });
        expect(after.seaMap![hex]).toBe('gold');
      } else if (tile.kind === 'pirate') {
        // T-1105 (§EP7.2): a pirate reveal is now a gold field WITH a lair — same seaMap write as a
        // plain 'gold' reveal, plus a fresh active pirateLairs entry (exploration.ts's own update).
        expect(result.state.board.hexes[hex]).toEqual({ terrain: 'desert', token: null });
        expect(after.seaMap![hex]).toBe('gold');
        expect(after.pirateLairs ?? []).toContainEqual({ hex, crews: [] });
      } else {
        // nothing: no board/seaMap change — still the sea proxy.
        expect(result.state.board.hexes[hex]).toEqual({ terrain: 'desert', token: null });
        expect(after.seaMap![hex]).toBe('sea');
      }
    });
  });

  it('is a no-op when the destination edge borders no unexplored hex (already fully revealed there)', () => {
    const { state, seaEdges, shipEdge } = craftWithShip();
    const to = seaEdges[1]!;
    const ext = epExt(state)!;
    const geomEdge = GEOMETRY.edges[to]!;
    // Pre-reveal both of the destination's bordering hexes (simulate "already explored").
    const preRevealed = withEpExt(state, {
      ...ext,
      unexplored: (ext.unexplored ?? []).filter((h) => !geomEdge.hexes.includes(h)),
    });

    const result = moveEPShipHandler(preRevealed, 0, { type: 'moveEPShip', from: shipEdge, to });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events).toEqual([{ type: 'epShipMoved', seat: 0, from: shipEdge, to }]);
    expect(epExt(result.state)!.explorationSupply).toEqual(ext.explorationSupply);
  });

  it('revealOnArrival is a no-op outside a live E&P game', () => {
    const { state } = craftWithShip();
    const baseState = { ...state, ext: undefined };
    const result = revealOnArrival(baseState, 0, state.ext!.explorersPirates!.ships![0]!.edge);
    expect(result).toEqual({ state: baseState, events: [] });
  });
});

describe('fog redaction (T-1103, §EP12.4 — the cheat-proof boundary)', () => {
  it('OMITS explorationSupply entirely and unconditionally fogs board.hexes/seaMap for every unexplored hex, for every viewer', () => {
    const { state } = craft();
    const ext = epExt(state)!;
    const fogHex = ext.unexplored![0]!;
    const revealedHex = state.board.hexes.findIndex((_, i) => !(ext.unexplored ?? []).includes(i as HexId));
    expect(revealedHex).toBeGreaterThanOrEqual(0); // sanity: the home island has real revealed hexes

    // Simulate an adversarial/future data shape: the real content is already sitting in board.hexes/
    // seaMap at the fog hex (this v1 seedExplorationV0 never does this itself — see exploration.ts's
    // header — but redact.ts must not trust that and must strip it unconditionally regardless).
    const leaked: GameState = {
      ...state,
      board: {
        ...state.board,
        hexes: state.board.hexes.map((h, i) => (i === fogHex ? { terrain: 'mountains' as const, token: 8 } : h)),
      },
      ext: {
        ...state.ext,
        explorersPirates: {
          ...ext,
          seaMap: (ext.seaMap ?? []).map((t, i) => (i === fogHex ? 'gold' : t)),
        },
      },
    };

    for (const viewer of [0, 1, 2, 3] as const) {
      const view = redact(leaked, viewer);
      const epView = view.ext?.explorersPirates;
      expect(epView).toBeDefined();
      expect(Object.keys(epView ?? {})).not.toContain('explorationSupply');
      expect((epView as { explorationSupply?: unknown } | undefined)?.explorationSupply).toBeUndefined();

      // The fog hex's real (leaked) content must be stripped to the neutral placeholder — OMITTED,
      // not masked — regardless of what was actually sitting in the underlying state.
      expect(view.board.hexes[fogHex]).toEqual({ terrain: 'desert', token: null });
      expect(epView!.seaMap[fogHex]).toBe('sea');

      // `unexplored` itself is PUBLIC (which hexes are fog is not secret).
      expect(epView!.unexplored).toEqual(ext.unexplored);

      // A revealed (non-fog) hex's real content rides through unchanged.
      expect(view.board.hexes[revealedHex]).toEqual(state.board.hexes[revealedHex]);
      expect(epView!.seaMap[revealedHex]).toBe(ext.seaMap![revealedHex]);
    }
  });

  it('lets a revealed hex\'s real terrain through once moveEPShip has revealed it', () => {
    const { state, seaEdges, shipEdge } = craftWithShip();
    const to = seaEdges[1]!;
    const result = moveEPShipHandler(state, 0, { type: 'moveEPShip', from: shipEdge, to });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const revealedEvent = result.events.find((e) => e.type === 'epTileRevealed');
    expect(revealedEvent).toBeDefined();
    if (!revealedEvent || revealedEvent.type !== 'epTileRevealed') return;
    const hex = revealedEvent.hex;

    const view = redact(result.state, 1); // an opponent, not the acting seat
    expect(view.ext?.explorersPirates?.unexplored).not.toContain(hex);
    expect(view.board.hexes[hex]).toEqual(result.state.board.hexes[hex]);
    expect(view.ext?.explorersPirates?.seaMap[hex]).toBe(epExt(result.state)!.seaMap![hex]);
  });

  it('is absent for a base (non-E&P) game (no ext at all)', () => {
    const created = createGame(CONFIG);
    const view = redact(created, 0);
    expect(view.ext?.explorersPirates).toBeUndefined();
  });
});

// T-1153 (Phase 11B, M11B gate): the SAME cheat-proof fog boundary, re-proven on the bigger 5–6 frame
// (`buildLandHoBoard56`, 37 hexes: 19-hex home island / 18-hex fog ring, vs the 3–4 board's 19/12) —
// via `createGame` itself (not a hand-crafted state), since T-1150 wired `fiveSix` E&P configs to
// `buildLandHoBoard56`/`EP_EXPLORATION_TILES_56` there directly (see createGame.ts's own T-1150 note).
// A bug in this boundary at 5–6 would leak the (bigger) map to the client — same severity as the 3–4
// suite above, just proven again against the larger fog ring/board shape.
describe('fog redaction at 5–6 (T-1153, Phase 11B — same cheat-proof boundary, bigger board)', () => {
  function craft56(playerCount: 5 | 6): GameState {
    const config: GameConfig = {
      playerCount,
      targetVp: 10,
      seed: `ep-fog-56-${playerCount}`,
      board: 'random',
      tokenMethod: 'spiral',
      expansions: {
        fiveSix: true,
        seafarers: false,
        citiesKnights: false,
        explorersPirates: { scenario: 'landHo' },
      },
    };
    return createGame(config);
  }

  it.each([5, 6] as const)(
    'OMITS explorationSupply and fogs every hex of the 18-hex fog ring on the 37-hex 5–6 board (pc%i), for every viewer',
    (playerCount) => {
      const state = craft56(playerCount);
      const ext = epExt(state)!;
      // Sanity: this really is the BIGGER 5–6 frame, not the 3–4 board (19 hexes total, 12-hex ring).
      expect(state.board.hexes).toHaveLength(37);
      expect(ext.unexplored).toHaveLength(18);

      const revealedHex = state.board.hexes.findIndex((_, i) => !(ext.unexplored ?? []).includes(i as HexId));
      expect(revealedHex).toBeGreaterThanOrEqual(0); // sanity: the home island has real revealed hexes

      // Same adversarial-leak simulation as the 3–4 test above: pretend the real content already sits
      // in board.hexes/seaMap at EVERY fog hex — redact.ts must strip ALL of them unconditionally,
      // regardless of how many there are.
      const fogSet = new Set(ext.unexplored ?? []);
      const leaked: GameState = {
        ...state,
        board: {
          ...state.board,
          hexes: state.board.hexes.map((h, i) => (fogSet.has(i as HexId) ? { terrain: 'mountains' as const, token: 8 } : h)),
        },
        ext: {
          ...state.ext,
          explorersPirates: {
            ...ext,
            seaMap: (ext.seaMap ?? []).map((t, i) => (fogSet.has(i as HexId) ? 'gold' : t)),
          },
        },
      };

      for (let viewer = 0; viewer < playerCount; viewer++) {
        const view = redact(leaked, viewer as Seat);
        const epView = view.ext?.explorersPirates;
        expect(epView).toBeDefined();
        expect(Object.keys(epView ?? {})).not.toContain('explorationSupply');
        expect((epView as { explorationSupply?: unknown } | undefined)?.explorationSupply).toBeUndefined();

        // EVERY one of the 18 fog hexes must be stripped, not just a sample.
        for (const fogHex of ext.unexplored ?? []) {
          expect(view.board.hexes[fogHex]).toEqual({ terrain: 'desert', token: null });
          expect(epView!.seaMap[fogHex]).toBe('sea');
        }

        // `unexplored` itself is PUBLIC (which hexes are fog is not secret).
        expect(epView!.unexplored).toEqual(ext.unexplored);

        // A revealed (non-fog) hex's real content rides through unchanged.
        expect(view.board.hexes[revealedHex]).toEqual(state.board.hexes[revealedHex]);
        expect(epView!.seaMap[revealedHex]).toBe(ext.seaMap![revealedHex]);
      }
    }
  );

  it('reveal-on-arrival still works at 5–6: a newly revealed hex rides through real, the REST of the 18-hex ring stays fogged', () => {
    const state = craft56(5);
    const ext = epExt(state)!;
    const { vertex, seaEdges } = findCoastalVertex(ext.seaMap ?? []);
    const players = state.players.map((p) =>
      p.seat === 0 ? { ...p, settlements: [vertex], resources: { ...FULL_HAND } } : p
    );
    const ready: GameState = {
      ...state,
      players,
      phase: { kind: 'main' },
      turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    };

    const shipEdge = seaEdges[0]!;
    const built = buildEPShipHandler(ready, 0, { type: 'buildEPShip', edge: shipEdge });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const builtExt = epExt(built.state)!;
    const readyToMove = withEpExt(built.state, { ...builtExt, shipsBuiltThisTurn: [] });

    const to = seaEdges[1]!;
    const result = moveEPShipHandler(readyToMove, 0, { type: 'moveEPShip', from: shipEdge, to });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const revealedEvent = result.events.find((e) => e.type === 'epTileRevealed');
    expect(revealedEvent).toBeDefined();
    if (!revealedEvent || revealedEvent.type !== 'epTileRevealed') return;
    const hex = revealedEvent.hex;

    const view = redact(result.state, 1); // an opponent, not the acting seat
    expect(view.ext?.explorersPirates?.unexplored).not.toContain(hex);
    expect(view.board.hexes[hex]).toEqual(result.state.board.hexes[hex]);
    expect(view.ext?.explorersPirates?.seaMap[hex]).toBe(epExt(result.state)!.seaMap![hex]);

    // The load-bearing part at the bigger 5–6 ring: a single reveal must not accidentally un-fog the
    // REST of the 18-hex ring for that same viewer.
    const stillFog = epExt(result.state)!.unexplored ?? [];
    expect(stillFog.length).toBeGreaterThan(0); // sanity: one ship move doesn't reveal the whole ring
    for (const fogHex of stillFog) {
      expect(view.board.hexes[fogHex]).toEqual({ terrain: 'desert', token: null });
      expect(view.ext?.explorersPirates?.seaMap[fogHex]).toBe('sea');
    }
  });
});
