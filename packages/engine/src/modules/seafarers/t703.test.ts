// T-703: Seafarers pirate, gold fields, island VP chits & the 14-VP scenario win. Unit + reducer
// integration tests over a real "Heading for New Shores" board (createGame), plus a seeded sim that
// reaches a 14-VP win. Base/fiveSix bit-identity is proven by RK-13 + the base/5–6 sims (their own
// suites); here we only exercise the new seafarers rules.

import { describe, expect, it } from 'vitest';
import type { EdgeId, GameConfig, GameState, HexId, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { hashSeed, rollDie } from '../../rng.js';
import { computeProduction } from '../../rules/production.js';
import { simulate } from '../../sim/runGame.js';
import { checkWin, computeVp } from '../../vp.js';
import { geometryForState } from '../index.js';
import { grantIslandChit, islandChitVp, islandOfVertex } from './chits.js';
import { computeGoldOwed } from './gold.js';
import { pirateStealCandidates } from './pirate.js';
import { hexTerrainOf, pirateOf } from './state.js';

function seafarersConfig(playerCount: 3 | 4 = 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // deliberately 10 — createGame must OVERRIDE it to the scenario's 14 (S10.1).
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
  };
}

function newGame(seed = 't703', playerCount: 3 | 4 = 4): GameState {
  return createGame({ ...seafarersConfig(playerCount), seed });
}

/** Put `patch` onto one seat's player record. */
function withSeat(state: GameState, seat: Seat, patch: Partial<GameState['players'][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p)) };
}

/** Replace the seafarers ext block. */
function withExt(state: GameState, patch: Partial<NonNullable<NonNullable<GameState['ext']>['seafarers']>>): GameState {
  const ext = state.ext!.seafarers!;
  return { ...state, ext: { ...state.ext, seafarers: { ...ext, ...patch } } };
}

function setShip(state: GameState, seat: Seat, edges: EdgeId[]): GameState {
  const ext = state.ext!.seafarers!;
  return withExt(state, { ships: ext.ships.map((list, s) => (s === seat ? edges : list)) });
}

function firstHexOf(state: GameState, kind: 'gold' | 'sea'): HexId {
  const i = state.ext!.seafarers!.hexTerrain.findIndex((t) => t === kind);
  if (i < 0) throw new Error(`no ${kind} hex on this board`);
  return i as HexId;
}

function isSeaEdge(state: GameState, edge: EdgeId): boolean {
  return geometryForState(state).edges[edge]!.hexes.some((h) => hexTerrainOf(state, h) === 'sea');
}

/** A small-island land vertex plus one incident sea edge (so a ship can anchor a settlement there). */
function findIslandVertex(state: GameState): { vertex: VertexId; seaEdge: EdgeId; island: number } {
  const geo = geometryForState(state);
  for (const v of geo.vertices) {
    const island = islandOfVertex(state, v.id);
    if (island === null) continue;
    const seaEdge = v.edges.find((e) => isSeaEdge(state, e));
    if (seaEdge !== undefined) return { vertex: v.id, seaEdge, island };
  }
  throw new Error('no small-island vertex with an incident sea edge');
}

/** An rng seed whose first two `rollDie` draws sum to `total` (deterministic dice for a gold roll). */
function rngForTotal(total: number): number {
  for (let i = 0; i < 500000; i++) {
    const s = hashSeed(`t703-roll-${i}`);
    const d1 = rollDie(s);
    const d2 = rollDie(d1.state);
    if (d1.value + d2.value === total) return s;
  }
  throw new Error(`no rng seed found rolling ${total}`);
}

const MAIN_TURN = { number: 5, player: 0 as Seat, rolled: true, roll: [3, 4] as [number, number], devPlayed: false };

// ---------------------------------------------------------------------------
// Scenario target VP (S10.1)
// ---------------------------------------------------------------------------

