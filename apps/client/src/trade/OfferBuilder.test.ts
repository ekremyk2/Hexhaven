// T-404 requirement 2/5: the domestic offer builder + response tracker. `OfferForm` initial-render
// checks (steppers start empty, Send disabled, no premature ER-4 message — `rates.test.ts` covers
// `validateOffer` itself exhaustively) plus the full offer lifecycle over the ENGINE's own reducer
// (this workspace's stand-in for "a mock transport": each step below is exactly the state a real
// transport would push down as a fresh `PlayerView` after that action round-trips) — offer -> two
// accepts, one decline -> owner confirms one accepter -> hands swap in the next view, and the
// tracker itself gives way back to the builder form once `view.trade` clears.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { createGame, redact, reduce } from '@hexhaven/engine';
import type { OwnPlayerView } from '@hexhaven/engine';
import type { GameConfig, GameState, Seat } from '@hexhaven/shared';
import { OfferBuilder, OfferForm } from './OfferBuilder';
import { initTradeTestI18n } from './testI18n';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'offer-builder-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

const SEAT0 = 0 as Seat;
const NOOP = () => {};
const seatName = (seat: Seat) => `Seat${seat}`;

// Same `as unknown as` cast `ActionBar.test.ts` uses: the redacted view type doesn't distinguish
// own/other at the type level, but `.seat === seat` is what actually guarantees the full hand here.
function ownFrom(view: ReturnType<typeof redact>, seat: Seat): OwnPlayerView {
  return view.players.find((entry) => entry.seat === seat) as unknown as OwnPlayerView;
}

describe('OfferForm (builder, no open offer)', () => {
  beforeAll(async () => {
    await initTradeTestI18n();
  });

  it('starts with empty steppers, Send disabled, and no premature ER-4 message', () => {
    const g = createGame(CONFIG);
    const view = redact(g, SEAT0);
    const own = ownFrom(view, SEAT0);
    const html = renderToStaticMarkup(createElement(OfferForm, { own, dispatch: NOOP }));
    expect(html).toMatch(/data-testid="offer-send"[^>]*disabled=""/);
    // The block-reason slot is always present (reserved space so it never shifts the Send button),
    // but must be EMPTY until the offer is actually touched — no premature ER-4 message.
    expect(html).toMatch(/data-testid="offer-block-reason"[^>]*><\/p>/);
    expect(html).toContain('data-testid="resource-icon-brick-count"');
    expect(html).toMatch(/data-testid="resource-icon-brick-count">0</);
  });
});

