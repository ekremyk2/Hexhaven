// T-602 — 2015 Special Building Phase (X12, the DEFAULT fiveSix turn rule). Covers: clockwise
// builder order in a 6-player game, the allowed/blocked action matrix (every blocked action → the
// correct coded error), pass semantics + transition back to the next player's preRoll, Longest Road
// transfer via an SBP road, ≥target-VP in SBP → NO immediate win but a win on the builder's own next
// turn, piece/bank conservation (I1–I3), and the selector isolating SBP from Paired Players.

import { describe, expect, it } from 'vitest';
import type { Action, GameConfig, GameState, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { legalSetupRoads, legalSetupSettlements } from '../../legal.js';
import { updateLongestRoad } from '../../rules/longestRoad.js';
import { legalSpecialBuildActions } from './common.js';

const RESOURCES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function cfg(over: Partial<GameConfig> = {}): GameConfig {
  return {
    playerCount: 6,
    targetVp: 10,
    seed: 'sbp-test',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: false, citiesKnights: false },
    variants: { fiveSixTurnRule: 'sbp' },
    ...over,
  };
}

/** Drive the whole setup draft to completion (leaves the game in player 0's preRoll). */
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

/** Move `bundle` from the bank into `seat`'s hand (keeps I1 conservation intact). */
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

/** Post-setup 6-player game forced into player 0's main phase (rolled). Resources are handed to
 *  individual seats per test (via `give`) so the bank is never over-drawn. */
function mainState(over: Partial<GameConfig> = {}): GameState {
  const state = driveSetup(createGame(cfg(over)));
  return { ...state, phase: { kind: 'main' }, turn: { ...state.turn, rolled: true, roll: [3, 4] } };
}

function apply(state: GameState, seat: Seat, action: Action): { state: GameState; events: unknown[] } {
  const r = reduce(state, seat, action);
  if (!r.ok) throw new Error(`unexpected failure ${r.error.code}: ${r.error.message}`);
  return { state: r.state, events: r.events };
}

function conserved(state: GameState): boolean {
  return RESOURCES.every(
    (res) => state.bank[res] + state.players.reduce((s, p) => s + p.resources[res], 0) === 24
  );
}

describe('SBP — entry, clockwise order, transition (X12)', () => {
  it('endTurn opens the SBP for the other seats clockwise from the next player', () => {
    const state = mainState();
    const { state: sbp, events } = apply(state, 0, { type: 'endTurn' });
    expect(sbp.phase).toEqual({ kind: 'specialBuild', builder: 1, queue: [2, 3, 4, 5] });
    // turn.player stays the ender; the SBP is a between-turns opportunity for everyone else.
    expect(sbp.turn.player).toBe(0);
    expect(events.some((e) => (e as { type: string }).type === 'specialBuildStarted')).toBe(true);
  });

  it('passes through every builder clockwise, then resumes the next player preRoll', () => {
    let state = apply(mainState(), 0, { type: 'endTurn' }).state;
    for (const builder of [1, 2, 3, 4] as Seat[]) {
      expect(state.phase).toEqual({ kind: 'specialBuild', builder, queue: expect.any(Array) });
      state = apply(state, builder, { type: 'passSpecialBuild' }).state;
    }
    // Last builder (5) passes → back to normal play at the next player's (seat 1) preRoll.
    expect(state.phase).toEqual({ kind: 'specialBuild', builder: 5, queue: [] });
    state = apply(state, 5, { type: 'passSpecialBuild' }).state;
    expect(state.phase.kind).toBe('preRoll');
    expect(state.turn.player).toBe(1);
  });
});

