// Composition integration tests (PM wiring for T-904/T-905): proves `cardMods`/`helpers` resolve
// through `resolveModules` and compose cleanly ON TOP of an active expansion — Cities & Knights and
// Seafarers respectively — driven end-to-end via `reduce()`, not by calling either module's
// internals directly. Mirrors `playDevSameTurn.test.ts`'s "still DEV_CARDS_DISABLED in a C&K game"
// composition-proof pattern.

import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { reduce } from '../../reduce.js';
import { resolveModules } from '../index.js';
import { dealNextHelper, ensureHelpersExt } from './helpers/state.js';

const CK_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'cardmods-ck-compose',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
  modifiers: { cardMods: true },
};

const SEAFARERS_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'helpers-seafarers-compose',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
  modifiers: { helpers: true },
};

describe('cardMods composes with an expansion (Cities & Knights)', () => {
  it('resolveModules picks up both citiesKnights + cardMods, in order', () => {
    const result = resolveModules(CK_CONFIG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.modules.map((m) => m.id)).toEqual(['citiesKnights', 'cardMods']);
  });

  it('the dev deck gains the 6 curated additions ON TOP of the base 25 (31 total) — additive, not a replacement', () => {
    const g = createGame(CK_CONFIG);
    expect(g.devDeck).toHaveLength(31);
    for (const id of ['bumperCrop', 'merchantsBoon', 'roadToll', 'trailblazer', 'windfall', 'highwayman']) {
      expect(g.devDeck).toContain(id);
    }
  });

  it('builds a C&K game and plays a cardMods card end-to-end via reduce (bumperCrop)', () => {
    const g = createGame(CK_CONFIG);
    const players = g.players.map((p) =>
      p.seat === 0 ? { ...p, devCards: [{ type: 'bumperCrop' as const, boughtOnTurn: 1 }] } : p
    );
    const state = {
      ...g,
      players,
      turn: { ...g.turn, number: 5, rolled: true, devPlayed: false },
      phase: { kind: 'main' as const },
    };
    const res = reduce(state, 0, { type: 'playCardModCard', card: 'bumperCrop' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.turn.devPlayed).toBe(true);
    expect(res.state.players[0]!.devCards).toEqual([]);
    expect(res.events.some((e) => e.type === 'production')).toBe(true);
    expect(res.events.some((e) => e.type === 'devPlayed')).toBe(true);
  });
});

describe('helpers composes with an expansion (Seafarers)', () => {
  it('resolveModules picks up both seafarers + helpers, in order', () => {
    const result = resolveModules(SEAFARERS_CONFIG);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.modules.map((m) => m.id)).toEqual(['seafarers', 'helpers']);
  });

  it('builds a Seafarers game, deals a helper, and fires useHelper end-to-end via reduce (Mayor)', () => {
    const g = createGame(SEAFARERS_CONFIG);
    const dealt = dealNextHelper(ensureHelpersExt(g), 0);
    expect(dealt.helper).not.toBeNull();

    // Force seat 0 to hold Mayor specifically (dealNextHelper's shuffled deal order is an
    // implementation detail this test shouldn't couple to) and flag them dry-roll-eligible, past
    // the turn they "acquired" it.
    const ext = dealt.state.ext!.helpers!;
    const bySeat = ext.bySeat.slice();
    bySeat[0] = { id: 'mayor', side: 'A', acquiredTurn: 1 };
    const mayorEligible = ext.mayorEligible.slice();
    mayorEligible[0] = true;
    const state = {
      ...dealt.state,
      turn: { ...dealt.state.turn, number: 5 },
      phase: { kind: 'main' as const },
      ext: { ...dealt.state.ext, helpers: { ...ext, bySeat, mayorEligible } },
    };

    const res = reduce(state, 0, { type: 'useHelper', helper: 'mayor', resource: 'brick' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const helperUsedEvent = res.events.find((e) => e.type === 'helperUsed');
    expect(helperUsedEvent).toMatchObject({ seat: 0, helper: 'mayor', side: 'A' });
    expect(res.state.players[0]!.resources.brick).toBe(1);
  });
});
