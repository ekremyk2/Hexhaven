// Board-click targeting follow-up (Phase-9): the 8 board-target Cities & Knights progress-card
// modes at the pure-function layer, mirroring `uiModeCitiesKnights.test.ts`'s approach exactly —
// states built from a real `createGame` (citiesKnights on) so geometry/connectivity/enumerators are
// authentic, never hand-faked.
import { describe, expect, it } from 'vitest';
import {
  createGame,
  diplomatOpenRoads,
  intrigueTargets,
  knightPlacementVertices,
  merchantHexes,
  wallEligibleCities,
} from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import { GEOMETRY, type EdgeId, type GameConfig, type GameState, type HexId, type Knight, type Seat, type VertexId } from '@hexhaven/shared';
import { bishopHexes } from '../citiesKnights/ckHelpers';
import { isProgressCardStep1Pick, computeUiTargets, pickAction, resolvePick } from './uiMode';

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 13,
  seed: 'ck-progress-ui-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
};

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as VertexId;
const edg = (hexId: number, k: number) => h(hexId).edges[k]! as EdgeId;

const V0 = vtx(0, 0);
const V1 = vtx(0, 1);
const E01 = edg(0, 0);

function baseState(overrides: Partial<GameState> = {}): GameState {
  const g = createGame(CONFIG);
  return { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true }, ...overrides };
}

function withKnights(state: GameState, knights: Knight[][]): GameState {
  const ck = state.ext!.citiesKnights!;
  return { ...state, ext: { ...state.ext, citiesKnights: { ...ck, knights } } };
}

describe('ckPlayEngineer', () => {
  it('targets equal wallEligibleCities; a legal pick dispatches playProgressCard/engineer', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, cities: [V0] } : p));
    const state = baseState({ players });
    const legal = wallEligibleCities(state, SEAT0);
    expect(legal).toEqual([V0]);
    const ui = computeUiTargets(state, SEAT0, 'ckPlayEngineer');
    expect(ui).toEqual({ mode: 'vertex', targets: new Set(legal) });
    expect(resolvePick(state, SEAT0, 'ckPlayEngineer', V0)).toEqual({
      type: 'playProgressCard',
      card: 'engineer',
      vertex: V0,
    });
  });
});

describe('ckPlayMedicine', () => {
  it('targets the seat\'s own settlements (city pieces left); resolves to medicine', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [V0] } : p));
    const state = baseState({ players });
    const ui = computeUiTargets(state, SEAT0, 'ckPlayMedicine');
    expect(ui).toEqual({ mode: 'vertex', targets: new Set([V0]) });
    expect(resolvePick(state, SEAT0, 'ckPlayMedicine', V0)).toEqual({
      type: 'playProgressCard',
      card: 'medicine',
      vertex: V0,
    });
  });
});

describe('ckPlayMerchant', () => {
  it('targets equal merchantHexes; resolves to merchant', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [V0] } : p));
    const state = baseState({ players });
    const legal = merchantHexes(state, SEAT0);
    expect(legal.length).toBeGreaterThan(0);
    const ui = computeUiTargets(state, SEAT0, 'ckPlayMerchant');
    expect(ui).toEqual({ mode: 'hex', targets: new Set(legal) });
    const hex = legal[0]!;
    expect(resolvePick(state, SEAT0, 'ckPlayMerchant', hex)).toEqual({
      type: 'playProgressCard',
      card: 'merchant',
      hex,
    });
  });
});

describe('ckPlayBishop', () => {
  it('targets every hex but the robber\'s while unlocked; empty while robberLocked', () => {
    const g = createGame(CONFIG);
    const robberHex = h(0).id as HexId;
    const ck0 = g.ext!.citiesKnights!;
    const unlocked: GameState = {
      ...baseState(),
      board: { ...g.board, robber: robberHex },
      ext: { ...g.ext, citiesKnights: { ...ck0, robberLocked: false } },
    };
    const legal = bishopHexes(unlocked as unknown as PlayerView);
    const ui = computeUiTargets(unlocked, SEAT0, 'ckPlayBishop');
    expect(ui.mode).toBe('hex');
    expect(ui.targets).toEqual(new Set(legal));
    expect(ui.targets.has(robberHex)).toBe(false);
    const hex = [...ui.targets][0] as HexId;
    expect(resolvePick(unlocked, SEAT0, 'ckPlayBishop', hex)).toEqual({
      type: 'playProgressCard',
      card: 'bishop',
      hex,
    });

    const locked: GameState = { ...unlocked, ext: { ...unlocked.ext, citiesKnights: { ...ck0, robberLocked: true } } };
    expect(computeUiTargets(locked, SEAT0, 'ckPlayBishop').targets.size).toBe(0);
  });
});

