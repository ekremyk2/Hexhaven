// T-806: `ckActionLogic.ts`'s pure enablement helpers, exercised over real `redact(createGame(...))`
// PlayerViews — mirrors `controls/actionBarLogic.ts`'s own test file's approach (never hand-faked
// PlayerView shapes).
import { describe, expect, it } from 'vitest';
import { createGame, redact } from '@hexhaven/engine';
import { GEOMETRY, type GameConfig, type GameState, type Seat, type VertexId } from '@hexhaven/shared';
import {
  computeActivateKnightState,
  computeBuildKnightState,
  computeBuildWallState,
  computeChaseRobberState,
  computeDisplaceKnightState,
  computeImprovementState,
  computeMoveKnightState,
  computePromoteKnightState,
} from './ckActionLogic';

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;

const CK_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 13,
  seed: 'ck-action-logic-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
};

function mainPhaseState(overrides: Partial<GameState> = {}): GameState {
  const g = createGame(CK_CONFIG);
  return { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true }, ...overrides };
}

describe('computeImprovementState (C4.2/C4.3)', () => {
  it('disables with noCityOwned when the seat owns no city', () => {
    const state = mainPhaseState();
    const view = redact(state, SEAT0);
    expect(computeImprovementState(view, SEAT0, 'trade')).toEqual({ enabled: false, reason: 'noCityOwned' });
  });

  it('disables with cantAfford when the commodity is short', () => {
    const state = mainPhaseState({ players: mainPhaseState().players.map((p) => (p.seat === SEAT0 ? { ...p, cities: [0 as VertexId] } : p)) });
    const view = redact(state, SEAT0);
    const result = computeImprovementState(view, SEAT0, 'trade');
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe('cantAfford');
    expect(result.missing).toEqual({ type: 'cloth', need: 1, have: 0 });
  });

  it('enables once the seat owns a city and holds enough commodity', () => {
    const g = createGame(CK_CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, cities: [0 as VertexId] } : p));
    const ck = g.ext!.citiesKnights!;
    const commodities = ck.commodities.map((c, i) => (i === SEAT0 ? { ...c, cloth: 1 } : c));
    const state: GameState = {
      ...g,
      players,
      phase: { kind: 'main' },
      turn: { ...g.turn, player: SEAT0, rolled: true },
      ext: { ...g.ext, citiesKnights: { ...ck, commodities } },
    };
    const view = redact(state, SEAT0);
    expect(computeImprovementState(view, SEAT0, 'trade')).toEqual({ enabled: true });
  });

  it('disables with maxLevel once the track is at 5', () => {
    const g = createGame(CK_CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, cities: [0 as VertexId] } : p));
    const ck = g.ext!.citiesKnights!;
    const improvements = ck.improvements.map((imp, i) => (i === SEAT0 ? { ...imp, trade: 5 } : imp));
    const state: GameState = {
      ...g,
      players,
      phase: { kind: 'main' },
      turn: { ...g.turn, player: SEAT0, rolled: true },
      ext: { ...g.ext, citiesKnights: { ...ck, improvements } },
    };
    const view = redact(state, SEAT0);
    expect(computeImprovementState(view, SEAT0, 'trade')).toEqual({ enabled: false, reason: 'maxLevel' });
  });
});

describe('computeBuildKnightState (C7.1/C7.2)', () => {
  it('disables with noKnightSpot when the seat has no road network', () => {
    const view = redact(mainPhaseState(), SEAT0);
    expect(computeBuildKnightState(view, SEAT0)).toEqual({ enabled: false, reason: 'noKnightSpot' });
  });

  it('enables once a legal vertex exists and the seat can afford 1 wool + 1 ore', () => {
    const g = createGame(CK_CONFIG);
    const edge = GEOMETRY.hexes[0]!.edges[0]!;
    const players = g.players.map((p) =>
      p.seat === SEAT0 ? { ...p, roads: [edge], resources: { ...p.resources, wool: 1, ore: 1 } } : p,
    );
    const state = mainPhaseState({ players });
    const view = redact(state, SEAT0);
    expect(computeBuildKnightState(view, SEAT0)).toEqual({ enabled: true });
  });
});

