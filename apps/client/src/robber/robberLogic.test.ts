import { describe, expect, it } from 'vitest';
import { createGame, redact } from '@hexhaven/engine';
import type { GameConfig, GameState, Seat } from '@hexhaven/shared';
import { computeUiTargets } from '../store/uiMode';
import {
  computeDiscardModalState,
  computeGoldDialogState,
  computeStealCandidates,
  isSeafarersRobberMove,
  pendingDiscardSeats,
  shouldAutoEnterMovingRobber,
} from './robberLogic';

const SEAFARERS_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 14,
  seed: 'robber-logic-seafarers',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
};

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'robber-logic-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;
const SEAT2 = 2 as Seat;

function baseState(): GameState {
  return createGame(CONFIG);
}

describe('computeDiscardModalState (requirement 1: blocking modal math source)', () => {
  it('closed when not in the discard phase', () => {
    const g = baseState();
    const view = redact({ ...g, phase: { kind: 'preRoll' } }, SEAT0);
    expect(computeDiscardModalState(view).open).toBe(false);
  });

  it('closed for a seat not (or no longer) in phase.pending', () => {
    const g = baseState();
    const state: GameState = {
      ...g,
      phase: { kind: 'discard', pending: [SEAT1], amounts: {} as Record<Seat, number> },
    };
    const view = redact(state, SEAT0);
    expect(computeDiscardModalState(view).open).toBe(false);
  });

  it("open with the owed count + the viewer's own full hand when pending", () => {
    const g = baseState();
    const players = g.players.map((p) =>
      p.seat === SEAT0 ? { ...p, resources: { brick: 3, lumber: 2, wool: 1, grain: 1, ore: 1 } } : p,
    );
    const state: GameState = {
      ...g,
      players,
      phase: {
        kind: 'discard',
        pending: [SEAT0, SEAT1],
        amounts: { [SEAT0]: 4, [SEAT1]: 5 } as Record<Seat, number>,
      },
    };
    const view = redact(state, SEAT0);
    expect(computeDiscardModalState(view)).toEqual({
      open: true,
      required: 4,
      hand: { brick: 3, lumber: 2, wool: 1, grain: 1, ore: 1 },
    });
  });
});

describe('pendingDiscardSeats (requirement 1: "waiting for X, Y" bar visibility)', () => {
  it('null outside the discard phase', () => {
    const g = baseState();
    expect(pendingDiscardSeats(redact({ ...g, phase: { kind: 'main' } }, SEAT0))).toBeNull();
  });

  it('null for a viewer who themself owes a discard (they get the modal instead)', () => {
    const g = baseState();
    const state: GameState = {
      ...g,
      phase: { kind: 'discard', pending: [SEAT0, SEAT1], amounts: {} as Record<Seat, number> },
    };
    expect(pendingDiscardSeats(redact(state, SEAT0))).toBeNull();
  });

  it('lists the other pending seats for an unaffected viewer', () => {
    const g = baseState();
    const state: GameState = {
      ...g,
      phase: { kind: 'discard', pending: [SEAT1, SEAT2], amounts: {} as Record<Seat, number> },
    };
    expect(pendingDiscardSeats(redact(state, SEAT0))).toEqual([SEAT1, SEAT2]);
  });
});

describe('shouldAutoEnterMovingRobber (requirement 2: silent T-304 mode entry)', () => {
  it('true only for the mover, only in the moveRobber phase', () => {
    const g = baseState();
    const state: GameState = {
      ...g,
      phase: { kind: 'moveRobber', returnTo: 'main' },
      turn: { ...g.turn, player: SEAT0 },
    };
    expect(shouldAutoEnterMovingRobber(redact(state, SEAT0))).toBe(true);
    expect(shouldAutoEnterMovingRobber(redact(state, SEAT1))).toBe(false);
    expect(shouldAutoEnterMovingRobber(redact({ ...state, phase: { kind: 'main' } }, SEAT0))).toBe(false);
  });
});

