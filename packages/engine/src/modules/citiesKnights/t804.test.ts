// T-804: end-to-end wiring smoke tests over the PUBLIC `reduce`/`createGame` surface (mirrors
// t802.test.ts/t803.test.ts's role) — proves the C6.2 draw mechanic, `playProgressCard` timing
// (after-roll; Alchemist before-roll), C11 (no dev cards / no Largest Army), and redaction are
// actually wired through `reduce`/`redact`, not just that the pure helpers are individually correct
// (covered by progressCards.test.ts).

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { CitiesKnightsExt, GameState, HexId, Seat, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { redact } from '../../redact.js';
import { reduce } from '../../reduce.js';
import { rollDie } from '../../rng.js';
import { computeVp } from '../../vp.js';
import { rollEventDie } from './barbarian.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 13,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: true as const },
};

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as VertexId;

/** Smallest rng seed whose 2 number dice sum to `total` AND whose (3rd) event die shows `face`
 *  (mirrors t803.test.ts's helper of the same name). */
function rngFor(total: number, face: 'ship' | 'trade' | 'politics' | 'science'): number {
  for (let r = 1; r < 500_000; r++) {
    const a = rollDie(r);
    const b = rollDie(a.state);
    if (a.value + b.value !== total) continue;
    const draw = rollEventDie(b.state);
    if (draw.face === face) return r;
  }
  throw new Error(`BUG: no rng found for total ${total} / face ${face}`);
}

function allDesertBoard(hexCount: number): { terrain: TerrainType; token: number | null }[] {
  return Array.from({ length: hexCount }, () => ({ terrain: 'desert' as TerrainType, token: null }));
}

describe('C6.2 draw mechanic wired through reduce()', () => {
  it('a colour-gate roll draws a progress card into an eligible seat’s hand', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-draw' });
    const ck = created.ext!.citiesKnights!;
    let state: GameState = {
      ...created,
      board: { ...created.board, hexes: allDesertBoard(created.board.hexes.length), robber: 18 as HexId },
      ext: { ...created.ext, citiesKnights: { ...ck, improvements: ck.improvements.map((i, s) => (s === 0 ? { ...i, science: 5 } : i)) } },
      phase: { kind: 'preRoll' },
      turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
      rng: rngFor(6, 'science'),
    };

    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.state;
    expect(state.ext!.citiesKnights!.progressHand[0]).toHaveLength(1);
    expect(res.events.some((e) => e.type === 'progressCardDrawn')).toBe(true);
  });
});

describe('playProgressCard timing (C6.4)', () => {
  it('rejects a normal card before rolling (still preRoll)', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-timing-preroll' });
    const ck = created.ext!.citiesKnights!;
    const state: GameState = {
      ...created,
      ext: { ...created.ext, citiesKnights: { ...ck, progressHand: ck.progressHand.map((h2, s) => (s === 0 ? ['warlord' as const] : h2)) } },
      phase: { kind: 'preRoll' },
      turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
    };
    const res = reduce(state, 0, { type: 'playProgressCard', card: 'warlord' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('WRONG_PHASE');
  });

  it('allows a normal card after rolling in main', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-timing-main' });
    const ck = created.ext!.citiesKnights!;
    const state: GameState = {
      ...created,
      ext: { ...created.ext, citiesKnights: { ...ck, progressHand: ck.progressHand.map((h2, s) => (s === 0 ? ['warlord' as const] : h2)) } },
      phase: { kind: 'main' },
      turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    };
    const res = reduce(state, 0, { type: 'playProgressCard', card: 'warlord' });
    expect(res.ok).toBe(true);
  });

  it('Alchemist is playable BEFORE rolling (preRoll, not yet rolled)', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-alchemist-preroll' });
    const ck = created.ext!.citiesKnights!;
    const state: GameState = {
      ...created,
      ext: { ...created.ext, citiesKnights: { ...ck, progressHand: ck.progressHand.map((h2, s) => (s === 0 ? ['alchemist' as const] : h2)) } },
      phase: { kind: 'preRoll' },
      turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
    };
    const res = reduce(state, 0, { type: 'playProgressCard', card: 'alchemist', yellowDie: 2, redDie: 4 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext!.citiesKnights!.alchemistForced).toEqual([2, 4]);
  });

  it('Alchemist is rejected AFTER rolling', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-alchemist-postroll' });
    const ck = created.ext!.citiesKnights!;
    const state: GameState = {
      ...created,
      ext: { ...created.ext, citiesKnights: { ...ck, progressHand: ck.progressHand.map((h2, s) => (s === 0 ? ['alchemist' as const] : h2)) } },
      phase: { kind: 'main' },
      turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    };
    const res = reduce(state, 0, { type: 'playProgressCard', card: 'alchemist', yellowDie: 2, redDie: 4 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('WRONG_PHASE');
  });

  it('a forced Alchemist roll overrides the next rollDice’s number dice (event die stays random)', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-alchemist-forced' });
    const ck = created.ext!.citiesKnights!;
    let state: GameState = {
      ...created,
      board: { ...created.board, hexes: allDesertBoard(created.board.hexes.length), robber: 18 as HexId },
      ext: { ...created.ext, citiesKnights: { ...ck, alchemistForced: [2, 3] } },
      phase: { kind: 'preRoll' },
      turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
    };
    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.state;
    expect(state.turn.roll).toEqual([2, 3]);
    expect(state.ext!.citiesKnights!.alchemistForced).toBeNull();
    expect(res.events.some((e) => e.type === 'diceRolled' && e.roll[0] === 2 && e.roll[1] === 3)).toBe(true);
  });
});