describe('computeActivateKnightState / computePromoteKnightState (C7.2/C7.3)', () => {
  it('activate: noInactiveKnight with no inactive knight; enabled once one exists and grain is held', () => {
    const g = createGame(CK_CONFIG);
    const view0 = redact(mainPhaseState(), SEAT0);
    expect(computeActivateKnightState(view0, SEAT0)).toEqual({ enabled: false, reason: 'noInactiveKnight' });

    const ck = g.ext!.citiesKnights!;
    const knights = ck.knights.map((list, i) => (i === SEAT0 ? [{ vertex: 0 as VertexId, level: 1 as const, active: false }] : list));
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, resources: { ...p.resources, grain: 1 } } : p));
    const state = mainPhaseState({ players, ext: { ...g.ext, citiesKnights: { ...ck, knights } } });
    const view = redact(state, SEAT0);
    expect(computeActivateKnightState(view, SEAT0)).toEqual({ enabled: true });
  });

  it('promote: a basic knight (always promotable to strong) enables given 1 wool + 1 ore', () => {
    const g = createGame(CK_CONFIG);
    const ck = g.ext!.citiesKnights!;
    const knights = ck.knights.map((list, i) => (i === SEAT0 ? [{ vertex: 0 as VertexId, level: 1 as const, active: false }] : list));
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, resources: { ...p.resources, wool: 1, ore: 1 } } : p));
    const state = mainPhaseState({ players, ext: { ...g.ext, citiesKnights: { ...ck, knights } } });
    const view = redact(state, SEAT0);
    expect(computePromoteKnightState(view, SEAT0)).toEqual({ enabled: true });
  });

  it('promote: disables noPromotableKnight when the target level is already at the C7.1 cap (bug fix)', () => {
    // 2 strong knights already fill CK_KNIGHT_CAP[2] (=2); a 3rd (basic) knight has nowhere to
    // promote to, so the button must disable even though it has wool+ore and a basic normally
    // qualifies (was previously enabled here, and the engine rejected the click with KNIGHT_CAP).
    // No Fortress (politics 0, the default) — the 2 strong knights can't promote to mighty either
    // (FORTRESS_REQUIRED), so every knight on the seat is genuinely unpromotable right now.
    const g = createGame(CK_CONFIG);
    const ck = g.ext!.citiesKnights!;
    const knights = ck.knights.map((list, i) =>
      i === SEAT0
        ? [
            { vertex: 0 as VertexId, level: 1 as const, active: false },
            { vertex: 1 as VertexId, level: 2 as const, active: true },
            { vertex: 2 as VertexId, level: 2 as const, active: true },
          ]
        : list,
    );
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, resources: { ...p.resources, wool: 1, ore: 1 } } : p));
    const state = mainPhaseState({ players, ext: { ...g.ext, citiesKnights: { ...ck, knights } } });
    const view = redact(state, SEAT0);
    expect(computePromoteKnightState(view, SEAT0)).toEqual({ enabled: false, reason: 'noPromotableKnight' });
  });
});

describe('computeMoveKnightState / computeDisplaceKnightState (C7.4)', () => {
  it('report their own specific reason with no active knight', () => {
    const view = redact(mainPhaseState(), SEAT0);
    expect(computeMoveKnightState(view, SEAT0)).toEqual({ enabled: false, reason: 'noMovableKnight' });
    expect(computeDisplaceKnightState(view, SEAT0)).toEqual({ enabled: false, reason: 'noDisplaceableKnight' });
  });
});

describe('computeChaseRobberState (C7.4/C10.1/C10.2)', () => {
  it('reports robberLocked before the first attack', () => {
    const view = redact(mainPhaseState(), SEAT0);
    expect(computeChaseRobberState(view, SEAT0)).toEqual({ enabled: false, reason: 'robberLocked' });
  });

  it('reports noKnightNextToRobber once unlocked but no knight is adjacent to the robber', () => {
    const g = createGame(CK_CONFIG);
    const ck = g.ext!.citiesKnights!;
    const state = mainPhaseState({ ext: { ...g.ext, citiesKnights: { ...ck, robberLocked: false } } });
    const view = redact(state, SEAT0);
    expect(computeChaseRobberState(view, SEAT0)).toEqual({ enabled: false, reason: 'noKnightNextToRobber' });
  });
});

