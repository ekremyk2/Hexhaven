// T-602 — 2022 Paired Players (X12, the alternate fiveSix turn rule) + the selector matrix. Covers:
// the "player 2" marker (third seat left of player 1) and its left-advance each round; the partial-
// turn allowed/blocked matrix (supply trade allowed, player trade blocked, ≤1 dev card, CAN win);
// the both-reach-target → player 1 wins first tiebreak; Largest Army moving via a player-2 knight;
// and the selector producing ONLY the chosen mechanic (with the field inert when fiveSix is off, and
// an invalid value rejected with a coded error).

import { describe, expect, it } from 'vitest';
import type { Action, GameConfig, GameState, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import { createGame, validateConfig } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { legalSetupRoads, legalSetupSettlements } from '../../legal.js';
import { legalSpecialBuildActions } from './common.js';

function cfg(over: Partial<GameConfig> = {}): GameConfig {
  return {
    playerCount: 6,
    targetVp: 10,
    seed: 'paired-test',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: false, citiesKnights: false },
    variants: { fiveSixTurnRule: 'pairedPlayers' },
    ...over,
  };
}

function driveSetup(state: GameState): GameState {
  let guard = 0;
  while (state.phase.kind === 'setup') {
    if (guard++ > 200) throw new Error('setup did not terminate');
    const seat = state.turn.player;
    const action: Action =
      state.phase.expect === 'settlement'
        ? { type: 'placeSetupSettlement', vertex: legalSetupSettlements(state)[0]! }
        : { type: 'placeSetupRoad', edge: legalSetupRoads(state)[0]! };
    const r = reduce(state, seat, action);
    if (!r.ok) throw new Error(`setup failed: ${r.error.code}`);
    state = r.state;
  }
  return state;
}

function give(state: GameState, seat: Seat, bundle: ResourceBundle): GameState {
  const bank = { ...state.bank };
  const players = state.players.map((p) => {
    if (p.seat !== seat) return p;
    const resources = { ...p.resources };
    for (const res of Object.keys(bundle) as ResourceType[]) {
      const n = bundle[res] ?? 0;
      resources[res] += n;
      bank[res] -= n;
    }
    return { ...p, resources };
  });
  return { ...state, players, bank };
}

/** Post-setup game forced into `owner`'s main phase (rolled). Resources are handed to individual
 *  seats per test (via `give`) so the bank is never over-drawn. */
function mainState(over: Partial<GameConfig> = {}, owner: Seat = 0): GameState {
  const state = driveSetup(createGame(cfg(over)));
  return {
    ...state,
    phase: { kind: 'main' },
    turn: { ...state.turn, player: owner, rolled: true, roll: [3, 4] },
  };
}

function apply(state: GameState, seat: Seat, action: Action): { state: GameState; events: unknown[] } {
  const r = reduce(state, seat, action);
  if (!r.ok) throw new Error(`unexpected failure ${r.error.code}: ${r.error.message}`);
  return { state: r.state, events: r.events };
}

describe('Paired Players — the "player 2" marker (X12)', () => {
  it('after player 1 ends, player 2 = third seat left takes the partial turn', () => {
    const { state, events } = apply(mainState(), 0, { type: 'endTurn' });
    expect(state.phase.kind).toBe('main'); // a partial turn is a restricted `main`, not a new phase
    expect(state.turn.player).toBe(3); // (0 + 3) % 6
    expect(state.ext?.fiveSix?.partialTurn).toEqual({ builder: 3, resumeFrom: 0 });
    expect(events.some((e) => (e as { type: string }).type === 'pairedBuildStarted')).toBe(true);
    // The SBP phase never appears in this mode.
    expect(state.phase.kind).not.toBe('specialBuild');
  });

  it('both markers advance left each round', () => {
    // Player 0's round: partial builder 3. End it → normal rotation resumes at seat 1.
    let state = apply(mainState(), 0, { type: 'endTurn' }).state;
    state = apply(state, 3, { type: 'passSpecialBuild' }).state;
    expect(state.phase.kind).toBe('preRoll');
    expect(state.turn.player).toBe(1);
    expect(state.ext?.fiveSix?.partialTurn).toBeNull();

    // Player 1's round: partial builder = (1 + 3) % 6 = 4 (both markers stepped one seat left).
    state = { ...state, phase: { kind: 'main' }, turn: { ...state.turn, rolled: true, roll: [2, 5] } };
    state = apply(state, 1, { type: 'endTurn' }).state;
    expect(state.turn.player).toBe(4);
    expect(state.ext?.fiveSix?.partialTurn).toEqual({ builder: 4, resumeFrom: 1 });
  });
});

