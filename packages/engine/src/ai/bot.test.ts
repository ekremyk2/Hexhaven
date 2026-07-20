// T-410 requirement 1 tests: `chooseAction` always returns a LEGAL action for every decision point,
// is deterministic/replayable given the same `(view, rng, opts)`, and never reads a field absent
// from its `PlayerView` input.

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerState, ResourceBundle, Seat } from '@hexhaven/shared';
import { legalSetupSettlements } from '../legal.js';
import { redact } from '../redact.js';
import type { PlayerView } from '../redact.js';
import { reduce } from '../reduce.js';
import { hashSeed } from '../rng.js';
import { stateWith } from '../testkit.js';
import { chooseAction } from './bot.js';

const TEST_BUDGET = 12;

/** `stateWith`'s `players` override REPLACES the whole array wholesale (docs/05 §4 / testkit.ts's
 * DeepPartial note on arrays) — patching a single seat while leaving the rest of the roster intact
 * needs a map over the FULL array, same helper shape legal.test.ts uses. */
function withPlayer(state: GameState, seat: Seat, patch: Partial<PlayerState>): GameState {
  return { ...state, players: state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p)) };
}

/** Every seat cleared of buildings/roads (full piece supply restored) — used by the setup-phase
 * tests so `legalSetupSettlements`'s distance-rule scan isn't fighting the testkit base's mid-game
 * buildings. */
function clearedBoard(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      settlements: [],
      cities: [],
      roads: [],
      piecesLeft: { roads: 15, settlements: 5, cities: 4 },
    })),
  };
}

function view(state: GameState, seat: Seat): PlayerView {
  return redact(state, seat);
}

/** Every state built here is checked the same way: `chooseAction` must return an action `reduce`
 * accepts for the ACTING seat (never merely "some legal-looking shape"). */
function expectLegal(state: GameState, seat: Seat): void {
  const v = view(state, seat);
  const { action } = chooseAction(v, hashSeed(`bot-legality-${state.phase.kind}-${seat}`), { budget: TEST_BUDGET });
  const result = reduce(state, seat, action);
  expect(
    result.ok,
    `expected a legal action, got ${JSON.stringify(action)} -> ${!result.ok ? result.error.code : ''}`
  ).toBe(true);
}

