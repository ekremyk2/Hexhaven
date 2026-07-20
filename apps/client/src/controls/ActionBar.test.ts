// T-403 requirement 6 tests, at the render layer (this workspace's vitest runs under the `node`
// environment — no jsdom/@testing-library, see apps/client/src/ui/primitives.test.ts's header
// comment — so click simulation isn't available here; `actionBarLogic.test.ts` covers the pure
// enablement/mode-toggle/auto-setup-mode logic a real click or the setup-entry effect would drive.
// This file asserts on the static markup `ActionBar` (a purely presentational component — no store
// access of its own) produces from crafted props: which buttons exist/are disabled, which tooltip
// reason text renders, and the non-owner/setup collapses. A live click-through (does the button
// actually call `dispatch`) is a PM dev-server check, same as T-304's own precedent.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame } from '@hexhaven/engine';
import type { OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { GameConfig, GameState, Seat, VertexId } from '@hexhaven/shared';
import { initTestI18n } from '../hud/testI18n';
import { ActionBar } from './ActionBar';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'action-bar-render-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;

function asView(state: GameState): PlayerView {
  return { ...state, me: SEAT0, devDeckCount: state.devDeck.length } as unknown as PlayerView;
}

function craftMainState(overrides: Partial<GameState['players'][number]> = {}): GameState {
  const g = createGame(CONFIG);
  const players = g.players.map((p) =>
    p.seat === SEAT0
      ? { ...p, settlements: [8 as VertexId], resources: { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 }, ...overrides }
      : p,
  );
  return { ...g, players, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true } };
}

const NOOP = () => {};

/** Attribute string between a `data-testid="X"` marker and the tag's closing `>` — used to check
 * `disabled`/`class` on a specific button without depending on prop-emission order elsewhere. */
function attrsFor(html: string, testid: string): string {
  const match = html.match(new RegExp(`data-testid="${testid}"([^>]*)>`));
  if (!match) throw new Error(`BUG: no element with data-testid="${testid}" in:\n${html}`);
  return match[1]!;
}

/** `Button`'s `disabled` prop renders the real boolean HTML attribute `disabled=""` when true and
 * omits it when false — distinct from the ALWAYS-rendered `aria-disabled="true"|"false"` (a plain
 * string attribute), which a loose `.includes('disabled')` check would false-positive on. */
function isDisabled(html: string, testid: string): boolean {
  return attrsFor(html, testid).includes('disabled=""');
}

/** The plain text content of a `data-testid="X"` button — used to check the rendered LABEL
 *  (e.g. a themed build-button name) rather than just its attributes. */
function buttonText(html: string, testid: string): string {
  const start = html.indexOf(`data-testid="${testid}"`);
  if (start === -1) throw new Error(`BUG: no element with data-testid="${testid}" in:\n${html}`);
  const openEnd = html.indexOf('>', start) + 1;
  const closeStart = html.indexOf('</button>', openEnd);
  return html.slice(openEnd, closeStart);
}

describe('ActionBar: non-owner collapse (requirement 4 — no dead buttons)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders only the phase-text line when the viewer is not the turn owner', () => {
    const base = craftMainState();
    const view = asView({ ...base, phase: { kind: 'preRoll' }, turn: { ...base.turn, player: SEAT1, rolled: false } });
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view,
        own,
        mySeat: SEAT0,
        turnPlayerName: 'Bob',
        uiMode: 'idle',
        deadlines: [],
        dispatch: NOOP,
        setMode: NOOP,
      }),
    );
    expect(html).toContain('Waiting for Bob to roll');
    expect(html).not.toContain('<button');
  });
});

describe('ActionBar: setup guidance (requirement 5 — no buttons, guidance text only)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('shows "place your settlement" guidance with no buttons when it is the acting seat\'s setup turn', () => {
    const g = createGame(CONFIG); // fresh game: phase is setup/round1/expect settlement, turn.player 0
    const view = asView(g);
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view,
        own,
        mySeat: SEAT0,
        turnPlayerName: 'Alice',
        uiMode: 'idle',
        deadlines: [],
        dispatch: NOOP,
        setMode: NOOP,
      }),
    );
    expect(html).toContain('Place your settlement.');
    expect(html).not.toContain('<button');
  });
});

