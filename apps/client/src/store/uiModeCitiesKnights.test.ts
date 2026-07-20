// T-806: the Cities & Knights knight/wall board-pick modes at the pure-function layer, mirroring
// `uiModeSeafarers.test.ts`'s approach exactly — states built from a real `createGame` (citiesKnights
// on) so geometry/connectivity are authentic, never hand-faked.
import { describe, expect, it } from 'vitest';
import {
  chaseRobberHexTargets,
  chaseRobberKnights,
  createGame,
  displaceableKnights,
  knightDisplaceTargets,
  knightMoveTargets,
  legalKnightVertices,
  movableKnights,
  wallEligibleCities,
} from '@hexhaven/engine';
import { GEOMETRY, type EdgeId, type GameConfig, type GameState, type HexId, type Knight, type Seat, type VertexId } from '@hexhaven/shared';
import { computeUiTargets, isKnightPickSourcePick, pickAction, resolvePick } from './uiMode';

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 13,
  seed: 'ck-ui-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
};

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as VertexId;
const edg = (hexId: number, k: number) => h(hexId).edges[k]! as EdgeId;

const V0 = vtx(0, 0);
const V1 = vtx(0, 1);
const V2 = vtx(0, 2);
const E01 = edg(0, 0);

function baseState(overrides: Partial<GameState> = {}): GameState {
  const g = createGame(CONFIG);
  return { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true }, ...overrides };
}

function withKnights(state: GameState, knights: Knight[][]): GameState {
  const ck = state.ext!.citiesKnights!;
  return { ...state, ext: { ...state.ext, citiesKnights: { ...ck, knights } } };
}

describe('buildingKnight (C7.1)', () => {
  it('targets equal legalKnightVertices; a legal pick resolves to buildKnight', () => {
    const state = baseState({
      players: (() => {
        const g = createGame(CONFIG);
        return g.players.map((p) => (p.seat === SEAT0 ? { ...p, roads: [E01] } : p));
      })(),
    });
    const legal = legalKnightVertices(state, SEAT0);
    expect(legal.length).toBeGreaterThan(0);
    const ui = computeUiTargets(state, SEAT0, 'buildingKnight');
    expect(ui.mode).toBe('vertex');
    expect(ui.targets).toEqual(new Set(legal));
    const action = resolvePick(state, SEAT0, 'buildingKnight', legal[0]!);
    expect(action).toEqual({ type: 'buildKnight', vertex: legal[0] });
  });
});

describe('movingKnight (C7.4), two-step', () => {
  it('step 1 targets equal movableKnights; step 2 (once knightPickFrom is set) equal knightMoveTargets', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, roads: [E01] } : p));
    const state = withKnights(baseState({ players }), [[{ vertex: V0, level: 1, active: true }], [], [], []]);

    const step1 = computeUiTargets(state, SEAT0, 'movingKnight');
    expect(step1.mode).toBe('vertex');
    expect(step1.targets).toEqual(new Set(movableKnights(state, SEAT0)));
    expect(step1.targets.has(V0)).toBe(true);

    // Step 1 is a source pick, not a dispatchable action.
    expect(isKnightPickSourcePick(state, SEAT0, 'movingKnight', null, V0)).toBe(true);
    expect(pickAction(state, 'movingKnight', V0)).toBeNull();

    const step2 = computeUiTargets(state, SEAT0, 'movingKnight', null, V0);
    expect(step2.targets).toEqual(new Set(knightMoveTargets(state, SEAT0, V0)));
    expect(step2.targets.has(V1)).toBe(true);

    const action = resolvePick(state, SEAT0, 'movingKnight', V1, null, V0);
    expect(action).toEqual({ type: 'moveKnight', from: V0, to: V1 });
  });
});

describe('displacingKnight (C7.4), two-step', () => {
  it('step 1/2 equal displaceableKnights/knightDisplaceTargets; resolves to knightDisplace', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, roads: [E01] } : p));
    const state = withKnights(baseState({ players }), [
      [{ vertex: V0, level: 2, active: true }],
      [{ vertex: V1, level: 1, active: false }],
      [],
      [],
    ]);

    const step1 = computeUiTargets(state, SEAT0, 'displacingKnight');
    expect(step1.targets).toEqual(new Set(displaceableKnights(state, SEAT0)));
    expect(step1.targets.has(V0)).toBe(true);

    const step2 = computeUiTargets(state, SEAT0, 'displacingKnight', null, V0);
    expect(step2.targets).toEqual(new Set(knightDisplaceTargets(state, SEAT0, V0)));
    expect(step2.targets.has(V1)).toBe(true);

    const action = resolvePick(state, SEAT0, 'displacingKnight', V1, null, V0);
    expect(action).toEqual({ type: 'knightDisplace', from: V0, to: V1 });
  });
});

