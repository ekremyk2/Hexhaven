// T-756: The Fog Islands — fog reveal mechanic + redaction. Mirrors T-1103's
// `explorersPirates/exploration.test.ts` in SHAPE only (no shared code, the two expansions stay
// separate, docs/10 §3): `seedScenarioFog`'s init shape (deterministic, RK-13-adjacent — absent for
// every other scenario), the reveal-on-build/-move trigger folded into the seafarers module's
// EXISTING `afterAction` hook (index.ts, NO new action/event), and the fog REDACTION boundary
// (cheat-proof: `ext.seafarers.fog.stack` never appears in any view, a still-hidden hex's real
// content is unconditionally stripped even if a future scenario pre-stores it, and a revealed hex's
// real content rides through).

import { describe, expect, it } from 'vitest';
import type { BoardGeometry, EdgeId, GameConfig, GameState, HexId, Seat } from '@hexhaven/shared';
import { getScenario } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { redact } from '../../redact.js';
import { scenarioGeometryFor, seedScenarioFog } from './board.js';
import { revealFogAt } from './fog.js';
import { seafarersExt, withSeafarersExt } from './state.js';

function fogConfig(playerCount: 5 | 6, seed: string): GameConfig {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    seed,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario: 'fogIslands' }, citiesKnights: false },
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

const FULL_HAND = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };

/** Find an edge bordering at least one still-fog hex, plus a second ("anchor") edge sharing one of
 *  its endpoints that does NOT itself border a fog hex — a legal ship-placement chain (S4.2's
 *  "adjacent to your own ship" connectivity) for a crafted state that places the anchor ship there. */
function findFogEdgeWithAnchor(
  geometry: BoardGeometry,
  fogHidden: ReadonlySet<HexId>
): { to: EdgeId; anchor: EdgeId } {
  for (const e of geometry.edges) {
    if (!e.hexes.some((h) => fogHidden.has(h))) continue;
    for (const v of [e.a, e.b]) {
      const anchor = geometry.vertices[v]!.edges.find(
        (e2) => e2 !== e.id && !geometry.edges[e2]!.hexes.some((h) => fogHidden.has(h))
      );
      if (anchor !== undefined) return { to: e.id, anchor };
    }
  }
  throw new Error('BUG: no fog-bordering edge with a legal anchor found on the test board');
}

/** Every hex id, minus `avoid` — a safe spot to park the pirate so it never blocks the crafted
 *  ship-placement edges (S8.5) in a test that isn't exercising the pirate at all. */
function safePirateHex(geometry: BoardGeometry, avoid: ReadonlySet<HexId>): HexId {
  const hex = geometry.hexes.find((h) => !avoid.has(h.id));
  if (!hex) throw new Error('BUG: no safe pirate hex found on the test board');
  return hex.id;
}

/** True iff `edge` borders at least one still-fog hex. */
function bordersFog(geometry: BoardGeometry, fogHidden: ReadonlySet<HexId>, edge: EdgeId): boolean {
  return geometry.edges[edge]!.hexes.some((h) => fogHidden.has(h));
}
/** True iff `edge` is a valid SHIP edge that borders NO fog hex — i.e. it borders a real sea hex and
 *  stays a legal ship edge no matter what any fog reveals to (used to place the move-test's anchor +
 *  mover so they never depend on a fog hex; the isolated-fog constraint guarantees such edges exist
 *  all around every fog cell). */
function nonFogSeaEdge(
  geometry: BoardGeometry,
  hexTerrain: readonly (string | undefined)[],
  fogHidden: ReadonlySet<HexId>,
  edge: EdgeId
): boolean {
  if (bordersFog(geometry, fogHidden, edge)) return false;
  return geometry.edges[edge]!.hexes.some((h) => hexTerrain[h] === 'sea');
}

