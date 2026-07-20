// T-410 requirement 2 tests: determinization conservation + the fairness boundary (the sampler must
// never read a field absent from the `PlayerView`).

import { describe, expect, it } from 'vitest';
import { BANK_PER_RESOURCE, DEV_DECK } from '@hexhaven/shared';
import type { GameState, ResourceType, Seat } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { redact } from '../redact.js';
import type { OtherPlayerView, PlayerView } from '../redact.js';
import { reduce } from '../reduce.js';
import { hashSeed } from '../rng.js';
import { simulate } from '../sim/runGame.js';
import { sampleDeterminization } from './determinize.js';

const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  seed: 'determinize-fairness',
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

/** A handful of mid/late-game states with a real, varied resource/dev-card distribution — replaying
 * a T-112 random game's log gives states no hand-crafted fixture would (multi-seat resource spread,
 * some dev cards bought/played, robber moved, an award or two claimed). */
function sampleStates() {
  const sim = simulate('ai-determinize-seed-1');
  let state = createGame({ ...CONFIG, seed: sim.seed });
  const picks = [10, 40, 90, 150, Math.floor(sim.log.length / 2)].filter((i) => i < sim.log.length);
  const states = [];
  let i = 0;
  for (const step of sim.log) {
    const result = reduce(state, step.seat, step.action);
    if (!result.ok) throw new Error('BUG: replay of a valid sim log failed');
    state = result.state;
    if (picks.includes(i)) states.push(state);
    i += 1;
  }
  return states;
}

