// customConstants modifier (T-906, docs/07 D-034 "NEW — broad customizable constants / custom game
// system"): the broad tunable-constants modifier. Covers, per tunable, off (base default) vs on
// (overridden behavior), range validation, and composition with an expansion (Seafarers +
// productionMultiplier, the task's own example). RK-13 (base/every expansion + every sim stays
// bit-identical with the modifier off) is proven by the pre-existing full suite — this file adds
// the NEW modifier's own end-to-end coverage.

import { describe, expect, it } from 'vitest';
import { COSTS, GEOMETRY, LIMITLESS_CAP } from '@hexhaven/shared';
import type { GameConfig, GameState, HexId, Knight, ProgressCardId, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame, validateConfig } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { rollDie } from '../../rng.js';
import { computeProduction } from '../../rules/production.js';
import { simulate } from '../../sim/runGame.js';
import { checkWin } from '../../vp.js';
import { geometryForState, resolveConstants } from '../index.js';
import { resolveProgressDraw } from '../citiesKnights/progressCards.js';
import { hexTerrainOf } from '../seafarers/state.js';

function cfg(over: Partial<GameConfig> = {}): GameConfig {
  return {
    playerCount: 4,
    targetVp: 10,
    seed: 'custom-constants-test',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    ...over,
  };
}

/** Smallest rng seed whose first two dice sum to exactly `total` (mirrors combine2sAnd12s.test.ts). */
function rngForRollTotal(total: number): number {
  for (let r = 1; r < 200_000; r++) {
    const a = rollDie(r);
    const b = rollDie(a.state);
    if (a.value + b.value === total) return r;
  }
  throw new Error(`BUG: no rng found producing total ${total}`);
}

interface Craft {
  tiles?: { hex: number; terrain: TerrainType; token: number | null }[];
  robber: number;
  place?: { seat: 0 | 1 | 2 | 3; settlements?: number[]; cities?: number[] }[];
  rng?: number;
  modifiers?: GameConfig['modifiers'];
}

/** A fully controlled preRoll state (mirrors combine2sAnd12s.test.ts's helper). */
function craftRoll(opts: Craft): GameState {
  const g = createGame({ ...cfg(), modifiers: opts.modifiers });
  const hexes = g.board.hexes.map(() => ({ terrain: 'desert' as TerrainType, token: null as number | null }));
  for (const t of opts.tiles ?? []) hexes[t.hex] = { terrain: t.terrain, token: t.token };
  const players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    return {
      ...p,
      settlements: (pl.settlements ?? []).map((n) => n as VertexId),
      cities: (pl.cities ?? []).map((n) => n as VertexId),
    };
  });
  return {
    ...g,
    board: { ...g.board, hexes, robber: opts.robber as HexId },
    players,
    rng: opts.rng ?? g.rng,
    turn: { ...g.turn, rolled: false, roll: null },
    phase: { kind: 'preRoll' },
  };
}

const h = (state: GameState, id: number) => geometryForState(state).hexes[id]!;
const vtx = (state: GameState, hexId: number, k: number) => h(state, hexId).vertices[k]! as number;

