// Board-click targeting follow-up (Phase-9, Priority 3): the 3 board-target "Helpers of Hexhaven" modes
// at the pure-function layer, mirroring `uiModeCardMods.test.ts`'s approach — states built from a
// real `createGame` so geometry/connectivity are authentic, never hand-faked.
import { describe, expect, it } from 'vitest';
import { createGame } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import { GEOMETRY, type EdgeId, type GameConfig, type GameState, type Seat, type VertexId } from '@hexhaven/shared';
import { explorerFromChoices, roadTargetChoices } from '../helpers/helpersLogic';
import { computeUiTargets, isProgressCardStep1Pick, pickAction, resolvePick } from './uiMode';

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'helpers-ui-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as VertexId;
const edg = (hexId: number, k: number) => h(hexId).edges[k]! as EdgeId;

const V0 = vtx(0, 0);
const E01 = edg(0, 0);

function baseState(overrides: Partial<GameState> = {}): GameState {
  const g = createGame(CONFIG);
  return { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true }, ...overrides };
}

describe('helperExplorer, two-step (edge then edge)', () => {
  it('step 1 offers the seat\'s own roads; step 2 offers legal free-road spots excluding the source; resolves to useHelper/explorer', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, roads: [E01] } : p));
    const state = baseState({ players });

    const pv = state as unknown as PlayerView;
    const step1 = computeUiTargets(state, SEAT0, 'helperExplorer');
    expect(step1).toEqual({ mode: 'edge', targets: new Set(explorerFromChoices(pv, SEAT0)) });
    expect(step1.targets.has(E01)).toBe(true);

    // Step 1 is a source pick, not a dispatchable action.
    expect(isProgressCardStep1Pick(state, SEAT0, 'helperExplorer', null, E01)).toBe(true);
    expect(pickAction(state, 'helperExplorer', E01)).toBeNull();

    const step2 = computeUiTargets(state, SEAT0, 'helperExplorer', null, null, null, E01);
    expect(step2.mode).toBe('edge');
    expect(step2.targets.has(E01)).toBe(false);
    expect(step2.targets).toEqual(new Set(roadTargetChoices(pv, SEAT0).filter((e) => e !== E01)));

    const to = [...step2.targets][0] as EdgeId;
    const action = resolvePick(state, SEAT0, 'helperExplorer', to, null, null, null, E01);
    expect(action).toEqual({ type: 'useHelper', helper: 'explorer', from: E01, to });
  });
});

describe('helperPriestSettlement / helperPriestCity', () => {
  it('offers the seat\'s legal settlement spots; resolves to useHelper/priest build:settlement', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, roads: [E01] } : p));
    const state = baseState({ players });
    const ui = computeUiTargets(state, SEAT0, 'helperPriestSettlement');
    expect(ui.mode).toBe('vertex');
    if (ui.targets.size > 0) {
      const vertex = [...ui.targets][0] as VertexId;
      expect(resolvePick(state, SEAT0, 'helperPriestSettlement', vertex)).toEqual({
        type: 'useHelper',
        helper: 'priest',
        build: 'settlement',
        vertex,
      });
    }
  });

  it('offers the seat\'s own settlements (with a city piece left) for the city upgrade', () => {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [V0] } : p));
    const state = baseState({ players });
    const ui = computeUiTargets(state, SEAT0, 'helperPriestCity');
    expect(ui).toEqual({ mode: 'vertex', targets: new Set([V0]) });
    expect(resolvePick(state, SEAT0, 'helperPriestCity', V0)).toEqual({
      type: 'useHelper',
      helper: 'priest',
      build: 'city',
      vertex: V0,
    });
  });
});

describe('isMyDecision guard applies to every new helpers mode', () => {
  it('returns idle targets when it is not the seat\'s turn', () => {
    const state = baseState();
    expect(computeUiTargets(state, SEAT1, 'helperExplorer')).toEqual({ mode: null, targets: new Set() });
  });
});