describe('C11: dev cards removed / no Largest Army in Cities & Knights', () => {
  it('rejects buyDevCard (C11.1)', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-c11-buy' });
    const state: GameState = {
      ...created,
      players: created.players.map((p) => (p.seat === 0 ? { ...p, resources: { brick: 0, lumber: 0, wool: 5, grain: 5, ore: 5 } } : p)),
      phase: { kind: 'main' },
      turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    };
    const res = reduce(state, 0, { type: 'buyDevCard' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('DEV_CARDS_DISABLED');
  });

  it('rejects playKnight/playRoadBuilding/playYearOfPlenty/playMonopoly (C11.1)', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-c11-play' });
    const state: GameState = {
      ...created,
      phase: { kind: 'main' },
      turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    };
    for (const action of [
      { type: 'playKnight' as const },
      { type: 'playRoadBuilding' as const },
      { type: 'playYearOfPlenty' as const, a: 'brick' as const, b: 'ore' as const },
      { type: 'playMonopoly' as const, resource: 'wool' as const },
    ]) {
      const res = reduce(state, 0, action);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('DEV_CARDS_DISABLED');
    }
  });

  it('Largest Army never contributes VP in a C&K game, even if awards.largestArmy somehow held a seat', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-c11-army' });
    const state: GameState = {
      ...created,
      awards: { ...created.awards, largestArmy: { holder: 0 as Seat, count: 5 } },
    };
    expect(computeVp(state, 0).largestArmy).toBe(0);
  });
});

describe('redaction: an opponent’s progress-card hand is hidden', () => {
  it('the viewer sees their own hand; every other seat is a count only', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-redact' });
    const ck = created.ext!.citiesKnights!;
    const state: GameState = {
      ...created,
      ext: {
        ...created.ext,
        citiesKnights: {
          ...ck,
          progressHand: [['warlord'], ['bishop', 'spy'], [], []] as CitiesKnightsExt['progressHand'],
        },
      },
    };
    const view = redact(state, 0 as Seat);
    expect(view.ext!.citiesKnights!.ownProgressHand).toEqual(['warlord']);
    expect(view.ext!.citiesKnights!.progressHandCounts).toEqual([1, 2, 0, 0]);
    // Structural proof: no other seat's actual card names appear anywhere in the view. Quoted (not a
    // bare substring match) so the legitimately-public `spyPeek` KEY (peek reveal fix) doesn't false-
    // positive this check — `"spyPeek"` never contains the exact JSON string value `"spy"`.
    expect(JSON.stringify(view)).not.toContain('"bishop"');
    expect(JSON.stringify(view)).not.toContain('"spy"');
  });
});

