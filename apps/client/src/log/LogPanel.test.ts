// Component tests via `renderToStaticMarkup` (no jsdom — see vitest.config.ts's
// `environment: "node"`, same convention as apps/client/src/hud/**'s tests). `GameLog` is
// self-contained (reads the singleton store directly, T-407's brief), so each test seeds the
// singleton via `useStore.setState(...)` and resets it in `beforeEach` — mirroring how
// store/index.test.ts already builds scripted states, just applied directly instead of via
// `applyServerMessage` (this file is testing rendering, not store reduction).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import type { ViewerEvent } from '@hexhaven/engine';
import { createRootStore, useStore } from '../store';
import type { LobbySeatView } from '../store/types';
import { GameLog } from './LogPanel';
import { initTestI18n } from './testI18n';

function resetStore() {
  useStore.setState(createRootStore().getState(), true);
}

function seedGame(events: ViewerEvent[], me: Seat = 0 as Seat) {
  useStore.setState({ game: { view: { me }, uiMode: 'idle', shipMoveFrom: null, knightPickFrom: null, hexPieceTarget: null, progressCardStep1: null, events, deadlines: [] } });
}

function seedLobbySeats(nicknames: (string | null)[]) {
  const { lobby } = useStore.getState();
  useStore.setState({
    lobby: {
      ...lobby,
      seats: nicknames.map(
        (nickname): LobbySeatView | null => (nickname === null ? null : { occupant: 'human', nickname, ready: true }),
      ),
    },
  });
}

describe('GameLog (T-407: self-contained log mount; chat is now its own top-level tab)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  beforeEach(() => {
    resetStore();
  });

  it('renders no in-log tabs — chat moved to the sidebar Chat tab', () => {
    const html = renderToStaticMarkup(createElement(GameLog));
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('data-testid="chat-unread-dot"');
  });

  it('shows the empty-state message when there are no events yet', () => {
    const html = renderToStaticMarkup(createElement(GameLog));
    expect(html).toContain('No events yet.');
  });

  it('renders a localized line for an event, resolving the seat name from the lobby nickname', () => {
    seedLobbySeats(['Ali']);
    seedGame([{ type: 'diceRolled', seat: 0 as Seat, roll: [3, 6] }]);
    const html = renderToStaticMarkup(createElement(GameLog));
    expect(html).toContain('Ali rolled 3 + 6 = 9.');
  });

  it('falls back to "Seat N" when the lobby has no nickname for that seat', () => {
    seedGame([{ type: 'diceRolled', seat: 2 as Seat, roll: [1, 1] }]);
    const html = renderToStaticMarkup(createElement(GameLog));
    expect(html).toContain('Seat 3 rolled 1 + 1 = 2.');
  });

  it('inserts a turn separator right after turnEnded, naming the next seat and turn number', () => {
    seedLobbySeats(['Ali', 'Bea']);
    seedGame([{ type: 'turnEnded', seat: 0 as Seat, next: 1 as Seat }]);
    const html = renderToStaticMarkup(createElement(GameLog));
    expect(html).toContain('Turn 2, Bea');
  });

  it('never shows the "jump to latest" chip while pinned (the default, unscrolled state)', () => {
    seedGame([{ type: 'diceRolled', seat: 0 as Seat, roll: [1, 1] }]);
    const html = renderToStaticMarkup(createElement(GameLog));
    expect(html).not.toContain('data-testid="jump-to-latest"');
  });
});