describe('chasingRobber (C7.4/C10.2), two-step', () => {
  it('step 1 targets = chaseRobberKnights; step 2 = chaseRobberHexTargets; resolves with an auto-picked stealFrom', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, roads: [E01] } : p));
    const robberHex = h(0).id as HexId;
    const ck0 = g.ext!.citiesKnights!;
    const state: GameState = {
      ...baseState({ players }),
      board: { ...g.board, robber: robberHex },
      ext: { ...g.ext, citiesKnights: { ...ck0, robberLocked: false, knights: [[{ vertex: V0, level: 1, active: true }], [], [], []] } },
    };

    const step1 = computeUiTargets(state, SEAT0, 'chasingRobber');
    expect(step1.mode).toBe('vertex');
    expect(step1.targets).toEqual(new Set(chaseRobberKnights(state, SEAT0)));
    expect(step1.targets.has(V0)).toBe(true);

    const step2 = computeUiTargets(state, SEAT0, 'chasingRobber', null, V0);
    expect(step2.mode).toBe('hex');
    expect(step2.targets).toEqual(new Set(chaseRobberHexTargets(state)));
    expect(step2.targets.has(robberHex)).toBe(false);

    const toHex = [...step2.targets][0] as HexId;
    const action = resolvePick(state, SEAT0, 'chasingRobber', toHex, null, V0);
    expect(action?.type).toBe('chaseRobber');
    if (action?.type === 'chaseRobber') {
      expect(action.knightVertex).toBe(V0);
      expect(action.toHex).toBe(toHex);
    }
  });

  it('is empty while the robber is locked', () => {
    const state = withKnights(baseState(), [[{ vertex: V0, level: 1, active: true }], [], [], []]);
    const ui = computeUiTargets(state, SEAT0, 'chasingRobber');
    expect(ui.targets.size).toBe(0);
  });
});

describe('buildingCityWall (C9.1)', () => {
  it('targets equal wallEligibleCities; a legal pick resolves to buildCityWall', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, cities: [V0] } : p));
    const state = baseState({ players });

    const legal = wallEligibleCities(state, SEAT0);
    expect(legal).toEqual([V0]);
    const ui = computeUiTargets(state, SEAT0, 'buildingCityWall');
    expect(ui.targets).toEqual(new Set(legal));
    const action = resolvePick(state, SEAT0, 'buildingCityWall', V0);
    expect(action).toEqual({ type: 'buildCityWall', vertex: V0 });
  });
});

describe('activatingKnight/promotingKnight (C7.2/C7.3)', () => {
  it('activatingKnight targets the seat\'s own inactive knights only', () => {
    const state = withKnights(baseState(), [
      [
        { vertex: V0, level: 1, active: false },
        { vertex: V1, level: 1, active: true },
      ],
      [{ vertex: V2, level: 1, active: false }],
      [],
      [],
    ]);
    const ui = computeUiTargets(state, SEAT0, 'activatingKnight');
    expect(ui.targets).toEqual(new Set([V0]));
    expect(resolvePick(state, SEAT0, 'activatingKnight', V0)).toEqual({ type: 'activateKnight', vertex: V0 });
  });

  it('promotingKnight excludes a strong knight without Fortress, includes it with Fortress', () => {
    const noFortress = withKnights(baseState(), [[{ vertex: V0, level: 2, active: false }], [], [], []]);
    expect(computeUiTargets(noFortress, SEAT0, 'promotingKnight').targets).toEqual(new Set());

    const ck0 = noFortress.ext!.citiesKnights!;
    const withFortress = {
      ...noFortress,
      ext: { ...noFortress.ext, citiesKnights: { ...ck0, improvements: ck0.improvements.map((i, s) => (s === SEAT0 ? { ...i, politics: 3 } : i)) } },
    };
    expect(computeUiTargets(withFortress, SEAT0, 'promotingKnight').targets).toEqual(new Set([V0]));
  });
});

describe('isMyDecision guard applies to every new C&K mode', () => {
  it('returns idle targets when it is not the seat\'s turn', () => {
    const state = withKnights(baseState(), [[{ vertex: V0, level: 1, active: true }], [], [], []]);
    const ui = computeUiTargets(state, SEAT1, 'movingKnight');
    expect(ui).toEqual({ mode: null, targets: new Set() });
  });
});