/**
 * Find a `moveShip`-reveal setup on the shipped fog board: a fog-bordering destination `to`, an
 * `anchor` (a non-fog sea edge sharing a vertex V with `to` — it STAYS put and keeps `to` connected,
 * S7.1c), and a `mover` (a non-fog sea edge at `anchor`'s OTHER vertex V' — the ship we relocate onto
 * `to`; open-ended because nothing else of seat 0's sits at its far end). Robust for isolated fog:
 * every fog cell is ringed by real sea, so a fog edge always has non-fog sea edges around its
 * vertices. Replaces the old `findFogVertexTriple`, whose "1 fog + 2 non-fog edges AT ONE vertex"
 * criterion is geometrically impossible (a fog hex at a vertex contributes exactly 0 or 2 fog edges
 * there, never 1).
 */
function findFogMoveSetup(
  geometry: BoardGeometry,
  hexTerrain: readonly (string | undefined)[],
  fogHidden: ReadonlySet<HexId>
): { to: EdgeId; anchor: EdgeId; mover: EdgeId } {
  const otherEndOf = (edge: EdgeId, v: number): number => {
    const e = geometry.edges[edge]!;
    return e.a === v ? e.b : e.a;
  };
  for (const e of geometry.edges) {
    if (!bordersFog(geometry, fogHidden, e.id)) continue; // e = the fog-bordering destination `to`
    for (const v of [e.a, e.b]) {
      for (const anchor of geometry.vertices[v]!.edges) {
        if (anchor === e.id || !nonFogSeaEdge(geometry, hexTerrain, fogHidden, anchor)) continue;
        const v2 = otherEndOf(anchor, v);
        for (const mover of geometry.vertices[v2]!.edges) {
          if (mover === anchor || mover === e.id) continue;
          if (!nonFogSeaEdge(geometry, hexTerrain, fogHidden, mover)) continue;
          return { to: e.id, anchor, mover };
        }
      }
    }
  }
  throw new Error('BUG: no fog-bordering edge with a non-fog anchor+mover found on the test board');
}

/** Craft a Fog Islands game with seat 0 holding TWO ships — `anchor` (fixed, keeps `to` connected)
 *  and `mover` (open-ended, relocated onto the fog-bordering edge `to`) — the minimal legal setup for
 *  a `moveShip` reveal test (see `findFogMoveSetup`). */
function craftForMove(playerCount: 5 | 6 = 6, seed = 'fog-islands-move-craft') {
  const created = createGame(fogConfig(playerCount, seed));
  const geometry = scenarioGeometryFor(created.config)!;
  const ext = seafarersExt(created)!;
  const fogHidden = new Set(ext.fog!.hidden);
  const { to, anchor, mover } = findFogMoveSetup(geometry, ext.hexTerrain, fogHidden);
  const avoid = new Set([
    ...geometry.edges[to]!.hexes,
    ...geometry.edges[anchor]!.hexes,
    ...geometry.edges[mover]!.hexes,
  ]);
  const pirate = safePirateHex(geometry, avoid);

  const players = created.players.map((p) => (p.seat === 0 ? { ...p, resources: { ...FULL_HAND } } : p));
  const state: GameState = withSeafarersExt(
    {
      ...created,
      players,
      phase: { kind: 'main' },
      turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    },
    { ...ext, pirate, ships: ext.ships.map((list, s) => (s === 0 ? [anchor, mover] : list)) }
  );
  return { state, to, anchor, mover };
}

/** Craft a Fog Islands game (via `createGame`, not a bespoke test board — the shipped scenario data
 *  IS the thing under test) with seat 0 holding a full hand, an anchor ship placed one hop short of
 *  a fog-bordering edge, and the pirate parked safely away from both edges. */
function craft(playerCount: 5 | 6 = 6, seed = 'fog-islands-craft') {
  const created = createGame(fogConfig(playerCount, seed));
  const geometry = scenarioGeometryFor(created.config)!;
  const ext = seafarersExt(created)!;
  const fog = ext.fog!;
  const fogHidden = new Set(fog.hidden);
  const { to, anchor } = findFogEdgeWithAnchor(geometry, fogHidden);
  const avoid = new Set([...geometry.edges[to]!.hexes, ...geometry.edges[anchor]!.hexes]);
  const pirate = safePirateHex(geometry, avoid);

  const players = created.players.map((p) => (p.seat === 0 ? { ...p, resources: { ...FULL_HAND } } : p));
  const state: GameState = withSeafarersExt(
    {
      ...created,
      players,
      phase: { kind: 'main' },
      turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    },
    { ...ext, pirate, ships: ext.ships.map((list, s) => (s === 0 ? [anchor] : list)) }
  );
  return { state, to, anchor, geometry };
}

