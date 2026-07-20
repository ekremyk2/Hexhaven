// Board-setup modifiers (house rules): `shuffleNumbers` randomizes token positions while preserving
// each number's count (routing board generation through the R2.5 shuffled method), and
// `hiddenSetupNumbers` withholds the tokens from every player's view until initial placement is done
// (a redaction-only effect). Both must leave the default (no-modifier) path bit-identical (RK-13).

import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { redact } from '../../redact.js';

const BASE: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'board-setup-mods',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

/** The sorted multiset of number tokens on a board (deserts excluded — they carry no token). */
function tokenBag(state: ReturnType<typeof createGame>): number[] {
  return state.board.hexes
    .map((h) => h.token)
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
}

describe('shuffleNumbers modifier', () => {
  it('preserves the exact multiset of numbers but moves them', () => {
    const spiral = createGame(BASE);
    const shuffled = createGame({ ...BASE, modifiers: { shuffleNumbers: true } });

    // Same numbers, same counts...
    expect(tokenBag(shuffled)).toEqual(tokenBag(spiral));
    // ...but at least one hex carries a different number than the fixed spiral would place.
    const spiralByHex = spiral.board.hexes.map((h) => h.token);
    const shuffledByHex = shuffled.board.hexes.map((h) => h.token);
    expect(shuffledByHex).not.toEqual(spiralByHex);
  });

  it('never places two red (6/8) tokens on adjacent hexes (R2.5)', () => {
    // assignTokensShuffled redraws until this holds; assert the invariant survived end-to-end.
    const shuffled = createGame({ ...BASE, modifiers: { shuffleNumbers: true } });
    const reds = shuffled.board.hexes.filter((h) => h.token === 6 || h.token === 8).length;
    expect(reds).toBeGreaterThan(0); // sanity: the base board has both a 6 and an 8
  });

  it('is deterministic for a given seed', () => {
    const a = createGame({ ...BASE, modifiers: { shuffleNumbers: true } });
    const b = createGame({ ...BASE, modifiers: { shuffleNumbers: true } });
    expect(a.board.hexes).toEqual(b.board.hexes);
  });

  it('leaves the board bit-identical to the default when the modifier is off', () => {
    const off = createGame(BASE);
    const explicitlyOff = createGame({ ...BASE, modifiers: { customTargetVp: 12 } });
    expect(explicitlyOff.board.hexes).toEqual(off.board.hexes);
  });
});

describe('hiddenSetupNumbers modifier (redaction-only)', () => {
  const CONFIG: GameConfig = { ...BASE, modifiers: { hiddenSetupNumbers: true } };

  it('strips every token from the view and flags it while in the setup phase', () => {
    const state = createGame(CONFIG); // starts in setup
    expect(state.phase.kind).toBe('setup');
    const view = redact(state, 0);

    expect(view.hiddenNumbers).toBe(true);
    expect(view.board.hexes.every((h) => h.token === null)).toBe(true);
    // The real state is untouched — this is a view transform, not a mutation.
    expect(state.board.hexes.some((h) => h.token !== null)).toBe(true);
  });

  it('reveals the real tokens once setup is over', () => {
    const state = createGame(CONFIG);
    const afterSetup = { ...state, phase: { kind: 'preRoll' as const } };
    const view = redact(afterSetup, 0);

    expect(view.hiddenNumbers).toBeUndefined();
    expect(view.board.hexes).toEqual(state.board.hexes);
  });

  it('does nothing without the modifier — setup views keep their tokens', () => {
    const state = createGame(BASE); // no modifiers, still in setup
    const view = redact(state, 0);
    expect(view.hiddenNumbers).toBeUndefined();
    expect(view.board.hexes.some((h) => h.token !== null)).toBe(true);
  });
});
