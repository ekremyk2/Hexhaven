// T-759: "The Wonders of Hexhaven" — wonder-stage progress (`advanceWonderProgress`) + the alternate
// win (`checkWin`, vp.ts). Mirrors cloth.test.ts/pirateIslands.test.ts's shape: these tests drive the
// pure functions / crafted states directly (a real multi-turn game this file doesn't need to
// reconstruct), since the mechanic itself is deterministic; `sim/seafarers.test.ts`'s T-759 smoke is
// the end-to-end proof the hook + alternate win actually fire during ordinary bot play.

import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { redact } from '../../redact.js';
import { checkWin, computeVp } from '../../vp.js';
import {
  WONDER_STAGES,
  WONDER_STAGE_COSTS,
  WONDER_THRESHOLDS,
  advanceWonderProgress,
  isWondersOfHexhavenState,
  wonderComplete,
  wonderVp,
} from './wonder.js';
import { wonderStagesOf } from './state.js';

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

/** Put `patch` onto one seat's player record (mirrors chits.test.ts/cloth.test.ts's `withSeat`). */
function withSeat(state: GameState, seat: Seat, patch: Partial<GameState['players'][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p)) };
}

describe('T-759 The Wonders of Hexhaven — schema sanity', () => {
  it('WONDER_THRESHOLDS/WONDER_STAGE_COSTS each have exactly WONDER_STAGES entries', () => {
    expect(WONDER_THRESHOLDS).toHaveLength(WONDER_STAGES);
    expect(WONDER_STAGE_COSTS).toHaveLength(WONDER_STAGES);
  });

  it('thresholds strictly rise', () => {
    for (let i = 1; i < WONDER_THRESHOLDS.length; i++) {
      expect(WONDER_THRESHOLDS[i]!).toBeGreaterThan(WONDER_THRESHOLDS[i - 1]!);
    }
  });
});

describe('T-759 The Wonders of Hexhaven — isWondersOfHexhavenState / seeding', () => {
  it('a scenario without a wonder (Heading for New Shores) is untouched', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('headingForNewShores'), seed: 'wc-baseline' });
    expect(isWondersOfHexhavenState(g)).toBe(false);
    expect(g.ext?.seafarers?.wonder).toBeUndefined();
    expect(wonderStagesOf(g, 0)).toBe(0);
    expect(wonderComplete(g, 0)).toBe(false);
    expect(wonderVp(g, 0)).toBe(0);
    expect(computeVp(g, 0).wonderVp).toBeUndefined(); // key omitted entirely (bit-identity discipline)
    expect(advanceWonderProgress(g, 0)).toBeNull();
  });

  it('Wonders of Hexhaven seeds a zeroed wonder-stage counter for every seat', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('wondersOfHexhaven'), seed: 'wc-seed' });
    expect(isWondersOfHexhavenState(g)).toBe(true);
    expect(g.ext?.seafarers?.wonder).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('seeds correctly at 5 players too', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('wondersOfHexhaven', 5), seed: 'wc-seed-5p' });
    expect(g.ext?.seafarers?.wonder).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('T-759 The Wonders of Hexhaven — advanceWonderProgress', () => {
  it('does nothing below the first threshold, even with a qualifying hand', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('wondersOfHexhaven'), seed: 'wc-below' });
    // One fewer piece than the first threshold requires (robust to whatever WONDER_THRESHOLDS[0] is).
    const belowCount = Math.max(0, WONDER_THRESHOLDS[0]! - 1);
    const settlements = Array.from({ length: belowCount }, (_, i) => i) as VertexId[];
    const s = withSeat(g, 0, {
      settlements,
      resources: { brick: 0, lumber: 0, wool: 0, grain: 5, ore: 5 },
    });
    expect(advanceWonderProgress(s, 0)).toBeNull();
  });

  it('does nothing at the threshold WITHOUT the resource stockpile', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('wondersOfHexhaven'), seed: 'wc-noresource' });
    const settlements = Array.from({ length: WONDER_THRESHOLDS[0]! }, (_, i) => i) as VertexId[];
    const s = withSeat(g, 0, {
      settlements,
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 },
    });
    expect(advanceWonderProgress(s, 0)).toBeNull();
  });

  it('completes stage 0 once BOTH the threshold and the resource stockpile are met', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('wondersOfHexhaven'), seed: 'wc-stage0' });
    const settlements = Array.from({ length: WONDER_THRESHOLDS[0]! }, (_, i) => i) as VertexId[];
    const s = withSeat(g, 0, {
      settlements,
      resources: { brick: 0, lumber: 5, wool: 0, grain: 5, ore: 5 },
    });
    const result = advanceWonderProgress(s, 0);
    expect(result).not.toBeNull();
    expect(wonderStagesOf(result!.state, 0)).toBe(1);
    expect(wonderVp(result!.state, 0)).toBe(1);
    expect(computeVp(result!.state, 0).wonderVp).toBe(1);
    expect(result!.state.ext!.seafarers!.wonder).not.toBe(s.ext!.seafarers!.wonder); // spread-copied
  });

  it('advances multiple stages at once if pieces/resources jump past more than one threshold', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('wondersOfHexhaven'), seed: 'wc-jump' });
    const lastThreshold = WONDER_THRESHOLDS[WONDER_THRESHOLDS.length - 1]!;
    const settlements = Array.from({ length: lastThreshold }, (_, i) => i) as VertexId[];
    const s = withSeat(g, 0, {
      settlements,
      resources: { brick: 0, lumber: 5, wool: 0, grain: 10, ore: 10 },
    });
    const result = advanceWonderProgress(s, 0);
    expect(result).not.toBeNull();
    expect(wonderStagesOf(result!.state, 0)).toBe(WONDER_STAGES);
    expect(wonderComplete(result!.state, 0)).toBe(true);
  });

  it('does not regress or re-grant an already-completed stage', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('wondersOfHexhaven'), seed: 'wc-idempotent' });
    const settlements = Array.from({ length: WONDER_THRESHOLDS[0]! }, (_, i) => i) as VertexId[];
    const s = withSeat(g, 0, {
      settlements,
      resources: { brick: 0, lumber: 5, wool: 0, grain: 5, ore: 5 },
    });
    const once = advanceWonderProgress(s, 0)!.state;
    expect(wonderStagesOf(once, 0)).toBe(1);
    // Calling again with the SAME state (still only at threshold 0's piece count) grants nothing more.
    expect(advanceWonderProgress(once, 0)).toBeNull();
  });

  it('only affects the acting seat — other seats stay at 0', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('wondersOfHexhaven'), seed: 'wc-other-seat' });
    const settlements = Array.from({ length: WONDER_THRESHOLDS[0]! }, (_, i) => i) as VertexId[];
    const s = withSeat(g, 2, {
      settlements,
      resources: { brick: 0, lumber: 5, wool: 0, grain: 5, ore: 5 },
    });
    const result = advanceWonderProgress(s, 2)!.state;
    expect(wonderStagesOf(result, 2)).toBe(1);
    expect(wonderStagesOf(result, 0)).toBe(0);
    expect(wonderStagesOf(result, 1)).toBe(0);
  });
});