describe('seedScenarioFog (T-756 init helper)', () => {
  it('resolves fog.cells to HexIds and shuffles fog.tiles into the stack (same multiset, permuted)', () => {
    const created = createGame(fogConfig(6, 'fog-seed-a'));
    const ext = seafarersExt(created)!;
    expect(ext.fog).toBeDefined();
    const fog = ext.fog!;
    expect(fog.hidden.length).toBeGreaterThan(0);
    expect(fog.stack).toHaveLength(fog.hidden.length);
    // A shuffled PERMUTATION of the scenario's fog tile multiset (order not required to match).
    const sortKey = (t: { terrain: string; token: number | null }) => `${t.terrain}:${t.token}`;
    const board = scenarioGeometryFor(created.config); // sanity the geometry resolves at all
    expect(board).toBeDefined();
    const scenarioTiles = fogTilesOf(created.config);
    expect([...fog.stack].map(sortKey).sort()).toEqual([...scenarioTiles].map(sortKey).sort());
  });

  it('is deterministic in the threaded rng (same seed -> same hidden set + same stack order)', () => {
    const a = createGame(fogConfig(6, 'fog-seed-determinism'));
    const b = createGame(fogConfig(6, 'fog-seed-determinism'));
    expect(seafarersExt(a)!.fog).toEqual(seafarersExt(b)!.fog);
  });

  it('is absent (null-equivalent) for every other seafarers scenario', () => {
    const created = createGame({
      playerCount: 4,
      targetVp: 14,
      seed: 'not-fog-islands',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
    });
    expect(seafarersExt(created)!.fog).toBeUndefined();
    expect(seedScenarioFog(created.rng, created.config)).toBeNull();
  });
});

// Pull the scenario's raw fog tile multiset via the shipped `@hexhaven/shared` data, for the multiset
// cross-check above — avoids hand-duplicating scenario.ts's own numbers in this test file.
function fogTilesOf(config: Pick<GameConfig, 'expansions' | 'playerCount'>) {
  const id = config.expansions.seafarers === false ? null : config.expansions.seafarers.scenario;
  if (id !== 'fogIslands') throw new Error('BUG: fogTilesOf called for a non-Fog-Islands config');
  const scenario = getScenario('fogIslands')!;
  const board = scenario.boards[config.playerCount as 5 | 6]!;
  return board.fog!.tiles;
}