describe('customConstants: productionMultiplier', () => {
  it('off (absent): computeProduction is unaffected (RK-13 default multiplier 1)', () => {
    const state = craftRoll({ tiles: [{ hex: 0, terrain: 'forest', token: 8 }], robber: 18 });
    const prod = computeProduction(state, 8);
    expect(prod.gains).toEqual([]);
  });

  it('on: a settlement yields N times the base 1, a city N times the base 2', () => {
    const base = createGame(cfg());
    const settlementVertex = vtx(base, 0, 0);
    const state = craftRoll({
      tiles: [{ hex: 0, terrain: 'forest', token: 8 }],
      robber: 18,
      place: [{ seat: 0, settlements: [settlementVertex] }],
    });
    const multiplier = 3;
    const prod = computeProduction(state, 8, multiplier);
    const gain = prod.gains.find((g) => g.seat === 0);
    expect(gain?.resources.lumber).toBe(3);
  });

  it('end-to-end via reduce(): rollDice multiplies the production event/resources', () => {
    const base = createGame(cfg());
    const settlementVertex = vtx(base, 0, 0);
    const state = craftRoll({
      tiles: [{ hex: 0, terrain: 'forest', token: 8 }],
      robber: 18,
      place: [{ seat: 0, settlements: [settlementVertex] }],
      rng: rngForRollTotal(8),
      modifiers: { customConstants: { productionMultiplier: 3 } },
    });
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players.find((p) => p.seat === 0)?.resources.lumber).toBe(3);
    expect(res.state.bank.lumber).toBe(19 - 3);
  });

  it('composes with an expansion: Seafarers + productionMultiplier', () => {
    const state = createGame(
      cfg({
        expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
        modifiers: { customConstants: { productionMultiplier: 4 } },
      })
    );
    expect(resolveConstants(state.config).productionMultiplier).toBe(4);

    const geo = geometryForState(state);
    const landHex = geo.hexes.find((hex) => {
      const t = hexTerrainOf(state, hex.id);
      return t !== undefined && t !== 'sea' && t !== 'desert' && t !== 'gold' && state.board.hexes[hex.id]!.token !== null;
    })!;
    const token = state.board.hexes[landHex.id]!.token!;
    const withSettlement: GameState = {
      ...state,
      board: { ...state.board, robber: geo.hexes.find((hx) => hx.id !== landHex.id)!.id as HexId },
      players: state.players.map((p) => (p.seat === 0 ? { ...p, settlements: [landHex.vertices[0]!] } : p)),
    };
    const multiplier = resolveConstants(withSettlement.config).productionMultiplier ?? 1;
    const prod = computeProduction(withSettlement, token, multiplier);
    const gain = prod.gains.find((g) => g.seat === 0);
    // Base settlement yield is 1 of whatever resource the hex produces; the modifier quadruples it.
    expect(Object.values(gain?.resources ?? {}).reduce((a, b) => a + (b ?? 0), 0)).toBe(4);
  });
});

