import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import { DicePanel } from './DicePanel';
import { initTestI18n } from './testI18n';

describe('DicePanel (T-402 requirement 3: dice faces, turn number, phase line)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders the last roll as two dice faces and the turn number', () => {
    const html = renderToStaticMarkup(
      createElement(DicePanel, {
        turn: { number: 5, player: 0 as Seat, rolled: true, roll: [3, 4], devPlayed: false },
        phase: { kind: 'main' },
        turnPlayerName: 'Alice',
        isViewerTurn: true,
      }),
    );
    // Priority 3 UI overhaul: real pip-face dice, not printed digits — `die-face-N` testid carries
    // the rolled value (docs/12: update render-assertion tests when the markup they check changes).
    expect(html).toContain('die-face-3');
    expect(html).toContain('die-face-4');
    expect(html).toContain('Turn 5');
    expect(html).toContain('Alice');
  });

  it('renders a placeholder face before any roll this turn', () => {
    const html = renderToStaticMarkup(
      createElement(DicePanel, {
        turn: { number: 1, player: 0 as Seat, rolled: false, roll: null, devPlayed: false },
        phase: { kind: 'preRoll' },
        turnPlayerName: 'Alice',
        isViewerTurn: false,
      }),
    );
    expect(html).toContain('die-face-blank');
  });

  it('suppresses the "waiting for X" line when it is the viewer\'s own turn', () => {
    const html = renderToStaticMarkup(
      createElement(DicePanel, {
        turn: { number: 1, player: 0 as Seat, rolled: false, roll: null, devPlayed: false },
        phase: { kind: 'preRoll' },
        turnPlayerName: 'Alice',
        isViewerTurn: true,
      }),
    );
    expect(html).not.toContain('roll');
  });

  it('shows the phase-appropriate waiting line for non-actors', () => {
    const html = renderToStaticMarkup(
      createElement(DicePanel, {
        turn: { number: 1, player: 0 as Seat, rolled: false, roll: null, devPlayed: false },
        phase: { kind: 'preRoll' },
        turnPlayerName: 'Alice',
        isViewerTurn: false,
      }),
    );
    expect(html).toContain('Waiting for Alice to roll');
  });
});

describe('DicePanel Event Cards mode (T-904b: card face in place of two dice)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('shows the drawn total as a single card face, not two dice faces, when eventCardsOn', () => {
    const html = renderToStaticMarkup(
      createElement(DicePanel, {
        turn: { number: 5, player: 0 as Seat, rolled: true, roll: [4, 3], devPlayed: false },
        phase: { kind: 'main' },
        turnPlayerName: 'Alice',
        isViewerTurn: true,
        eventCardsOn: true,
      }),
    );
    expect(html).toContain('data-testid="event-card-face"');
    expect(html).toContain('>7<');
    expect(html).not.toContain('>4<');
    expect(html).not.toContain('>3<');
  });

  it('renders the ordinary two-dice faces when eventCardsOn is false/absent (default)', () => {
    const html = renderToStaticMarkup(
      createElement(DicePanel, {
        turn: { number: 5, player: 0 as Seat, rolled: true, roll: [4, 3], devPlayed: false },
        phase: { kind: 'main' },
        turnPlayerName: 'Alice',
        isViewerTurn: true,
      }),
    );
    expect(html).not.toContain('data-testid="event-card-face"');
    expect(html).toContain('die-face-4');
    expect(html).toContain('die-face-3');
  });
});

describe('DicePanel motion (docs/11 §5 "dice tumble" + prefers-reduced-motion)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  function renderRolled() {
    return renderToStaticMarkup(
      createElement(DicePanel, {
        turn: { number: 5, player: 0 as Seat, rolled: true, roll: [3, 4], devPlayed: false },
        phase: { kind: 'main' },
        turnPlayerName: 'Alice',
        isViewerTurn: true,
      }),
    );
  }

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('plays the tumble animation on a rolled dice face by default (no matchMedia/window at all)', () => {
    expect(renderRolled()).toContain('hexhaven-dice-tumble');
  });

  it('never animates a placeholder (unrolled) face', () => {
    const html = renderToStaticMarkup(
      createElement(DicePanel, {
        turn: { number: 1, player: 0 as Seat, rolled: false, roll: null, devPlayed: false },
        phase: { kind: 'preRoll' },
        turnPlayerName: 'Alice',
        isViewerTurn: false,
      }),
    );
    expect(html).not.toContain('hexhaven-dice-tumble');
  });

  it('suppresses the tumble animation under prefers-reduced-motion', () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    };
    expect(renderRolled()).not.toContain('hexhaven-dice-tumble');
  });
});
