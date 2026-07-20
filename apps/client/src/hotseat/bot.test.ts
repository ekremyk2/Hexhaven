// Direct coverage of `pickBotAction` across a few phases (localTransport.test.ts already exercises
// `runBotUntilSeat`/`playBotMove` end-to-end through the real transport for the task's required
// "bot-until terminates" scenario — these are unit-level checks on the picker itself).
import { describe, expect, it } from 'vitest';
import { createGame, reduce } from '@hexhaven/engine';
import { stateWith } from '@hexhaven/engine/testkit';
import type { GameConfig, GameState, Seat } from '@hexhaven/shared';
import { computeActiveSeat } from './localTransport';
import { pickBotAction } from './bot';

describe('pickBotAction', () => {
  it('always proposes rollDice in preRoll', () => {
    const state = stateWith({ phase: { kind: 'preRoll' }, turn: { rolled: false } });
    expect(pickBotAction(state, 0 as Seat)).toEqual({ type: 'rollDice' });
  });

  it('picks a legal, owed-count discard in the discard phase', () => {
    const base = stateWith({ phase: { kind: 'discard', pending: [0], amounts: { 0: 2 } } });
    // `players` is an array — the testkit's `deepMerge` replaces arrays wholesale (never merges
    // elements), so overriding just one seat's `resources` has to happen by hand, not through
    // `stateWith`'s overrides parameter.
    const state = {
      ...base,
      players: base.players.map((p) =>
        p.seat === 0 ? { ...p, resources: { brick: 3, lumber: 2, wool: 0, grain: 0, ore: 0 } } : p,
      ),
    };
    const action = pickBotAction(state, 0 as Seat);
    expect(action?.type).toBe('discard');
    if (action?.type === 'discard') {
      const total = Object.values(action.cards).reduce((sum, n) => sum + (n ?? 0), 0);
      expect(total).toBe(2);
    }
  });

  it('returns a build/buy/trade/endTurn action in main phase, never null', () => {
    const state = stateWith({ phase: { kind: 'main' } });
    const action = pickBotAction(state, 0 as Seat);
    expect(action).not.toBeNull();
  });

  it('proposes a free-road placement for the roadBuilding phase (B-caravan-vote-bots: legalFreeRoadEdges is a public @hexhaven/engine export, no longer null)', () => {
    const state = stateWith({ phase: { kind: 'roadBuilding', remaining: 2 } });
    const action = pickBotAction(state, 0 as Seat);
    expect(action?.type).toBe('placeFreeRoad');
  });

  it('proposes a chooseGoldResource pick matching the owed count (B-caravan-vote-bots)', () => {
    const state = stateWith({
      phase: { kind: 'chooseGoldResource', pending: [0] as Seat[], owed: { 0: 2 } as Record<Seat, number> },
    });
    const action = pickBotAction(state, 0 as Seat);
    expect(action?.type).toBe('chooseGoldResource');
    if (action?.type === 'chooseGoldResource') {
      const total = Object.values(action.picks).reduce((sum, n) => sum + (n ?? 0), 0);
      expect(total).toBe(2);
    }
  });

  it('returns null once the game has ended', () => {
    const state = stateWith({ phase: { kind: 'ended', winner: 0 as Seat } });
    expect(pickBotAction(state, 0 as Seat)).toBeNull();
  });

  it('proposes an accept/decline respondTrade for a non-owner seat while an offer is open', () => {
    const state = stateWith({
      phase: { kind: 'main' },
      turn: { player: 0 },
      trade: { give: { brick: 1 }, receive: { wool: 1 }, responses: {} },
    });
    const action = pickBotAction(state, 1 as Seat);
    expect(action?.type).toBe('respondTrade');
  });
});

// ---- Caravans (§TB4.2, T-1004) — B-caravan-vote-bots -----------------------------------------------
// Before this fix `pickBotAction` returned `null` for EVERY `caravanVote` seat (the file's own header
// comment said so explicitly: "left to manual play — full caravans UI is T-1008's"), and
// `computeActiveSeat` had no `caravanVote` case at all, so it fell back to `turn.player` — who stops
// being a pending bidder the instant they bid. Together a Caravans hot-seat game with bots hard-
// stalled the moment a settlement opened a vote: nobody was ever correctly targeted, so
// `runBotUntilSeat` immediately hit `noLegalAction`.
describe('pickBotAction: caravanVote (§TB4.2, T-1004, B-caravan-vote-bots)', () => {
  it('always abstains {grain:0, wool:0} for a still-pending bidder, even when seat !== turn.player', () => {
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: { kind: 'caravanVote', builder: 0 as Seat, pending: [1, 2, 3] as Seat[], bids: { 0: 0 }, winner: null },
    });
    expect(pickBotAction(state, 2 as Seat)).toEqual({ type: 'caravanVote', grain: 0, wool: 0 });
  });

  it('places a camel for the resolved winner once pending is empty, even when winner !== turn.player', () => {
    const state = {
      ...stateWith({
        turn: { player: 0 as Seat },
        phase: {
          kind: 'caravanVote',
          builder: 0 as Seat,
          pending: [] as Seat[],
          bids: { 0: 0, 1: 3, 2: 0, 3: 0 },
          winner: 1 as Seat,
        },
      }),
      // `ext` isn't a plain-object-mergeable path stateWith's overrides handle well for a brand-new
      // key on the testkit's non-caravans base, so it's set directly (mirrors bot.test.ts's own
      // "players is an array, override by hand" precedent above for the same deepMerge limitation).
      ext: { tradersBarbarians: { scenario: 'caravans', oasisHex: 2, routeEdges: [10, 11, 12, 13], camels: [] } },
    } as unknown as GameState;
    const action = pickBotAction(state, 1 as Seat);
    expect(action?.type).toBe('placeCamel');
  });

  it('returns null for a seat that is neither pending nor the winner (defensive; unreachable via computeActiveSeat)', () => {
    const state = stateWith({
      turn: { player: 0 as Seat },
      phase: { kind: 'caravanVote', builder: 0 as Seat, pending: [1] as Seat[], bids: { 0: 0 }, winner: null },
    });
    expect(pickBotAction(state, 2 as Seat)).toBeNull();
  });
});

describe('caravanVote end-to-end: driven to RESOLUTION without stalling (B-caravan-vote-bots)', () => {
  const CARAVANS_CONFIG: GameConfig = {
    playerCount: 4,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    seed: 'caravan-bot-resolution-1',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'caravans' },
    },
  };

  it('all-bot vote: every pending seat bids and the vote resolves back to main, with no noLegalAction stall', () => {
    const created = createGame(CARAVANS_CONFIG);
    // A real caravans game state (real `ext.tradersBarbarians` from `initialCaravansExt`), with the
    // vote forced open for all 4 seats — mirrors how `maybeOpenCaravanVote` opens it after a
    // qualifying build, without needing to actually play through setup + a mid-game settlement.
    let state: GameState = {
      ...created,
      phase: { kind: 'caravanVote', builder: 0 as Seat, pending: [0, 1, 2, 3] as Seat[], bids: {}, winner: null },
    };

    let guard = 0;
    while (state.phase.kind === 'caravanVote' && guard < 10) {
      const seat = computeActiveSeat(state);
      const action = pickBotAction(state, seat);
      expect(action).not.toBeNull(); // the exact "noLegalAction" stall this bug produced.
      const result = reduce(state, seat, action!);
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
      guard += 1;
    }

    expect(state.phase.kind).toBe('main'); // resolved — the vote never got stuck.
    expect(guard).toBe(4); // exactly the 4 seats' bids (all-abstain resolves with no placeCamel step).
  });
});
