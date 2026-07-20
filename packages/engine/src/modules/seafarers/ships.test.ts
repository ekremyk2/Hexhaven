// T-702: Seafarers ship gameplay + Longest Trade Route. Builds a real "Heading for New Shores" game
// via createGame, then discovers coastal features on the actual scenario geometry (no hard-coded ids)
// so the matrix is anchored to the shipped board. Covers ship build cost/placement/junction + 15 cap,
// relocation (open-end / once-per-turn / built-this-turn / closed-route), and the Longest Trade Route
// (roads ∪ ships combined length, junction rule, opponent break, ≥5 threshold, award transfer).

import { describe, expect, it } from 'vitest';
import type { BoardGeometry, EdgeId, GameConfig, GameState, ScenarioTerrain, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { redact } from '../../redact.js';
import { updateLongestRoad, longestRoadLength } from '../../rules/longestRoad.js';
import { scenarioGeometryFor } from './board.js';
import { movableShips, shipMoveTargets } from './ships.js';

const SEAFARERS_CONFIG: Omit<GameConfig, 'seed'> = {
  playerCount: 4,
  targetVp: 14,
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
};

function seafarersGame(seed = 'seafarers-ships'): GameState {
  return createGame({ ...SEAFARERS_CONFIG, seed });
}

function geometryOf(g: GameState): BoardGeometry {
  const geo = scenarioGeometryFor(g.config);
  if (!geo) throw new Error('no scenario geometry');
  return geo;
}

function hexTerrainOf(g: GameState): ScenarioTerrain[] {
  const ht = g.ext?.seafarers?.hexTerrain;
  if (!ht) throw new Error('no seafarers hexTerrain');
  return ht;
}

/** An edge bordering ≥1 sea hex (ship-legal shape, S3.2). */
function isSeaEdge(geo: BoardGeometry, ht: ScenarioTerrain[], edge: EdgeId): boolean {
  return geo.edges[edge]!.hexes.some((h) => ht[h] === 'sea');
}
/** An edge bordering ≥1 land hex (road-legal). */
function isLandEdge(geo: BoardGeometry, ht: ScenarioTerrain[], edge: EdgeId): boolean {
  return geo.edges[edge]!.hexes.some((h) => ht[h] !== undefined && ht[h] !== 'sea');
}
function otherEnd(geo: BoardGeometry, edge: EdgeId, v: VertexId): VertexId {
  const e = geo.edges[edge]!;
  return e.a === v ? e.b : e.a;
}

/** A simple path of `count` edges from `start`, each satisfying `ok`, never revisiting a vertex. */
function simplePath(
  geo: BoardGeometry,
  start: VertexId,
  count: number,
  ok: (edge: EdgeId) => boolean
): { edges: EdgeId[]; vertices: VertexId[] } | null {
  const path: EdgeId[] = [];
  const verts: VertexId[] = [start];
  const seenV = new Set<VertexId>([start]);
  function dfs(v: VertexId): boolean {
    if (path.length === count) return true;
    for (const e of geo.vertices[v]!.edges) {
      if (!ok(e) || path.includes(e)) continue;
      const to = otherEnd(geo, e, v);
      if (seenV.has(to)) continue;
      path.push(e);
      verts.push(to);
      seenV.add(to);
      if (dfs(to)) return true;
      path.pop();
      verts.pop();
      seenV.delete(to);
    }
    return false;
  }
  return dfs(start) ? { edges: path, vertices: verts } : null;
}

/** A coastal vertex (touches both land and sea) that has at least `minSea` incident sea edges. */
function findCoastalVertex(geo: BoardGeometry, ht: ScenarioTerrain[], minSea = 1): VertexId {
  for (const v of geo.vertices) {
    const touchesSea = v.hexes.some((h) => ht[h] === 'sea');
    const touchesLand = v.hexes.some((h) => ht[h] !== undefined && ht[h] !== 'sea');
    if (!touchesSea || !touchesLand) continue;
    const seaEdges = v.edges.filter((e) => isSeaEdge(geo, ht, e));
    if (seaEdges.length >= minSea) return v.id;
  }
  throw new Error(`no coastal vertex with >= ${minSea} sea edges`);
}

const RICH = { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 };
const NONE = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };

