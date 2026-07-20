// T-803: end-to-end wiring smoke tests over the PUBLIC `reduce`/`createGame` surface (mirrors
// t802.test.ts's role for T-802) — proves the event die + barbarian cycle + robber lock are
// actually routed through `reduce` (module `afterAction`/`interceptAction`), not just that the pure
// helpers in barbarian.ts/knights.ts are individually correct (covered by their own *.test.ts).

import { describe, expect, it } from 'vitest';
import { CK_BARBARIAN_STEPS_TO_ATTACK, GEOMETRY } from '@hexhaven/shared';
import type { GameState, HexId, TerrainType, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
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

/** Smallest rng seed whose 2 number dice sum to `total` AND whose (3rd) event die shows `face`. */
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

describe('barbarian cycle over the public reduce()/createGame surface (T-803 smoke)', () => {
  it('advances the ship 1/roll on a ship face, attacks after CK_BARBARIAN_STEPS_TO_ATTACK, defends, awards Defender VP, resets the ship, deactivates knights, and unlocks the robber', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-barbarian' });

    let state: GameState = {
      ...created,
      board: { ...created.board, hexes: allDesertBoard(created.board.hexes.length), robber: 18 as HexId },
      players: created.players.map((p) => (p.seat === 0 ? { ...p, cities: [vtx(0, 0)] } : p)),
      ext: {
        ...created.ext,
        citiesKnights: {
          ...created.ext!.citiesKnights!,
          // seat0: 1 city (attack strength 1) + one ACTIVE strength-2 knight (defense 2) -> defended,
          // sole highest defense -> Defender of Hexhaven (C8.4/C8.5).
          knights: [[{ vertex: vtx(0, 1), level: 2, active: true }], [], [], []],
        },
      },
      phase: { kind: 'preRoll' },
      turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
    };
    expect(state.ext!.citiesKnights!.robberLocked).toBe(true);

    for (let i = 1; i <= CK_BARBARIAN_STEPS_TO_ATTACK; i++) {
      state = { ...state, rng: rngFor(6, 'ship'), phase: { kind: 'preRoll' }, turn: { ...state.turn, rolled: false, roll: null } };
      const res = reduce(state, 0, { type: 'rollDice' });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      state = res.state;
      const ck = state.ext!.citiesKnights!;

      if (i < CK_BARBARIAN_STEPS_TO_ATTACK) {
        expect(ck.barbarian.position).toBe(i);
        expect(res.events.some((e) => e.type === 'barbarianAttackResolved')).toBe(false);
        expect(ck.robberLocked).toBe(true);
      } else {
        // The Nth ship advance triggers the attack (C8.2).
        expect(ck.barbarian.position).toBe(0); // C8.2/C8.7: reset after the attack
        expect(ck.barbarian.attacksResolved).toBe(1);
        expect(ck.robberLocked).toBe(false); // C10.1: unlocked by the first attack
        expect(ck.knights[0]![0]!.active).toBe(false); // C8.7: every knight deactivated
        expect(ck.defenderVp[0]).toBe(1); // C8.5
        expect(computeVp(state, 0).defenderOfHexhaven).toBe(1);

        const attackEvent = res.events.find((e) => e.type === 'barbarianAttackResolved');
        expect(attackEvent).toBeDefined();
        if (attackEvent && attackEvent.type === 'barbarianAttackResolved') {
          expect(attackEvent.result).toBe('defended');
          expect(attackEvent.defenderSeat).toBe(0);
          expect(attackEvent.attackStrength).toBe(1);
          expect(attackEvent.defenseStrength).toBe(2);
        }
      }
    }
  });
});

describe('robber lock on a rolled 7 before the first attack (C10.1)', () => {
  it('a 7 with nobody over the discard limit skips straight to main, never moveRobber', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-robber-lock' });
    const state: GameState = {
      ...created,
      board: { ...created.board, hexes: allDesertBoard(created.board.hexes.length), robber: 18 as HexId },
      phase: { kind: 'preRoll' },
      turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
      rng: rngFor(7, 'trade'),
    };
    expect(state.ext!.citiesKnights!.robberLocked).toBe(true);

    const res = reduce(state, 0, { type: 'rollDice' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase.kind).toBe('main'); // never moveRobber while locked
    expect(res.events.some((e) => e.type === 'robberMoved')).toBe(false);
    expect(res.state.ext!.citiesKnights!.robberLocked).toBe(true); // still locked (no attack this roll)
  });

  it('a 7 with a pending discard still redirects to main once the last discard resolves', () => {
    const created = createGame({ ...CONFIG, seed: 'ck-robber-lock-discard' });
    const players = created.players.map((p) =>
      p.seat === 0 ? { ...p, resources: { brick: 4, lumber: 4, wool: 0, grain: 0, ore: 0 } } : p
    );
    let state: GameState = {
      ...created,
      board: { ...created.board, hexes: allDesertBoard(created.board.hexes.length), robber: 18 as HexId },
      players,
      phase: { kind: 'preRoll' },
      turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
      rng: rngFor(7, 'trade'),
    };

    const rollRes = reduce(state, 0, { type: 'rollDice' });
    expect(rollRes.ok).toBe(true);
    if (!rollRes.ok) return;
    state = rollRes.state;
    expect(state.phase.kind).toBe('discard'); // 8 cards > threshold 7 -> must discard 4

    const discardRes = reduce(state, 0, { type: 'discard', cards: { brick: 4 } });
    expect(discardRes.ok).toBe(true);
    if (!discardRes.ok) return;
    expect(discardRes.state.phase.kind).toBe('main'); // redirected past moveRobber (still locked)
    expect(discardRes.events.some((e) => e.type === 'robberMoved')).toBe(false);
  });
});