// Client bug fix (B-27/B-28): `phase.kind === 'main'` is true for EVERY viewer during the turn
// owner's main phase, not just the owner — these helpers must also gate on `turn.player`, exactly
// like `devcards/devCardLogic.ts`'s `computeDevPlayState` already does, so a non-owner viewer never
// sees an enabled button that would throw a not-your-turn engine error if clicked.
describe('turn-ownership gate (every compute*State disables with notYourTurn off-turn)', () => {
  it('computeImprovementState disables with notYourTurn even with a city and commodity in hand', () => {
    const g = createGame(CK_CONFIG);
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, cities: [0 as VertexId] } : p));
    const ck = g.ext!.citiesKnights!;
    const commodities = ck.commodities.map((c, i) => (i === SEAT0 ? { ...c, cloth: 1 } : c));
    const state = mainPhaseState({ players, turn: { ...g.turn, player: SEAT1, rolled: true }, ext: { ...g.ext, citiesKnights: { ...ck, commodities } } });
    const view = redact(state, SEAT0);
    expect(computeImprovementState(view, SEAT0, 'trade')).toEqual({ enabled: false, reason: 'notYourTurn' });
  });

  it('computeBuildKnightState disables with notYourTurn even with a legal vertex and resources', () => {
    const g = createGame(CK_CONFIG);
    const edge = GEOMETRY.hexes[0]!.edges[0]!;
    const players = g.players.map((p) =>
      p.seat === SEAT0 ? { ...p, roads: [edge], resources: { ...p.resources, wool: 1, ore: 1 } } : p,
    );
    const state = mainPhaseState({ players, turn: { ...g.turn, player: SEAT1, rolled: true } });
    const view = redact(state, SEAT0);
    expect(computeBuildKnightState(view, SEAT0)).toEqual({ enabled: false, reason: 'notYourTurn' });
  });

  it('computeActivateKnightState / computePromoteKnightState disable with notYourTurn', () => {
    const g = createGame(CK_CONFIG);
    const ck = g.ext!.citiesKnights!;
    const knights = ck.knights.map((list, i) => (i === SEAT0 ? [{ vertex: 0 as VertexId, level: 1 as const, active: false }] : list));
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, resources: { ...p.resources, grain: 1, wool: 1, ore: 1 } } : p));
    const state = mainPhaseState({ players, turn: { ...g.turn, player: SEAT1, rolled: true }, ext: { ...g.ext, citiesKnights: { ...ck, knights } } });
    const view = redact(state, SEAT0);
    expect(computeActivateKnightState(view, SEAT0)).toEqual({ enabled: false, reason: 'notYourTurn' });
    expect(computePromoteKnightState(view, SEAT0)).toEqual({ enabled: false, reason: 'notYourTurn' });
  });

  it('computeMoveKnightState / computeDisplaceKnightState / computeChaseRobberState / computeBuildWallState disable with notYourTurn', () => {
    const g = createGame(CK_CONFIG);
    const players = g.players.map((p) =>
      p.seat === SEAT0 ? { ...p, cities: [0 as VertexId], resources: { ...p.resources, brick: 2 } } : p,
    );
    const state = mainPhaseState({ players, turn: { ...g.turn, player: SEAT1, rolled: true } });
    const view = redact(state, SEAT0);
    expect(computeMoveKnightState(view, SEAT0)).toEqual({ enabled: false, reason: 'notYourTurn' });
    expect(computeDisplaceKnightState(view, SEAT0)).toEqual({ enabled: false, reason: 'notYourTurn' });
    expect(computeChaseRobberState(view, SEAT0)).toEqual({ enabled: false, reason: 'notYourTurn' });
    expect(computeBuildWallState(view, SEAT0)).toEqual({ enabled: false, reason: 'notYourTurn' });
  });
});

describe('computeBuildWallState (C9.1)', () => {
  it('reports noEligibleCity with no city; enabled with a city and 2 brick', () => {
    const view0 = redact(mainPhaseState(), SEAT0);
    expect(computeBuildWallState(view0, SEAT0)).toEqual({ enabled: false, reason: 'noEligibleCity' });

    const g = createGame(CK_CONFIG);
    const players = g.players.map((p) =>
      p.seat === SEAT0 ? { ...p, cities: [0 as VertexId], resources: { ...p.resources, brick: 2 } } : p,
    );
    const state = mainPhaseState({ players });
    const view = redact(state, SEAT0);
    expect(computeBuildWallState(view, SEAT0)).toEqual({ enabled: true });
  });
});