describe('scripted smoke: draw then play several cards', () => {
  it('draws a Warlord-eligible card via a colour gate, then plays it through reduce()', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-smoke' });
    const ck = created.ext!.citiesKnights!;
    let state: GameState = {
      ...created,
      board: { ...created.board, hexes: allDesertBoard(created.board.hexes.length), robber: 18 as HexId },
      ext: {
        ...created.ext,
        citiesKnights: {
          ...ck,
          improvements: ck.improvements.map((i, s) => (s === 0 ? { ...i, politics: 5 } : i)),
          knights: [[{ vertex: vtx(0, 0), level: 1, active: false }], [], [], []],
        },
      },
      phase: { kind: 'preRoll' },
      turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
      rng: rngFor(6, 'politics'),
    };

    const rollRes = reduce(state, 0, { type: 'rollDice' });
    expect(rollRes.ok).toBe(true);
    if (!rollRes.ok) return;
    state = rollRes.state;

    // Whatever politics card seat 0 drew, force it to Warlord for a deterministic play step.
    state = { ...state, ext: { ...state.ext, citiesKnights: { ...state.ext!.citiesKnights!, progressHand: [['warlord'], [], [], []] } } };

    const playRes = reduce(state, 0, { type: 'playProgressCard', card: 'warlord' });
    expect(playRes.ok).toBe(true);
    if (!playRes.ok) return;
    expect(playRes.state.ext!.citiesKnights!.knights[0]![0]!.active).toBe(true);
    expect(playRes.state.ext!.citiesKnights!.progressHand[0]).toHaveLength(0);
  });
});

describe('peekSpyTarget wired through reduce()/redact() (peek reveal fix, redact.ts hidden-info UX)', () => {
  function spyReadyState(seed: string): GameState {
    const created = createGame({ ...CONFIG, seed });
    const ck = created.ext!.citiesKnights!;
    return {
      ...created,
      ext: {
        ...created.ext,
        citiesKnights: {
          ...ck,
          progressHand: [['spy'], ['bishop', 'warlord'], [], []] as CitiesKnightsExt['progressHand'],
        },
      },
      phase: { kind: 'main' },
      turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    };
  }

  it("reveals the target's real hand to ONLY the peeking seat's redacted view", () => {
    const state = spyReadyState('ck-peek-reduce');
    const res = reduce(state, 0, { type: 'peekSpyTarget', targetSeat: 1 as Seat });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const ownView = redact(res.state, 0 as Seat);
    expect(ownView.ext!.citiesKnights!.spyPeek).toEqual({ targetSeat: 1, cards: ['bishop', 'warlord'] });

    // No OTHER seat's `spyPeek` entry is ever populated — each seat only ever sees its own pending
    // peek (never null for the target itself here, since seat 1 has none of ITS OWN pending).
    for (const seat of [1, 2, 3] as Seat[]) {
      expect(redact(res.state, seat).ext!.citiesKnights!.spyPeek).toBeNull();
    }
    // Bystanders (neither the peeking seat 0 nor the target seat 1, whose OWN hand legitimately
    // shows its own cards via `ownProgressHand`) never see the target's card identities anywhere.
    for (const seat of [2, 3] as Seat[]) {
      expect(JSON.stringify(redact(res.state, seat))).not.toContain('"warlord"');
    }
  });

  it('a turn advance clears the pending peek (hygiene — never outlives the turn it was requested on)', () => {
    const state = spyReadyState('ck-peek-turn-clear');
    const peeked = reduce(state, 0, { type: 'peekSpyTarget', targetSeat: 1 as Seat });
    expect(peeked.ok).toBe(true);
    if (!peeked.ok) return;
    expect(peeked.state.ext!.citiesKnights!.spyPeek[0]).not.toBeNull();

    const ended = reduce(peeked.state, 0, { type: 'endTurn' });
    expect(ended.ok).toBe(true);
    if (!ended.ok) return;
    expect(ended.state.ext!.citiesKnights!.spyPeek.every((p) => p === null)).toBe(true);
  });
});