describe('revealFogAt (T-756 reveal trigger)', () => {
  it('reveals every still-fog hex bordering the edge, pops the stack front, and updates board+hexTerrain', () => {
    const { state, to } = craft();
    const before = seafarersExt(state)!;
    const geometry = scenarioGeometryFor(state.config)!;
    const geomEdge = geometry.edges[to]!;
    const expectedHexes = geomEdge.hexes.filter((h) => before.fog!.hidden.includes(h));
    expect(expectedHexes.length).toBeGreaterThan(0); // sanity: the chosen edge really borders fog

    const expectedTiles = before.fog!.stack.slice(0, expectedHexes.length);
    const next = revealFogAt(state, to);
    expect(next).not.toBe(state); // a real change, not the no-op reference-equal path

    const after = seafarersExt(next)!;
    expect(after.fog!.hidden).toEqual(before.fog!.hidden.filter((h) => !expectedHexes.includes(h)));
    expect(after.fog!.stack).toEqual(before.fog!.stack.slice(expectedHexes.length));

    expectedHexes.forEach((hex, i) => {
      const tile = expectedTiles[i]!;
      expect(after.hexTerrain[hex]).toBe(tile.terrain);
      if (tile.terrain === 'gold') {
        expect(next.board.hexes[hex]).toEqual({ terrain: 'desert', token: tile.token });
      } else {
        expect(next.board.hexes[hex]).toEqual({ terrain: tile.terrain, token: tile.token });
      }
    });
  });

  it('a second reveal (a different edge) pops the NEXT stack entries, not the same ones again', () => {
    const { state, to } = craft();
    const beforeFirst = seafarersExt(state)!.fog!;
    const first = revealFogAt(state, to);
    const afterFirst = seafarersExt(first)!.fog!;
    const firstDrawCount = beforeFirst.hidden.length - afterFirst.hidden.length;
    expect(firstDrawCount).toBeGreaterThan(0);
    // The reveal advanced the stack — what's left is exactly the ORIGINAL stack minus its front.
    expect(afterFirst.stack).toEqual(beforeFirst.stack.slice(firstDrawCount));

    const geometry = scenarioGeometryFor(state.config)!;
    const { to: to2 } = findFogEdgeWithAnchor(geometry, new Set(afterFirst.hidden));
    expect(to2).not.toBe(to);

    const second = revealFogAt(first, to2);
    const afterSecond = seafarersExt(second)!.fog!;
    const secondDrawCount = afterFirst.hidden.length - afterSecond.hidden.length;
    expect(secondDrawCount).toBeGreaterThan(0);

    // The second reveal continued from where the first left off — it never re-draws the tile(s) the
    // first reveal already consumed.
    expect(afterSecond.stack).toEqual(afterFirst.stack.slice(secondDrawCount));
    expect(afterFirst.stack.slice(0, secondDrawCount)).not.toEqual(beforeFirst.stack.slice(0, secondDrawCount));
  });

  it('is deterministic: replaying the identical seed + identical reveal edge yields the identical tile', () => {
    const a = craft(6, 'fog-reveal-determinism');
    const b = craft(6, 'fog-reveal-determinism');
    expect(a.to).toBe(b.to);
    const revealedA = revealFogAt(a.state, a.to);
    const revealedB = revealFogAt(b.state, b.to);
    expect(seafarersExt(revealedA)!.fog).toEqual(seafarersExt(revealedB)!.fog);
    expect(revealedA.board.hexes).toEqual(revealedB.board.hexes);
  });

  it('is a no-op when the edge borders no still-fog hex', () => {
    const { state, anchor } = craft();
    const result = revealFogAt(state, anchor); // the anchor edge was chosen to NOT border fog
    expect(result).toBe(state);
  });

  it('is a no-op once every fog hex bordering the edge is already revealed', () => {
    const { state, to } = craft();
    const onceRevealed = revealFogAt(state, to);
    const twice = revealFogAt(onceRevealed, to);
    expect(twice).toBe(onceRevealed);
  });

  it('is a no-op outside a live seafarers/Fog-Islands game', () => {
    const { state, to } = craft();
    const baseState = { ...state, ext: undefined };
    expect(revealFogAt(baseState, to)).toBe(baseState);
  });
});

describe('reveal wired through buildShip/moveShip — NO new action/event (T-756 hard constraint)', () => {
  it('buildShip on a fog-bordering edge reveals the hex as a side effect, with NO extra event beyond shipBuilt', () => {
    const { state, to } = craft();
    const before = seafarersExt(state)!;
    const result = reduce(state, 0, { type: 'buildShip', edge: to });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Exactly `shipBuilt` — no dedicated "tile revealed" event (a documented follow-up, not this task).
    expect(result.events.map((e) => e.type)).toEqual(['shipBuilt']);

    const after = seafarersExt(result.state)!;
    expect(after.fog!.hidden.length).toBeLessThan(before.fog!.hidden.length);
    expect(after.ships[0]).toContain(to);
  });

  it('moveShip onto a fog-bordering edge also reveals it, with NO extra event beyond shipMoved', () => {
    // `mover` (open-ended, S7.1d) relocates onto the fog-bordering edge `to`; `anchor` stays put and
    // keeps `to` connected (S7.1c) once `mover` is picked up (see `findFogMoveSetup`/`craftForMove`).
    const { state, to, mover } = craftForMove();
    const before = seafarersExt(state)!;
    const result = reduce(state, 0, { type: 'moveShip', from: mover, to });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events.map((e) => e.type)).toEqual(['shipMoved']);
    const after = seafarersExt(result.state)!;
    expect(after.fog!.hidden.length).toBeLessThan(before.fog!.hidden.length);
    expect(after.ships[0]).toContain(to);
  });
});

