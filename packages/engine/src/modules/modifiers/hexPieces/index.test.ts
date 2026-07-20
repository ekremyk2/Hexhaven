// Multi-piece hex framework end-to-end tests (T-902, docs/07 D-034): pieces placed at start,
// move-any (robber OR a hex piece, exactly one per 7/Knight), the `moveHexPiece` error codes,
// composition with Cities & Knights' robber-lock (C10.1), and composition with an expansion
// (fiveSix). RK-13 (modifier off / base-identical) is covered by the shared oracle
// (rk13-regression.test.ts) + the sim suites, which never enable this modifier.

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type { GameConfig, GameState, HexId } from '@hexhaven/shared';
import { createGame } from '../../../createGame.js';
import { reduce } from '../../../reduce.js';
import { validateHexPiecesConfig } from './index.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'hexpieces-index-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

interface Craft {
  robber?: number;
  citiesKnights?: boolean;
  fiveSix?: boolean;
}

/** A controlled `moveRobber`-phase state, hexPieces enabled with just the Wizard. */
function craft(opts: Craft = {}): GameState {
  const g = createGame({
    ...CONFIG,
    expansions: {
      fiveSix: opts.fiveSix ?? false,
      seafarers: false,
      citiesKnights: opts.citiesKnights ?? false,
    },
    modifiers: { hexPieces: { pieces: ['wizard'] } },
  });
  return {
    ...g,
    board: { ...g.board, robber: (opts.robber ?? g.board.robber) as HexId },
    turn: { ...g.turn, rolled: true, roll: [3, 4] },
    phase: { kind: 'moveRobber', returnTo: 'main' },
  };
}