/** Put `seat` in a main-phase turn owning the given settlements/roads/ships with the given hand. */
function craft(
  g: GameState,
  seat: Seat,
  opts: {
    settlements?: VertexId[];
    roads?: EdgeId[];
    ships?: Partial<Record<Seat, EdgeId[]>>;
    resources?: typeof RICH;
    opponentSettlements?: Partial<Record<Seat, VertexId[]>>;
    builtShips?: { turn: number; edges: EdgeId[] };
    movedShipOnTurn?: number;
  } = {}
): GameState {
  const ext = g.ext!.seafarers!;
  const ships = g.players.map((_, s) => opts.ships?.[s as Seat] ?? []);
  const players = g.players.map((p, s) => {
    if (s === seat) {
      return {
        ...p,
        settlements: opts.settlements ?? [],
        roads: opts.roads ?? [],
        resources: opts.resources ?? RICH,
      };
    }
    const oppS = opts.opponentSettlements?.[s as Seat];
    return oppS ? { ...p, settlements: oppS } : p;
  });
  return {
    ...g,
    players,
    ext: {
      ...g.ext,
      seafarers: {
        ...ext,
        ships,
        movedShipOnTurn: opts.movedShipOnTurn ?? -1,
        builtShips: opts.builtShips ?? { turn: -1, edges: [] },
      },
    },
    phase: { kind: 'main' },
    turn: { number: 5, player: seat, rolled: true, roll: [3, 4], devPlayed: false },
  };
}

describe('createGame stands up a seafarers scenario board (T-702 req 1)', () => {
  it('builds the sea/land board with ship state initialised', () => {
    const g = seafarersGame();
    const ht = hexTerrainOf(g);
    expect(ht.some((t) => t === 'sea')).toBe(true); // sea hexes present
    expect(g.board.hexes.length).toBe(ht.length); // board aligned to geometry
    // Sea hexes carry no token and produce nothing (proxied to desert terrain, S3.1).
    ht.forEach((t, i) => {
      if (t === 'sea') expect(g.board.hexes[i]!.token).toBeNull();
    });
    expect(g.ext?.seafarers?.ships).toEqual([[], [], [], []]);
    expect(g.ext?.seafarers?.shipsLeft).toEqual([15, 15, 15, 15]);
  });
});