describe('computeStealCandidates (requirement 3: counts only, never types)', () => {
  it("null when not the steal phase, or the viewer isn't the roller", () => {
    const g = baseState();
    const state: GameState = {
      ...g,
      phase: { kind: 'steal', candidates: [SEAT1, SEAT2], returnTo: 'main' },
      turn: { ...g.turn, player: SEAT0 },
    };
    expect(computeStealCandidates(redact(state, SEAT1))).toBeNull();
    expect(computeStealCandidates(redact({ ...state, phase: { kind: 'main' } }, SEAT0))).toBeNull();
  });

  it('lists each candidate with resourceCount only — never leaks resource identities', () => {
    const g = baseState();
    const players = g.players.map((p) => {
      if (p.seat === SEAT1) return { ...p, resources: { brick: 2, lumber: 0, wool: 0, grain: 0, ore: 0 } };
      if (p.seat === SEAT2) return { ...p, resources: { brick: 0, lumber: 0, wool: 3, grain: 0, ore: 0 } };
      return p;
    });
    const state: GameState = {
      ...g,
      players,
      phase: { kind: 'steal', candidates: [SEAT1, SEAT2], returnTo: 'main' },
      turn: { ...g.turn, player: SEAT0 },
    };
    const view = redact(state, SEAT0);
    const candidates = computeStealCandidates(view);
    expect(candidates).toEqual([
      { seat: SEAT1, resourceCount: 2 },
      { seat: SEAT2, resourceCount: 3 },
    ]);
    const serialized = JSON.stringify(candidates);
    expect(serialized).not.toContain('brick');
    expect(serialized).not.toContain('wool');
  });
});

describe('movingRobber hex targets exclude the current robber hex (T-304 integration point)', () => {
  it('offers every hex except the one the robber currently sits on', () => {
    const g = baseState();
    const state: GameState = {
      ...g,
      phase: { kind: 'moveRobber', returnTo: 'main' },
      turn: { ...g.turn, player: SEAT0 },
    };
    const { mode, targets } = computeUiTargets(state, SEAT0, 'movingRobber');
    expect(mode).toBe('hex');
    expect(targets.size).toBeGreaterThan(0);
    expect(targets.has(state.board.robber)).toBe(false);
  });
});

describe('Seafarers gold dialog + robber/pirate detection (T-705)', () => {
  it('computeGoldDialogState is closed outside the gold sub-phase', () => {
    const view = redact({ ...createGame(SEAFARERS_CONFIG), phase: { kind: 'main' } }, SEAT0);
    expect(computeGoldDialogState(view).open).toBe(false);
  });

  it('opens for a pending seat with the bank-capped owed count', () => {
    const g = createGame(SEAFARERS_CONFIG);
    const state: GameState = {
      ...g,
      phase: { kind: 'chooseGoldResource', pending: [SEAT0], owed: { 0: 2, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
    };
    const dialog = computeGoldDialogState(redact(state, SEAT0));
    expect(dialog.open).toBe(true);
    expect(dialog.required).toBe(2); // bank is full at game start, so no cap kicks in
    // A seat NOT owing a choice sees a closed dialog (blocks per-seat, like discards).
    expect(computeGoldDialogState(redact(state, SEAT1)).open).toBe(false);
  });

  it('isSeafarersRobberMove is true for the mover in a seafarers game, false in a base game', () => {
    const sea = createGame(SEAFARERS_CONFIG);
    const seaMove = redact({ ...sea, phase: { kind: 'moveRobber', returnTo: 'main' }, turn: { ...sea.turn, player: SEAT0 } }, SEAT0);
    expect(isSeafarersRobberMove(seaMove)).toBe(true);

    const base = baseState();
    const baseMove = redact({ ...base, phase: { kind: 'moveRobber', returnTo: 'main' }, turn: { ...base.turn, player: SEAT0 } }, SEAT0);
    expect(isSeafarersRobberMove(baseMove)).toBe(false);
  });
});
