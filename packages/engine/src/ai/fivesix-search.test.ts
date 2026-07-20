// F-4 regressions: the three determinized-search edge-case crashes B-22 caught in live 5–6 games —
// resolveSteal "victim holds no cards" (steal), chooseAction "no legal action" (root), and
// greedyBaseline "no legal action" (rollout). Each test reproduces the crashing STATE deterministically
// and asserts the AI now returns a legal action without throwing. These live in `ai/` per the task.

import { describe, expect, it } from 'vitest';
import {
  EXT56_BANK_PER_RESOURCE,
  GEOMETRY_EXT56,
  type EdgeId,
  type GameConfig,
  type GameState,
  type PlayerState,
  type ResourceType,
  type Seat,
} from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { geometryForState } from '../modules/index.js';
import { redact } from '../redact.js';
import { reduce } from '../reduce.js';
import { canPlaceRoad } from '../rules/connectivity.js';
import { hashSeed } from '../rng.js';
import { stateWith } from '../testkit.js';
import { chooseAction } from './bot.js';
import { enumerateCandidates } from './candidates.js';
import { sampleDeterminization } from './determinize.js';

const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

const FIVE_SIX_CONFIG: Omit<GameConfig, 'seed'> = {
  playerCount: 5,
  targetVp: 10,
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: true, seafarers: false, citiesKnights: false },
  variants: { fiveSixTurnRule: 'sbp' },
};

/** A 5-player fiveSix game with a controlled, conserving resource distribution: every seat holds 4
 * of each resource (hand size 20 — only possible on the 24/resource EXT56 bank, X6), the bank holds
 * the remaining 4 of each, so every type conserves to 24. With the pre-F-4 determinize (which used
 * the base bank of 19) the opponents' 80 sampled cards couldn't be dealt from a 55-card pool, so the
 * LAST opponents were dealt short — the seed of both the steal and discard crashes. */
function craftFiveSix(phase: GameState['phase']): GameState {
  const g = createGame({ ...FIVE_SIX_CONFIG, seed: 'f4-fivesix' });
  const resources = { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 };
  const players: PlayerState[] = g.players.map((p) => ({ ...p, resources: { ...resources } }));
  const bank = { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 };
  return {
    ...g,
    players,
    bank,
    phase,
    turn: { number: 8, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
  };
}

describe('F-4 · determinize conserves every opponent hand size on a 5–6 bank (steal/discard root cause)', () => {
  it('every sampled opponent hand equals its exact resourceCount, and each type conserves to 24', () => {
    const state = craftFiveSix({ kind: 'main' });
    const view = redact(state, 0);
    for (let seed = 0; seed < 6; seed++) {
      const { state: sampled } = sampleDeterminization(view, hashSeed(`f4-determinize-${seed}`));
      // Per-type conservation on the 5–6 bank (X6) — 24, not the base 19 the old code assumed.
      for (const res of RESOURCE_TYPES) {
        const total = sampled.bank[res] + sampled.players.reduce((s, p) => s + p.resources[res], 0);
        expect(total).toBe(EXT56_BANK_PER_RESOURCE);
      }
      // No opponent is dealt short of its exact count (the pre-F-4 bug shorted the last ones to 0).
      for (const p of sampled.players) {
        if (p.seat === view.me) continue;
        const handSize = RESOURCE_TYPES.reduce((s, r) => s + p.resources[r], 0);
        const viewEntry = view.players.find((v) => v.seat === p.seat)!;
        expect(handSize).toBe('resourceCount' in viewEntry ? viewEntry.resourceCount : handSize);
        expect(handSize).toBe(20);
      }
    }
  });
});

describe('F-4 · steal: chooseAction never throws resolveSteal "victim holds no cards" (throw #1)', () => {
  it('a 5–6 steal decision returns a legal steal without throwing', () => {
    const candidates: Seat[] = [1, 2, 3, 4];
    const state = craftFiveSix({ kind: 'steal', candidates, returnTo: 'main' });
    const view = redact(state, 0);
    let decision!: ReturnType<typeof chooseAction>;
    expect(() => {
      decision = chooseAction(view, hashSeed('f4-steal'), { budget: 40 });
    }).not.toThrow();
    const result = reduce(state, 0, decision.action);
    expect(result.ok, `expected a legal steal, got ${JSON.stringify(decision.action)}`).toBe(true);
  });
});

describe('F-4 · resolveSteal is a coded error, not a throw, for a cardless victim (robber.ts hardening)', () => {
  it('reduce returns NOT_A_CANDIDATE (search prunes it) instead of throwing', () => {
    const base = stateWith();
    const state: GameState = {
      ...base,
      players: base.players.map((p) =>
        p.seat === 1 ? { ...p, resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 } } : p
      ),
      phase: { kind: 'steal', candidates: [1 as Seat], returnTo: 'main' },
    };
    let result!: ReturnType<typeof reduce>;
    expect(() => {
      result = reduce(state, 0, { type: 'steal', from: 1 });
    }).not.toThrow();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_A_CANDIDATE');
  });
});