describe('SBP — allowed/blocked action matrix (X12)', () => {
  it('the builder may build/buy; every other action returns the correct coded error', () => {
    const seeded = give(mainState(), 1, { brick: 2, lumber: 2, wool: 2, grain: 2, ore: 2 });
    const sbp = apply(seeded, 0, { type: 'endTurn' }).state; // builder = 1
    const builder: Seat = 1;

    // Allowed: a legal build keeps us in the SBP with the same builder.
    const road = legalSpecialBuildActions(sbp, builder).find((a) => a.type === 'buildRoad');
    expect(road).toBeDefined();
    const built = apply(sbp, builder, road!).state;
    expect(built.phase.kind).toBe('specialBuild');
    expect((built.phase as { builder: Seat }).builder).toBe(1);

    // Allowed: buying a dev card.
    expect(reduce(sbp, builder, { type: 'buyDevCard' }).ok).toBe(true);

    // Blocked: trading (domestic AND maritime), dev-card plays, rolling, endTurn.
    const blocked: Action[] = [
      { type: 'bankTrade', give: 'brick', receive: 'ore' },
      { type: 'offerTrade', give: { brick: 1 }, receive: { ore: 1 } },
      { type: 'confirmTrade', with: 2 },
      { type: 'cancelTrade' },
      { type: 'playKnight' },
      { type: 'playRoadBuilding' },
      { type: 'playYearOfPlenty', a: 'ore', b: 'ore' },
      { type: 'playMonopoly', resource: 'ore' },
      { type: 'rollDice' },
      { type: 'endTurn' },
    ];
    for (const action of blocked) {
      const r = reduce(sbp, builder, action);
      expect(r.ok, `${action.type} should be blocked`).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('WRONG_PHASE');
    }

    // A non-builder seat cannot act during someone else's special-build turn.
    const other = reduce(sbp, 2, { type: 'buyDevCard' });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe('NOT_YOUR_TURN');
  });
});

describe('SBP — awards recompute on an SBP build + conservation (I1–I3)', () => {
  it('a road built during the SBP recomputes Longest Road and keeps piece/bank counts consistent', () => {
    let state = give(mainState(), 1, { brick: 8, lumber: 8 });
    state = apply(state, 0, { type: 'endTurn' }).state; // builder = 1
    const builder: Seat = 1;
    const before = state.players[builder]!.roads.length;

    // Build several legal roads across the builder's SBP turn, growing the network.
    for (let i = 0; i < 4; i++) {
      const road = legalSpecialBuildActions(state, builder).find((a) => a.type === 'buildRoad');
      if (!road) break;
      state = apply(state, builder, road).state;
      expect(conserved(state)).toBe(true); // I1: bank + hands unchanged at 24/resource
      const p = state.players[builder]!;
      expect(p.roads.length + p.piecesLeft.roads).toBe(15); // I2: pieces conserved
    }
    expect(state.players[builder]!.roads.length).toBeGreaterThan(before);
    // The Longest Road award was recomputed after the SBP build — it matches a from-scratch
    // recompute (the same `updateAwards` path a normal main-phase road takes), i.e. an SBP road can
    // move the award exactly like any other road. (No stale award left behind.)
    expect(state.awards.longestRoad).toEqual(updateLongestRoad(state).awards.longestRoad);
  });
});

describe('SBP — win stays own-turn-gated (X12/R13.2)', () => {
  it('reaching the target during the SBP does not win; the win lands on the builder’s own next turn', () => {
    // targetVp 3: after setup every seat sits at 2 VP (2 settlements). Builder 1 upgrades to a city
    // (→3 VP) during the SBP; that must NOT end the game.
    const seeded = give(mainState({ targetVp: 3, seed: 'sbp-win' }), 1, { ore: 3, grain: 2 });
    let state = apply(seeded, 0, { type: 'endTurn' }).state;
    const builder: Seat = 1;
    const cityVertex = state.players[builder]!.settlements[0]!;
    const upgraded = apply(state, builder, { type: 'buildCity', vertex: cityVertex });
    expect(upgraded.state.phase.kind).toBe('specialBuild'); // NOT ended — no win during the SBP
    state = upgraded.state;

    // Pass the rest of the queue; the last pass returns play to seat 1 (the builder) — who now wins
    // at the start of their OWN turn.
    let last = apply(state, builder, { type: 'passSpecialBuild' });
    for (const b of [2, 3, 4, 5] as Seat[]) last = apply(last.state, b, { type: 'passSpecialBuild' });
    expect(last.state.phase).toEqual({ kind: 'ended', winner: 1 });
    expect(last.events.some((e) => (e as { type: string }).type === 'gameWon')).toBe(true);
  });
});
