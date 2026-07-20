// T-1160 (FOLLOWUP from T-1051/T-1150): `routes/Game.tsx` used to draw the T&B Rivers overlay from
// the module-level `RIVERS_RIVER_EDGES` constant (always the BASE 19-hex board's river positions),
// regardless of which geometry the actual game resolved to. At 5-6 the real board is the 30-hex
// `GEOMETRY_EXT56`, whose river edges are a DIFFERENT set of ids computed by
// `initialRiversExt`/`geometryForConfig` — so the overlay drew on the wrong edges entirely. Fixed to
// read the per-game `view.ext.tradersBarbarians.riverEdges` (already redacted through, fully public
// board geometry) instead. This suite mounts the real connected `Game` route (singleton store +
// `renderToStaticMarkup`, same convention `endscreen/EndScreen.test.ts` uses for a store-driven
// container) and asserts the rendered `tb-river-*` markers match the VIEW's own riverEdges, at both
// 3-4 (RK-13: unchanged) and 5-6 (the actual bug).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGame, redact, RIVERS_RIVER_EDGES } from '@hexhaven/engine';
import type { GameConfig, GameState, Seat } from '@hexhaven/shared';
import { createRootStore, useStore } from '../store';
import Game from './Game';
import { initGameTestI18n } from './testI18n';

const SEAT0 = 0 as Seat;

function riversConfig(playerCount: 3 | 4 | 5 | 6, fiveSix: boolean): GameConfig {
  return {
    playerCount,
    targetVp: 10,
    seed: `t1160-rivers-${playerCount}`,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix, seafarers: false, citiesKnights: false, tradersBarbarians: { scenario: 'rivers' } },
  };
}

function mainPhaseState(config: GameConfig): GameState {
  const g = createGame(config);
  return { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true } };
}

function resetStore() {
  useStore.setState(createRootStore().getState(), true);
}

function seedGame(state: GameState) {
  const view = redact(state, SEAT0);
  // `resetStore()` swaps in a fresh `createRootStore()` snapshot, whose action methods (e.g.
  // `applyGameStarted`) close over THAT store's own `set`/`get` — calling `useStore.getState().
  // applyGameStarted(...)` after such a reset would silently write to the discarded temp store, not
  // the singleton. Set `game` directly instead (mirrors `endscreen/EndScreen.test.ts`'s `seedEndedGame`).
  useStore.setState({
    game: { view, uiMode: 'idle', shipMoveFrom: null, knightPickFrom: null, hexPieceTarget: null, progressCardStep1: null, events: [], deadlines: [] },
  });
  useStore.setState((s) => ({ lobby: { ...s.lobby, mySeat: SEAT0 } }));
  return view;
}

function render() {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Game)));
}

describe('Game route: T&B Rivers overlay reads the per-game ext geometry (T-1160)', () => {
  beforeAll(async () => {
    await initGameTestI18n();
  });

  beforeEach(() => {
    resetStore();
  });

  it('3-4p (base 19-hex board): river markers match view.ext.tradersBarbarians.riverEdges exactly', () => {
    const state = mainPhaseState(riversConfig(4, false));
    const view = seedGame(state);
    const riverEdges = view.ext!.tradersBarbarians!.riverEdges!;
    expect(riverEdges.length).toBeGreaterThan(0);
    // Unaffected by this fix: at 3-4 the resolved geometry IS the base geometry, so this also
    // happens to equal the old hardcoded constant (RK-13 sanity check).
    expect(riverEdges).toEqual(RIVERS_RIVER_EDGES);

    const html = render();
    for (const edge of riverEdges) {
      expect(html).toContain(`data-testid="tb-river-${edge}"`);
    }
    // No stray river marker outside the view's own set.
    const rendered = [...html.matchAll(/data-testid="tb-river-(\d+)"/g)].map((m) => Number(m[1]));
    expect(rendered.sort((a, b) => a - b)).toEqual([...riverEdges].sort((a, b) => a - b));
  });

  it('5-6p (30-hex EXT56 board): river markers match the EXT56 riverEdges, NOT the base RIVERS_RIVER_EDGES', () => {
    const state = mainPhaseState(riversConfig(5, true));
    const view = seedGame(state);
    const riverEdges = view.ext!.tradersBarbarians!.riverEdges!;
    expect(riverEdges.length).toBeGreaterThan(0);
    // The whole point of the bug: the 5-6 board's river edges are a genuinely different id set than
    // the base board's (different geometry entirely) — if this ever equalled the base constant, the
    // test below would pass vacuously.
    expect(riverEdges).not.toEqual(RIVERS_RIVER_EDGES);

    const html = render();
    for (const edge of riverEdges) {
      expect(html).toContain(`data-testid="tb-river-${edge}"`);
    }
    // The old hardcoded base-board edges must NOT appear (proves the overlay isn't silently drawing
    // the wrong-board positions on top of/instead of the right ones).
    for (const edge of RIVERS_RIVER_EDGES) {
      if (!riverEdges.includes(edge)) expect(html).not.toContain(`data-testid="tb-river-${edge}"`);
    }
    const rendered = [...html.matchAll(/data-testid="tb-river-(\d+)"/g)].map((m) => Number(m[1]));
    expect(rendered.sort((a, b) => a - b)).toEqual([...riverEdges].sort((a, b) => a - b));
  });
});