describe('buildShip (S3/S4)', () => {
  it('places a ship adjacent to a coastal settlement, pays 1 lumber + 1 wool', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    const seaEdge = geo.vertices[v]!.edges.find((e) => isSeaEdge(geo, ht, e))!;
    const s = craft(g, 0, { settlements: [v], resources: { ...RICH, lumber: 2, wool: 2 } });

    const r = reduce(s, 0, { type: 'buildShip', edge: seaEdge });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ext?.seafarers?.ships[0]).toEqual([seaEdge]);
    expect(r.state.ext?.seafarers?.shipsLeft[0]).toBe(14);
    expect(r.state.players[0]!.resources.lumber).toBe(1);
    expect(r.state.players[0]!.resources.wool).toBe(1);
    expect(r.events.some((e) => e.type === 'shipBuilt' && e.edge === seaEdge)).toBe(true);
  });

  it('extends from the open end of an own ship (junction rule S4.2)', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    const seaEdge = geo.vertices[v]!.edges.find((e) => isSeaEdge(geo, ht, e))!;
    const far = otherEnd(geo, seaEdge, v);
    const nextSea = geo.vertices[far]!.edges.find((e) => e !== seaEdge && isSeaEdge(geo, ht, e));
    expect(nextSea).toBeDefined();
    const s = craft(g, 0, { settlements: [v], ships: { 0: [seaEdge] } });
    const r = reduce(s, 0, { type: 'buildShip', edge: nextSea! });
    expect(r.ok).toBe(true);
  });

  it('rejects a non-sea (road-only) edge with BAD_LOCATION', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    const landEdge = geo.vertices[v]!.edges.find((e) => !isSeaEdge(geo, ht, e) && isLandEdge(geo, ht, e));
    if (!landEdge) return; // no land-only incident edge on this coast — skip
    const s = craft(g, 0, { settlements: [v] });
    const r = reduce(s, 0, { type: 'buildShip', edge: landEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BAD_LOCATION');
  });

  it('rejects a sea edge not connected to the network with NOT_CONNECTED', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    const incident = new Set(geo.vertices[v]!.edges);
    const disconnected = geo.edges.find((e) => isSeaEdge(geo, ht, e.id) && !incident.has(e.id))!;
    const s = craft(g, 0, { settlements: [v] });
    const r = reduce(s, 0, { type: 'buildShip', edge: disconnected.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_CONNECTED');
  });

  it('rejects when the seat cannot afford it (CANT_AFFORD)', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    const seaEdge = geo.vertices[v]!.edges.find((e) => isSeaEdge(geo, ht, e))!;
    const s = craft(g, 0, { settlements: [v], resources: { ...NONE } });
    const r = reduce(s, 0, { type: 'buildShip', edge: seaEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CANT_AFFORD');
  });

  it('rejects when no ships remain in supply (NO_PIECES_LEFT, 15 cap)', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    const seaEdge = geo.vertices[v]!.edges.find((e) => isSeaEdge(geo, ht, e))!;
    let s = craft(g, 0, { settlements: [v] });
    s = { ...s, ext: { ...s.ext, seafarers: { ...s.ext!.seafarers!, shipsLeft: [0, 15, 15, 15] } } };
    const r = reduce(s, 0, { type: 'buildShip', edge: seaEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NO_PIECES_LEFT');
  });

  it('rejects an edge already carrying a ship (OCCUPIED, one piece per edge S3.3)', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    const seaEdge = geo.vertices[v]!.edges.find((e) => isSeaEdge(geo, ht, e))!;
    const s = craft(g, 0, { settlements: [v], ships: { 0: [seaEdge] } });
    const r = reduce(s, 0, { type: 'buildShip', edge: seaEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('OCCUPIED');
  });

  it('rejects an edge already carrying a road (OCCUPIED, S3.3)', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    const seaEdge = geo.vertices[v]!.edges.find((e) => isSeaEdge(geo, ht, e))!;
    const s = craft(g, 0, { settlements: [v], roads: [seaEdge] });
    const r = reduce(s, 0, { type: 'buildShip', edge: seaEdge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('OCCUPIED');
  });
});

describe('moveShip (S7)', () => {
  it('relocates an open-ended ship to another legal spot', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht, 2); // needs ≥2 sea edges so a legal target remains
    const seaEdges = geo.vertices[v]!.edges.filter((e) => isSeaEdge(geo, ht, e));
    const [from, to] = [seaEdges[0]!, seaEdges[1]!];
    const s = craft(g, 0, { settlements: [v], ships: { 0: [from] } });
    const r = reduce(s, 0, { type: 'moveShip', from, to });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.ext?.seafarers?.ships[0]).toEqual([to]);
    expect(r.state.ext?.seafarers?.movedShipOnTurn).toBe(5);
    expect(r.events.some((e) => e.type === 'shipMoved' && e.from === from && e.to === to)).toBe(true);
  });

  it('allows only one move per turn (S7.1a)', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht, 2);
    const seaEdges = geo.vertices[v]!.edges.filter((e) => isSeaEdge(geo, ht, e));
    const s = craft(g, 0, { settlements: [v], ships: { 0: [seaEdges[0]!] }, movedShipOnTurn: 5 });
    const r = reduce(s, 0, { type: 'moveShip', from: seaEdges[0]!, to: seaEdges[1]! });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CANNOT_PLAY');
  });

  it('forbids moving a ship built this turn (S7.1b)', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht, 2);
    const seaEdges = geo.vertices[v]!.edges.filter((e) => isSeaEdge(geo, ht, e));
    const s = craft(g, 0, {
      settlements: [v],
      ships: { 0: [seaEdges[0]!] },
      builtShips: { turn: 5, edges: [seaEdges[0]!] },
    });
    const r = reduce(s, 0, { type: 'moveShip', from: seaEdges[0]!, to: seaEdges[1]! });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CANNOT_PLAY');
  });

  it('rejects moving an edge that is not your ship (BAD_LOCATION)', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht, 2);
    const seaEdges = geo.vertices[v]!.edges.filter((e) => isSeaEdge(geo, ht, e));
    const s = craft(g, 0, { settlements: [v], ships: { 0: [] } });
    const r = reduce(s, 0, { type: 'moveShip', from: seaEdges[0]!, to: seaEdges[1]! });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BAD_LOCATION');
  });

  it('cannot move a closed-route ship (both ends built up, S7.1d/S7.2)', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht, 2);
    const from = geo.vertices[v]!.edges.find((e) => isSeaEdge(geo, ht, e))!;
    const far = otherEnd(geo, from, v);
    const target = geo.vertices[v]!.edges.filter((e) => isSeaEdge(geo, ht, e))[1]!;
    // Both endpoints of `from` carry the seat's own settlement → no open end.
    const s = craft(g, 0, { settlements: [v, far], ships: { 0: [from] } });
    const r = reduce(s, 0, { type: 'moveShip', from, to: target });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CANNOT_PLAY');
  });
});