describe('placement at start (docs/tasks/phase-9/PICKS.md)', () => {
  it('lazily places the Wizard on the robber hex the first time any action runs', () => {
    const g = createGame({ ...CONFIG, modifiers: { hexPieces: { pieces: ['wizard'] } } });
    expect(g.ext?.hexPieces).toBeUndefined(); // not yet — the lazy-init substitute (docs/10 §3)
    const state: GameState = { ...g, phase: { kind: 'main' }, turn: { ...g.turn, rolled: true, roll: [3, 4] } };
    const res = reduce(state, state.turn.player, { type: 'endTurn' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext?.hexPieces).toEqual({ pieces: [{ kind: 'wizard', hex: g.board.robber }] });
  });

  it('WITHOUT the modifier, ext.hexPieces never appears (RK-13 baseline)', () => {
    const g = createGame({ ...CONFIG });
    const state: GameState = { ...g, phase: { kind: 'main' }, turn: { ...g.turn, rolled: true, roll: [3, 4] } };
    const res = reduce(state, state.turn.player, { type: 'endTurn' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.state.ext?.hexPieces).toBeUndefined();
  });
});

describe('move-any: robber OR a hex piece, exactly one per 7/Knight', () => {
  it('moveHexPiece relocates the Wizard and returns the phase to main, exactly like moveRobber', () => {
    const state = craft({ robber: 0 });
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'wizard', hex: 1 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toEqual({ kind: 'main' });
    // The base robber is UNTOUCHED — only the Wizard moved.
    expect(res.state.board.robber).toBe(0);
    // T-903: every move now stamps the mover as the piece's `owner` (generic framework field, only
    // read by the Banker) — `state.turn.player` is seat 0 in this fixture.
    expect(res.state.ext?.hexPieces?.pieces).toEqual([{ kind: 'wizard', hex: 1, owner: 0 }]);
    expect(res.events.some((e) => e.type === 'hexPieceMoved')).toBe(true);
  });

  it('after moving the Wizard, the base moveRobber action is no longer legal (one move per trigger)', () => {
    const state = craft({ robber: 0 });
    const first = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'wizard', hex: 1 as HexId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = reduce(first.state, first.state.turn.player, { type: 'moveRobber', hex: 2 as HexId });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('WRONG_PHASE');
  });

  it('the base moveRobber action still works unmodified (additive, RK-13-safe) — then moveHexPiece is no longer legal', () => {
    const state = craft({ robber: 0 });
    const first = reduce(state, state.turn.player, { type: 'moveRobber', hex: 1 as HexId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.board.robber).toBe(1);
    expect(first.state.phase).toEqual({ kind: 'main' });
    const second = reduce(first.state, first.state.turn.player, {
      type: 'moveHexPiece',
      piece: 'wizard',
      hex: 2 as HexId,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('WRONG_PHASE');
  });

  it('rejects moving to the piece\'s own current hex (HEX_PIECE_SAME_HEX)', () => {
    const state = craft({ robber: 0 });
    // Lazily place the Wizard first via a no-op-ish action isn't needed here: craft's `phase` is
    // already `moveRobber`, so the module's afterAction hasn't run yet — force placement directly.
    const withExt: GameState = { ...state, ext: { ...state.ext, hexPieces: { pieces: [{ kind: 'wizard', hex: 5 as HexId }] } } };
    const res = reduce(withExt, withExt.turn.player, { type: 'moveHexPiece', piece: 'wizard', hex: 5 as HexId });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('HEX_PIECE_SAME_HEX');
  });

  it('rejects an inactive piece kind (HEX_PIECE_NOT_FOUND) — defensive: unreachable via a valid config today (the sole kind is always the one enabled), but the module must not silently move a piece that was never placed', () => {
    const state = craft({ robber: 0 });
    // Hand-craft `ext.hexPieces` with the Wizard NOT among its pieces — simulates the (currently
    // unreachable via `validateHexPiecesConfig`) "enabled modifier, but this kind isn't active" case,
    // the same way `friendlyRobber.test.ts` hand-crafts an otherwise-unreachable locked `moveRobber`
    // phase to exercise its own defensive C&K check.
    const withEmptyExt: GameState = { ...state, ext: { ...state.ext, hexPieces: { pieces: [] } } };
    const res = reduce(withEmptyExt, withEmptyExt.turn.player, {
      type: 'moveHexPiece',
      piece: 'wizard',
      hex: 1 as HexId,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('HEX_PIECE_NOT_FOUND');
  });

  it('rejects moveHexPiece outside the moveRobber sub-phase (WRONG_PHASE)', () => {
    const g = createGame({ ...CONFIG, modifiers: { hexPieces: { pieces: ['wizard'] } } });
    const state: GameState = { ...g, phase: { kind: 'main' } };
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'wizard', hex: 1 as HexId });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('WRONG_PHASE');
  });

  it('rejects an off-board hex (BAD_LOCATION)', () => {
    const state = craft({ robber: 0 });
    const offBoard = GEOMETRY.hexes.length + 5;
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'wizard', hex: offBoard as HexId });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('BAD_LOCATION');
  });
});

describe('composes with Cities & Knights (C10.1 robber-lock)', () => {
  it('moveHexPiece is ROBBER_LOCKED while locked — same defensive gate the base robber uses', () => {
    const state = craft({ citiesKnights: true });
    expect(state.ext!.citiesKnights!.robberLocked).toBe(true);
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'wizard', hex: 1 as HexId });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('ROBBER_LOCKED');
  });
});

describe('composes with an expansion (fiveSix)', () => {
  it('moveHexPiece works on the 30-hex fiveSix board exactly like the base board', () => {
    const state = craft({ fiveSix: true, robber: 0 });
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'wizard', hex: 1 as HexId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // T-903: `owner` is stamped to the mover on every move (see the first `describe` block's note).
    expect(res.state.ext?.hexPieces?.pieces).toEqual([{ kind: 'wizard', hex: 1, owner: state.turn.player }]);
  });
});

describe('composes with an expansion (Seafarers) — the pirate is untouched', () => {
  it('moveHexPiece coexists with the Seafarers pirate: moving the Wizard leaves the pirate exactly where it was', () => {
    const g = createGame({
      ...CONFIG,
      expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
      modifiers: { hexPieces: { pieces: ['wizard'] } },
    });
    const pirateBefore = g.ext!.seafarers!.pirate;
    const state: GameState = {
      ...g,
      turn: { ...g.turn, rolled: true, roll: [3, 4] },
      phase: { kind: 'moveRobber', returnTo: 'main' },
    };
    const targetHex = (state.board.robber === 0 ? 1 : 0) as HexId;
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: 'wizard', hex: targetHex });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // T-903: `owner` is stamped to the mover on every move (see the first `describe` block's note).
    expect(res.state.ext?.hexPieces?.pieces).toEqual([
      { kind: 'wizard', hex: targetHex, owner: state.turn.player },
    ]);
    // The base robber and the Seafarers pirate are BOTH untouched by this move.
    expect(res.state.board.robber).toBe(state.board.robber);
    expect(res.state.ext!.seafarers!.pirate).toBe(pirateBefore);
  });
});

