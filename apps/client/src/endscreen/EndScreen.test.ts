// Component tests via `renderToStaticMarkup` (no jsdom — see vitest.config.ts's
// `environment: "node"`, same convention as apps/client/src/log/LogPanel.test.ts). `EndScreen` is
// self-contained (reads the singleton store directly), so each test seeds the singleton via
// `useStore.setState(...)` and resets it in `beforeEach`. `useNavigate()` needs a Router ancestor
// even under a static render, so every render is wrapped in a `MemoryRouter`.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { events as ev, redact } from '@hexhaven/engine';
import type { ViewerEvent } from '@hexhaven/engine';
import type { GameState, Seat, VertexId } from '@hexhaven/shared';
import { createRootStore, useStore } from '../store';
import type { LobbySeatView } from '../store/types';
import { EndScreen } from './EndScreen';
import { baseState } from './testFixtures';
import { initTestI18n } from './testI18n';

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;

function resetStore() {
  useStore.setState(createRootStore().getState(), true);
}

function endedState(winner: Seat): GameState {
  const g = baseState();
  const players = g.players.map((p) =>
    p.seat === winner
      ? { ...p, settlements: [1, 2] as VertexId[], devCards: [{ type: 'victoryPoint' as const, boughtOnTurn: 3 }] }
      : p,
  );
  return {
    ...g,
    players,
    awards: { longestRoad: { holder: null, length: 0 }, largestArmy: { holder: null, count: 0 } },
    phase: { kind: 'ended', winner },
  };
}

function seedEndedGame(me: Seat, winner: Seat, events: ViewerEvent[] = []) {
  const view = redact(endedState(winner), me);
  useStore.setState({ game: { view, uiMode: 'idle', shipMoveFrom: null, knightPickFrom: null, hexPieceTarget: null, progressCardStep1: null, events, deadlines: [] } });
}

function seedLobbySeats(nicknames: (string | null)[], gameId: string | null = null) {
  const { lobby } = useStore.getState();
  useStore.setState({
    lobby: {
      ...lobby,
      gameId,
      seats: nicknames.map(
        (nickname): LobbySeatView | null => (nickname === null ? null : { occupant: 'human', nickname, ready: true }),
      ),
    },
  });
}

function render() {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(EndScreen)));
}

describe('EndScreen (T-408: victory overlay + rematch, self-contained mount)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  beforeEach(() => {
    resetStore();
  });

  it('renders nothing before a game has started', () => {
    expect(render()).toBe('');
  });

  it('renders nothing mid-game (phase not ended)', () => {
    const view = redact(baseState(), SEAT0);
    useStore.setState({ game: { view, uiMode: 'idle', shipMoveFrom: null, knightPickFrom: null, hexPieceTarget: null, progressCardStep1: null, events: [], deadlines: [] } });
    expect(render()).toBe('');
  });

  it('shows a personalized banner for the winner viewing their own screen', () => {
    seedEndedGame(SEAT1, SEAT1);
    expect(render()).toContain('You won!');
  });

  it("shows the winner's name in the banner for a losing viewer", () => {
    seedLobbySeats(['Ali', 'Bea']);
    seedEndedGame(SEAT0, SEAT1);
    expect(render()).toContain('Bea wins!');
  });

  it("reveals the winner's hidden VP cards via the gameWon event for a non-winning viewer", () => {
    const breakdown = { settlements: 2, cities: 0, longestRoad: 0, largestArmy: 0, vpCards: 1, total: 3 };
    seedEndedGame(SEAT0, SEAT1, [ev.gameWon(SEAT1, breakdown)]);
    const html = render();
    expect(html).toContain('+1 🔒 revealed!');
  });

  it('renders the standings table and both action buttons', () => {
    seedEndedGame(SEAT0, SEAT1);
    const html = render();
    expect(html).toContain('data-testid="standings-table"');
    expect(html).toContain('data-testid="endscreen-rematch"');
    expect(html).toContain('data-testid="endscreen-back-home"');
  });

  it('renders decorative confetti marked aria-hidden (never announced by a screen reader)', () => {
    seedEndedGame(SEAT0, SEAT1);
    const html = render();
    const marker = html.indexOf('data-testid="endscreen-confetti"');
    expect(marker).toBeGreaterThan(-1);
    expect(html.slice(Math.max(0, marker - 40), marker + 40)).toContain('aria-hidden="true"');
  });
});