describe('T-703 scenario target VP (S10.1)', () => {
  it('createGame overrides config.targetVp to the scenario target (14), not the passed 10', () => {
    expect(newGame().config.targetVp).toBe(14);
    expect(newGame('x', 3).config.targetVp).toBe(14);
  });

  it('a base game keeps the passed targetVp (bit-identity, RK-13)', () => {
    const base = createGame({
      playerCount: 4,
      targetVp: 10,
      seed: 'base',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    });
    expect(base.config.targetVp).toBe(10);
    expect(base.ext).toBeUndefined();
  });

  it('wins at 14 including island chits + Longest Trade Route', () => {
    const g = newGame();
    // 2 settlements (2) + 4 cities (8) = 10 buildings, + Longest Trade Route (2) + 1 island chit (2) = 14.
    let s = withSeat(g, 0, {
      settlements: [1, 2] as VertexId[],
      cities: [10, 11, 12, 13] as VertexId[],
    });
    s = { ...s, awards: { ...s.awards, longestRoad: { holder: 0, length: 6 } } };
    s = withExt(s, { islandChits: s.ext!.seafarers!.islandChits.map((l, i) => (i === 0 ? [0] : l)) });
    s = { ...s, phase: { kind: 'main' }, turn: { ...MAIN_TURN } };

    const bd = computeVp(s, 0);
    expect(bd.islandChits).toBe(2);
    expect(bd.longestRoad).toBe(2);
    expect(bd.total).toBe(14);
    expect(checkWin(s, 0).phase).toEqual({ kind: 'ended', winner: 0 });
  });

  it('does not win at 13 (one short of the scenario target)', () => {
    const g = newGame();
    let s = withSeat(g, 0, { settlements: [1, 2] as VertexId[], cities: [10, 11, 12, 13] as VertexId[] });
    s = { ...s, awards: { ...s.awards, longestRoad: { holder: 0, length: 6 } } }; // 10 + 2 = 12
    s = withExt(s, { islandChits: s.ext!.seafarers!.islandChits.map((l, i) => (i === 0 ? [] : l)) });
    s = { ...s, phase: { kind: 'main' }, turn: { ...MAIN_TURN } };
    expect(computeVp(s, 0).total).toBe(12);
    expect(checkWin(s, 0).phase.kind).not.toBe('ended');
  });
});

// ---------------------------------------------------------------------------
// Island VP chits (S10.6)
// ---------------------------------------------------------------------------

