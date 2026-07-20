// T-304 requirement 5 tests, at the pure-function layer (this workspace's vitest runs under the
// `node` environment — no jsdom/@testing-library, see apps/client/src/ui/primitives.test.ts's
// header comment — so DOM click/keydown simulation isn't available; the logic a real click/Escape
// would drive is exercised directly here instead):
//   - target sets match `legal.ts` for a crafted state
//   - not-your-turn (or not-your-sub-decision) computes to nothing interactive
//   - a legal pick resolves to the right `Action`; an illegal/inactive pick is ignored (`null`)
import { describe, expect, it } from 'vitest';
import { createGame, legalCityVertices, legalRoadEdges, legalRobberHexes, legalSettlementVertices, legalSetupRoads, legalSetupSettlements } from '@hexhaven/engine';
import { GEOMETRY, type EdgeId, type GameConfig, type GameState, type Seat, type VertexId } from '@hexhaven/shared';
import { computeUiTargets, isMyDecision, pickAction, resolvePick } from './uiMode';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ui-mode-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;

/** Real vertex/edge ids off the shared GEOMETRY — a vertex and one of its own incident edges, so
 * "seat0 owns a settlement here" produces a non-trivial (but real, rule-derived) legal frontier. */
const VERTEX = GEOMETRY.vertices[8]!.id;
const VERTEX_EDGE = GEOMETRY.vertices[8]!.edges[0]!;

function mainStateWithSeat0Settlement(): GameState {
  const g = createGame(CONFIG);
  const players = g.players.map((p) =>
    p.seat === SEAT0 ? { ...p, settlements: [VERTEX as VertexId] } : p,
  );
  return { ...g, players, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true } };
}

function setupRoadState(): GameState {
  const g = createGame(CONFIG);
  return {
    ...g,
    phase: { kind: 'setup', round: 1, expect: 'road', lastSettlement: VERTEX as VertexId },
    turn: { ...g.turn, player: SEAT0 },
  };
}

function robberState(): GameState {
  const g = createGame(CONFIG);
  return { ...g, phase: { kind: 'moveRobber', returnTo: 'main' }, turn: { ...g.turn, player: SEAT0 } };
}

describe('isMyDecision (requirement 3 guard rail)', () => {
  it('is true for the turn owner in an ordinary phase, false for everyone else', () => {
    const g = { ...createGame(CONFIG), turn: { ...createGame(CONFIG).turn, player: SEAT0 } };
    expect(isMyDecision(g, SEAT0)).toBe(true);
    expect(isMyDecision(g, SEAT1)).toBe(false);
  });

  it('discard phase looks at `phase.pending`, not `turn.player`', () => {
    const g = createGame(CONFIG);
    const discardState: GameState = {
      ...g,
      phase: { kind: 'discard', pending: [SEAT1], amounts: { [SEAT1]: 4 } as Record<Seat, number> },
    };
    expect(isMyDecision(discardState, SEAT1)).toBe(true);
    expect(isMyDecision(discardState, SEAT0)).toBe(false);
  });

  it('nobody decides once the game has ended', () => {
    const g = createGame(CONFIG);
    const ended: GameState = { ...g, phase: { kind: 'ended', winner: SEAT0 } };
    expect(isMyDecision(ended, SEAT0)).toBe(false);
  });
});

describe('computeUiTargets matches legal.ts (requirement 5)', () => {
  it('placingRoad (main phase) === legalRoadEdges', () => {
    const g = mainStateWithSeat0Settlement();
    const { mode, targets } = computeUiTargets(g, SEAT0, 'placingRoad');
    expect(mode).toBe('edge');
    expect(targets).toEqual(new Set(legalRoadEdges(g, SEAT0)));
    expect(targets.size).toBeGreaterThan(0);
  });

  it('placingSettlement (main phase) === legalSettlementVertices', () => {
    const g = mainStateWithSeat0Settlement();
    const { mode, targets } = computeUiTargets(g, SEAT0, 'placingSettlement');
    expect(mode).toBe('vertex');
    expect(targets).toEqual(new Set(legalSettlementVertices(g, SEAT0)));
  });

  it('placingCity === legalCityVertices (the seat\'s own settlements)', () => {
    const g = mainStateWithSeat0Settlement();
    const { mode, targets } = computeUiTargets(g, SEAT0, 'placingCity');
    expect(mode).toBe('vertex');
    expect(targets).toEqual(new Set(legalCityVertices(g, SEAT0)));
    expect(targets).toEqual(new Set([VERTEX]));
  });

  it('placingSettlement (setup phase) === legalSetupSettlements', () => {
    const g = createGame(CONFIG); // fresh: phase is setup/round1/expect settlement
    const { mode, targets } = computeUiTargets(g, SEAT0, 'placingSettlement');
    expect(mode).toBe('vertex');
    expect(targets).toEqual(new Set(legalSetupSettlements(g)));
    expect(targets.size).toBe(54); // empty board: every vertex satisfies the distance rule
  });

  it('placingRoad (setup phase) === legalSetupRoads', () => {
    const g = setupRoadState();
    const { mode, targets } = computeUiTargets(g, SEAT0, 'placingRoad');
    expect(mode).toBe('edge');
    expect(targets).toEqual(new Set(legalSetupRoads(g)));
    expect(targets.size).toBeGreaterThan(0);
  });

  it('movingRobber === legalRobberHexes', () => {
    const g = robberState();
    const { mode, targets } = computeUiTargets(g, SEAT0, 'movingRobber');
    expect(mode).toBe('hex');
    expect(targets).toEqual(new Set(legalRobberHexes(g)));
  });

  it('idle and discarding have no board target', () => {
    const g = mainStateWithSeat0Settlement();
    expect(computeUiTargets(g, SEAT0, 'idle')).toEqual({ mode: null, targets: new Set() });
    expect(computeUiTargets(g, SEAT0, 'discarding')).toEqual({ mode: null, targets: new Set() });
  });

  it('not-your-turn renders nothing interactive regardless of uiMode (requirement 3/5)', () => {
    const g = mainStateWithSeat0Settlement(); // turn.player is SEAT0
    const { mode, targets } = computeUiTargets(g, SEAT1, 'placingRoad');
    expect(mode).toBeNull();
    expect(targets.size).toBe(0);
  });
});

