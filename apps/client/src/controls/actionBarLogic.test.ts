// T-403 requirement 6 tests, at the pure-function layer (this workspace's vitest runs under the
// `node` environment — no jsdom/@testing-library, see apps/client/src/ui/primitives.test.ts's
// header comment; `store/uiMode.test.ts` and `board/InteractionLayer.test.ts` establish the same
// split for T-304 — pure logic tested directly here, `ActionBar.test.ts` covers the rendered
// markup). Crafted `GameState`s stand in for `PlayerView` per the WIRE note this module documents.
import { describe, expect, it } from 'vitest';
import { createGame } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import type { GameConfig, GameState, Seat, VertexId } from '@hexhaven/shared';
import {
  autoSetupMode,
  computeBuildShipState,
  computeBuildState,
  computeBuyDevCardState,
  computeEndTurnState,
  computeMoveShipState,
  computeRollState,
  isSeafarersGame,
  toggleBuildMode,
} from './actionBarLogic';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'action-bar-logic-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const SEAT0 = 0 as Seat;

/** Mirrors `redact()`'s `devDeckCount: state.devDeck.length` (the one `PlayerView` field with no
 * `GameState` counterpart) so `computeBuyDevCardState`'s deck-stock check sees real data instead
 * of `undefined`. */
function asView(state: GameState): PlayerView {
  return { ...state, devDeckCount: state.devDeck.length } as unknown as PlayerView;
}

/** A main-phase state with seat 0 owning one settlement (so roads/settlements have somewhere
 * legal to go) plus full resources/pieces — callers narrow down from here per test. */
/** `createGame` starts in the `setup` phase (R3) — this fast-forwards straight to `preRoll` for
 * seat 0, since `computeRollState`/`computeEndTurnState` only ever care about `preRoll` vs `main`. */
function preRollState(): GameState {
  const g = createGame(CONFIG);
  return { ...g, phase: { kind: 'preRoll' }, turn: { ...g.turn, player: SEAT0, rolled: false } };
}

function mainState(overrides: Partial<GameState['players'][number]> = {}): GameState {
  const g = createGame(CONFIG);
  const vertex = 8 as VertexId;
  const players = g.players.map((p) =>
    p.seat === SEAT0
      ? {
          ...p,
          settlements: [vertex],
          resources: { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 },
          ...overrides,
        }
      : p,
  );
  return { ...g, players, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true } };
}

