// T-1108: the Explorers & Pirates (Land Ho!) board-pick modes at the pure-function layer, mirroring
// `uiModeTradersBarbarians.test.ts`'s approach exactly — states built from a real `createGame` (Land
// Ho! on) so geometry/the home-island/fog layout are authentic, never hand-faked.
import { describe, expect, it } from 'vitest';
import { createGame, isSeaEdge, movableEPShips, vertexTouchesDiscoveredLand } from '@hexhaven/engine';
import { GEOMETRY, type EdgeId, type GameConfig, type GameState, type Seat, type VertexId } from '@hexhaven/shared';
import { computeUiTargets, isEpShipMoveSourcePick, pickAction, resolvePick } from './uiMode';

const SEAT0 = 0 as Seat;

function epConfig(): GameConfig {
  return {
    playerCount: 4,
    targetVp: 10,
    seed: 'ep-ui-test',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false, explorersPirates: { scenario: 'landHo' } },
  };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  const g = createGame(epConfig());
  return { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true }, ...overrides };
}

/** Any sea edge on the Land Ho! v1 board (the outer ring / the boundary of the 7-hex home island) —
 *  used to anchor a settlement so `buildEPShip`/`epShipPlacementError`'s connectivity check passes. */
function findSeaEdge(state: GameState): { edge: EdgeId; vertex: VertexId } {
  for (const e of GEOMETRY.edges) {
    if (isSeaEdge(state, e.id)) return { edge: e.id, vertex: e.a as VertexId };
  }
  throw new Error('BUG: no sea edge found on the Land Ho! v1 board');
}

/** A COASTAL sea edge — one endpoint touches discovered land, the other is fair game — used to anchor
 *  a settler-carrying ship so `foundSettlement`'s `vertexTouchesDiscoveredLand` check can pass. */
function findCoastalSeaEdge(state: GameState): EdgeId {
  for (const e of GEOMETRY.edges) {
    if (isSeaEdge(state, e.id) && (vertexTouchesDiscoveredLand(state, e.a) || vertexTouchesDiscoveredLand(state, e.b))) {
      return e.id;
    }
  }
  throw new Error('BUG: no coastal sea edge found on the Land Ho! v1 board');
}

describe('epBuildingShip (Land Ho!, §EP3.1)', () => {
  it('targets a sea edge touching the seat\'s own settlement; a legal pick resolves to buildEPShip', () => {
    const g = createGame(epConfig());
    const { edge, vertex } = findSeaEdge(g);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [vertex] } : p));
    const state = baseState({ players });

    const ui = computeUiTargets(state, SEAT0, 'epBuildingShip');
    expect(ui.mode).toBe('edge');
    expect(ui.targets.has(edge)).toBe(true);

    const action = resolvePick(state, SEAT0, 'epBuildingShip', edge);
    expect(action).toEqual({ type: 'buildEPShip', edge });
  });

  it('empty with no coastal settlement anywhere near a sea edge', () => {
    const state = baseState();
    const ui = computeUiTargets(state, SEAT0, 'epBuildingShip');
    expect(ui.targets.size).toBe(0);
  });
});

describe('epMovingShip (Land Ho!, §EP3.2), two-step', () => {
  it('step 1 targets the seat\'s own movable ships; step 2 equals epShipMoveTargets; a legal pick resolves to moveEPShip', () => {
    const g = createGame(epConfig());
    const { edge: shipEdge } = findSeaEdge(g);
    const ext = g.ext!.explorersPirates!;
    const state = baseState({
      ext: { ...g.ext, explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge: shipEdge, cargo: [] }] } },
    });

    const step1 = computeUiTargets(state, SEAT0, 'epMovingShip');
    expect(step1.mode).toBe('edge');
    expect(step1.targets).toEqual(new Set(movableEPShips(state, SEAT0)));
    expect(step1.targets.has(shipEdge)).toBe(true);
    expect(isEpShipMoveSourcePick(state, SEAT0, 'epMovingShip', null, shipEdge)).toBe(true);
    // Step 1 is a source pick, not a dispatchable action.
    expect(pickAction(state, 'epMovingShip', shipEdge)).toBeNull();

    const step2 = computeUiTargets(state, SEAT0, 'epMovingShip', shipEdge);
    expect(step2.targets.size).toBeGreaterThan(0);
    const dest = [...step2.targets][0]! as EdgeId;
    const action = resolvePick(state, SEAT0, 'epMovingShip', dest, shipEdge);
    expect(action).toEqual({ type: 'moveEPShip', from: shipEdge, to: dest });
  });
});

describe('epFoundingSettlement (Land Ho!, §EP4.1)', () => {
  it('empty with no settler-carrying ship anywhere; a legal pick (once one exists) resolves to foundSettlement', () => {
    const emptyState = baseState();
    expect(computeUiTargets(emptyState, SEAT0, 'epFoundingSettlement').targets.size).toBe(0);

    const g = createGame(epConfig());
    const shipEdge = findCoastalSeaEdge(g);
    const ext = g.ext!.explorersPirates!;
    const state = baseState({
      ext: {
        ...g.ext,
        explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge: shipEdge, cargo: ['settler'] }] },
      },
    });

    const ui = computeUiTargets(state, SEAT0, 'epFoundingSettlement');
    expect(ui.mode).toBe('vertex');
    expect(ui.targets.size).toBeGreaterThan(0);
    // Every offered vertex must be one of the settler ship's own two endpoints.
    const shipVertices = new Set([GEOMETRY.edges[shipEdge]!.a, GEOMETRY.edges[shipEdge]!.b]);
    for (const v of ui.targets) expect(shipVertices.has(v as VertexId)).toBe(true);

    const vertex = [...ui.targets][0]! as VertexId;
    const action = resolvePick(state, SEAT0, 'epFoundingSettlement', vertex);
    expect(action).toEqual({ type: 'foundSettlement', vertex });
  });
});

describe('epUpgradingHarbor (Land Ho!, §EP4.2)', () => {
  it('targets the seat\'s own settlements; a legal pick resolves to upgradeToHarbor', () => {
    const g = createGame(epConfig());
    const { vertex } = findSeaEdge(g);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [vertex] } : p));
    const state = baseState({ players });

    const ui = computeUiTargets(state, SEAT0, 'epUpgradingHarbor');
    expect(ui.mode).toBe('vertex');
    expect(ui.targets).toEqual(new Set([vertex]));

    const action = resolvePick(state, SEAT0, 'epUpgradingHarbor', vertex);
    expect(action).toEqual({ type: 'upgradeToHarbor', vertex });
  });

  it('empty with no settlements', () => {
    const state = baseState();
    expect(computeUiTargets(state, SEAT0, 'epUpgradingHarbor').targets.size).toBe(0);
  });
});
