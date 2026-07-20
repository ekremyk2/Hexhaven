// T-404: `TradePanel`'s mount interface. `TradePanelView` (presentational) gets the render-matrix
// coverage — trigger visibility, modal-closed-by-default, and the incoming-offer corner card
// appearing/disappearing purely off `view` — mirroring `routes/Game.tsx`'s own container/
// presentational split (`ActionBar.test.ts` tests only the presentational half the same way). The
// connected `TradePanel` itself gets a couple of thin smoke tests directly against the store
// singleton + `setTransport`, exactly like `store/index.test.ts`'s "outbound intents" tests.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGame, redact } from '@hexhaven/engine';
import type { OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { GameConfig, GameState, Seat } from '@hexhaven/shared';
import { useStore } from '../store';
import { setTransport } from '../store/transport';
import { TradePanel, TradePanelView } from './TradePanel';
import { initTradeTestI18n } from './testI18n';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'trade-panel-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;
const NOOP = () => {};
const seatName = (seat: Seat) => `Seat${seat}`;

function craft(turnPlayer: Seat, phase: GameState['phase'], trade: GameState['trade'] = null): GameState {
  const g = createGame(CONFIG);
  return { ...g, phase, turn: { ...g.turn, player: turnPlayer, rolled: true }, trade };
}

/** Seat 0's own full hand, as `redact` produces it — same `as unknown as` cast pattern
 * `ActionBar.test.ts` uses (the redacted view type doesn't distinguish own/other at the type
 * level; `.seat === SEAT0` is what actually guarantees it's the full `OwnPlayerView` shape here). */
function ownSeat0(view: PlayerView): OwnPlayerView {
  return view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
}

describe('TradePanelView', () => {
  beforeAll(async () => {
    await initTradeTestI18n();
  });

  it("renders the trigger button, no open dialog, when it is the viewer's main-phase turn", () => {
    const view = redact(craft(SEAT0, { kind: 'main' }), SEAT0);
    const html = renderToStaticMarkup(
      createElement(TradePanelView, { view, own: ownSeat0(view), mySeat: SEAT0, seatName, dispatch: NOOP })
    );
    expect(html).toContain('data-testid="trade-panel-trigger"');
    expect(html).not.toContain('data-testid="trade-panel-dialog"'); // Modal starts closed
    expect(html).not.toContain('data-testid="incoming-offer"'); // I'm the owner, not a responder
  });

  it('hides the trigger entirely when it is not the viewer\'s turn', () => {
    const view = redact(craft(SEAT1, { kind: 'main' }), SEAT0);
    const html = renderToStaticMarkup(
      createElement(TradePanelView, { view, own: ownSeat0(view), mySeat: SEAT0, seatName, dispatch: NOOP })
    );
    expect(html).not.toContain('data-testid="trade-panel-trigger"');
  });

  it('hides the trigger outside the main phase even on the viewer\'s own turn (preRoll)', () => {
    const view = redact(craft(SEAT0, { kind: 'preRoll' }), SEAT0);
    const html = renderToStaticMarkup(
      createElement(TradePanelView, { view, own: ownSeat0(view), mySeat: SEAT0, seatName, dispatch: NOOP })
    );
    expect(html).not.toContain('data-testid="trade-panel-trigger"');
  });

  it('shows the incoming-offer corner card when another seat has an open offer, hides it once cleared', () => {
    const viewWithOffer = redact(
      craft(SEAT1, { kind: 'main' }, { give: { wool: 1 }, receive: { brick: 1 }, responses: {} }),
      SEAT0
    );
    const htmlWith = renderToStaticMarkup(
      createElement(TradePanelView, { view: viewWithOffer, own: ownSeat0(viewWithOffer), mySeat: SEAT0, seatName, dispatch: NOOP })
    );
    expect(htmlWith).toContain('data-testid="incoming-offer"');

    const viewWithoutOffer = redact(craft(SEAT1, { kind: 'main' }, null), SEAT0);
    const htmlWithout = renderToStaticMarkup(
      createElement(TradePanelView, { view: viewWithoutOffer, own: ownSeat0(viewWithoutOffer), mySeat: SEAT0, seatName, dispatch: NOOP })
    );
    expect(htmlWithout).not.toContain('data-testid="incoming-offer"');
  });
});

describe('TradePanel (connected container)', () => {
  beforeAll(async () => {
    await initTradeTestI18n();
  });

  beforeEach(() => {
    setTransport(null);
    useStore.setState({ game: { view: null, uiMode: 'idle', shipMoveFrom: null, knightPickFrom: null, hexPieceTarget: null, progressCardStep1: null, events: [], deadlines: [] } });
    useStore.setState((s) => ({ lobby: { ...s.lobby, mySeat: null } }));
  });

  it('renders nothing before a game view exists', () => {
    const html = renderToStaticMarkup(createElement(TradePanel));
    expect(html).toBe('');
  });

  it('renders the trigger once a view and mySeat are both present, on the viewer\'s main-phase turn', () => {
    const state = craft(SEAT0, { kind: 'main' });
    const view = redact(state, SEAT0);
    useStore.getState().applyGameStarted(view);
    useStore.setState((s) => ({ lobby: { ...s.lobby, mySeat: SEAT0 } }));

    const html = renderToStaticMarkup(createElement(TradePanel));
    expect(html).toContain('data-testid="trade-panel-trigger"');
  });
});