describe('T-759 The Wonders of Hexhaven — alternate win (checkWin)', () => {
  it('a seat with every stage complete wins immediately, even below the VP target', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('wondersOfHexhaven'), seed: 'wc-win' });
    const wonder = g.ext!.seafarers!.wonder!.map((s, seat) => (seat === 1 ? WONDER_STAGES : s));
    const s: GameState = { ...g, ext: { ...g.ext, seafarers: { ...g.ext!.seafarers!, wonder } } };
    expect(computeVp(s, 1).total).toBeLessThan(s.config.targetVp); // nowhere near 14 VP
    const won = checkWin(s, 1);
    expect(won.phase.kind).toBe('ended');
    expect(won.phase.kind === 'ended' && won.phase.winner).toBe(1);
  });

  it('a seat with only SOME stages complete does not trigger the alternate win', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('wondersOfHexhaven'), seed: 'wc-partial' });
    const wonder = g.ext!.seafarers!.wonder!.map((s, seat) => (seat === 1 ? WONDER_STAGES - 1 : s));
    const s: GameState = { ...g, ext: { ...g.ext, seafarers: { ...g.ext!.seafarers!, wonder } } };
    const won = checkWin(s, 1);
    expect(won).toBe(s); // unchanged reference — no win
    expect(won.phase.kind).not.toBe('ended');
  });

  it('a base/other-scenario game never evaluates the wonder branch (no ext.seafarers.wonder at all)', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('headingForNewShores'), seed: 'wc-other' });
    // Even a seat with a huge (impossible-here) VP total only wins through the ordinary VP-target
    // path — the wonder branch is unreachable because `isWondersOfHexhavenState` is false.
    expect(isWondersOfHexhavenState(g)).toBe(false);
    const won = checkWin(g, 0);
    expect(won).toBe(g); // fresh game, nobody near 14 VP — unchanged
  });
});

describe('T-759 The Wonders of Hexhaven — redaction (public pass-through, no masking)', () => {
  it('wonder passes through unredacted for every viewer, incl. non-owners', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('wondersOfHexhaven'), seed: 'wc-redact' });
    const settlements = Array.from({ length: WONDER_THRESHOLDS[0]! }, (_, i) => i) as VertexId[];
    const s = withSeat(g, 0, {
      settlements,
      resources: { brick: 0, lumber: 5, wool: 0, grain: 5, ore: 5 },
    });
    const advanced = advanceWonderProgress(s, 0)!.state;

    for (const viewer of [0, 1, 2] as Seat[]) {
      const view = redact(advanced, viewer);
      expect(view.ext?.seafarers?.wonder).toEqual(advanced.ext?.seafarers?.wonder);
    }
  });

  it('every other seafarers scenario omits `wonder` entirely from the view', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('headingForNewShores'), seed: 'wc-redact-other' });
    const view = redact(g, 0);
    expect(view.ext?.seafarers?.wonder).toBeUndefined();
  });
});
