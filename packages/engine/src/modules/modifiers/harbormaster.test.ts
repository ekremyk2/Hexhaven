// harbormaster modifier tests (T-906 wave A-1, docs/07 D-034): harbor-point counting (settlement 1
// / city 2), the ≥3 claim threshold, tie-keeps-holder, a strictly-higher challenger stealing the
// award, and the +2 VP it contributes to `computeVp`. The generic `phaseHooks.afterAction` hook
// recomputes after ANY action — `endTurn` is used here purely as a cheap, always-legal trigger.

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { EdgeId, GameConfig, GameState, HarborType, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { computeVp } from '../../vp.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'harbormaster-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

// Three harbor edges, far enough apart in id space to not share a vertex.
const HARBOR_EDGE_IDS = [0, 5, 10] as const;
const edgeAt = (id: number) => GEOMETRY.edges[id]!;
const [E0, E1, E2] = HARBOR_EDGE_IDS.map(edgeAt);

interface Place {
  seat: Seat;
  settlements?: VertexId[];
  cities?: VertexId[];
}

function craft(opts: {
  place?: Place[];
  modifiers?: GameConfig['modifiers'];
  ext?: GameState['ext'];
} = {}): GameState {
  const g = createGame({ ...CONFIG, modifiers: opts.modifiers });
  const players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    return { ...p, settlements: pl.settlements ?? [], cities: pl.cities ?? [] };
  });
  const harbors = Object.fromEntries(HARBOR_EDGE_IDS.map((id) => [id, 'generic' as HarborType])) as Record<
    EdgeId,
    HarborType
  >;
  return {
    ...g,
    players,
    board: { ...g.board, harbors },
    ext: { ...g.ext, ...opts.ext },
    turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    phase: { kind: 'main' },
  };
}

function harborEvent(res: { ok: true; events: readonly { type: string }[] } | { ok: false }) {
  if (!res.ok) return undefined;
  return res.events.find((e) => e.type === 'awardMoved');
}

describe('harbormaster: harbor-point counting + the ≥3 claim threshold', () => {
  it('a settlement + a city on harbor vertices (1+2=3) claims the award', () => {
    const state = craft({
      place: [{ seat: 0, settlements: [E0!.a], cities: [E0!.b] }],
      modifiers: { harbormaster: true },
    });
    const res = reduce(state, 0, { type: 'endTurn' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext?.harbormaster).toEqual({ holder: 0, points: 3 });
    expect(harborEvent(res)).toMatchObject({ award: 'harbormaster', holder: 0, value: 3 });
  });

  it('below the threshold (1 point), the award stays unclaimed', () => {
    const state = craft({
      place: [{ seat: 0, settlements: [E0!.a] }],
      modifiers: { harbormaster: true },
    });
    const res = reduce(state, 0, { type: 'endTurn' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext?.harbormaster).toBeUndefined(); // no-op: nothing changed from the default
    expect(harborEvent(res)).toBeUndefined();
  });

  it('a tie AT the max never claims the award', () => {
    const state = craft({
      place: [
        { seat: 0, settlements: [E0!.a], cities: [E0!.b] }, // 3 points
        { seat: 1, settlements: [E1!.a], cities: [E1!.b] }, // 3 points — a tie
      ],
      modifiers: { harbormaster: true },
    });
    const res = reduce(state, 0, { type: 'endTurn' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext?.harbormaster).toBeUndefined();
    expect(harborEvent(res)).toBeUndefined();
  });

  it('a tie at the CURRENT holder\'s own total keeps the incumbent (no transfer)', () => {
    const state = craft({
      place: [
        { seat: 0, settlements: [E0!.a], cities: [E0!.b] }, // 3 points, current holder
        { seat: 1, settlements: [E1!.a], cities: [E1!.b] }, // 3 points — ties the holder
      ],
      ext: { harbormaster: { holder: 0, points: 3 } },
      modifiers: { harbormaster: true },
    });
    const res = reduce(state, 0, { type: 'endTurn' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext?.harbormaster).toEqual({ holder: 0, points: 3 });
    expect(harborEvent(res)).toBeUndefined(); // unchanged — no new award event
  });

  it('a strictly-higher challenger steals the award from the current holder', () => {
    const state = craft({
      place: [
        { seat: 0, settlements: [E0!.a], cities: [E0!.b] }, // 3 points, current holder
        { seat: 1, cities: [E1!.a, E2!.a] }, // 2 cities on harbor vertices = 4 points
      ],
      ext: { harbormaster: { holder: 0, points: 3 } },
      modifiers: { harbormaster: true },
    });
    const res = reduce(state, 0, { type: 'endTurn' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext?.harbormaster).toEqual({ holder: 1, points: 4 });
    expect(harborEvent(res)).toMatchObject({ award: 'harbormaster', holder: 1, value: 4 });
  });
});

describe('harbormaster: +2 VP contribution to computeVp', () => {
  it('the holder gets +2 VP; a non-holder gets 0; both omit the field when the modifier is off', () => {
    const withModifier = craft({
      place: [{ seat: 0, settlements: [E0!.a], cities: [E0!.b] }],
      modifiers: { harbormaster: true },
    });
    const res = reduce(withModifier, 0, { type: 'endTurn' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(computeVp(res.state, 0).harbormaster).toBe(2);
    expect(computeVp(res.state, 1).harbormaster).toBe(0);
    // Base total includes the +2 for the holder (1 settlement + 1 city + 2 harbormaster = 5).
    expect(computeVp(res.state, 0).total).toBe(5);

    const withoutModifier = craft({ place: [{ seat: 0, settlements: [E0!.a], cities: [E0!.b] }] });
    const baseRes = reduce(withoutModifier, 0, { type: 'endTurn' });
    expect(baseRes.ok).toBe(true);
    if (!baseRes.ok) return;
    expect(computeVp(baseRes.state, 0).harbormaster).toBeUndefined();
    expect(computeVp(baseRes.state, 0).total).toBe(3); // no +2 — the modifier is off (RK-13)
  });
});
