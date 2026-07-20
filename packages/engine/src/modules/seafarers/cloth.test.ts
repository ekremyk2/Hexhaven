// T-757: "Cloth for Hexhaven" cloth production (`computeClothGains`/`applyClothGains`) + VP derivation
// (`clothVp`). Mirrors gold.ts's production-on-roll shape and chits.ts's per-seat VP shape, folded
// into the SAME dice-roll hook (modules/seafarers/index.ts's `afterAction`) — these tests drive the
// pure functions directly (like chits.test.ts drives `grantIslandChit` directly), since a real
// `rollDice` action's die value is rng-chosen, not caller-supplied; `sim/seafarers.test.ts`'s T-757
// smoke is the end-to-end proof the hook actually fires during ordinary bot play.

import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState, HexId, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { computeVp } from '../../vp.js';
import { geometryForState } from '../index.js';
import { scenarioVillageHexesFor } from './board.js';
import { applyClothGains, clothVp, computeClothGains, isClothForHexhavenState } from './cloth.js';
import { clothOf } from './state.js';

/** A Seafarers 5–6 extension config for a given scenario id. */
function fiveSixSeafarersConfig(scenario: string, playerCount: 5 | 6 = 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario }, citiesKnights: false },
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

/** Put `patch` onto one seat's player record (mirrors chits.test.ts's `withSeat`). */
function withSeat(state: GameState, seat: Seat, patch: Partial<GameState['players'][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p)) };
}

/** The first village hex + its CURRENT (per-game-randomized) token + one incident vertex. */
function firstVillage(state: GameState): { hex: HexId; token: number; vertex: VertexId } {
  const villages = scenarioVillageHexesFor(state.config);
  const hex = villages[0];
  if (hex === undefined) throw new Error('no village hex on this board');
  const tile = state.board.hexes[hex];
  const geomHex = geometryForState(state).hexes[hex];
  const vertex = geomHex?.vertices[0];
  if (!tile || tile.token === null || vertex === undefined) throw new Error('village hex has no token/vertex');
  return { hex, token: tile.token, vertex };
}

describe('T-757 Cloth for Hexhaven — computeClothGains/applyClothGains/clothVp', () => {
  it('a scenario without cloth (Heading for New Shores) is untouched: computeClothGains is always null', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('headingForNewShores'), seed: 'cloth-baseline' });
    expect(isClothForHexhavenState(g)).toBe(false);
    for (let total = 2; total <= 12; total++) expect(computeClothGains(g, total)).toBeNull();
    expect(clothVp(g, 0)).toBe(0);
    expect(computeVp(g, 0).clothVp).toBeUndefined(); // key omitted entirely (bit-identity discipline)
  });

  it('Cloth for Hexhaven seeds a zeroed cloth counter for every seat', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('clothForHexhaven'), seed: 'cloth-seed' });
    expect(isClothForHexhavenState(g)).toBe(true);
    expect(g.ext?.seafarers?.cloth).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('a roll of a village\'s number grants 1 cloth to a seat with a settlement touching it', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('clothForHexhaven'), seed: 'cloth-grant' });
    const { token, vertex } = firstVillage(g);
    const s = withSeat(g, 0, { settlements: [vertex] });

    const gains = computeClothGains(s, token);
    expect(gains).toEqual({ 0: 1 });

    const next = applyClothGains(s, gains);
    expect(clothOf(next, 0)).toBe(1);
    expect(next.ext!.seafarers!.cloth).not.toBe(s.ext!.seafarers!.cloth); // spread-copied, not mutated
  });

  it('a city touching the village also grants exactly 1 cloth (not 2)', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('clothForHexhaven'), seed: 'cloth-city' });
    const { token, vertex } = firstVillage(g);
    const s = withSeat(g, 1, { cities: [vertex] });

    const gains = computeClothGains(s, token);
    expect(gains).toEqual({ 1: 1 });
  });

  it('a non-matching roll grants nothing', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('clothForHexhaven'), seed: 'cloth-nomatch' });
    const { token, vertex } = firstVillage(g);
    const s = withSeat(g, 0, { settlements: [vertex] });
    const otherTotal = token === 2 ? 12 : 2; // guaranteed different from the village's own token
    expect(computeClothGains(s, otherTotal)).toBeNull();
  });

  it('a seat with NO building on the village gains nothing (non-adjacent seat)', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('clothForHexhaven'), seed: 'cloth-nonadjacent' });
    const { token } = firstVillage(g);
    // Nobody has settled anywhere near the village on a freshly created game.
    expect(computeClothGains(g, token)).toBeNull();
  });

  it('the robber on a village blocks its cloth production (mirrors R5.2/gold.ts S9.3)', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('clothForHexhaven'), seed: 'cloth-robber' });
    const { hex, token, vertex } = firstVillage(g);
    let s = withSeat(g, 0, { settlements: [vertex] });
    s = { ...s, board: { ...s.board, robber: hex } };
    expect(computeClothGains(s, token)).toBeNull();
  });

  it('applyClothGains is a no-op (reference-equal) when gains is null', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('clothForHexhaven'), seed: 'cloth-noop' });
    expect(applyClothGains(g, null)).toBe(g);
  });

  it('clothVp = floor(cloth / 2), and folds into computeVp only for this scenario', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('clothForHexhaven'), seed: 'cloth-vp' });
    const withCloth = {
      ...g,
      ext: { ...g.ext, seafarers: { ...g.ext!.seafarers!, cloth: [0, 1, 2, 3, 4, 5] } },
    };
    expect(clothVp(withCloth, 0)).toBe(0);
    expect(clothVp(withCloth, 1)).toBe(0);
    expect(clothVp(withCloth, 2)).toBe(1);
    expect(clothVp(withCloth, 3)).toBe(1);
    expect(clothVp(withCloth, 4)).toBe(2);
    expect(clothVp(withCloth, 5)).toBe(2);
    expect(computeVp(withCloth, 4).clothVp).toBe(2);
    expect(computeVp(withCloth, 4).total).toBeGreaterThanOrEqual(2);
  });
});