describe('chooseAction — legality across every decision point (task requirement 1)', () => {
  it('setup: settlement placement', () => {
    const s: GameState = {
      ...clearedBoard(stateWith()),
      phase: { kind: 'setup', round: 1, expect: 'settlement', lastSettlement: null },
      turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
    };
    expectLegal(s, 0);
  });

  it('setup: road placement', () => {
    const base: GameState = {
      ...clearedBoard(stateWith()),
      phase: { kind: 'setup', round: 1, expect: 'settlement', lastSettlement: null },
      turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
    };
    const vertex = legalSetupSettlements(base)[0]!;
    const placed = reduce(base, 0, { type: 'placeSetupSettlement', vertex });
    if (!placed.ok) throw new Error('BUG: test fixture setup failed');
    expectLegal(placed.state, 0);
  });

  it('preRoll: roll or a dev-card play', () => {
    const s: GameState = {
      ...stateWith(),
      phase: { kind: 'preRoll' },
      turn: { number: 5, player: 0, rolled: false, roll: null, devPlayed: false },
    };
    expectLegal(s, 0);
  });

  it('moveRobber', () => {
    const s: GameState = { ...stateWith(), phase: { kind: 'moveRobber', returnTo: 'main' } };
    expectLegal(s, 0);
  });

  it('steal', () => {
    const s: GameState = {
      ...withPlayer(stateWith(), 1, { resources: { brick: 2, lumber: 0, wool: 0, grain: 0, ore: 0 } }),
      phase: { kind: 'steal', candidates: [1 as Seat], returnTo: 'main' },
    };
    expectLegal(s, 0);
  });

  it('discard', () => {
    const s: GameState = {
      ...withPlayer(stateWith(), 0, { resources: { brick: 3, lumber: 3, wool: 2, grain: 0, ore: 0 } }),
      phase: { kind: 'discard', pending: [0 as Seat], amounts: { 0: 4, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
    };
    expectLegal(s, 0);
  });

  it('roadBuilding', () => {
    const s: GameState = { ...stateWith(), phase: { kind: 'roadBuilding', remaining: 2 } };
    expectLegal(s, 0);
  });

  it('main: build/trade/dev-card decision', () => {
    const s = stateWith();
    expectLegal(s, 0);
  });

  it('pending trade response (a non-owner seat while an offer is open)', () => {
    const give: ResourceBundle = { brick: 1 };
    const receive: ResourceBundle = { ore: 1 };
    const s: GameState = { ...stateWith(), trade: { give, receive, responses: {} } };
    expectLegal(s, 1); // seat 1 is not the turn owner (seat 0) — must respondTrade
  });
});

describe('chooseAction — determinism / replay (task requirement 1)', () => {
  it('the same (view, rng, budget) always returns the identical action and rng', () => {
    const s = stateWith();
    const v = view(s, 0);
    const rng = hashSeed('bot-determinism');
    const a = chooseAction(v, rng, { budget: TEST_BUDGET });
    const b = chooseAction(v, rng, { budget: TEST_BUDGET });
    expect(a).toEqual(b);
  });

  it('a full replay of a sequence of decisions reproduces the same trajectory', () => {
    function run(): { action: unknown }[] {
      let state: GameState = {
        ...stateWith(),
        phase: { kind: 'preRoll' },
        turn: { number: 5, player: 0, rolled: false, roll: null, devPlayed: false },
      };
      let rng = hashSeed('bot-replay');
      const trail: { action: unknown }[] = [];
      for (let i = 0; i < 5 && state.phase.kind !== 'ended'; i++) {
        const v = view(state, state.turn.player);
        const decision = chooseAction(v, rng, { budget: TEST_BUDGET });
        rng = decision.rng;
        trail.push({ action: decision.action });
        const result = reduce(state, state.turn.player, decision.action);
        if (!result.ok) break;
        state = result.state;
      }
      return trail;
    }

    expect(run()).toEqual(run());
  });
});

describe('chooseAction — fairness boundary (task requirement 1)', () => {
  it('never reads resources/devCards off another seat while deciding', () => {
    const s = stateWith();
    const v = view(s, 0);
    const guarded: PlayerView = {
      ...v,
      players: v.players.map((entry) =>
        entry.seat === v.me
          ? entry
          : new Proxy(entry, {
              get(target, prop) {
                if (prop === 'resources' || prop === 'devCards') {
                  throw new Error(`FAIRNESS VIOLATION: read hidden field '${String(prop)}' from an OtherPlayerView`);
                }
                return Reflect.get(target, prop);
              },
            })
      ),
    };
    expect(() => chooseAction(guarded, hashSeed('bot-fairness'), { budget: TEST_BUDGET })).not.toThrow();
  });

  it('the exported signature only accepts a PlayerView — no GameState field is reachable without a cast', () => {
    const s = stateWith();
    // `redact` is the ONLY supported way to build a PlayerView from a GameState (T-204). This
    // closure is never CALLED (a raw GameState doesn't structurally satisfy PlayerView — `.me` is
    // absent, `players[].resources` is present on every seat where a real PlayerView would omit it
    // for anyone but the viewer — so invoking it would just throw for the wrong reason); the
    // `@ts-expect-error` below is the actual assertion: if `chooseAction`'s signature ever widened
    // to accept a full `GameState`, this directive itself would fail typecheck as "unused".
    const typeCheckOnly = (): ReturnType<typeof chooseAction> =>
      // @ts-expect-error chooseAction must not structurally accept a full GameState.
      chooseAction(s, hashSeed('bot-typeboundary'), { budget: TEST_BUDGET });
    expect(typeof typeCheckOnly).toBe('function');
  });
});

describe("chooseAction — resolving the bot's OWN open domestic offer (B-21 re-enabled)", () => {
  /** Owner = seat 0 (holds brick), offering brick→wool. Seat 1 holds wool (so its accept is valid). */
  function offerState(responses: Partial<Record<Seat, 'accepted' | 'declined'>>): GameState {
    let s = withPlayer(stateWith(), 0, { resources: { brick: 3, lumber: 0, wool: 0, grain: 0, ore: 0 } });
    s = withPlayer(s, 1, { resources: { brick: 0, lumber: 0, wool: 2, grain: 0, ore: 0 } });
    return {
      ...s,
      turn: { ...s.turn, player: 0, rolled: true },
      phase: { kind: 'main' },
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses },
    };
  }

  it('confirms an accepter (and the action is legal)', () => {
    const s = offerState({ 1: 'accepted' });
    const { action } = chooseAction(view(s, 0), hashSeed('confirm'), { budget: TEST_BUDGET });
    expect(action).toEqual({ type: 'confirmTrade', with: 1 });
    expect(reduce(s, 0, action).ok).toBe(true);
  });

  it('cancels when every responder declined (accepts the denial, no re-offer loop)', () => {
    const s = offerState({ 1: 'declined', 2: 'declined', 3: 'declined' });
    const { action } = chooseAction(view(s, 0), hashSeed('cancel'), { budget: TEST_BUDGET });
    expect(action).toEqual({ type: 'cancelTrade' });
    expect(reduce(s, 0, action).ok).toBe(true);
  });
});