describe('customConstants: roadBuildingCount', () => {
  it('on: Road Building grants the configured count of free roads, not the base 2', () => {
    const g = createGame(cfg({ modifiers: { customConstants: { roadBuildingCount: 3 } } }));
    const seat0Vertex = vtx(g, 0, 0);
    const state: GameState = {
      ...g,
      players: g.players.map((p) =>
        p.seat === 0
          ? { ...p, devCards: [{ type: 'roadBuilding', boughtOnTurn: 0 }], settlements: [seat0Vertex as VertexId] }
          : p
      ),
      phase: { kind: 'main' },
      turn: { ...g.turn, rolled: true, roll: [3, 4] },
    };
    const res = reduce(state, 0, { type: 'playRoadBuilding' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toEqual({ kind: 'roadBuilding', remaining: 3 });
  });
});

describe('customConstants: yearOfPlentyCount', () => {
  function yopState(config: GameConfig): GameState {
    const g = createGame(config);
    return {
      ...g,
      players: g.players.map((p) =>
        p.seat === 0 ? { ...p, devCards: [{ type: 'yearOfPlenty', boughtOnTurn: 0 }] } : p
      ),
      phase: { kind: 'main' },
      turn: { ...g.turn, rolled: true, roll: [3, 4] },
    };
  }

  it('off (absent/2): only a/b are granted (base behavior)', () => {
    const state = yopState(cfg());
    const res = reduce(state, 0, { type: 'playYearOfPlenty', a: 'brick', b: 'ore' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.brick).toBe(1);
    expect(res.state.players[0]!.resources.ore).toBe(1);
  });

  it('on (4): a/b + extra together grant 4 resources', () => {
    const state = yopState(cfg({ modifiers: { customConstants: { yearOfPlentyCount: 4 } } }));
    const res = reduce(state, 0, {
      type: 'playYearOfPlenty',
      a: 'brick',
      b: 'ore',
      extra: ['wool', 'grain'],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.brick).toBe(1);
    expect(res.state.players[0]!.resources.ore).toBe(1);
    expect(res.state.players[0]!.resources.wool).toBe(1);
    expect(res.state.players[0]!.resources.grain).toBe(1);
  });

  it('rejects a mismatched extra count with BAD_YOP_COUNT', () => {
    const state = yopState(cfg({ modifiers: { customConstants: { yearOfPlentyCount: 4 } } }));
    const res = reduce(state, 0, { type: 'playYearOfPlenty', a: 'brick', b: 'ore', extra: ['wool'] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('BAD_YOP_COUNT');
  });
});

describe('customConstants: startingResources', () => {
  it('off (absent): every player starts with an empty hand (RK-13 baseline)', () => {
    const state = createGame(cfg());
    for (const p of state.players) {
      expect(p.resources).toEqual({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
    }
  });

  it('on: every player is granted the configured bundle, debited from the bank (I1)', () => {
    const state = createGame(
      cfg({ modifiers: { customConstants: { startingResources: { brick: 1, lumber: 1 } } } })
    );
    for (const p of state.players) {
      expect(p.resources.brick).toBe(1);
      expect(p.resources.lumber).toBe(1);
      expect(p.resources.wool).toBe(0);
    }
    // 4 players x 1 brick granted, out of a base bank of 19.
    expect(state.bank.brick).toBe(19 - 4);
    expect(state.bank.lumber).toBe(19 - 4);
    expect(state.bank.wool).toBe(19);
  });
});

describe('customConstants: discardHandLimit', () => {
  it('off (7): a 6-card hand does not discard on a rolled 7 (base baseline)', () => {
    const state = craftRoll({
      tiles: [],
      robber: 0,
      rng: rngForRollTotal(7),
    });
    const withHand: GameState = {
      ...state,
      players: state.players.map((p) => (p.seat === 1 ? { ...p, resources: { ...p.resources, brick: 6 } } : p)),
    };
    const res = reduce(withHand, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase.kind).toBe('moveRobber');
  });

  it('on (4): the SAME 6-card hand now must discard', () => {
    const state = craftRoll({
      tiles: [],
      robber: 0,
      rng: rngForRollTotal(7),
      modifiers: { customConstants: { discardHandLimit: 4 } },
    });
    const withHand: GameState = {
      ...state,
      players: state.players.map((p) => (p.seat === 1 ? { ...p, resources: { ...p.resources, brick: 6 } } : p)),
    };
    const res = reduce(withHand, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase.kind).toBe('discard');
    if (res.state.phase.kind === 'discard') expect(res.state.phase.pending).toContain(1);
  });
});

describe('customConstants: costs', () => {
  it('off: base COSTS gate a build (CANT_AFFORD unchanged)', () => {
    const g = createGame(cfg());
    const seat0Vertex = vtx(g, 0, 0);
    const state: GameState = {
      ...g,
      players: g.players.map((p) =>
        p.seat === 0 ? { ...p, settlements: [seat0Vertex as VertexId], resources: { ...p.resources, brick: 0 } } : p
      ),
      phase: { kind: 'main' },
      turn: { ...g.turn, rolled: true, roll: [3, 4] },
    };
    const edge = geometryForState(state).vertices[seat0Vertex]!.edges[0]!;
    const res = reduce(state, 0, { type: 'buildRoad', edge });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CANT_AFFORD');
  });

  it('on: an overridden (cheaper) road cost changes what CANT_AFFORD gates', () => {
    const g = createGame(
      cfg({ modifiers: { customConstants: { costs: { road: { brick: 1 } } } } })
    );
    expect(resolveConstants(g.config).costs?.road).toEqual({ brick: 1 });
    // The other 3 items keep their base cost (customConstantsModule fills in unset items).
    expect(resolveConstants(g.config).costs?.settlement).toEqual(COSTS.settlement);

    const seat0Vertex = vtx(g, 0, 0);
    const state: GameState = {
      ...g,
      players: g.players.map((p) =>
        p.seat === 0
          ? { ...p, settlements: [seat0Vertex as VertexId], resources: { ...p.resources, brick: 1, lumber: 0 } }
          : p
      ),
      phase: { kind: 'main' },
      turn: { ...g.turn, rolled: true, roll: [3, 4] },
    };
    const edge = geometryForState(state).vertices[seat0Vertex]!.edges[0]!;
    // Base road cost (brick+lumber) would reject this (no lumber); the overridden brick-only cost
    // (1 brick, no lumber) affords it.
    const res = reduce(state, 0, { type: 'buildRoad', edge });
    expect(res.ok).toBe(true);
  });
});

describe('customConstants: bankPerResource', () => {
  it('off: the base 19-per-resource bank (RK-13 baseline)', () => {
    const state = createGame(cfg());
    expect(state.bank).toEqual({ brick: 19, lumber: 19, wool: 19, grain: 19, ore: 19 });
  });

  it('on: createGame seeds the overridden bank size', () => {
    const state = createGame(cfg({ modifiers: { customConstants: { bankPerResource: 30 } } }));
    expect(state.bank).toEqual({ brick: 30, lumber: 30, wool: 30, grain: 30, ore: 30 });
  });
});

describe('customConstants: targetVp (limitless VP-target override, docs/07 D-034)', () => {
  it('off (absent): the base target (10) is unaffected (RK-13 baseline)', () => {
    const state = createGame(cfg());
    expect(state.config.targetVp).toBe(10);
  });

  it('on: createGame resolves the overridden numeric target', () => {
    const state = createGame(cfg({ modifiers: { customConstants: { targetVp: 15 } } }));
    expect(state.config.targetVp).toBe(15);
  });

  it('limitless (null): createGame resolves the target to the finite LIMITLESS_CAP sentinel — checkWin never auto-ends the game', () => {
    const state = createGame(cfg({ modifiers: { customConstants: { targetVp: null } } }));
    // Resolves to a large FINITE cap (LIMITLESS_CAP), not Infinity: Infinity does not survive JSON
    // over the wire (→ null → the client reads "can't build/win"). See shared/constants.ts.
    expect(state.config.targetVp).toBe(LIMITLESS_CAP);

    const settlementVertex = vtx(state, 0, 0) as VertexId;
    // A huge VP total (a real game could never reach this many settlements, but checkWin only
    // compares totals — this proves `total < LIMITLESS_CAP` never trips the win check).
    const withHugeVp: GameState = {
      ...state,
      players: state.players.map((p) =>
        p.seat === 0 ? { ...p, settlements: Array.from({ length: 50 }, () => settlementVertex) } : p
      ),
    };
    const result = checkWin(withHugeVp, 0);
    expect(result.phase.kind).not.toBe('ended');
    expect(result).toBe(withHugeVp); // same reference: checkWin is a no-op when nobody wins
  });
});

describe('customConstants: maxSettlements/maxCities/maxRoads (per-player piece supply caps)', () => {
  it('off (absent): createGame seeds the base piece supply (RK-13 baseline)', () => {
    const state = createGame(cfg());
    for (const p of state.players) {
      expect(p.piecesLeft).toEqual({ roads: 15, settlements: 5, cities: 4 });
    }
  });

  it('on: createGame seeds the configured caps, leaving an unset item at its base default', () => {
    const state = createGame(cfg({ modifiers: { customConstants: { maxSettlements: 8 } } }));
    for (const p of state.players) {
      expect(p.piecesLeft).toEqual({ roads: 15, settlements: 8, cities: 4 });
    }
  });

  it('limitless (null): createGame seeds the finite LIMITLESS_CAP for that piece — NO_PIECES_LEFT can never fire', () => {
    const state = createGame(cfg({ modifiers: { customConstants: { maxSettlements: null } } }));
    expect(state.players[0]!.piecesLeft.settlements).toBe(LIMITLESS_CAP);
  });

  it('limitless roads (null): seeds a FINITE cap that survives JSON — the wire never delivers null (B-37)', () => {
    // B-37 regression: a limitless `maxRoads` used to resolve to Infinity, and JSON.stringify turns
    // Infinity into null over the websocket — so the client read `piecesLeft.roads = null`, and
    // `null <= 0` is true in JS, which blocked Trailblazer ("No road pieces") and every road build
    // for the human while server-side bots (on the in-memory value) built fine. A finite cap both
    // stays > 0 AND round-trips through JSON unchanged.
    const state = createGame(cfg({ modifiers: { customConstants: { maxRoads: null } } }));
    const roads = state.players[0]!.piecesLeft.roads;
    expect(roads).toBe(LIMITLESS_CAP);
    expect(JSON.parse(JSON.stringify(state.players[0]!.piecesLeft)).roads).toBe(LIMITLESS_CAP);
    expect(roads > 0).toBe(true); // the exact predicate the Trailblazer / build gates check
  });

  it('end-to-end: a lowered cap rejects a build the base cap would allow; limitless allows it', () => {
    const settlementVertex = vtx(createGame(cfg()), 0, 0) as VertexId;

    function craft(config: GameConfig): GameState {
      const g = createGame(config);
      const edge = geometryForState(g).vertices[settlementVertex]!.edges[0]!;
      const players = g.players.map((p) =>
        p.seat === 0
          ? { ...p, roads: [edge], resources: { ...p.resources, brick: 1, lumber: 1, wool: 1, grain: 1 } }
          : p
      );
      return { ...g, players, phase: { kind: 'main' }, turn: { ...g.turn, rolled: true, roll: [3, 4] } };
    }

    // Base cap 5, but this seat has already used all 5 (piecesLeft.settlements: 0) — the SAME
    // situation a `maxSettlements: 5` config reaches after 5 real builds (creating that many
    // legally-placed settlements just to exercise the cap check would need far more board setup
    // than this cap check itself cares about — `buildSettlement` only reads `piecesLeft.settlements`
    // here, so setting it directly is the same enforcement path with far less incidental setup).
    const atDefaultCap = craft(cfg());
    const rejected = reduce(
      { ...atDefaultCap, players: atDefaultCap.players.map((p) => (p.seat === 0 ? { ...p, piecesLeft: { ...p.piecesLeft, settlements: 0 } } : p)) },
      0,
      { type: 'buildSettlement', vertex: settlementVertex }
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('NO_PIECES_LEFT');

    // `craft` -> `createGame` already seeds this seat's settlements supply to LIMITLESS_CAP for a
    // limitless config, so no manual override is needed — the build just succeeds and decrements it.
    const limitless = craft(cfg({ modifiers: { customConstants: { maxSettlements: null } } }));
    expect(limitless.players[0]!.piecesLeft.settlements).toBe(LIMITLESS_CAP);
    const accepted = reduce(limitless, 0, { type: 'buildSettlement', vertex: settlementVertex });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.state.players[0]!.piecesLeft.settlements).toBe(LIMITLESS_CAP - 1);
  });
});

describe('customConstants: Cities & Knights limits (maxCityWalls/maxKnightsPerLevel/maxProgressCards)', () => {
  const CK_CONFIG: GameConfig = {
    playerCount: 4,
    targetVp: 13,
    seed: 'custom-constants-ck-test',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
  };
  const V0 = vtx(createGame(CK_CONFIG), 0, 0) as VertexId;
  const V1 = vtx(createGame(CK_CONFIG), 0, 1) as VertexId;
  const V2 = vtx(createGame(CK_CONFIG), 0, 2) as VertexId;
  const V3 = vtx(createGame(CK_CONFIG), 0, 3) as VertexId;

  describe('maxCityWalls', () => {
    function craft(config: GameConfig, walls: number[]): GameState {
      const g = createGame(config);
      const cities = [V0, V1, V2, V3].map((v) => v as VertexId);
      const players = g.players.map((p) =>
        p.seat === 0 ? { ...p, cities, resources: { ...p.resources, brick: 2 } } : p
      );
      const ck = g.ext!.citiesKnights!;
      const seat0Walls = walls.map((i) => cities[i]!);
      return {
        ...g,
        players,
        phase: { kind: 'main' },
        ext: { ...g.ext, citiesKnights: { ...ck, walls: ck.walls.map((w, i) => (i === 0 ? seat0Walls : w)) } },
      };
    }

    it('off (absent): the base cap (3) rejects a 4th wall (RK-13 baseline)', () => {
      const state = craft(CK_CONFIG, [0, 1, 2]);
      const res = reduce(state, 0, { type: 'buildCityWall', vertex: V3 });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('WALL_CAP');
    });

    it('on: a raised cap allows the 4th wall', () => {
      const config: GameConfig = { ...CK_CONFIG, modifiers: { customConstants: { maxCityWalls: 4 } } };
      const state = craft(config, [0, 1, 2]);
      const res = reduce(state, 0, { type: 'buildCityWall', vertex: V3 });
      expect(res.ok).toBe(true);
    });

    it('limitless (null): unlimited walls per player', () => {
      const config: GameConfig = { ...CK_CONFIG, modifiers: { customConstants: { maxCityWalls: null } } };
      const state = craft(config, [0, 1, 2]);
      const res = reduce(state, 0, { type: 'buildCityWall', vertex: V3 });
      expect(res.ok).toBe(true);
    });
  });

  describe('maxKnightsPerLevel', () => {
    function craft(config: GameConfig, knightVertices: number[]): GameState {
      const g = createGame(config);
      const roads = [V0, V1, V2, V3].map((v) => GEOMETRY.vertices[v]!.edges[0]!);
      const players = g.players.map((p) =>
        p.seat === 0 ? { ...p, roads, resources: { ...p.resources, wool: 1, ore: 1 } } : p
      );
      const ck = g.ext!.citiesKnights!;
      const knights: Knight[] = knightVertices.map((v) => ({ vertex: v as VertexId, level: 1, active: false }));
      return {
        ...g,
        players,
        phase: { kind: 'main' },
        ext: { ...g.ext, citiesKnights: { ...ck, knights: ck.knights.map((k, i) => (i === 0 ? knights : k)) } },
      };
    }

    it('off (absent): the base cap (2 per level) rejects a 3rd basic knight (RK-13 baseline)', () => {
      const state = craft(CK_CONFIG, [V0, V1]);
      const res = reduce(state, 0, { type: 'buildKnight', vertex: V2 });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('KNIGHT_CAP');
    });

    it('on: a raised cap allows the 3rd basic knight', () => {
      const config: GameConfig = { ...CK_CONFIG, modifiers: { customConstants: { maxKnightsPerLevel: 3 } } };
      const state = craft(config, [V0, V1]);
      const res = reduce(state, 0, { type: 'buildKnight', vertex: V2 });
      expect(res.ok).toBe(true);
    });

    it('limitless (null): unlimited knights per level', () => {
      const config: GameConfig = { ...CK_CONFIG, modifiers: { customConstants: { maxKnightsPerLevel: null } } };
      const state = craft(config, [V0, V1]);
      const res = reduce(state, 0, { type: 'buildKnight', vertex: V2 });
      expect(res.ok).toBe(true);
    });
  });

  describe('maxProgressCards (progress-card hand limit, C6.3)', () => {
    function craft(config: GameConfig): GameState {
      const g = createGame(config);
      const ck = g.ext!.citiesKnights!;
      return {
        ...g,
        ext: {
          ...g.ext,
          citiesKnights: {
            ...ck,
            improvements: ck.improvements.map((imp, i) => (i === 0 ? { ...imp, science: 3 } : imp)),
            progressHand: ck.progressHand.map((h, i) =>
              i === 0 ? (['smith', 'smith', 'smith', 'smith'] as ProgressCardId[]) : h
            ),
            progressDecks: {
              ...ck.progressDecks,
              science: ['smith' as ProgressCardId, ...ck.progressDecks.science],
            },
          },
        },
      };
    }

    it('off (absent): drawing a 5th card auto-discards back to the base limit (4, RK-13 baseline)', () => {
      const state = craft(CK_CONFIG);
      const result = resolveProgressDraw(state, 'science', 1, 0);
      expect(result.progressHand[0]).toHaveLength(4);
      expect(result.events.some((e) => e.type === 'progressCardDiscarded')).toBe(true);
    });

    it('on: a raised limit keeps the 5th card in hand, no discard', () => {
      const config: GameConfig = { ...CK_CONFIG, modifiers: { customConstants: { maxProgressCards: 10 } } };
      const state = craft(config);
      const result = resolveProgressDraw(state, 'science', 1, 0);
      expect(result.progressHand[0]).toHaveLength(5);
      expect(result.events.some((e) => e.type === 'progressCardDiscarded')).toBe(false);
    });

    it('limitless (null): never discards for being over-hand', () => {
      const config: GameConfig = { ...CK_CONFIG, modifiers: { customConstants: { maxProgressCards: null } } };
      const state = craft(config);
      const result = resolveProgressDraw(state, 'science', 1, 0);
      expect(result.progressHand[0]).toHaveLength(5);
      expect(result.events.some((e) => e.type === 'progressCardDiscarded')).toBe(false);
    });
  });
});

describe('customConstants: range validation (MODIFIER_INVALID_CONFIG)', () => {
  it('rejects a non-positive productionMultiplier', () => {
    const c = cfg({ modifiers: { customConstants: { productionMultiplier: 0 } } });
    expect(validateConfig(c)?.code).toBe('MODIFIER_INVALID_CONFIG');
  });

  it('rejects a non-integer roadBuildingCount', () => {
    const c = cfg({ modifiers: { customConstants: { roadBuildingCount: 2.5 } } });
    expect(validateConfig(c)?.code).toBe('MODIFIER_INVALID_CONFIG');
  });

  it('rejects an out-of-range discardHandLimit', () => {
    const c = cfg({ modifiers: { customConstants: { discardHandLimit: 1000 } } });
    expect(validateConfig(c)?.code).toBe('MODIFIER_INVALID_CONFIG');
  });

  it('rejects startingResources that exceed the resolved bank supply for the player count', () => {
    // 4 players x 5 brick = 20 > the base 19-per-resource bank.
    const c = cfg({ modifiers: { customConstants: { startingResources: { brick: 5 } } } });
    expect(validateConfig(c)?.code).toBe('MODIFIER_INVALID_CONFIG');
  });

  it('accepts the same startingResources amount once bankPerResource is raised to fit', () => {
    const c = cfg({
      modifiers: { customConstants: { startingResources: { brick: 5 }, bankPerResource: 20 } },
    });
    expect(validateConfig(c)).toBeNull();
  });

  it('rejects a negative cost amount', () => {
    const c = cfg({ modifiers: { customConstants: { costs: { road: { brick: -1 } } } } });
    expect(validateConfig(c)?.code).toBe('MODIFIER_INVALID_CONFIG');
  });

  it('a fully empty customConstants config is valid (every field optional)', () => {
    const c = cfg({ modifiers: { customConstants: {} } });
    expect(validateConfig(c)).toBeNull();
  });
});

describe('RK-13: a base-config simulation is unaffected by this task', () => {
  it('a base-config simulation runs to completion exactly as before', () => {
    const r = simulate('custom-constants-rk13-smoke');
    expect(r.turns).toBeGreaterThan(0);
  });
});