describe('ActionBar: main-phase enablement matrix (requirement 1/6)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('roll disabled after rolling; build/end-turn reflect crafted legality', () => {
    const g = craftMainState();
    const view = asView(g);
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view,
        own,
        mySeat: SEAT0,
        turnPlayerName: 'Alice',
        uiMode: 'idle',
        deadlines: [],
        dispatch: NOOP,
        setMode: NOOP,
      }),
    );
    expect(isDisabled(html, 'action-roll')).toBe(true); // already rolled (ER-7)
    expect(isDisabled(html, 'action-build-road')).toBe(false); // affordable + legal
    expect(isDisabled(html, 'action-end-turn')).toBe(false); // main phase
    expect(isDisabled(html, 'action-buy-dev')).toBe(false);
    // Trade is now the real <TradePanel/> (T-404), self-connected to the store — no longer a
    // disabled placeholder in the ActionBar's own markup.
  });

  it('an unaffordable build shows the "Need X Y" tooltip reason', () => {
    const g = craftMainState({ resources: { brick: 0, lumber: 0, wool: 5, grain: 5, ore: 5 } });
    const view = asView(g);
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view,
        own,
        mySeat: SEAT0,
        turnPlayerName: 'Alice',
        uiMode: 'idle',
        deadlines: [],
        dispatch: NOOP,
        setMode: NOOP,
      }),
    );
    // The reason TEXT now lives in a hover-only portal tooltip (Tooltip.tsx), so it isn't in the
    // static markup — the exact copy is covered by actionBarLogic.test's `cantAfford` cases. Here we
    // only assert the button is correctly disabled.
    expect(isDisabled(html, 'action-build-road')).toBe(true);
  });

  it('out-of-pieces disables the build (reason via tooltip)', () => {
    const g = craftMainState({ piecesLeft: { roads: 15, settlements: 5, cities: 0 } });
    const view = asView(g);
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view,
        own,
        mySeat: SEAT0,
        turnPlayerName: 'Alice',
        uiMode: 'idle',
        deadlines: [],
        dispatch: NOOP,
        setMode: NOOP,
      }),
    );
    expect(isDisabled(html, 'action-build-city')).toBe(true); // reason 'maxCities' covered by actionBarLogic.test
  });

  it('the active build mode renders its button with the "primary" (active) styling', () => {
    const view = asView(craftMainState());
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view,
        own,
        mySeat: SEAT0,
        turnPlayerName: 'Alice',
        uiMode: 'placingRoad',
        deadlines: [],
        dispatch: NOOP,
        setMode: NOOP,
      }),
    );
    expect(attrsFor(html, 'action-build-road')).toContain('bg-accent');
    expect(attrsFor(html, 'action-build-settlement')).not.toContain('bg-accent');
  });

  it('the classic theme (default/omitted themeId) keeps the base build-button copy', () => {
    const view = asView(craftMainState());
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view,
        own,
        mySeat: SEAT0,
        turnPlayerName: 'Alice',
        uiMode: 'idle',
        deadlines: [],
        dispatch: NOOP,
        setMode: NOOP,
      }),
    );
    expect(buttonText(html, 'action-build-road')).toBe('Road');
    expect(buttonText(html, 'action-build-settlement')).toBe('Settlement');
  });

  it('a non-classic theme (T-907 PM wiring) reskins the build-button labels via the themes namespace', () => {
    const view = asView(craftMainState());
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view,
        own,
        mySeat: SEAT0,
        turnPlayerName: 'Alice',
        uiMode: 'idle',
        deadlines: [],
        dispatch: NOOP,
        setMode: NOOP,
        themeId: 'pirates',
      }),
    );
    expect(buttonText(html, 'action-build-road')).toBe('Trail'); // pirates' road label
    expect(buttonText(html, 'action-build-settlement')).toBe('Outpost'); // pirates' settlement label
  });

  it('an open trade offer (the viewer\'s own, per R8.1) renders the end-turn cancellation warning', () => {
    const g = { ...craftMainState(), trade: { give: { brick: 1 }, receive: { ore: 1 }, responses: {} } };
    const view = asView(g);
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view,
        own,
        mySeat: SEAT0,
        turnPlayerName: 'Alice',
        uiMode: 'idle',
        deadlines: [],
        dispatch: NOOP,
        setMode: NOOP,
      }),
    );
    expect(html).toContain('cancel your open trade offer');
  });

  it('renders the countdown only when a deadline exists for the viewer\'s seat', () => {
    const view = asView(craftMainState());
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const withDeadline = renderToStaticMarkup(
      createElement(ActionBar, {
        view,
        own,
        mySeat: SEAT0,
        turnPlayerName: 'Alice',
        uiMode: 'idle',
        deadlines: [{ seat: SEAT0, deadline: Date.now() + 30_000 }],
        dispatch: NOOP,
        setMode: NOOP,
      }),
    );
    expect(withDeadline).toContain('data-testid="countdown"');

    const withoutDeadline = renderToStaticMarkup(
      createElement(ActionBar, {
        view,
        own,
        mySeat: SEAT0,
        turnPlayerName: 'Alice',
        uiMode: 'idle',
        deadlines: [],
        dispatch: NOOP,
        setMode: NOOP,
      }),
    );
    expect(withoutDeadline).not.toContain('data-testid="countdown"');
  });
});

