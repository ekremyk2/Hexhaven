// T-601: the 5–6 Player Extension module end-to-end — board generation at 30 hexes, createGame
// piece/bank/deck/color pools at 5 and 6 players, the snake setup draft, a scripted 6-player game
// reaching main-phase turns, and the config gating matrix.

import { describe, expect, it } from 'vitest';
import {
  EXT56_HARBOR_MIX,
  EXT56_TERRAIN_COUNTS,
  EXT56_TOKEN_SPIRAL,
  GEOMETRY_EXT56,
} from '@hexhaven/shared';
import type { Action, GameConfig, GameState, HarborType, Seat, TerrainType } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { generateBoard } from '../boardGen.js';
import { hashSeed } from '../rng.js';
import { reduce } from '../reduce.js';
import {
  legalRobberHexes,
  legalSetupRoads,
  legalSetupSettlements,
  pendingDiscards,
  stealCandidates,
} from '../legal.js';

const FIVE_SIX: GameConfig['expansions'] = { fiveSix: true, seafarers: false, citiesKnights: false };

function cfg(over: Partial<GameConfig> = {}): GameConfig {
  return {
    playerCount: 6,
    targetVp: 10,
    seed: 'ext56',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: FIVE_SIX,
    ...over,
  };
}

const SEED_COUNT = 200;
function seeds(prefix: string): number[] {
  return Array.from({ length: SEED_COUNT }, (_, i) => hashSeed(`${prefix}-${i}`));
}

const SPIRAL = { board: 'random' as const, tokenMethod: 'spiral' as const, expansions: FIVE_SIX };
const SHUFFLED = { board: 'random' as const, tokenMethod: 'shuffled' as const, expansions: FIVE_SIX };

function terrainCountsOf(board: GameState['board']): Partial<Record<TerrainType, number>> {
  const counts: Partial<Record<TerrainType, number>> = {};
  for (const hex of board.hexes) counts[hex.terrain] = (counts[hex.terrain] ?? 0) + 1;
  return counts;
}
function sortedTokensOf(board: GameState['board']): number[] {
  return board.hexes
    .map((h) => h.token)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
}

describe('board generation at 30 hexes (multiset checks, spiral)', () => {
  it(`terrain, tokens, deserts, robber, harbors always legal across ${SEED_COUNT} seeds`, () => {
    const expectedTokens = [...EXT56_TOKEN_SPIRAL].sort((a, b) => a - b);
    for (const rng of seeds('ext56-spiral')) {
      const { board } = generateBoard(rng, SPIRAL);

      expect(board.hexes).toHaveLength(30);
      expect(terrainCountsOf(board)).toEqual(EXT56_TERRAIN_COUNTS);

      // 28-token multiset; exactly two tokenless (desert) hexes.
      expect(sortedTokensOf(board)).toEqual(expectedTokens);
      expect(board.hexes.filter((h) => h.token === null)).toHaveLength(2);
      expect(board.hexes.filter((h) => h.terrain === 'desert')).toHaveLength(2);

      // Robber starts on a desert.
      expect(board.hexes[board.robber]?.terrain).toBe('desert');

      // Harbors sit on exactly the 11 harbor spots with the 5-6 mix.
      const keys = Object.keys(board.harbors).map(Number).sort((a, b) => a - b);
      expect(keys).toEqual([...GEOMETRY_EXT56.harborSpots].sort((a, b) => a - b));
      const harborCounts: Partial<Record<HarborType, number>> = {};
      for (const h of Object.values(board.harbors)) harborCounts[h] = (harborCounts[h] ?? 0) + 1;
      const expectedHarborCounts: Partial<Record<HarborType, number>> = {};
      for (const h of EXT56_HARBOR_MIX) expectedHarborCounts[h] = (expectedHarborCounts[h] ?? 0) + 1;
      expect(harborCounts).toEqual(expectedHarborCounts);
    }
  });

  it(`shuffled method keeps the multiset and never adjacents 6/8 across ${SEED_COUNT} seeds`, () => {
    const expectedTokens = [...EXT56_TOKEN_SPIRAL].sort((a, b) => a - b);
    // Hex adjacency from the 30-hex geometry.
    const neighbors: number[][] = GEOMETRY_EXT56.hexes.map(() => []);
    for (const edge of GEOMETRY_EXT56.edges) {
      if (edge.hexes.length !== 2) continue;
      const [a, b] = edge.hexes;
      if (a === undefined || b === undefined) continue;
      neighbors[a]!.push(b);
      neighbors[b]!.push(a);
    }
    for (const rng of seeds('ext56-shuffled')) {
      const { board } = generateBoard(rng, SHUFFLED);
      expect(sortedTokensOf(board)).toEqual(expectedTokens);
      for (let a = 0; a < board.hexes.length; a++) {
        const ta = board.hexes[a]?.token;
        if (ta !== 6 && ta !== 8) continue;
        for (const b of neighbors[a] ?? []) {
          const tb = board.hexes[b]?.token;
          expect(tb === 6 || tb === 8).toBe(false);
        }
      }
    }
  });

  it('is deterministic: same rng ⇒ identical 30-hex board', () => {
    const rng = hashSeed('ext56-determinism');
    expect(generateBoard(rng, SPIRAL)).toEqual(generateBoard(rng, SPIRAL));
  });
});

