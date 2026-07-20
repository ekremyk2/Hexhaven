// T-802: end-to-end wiring smoke tests over the PUBLIC `reduce`/`createGame` surface — proves the
// module is actually routed (interceptAction, phaseHooks.afterAction, resolveModules/createGame),
// not just that the pure helpers in commodities.ts/improvements.ts are individually correct
// (covered by commodities.test.ts/improvements.test.ts). A deterministic settlement -> city ->
// roll-production -> improvement -> metropolis path, per the task's "lightweight scripted smoke"
// requirement (full MCTS sim is T-807).

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { GameState, HexId, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { rollDie } from '../../rng.js';
import { computeVp } from '../../vp.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10, // deliberately NOT 13 — createGame must override it for a C&K game (C1.1)
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: true as const },
};

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as number;

/** Smallest rng seed whose first two dice sum to `total`. */
function rngForTotal(total: number): number {
  for (let r = 1; r < 200000; r++) {
    const a = rollDie(r);
    const b = rollDie(a.state);
    if (a.value + b.value === total) return r;
  }
  throw new Error(`BUG: no rng found for total ${total}`);
}

describe('createGame with citiesKnights: true (T-802)', () => {
  it('creates a game, resolving targetVp to 13 (C1.1) regardless of the config value', () => {
    const g = createGame({ ...CONFIG, seed: 'ck-smoke' });
    expect(g.config.targetVp).toBe(13);
  });

  it('seeds a zeroed ext.citiesKnights (C2.2/C12)', () => {
    const g = createGame({ ...CONFIG, seed: 'ck-smoke-2' });
    const ck = g.ext?.citiesKnights;
    expect(ck).toBeDefined();
    expect(ck!.commodities).toEqual([
      { paper: 0, cloth: 0, coin: 0 },
      { paper: 0, cloth: 0, coin: 0 },
      { paper: 0, cloth: 0, coin: 0 },
      { paper: 0, cloth: 0, coin: 0 },
    ]);
    expect(ck!.metropolis).toEqual({ trade: null, politics: null, science: null });
    expect(ck!.robberLocked).toBe(true);
  });

  it('a base game (citiesKnights: false) is unaffected — no ext.citiesKnights, targetVp stays 10', () => {
    const g = createGame({ ...CONFIG, expansions: { ...CONFIG.expansions, citiesKnights: false }, seed: 'base' });
    expect(g.config.targetVp).toBe(10);
    expect(g.ext?.citiesKnights).toBeUndefined();
  });
});

describe('settlement -> city -> production -> improvement -> metropolis (T-802 smoke)', () => {
  it('runs the full path through the public reduce()/createGame surface', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-path' });

    // Blank the board to all-desert, then place a single forest hex (token 8) plus a mountains hex
    // (token 6) so both a science (paper) and a politics/knight-style (coin) commodity are
    // reachable from seat 0's one city.
    const hexes = created.board.hexes.map(() => ({ terrain: 'desert' as TerrainType, token: null as number | null }));
    hexes[0] = { terrain: 'forest', token: 8 };
    hexes[9] = { terrain: 'mountains', token: 6 };

    const settlementVertex = vtx(0, 0);
    const players = created.players.map((p) =>
      p.seat === 0
        ? {
            ...p,
            settlements: [settlementVertex as VertexId],
            resources: { brick: 0, lumber: 0, wool: 1, grain: 2, ore: 3 }, // exactly COSTS.city
          }
        : p
    );

    let state: GameState = {
      ...created,
      board: { ...created.board, hexes, robber: 18 as HexId },
      players,
      bank: { brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 },
      phase: { kind: 'main' },
      turn: { number: 5, player: 0, rolled: true, roll: [4, 2], devPlayed: false },
    };

    // 1) Upgrade the settlement to a city via the ordinary base action (buildCity is unowned by
    //    the module — falls through interceptAction's `default: null` to the base main handler).
    const cityRes = reduce(state, 0, { type: 'buildCity', vertex: settlementVertex as VertexId });
    expect(cityRes.ok).toBe(true);
    if (!cityRes.ok) return;
    state = cityRes.state;
    expect(state.players[0]!.cities).toEqual([settlementVertex]);

    // 2) Roll to force total 8: the city on forest yields 1 lumber + 1 paper (C3.3), not the base 2
    //    lumber — proves the afterAction production hook is actually wired through `reduce`.
    state = { ...state, phase: { kind: 'preRoll' }, turn: { ...state.turn, rolled: false, roll: null }, rng: rngForTotal(8) };
    const rollRes = reduce(state, 0, { type: 'rollDice' });
    expect(rollRes.ok).toBe(true);
    if (!rollRes.ok) return;
    state = rollRes.state;

    expect(state.players[0]!.resources.lumber).toBe(1); // not 2 — C3.3
    expect(state.ext!.citiesKnights!.commodities[0]!.paper).toBe(1);
    expect(rollRes.events.some((e) => e.type === 'commodityProduction')).toBe(true);
    const productionEvent = rollRes.events.find((e) => e.type === 'production');
    expect(productionEvent).toBeDefined();
    if (productionEvent && productionEvent.type === 'production') {
      expect(productionEvent.gains.find((g) => g.seat === 0)?.resources.lumber).toBe(1);
    }

    // 3) Spend the paper on Science level 1 via the NEW buildImprovement action (interceptAction).
    const buildRes = reduce(state, 0, { type: 'buildImprovement', track: 'science' });
    expect(buildRes.ok).toBe(true);
    if (!buildRes.ok) return;
    state = buildRes.state;
    expect(state.ext!.citiesKnights!.improvements[0]!.science).toBe(1);
    expect(state.ext!.citiesKnights!.commodities[0]!.paper).toBe(0);

    // 4) Hand-grant enough paper to jump straight to level 4 (Science) and confirm the metropolis
    //    places (C4.6) and feeds computeVp (+2 beyond the city's own 2 -> 4 VP total, C1.3).
    state = {
      ...state,
      ext: {
        ...state.ext,
        citiesKnights: {
          ...state.ext!.citiesKnights!,
          commodities: state.ext!.citiesKnights!.commodities.map((c, i) => (i === 0 ? { ...c, paper: 6 } : c)),
          improvements: state.ext!.citiesKnights!.improvements.map((imp, i) => (i === 0 ? { ...imp, science: 3 } : imp)),
        },
      },
    };
    const metroRes = reduce(state, 0, { type: 'buildImprovement', track: 'science' });
    expect(metroRes.ok).toBe(true);
    if (!metroRes.ok) return;
    state = metroRes.state;
    expect(state.ext!.citiesKnights!.metropolis.science).toBe(0);
    expect(metroRes.events.some((e) => e.type === 'metropolisPlaced')).toBe(true);
    expect(computeVp(state, 0).total).toBe(4); // 1 city (2) + metropolis (+2)
  });
});