describe('F-4 · discard: greedy/chooseAction never throws on a 5–6 discard (throw #3)', () => {
  it('a pending 5–6 discard decision returns a legal discard without throwing', () => {
    // Every seat owes floor(20/2)=10; the pre-F-4 shorted opponent hands couldn't form 10 cards.
    const amounts: Record<Seat, number> = { 0: 10, 1: 10, 2: 10, 3: 10, 4: 10, 5: 0 };
    const pending: Seat[] = [0, 1, 2, 3, 4];
    const state = craftFiveSix({ kind: 'discard', pending, amounts });
    const view = redact(state, 0);
    let decision!: ReturnType<typeof chooseAction>;
    expect(() => {
      decision = chooseAction(view, hashSeed('f4-discard'), { budget: 40 });
    }).not.toThrow();
    const result = reduce(state, 0, decision.action);
    expect(result.ok, `expected a legal discard, got ${JSON.stringify(decision.action)}`).toBe(true);
  });
});

describe('F-4 · roadBuilding enumerates the ACTIVE (EXT56) board geometry (rollout throw)', () => {
  it('includes legal free-road edges with ids beyond the base 19-hex board (id ≥ 72)', () => {
    // Place seat 0 a single road on a high-id EXT56-only edge; its incident edges (also high-id) are
    // then legal free-road spots that the base-GEOMETRY enumeration (pre-F-4) could never see.
    const g = createGame({ ...FIVE_SIX_CONFIG, seed: 'f4-roadbuilding' });
    const edges = GEOMETRY_EXT56.edges;
    const seedEdge = edges[edges.length - 1]!; // the last edge — guaranteed id ≥ 72 on the 30-hex board
    expect(seedEdge.id).toBeGreaterThanOrEqual(72);

    const players: PlayerState[] = g.players.map((p) =>
      p.seat === 0 ? { ...p, roads: [seedEdge.id] } : p
    );
    const state: GameState = {
      ...g,
      players,
      phase: { kind: 'roadBuilding', remaining: 2 },
      turn: { number: 8, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    };

    // Ground truth from the engine's own active-geometry legality check.
    const expected = geometryForState(state)
      .edges.filter((e) => canPlaceRoad(state, 0, e.id))
      .map((e) => e.id as EdgeId);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.some((id) => (id as number) >= 72)).toBe(true); // the decisive edge the old code missed

    const cands = enumerateCandidates(state, 0);
    const enumerated = cands
      .filter((a): a is { type: 'placeFreeRoad'; edge: EdgeId } => a.type === 'placeFreeRoad')
      .map((a) => a.edge);
    expect([...enumerated].sort((a, b) => (a as number) - (b as number))).toEqual(
      [...expected].sort((a, b) => (a as number) - (b as number))
    );

    // And the bot itself picks a legal free road without throwing.
    const view = redact(state, 0);
    let decision!: ReturnType<typeof chooseAction>;
    expect(() => {
      decision = chooseAction(view, hashSeed('f4-rb'), { budget: 24 });
    }).not.toThrow();
    expect(reduce(state, 0, decision.action).ok).toBe(true);
  });
});

describe('F-4 · rollout actor-selection covers the SBP special-build phase (specialBuild throw)', () => {
  it('greedy rollout hands specialBuild to the builder, so the search does not crash', () => {
    // The pre-F-4 search/harness nextActor omitted `specialBuild`, handing it to turn.player (whose
    // candidate list is empty) → greedyBaseline threw. Here the bot's own root decision is a normal
    // main turn, but a rollout can enter specialBuild; a full-game 5–6 driver exercises that path.
    for (const rule of ['sbp', 'pairedPlayers'] as const) {
      for (let i = 0; i < 2; i++) {
        expect(() => playFiveSixGame(`f4-drive-${rule}-${i}`, rule)).not.toThrow();
      }
    }
  });
});

/** Minimal all-bot 5–6 driver (mirrors the server's pendingActors ordering) — plays to `ended` or an
 * action cap, asserting the AI never throws. A compact end-to-end backstop over the crafted units. */
function playFiveSixGame(seed: string, rule: 'sbp' | 'pairedPlayers'): void {
  const config: GameConfig = { ...FIVE_SIX_CONFIG, variants: { fiveSixTurnRule: rule }, seed };
  let state = createGame(config);
  let rng = hashSeed(`${seed}#f4`);
  for (let actions = 0; state.phase.kind !== 'ended' && actions < 6000; actions++) {
    const actor = pendingActors(state)[0];
    if (actor === undefined) throw new Error(`no actor in phase ${state.phase.kind}`);
    const decision = chooseAction(redact(state, actor), rng, { budget: 6 });
    rng = decision.rng;
    state = { ...state, rng };
    const result = reduce(state, actor, decision.action);
    if (!result.ok) throw new Error(`illegal ${JSON.stringify(decision.action)} -> ${result.error.code}`);
    state = result.state;
  }
}

function pendingActors(state: GameState): Seat[] {
  switch (state.phase.kind) {
    case 'discard':
      return state.phase.pending;
    case 'ended':
      return [];
    case 'specialBuild':
      return [state.phase.builder];
    case 'main': {
      if (state.trade) {
        const trade = state.trade;
        const responders = state.players
          .map((p) => p.seat)
          .filter((s) => s !== state.turn.player && trade.responses[s] === undefined);
        if (responders.length > 0) return responders;
      }
      return [state.turn.player];
    }
    default:
      return [state.turn.player];
  }
}