describe('fog redaction (T-756 — the cheat-proof boundary)', () => {
  it('OMITS fog.stack entirely and unconditionally fogs board.hexes/hexTerrain for every still-hidden hex, for every viewer', () => {
    const { state } = craft();
    const ext = seafarersExt(state)!;
    const fogHex = ext.fog!.hidden[0]!;
    const revealedHex = state.board.hexes.findIndex((_, i) => !ext.fog!.hidden.includes(i as HexId));
    expect(revealedHex).toBeGreaterThanOrEqual(0); // sanity: the starting island has real revealed hexes

    // Simulate an adversarial/future data shape: the real content already sits in board.hexes/
    // hexTerrain at the fog hex (today's `seedScenarioFog`/`revealFogAt` never do this themselves —
    // see fog.ts's header — but redact.ts must not trust that and must strip it unconditionally).
    const leaked: GameState = {
      ...state,
      board: {
        ...state.board,
        hexes: state.board.hexes.map((h, i) => (i === fogHex ? { terrain: 'mountains' as const, token: 8 } : h)),
      },
      ext: {
        ...state.ext,
        seafarers: { ...ext, hexTerrain: ext.hexTerrain.map((t, i) => (i === fogHex ? 'gold' : t)) },
      },
    };

    for (let viewer = 0; viewer < state.config.playerCount; viewer++) {
      const view = redact(leaked, viewer as Seat);
      const sfView = view.ext?.seafarers;
      expect(sfView).toBeDefined();
      expect(sfView?.fog).toBeDefined();
      expect(sfView?.fog ? Object.keys(sfView.fog) : []).not.toContain('stack');
      expect((sfView?.fog as { stack?: unknown } | undefined)?.stack).toBeUndefined();

      // The fog hex's real (leaked) content must be stripped — OMITTED, not masked.
      expect(view.board.hexes[fogHex]).toEqual({ terrain: 'desert', token: null });
      expect(sfView!.hexTerrain[fogHex]).toBe('sea');

      // `fog.hidden` itself is PUBLIC (which hexes are fog is not secret).
      expect(sfView!.fog!.hidden).toEqual(ext.fog!.hidden);

      // A revealed (non-fog) hex's real content rides through unchanged.
      expect(view.board.hexes[revealedHex]).toEqual(state.board.hexes[revealedHex]);
      expect(sfView!.hexTerrain[revealedHex]).toBe(ext.hexTerrain[revealedHex]);
    }
  });

  it("lets a revealed hex's real terrain through once buildShip has revealed it", () => {
    const { state, to } = craft();
    const result = reduce(state, 0, { type: 'buildShip', edge: to });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = seafarersExt(state)!;
    const revealedHexes = before.fog!.hidden.filter((h) => !seafarersExt(result.state)!.fog!.hidden.includes(h));
    expect(revealedHexes.length).toBeGreaterThan(0);
    const hex = revealedHexes[0]!;

    const view = redact(result.state, 1); // an opponent, not the acting seat
    expect(view.ext?.seafarers?.fog?.hidden).not.toContain(hex);
    expect(view.board.hexes[hex]).toEqual(result.state.board.hexes[hex]);
    expect(view.ext?.seafarers?.hexTerrain[hex]).toBe(seafarersExt(result.state)!.hexTerrain[hex]);
  });

  it('has no `fog` field at all for every OTHER seafarers scenario (byte-identical to before this task)', () => {
    const created = createGame({
      playerCount: 4,
      targetVp: 14,
      seed: 'redact-not-fog-islands',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
    });
    const view = redact(created, 0);
    expect(view.ext?.seafarers).toBeDefined();
    expect(view.ext?.seafarers?.fog).toBeUndefined();
  });

  it('is absent for a base (non-seafarers) game (no ext at all)', () => {
    const created = createGame({
      playerCount: 4,
      targetVp: 10,
      seed: 'redact-base',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    });
    const view = redact(created, 0);
    expect(view.ext).toBeUndefined();
  });
});
