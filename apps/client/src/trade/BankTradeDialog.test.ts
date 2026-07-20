// T-404 requirement 1/5: bank/harbor dialog render matrix. Initial render only (no jsdom/click
// simulation in this workspace, see `ui/primitives.test.ts`'s header note) — `rates.test.ts` covers
// the underlying rate-matrix logic exhaustively; this file checks the dialog actually wires each
// resource's rate badge / disabled state from it.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, redact } from '@hexhaven/engine';
import type { GameConfig, GameState, Seat } from '@hexhaven/shared';
import { BankTradeDialog } from './BankTradeDialog';
import { initTradeTestI18n } from './testI18n';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'bank-trade-dialog-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const SEAT0 = 0 as Seat;
const NOOP = () => {};

function craft(overrides: Partial<GameState['players'][number]> = {}, bankOverrides: Partial<GameState['bank']> = {}) {
  const g = createGame(CONFIG);
  const players = g.players.map((p) =>
    p.seat === SEAT0 ? { ...p, resources: { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 }, ...overrides } : p
  );
  const state: GameState = {
    ...g,
    players,
    bank: { ...g.bank, ...bankOverrides },
    board: { ...g.board, harbors: {} },
    phase: { kind: 'main' },
    turn: { ...g.turn, player: SEAT0, rolled: true },
  };
  return redact(state, SEAT0);
}

describe('BankTradeDialog', () => {
  beforeAll(async () => {
    await initTradeTestI18n();
  });

  it('shows the 4:1 base rate for every resource with no harbors, none pre-selected', () => {
    const view = craft();
    const html = renderToStaticMarkup(createElement(BankTradeDialog, { view, mySeat: SEAT0, dispatch: NOOP }));
    for (const resource of ['brick', 'lumber', 'wool', 'grain', 'ore']) {
      expect(html).toContain(`data-testid="bank-give-${resource}-rate"`);
    }
    expect(html).toMatch(/data-testid="bank-give-brick-rate"[^>]*>4:1/);
    expect(html).not.toContain('data-testid="bank-preview"'); // nothing picked yet
  });

  it('disables a give resource the seat cannot currently afford at its rate', () => {
    const view = craft({ resources: { brick: 3, lumber: 4, wool: 4, grain: 4, ore: 4 } });
    const html = renderToStaticMarkup(createElement(BankTradeDialog, { view, mySeat: SEAT0, dispatch: NOOP }));
    expect(html).toMatch(/data-testid="bank-give-brick"[^>]*disabled=""/);
    expect(html).not.toMatch(/data-testid="bank-give-lumber"[^>]*disabled=""/);
  });

  it('disables a receive resource the bank has none of, and shows the "bank empty" badge', () => {
    const view = craft({}, { ore: 0 });
    const html = renderToStaticMarkup(createElement(BankTradeDialog, { view, mySeat: SEAT0, dispatch: NOOP }));
    expect(html).toMatch(/data-testid="bank-receive-ore"[^>]*disabled=""/);
    expect(html).toContain('data-testid="bank-receive-ore-empty"');
  });

  it('the confirm button starts disabled (nothing picked yet)', () => {
    const view = craft();
    const html = renderToStaticMarkup(createElement(BankTradeDialog, { view, mySeat: SEAT0, dispatch: NOOP }));
    expect(html).toMatch(/data-testid="bank-confirm"[^>]*disabled=""/);
  });
});