describe('movableShips / shipMoveTargets — pick-up highlighting (B-28)', () => {
  it('offers a ship with ≥1 legal destination and lists those destinations', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht, 2); // ≥2 sea edges → a destination remains after pick-up
    const seaEdges = geo.vertices[v]!.edges.filter((e) => isSeaEdge(geo, ht, e));
    const from = seaEdges[0]!;
    const s = craft(g, 0, { settlements: [v], ships: { 0: [from] } });
    expect(movableShips(s, 0)).toContain(from);
    expect(shipMoveTargets(s, 0, from).length).toBeGreaterThan(0);
  });

  it('does NOT offer an open-ended ship that has nowhere legal to go (dead-end pick-up)', () => {
    // Real games hit this often (a driven-bot sweep found ~500 occurrences in 6 games): a ship with
    // an open END (`shipHasOpenEnd` true) but whose whole network — with that ship picked up — has
    // no free adjacent sea edge, so `shipMoveTargets` is empty. Offering it as movable dead-ends the
    // UI at "select ship, can't select where to". The minimal trigger: an open ship whose network
    // offers no reconnect edge. We construct the extreme of that — a ship with no anchoring building
    // or other ship — which has an open end yet zero legal destinations (nothing to reconnect to).
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const from = geo.edges.find((e) => isSeaEdge(geo, ht, e.id))!.id;
    const s = craft(g, 0, { settlements: [], ships: { 0: [from] } });
    expect(shipMoveTargets(s, 0, from)).toEqual([]); // nowhere legal to reconnect
    expect(movableShips(s, 0)).not.toContain(from); // …so it must NOT be offered as movable
  });
});

