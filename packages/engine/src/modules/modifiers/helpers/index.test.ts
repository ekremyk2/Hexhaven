// helpersModule (RuleModule) integration tests (T-905): the `interceptAction`/`isActorAllowed`/
// `phaseHooks.afterAction` wiring, called DIRECTLY on crafted states. `useHelper`/`swapHelper` are
// real `Action` members (PM WIRING, packages/shared/src/types.ts) — a `HelperAction` value already
// IS an `Action`, no cast needed (see `cardModsHelpers.compose.test.ts` for the full end-to-end
// `resolveModules`/`reduce` wiring proof).

import { describe, expect, it } from 'vitest';
import type { Action, GameConfig, GameState, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../../../createGame.js';
import { helpersModule } from './index.js';
import { dealNextHelper, ensureHelpersExt, helpersExt } from './state.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'helpers-index-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

function typeOf(e: { type: string }): string {
  return e.type;
}

describe('helpersModule.interceptAction', () => {
  it('returns null for a non-helper action — falls through to normal routing', () => {
    const state = createGame(CONFIG);
    expect(helpersModule.interceptAction!(state, 0, { type: 'rollDice' })).toBeNull();
  });

  it('handles a swapHelper action end-to-end', () => {
    const g = createGame(CONFIG);
    const dealt = dealNextHelper(ensureHelpersExt(g), 0);
    const other = helpersExt(dealt.state)!.display[0]!;
    const result = helpersModule.interceptAction!(dealt.state, 0, { type: 'swapHelper', take: other });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (!result!.ok) return;
    expect(helpersExt(result!.state)!.bySeat[0]).toMatchObject({ id: other });
  });

  it('rejects any helper action during the 5-6 Special Building Phase (research §3)', () => {
    const g = createGame(CONFIG);
    const state: GameState = { ...g, phase: { kind: 'specialBuild', builder: 0 as Seat, queue: [] } };
    const result = helpersModule.interceptAction!(state, 0, { type: 'swapHelper', take: 'mayor' });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (result!.ok) return;
    expect(result!.error.code).toBe('WRONG_PHASE');
  });

  it('reroutes a bankTrade to the 2:1 Captain rate when active for that resource', () => {
    const g = createGame(CONFIG);
    const ensured = ensureHelpersExt(g);
    const ext = helpersExt(ensured)!;
    const state = {
      ...ensured,
      players: ensured.players.map((p) =>
        p.seat === 0 ? { ...p, resources: { ...p.resources, ore: p.resources.ore + 2 } } : p
      ),
      ext: { ...ensured.ext, helpers: { ...ext, captainRate: ['ore', null, null, null] } },
      phase: { kind: 'main' as const },
    } as GameState;
    const result = helpersModule.interceptAction!(state, 0, { type: 'bankTrade', give: 'ore', receive: 'wool' });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (!result!.ok) return;
    const trade = result!.events.find((ev) => typeOf(ev) === 'bankTraded');
    expect(trade).toMatchObject({ rate: 2 });
  });

  it('leaves a plain bankTrade alone when Captain is not active for that resource', () => {
    const g = createGame(CONFIG);
    const state = ensureHelpersExt(g);
    expect(helpersModule.interceptAction!(state, 0, { type: 'bankTrade', give: 'ore', receive: 'wool' })).toBeNull();
  });
});

describe('helpersModule.interceptAction — architect peek reveal (redact.ts hidden-info UX fix)', () => {
  function architectMainState(): GameState {
    const g = createGame(CONFIG);
    const ensured = ensureHelpersExt(g);
    const ext = helpersExt(ensured)!;
    const bySeat = ext.bySeat.slice();
    bySeat[0] = { id: 'architect', side: 'A', acquiredTurn: -1 };
    return {
      ...ensured,
      ext: { ...ensured.ext, helpers: { ...ext, bySeat } },
      phase: { kind: 'main' },
      turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    };
  }

  it('routes beginPeek to the peek reveal (no A/B use spent, no state beyond architectPeek)', () => {
    const state = architectMainState();
    const action: Action = { type: 'useHelper', helper: 'architect', beginPeek: true };
    const result = helpersModule.interceptAction!(state, 0, action);
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    if (!result!.ok) return;
    expect(helpersExt(result!.state)!.architectPeek[0]).toEqual(state.devDeck.slice(0, 3));
    expect(helpersExt(result!.state)!.bySeat[0]).toMatchObject({ id: 'architect', side: 'A' });
  });

  it('the pre-existing commit shape (no beginPeek field) still routes to the normal buy', () => {
    const state = architectMainState();
    const action: Action = { type: 'useHelper', helper: 'architect', pick: 0, replace: 'ore', substitute: 'wool' };
    const result = helpersModule.interceptAction!(state, 0, action);
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false); // this seat holds no resources in this fixture — CANT_AFFORD, not a routing failure
    if (result!.ok) return;
    expect(result!.error.code).toBe('CANT_AFFORD');
  });
});

