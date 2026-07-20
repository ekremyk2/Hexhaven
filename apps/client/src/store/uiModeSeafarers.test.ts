// T-705: the Seafarers board-pick modes at the pure-function layer (same node-env, no-DOM approach
// as `uiMode.test.ts`). Asserts the interaction layer's target sets mirror the engine's own ship /
// pirate enumerators, and that the two-step move-ship flow resolves to `moveShip` only once a source
// edge is chosen. States are built from a REAL Seafarers game (`createGame`) so the geometry, sea
// map and connectivity are authentic — never hand-faked.
import { describe, expect, it } from 'vitest';
import {
  createGame,
  legalPirateHexes,
  legalShipEdges,
  movableShips,
  shipMoveTargets,
} from '@hexhaven/engine';
import {
  buildGeometry,
  getScenario,
  type EdgeId,
  type GameConfig,
  type GameState,
  type Seat,
  type VertexId,
} from '@hexhaven/shared';
import { computeUiTargets, isMyDecision, isShipMoveSourcePick, pickAction, resolvePick } from './uiMode';

const SEAT0 = 0 as Seat;

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 14,
  seed: 'seafarers-ui-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
};

const GEO = buildGeometry(getScenario('headingForNewShores')!.boards[4]!.layout);

/** A fresh 4-player "Heading for New Shores" game (real scenario board + `ext.seafarers`). */
function seafarersGame(): GameState {
  return createGame(CONFIG);
}

/** A coastal main-island vertex + one of its incident sea edges, derived from the real scenario
 * terrain map — the setup a coastal settlement needs to make ship placement/movement legal. */
function coastalSpot(state: GameState): { vertex: VertexId; seaEdge: EdgeId } {
  const terrain = state.ext!.seafarers!.hexTerrain;
  for (const v of GEO.vertices) {
    const hasLand = v.hexes.some((h) => terrain[h] != null && terrain[h] !== 'sea');
    const hasSea = v.hexes.some((h) => terrain[h] === 'sea');
    if (!hasLand || !hasSea) continue;
    // A sea edge at this vertex: an incident edge that borders at least one sea hex.
    const seaEdge = v.edges.find((eid) => {
      const e = GEO.edges[eid];
      return e != null && e.hexes.some((h) => terrain[h] === 'sea');
    });
    if (seaEdge != null) return { vertex: v.id as VertexId, seaEdge: seaEdge as EdgeId };
  }
  throw new Error('no coastal spot found on the scenario board');
}

/** Seat0 has a coastal settlement, in `main` after rolling — the state ship-build reads. */
function shipBuildState(): GameState {
  const state = seafarersGame();
  const { vertex } = coastalSpot(state);
  const players = state.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [vertex] } : p));
  return { ...state, players, phase: { kind: 'main' }, turn: { ...state.turn, player: SEAT0, rolled: true } };
}

describe('computeUiTargets — Seafarers ship build (S4)', () => {
  it('placingShip targets equal the engine legal ship edges (non-empty for a coastal settlement)', () => {
    const state = shipBuildState();
    const legal = legalShipEdges(state, SEAT0);
    expect(legal.length).toBeGreaterThan(0);
    const ui = computeUiTargets(state, SEAT0, 'placingShip');
    expect(ui.mode).toBe('edge');
    expect(ui.targets).toEqual(new Set(legal));
  });

  it('a legal placingShip pick resolves to a buildShip action; an illegal edge is ignored', () => {
    const state = shipBuildState();
    const legalEdge = legalShipEdges(state, SEAT0)[0]!;
    expect(resolvePick(state, SEAT0, 'placingShip', legalEdge)).toEqual({ type: 'buildShip', edge: legalEdge });
    // An edge that is not a legal ship spot resolves to null (click ignored).
    const illegal = GEO.edges.find((e) => !new Set(legalShipEdges(state, SEAT0)).has(e.id))!.id;
    expect(resolvePick(state, SEAT0, 'placingShip', illegal)).toBeNull();
  });
});

/** Seat0 owns one open-ended ship on a coastal sea edge, in `main` — the move-ship read. */
function shipMoveState(): GameState {
  const base = shipBuildState();
  const { seaEdge } = coastalSpot(base);
  const ships = base.ext!.seafarers!.ships.map((list, seat) => (seat === SEAT0 ? [seaEdge] : list));
  return {
    ...base,
    ext: {
      ...base.ext,
      seafarers: { ...base.ext!.seafarers!, ships, movedShipOnTurn: -1, builtShips: { turn: -1, edges: [] } },
    },
  };
}

describe('computeUiTargets — Seafarers move ship, two-step (S7)', () => {
  it('step 1 (no source yet) highlights the movable ships', () => {
    const state = shipMoveState();
    const movable = movableShips(state, SEAT0);
    expect(movable.length).toBeGreaterThan(0);
    const ui = computeUiTargets(state, SEAT0, 'movingShip', null);
    expect(ui.mode).toBe('edge');
    expect(ui.targets).toEqual(new Set(movable));
  });

  it('picking a movable ship is a source pick (no action yet), not a dispatch', () => {
    const state = shipMoveState();
    const source = movableShips(state, SEAT0)[0]!;
    expect(isShipMoveSourcePick(state, SEAT0, 'movingShip', null, source)).toBe(true);
    // resolvePick returns null for the source step — the caller records the edge instead.
    expect(resolvePick(state, SEAT0, 'movingShip', source, null)).toBeNull();
  });

  it('step 2 (source chosen) highlights that ship destinations and resolves to moveShip', () => {
    const state = shipMoveState();
    const source = movableShips(state, SEAT0)[0]!;
    const dests = shipMoveTargets(state, SEAT0, source);
    const ui = computeUiTargets(state, SEAT0, 'movingShip', source);
    expect(ui.targets).toEqual(new Set(dests));
    // Once a source is armed, it's no longer treated as a source pick.
    expect(isShipMoveSourcePick(state, SEAT0, 'movingShip', source, source)).toBe(false);
    if (dests.length > 0) {
      const to = dests[0]!;
      expect(pickAction(state, 'movingShip', to, source)).toEqual({ type: 'moveShip', from: source, to });
      expect(resolvePick(state, SEAT0, 'movingShip', to, source)).toEqual({ type: 'moveShip', from: source, to });
    }
  });
});

describe('computeUiTargets — Seafarers pirate (S8)', () => {
  it('movingPirate targets equal the engine legal pirate hexes and resolve to movePirate', () => {
    const base = seafarersGame();
    const state: GameState = {
      ...base,
      phase: { kind: 'moveRobber', returnTo: 'main' },
      turn: { ...base.turn, player: SEAT0 },
    };
    const legal = legalPirateHexes(state);
    expect(legal.length).toBeGreaterThan(0);
    const ui = computeUiTargets(state, SEAT0, 'movingPirate');
    expect(ui.mode).toBe('hex');
    expect(ui.targets).toEqual(new Set(legal));
    const hex = legal[0]!;
    expect(resolvePick(state, SEAT0, 'movingPirate', hex)).toEqual({ type: 'movePirate', hex });
  });
});

describe('isMyDecision — Seafarers gold sub-phase (S9/ER-S7)', () => {
  it('is true only for a seat that still owes a gold choice', () => {
    const base = seafarersGame();
    const state: GameState = {
      ...base,
      phase: { kind: 'chooseGoldResource', pending: [SEAT0], owed: { 0: 1, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
    };
    expect(isMyDecision(state, SEAT0)).toBe(true);
    expect(isMyDecision(state, 1 as Seat)).toBe(false);
  });
});
