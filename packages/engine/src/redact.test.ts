// T-204: redact.ts unit tests. This is the security-critical surface — every test here proves an
// OMISSION (a key is entirely absent), not merely that a value looks redacted, because a leak test
// that only checks "the value is a count" would miss a bug that ships the real array *alongside*
// a count. Uses a recursive structural walk (`findKeyPaths`) so "no `rng` anywhere" etc. can't be
// fooled by nesting.

import { describe, expect, it } from 'vitest';
import type { AnyDevCardId, GameState, Seat } from '@hexhaven/shared';
import { createGame } from './createGame.js';
import { discarded, devBought, helperUsed, stolen } from './events.js';
import { redact, redactEvent } from './redact.js';
import { stateWith } from './testkit.js';

/** Every path (dot-joined) in `value` whose final key is exactly `key`, walking arrays too. */
function findKeyPaths(value: unknown, key: string, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${k}` : k;
    if (k === key) out.push(here);
    out.push(...findKeyPaths(v, key, here));
  }
  return out;
}

describe('redact()', () => {
  const state = stateWith();
  const viewer = 0 as Seat;
  const view = redact(state, viewer);

  it('never contains an `rng` key anywhere in the view', () => {
    expect(findKeyPaths(view, 'rng')).toEqual([]);
  });

  it('never contains a `devDeck` key (only the count) anywhere in the view', () => {
    expect(findKeyPaths(view, 'devDeck')).toEqual([]);
    expect(view.devDeckCount).toBe(state.devDeck.length);
  });

  it("the viewer's own player entry is the full PlayerState (resources + devCards present)", () => {
    const own = view.players[viewer];
    expect(own).toBeDefined();
    expect(own).toMatchObject({
      seat: viewer,
      resources: state.players[viewer]!.resources,
      devCards: state.players[viewer]!.devCards,
    });
  });

  it("every OTHER player's entry has no `resources` or `devCards` key at all — counts only", () => {
    for (const p of view.players) {
      if (p.seat === viewer) continue;
      expect(p).not.toHaveProperty('resources');
      expect(p).not.toHaveProperty('devCards');
      expect(p).toMatchObject({
        seat: p.seat,
        resourceCount: expect.any(Number),
        devCardCount: expect.any(Number),
      });
    }
  });

  it('structural walk: any object with a `resources` key belongs to the viewer only', () => {
    // A stronger, order-independent version of the check above: walk the WHOLE view and confirm
    // every `resources` record sits inside a player object whose `seat` is the viewer's.
    for (const p of view.players) {
      const hasResources = Object.prototype.hasOwnProperty.call(p, 'resources');
      if (hasResources) expect(p.seat).toBe(viewer);
    }
  });

  it("every other player's counts match the true hand/dev-card sizes (redaction, not corruption)", () => {
    for (const p of state.players) {
      if (p.seat === viewer) continue;
      const entry = view.players[p.seat];
      if (!entry || 'resources' in entry) throw new Error('expected a redacted OtherPlayerView');
      const trueCount = Object.values(p.resources).reduce((a, b) => a + b, 0);
      expect(entry.resourceCount).toBe(trueCount);
      expect(entry.devCardCount).toBe(p.devCards.length);
      expect(entry.roads).toEqual(p.roads);
      expect(entry.settlements).toEqual(p.settlements);
      expect(entry.cities).toEqual(p.cities);
    }
  });

  it('public fields ride through unchanged: board, bank, awards, phase, turn, trade, stateVersion', () => {
    expect(view.board).toEqual(state.board);
    expect(view.bank).toEqual(state.bank);
    expect(view.awards).toEqual(state.awards);
    expect(view.phase).toEqual(state.phase);
    expect(view.turn).toEqual(state.turn);
    expect(view.trade).toEqual(state.trade);
    expect(view.stateVersion).toBe(state.stateVersion);
    expect(view.me).toBe(viewer);
  });

  it('is produced identically (redaction is deterministic) regardless of extra calls', () => {
    expect(redact(state, viewer)).toEqual(view);
  });

  it('omits `ext` entirely in a base game (no key when state.ext is absent)', () => {
    expect(findKeyPaths(view, 'ext')).toEqual([]);
    expect(view.ext).toBeUndefined();
  });

  it('surfaces ONLY the fiveSix partial-turn marker (seats/flags) when state.ext is present (T-603)', () => {
    // A 2022 Paired-Players partial turn in progress: player 2 (seat 3) building, resuming from
    // player 1 (seat 0). Craft it directly on ext — these are seat indices, never hidden info.
    const withExt = {
      ...state,
      ext: { fiveSix: { partialTurn: { builder: 3 as Seat, resumeFrom: 0 as Seat } } },
    };
    const v = redact(withExt, viewer);
    expect(v.ext).toEqual({ fiveSix: { partialTurn: { builder: 3, resumeFrom: 0 } } });
    // Redaction of the rest is unaffected: still no rng / devDeck / other-seat hands leak.
    expect(findKeyPaths(v, 'rng')).toEqual([]);
    expect(findKeyPaths(v, 'devDeck')).toEqual([]);
    for (const p of v.players) {
      if (p.seat !== viewer) {
        expect(p).not.toHaveProperty('resources');
        expect(p).not.toHaveProperty('devCards');
      }
    }
  });

  it('surfaces a null partial turn (fiveSix active, no partial turn) without leaking anything', () => {
    const withExt = { ...state, ext: { fiveSix: { partialTurn: null } } };
    const v = redact(withExt, viewer);
    expect(v.ext).toEqual({ fiveSix: { partialTurn: null } });
  });

  it('surfaces `ext.helpers` fully (T-905): public display/assignments/turn-flags pass through', () => {
    // Follow-up fix (Phase-9 play-UI task): `ext.helpers` was entirely absent from `redactExt`
    // before this — the Helpers HUD can't be built at all without this passthrough (research §3:
    // "each player holds exactly one helper at a time", table-visible, not hidden information).
    const helpersExt: NonNullable<GameState['ext']>['helpers'] = {
      display: ['general', 'merchant'],
      bySeat: [
        { id: 'mayor', side: 'A', acquiredTurn: 2 },
        null,
        { id: 'captain', side: 'B', acquiredTurn: 1 },
        null,
      ],
      usedThisTurn: [false, false, true, false],
      mayorEligible: [true, false, false, false],
      captainRate: [null, null, 'ore', null],
      // No pending Architect peeks in this fixture — covered by its own describe block below.
      architectPeek: [null, null, null, null],
    };
    const withExt = { ...state, ext: { helpers: helpersExt } };
    const v = redact(withExt, viewer);
    // Every field but `architectPeek` is a straight passthrough; `architectPeek` collapses to the
    // VIEWER's own entry only (peek reveal fix, redact.ts hidden-info UX — see the dedicated describe
    // block below), which is `null` in this fixture since nobody has a pending peek at all.
    expect(v.ext).toEqual({ helpers: { ...withExt.ext.helpers, architectPeek: null } });
    // Redaction of the rest is unaffected: still no rng / devDeck / other-seat hands leak.
    expect(findKeyPaths(v, 'rng')).toEqual([]);
    expect(findKeyPaths(v, 'devDeck')).toEqual([]);
    for (const p of v.players) {
      if (p.seat !== viewer) {
        expect(p).not.toHaveProperty('resources');
        expect(p).not.toHaveProperty('devCards');
      }
    }
  });

  describe('ext.helpers.architectPeek (peek reveal fix)', () => {
    const helpersExtBase: NonNullable<GameState['ext']>['helpers'] = {
      display: ['general', 'merchant'],
      bySeat: [null, null, null, null],
      usedThisTurn: [false, false, false, false],
      mayorEligible: [false, false, false, false],
      captainRate: [null, null, null, null],
      architectPeek: [null, null, null, null],
    };

    it("surfaces the VIEWER's own pending peek as a plain card array", () => {
      const architectPeek: (readonly AnyDevCardId[] | null)[] = [['knight', 'roadBuilding', 'monopoly'], null, null, null];
      const helpersExt = { ...helpersExtBase, architectPeek };
      const withExt = { ...state, ext: { helpers: helpersExt } };
      const v = redact(withExt, viewer);
      expect(v.ext?.helpers?.architectPeek).toEqual(['knight', 'roadBuilding', 'monopoly']);
    });

    it("never surfaces another seat's pending peek — structural no-leak proof", () => {
      const architectPeek: (readonly AnyDevCardId[] | null)[] = [null, null, ['victoryPoint'], null];
      const helpersExt = { ...helpersExtBase, architectPeek };
      const withExt = { ...state, ext: { helpers: helpersExt } };
      const v = redact(withExt, viewer); // viewer = seat 0; the pending peek belongs to seat 2
      expect(v.ext?.helpers?.architectPeek).toBeNull();
      expect(JSON.stringify(v)).not.toContain('victoryPoint');
    });

    it('is null when nobody has a pending peek', () => {
      const withExt = { ...state, ext: { helpers: helpersExtBase } };
      const v = redact(withExt, viewer);
      expect(v.ext?.helpers?.architectPeek).toBeNull();
    });
  });

  it('redacts every seat consistently (no cross-seat leakage in a 4-viewer sweep)', () => {
    for (let seat = 0; seat < state.players.length; seat++) {
      const v = redact(state, seat as Seat);
      expect(findKeyPaths(v, 'rng')).toEqual([]);
      expect(findKeyPaths(v, 'devDeck')).toEqual([]);
      for (const p of v.players) {
        if (p.seat === seat) {
          expect(p).toHaveProperty('resources');
        } else {
          expect(p).not.toHaveProperty('resources');
          expect(p).not.toHaveProperty('devCards');
        }
      }
    }
  });

  describe('ext.citiesKnights.spyPeek (peek reveal fix)', () => {
    const ckConfig = {
      playerCount: 4 as const,
      targetVp: 13,
      board: 'random' as const,
      tokenMethod: 'spiral' as const,
      expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: true as const },
    };

    it("surfaces the VIEWER's own pending Spy peek", () => {
      const created = createGame({ ...ckConfig, seed: 'ck-spy-peek' });
      const ck = created.ext!.citiesKnights!;
      const withPeek: GameState = {
        ...created,
        ext: {
          ...created.ext,
          citiesKnights: {
            ...ck,
            spyPeek: [{ targetSeat: 1 as Seat, cards: ['bishop', 'warlord'] }, null, null, null],
          },
        },
      };
      const v = redact(withPeek, viewer);
      expect(v.ext?.citiesKnights?.spyPeek).toEqual({ targetSeat: 1, cards: ['bishop', 'warlord'] });
    });

    it("never surfaces another seat's pending peek — structural no-leak proof", () => {
      const created = createGame({ ...ckConfig, seed: 'ck-spy-peek-other' });
      const ck = created.ext!.citiesKnights!;
      const withPeek: GameState = {
        ...created,
        ext: {
          ...created.ext,
          citiesKnights: {
            ...ck,
            // The pending peek belongs to seat 2 (viewer here is seat 0).
            spyPeek: [null, null, { targetSeat: 3 as Seat, cards: ['saboteur'] }, null],
          },
        },
      };
      const v = redact(withPeek, viewer);
      expect(v.ext?.citiesKnights?.spyPeek).toBeNull();
      expect(JSON.stringify(v)).not.toContain('saboteur');
    });

    it('is null when nobody has a pending peek', () => {
      const created = createGame({ ...ckConfig, seed: 'ck-spy-peek-none' });
      const v = redact(created, viewer);
      expect(v.ext?.citiesKnights?.spyPeek).toBeNull();
    });
  });
});

describe('redactEvent()', () => {
  const seatA = 0 as Seat;
  const seatB = 1 as Seat;
  const seatC = 2 as Seat;

  describe('discarded (ER-9)', () => {
    const ev = discarded(seatA, { brick: 2, lumber: 1 });

    it('the discarder sees the real cards', () => {
      expect(redactEvent(ev, seatA)).toEqual(ev);
    });

    it('everyone else sees only a count — no `cards` key, no resource identities', () => {
      const redacted = redactEvent(ev, seatB);
      expect(redacted).toEqual({ type: 'discarded', seat: seatA, count: 3 });
      expect(redacted).not.toHaveProperty('cards');
      expect(findKeyPaths(redacted, 'brick')).toEqual([]);
      expect(findKeyPaths(redacted, 'lumber')).toEqual([]);
    });
  });

  describe('stolen (ER-10)', () => {
    const ev = stolen(seatA, seatB, 'ore');

    it('the thief sees the real card', () => {
      expect(redactEvent(ev, seatA)).toEqual(ev);
    });

    it('the victim sees the real card', () => {
      expect(redactEvent(ev, seatB)).toEqual(ev);
    });

    it('every bystander sees from/to but no `card` key at all', () => {
      const redacted = redactEvent(ev, seatC);
      expect(redacted).toEqual({ type: 'stolen', from: seatA, to: seatB });
      expect(redacted).not.toHaveProperty('card');
    });
  });

  describe('devBought', () => {
    const ev = devBought(seatA, 'knight');

    it('the buyer sees the real card', () => {
      expect(redactEvent(ev, seatA)).toEqual(ev);
    });

    it('everyone else sees the seat but no `card` key at all', () => {
      const redacted = redactEvent(ev, seatB);
      expect(redacted).toEqual({ type: 'devBought', seat: seatA });
      expect(redacted).not.toHaveProperty('card');
    });
  });

  describe('helperUsed (T-905, "The Helpers of Hexhaven" modifier)', () => {
    it('the acting seat always sees the real detail', () => {
      const ev = helperUsed(seatA, 'merchant', 'A', { demand: 'ore', transfers: [{ target: seatB, took: true, gaveBack: 'brick' }] });
      expect(redactEvent(ev, seatA)).toEqual(ev);
    });

    it.each(['merchant', 'mendicant', 'priest', 'architect'] as const)(
      'hides `detail` from every other viewer for the hand-revealing helper "%s"',
      (helper) => {
        const ev = helperUsed(seatA, helper, 'A', { some: 'secret' });
        const redacted = redactEvent(ev, seatB);
        expect(redacted).toEqual({ type: 'helperUsed', seat: seatA, helper, side: 'A' });
        expect(redacted).not.toHaveProperty('detail');
      }
    );

    it.each(['mayor', 'explorer', 'robberBride', 'captain', 'noblewoman'] as const)(
      'rides through unchanged for a non-hand-revealing helper "%s" (already public)',
      (helper) => {
        const ev = helperUsed(seatA, helper, 'B', { some: 'public data' });
        expect(redactEvent(ev, seatB)).toEqual(ev);
      }
    );
  });

  describe('everything else passes through unchanged', () => {
    it('e.g. diceRolled, built, monopolyResolved, bankTraded, gameWon', () => {
      const events = [
        { type: 'diceRolled' as const, seat: seatA, roll: [3, 4] as [number, number] },
        { type: 'built' as const, seat: seatA, piece: 'road' as const, location: 0 as never },
        {
          type: 'monopolyResolved' as const,
          seat: seatA,
          resource: 'ore' as const,
          taken: [{ seat: seatB, count: 2 }],
        },
        {
          type: 'bankTraded' as const,
          seat: seatA,
          gave: { brick: 4 },
          got: { ore: 1 },
          rate: 4 as const,
        },
        { type: 'gameWon' as const, seat: seatA, vpBreakdown: { total: 10 } },
      ];
      for (const ev of events) {
        expect(redactEvent(ev, seatC)).toEqual(ev);
        expect(redactEvent(ev, seatA)).toEqual(ev);
      }
    });
  });
});