describe('createGame pools at 5 and 6 players', () => {
  for (const playerCount of [5, 6] as const) {
    it(`sets up ${playerCount} players with correct pools, bank, deck, colors`, () => {
      const game = createGame(cfg({ playerCount }));
      expect(game.players).toHaveLength(playerCount);

      // Bank 24 per resource.
      expect(game.bank).toEqual({ brick: 24, lumber: 24, wool: 24, grain: 24, ore: 24 });

      // Dev deck 34 with the 20/3/3/3/5 composition.
      expect(game.devDeck).toHaveLength(34);
      const deckCounts: Record<string, number> = {};
      for (const c of game.devDeck) deckCounts[c] = (deckCounts[c] ?? 0) + 1;
      expect(deckCounts).toEqual({
        knight: 20,
        roadBuilding: 3,
        yearOfPlenty: 3,
        monopoly: 3,
        victoryPoint: 5,
      });

      // Pieces per player unchanged (15/5/4).
      for (const p of game.players) {
        expect(p.piecesLeft).toEqual({ roads: 15, settlements: 5, cities: 4 });
      }

      // Seat colors: base four, then green (seat 4), brown (seat 5).
      const expectedColors = ['red', 'blue', 'white', 'orange', 'green', 'brown'].slice(0, playerCount);
      expect(game.players.map((p) => p.color)).toEqual(expectedColors);

      // The board is the 30-hex board.
      expect(game.board.hexes).toHaveLength(30);
    });
  }
});

/** Drive a full setup draft on `state`, recording the seat order of each settlement placement. */
function driveSetup(state: GameState): { state: GameState; settlementOrder: Seat[] } {
  const settlementOrder: Seat[] = [];
  let guard = 0;
  while (state.phase.kind === 'setup') {
    if (guard++ > 100) throw new Error('setup did not terminate');
    const seat = state.turn.player;
    if (state.phase.expect === 'settlement') {
      const v = legalSetupSettlements(state)[0];
      if (v === undefined) throw new Error('no legal setup settlement');
      settlementOrder.push(seat);
      const r = reduce(state, seat, { type: 'placeSetupSettlement', vertex: v });
      if (!r.ok) throw new Error(`setup settlement failed: ${r.error.code}`);
      state = r.state;
    } else {
      const e = legalSetupRoads(state)[0];
      if (e === undefined) throw new Error('no legal setup road');
      const r = reduce(state, seat, { type: 'placeSetupRoad', edge: e });
      if (!r.ok) throw new Error(`setup road failed: ${r.error.code}`);
      state = r.state;
    }
  }
  return { state, settlementOrder };
}