describe('pickAction (requirement 2: pick -> Action)', () => {
  it('placingRoad dispatches buildRoad in main phase, placeSetupRoad during setup', () => {
    const main = mainStateWithSeat0Settlement();
    expect(pickAction(main, 'placingRoad', VERTEX_EDGE)).toEqual({ type: 'buildRoad', edge: VERTEX_EDGE });

    const setup = setupRoadState();
    expect(pickAction(setup, 'placingRoad', VERTEX_EDGE)).toEqual({
      type: 'placeSetupRoad',
      edge: VERTEX_EDGE,
    });
  });

  it('placingSettlement dispatches buildSettlement in main phase, placeSetupSettlement during setup', () => {
    const main = mainStateWithSeat0Settlement();
    expect(pickAction(main, 'placingSettlement', VERTEX)).toEqual({
      type: 'buildSettlement',
      vertex: VERTEX,
    });

    const setup = createGame(CONFIG);
    expect(pickAction(setup, 'placingSettlement', VERTEX)).toEqual({
      type: 'placeSetupSettlement',
      vertex: VERTEX,
    });
  });

  it('placingCity dispatches buildCity; movingRobber dispatches moveRobber', () => {
    const main = mainStateWithSeat0Settlement();
    expect(pickAction(main, 'placingCity', VERTEX)).toEqual({ type: 'buildCity', vertex: VERTEX });

    const hex = GEOMETRY.hexes[0]!.id;
    expect(pickAction(robberState(), 'movingRobber', hex)).toEqual({ type: 'moveRobber', hex });
  });

  it('idle/discarding never produce an Action', () => {
    const main = mainStateWithSeat0Settlement();
    expect(pickAction(main, 'idle', VERTEX)).toBeNull();
    expect(pickAction(main, 'discarding', VERTEX)).toBeNull();
  });
});

describe('resolvePick (requirement 5: click legal -> Action; illegal/inactive -> ignored)', () => {
  it('a legal edge resolves to buildRoad with that exact id', () => {
    const g = mainStateWithSeat0Settlement();
    const [legalEdge] = legalRoadEdges(g, SEAT0);
    expect(legalEdge).toBeDefined();
    expect(resolvePick(g, SEAT0, 'placingRoad', legalEdge!)).toEqual({
      type: 'buildRoad',
      edge: legalEdge,
    });
  });

  it('an edge NOT in the legal set is ignored (null), even though it is a real edge id', () => {
    const g = mainStateWithSeat0Settlement();
    const legal = new Set(legalRoadEdges(g, SEAT0));
    const illegal = GEOMETRY.edges.map((e) => e.id).find((id) => !legal.has(id));
    expect(illegal).toBeDefined();
    expect(resolvePick(g, SEAT0, 'placingRoad', illegal!)).toBeNull();
  });

  it('a click during someone else\'s decision is ignored even if the id would otherwise be legal', () => {
    const g = mainStateWithSeat0Settlement();
    const [legalEdge] = legalRoadEdges(g, SEAT0);
    expect(resolvePick(g, SEAT1, 'placingRoad', legalEdge! as EdgeId)).toBeNull();
  });

  it('a legal robber hex resolves to moveRobber', () => {
    const g = robberState();
    const [legalHex] = legalRobberHexes(g);
    expect(legalHex).toBeDefined();
    expect(resolvePick(g, SEAT0, 'movingRobber', legalHex!)).toEqual({ type: 'moveRobber', hex: legalHex });
  });

  it('the robber\'s own current hex is illegal (ROBBER_SAME_HEX, R6.2) and is ignored', () => {
    const g = robberState();
    expect(resolvePick(g, SEAT0, 'movingRobber', g.board.robber)).toBeNull();
  });
});