describe('computeBuildState (requirement 1/6: afford × targets × pieces matrix)', () => {
  it('enabled: affordable, pieces in stock, and a legal target exists', () => {
    const g = mainState();
    const state = computeBuildState('road', asView(g), SEAT0);
    expect(state).toEqual({ enabled: true });
  });

  it('disabled with maxRoads when out of road pieces (checked before affordability)', () => {
    const g = mainState({ piecesLeft: { roads: 0, settlements: 5, cities: 4 } });
    const state = computeBuildState('road', asView(g), SEAT0);
    expect(state).toEqual({ enabled: false, reason: 'maxRoads' });
  });

  it('disabled with maxSettlements/maxCities analogously', () => {
    const noSettlements = mainState({ piecesLeft: { roads: 15, settlements: 0, cities: 4 } });
    expect(computeBuildState('settlement', asView(noSettlements), SEAT0)).toEqual({
      enabled: false,
      reason: 'maxSettlements',
    });

    const noCities = mainState({ piecesLeft: { roads: 15, settlements: 5, cities: 0 } });
    expect(computeBuildState('city', asView(noCities), SEAT0)).toEqual({ enabled: false, reason: 'maxCities' });
  });

  it('disabled with cantAfford + the missing bundle when pieces exist but the hand is short', () => {
    const g = mainState({ resources: { brick: 0, lumber: 0, wool: 5, grain: 5, ore: 5 } });
    const state = computeBuildState('road', asView(g), SEAT0);
    expect(state).toEqual({ enabled: false, reason: 'cantAfford', missing: { brick: 1, lumber: 1 } });
  });

  it('disabled with cantAfford reporting only the short resources, not ones already held', () => {
    const g = mainState({ resources: { brick: 0, lumber: 5, wool: 5, grain: 5, ore: 5 } });
    const state = computeBuildState('road', asView(g), SEAT0);
    expect(state).toEqual({ enabled: false, reason: 'cantAfford', missing: { brick: 1 } });
  });

  it('disabled with noLegalTargets when affordable and in stock but nowhere legal to place', () => {
    // Seat 0 owns no settlements/roads anywhere -> no edge is connected to their network (R7.2).
    const g = mainState();
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [], roads: [] } : p));
    const state = computeBuildState('road', asView({ ...g, players }), SEAT0);
    expect(state).toEqual({ enabled: false, reason: 'noLegalTargets' });
  });

  it('city has no legal target when the seat owns no settlements to upgrade', () => {
    const g = mainState();
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [] } : p));
    const state = computeBuildState('city', asView({ ...g, players }), SEAT0);
    expect(state).toEqual({ enabled: false, reason: 'noLegalTargets' });
  });

  it('outside the main phase, legal.ts returns no targets, so builds read as noLegalTargets', () => {
    const g = { ...mainState(), phase: { kind: 'preRoll' as const } };
    expect(computeBuildState('road', asView(g), SEAT0)).toEqual({ enabled: false, reason: 'noLegalTargets' });
  });
});

describe('computeRollState (R4/ER-7: mandatory, exactly once)', () => {
  it('enabled in preRoll before the roll', () => {
    expect(computeRollState(asView(preRollState()))).toEqual({ enabled: true });
  });

  it('disabled once rolled', () => {
    const g = preRollState();
    expect(computeRollState(asView({ ...g, turn: { ...g.turn, rolled: true } }))).toEqual({ enabled: false });
  });

  it('disabled outside preRoll (e.g. main)', () => {
    const g = mainState();
    expect(computeRollState(asView(g))).toEqual({ enabled: false });
  });
});

describe('roll -> main transition (requirement 6)', () => {
  it('rolling flips roll disabled and build/end-turn from unavailable to their real enablement', () => {
    const preRoll = asView(preRollState());
    expect(computeRollState(preRoll).enabled).toBe(true);
    expect(computeEndTurnState(preRoll)).toEqual({ enabled: false, reason: 'notRolledYet' });

    const main = asView(mainState());
    expect(computeRollState(main).enabled).toBe(false);
    expect(computeEndTurnState(main)).toEqual({ enabled: true });
  });
});

describe('computeBuyDevCardState (R9.1: main-phase only, deck stock, affordability)', () => {
  it('disabled with notRolledYet outside the main phase', () => {
    const g = createGame(CONFIG);
    expect(computeBuyDevCardState(asView(g), SEAT0)).toEqual({ enabled: false, reason: 'notRolledYet' });
  });

  it('disabled with deckEmpty when the deck is out, even if affordable', () => {
    const g = asView({ ...mainState(), devDeck: [] });
    expect(computeBuyDevCardState(g, SEAT0)).toEqual({ enabled: false, reason: 'deckEmpty' });
  });

  it('disabled with cantAfford + missing bundle when the deck has cards but the hand is short', () => {
    const g = mainState({ resources: { brick: 5, lumber: 5, wool: 0, grain: 5, ore: 0 } });
    expect(computeBuyDevCardState(asView(g), SEAT0)).toEqual({
      enabled: false,
      reason: 'cantAfford',
      missing: { wool: 1, ore: 1 },
    });
  });

  it('enabled with cards in the deck and an affordable hand', () => {
    const g = mainState();
    expect(computeBuyDevCardState(asView(g), SEAT0)).toEqual({ enabled: true });
  });
});