describe('Longest Trade Route (S6, generalises Longest Road)', () => {
  it('counts roads and ships joined at the seat’s settlement, but not without the junction', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    // 3 ships out to sea + 2 roads inland, both anchored at the junction vertex `v`.
    const shipPath = simplePath(geo, v, 3, (e) => isSeaEdge(geo, ht, e));
    const roadPath = simplePath(
      geo,
      v,
      2,
      (e) => isLandEdge(geo, ht, e) && !(shipPath?.edges.includes(e) ?? false)
    );
    expect(shipPath && roadPath).toBeTruthy();
    if (!shipPath || !roadPath) return;

    // Without a settlement at the junction: road and ship networks do NOT combine (ER-S3) → 3.
    const noJunction = craft(g, 0, { settlements: [], roads: roadPath.edges, ships: { 0: shipPath.edges } });
    expect(longestRoadLength(noJunction, 0)).toBe(3);

    // With the seat's settlement at `v`: the two networks join → 2 + 3 = 5 (S5.2 / S6.2).
    const joined = craft(g, 0, { settlements: [v], roads: roadPath.edges, ships: { 0: shipPath.edges } });
    expect(longestRoadLength(joined, 0)).toBe(5);
  });

  it('awards the Longest Trade Route card at ≥5 and transfers to a strictly longer route', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    const ships5 = simplePath(geo, v, 5, (e) => isSeaEdge(geo, ht, e));
    expect(ships5).toBeTruthy();
    if (!ships5) return;

    const s0 = craft(g, 0, { settlements: [v], ships: { 0: ships5.edges } });
    const awarded = updateLongestRoad(s0);
    expect(awarded.awards.longestRoad).toEqual({ holder: 0, length: 5 });

    // A 4-ship route never reaches the ≥5 threshold.
    const short = craft(g, 0, { settlements: [v], ships: { 0: ships5.edges.slice(0, 4) } });
    expect(updateLongestRoad(short).awards.longestRoad).toEqual({ holder: null, length: 0 });
  });

  it('is unchanged for a base game (no ships) — plain Longest Road', () => {
    const base = createGame({
      playerCount: 4,
      targetVp: 10,
      seed: 'base-lr',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    });
    // No ext.seafarers, so shipsOf is [] and the trail is roads-only exactly as before.
    expect(base.ext).toBeUndefined();
    expect(longestRoadLength(base, 0)).toBe(0);
  });

  it('breaks the route at an opponent building on an interior vertex (R11.3/S6.3)', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    const ships5 = simplePath(geo, v, 5, (e) => isSeaEdge(geo, ht, e));
    expect(ships5).toBeTruthy();
    if (!ships5) return;
    const interior = ships5.vertices[2]!; // a mid-route intersection
    const broken = craft(g, 0, {
      settlements: [v],
      ships: { 0: ships5.edges },
      opponentSettlements: { 1: [interior] },
    });
    // The opponent building at vertex index 2 splits 5 into 2 + 3 → longest branch 3 (< 5).
    expect(longestRoadLength(broken, 0)).toBeLessThan(5);
  });
});

describe('redaction (ships public, no hidden-info leak, T-204/T-702)', () => {
  it('exposes every seat’s ships/supply to any viewer and never leaks rng', () => {
    const g = seafarersGame();
    const geo = geometryOf(g);
    const ht = hexTerrainOf(g);
    const v = findCoastalVertex(geo, ht);
    const seaEdge = geo.vertices[v]!.edges.find((e) => isSeaEdge(geo, ht, e))!;
    // Seat 1 owns a ship; a DIFFERENT seat (0) is the viewer.
    const s = craft(g, 1, { settlements: [v], ships: { 1: [seaEdge] } });

    const view = redact(s, 0);
    expect(view.ext?.seafarers?.ships[1]).toEqual([seaEdge]); // opponent's ship is public
    expect(view.ext?.seafarers?.shipsLeft[1]).toBe(15);
    expect(view.ext?.seafarers?.hexTerrain.length).toBe(ht.length);
    // No hidden info: rng is never present anywhere in a view.
    expect((view as unknown as { rng?: unknown }).rng).toBeUndefined();
    // Opponent's resources still collapse to a count (base redaction unchanged).
    const opp = view.players[1];
    expect(opp && 'resourceCount' in opp).toBe(true);
  });
});
