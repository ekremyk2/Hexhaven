// Render-layer tests (no jsdom — see `apps/client/src/ui/primitives.test.ts`'s header comment).
// `DevCardsPanelView` (presentational) gets the render-matrix coverage: playability tooltip
// reasons, the VP-card buttonless hint, and the Road Building progress banner — mirroring
// `controls/ActionBar.test.ts`'s split against its own presentational component. The connected
// `DevCardsPanel` gets a couple of thin smoke tests directly against the store singleton, exactly
// like `trade/TradePanel.test.ts`'s "connected container" describe block.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OwnPlayerView } from '@hexhaven/engine';
import { DevCardsPanel, DevCardsPanelView } from './DevCardsPanel';
import { initDevcardsTestI18n } from './testI18n';
import { asView, craft, devCard, SEAT0, SEAT1 } from './testHelpers';
import { useStore } from '../store';
import { setTransport } from '../store/transport';

const NOOP = () => {};

function ownSeat0(view: ReturnType<typeof asView>): OwnPlayerView {
  return view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
}

describe('DevCardsPanelView (task requirements 1-4)', () => {
  beforeAll(async () => {
    await initDevcardsTestI18n();
  });

  it('shows the empty message when the hand has no dev cards', () => {
    const view = asView(craft({ devCards: [] }));
    const html = renderToStaticMarkup(createElement(DevCardsPanelView, { view, own: ownSeat0(view), mySeat: SEAT0, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }));
    expect(html).toContain('data-testid="devcards-empty"');
  });

  it('Victory Point cards render the "counts toward your 10" hint with NO play button (R9.8)', () => {
    const view = asView(craft({ devCards: [devCard('victoryPoint', 1)] }));
    const html = renderToStaticMarkup(createElement(DevCardsPanelView, { view, own: ownSeat0(view), mySeat: SEAT0, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }));
    expect(html).toContain('data-testid="devcard-vp-hint"');
    expect(html).not.toContain('data-testid="devcard-play-victoryPoint"');
  });

  it('a playable Knight enables its Play button in preRoll (R4.1)', () => {
    const state = craft(
      { devCards: [devCard('knight', 1)] },
      { phase: { kind: 'preRoll' }, turn: { number: 5, player: SEAT0, rolled: false, roll: null, devPlayed: false } },
    );
    const view = asView(state);
    const html = renderToStaticMarkup(createElement(DevCardsPanelView, { view, own: ownSeat0(view), mySeat: SEAT0, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }));
    const match = html.match(/data-testid="devcard-play-knight"([^>]*)>/);
    expect(match?.[1]).not.toContain('disabled=""');
  });

  it('shows the "Already played a card this turn" tooltip reason when turn.devPlayed is true', () => {
    const state = craft(
      { devCards: [devCard('knight', 1)] },
      { turn: { number: 5, player: SEAT0, rolled: true, roll: [3, 4], devPlayed: true } },
    );
    const view = asView(state);
    const html = renderToStaticMarkup(createElement(DevCardsPanelView, { view, own: ownSeat0(view), mySeat: SEAT0, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }));
    // The reason TEXT now lives in a hover-only portal tooltip (Tooltip.tsx) — not in static markup;
    // the reason itself is covered by devCardLogic.test's `computeDevPlayState`. Here: button disabled.
    const match = html.match(/data-testid="devcard-play-knight"([^>]*)>/);
    expect(match?.[1]).toContain('disabled=""');
  });

  it('disables a card when it is not the viewer\'s turn (reason via tooltip)', () => {
    const state = craft(
      { devCards: [devCard('knight', 1)] },
      { turn: { number: 5, player: SEAT1, rolled: true, roll: [3, 4], devPlayed: false } },
    );
    const view = asView(state);
    const html = renderToStaticMarkup(createElement(DevCardsPanelView, { view, own: ownSeat0(view), mySeat: SEAT0, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }));
    const match = html.match(/data-testid="devcard-play-knight"([^>]*)>/);
    expect(match?.[1]).toContain('disabled=""');
  });

  it('groups multiple copies of the same type with a ×N count badge', () => {
    const view = asView(craft({ devCards: [devCard('knight', 1), devCard('knight', 1)] }));
    const html = renderToStaticMarkup(createElement(DevCardsPanelView, { view, own: ownSeat0(view), mySeat: SEAT0, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }));
    expect(html).toContain('data-testid="devcard-count-knight"');
    expect(html).toContain('×2');
  });

  it('the Road Building banner reflects phase.remaining for the mover', () => {
    const state = craft(
      { devCards: [] },
      { phase: { kind: 'roadBuilding', remaining: 2 }, turn: { number: 5, player: SEAT0, rolled: true, roll: null, devPlayed: true } },
    );
    const view = asView(state);
    const html = renderToStaticMarkup(createElement(DevCardsPanelView, { view, own: ownSeat0(view), mySeat: SEAT0, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }));
    expect(html).toContain('data-testid="road-building-banner"');
    expect(html).toContain('2');
  });

  it('no Road Building banner outside the roadBuilding phase', () => {
    const view = asView(craft());
    const html = renderToStaticMarkup(createElement(DevCardsPanelView, { view, own: ownSeat0(view), mySeat: SEAT0, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }));
    expect(html).not.toContain('data-testid="road-building-banner"');
  });
});

describe('DevCardsPanel (connected container)', () => {
  beforeAll(async () => {
    await initDevcardsTestI18n();
  });

  beforeEach(() => {
    setTransport(null);
    useStore.setState({ game: { view: null, uiMode: 'idle', shipMoveFrom: null, knightPickFrom: null, hexPieceTarget: null, progressCardStep1: null, events: [], deadlines: [] } });
    useStore.setState((s) => ({ lobby: { ...s.lobby, mySeat: null } }));
  });

  it('renders nothing before a game view exists', () => {
    const html = renderToStaticMarkup(createElement(DevCardsPanel));
    expect(html).toBe('');
  });

  it('renders the panel once a view and mySeat are both present', () => {
    const state = craft({ devCards: [devCard('knight', 1)] });
    const view = asView(state);
    useStore.getState().applyGameStarted(view);
    useStore.setState((s) => ({ lobby: { ...s.lobby, mySeat: SEAT0 } }));

    const html = renderToStaticMarkup(createElement(DevCardsPanel));
    expect(html).toContain('data-testid="devcards-panel"');
  });
});