describe('Paired Players — partial-turn allowed/blocked matrix (X12)', () => {
  it('supply trade + build + ≤1 dev card allowed; player trade / roll blocked', () => {
    const seeded = give(mainState(), 3, { brick: 6, lumber: 2, wool: 2, grain: 2, ore: 2 });
    const partial = apply(seeded, 0, { type: 'endTurn' }).state; // builder = 3
    const b: Seat = 3;

    // Allowed: a supply (bank) trade — builder holds 5 brick, rate 4, bank has ore.
    expect(reduce(partial, b, { type: 'bankTrade', give: 'brick', receive: 'ore' }).ok).toBe(true);

    // Allowed: a legal build keeps us in the partial turn (still main, marker still set).
    const road = legalSpecialBuildActions(partial, b).find((a) => a.type === 'buildRoad');
    expect(road).toBeDefined();
    const afterRoad = apply(partial, b, road!).state;
    expect(afterRoad.phase.kind).toBe('main');
    expect(afterRoad.ext?.fiveSix?.partialTurn?.builder).toBe(3);

    // Blocked: player-to-player trading, and rolling.
    for (const action of [
      { type: 'offerTrade', give: { brick: 1 }, receive: { ore: 1 } },
      { type: 'confirmTrade', with: 0 },
      { type: 'cancelTrade' },
      { type: 'rollDice' },
    ] as Action[]) {
      const r = reduce(partial, b, action);
      expect(r.ok, `${action.type} should be blocked`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('WRONG_PHASE');
    }
  });

  it('at most one development card may be played in the partial turn', () => {
    let partial = apply(mainState(), 0, { type: 'endTurn' }).state; // builder = 3
    const b: Seat = 3;
    // Hand the builder two playable monopoly cards (bought on an earlier turn).
    partial = {
      ...partial,
      players: partial.players.map((p) =>
        p.seat === b
          ? { ...p, devCards: [{ type: 'monopoly', boughtOnTurn: 0 }, { type: 'monopoly', boughtOnTurn: 0 }] }
          : p
      ),
    };
    partial = apply(partial, b, { type: 'playMonopoly', resource: 'ore' }).state;
    const second = reduce(partial, b, { type: 'playMonopoly', resource: 'wool' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('DEV_ALREADY_PLAYED');
  });

  it('player 2 CAN win on the partial turn', () => {
    // targetVp 3: builder sits at 2 VP; a city upgrade wins immediately.
    const seeded = give(mainState({ targetVp: 3, seed: 'paired-win' }), 3, { ore: 3, grain: 2 });
    const partial = apply(seeded, 0, { type: 'endTurn' }).state;
    const b: Seat = 3;
    const vertex = partial.players[b]!.settlements[0]!;
    const won = apply(partial, b, { type: 'buildCity', vertex });
    expect(won.state.phase).toEqual({ kind: 'ended', winner: 3 });
    expect(won.events.some((e) => (e as { type: string }).type === 'gameWon')).toBe(true);
  });

  it('Largest Army can move via a player-2 knight', () => {
    let partial = apply(mainState({ seed: 'paired-la' }), 0, { type: 'endTurn' }).state; // builder = 3
    const b: Seat = 3;
    partial = {
      ...partial,
      players: partial.players.map((p) =>
        p.seat === b ? { ...p, playedKnights: 2, devCards: [{ type: 'knight', boughtOnTurn: 0 }] } : p
      ),
    };
    const after = apply(partial, b, { type: 'playKnight' }).state;
    expect(after.players[b]!.playedKnights).toBe(3);
    expect(after.awards.largestArmy).toEqual({ holder: 3, count: 3 });
  });
});

describe('Paired Players — win timing: player 1 wins first (X12)', () => {
  it('player 1 reaching the target on their full turn wins before player 2 ever acts', () => {
    // targetVp 3: player 0 (player 1) and player 3 (player 2) both sit one city from winning. Player
    // 0 upgrades on their OWN turn → wins immediately; the partial turn never starts.
    const state = give(mainState({ targetVp: 3, seed: 'paired-tie' }, 0), 0, { ore: 3, grain: 2 });
    const vertex = state.players[0]!.settlements[0]!;
    const { state: after } = apply(state, 0, { type: 'buildCity', vertex });
    expect(after.phase).toEqual({ kind: 'ended', winner: 0 });
    expect(after.ext?.fiveSix?.partialTurn ?? null).toBeNull(); // no partial turn was ever opened
  });
});

describe('Selector — each rule produces only its own mechanic (X12)', () => {
  it("'sbp' opens the Special Building Phase, never a partial turn", () => {
    const state = apply(mainState({ variants: { fiveSixTurnRule: 'sbp' } }), 0, { type: 'endTurn' }).state;
    expect(state.phase.kind).toBe('specialBuild');
    expect(state.ext?.fiveSix?.partialTurn ?? null).toBeNull();
  });

  it("'pairedPlayers' opens a partial turn, never the Special Building Phase", () => {
    const state = apply(mainState({ variants: { fiveSixTurnRule: 'pairedPlayers' } }), 0, { type: 'endTurn' }).state;
    expect(state.phase.kind).not.toBe('specialBuild');
    expect(state.ext?.fiveSix?.partialTurn?.builder).toBe(3);
  });

  it('defaults to SBP when no variant is set', () => {
    const noVariant = cfg();
    delete noVariant.variants;
    let state = driveSetup(createGame(noVariant));
    state = { ...state, phase: { kind: 'main' }, turn: { ...state.turn, rolled: true, roll: [3, 4] } };
    expect(apply(state, 0, { type: 'endTurn' }).state.phase.kind).toBe('specialBuild');
  });

  it('the field is inert when fiveSix is off (no extra-build phase; normal advance)', () => {
    const baseCfg = cfg({
      playerCount: 4,
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
      variants: { fiveSixTurnRule: 'pairedPlayers' },
      seed: 'inert',
    });
    expect(validateConfig(baseCfg)).toBeNull(); // accepted — inert, not an error
    let state = driveSetup(createGame(baseCfg));
    state = { ...state, phase: { kind: 'main' }, turn: { ...state.turn, rolled: true, roll: [3, 4] } };
    const after = apply(state, 0, { type: 'endTurn' }).state;
    expect(after.phase.kind).toBe('preRoll'); // plain base advance
    expect(after.turn.player).toBe(1);
    expect(after.ext?.fiveSix?.partialTurn ?? null).toBeNull();
  });

  it('rejects an unknown turn rule with a coded error (fiveSix on)', () => {
    const bad = cfg({ variants: { fiveSixTurnRule: 'bogus' as 'sbp' } });
    const err = validateConfig(bad);
    expect(err?.code).toBe('EXPANSION_NOT_AVAILABLE');
    expect(() => createGame(bad)).toThrow();
  });
});