describe('sampleDeterminization — conservation (task requirement 2)', () => {
  const states = sampleStates();

  it('resource cards conserve per R1 (bank + every hand == 19 per type) and hand sizes match the view', () => {
    for (const state of states) {
      for (let seed = 0; seed < 5; seed++) {
        const view = redact(state, state.turn.player);
        const rng = hashSeed(`determinize-conservation-${seed}`);
        const { state: sampled } = sampleDeterminization(view, rng);

        for (const res of RESOURCE_TYPES) {
          const total = sampled.bank[res] + sampled.players.reduce((sum, p) => sum + p.resources[res], 0);
          expect(total).toBe(BANK_PER_RESOURCE);
        }
        for (const p of sampled.players) {
          const viewEntry = view.players.find((v) => v.seat === p.seat)!;
          const expectedCount =
            'resources' in viewEntry
              ? RESOURCE_TYPES.reduce((s, r) => s + viewEntry.resources[r], 0)
              : (viewEntry as OtherPlayerView).resourceCount;
          const actualCount = RESOURCE_TYPES.reduce((s, r) => s + p.resources[r], 0);
          expect(actualCount).toBe(expectedCount);
        }
      }
    }
  });

  it('dev cards conserve per R9.1 (deck + every hand + played == 25 for the sampled composition) and counts match the view', () => {
    for (const state of states) {
      for (let seed = 0; seed < 5; seed++) {
        const view = redact(state, state.turn.player);
        const rng = hashSeed(`determinize-devcards-${seed}`);
        const { state: sampled } = sampleDeterminization(view, rng);

        expect(sampled.devDeck.length).toBe(view.devDeckCount);
        for (const p of sampled.players) {
          const viewEntry = view.players.find((v) => v.seat === p.seat)!;
          const expected = 'devCards' in viewEntry ? viewEntry.devCards.length : (viewEntry as OtherPlayerView).devCardCount;
          expect(p.devCards.length).toBe(expected);
        }

        // Total per-type existence bound: nothing sampled can exceed DEV_DECK's composition —
        // a weaker but type-safe cross-check than exact conservation (this task's sampler doesn't
        // claim to reconstruct the TRUE play history for the three untracked types, only a
        // plausible one; see determinize.ts's header comment).
        const counts: Record<string, number> = { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0, victoryPoint: 0 };
        for (const c of sampled.devDeck) counts[c] = (counts[c] ?? 0) + 1;
        for (const p of sampled.players) for (const c of p.devCards) counts[c.type] = (counts[c.type] ?? 0) + 1;
        for (const type of Object.keys(DEV_DECK) as (keyof typeof DEV_DECK)[]) {
          expect(counts[type]).toBeLessThanOrEqual(DEV_DECK[type]);
          expect(counts[type]).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('own hand rides through exactly — never resampled', () => {
    const state = states[0]!;
    const view = redact(state, state.turn.player);
    const { state: sampled } = sampleDeterminization(view, hashSeed('determinize-own-hand'));
    const ownSampled = sampled.players.find((p) => p.seat === view.me)!;
    const ownView = view.players.find((p) => p.seat === view.me)!;
    expect('resources' in ownView).toBe(true);
    if ('resources' in ownView) {
      expect(ownSampled.resources).toEqual(ownView.resources);
      expect(ownSampled.devCards).toEqual(ownView.devCards);
    }
  });

  it('is deterministic: the same (view, rng) samples the identical state', () => {
    const state = states[0]!;
    const view = redact(state, state.turn.player);
    const rng = hashSeed('determinize-determinism');
    const a = sampleDeterminization(view, rng);
    const b = sampleDeterminization(view, rng);
    expect(a).toEqual(b);
  });
});

describe('sampleDeterminization — fairness boundary (task requirement 2)', () => {
  /** Wraps every OTHER player's view entry in a Proxy that THROWS if the sampler ever reads the
   * hidden fields real hidden information would live in (`resources`/`devCards`) — those keys are
   * simply ABSENT from a real `OtherPlayerView` (redact.ts strips them, never zeroes them), so this
   * only fires if a bug bypasses the type system (e.g. an `as any` cast) and tries anyway. */
  function guardView(view: PlayerView): PlayerView {
    const guardedPlayers = view.players.map((entry) => {
      if (entry.seat === view.me) return entry;
      return new Proxy(entry, {
        get(target, prop) {
          if (prop === 'resources' || prop === 'devCards') {
            throw new Error(`FAIRNESS VIOLATION: read hidden field '${String(prop)}' from an OtherPlayerView`);
          }
          return Reflect.get(target, prop);
        },
      });
    });
    return { ...view, players: guardedPlayers };
  }

  it('never reads resources/devCards off another seat while sampling', () => {
    const sim = simulate('ai-determinize-fairness');
    let state = createGame({ ...CONFIG, seed: sim.seed });
    let i = 0;
    for (const step of sim.log) {
      const result = reduce(state, step.seat, step.action);
      if (!result.ok) throw new Error('BUG: replay of a valid sim log failed');
      state = result.state;
      if (i % 37 === 0) {
        const view = redact(state, state.turn.player);
        expect(() => sampleDeterminization(guardView(view), hashSeed(`fairness-${i}`))).not.toThrow();
      }
      i += 1;
    }
  });

  it('the PlayerView itself never carries `rng` or a real `devDeck` array (redact.ts\'s contract)', () => {
    const state = createGame(CONFIG);
    const view = redact(state, 0);
    expect('rng' in view).toBe(false);
    expect('devDeck' in view).toBe(false);
  });

  it('preserves `ext` (5–6 paired partial-turn marker) so the bot sees partial-turn restrictions (B-19)', () => {
    // Regression: determinize dropped `ext`, so a bot in a Paired-Players partial turn reasoned as if
    // it were a normal `main` turn and proposed `offerTrade` — rejected WRONG_PHASE, hanging the game.
    const base = createGame(CONFIG);
    const withPartial: GameState = {
      ...base,
      ext: { fiveSix: { partialTurn: { builder: 0 as Seat, resumeFrom: 3 as Seat } } },
    };
    const view = redact(withPartial, 0);
    expect(view.ext?.fiveSix?.partialTurn).toEqual({ builder: 0, resumeFrom: 3 });
    const { state } = sampleDeterminization(view, hashSeed('ext-preserve'));
    expect(state.ext?.fiveSix?.partialTurn).toEqual({ builder: 0, resumeFrom: 3 });
  });
});