describe('OfferBuilder: full domestic-trade lifecycle (offer -> 2 accepts, 1 decline -> confirm)', () => {
  beforeAll(async () => {
    await initTradeTestI18n();
  });

  function craftBase(): GameState {
    const g = createGame(CONFIG);
    const players = g.players.map((p) => {
      if (p.seat === 0) return { ...p, resources: { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 } };
      return { ...p, resources: { brick: 0, lumber: 0, wool: 1, grain: 0, ore: 0 } };
    });
    return { ...g, players, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true } };
  }

  it('walks the whole lifecycle, checking the tracker/form render at each step', () => {
    const base = craftBase();

    // Step 1: owner opens an offer — the view.trade the rest of this test drives off of.
    const afterOffer = reduce(base, 0, { type: 'offerTrade', give: { brick: 1 }, receive: { wool: 1 } });
    expect(afterOffer.ok).toBe(true);
    if (!afterOffer.ok) return;

    // Step 2/3/4: seat 1 and 2 accept, seat 3 declines.
    const afterSeat1 = reduce(afterOffer.state, 1, { type: 'respondTrade', response: 'accept' });
    expect(afterSeat1.ok).toBe(true);
    if (!afterSeat1.ok) return;
    const afterSeat2 = reduce(afterSeat1.state, 2, { type: 'respondTrade', response: 'accept' });
    expect(afterSeat2.ok).toBe(true);
    if (!afterSeat2.ok) return;
    const afterSeat3 = reduce(afterSeat2.state, 3, { type: 'respondTrade', response: 'decline' });
    expect(afterSeat3.ok).toBe(true);
    if (!afterSeat3.ok) return;

    const viewMidLifecycle = redact(afterSeat3.state, SEAT0);
    const ownMid = ownFrom(viewMidLifecycle, SEAT0);
    const midHtml = renderToStaticMarkup(
      createElement(OfferBuilder, { view: viewMidLifecycle, own: ownMid, mySeat: SEAT0, opponentName: seatName, dispatch: NOOP })
    );
    // Tracker, not the builder form, is what's showing now that an offer is open.
    expect(midHtml).toContain('data-testid="trade-tracker"');
    expect(midHtml).not.toContain('data-testid="offer-builder-form"');
    expect(midHtml).toContain('data-testid="trade-tracker-confirm-1"');
    expect(midHtml).toContain('data-testid="trade-tracker-confirm-2"');
    expect(midHtml).not.toContain('data-testid="trade-tracker-confirm-3"'); // declined, no Complete button
    expect(midHtml).toMatch(/data-testid="trade-tracker-status-1"[^>]*>Accepted/);
    expect(midHtml).toMatch(/data-testid="trade-tracker-status-3"[^>]*>Declined/);

    // Step 5: owner confirms with seat 2 (not seat 1) — hands swap in the NEXT view.
    const afterConfirm = reduce(afterSeat3.state, 0, { type: 'confirmTrade', with: 2 });
    expect(afterConfirm.ok).toBe(true);
    if (!afterConfirm.ok) return;
    expect(afterConfirm.state.players[0]!.resources.brick).toBe(0);
    expect(afterConfirm.state.players[0]!.resources.wool).toBe(1);
    expect(afterConfirm.state.players[2]!.resources.brick).toBe(1);
    expect(afterConfirm.state.players[2]!.resources.wool).toBe(0);
    expect(afterConfirm.state.trade).toBeNull();

    // Step 6: the tracker gives way back to the builder form once the offer clears from the view.
    const viewAfterConfirm = redact(afterConfirm.state, SEAT0);
    const ownAfter = ownFrom(viewAfterConfirm, SEAT0);
    const afterHtml = renderToStaticMarkup(
      createElement(OfferBuilder, { view: viewAfterConfirm, own: ownAfter, mySeat: SEAT0, opponentName: seatName, dispatch: NOOP })
    );
    expect(afterHtml).toContain('data-testid="offer-builder-form"');
    expect(afterHtml).not.toContain('data-testid="trade-tracker"');
  });

  it("disables an accepter's Complete button once the owner can no longer afford the give side", () => {
    const base = craftBase();
    const afterOffer = reduce(base, 0, { type: 'offerTrade', give: { brick: 1 }, receive: { wool: 1 } });
    expect(afterOffer.ok).toBe(true);
    if (!afterOffer.ok) return;
    const afterAccept = reduce(afterOffer.state, 1, { type: 'respondTrade', response: 'accept' });
    expect(afterAccept.ok).toBe(true);
    if (!afterAccept.ok) return;

    // Hand-craft the owner spending their brick meanwhile (e.g. a build) — the tracker should
    // reflect it can't be completed, without the offer itself having closed.
    const spentState: GameState = {
      ...afterAccept.state,
      players: afterAccept.state.players.map((p) => (p.seat === 0 ? { ...p, resources: { ...p.resources, brick: 0 } } : p)),
    };
    const view = redact(spentState, SEAT0);
    const own = ownFrom(view, SEAT0);
    const html = renderToStaticMarkup(
      createElement(OfferBuilder, { view, own, mySeat: SEAT0, opponentName: seatName, dispatch: NOOP })
    );
    expect(html).toMatch(/data-testid="trade-tracker-confirm-1"[^>]*disabled=""/);
  });
});