/** One action step of a running (post-setup) game — resolves rolls, robber, discards, else endTurn. */
function stepMain(state: GameState): GameState {
  const phase = state.phase;
  if (phase.kind === 'discard') {
    const seat = pendingDiscards(state)[0]!;
    const amount = phase.amounts[seat] ?? 0;
    const cards: Partial<Record<string, number>> = {};
    let need = amount;
    const player = state.players[seat]!;
    for (const res of ['brick', 'lumber', 'wool', 'grain', 'ore'] as const) {
      if (need <= 0) break;
      const take = Math.min(need, player.resources[res]);
      if (take > 0) {
        cards[res] = take;
        need -= take;
      }
    }
    const r = reduce(state, seat, { type: 'discard', cards } as Action);
    if (!r.ok) throw new Error(`discard failed: ${r.error.code}`);
    return r.state;
  }
  if (phase.kind === 'preRoll') {
    const r = reduce(state, state.turn.player, { type: 'rollDice' });
    if (!r.ok) throw new Error(`roll failed: ${r.error.code}`);
    return r.state;
  }
  if (phase.kind === 'moveRobber') {
    const hex = legalRobberHexes(state)[0]!;
    const r = reduce(state, state.turn.player, { type: 'moveRobber', hex });
    if (!r.ok) throw new Error(`moveRobber failed: ${r.error.code}`);
    return r.state;
  }
  if (phase.kind === 'steal') {
    const from = stealCandidates(state)[0];
    if (from === undefined) throw new Error('steal phase with no candidates');
    const r = reduce(state, state.turn.player, { type: 'steal', from });
    if (!r.ok) throw new Error(`steal failed: ${r.error.code}`);
    return r.state;
  }
  // T-602: with the default SBP turn rule, each turn's `endTurn` opens a Special Building Phase for
  // the other seats — pass it through so the game advances (SBP behavior is exercised in depth by
  // fiveSix/specialBuild.test.ts; here we only need the game to keep progressing).
  if (phase.kind === 'specialBuild') {
    const r = reduce(state, phase.builder, { type: 'passSpecialBuild' });
    if (!r.ok) throw new Error(`passSpecialBuild failed: ${r.error.code}`);
    return r.state;
  }
  // main (or roadBuilding — not reachable here): just end the turn.
  const r = reduce(state, state.turn.player, { type: 'endTurn' });
  if (!r.ok) throw new Error(`endTurn failed in phase ${phase.kind}: ${r.error.code}`);
  return r.state;
}

describe('scripted 6-player game', () => {
  it('runs the snake setup order 0..5,5..0 and reaches main-phase turns', () => {
    let state = createGame(cfg({ playerCount: 6, seed: 'scripted6' }));
    const setup = driveSetup(state);
    state = setup.state;

    // Snake draft: ascending 0..5 then descending 5..0 (R3.1).
    expect(setup.settlementOrder).toEqual([0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 0]);

    // Every player placed 2 settlements + 2 roads.
    for (const p of state.players) {
      expect(p.settlements).toHaveLength(2);
      expect(p.roads).toHaveLength(2);
    }

    // Setup complete → player 0 opens normal play in preRoll.
    expect(state.phase.kind).toBe('preRoll');
    expect(state.turn.player).toBe(0);

    // Drive several turns; confirm we actually sit in the main phase and the turn counter advances.
    let sawMain = false;
    const startTurn = state.turn.number;
    for (let i = 0; i < 400 && state.phase.kind !== 'ended'; i++) {
      if (state.phase.kind === 'main') sawMain = true;
      if (state.phase.kind === 'main' && state.turn.number - startTurn >= 12) break;
      state = stepMain(state);
    }
    expect(sawMain).toBe(true);
    expect(state.turn.number).toBeGreaterThan(startTurn);
  });
});

describe('config gating matrix (docs/10 §3)', () => {
  it('5 players without fiveSix throws EXPANSION_NOT_AVAILABLE', () => {
    try {
      createGame(cfg({ playerCount: 5, expansions: { fiveSix: false, seafarers: false, citiesKnights: false } }));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: unknown }).code).toBe('EXPANSION_NOT_AVAILABLE');
    }
  });

  it('6 players with fiveSix is accepted', () => {
    expect(() => createGame(cfg({ playerCount: 6 }))).not.toThrow();
  });
});
