// T-1008: the Traders & Barbarians board-pick modes at the pure-function layer, mirroring
// `uiModeCitiesKnights.test.ts`'s approach exactly — states built from a real `createGame` (the
// relevant T&B scenario on) so geometry/connectivity are authentic, never hand-faked.
import { describe, expect, it } from 'vitest';
import {
  createGame,
  legalBridgeEdges,
  legalCamelEdges,
  legalKnightMoveTargets,
  legalKnightRecruitEdges,
  RIVERS_RIVER_EDGES,
} from '@hexhaven/engine';
import { GEOMETRY, type EdgeId, type GameConfig, type GameState, type Seat, type VertexId } from '@hexhaven/shared';
import { computeUiTargets, isTbKnightMoveSourcePick, pickAction, resolvePick } from './uiMode';

const SEAT0 = 0 as Seat;

function tbConfig(scenario: string): GameConfig {
  return {
    playerCount: 4,
    targetVp: 10,
    seed: 'tb-ui-test',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false, tradersBarbarians: { scenario } },
  };
}

function baseState(scenario: string, overrides: Partial<GameState> = {}): GameState {
  const g = createGame(tbConfig(scenario));
  return { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true }, ...overrides };
}

describe('tbBuildingBridge (Rivers, §TB3.2)', () => {
  it('targets equal legalBridgeEdges; a legal pick resolves to buildBridge', () => {
    const riverEdge = RIVERS_RIVER_EDGES[0]!;
    const edge = GEOMETRY.edges[riverEdge]!;
    const g = createGame(tbConfig('rivers'));
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [edge.a as VertexId] } : p));
    const state = baseState('rivers', { players });

    const legal = legalBridgeEdges(state, SEAT0);
    expect(legal).toContain(riverEdge);
    const ui = computeUiTargets(state, SEAT0, 'tbBuildingBridge');
    expect(ui.mode).toBe('edge');
    expect(ui.targets).toEqual(new Set(legal));

    const action = resolvePick(state, SEAT0, 'tbBuildingBridge', riverEdge);
    expect(action).toEqual({ type: 'buildBridge', edge: riverEdge });
  });
});

describe('tbExchangeFishRoad (Fishermen, §TB2.4 free-road benefit)', () => {
  it('a legal edge pick resolves to exchangeFish{benefit: freeRoad}', () => {
    const g = createGame(tbConfig('fishermen'));
    const anyEdge = GEOMETRY.edges[0]!;
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [anyEdge.a as VertexId] } : p));
    const state = baseState('fishermen', { players });

    const ui = computeUiTargets(state, SEAT0, 'tbExchangeFishRoad');
    expect(ui.mode).toBe('edge');
    expect(ui.targets.size).toBeGreaterThan(0);
    const target = [...ui.targets][0]! as EdgeId;
    const action = resolvePick(state, SEAT0, 'tbExchangeFishRoad', target);
    expect(action).toEqual({ type: 'exchangeFish', benefit: 'freeRoad', edge: target });
  });
});

describe('tbRecruitingKnight (Barbarian Attack, §TB5.2)', () => {
  it('targets equal legalKnightRecruitEdges; a legal pick resolves to recruitKnight', () => {
    const g = createGame(tbConfig('barbarianAttack'));
    const anyEdge = GEOMETRY.edges[0]!;
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [anyEdge.a as VertexId] } : p));
    const state = baseState('barbarianAttack', { players });

    const legal = legalKnightRecruitEdges(state, SEAT0);
    expect(legal.length).toBeGreaterThan(0);
    const ui = computeUiTargets(state, SEAT0, 'tbRecruitingKnight');
    expect(ui.targets).toEqual(new Set(legal));

    const action = resolvePick(state, SEAT0, 'tbRecruitingKnight', legal[0]!);
    expect(action).toEqual({ type: 'recruitKnight', edge: legal[0] });
  });
});

describe('tbMovingKnight (Barbarian Attack, §TB5.2), two-step', () => {
  it('step 1 targets the seat\'s own active knight edges; step 2 equals legalKnightMoveTargets; extension flag threads through on confirm', () => {
    const g = createGame(tbConfig('barbarianAttack'));
    const knightEdge = GEOMETRY.edges[0]!.id as EdgeId;
    const ext = g.ext!.tradersBarbarians!;
    const state = baseState('barbarianAttack', {
      ext: { ...g.ext, tradersBarbarians: { ...ext, knights: [{ seat: SEAT0, edge: knightEdge, active: true }] } },
    });

    const step1 = computeUiTargets(state, SEAT0, 'tbMovingKnight');
    expect(step1.mode).toBe('edge');
    expect(step1.targets).toEqual(new Set([knightEdge]));
    expect(isTbKnightMoveSourcePick(state, SEAT0, 'tbMovingKnight', null, knightEdge)).toBe(true);
    // Step 1 is a source pick, not a dispatchable action.
    expect(pickAction(state, 'tbMovingKnight', knightEdge)).toBeNull();

    const step2 = computeUiTargets(state, SEAT0, 'tbMovingKnight', knightEdge);
    const expectedTargets = legalKnightMoveTargets(state, SEAT0, knightEdge);
    expect(step2.targets).toEqual(new Set(expectedTargets.map((t) => t.to)));
    expect(expectedTargets.length).toBeGreaterThan(0);

    // A within-normal-range target never carries `extended`.
    const near = expectedTargets.find((t) => !t.extended)!;
    const nearAction = resolvePick(state, SEAT0, 'tbMovingKnight', near.to, knightEdge);
    expect(nearAction).toEqual({ type: 'moveBarbarianKnight', from: knightEdge, to: near.to });

    // A beyond-normal-range target (if this seed produced one within the extended range and grain
    // affordability) carries `extended: true` automatically — no separate UI toggle needed.
    const far = expectedTargets.find((t) => t.extended);
    if (far) {
      const farAction = resolvePick(state, SEAT0, 'tbMovingKnight', far.to, knightEdge);
      expect(farAction).toEqual({ type: 'moveBarbarianKnight', from: knightEdge, to: far.to, extended: true });
    }
  });
});

describe('tbPlacingCamel (Caravans, §TB4.2)', () => {
  it('targets equal legalCamelEdges; a legal pick resolves to placeCamel', () => {
    const state = baseState('caravans');
    const legal = legalCamelEdges(state);
    expect(legal.length).toBeGreaterThan(0);
    const ui = computeUiTargets(state, SEAT0, 'tbPlacingCamel');
    expect(ui.mode).toBe('edge');
    expect(ui.targets).toEqual(new Set(legal));

    const action = resolvePick(state, SEAT0, 'tbPlacingCamel', legal[0]!);
    expect(action).toEqual({ type: 'placeCamel', edge: legal[0] });
  });
});