describe('ckPlayDiplomat', () => {
  it('targets equal diplomatOpenRoads; resolves to diplomat', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, roads: [E01] } : p));
    const state = baseState({ players });
    const legal = diplomatOpenRoads(state);
    expect(legal.length).toBeGreaterThan(0);
    const ui = computeUiTargets(state, SEAT0, 'ckPlayDiplomat');
    expect(ui).toEqual({ mode: 'edge', targets: new Set(legal) });
    const edge = legal[0]!;
    expect(resolvePick(state, SEAT0, 'ckPlayDiplomat', edge)).toEqual({
      type: 'playProgressCard',
      card: 'diplomat',
      edge,
    });
  });
});

describe('ckPlayIntrigue', () => {
  it('targets equal intrigueTargets (opponent knights on the seat\'s own road)', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, roads: [E01] } : p));
    const withOpponentKnight = withKnights(baseState({ players }), [[], [{ vertex: V0, level: 1, active: true }], [], []]);
    const legal = intrigueTargets(withOpponentKnight, SEAT0);
    const ui = computeUiTargets(withOpponentKnight, SEAT0, 'ckPlayIntrigue');
    expect(ui).toEqual({ mode: 'vertex', targets: new Set(legal) });
    if (legal.length > 0) {
      const vertex = legal[0]!;
      expect(resolvePick(withOpponentKnight, SEAT0, 'ckPlayIntrigue', vertex)).toEqual({
        type: 'playProgressCard',
        card: 'intrigue',
        targetVertex: vertex,
      });
    }
  });
});

describe('ckPlayInventor, two-step (two DISTINCT hexes)', () => {
  it('step 1 offers every eligible hex; step 2 excludes the first pick; resolves to inventor', () => {
    const state = baseState();
    const step1 = computeUiTargets(state, SEAT0, 'ckPlayInventor');
    expect(step1.mode).toBe('hex');
    expect(step1.targets.size).toBeGreaterThan(1);

    const hexA = [...step1.targets][0] as HexId;
    // Step 1 is a source pick, not a dispatchable action.
    expect(isProgressCardStep1Pick(state, SEAT0, 'ckPlayInventor', null, hexA)).toBe(true);
    expect(pickAction(state, 'ckPlayInventor', hexA)).toBeNull();

    const step2 = computeUiTargets(state, SEAT0, 'ckPlayInventor', null, null, null, hexA);
    expect(step2.targets.has(hexA)).toBe(false);
    const hexB = [...step2.targets][0] as HexId;

    const action = resolvePick(state, SEAT0, 'ckPlayInventor', hexB, null, null, null, hexA);
    expect(action).toEqual({ type: 'playProgressCard', card: 'inventor', hexA, hexB });
  });
});

describe('ckPlayDeserter, two-step (opponent knight vertex, then own placement vertex)', () => {
  it('step 1 offers only opponent knights; step 2 offers knightPlacementVertices; resolves with the auto-derived targetSeat', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, roads: [E01] } : p));
    const state = withKnights(baseState({ players }), [[], [{ vertex: V1, level: 2, active: true }], [], []]);

    const step1 = computeUiTargets(state, SEAT0, 'ckPlayDeserter');
    expect(step1).toEqual({ mode: 'vertex', targets: new Set([V1]) });

    // Step 1 is a source pick, not a dispatchable action.
    expect(isProgressCardStep1Pick(state, SEAT0, 'ckPlayDeserter', null, V1)).toBe(true);
    expect(pickAction(state, 'ckPlayDeserter', V1)).toBeNull();

    const step2 = computeUiTargets(state, SEAT0, 'ckPlayDeserter', null, null, null, V1);
    expect(step2.mode).toBe('vertex');
    expect(step2.targets).toEqual(new Set(knightPlacementVertices(state, SEAT0)));

    const placement = [...step2.targets][0] as VertexId;
    const action = resolvePick(state, SEAT0, 'ckPlayDeserter', placement, null, null, null, V1);
    expect(action).toEqual({
      type: 'playProgressCard',
      card: 'deserter',
      targetSeat: SEAT1,
      targetVertex: V1,
      vertex: placement,
    });
  });

  it('never offers the seat\'s own knights as the step-1 pick', () => {
    const state = withKnights(baseState(), [[{ vertex: V0, level: 1, active: true }], [], [], []]);
    const ui = computeUiTargets(state, SEAT0, 'ckPlayDeserter');
    expect(ui.targets.has(V0)).toBe(false);
  });
});

describe('isMyDecision guard applies to every new progress-card mode', () => {
  it('returns idle targets when it is not the seat\'s turn', () => {
    const state = baseState();
    const ui = computeUiTargets(state, SEAT1, 'ckPlayEngineer');
    expect(ui).toEqual({ mode: null, targets: new Set() });
  });
});
