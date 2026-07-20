// Board-click targeting follow-up (Phase-9, Priority 2): the 4 board-target `cardMods` modes at the
// pure-function layer, mirroring `uiModeProgressCards.test.ts`'s approach — states built from a real
// `createGame` so geometry/connectivity/piece-supply are authentic, never hand-faked.
import { describe, expect, it } from 'vitest';
import { createGame, legalRoadEdges } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import { GEOMETRY, type EdgeId, type GameConfig, type GameState, type HexId, type Seat, type VertexId } from '@hexhaven/shared';
import { hexChoicesExceptRobber, unoccupiedEdges } from '../cardMods/cardModLogic';
import { computeUiTargets, isProgressCardStep1Pick, pickAction, resolvePick } from './uiMode';

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'cardmods-ui-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as VertexId;

const V0 = vtx(0, 0);

function baseState(overrides: Partial<GameState> = {}): GameState {
  const g = createGame(CONFIG);
  return { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true }, ...overrides };
}

describe('cardModTrailblazer', () => {
  it('targets equal unoccupiedEdges; a legal pick resolves to playCardModCard/trailblazer', () => {
    const state = baseState();
    const legal = unoccupiedEdges(state as unknown as PlayerView);
    const ui = computeUiTargets(state, SEAT0, 'cardModTrailblazer');
    expect(ui).toEqual({ mode: 'edge', targets: new Set(legal) });
    const edge = legal[0]!;
    expect(resolvePick(state, SEAT0, 'cardModTrailblazer', edge)).toEqual({
      type: 'playCardModCard',
      card: 'trailblazer',
      edge,
    });
  });
});

describe('cardModHighwayman', () => {
  it('targets every hex but the robber\'s; resolves to playCardModCard/highwayman', () => {
    const state = baseState();
    const legal = hexChoicesExceptRobber(state as unknown as PlayerView);
    const ui = computeUiTargets(state, SEAT0, 'cardModHighwayman');
    expect(ui).toEqual({ mode: 'hex', targets: new Set(legal) });
    expect(ui.targets.has(state.board.robber)).toBe(false);
    const hex = [...ui.targets][0] as HexId;
    expect(resolvePick(state, SEAT0, 'cardModHighwayman', hex)).toEqual({
      type: 'playCardModCard',
      card: 'highwayman',
      hex,
    });
  });
});

describe('cardModSuperSettle', () => {
  it('targets the seat\'s own settlements when a city piece is left; resolves to playCardModCombo/superSettle', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [V0] } : p));
    const state = baseState({ players });
    const ui = computeUiTargets(state, SEAT0, 'cardModSuperSettle');
    expect(ui).toEqual({ mode: 'vertex', targets: new Set([V0]) });
    expect(resolvePick(state, SEAT0, 'cardModSuperSettle', V0)).toEqual({
      type: 'playCardModCombo',
      combo: 'superSettle',
      vertex: V0,
    });
  });

  it('is empty when no city pieces are left', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) =>
      p.seat === SEAT0 ? { ...p, settlements: [V0], piecesLeft: { ...p.piecesLeft, cities: 0 } } : p,
    );
    const state = baseState({ players });
    expect(computeUiTargets(state, SEAT0, 'cardModSuperSettle').targets.size).toBe(0);
  });
});

describe('cardModRideByNight, two-step (hex then edge)', () => {
  it('step 1 offers every hex but the robber\'s; step 2 offers legal free-road spots; resolves to the combo', () => {
    // A settlement so `legalRoadEdges` has somewhere connected to offer (a fresh setup-less game has
    // no roads/settlements at all, so step 2 would otherwise be empty).
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [V0] } : p));
    const state = baseState({ players });
    const step1 = computeUiTargets(state, SEAT0, 'cardModRideByNight');
    expect(step1.mode).toBe('hex');
    expect(step1.targets.has(state.board.robber)).toBe(false);

    const hex = [...step1.targets][0] as HexId;
    // Step 1 is a source pick, not a dispatchable action.
    expect(isProgressCardStep1Pick(state, SEAT0, 'cardModRideByNight', null, hex)).toBe(true);
    expect(pickAction(state, 'cardModRideByNight', hex)).toBeNull();

    const step2 = computeUiTargets(state, SEAT0, 'cardModRideByNight', null, null, null, hex);
    expect(step2.mode).toBe('edge');
    expect(step2.targets).toEqual(new Set(legalRoadEdges({ ...state, phase: { kind: 'main' } }, SEAT0)));

    const edge = [...step2.targets][0] as EdgeId;
    const action = resolvePick(state, SEAT0, 'cardModRideByNight', edge, null, null, null, hex);
    expect(action).toEqual({ type: 'playCardModCombo', combo: 'rideByNight', hex, edge });
  });
});

describe('isMyDecision guard applies to every new cardMods mode', () => {
  it('returns idle targets when it is not the seat\'s turn', () => {
    const state = baseState();
    expect(computeUiTargets(state, SEAT1, 'cardModTrailblazer')).toEqual({ mode: null, targets: new Set() });
  });
});