describe('T-703 island VP chits (S10.6)', () => {
  it('grants +2 VP the first time a seat settles a small island, via reduce(buildSettlement)', () => {
    const g = newGame('island');
    const { vertex, seaEdge, island } = findIslandVertex(g);
    let s = setShip(g, 0, [seaEdge]);
    s = withSeat(s, 0, { resources: { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 0 } });
    s = { ...s, phase: { kind: 'main' }, turn: { ...MAIN_TURN } };

    const r = reduce(s, 0, { type: 'buildSettlement', vertex });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ext!.seafarers!.islandChits[0]).toContain(island);
    expect(r.events.some((e) => e.type === 'islandSettled' && e.seat === 0 && e.island === island)).toBe(true);
    expect(computeVp(r.state, 0).islandChits).toBe(2);
  });

  it('does not repeat the chit for a second settlement on the same island (idempotent)', () => {
    const g = newGame('island2');
    const { vertex, island } = findIslandVertex(g);
    // Seat already earned this island's chit.
    const s = withExt(g, { islandChits: g.ext!.seafarers!.islandChits.map((l, i) => (i === 0 ? [island] : l)) });
    expect(grantIslandChit(s, 0, vertex)).toBeNull();
    expect(islandChitVp(s, 0)).toBe(2); // still just the one island
  });

  it('a main-island / open-ocean vertex earns no chit', () => {
    const g = newGame('island3');
    const geo = geometryForState(g);
    const mainVertex = geo.vertices.find((v) => islandOfVertex(g, v.id) === null)!.id;
    expect(grantIslandChit(g, 0, mainVertex)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Gold fields (S9 / ER-S7)
// ---------------------------------------------------------------------------

describe('T-703 gold fields (S9/ER-S7)', () => {
  it('owes 1 per adjacent settlement and 2 per adjacent city (robber elsewhere)', () => {
    const g = newGame('gold');
    const gold = firstHexOf(g, 'gold');
    const token = g.board.hexes[gold]!.token!;
    const verts = geometryForState(g).hexes[gold]!.vertices;
    let s = { ...g, board: { ...g.board, robber: (gold === 0 ? 1 : 0) as HexId } };
    s = withSeat(s, 0, { settlements: [verts[0]!] });
    s = withSeat(s, 1, { cities: [verts[3]!] });

    const { pending, owed } = computeGoldOwed(s, token);
    expect(owed[0]).toBe(1);
    expect(owed[1]).toBe(2);
    expect(pending).toEqual(expect.arrayContaining([0, 1]));
  });

  it('the robber on the gold hex blocks its production (S9.3/R5.2)', () => {
    const g = newGame('gold-robber');
    const gold = firstHexOf(g, 'gold');
    const token = g.board.hexes[gold]!.token!;
    const verts = geometryForState(g).hexes[gold]!.vertices;
    let s = { ...g, board: { ...g.board, robber: gold } };
    s = withSeat(s, 0, { settlements: [verts[0]!] });
    expect(computeGoldOwed(s, token).pending).toEqual([]);
  });

  it('a producing gold roll opens the chooseGoldResource sub-phase and blocks the turn', () => {
    const g = newGame('gold-roll');
    const gold = firstHexOf(g, 'gold');
    const token = g.board.hexes[gold]!.token!;
    const verts = geometryForState(g).hexes[gold]!.vertices;
    let s = { ...g, board: { ...g.board, robber: (gold === 0 ? 1 : 0) as HexId }, rng: rngForTotal(token) };
    s = withSeat(s, 0, { settlements: [verts[0]!] });
    s = { ...s, phase: { kind: 'preRoll' }, turn: { number: 5, player: 0, rolled: false, roll: null, devPlayed: false } };

    const rolled = reduce(s, 0, { type: 'rollDice' });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(rolled.state.phase.kind).toBe('chooseGoldResource');
    if (rolled.state.phase.kind !== 'chooseGoldResource') return;
    expect(rolled.state.phase.owed[0]).toBe(1);

    // The turn is blocked: endTurn is rejected until the gold choice resolves.
    const blocked = reduce(rolled.state, 0, { type: 'endTurn' });
    expect(blocked.ok).toBe(false);

    // Resolving the choice credits the chosen resource and returns to main.
    const chosen = reduce(rolled.state, 0, { type: 'chooseGoldResource', picks: { ore: 1 } });
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    expect(chosen.state.phase.kind).toBe('main');
    // The gold choice alone adds exactly +1 ore over the post-production (pre-choice) hand.
    expect(chosen.state.players[0]!.resources.ore).toBe(rolled.state.players[0]!.resources.ore + 1);
  });

  it('rejects a gold choice whose count is wrong (BAD_GOLD_COUNT)', () => {
    const g = newGame('gold-count');
    const s: GameState = {
      ...g,
      phase: { kind: 'chooseGoldResource', pending: [0], owed: { 0: 2, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
      turn: { ...MAIN_TURN },
    };
    const bad = reduce(s, 0, { type: 'chooseGoldResource', picks: { brick: 1 } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('BAD_GOLD_COUNT');
  });

  it('respects the bank cap: an entitlement beyond the bank is capped to what remains (R5.3)', () => {
    const g = newGame('gold-bank');
    // Empty the bank down to 2 total cards; owe 5.
    const bank = { brick: 2, lumber: 0, wool: 0, grain: 0, ore: 0 };
    const s: GameState = {
      ...g,
      bank,
      phase: { kind: 'chooseGoldResource', pending: [0], owed: { 0: 5, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
      turn: { ...MAIN_TURN },
    };
    // Only 2 cards are available, so the seat must (and can only) take exactly those 2.
    const tooMany = reduce(s, 0, { type: 'chooseGoldResource', picks: { brick: 2, lumber: 1 } });
    expect(tooMany.ok).toBe(false); // exceeds the bank's stock
    const ok = reduce(s, 0, { type: 'chooseGoldResource', picks: { brick: 2 } });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.state.bank.brick).toBe(0);
    expect(ok.state.phase.kind).toBe('main');
  });
});

// ---------------------------------------------------------------------------
// Pirate (S8)
// ---------------------------------------------------------------------------

/** A moveRobber-phase seafarers state (turn owner = seat 0), pirate parked on a chosen sea hex. */
function moveRobberState(g: GameState, pirate: HexId): GameState {
  return {
    ...withExt(g, { pirate }),
    phase: { kind: 'moveRobber', returnTo: 'main' },
    turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
  };
}

describe('T-703 pirate (S8)', () => {
  it('offers moving the pirate to a sea hex as an alternative to the robber, and steals from an adjacent ship owner', () => {
    const g = newGame('pirate');
    const seaHexes = g.ext!.seafarers!.hexTerrain.flatMap((t, i) => (t === 'sea' ? [i as HexId] : []));
    const target = seaHexes[0]!;
    const other = seaHexes[1]!;
    const edge = geometryForState(g).hexes[target]!.edges[0]!;

    let s = moveRobberState(g, other); // pirate starts away from `target`
    s = setShip(s, 1, [edge]); // opponent has a ship adjacent to `target`
    s = withSeat(s, 1, { resources: { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 } });

    const r = reduce(s, 0, { type: 'movePirate', hex: target });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pirateOf(r.state)).toBe(target);
    expect(r.events.some((e) => e.type === 'pirateMoved')).toBe(true);
    // Auto-steal (exactly one victim): seat 1 loses its only card to seat 0.
    expect(r.state.players[1]!.resources.brick).toBe(0);
    expect(r.state.players[0]!.resources.brick).toBe(g.players[0]!.resources.brick + 1);
    expect(r.state.phase.kind).toBe('main');
  });

  it('no adjacent ship owner with cards ⇒ no steal, phase returns', () => {
    const g = newGame('pirate2');
    const seaHexes = g.ext!.seafarers!.hexTerrain.flatMap((t, i) => (t === 'sea' ? [i as HexId] : []));
    const s = moveRobberState(g, seaHexes[1]!);
    const r = reduce(s, 0, { type: 'movePirate', hex: seaHexes[0]! });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase.kind).toBe('main');
  });

  it('≥2 eligible victims ⇒ the steal sub-phase is entered', () => {
    const g = newGame('pirate3');
    const seaHexes = g.ext!.seafarers!.hexTerrain.flatMap((t, i) => (t === 'sea' ? [i as HexId] : []));
    const target = seaHexes[0]!;
    const edges = geometryForState(g).hexes[target]!.edges;
    let s = moveRobberState(g, seaHexes[1]!);
    s = setShip(s, 1, [edges[0]!]);
    s = setShip(s, 2, [edges[2]!]);
    s = withSeat(s, 1, { resources: { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 } });
    s = withSeat(s, 2, { resources: { brick: 0, lumber: 1, wool: 0, grain: 0, ore: 0 } });
    expect(pirateStealCandidates(s, target).length).toBe(2);

    const r = reduce(s, 0, { type: 'movePirate', hex: target });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase.kind).toBe('steal');
    if (r.state.phase.kind === 'steal') expect(r.state.phase.candidates).toEqual(expect.arrayContaining([1, 2]));
  });

  it('blocks building a ship on an edge bordering the pirate (S8.5)', () => {
    const g = newGame('pirate-block');
    const sea = firstHexOf(g, 'sea');
    const edge = geometryForState(g).hexes[sea]!.edges[0]!;
    let s = withExt(g, { pirate: sea });
    s = withSeat(s, 0, { resources: { brick: 0, lumber: 5, wool: 5, grain: 0, ore: 0 } });
    s = { ...s, phase: { kind: 'main' }, turn: { ...MAIN_TURN } };
    const r = reduce(s, 0, { type: 'buildShip', edge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BAD_LOCATION');
  });

  it('blocks moving a ship away from an edge bordering the pirate (S7.3/S8.5)', () => {
    const g = newGame('pirate-move-block');
    const sea = firstHexOf(g, 'sea');
    const edges = geometryForState(g).hexes[sea]!.edges;
    let s = withExt(g, { pirate: sea });
    s = setShip(s, 0, [edges[0]!]);
    s = { ...s, phase: { kind: 'main' }, turn: { ...MAIN_TURN } };
    const r = reduce(s, 0, { type: 'moveShip', from: edges[0]!, to: edges[1]! });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CANNOT_PLAY');
  });

  it('does not block land production (only the robber does, S8.5)', () => {
    const g = newGame('pirate-prod');
    // Find a producing LAND hex (not sea/desert/gold) with a token.
    const geo = geometryForState(g);
    const landHex = geo.hexes.find((h) => {
      const t = hexTerrainOf(g, h.id);
      return t !== undefined && t !== 'sea' && t !== 'desert' && t !== 'gold' && g.board.hexes[h.id]!.token !== null;
    })!;
    const token = g.board.hexes[landHex.id]!.token!;
    let s = { ...g, board: { ...g.board, robber: firstHexOf(g, 'sea') } }; // robber parked off the land hex
    s = withExt(s, { pirate: firstHexOf(g, 'sea') });
    s = withSeat(s, 0, { settlements: [landHex.vertices[0]!] });
    // With the pirate present (on sea) and the robber elsewhere, the land hex still produces.
    const prod = computeProduction(s, token);
    expect(prod.gains.some((gn) => gn.seat === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Road Building → ships (S11.1)
// ---------------------------------------------------------------------------

describe('T-703 Road Building may place a ship (S11.1)', () => {
  it('places a free ship during Road Building at no resource cost', () => {
    const g = newGame('rb-ship');
    // A coastal settlement for seat 0 to anchor a ship, and its incident sea edge.
    const { vertex, seaEdge } = findIslandVertex(g);
    // Park the pirate on a sea hex that does NOT border the anchor edge, so it can't block it.
    const edgeHexes = geometryForState(g).edges[seaEdge]!.hexes;
    const seaHexes = g.ext!.seafarers!.hexTerrain.flatMap((t, i) => (t === 'sea' ? [i as HexId] : []));
    const pirateHex = seaHexes.find((h) => !edgeHexes.includes(h)) ?? seaHexes[0]!;
    let s = withSeat(g, 0, {
      settlements: [vertex] as VertexId[],
      devCards: [{ type: 'roadBuilding', boughtOnTurn: 1 }],
    });
    s = withExt(s, { pirate: pirateHex });
    s = { ...s, phase: { kind: 'main' }, turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false } };

    const played = reduce(s, 0, { type: 'playRoadBuilding' });
    expect(played.ok).toBe(true);
    if (!played.ok) return;
    expect(played.state.phase.kind).toBe('roadBuilding');

    const bankBefore = played.state.bank;
    const shipsLeftBefore = played.state.ext!.seafarers!.shipsLeft[0]!;
    const r = reduce(played.state, 0, { type: 'placeFreeShip', edge: seaEdge });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ext!.seafarers!.ships[0]).toContain(seaEdge);
    expect(r.state.ext!.seafarers!.shipsLeft[0]).toBe(shipsLeftBefore - 1);
    expect(r.state.bank).toEqual(bankBefore); // free — the bank is untouched
    expect(r.events.some((e) => e.type === 'shipBuilt')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A full seafarers game reaches a 14-VP win
// ---------------------------------------------------------------------------

describe('T-703 a seafarers game is winnable at 14 VP', () => {
  it('a seeded random-bot game ends with the winner at ≥14 VP, invariants clean', () => {
    const r = simulate('t703-win', { config: seafarersConfig(4), maxActions: 8000 });
    expect(r.winner).toBeGreaterThanOrEqual(0);
    expect(r.winnerVp).toBeGreaterThanOrEqual(14);
  }, 60_000);
});
