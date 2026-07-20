// T-602 — full-game round-trips driven by the sim bot (T-112), which now understands BOTH extra-
// build rules. Plays complete 6-player fiveSix games in each mode to `ended`, asserting: the game
// terminates, the mode's OWN mechanic is exercised (an SBP phase / a Paired-Players partial turn),
// the OTHER mode's mechanic never appears, and resources stay conserved (I1) the whole way.

import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState, ResourceType, Seat } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { hashSeed } from '../../rng.js';
import { randomBot } from '../../sim/bot.js';

const RESOURCES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function cfg(rule: 'sbp' | 'pairedPlayers', seed: string): GameConfig {
  return {
    playerCount: 6,
    targetVp: 5, // lower target keeps random-bot games short enough for CI
    seed,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: false, citiesKnights: false },
    variants: { fiveSixTurnRule: rule },
  };
}

/** Whichever seat may legally act now — mirrors sim/runGame.ts's `nextActor`, plus the SBP builder. */
function actorOf(state: GameState): Seat {
  if (state.phase.kind === 'discard') return state.phase.pending[0]!;
  if (state.phase.kind === 'specialBuild') return state.phase.builder;
  if (state.phase.kind === 'main' && state.trade != null) {
    const owner = state.turn.player;
    const trade = state.trade;
    const responder = state.players.map((p) => p.seat).find((s) => s !== owner && trade.responses[s] === undefined);
    if (responder !== undefined) return responder;
  }
  return state.turn.player;
}

function conserved(state: GameState): boolean {
  return RESOURCES.every(
    (res) => state.bank[res] + state.players.reduce((s, p) => s + p.resources[res], 0) === 24
  );
}

interface Outcome {
  ended: boolean;
  sawSpecialBuild: boolean;
  sawPartialTurn: boolean;
  actions: number;
}

function playOut(rule: 'sbp' | 'pairedPlayers', seed: string, maxActions = 6000): Outcome {
  let state = createGame(cfg(rule, seed));
  let botRng = hashSeed(`${seed}#bot`);
  let sawSpecialBuild = false;
  let sawPartialTurn = false;
  let actions = 0;

  while (state.phase.kind !== 'ended' && actions < maxActions) {
    if (state.phase.kind === 'specialBuild') sawSpecialBuild = true;
    if (state.ext?.fiveSix?.partialTurn) sawPartialTurn = true;

    const actor = actorOf(state);
    const decision = randomBot(state, actor, botRng);
    botRng = decision.rng;
    const r = reduce(state, actor, decision.action);
    if (!r.ok) {
      throw new Error(
        `[${rule}/${seed}] illegal bot action at #${actions}: seat ${actor} ${JSON.stringify(
          decision.action
        )} -> ${r.error.code} (${r.error.message})`
      );
    }
    state = r.state;
    actions += 1;
    if (!conserved(state)) throw new Error(`[${rule}/${seed}] I1 violated at action #${actions}`);
  }

  return { ended: state.phase.kind === 'ended', sawSpecialBuild, sawPartialTurn, actions };
}

describe('fiveSix sim-bot round-trips (both modes)', () => {
  it('SBP: 6-player games finish, exercise the SBP, and never open a partial turn', () => {
    for (let i = 0; i < 3; i++) {
      const out = playOut('sbp', `rt-sbp-${i}`);
      expect(out.ended, `game rt-sbp-${i} should terminate (took ${out.actions})`).toBe(true);
      expect(out.sawSpecialBuild).toBe(true);
      expect(out.sawPartialTurn).toBe(false);
    }
  });

  it('Paired Players: 6-player games finish, exercise a partial turn, and never open an SBP', () => {
    for (let i = 0; i < 3; i++) {
      const out = playOut('pairedPlayers', `rt-pp-${i}`);
      expect(out.ended, `game rt-pp-${i} should terminate (took ${out.actions})`).toBe(true);
      expect(out.sawPartialTurn).toBe(true);
      expect(out.sawSpecialBuild).toBe(false);
    }
  });
});