describe('computeEndTurnState (R4.3: main phase only, roll is mandatory first)', () => {
  it('disabled with notRolledYet in preRoll', () => {
    expect(computeEndTurnState(asView(preRollState()))).toEqual({ enabled: false, reason: 'notRolledYet' });
  });

  it('enabled in main', () => {
    expect(computeEndTurnState(asView(mainState()))).toEqual({ enabled: true });
  });
});

describe('toggleBuildMode (requirement 1: click enters mode; second click cancels)', () => {
  it('an inactive kind enters its mode from idle', () => {
    expect(toggleBuildMode('idle', 'road')).toBe('placingRoad');
    expect(toggleBuildMode('idle', 'settlement')).toBe('placingSettlement');
    expect(toggleBuildMode('idle', 'city')).toBe('placingCity');
  });

  it('clicking the already-active kind cancels back to idle', () => {
    expect(toggleBuildMode('placingRoad', 'road')).toBe('idle');
  });

  it('clicking a different kind switches modes directly (no need to cancel first)', () => {
    expect(toggleBuildMode('placingRoad', 'settlement')).toBe('placingSettlement');
  });
});

describe('autoSetupMode (requirement 5: setup auto-enters the T-304 mode, no buttons)', () => {
  it('maps setup/expect:settlement -> placingSettlement, expect:road -> placingRoad', () => {
    expect(autoSetupMode({ kind: 'setup', round: 1, expect: 'settlement', lastSettlement: null })).toBe(
      'placingSettlement',
    );
    expect(autoSetupMode({ kind: 'setup', round: 2, expect: 'road', lastSettlement: 8 as VertexId })).toBe(
      'placingRoad',
    );
  });

  it('is null outside setup', () => {
    expect(autoSetupMode({ kind: 'preRoll' })).toBeNull();
    expect(autoSetupMode({ kind: 'main' })).toBeNull();
  });
});

// ---- Seafarers ship controls (T-705) -----------------------------------------------------------

const SEAFARERS_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 14,
  seed: 'action-bar-logic-seafarers',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
};

describe('isSeafarersGame / ship controls (T-705)', () => {
  it('isSeafarersGame is true only when ext.seafarers is present', () => {
    expect(isSeafarersGame(asView(createGame(CONFIG)))).toBe(false);
    expect(isSeafarersGame(asView(createGame(SEAFARERS_CONFIG)))).toBe(true);
  });

  it('build-ship is "notRolledYet" outside main, "maxShips" when the supply is exhausted', () => {
    const g = createGame(SEAFARERS_CONFIG);
    // preRoll: not rolled yet.
    const preRoll = asView({ ...g, phase: { kind: 'preRoll' }, turn: { ...g.turn, player: SEAT0, rolled: false } });
    expect(computeBuildShipState(preRoll, SEAT0).reason).toBe('notRolledYet');

    // main, but zero ships left → maxShips (checked before affordability).
    const noShips: GameState = {
      ...g,
      phase: { kind: 'main' },
      turn: { ...g.turn, player: SEAT0, rolled: true },
      ext: { ...g.ext, seafarers: { ...g.ext!.seafarers!, shipsLeft: g.ext!.seafarers!.shipsLeft.map(() => 0) } },
    };
    expect(computeBuildShipState(asView(noShips), SEAT0).reason).toBe('maxShips');
  });

  it('move-ship reports "shipAlreadyMoved" once a ship was moved this turn', () => {
    const g = createGame(SEAFARERS_CONFIG);
    const moved: GameState = {
      ...g,
      phase: { kind: 'main' },
      turn: { ...g.turn, player: SEAT0, rolled: true },
      ext: { ...g.ext, seafarers: { ...g.ext!.seafarers!, movedShipOnTurn: g.turn.number } },
    };
    expect(computeMoveShipState(asView(moved), SEAT0).reason).toBe('shipAlreadyMoved');
  });
});