describe('validateHexPiecesConfig', () => {
  it('rejects an empty pieces array', () => {
    expect(validateHexPiecesConfig({ pieces: [] })?.code).toBe('MODIFIER_INVALID_CONFIG');
  });

  it('rejects a repeated kind', () => {
    expect(validateHexPiecesConfig({ pieces: ['wizard', 'wizard'] })?.code).toBe('MODIFIER_INVALID_CONFIG');
  });

  it('accepts a valid non-empty, de-duplicated selection', () => {
    expect(validateHexPiecesConfig({ pieces: ['wizard'] })).toBeNull();
  });

  it('accepts all five kinds together (every piece standalone-selectable AND coexisting)', () => {
    expect(
      validateHexPiecesConfig({ pieces: ['wizard', 'trader', 'robinHood', 'banker', 'poaching'] })
    ).toBeNull();
  });
});

// T-903: every kind is independently selectable (docs/tasks/phase-9/PICKS.md "each piece must be
// usable STANDALONE"), and any subset may coexist with move-any picking among them.
describe('T-903: standalone kinds + coexisting move-any', () => {
  const ALL_KINDS = ['wizard', 'trader', 'robinHood', 'banker', 'poaching'] as const;

  it.each(ALL_KINDS)('%s works standalone (the only enabled kind)', (kind) => {
    const g = createGame({ ...CONFIG, modifiers: { hexPieces: { pieces: [kind] } } });
    const state: GameState = {
      ...g,
      turn: { ...g.turn, rolled: true, roll: [3, 4] },
      phase: { kind: 'moveRobber', returnTo: 'main' },
    };
    const targetHex = (state.board.robber === 0 ? 1 : 0) as HexId;
    const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: kind, hex: targetHex });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext?.hexPieces?.pieces.map((p) => p.kind)).toEqual([kind]);
  });

  it('all five kinds placed together at start, each independently movable', () => {
    const g = createGame({ ...CONFIG, modifiers: { hexPieces: { pieces: [...ALL_KINDS] } } });
    const state: GameState = {
      ...g,
      turn: { ...g.turn, rolled: true, roll: [3, 4] },
      phase: { kind: 'moveRobber', returnTo: 'main' },
    };
    const ensured = reduce(
      { ...state, phase: { kind: 'main' } },
      state.turn.player,
      { type: 'endTurn' }
    );
    expect(ensured.ok).toBe(true);
    if (!ensured.ok) return;
    expect(ensured.state.ext?.hexPieces?.pieces.map((p) => p.kind).sort()).toEqual([...ALL_KINDS].sort());

    // Move-any: pick the Banker specifically among the 5 coexisting pieces.
    const bankerBefore = ensured.state.ext!.hexPieces!.pieces.find((p) => p.kind === 'banker')!;
    const targetHex = (bankerBefore.hex === 0 ? 1 : 0) as HexId;
    const moved = reduce(
      { ...ensured.state, phase: { kind: 'moveRobber', returnTo: 'main' } },
      ensured.state.turn.player,
      { type: 'moveHexPiece', piece: 'banker', hex: targetHex }
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    // Only the Banker moved — every other piece (and the base robber) stayed exactly where it was.
    for (const other of ['wizard', 'trader', 'robinHood', 'poaching'] as const) {
      const before = ensured.state.ext!.hexPieces!.pieces.find((p) => p.kind === other)!;
      const after = moved.state.ext!.hexPieces!.pieces.find((p) => p.kind === other)!;
      expect(after.hex).toBe(before.hex);
    }
    expect(moved.state.board.robber).toBe(ensured.state.board.robber);
    expect(moved.state.ext!.hexPieces!.pieces.find((p) => p.kind === 'banker')!.hex).toBe(targetHex);
  });

  it('C&K robber-lock (C10.1) blocks move-any for every kind, not just the Wizard', () => {
    const state = craft({ citiesKnights: true });
    for (const kind of ALL_KINDS) {
      const res = reduce(state, state.turn.player, { type: 'moveHexPiece', piece: kind, hex: 1 as HexId });
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.error.code).toBe('ROBBER_LOCKED');
    }
  });
});