describe('helpersModule.isActorAllowed', () => {
  it('permits useHelper{mayor} for a seat other than the turn owner', () => {
    const g = createGame(CONFIG);
    const action: Action = { type: 'useHelper', helper: 'mayor', resource: 'ore' };
    expect(helpersModule.isActorAllowed!(g, 1, action)).toBe(true);
  });

  it('does not extend eligibility to any other helper action, or to a non-helper action', () => {
    const g = createGame(CONFIG);
    const captain: Action = { type: 'useHelper', helper: 'captain', resource: 'ore' };
    expect(helpersModule.isActorAllowed!(g, 1, captain)).toBe(false);
    expect(helpersModule.isActorAllowed!(g, 1, { type: 'rollDice' })).toBe(false);
  });
});

describe('helpersModule.phaseHooks.afterAction', () => {
  it('lazily creates ext.helpers the first time it ever sees a state', () => {
    const g = createGame(CONFIG);
    expect(helpersExt(g)).toBeUndefined();
    const result = helpersModule.phaseHooks!.afterAction!(g, g, { type: 'rollDice' }, [], 0);
    expect(result).not.toBeNull();
    expect(helpersExt(result!.state)).toBeDefined();
  });

  it("deals a helper the instant a seat's 2nd setup settlement lands, emitting helperDealt", () => {
    const g = createGame(CONFIG);
    const prev = ensureHelpersExt(g);
    const next: GameState = {
      ...prev,
      phase: { kind: 'setup', round: 2, expect: 'road', lastSettlement: 0 as VertexId },
    };
    const action: Action = { type: 'placeSetupSettlement', vertex: 0 as VertexId };
    const result = helpersModule.phaseHooks!.afterAction!(prev, next, action, [], 2);
    expect(result).not.toBeNull();
    expect(helpersExt(result!.state)!.bySeat[2]).not.toBeNull();
    expect(result!.events.some((ev) => typeOf(ev) === 'helperDealt')).toBe(true);
  });

  it('is a no-op (no 2nd deal) if the seat already holds a helper', () => {
    const g = createGame(CONFIG);
    const dealt = dealNextHelper(ensureHelpersExt(g), 2);
    const heldBefore = helpersExt(dealt.state)!.bySeat[2];
    const next: GameState = {
      ...dealt.state,
      phase: { kind: 'setup', round: 2, expect: 'road', lastSettlement: 0 as VertexId },
    };
    const action: Action = { type: 'placeSetupSettlement', vertex: 0 as VertexId };
    const result = helpersModule.phaseHooks!.afterAction!(dealt.state, next, action, [], 2);
    // `changed` may still be true from other hooks running, but the assignment itself is untouched.
    const finalExt = result ? helpersExt(result.state)! : helpersExt(next)!;
    expect(finalExt.bySeat[2]).toEqual(heldBefore);
  });

  it("resets every seat's usedThisTurn/mayorEligible/captainRate on a genuine turn advance", () => {
    const g = createGame(CONFIG);
    const dealt = dealNextHelper(ensureHelpersExt(g), 0);
    const ext = helpersExt(dealt.state)!;
    const prev = {
      ...dealt.state,
      ext: { ...dealt.state.ext, helpers: { ...ext, usedThisTurn: [true, false, false, false] } },
      turn: { ...dealt.state.turn, number: 5 },
    } as GameState;
    const next: GameState = { ...prev, turn: { ...prev.turn, number: 6, player: 1 } };
    const result = helpersModule.phaseHooks!.afterAction!(prev, next, { type: 'endTurn' }, [], 0);
    expect(result).not.toBeNull();
    expect(helpersExt(result!.state)!.usedThisTurn).toEqual([false, false, false, false]);
  });

  it('does not reset guards when the turn number is unchanged', () => {
    const g = createGame(CONFIG);
    const dealt = dealNextHelper(ensureHelpersExt(g), 0);
    const ext = helpersExt(dealt.state)!;
    const state = {
      ...dealt.state,
      ext: { ...dealt.state.ext, helpers: { ...ext, usedThisTurn: [true, false, false, false] } },
    } as GameState;
    const result = helpersModule.phaseHooks!.afterAction!(state, state, { type: 'buildRoad', edge: 0 as never }, [], 0);
    const finalExt = result ? helpersExt(result.state)! : helpersExt(state)!;
    expect(finalExt.usedThisTurn[0]).toBe(true);
  });
});