// ---- T-603: 5–6 extension turn-rule UIs (X12) -----------------------------------------------------
describe('ActionBar: Special Building Phase (X12, 2015)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  const NAME = (s: Seat) => `P${s}`;

  function sbpView(builder: Seat, queue: Seat[]): PlayerView {
    // During SBP `turn.player` is the seat whose turn just ended (SEAT1 here), NOT the builder.
    const base = craftMainState();
    return asView({ ...base, phase: { kind: 'specialBuild', builder, queue }, turn: { ...base.turn, player: SEAT1 } });
  }

  it('shows the builder bar with build buttons and a prominent Pass, but no Roll, when the viewer is the builder', () => {
    const view = sbpView(SEAT0, [SEAT1]);
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view, own, mySeat: SEAT0, turnPlayerName: 'P1', seatName: NAME,
        uiMode: 'idle', deadlines: [], dispatch: NOOP, setMode: NOOP,
      }),
    );
    expect(html).toContain('data-testid="action-bar-sbp-builder"');
    expect(html).toContain('data-testid="action-pass-special-build"');
    expect(html).toContain('data-testid="action-build-road"');
    expect(html).not.toContain('data-testid="action-roll"');
  });

  it('shows the waiting banner + queue dots when the viewer is NOT the builder', () => {
    const view = sbpView(SEAT1, [SEAT0]);
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view, own, mySeat: SEAT0, turnPlayerName: 'P1', seatName: NAME,
        uiMode: 'idle', deadlines: [], dispatch: NOOP, setMode: NOOP,
      }),
    );
    expect(html).toContain('data-testid="action-bar-sbp-waiting"');
    expect(html).toContain('data-testid="turn-rule-seat-dots"');
    expect(html).toContain('Special building — P1 is building');
    expect(html).not.toContain('data-testid="action-pass-special-build"');
  });
});

describe('ActionBar: Paired Players partial turn (X12, 2022)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  const NAME = (s: Seat) => `P${s}`;

  function pairedView(builder: Seat, turnPlayer: Seat): PlayerView {
    const base = craftMainState();
    return asView({
      ...base,
      phase: { kind: 'main' },
      turn: { ...base.turn, player: turnPlayer, rolled: true },
      ext: { fiveSix: { partialTurn: { builder, resumeFrom: SEAT0 } } },
    });
  }

  it('shows the paired-turn indicator, no roll, and an "End paired turn" button for the builder', () => {
    const view = pairedView(SEAT0, SEAT0);
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view, own, mySeat: SEAT0, turnPlayerName: 'P0', seatName: NAME,
        uiMode: 'idle', deadlines: [], dispatch: NOOP, setMode: NOOP,
      }),
    );
    expect(html).toContain('data-testid="paired-turn-indicator"');
    expect(html).toContain('Paired turn (player 2)');
    expect(html).not.toContain('data-testid="action-roll"'); // no roll on a partial turn
    expect(html).toContain('data-testid="action-build-road"');
    expect(html).toContain('End paired turn');
  });

  it('shows a paired-waiting note for a bystander during someone else\'s partial turn', () => {
    const view = pairedView(SEAT1, SEAT1);
    const own = view.players.find((p) => p.seat === SEAT0) as unknown as OwnPlayerView;
    const html = renderToStaticMarkup(
      createElement(ActionBar, {
        view, own, mySeat: SEAT0, turnPlayerName: 'P1', seatName: NAME,
        uiMode: 'idle', deadlines: [], dispatch: NOOP, setMode: NOOP,
      }),
    );
    expect(html).toContain('data-testid="action-bar-paired-waiting"');
    expect(html).toContain('Paired turn — P1 is building');
    expect(html).not.toContain('data-testid="action-build-road"');
  });
});
