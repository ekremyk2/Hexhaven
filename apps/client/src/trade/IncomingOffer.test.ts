// T-404 requirement 3/5: the non-owner's corner card. Since `TradePanel` mounts/unmounts this
// purely off `view.trade`, "reacts to tradeResponded/tradeCompleted/tradeCancelled (incl. ER-11)"
// reduces to "renders correctly for whatever `trade` shape the current view carries" — covered here
// by feeding it the different `state.trade` shapes those events leave behind, plus a smoke check in
// `TradePanel.test.ts` that it actually disappears once `view.trade` goes `null`.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { OwnPlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { IncomingOffer } from './IncomingOffer';
import { initTradeTestI18n } from './testI18n';

const SEAT1 = 1 as Seat;
const NOOP = () => {};
// IncomingOffer only reads `own.resources`; a holds-everything hand keeps Accept enabled.
const RICH_OWN = { resources: { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 5 } } as unknown as OwnPlayerView;
const BROKE_OWN = { resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 } } as unknown as OwnPlayerView;

describe('IncomingOffer', () => {
  beforeAll(async () => {
    await initTradeTestI18n();
  });

  it('shows the offerer\'s name, the give/receive bundles, and no status badge before responding', () => {
    const html = renderToStaticMarkup(
      createElement(IncomingOffer, {
        trade: { give: { wool: 2 }, receive: { brick: 1 }, responses: {} },
        own: RICH_OWN,
        mySeat: SEAT1,
        offererName: 'Alice',
        dispatch: NOOP,
      })
    );
    expect(html).toContain('Alice');
    expect(html).toContain('data-testid="resource-icon-wool"');
    expect(html).toContain('data-testid="resource-icon-brick"');
    // T-508: shown from the RESPONDER's perspective — the offerer's `receive` (brick) is what YOU
    // GIVE; the offerer's `give` (wool) is what YOU GET. Previously this was backwards.
    expect(html).toContain('You give');
    expect(html).toContain('You get');
    expect(html.indexOf('You give')).toBeLessThan(html.indexOf('data-testid="resource-icon-brick"'));
    expect(html.indexOf('data-testid="resource-icon-brick"')).toBeLessThan(html.indexOf('You get'));
    expect(html.indexOf('You get')).toBeLessThan(html.indexOf('data-testid="resource-icon-wool"'));
    expect(html).not.toContain('data-testid="incoming-offer-status"');
    expect(html).toContain('data-testid="incoming-offer-accept"');
    expect(html).toContain('data-testid="incoming-offer-decline"');
  });

  it('shows "you accepted" once this seat has accepted', () => {
    const html = renderToStaticMarkup(
      createElement(IncomingOffer, {
        trade: { give: { wool: 2 }, receive: { brick: 1 }, responses: { 1: 'accepted' } },
        own: RICH_OWN,
        mySeat: SEAT1,
        offererName: 'Alice',
        dispatch: NOOP,
      })
    );
    expect(html).toContain('data-testid="incoming-offer-status"');
    expect(html).toContain('You accepted');
  });

  it('shows "you declined" once this seat has declined', () => {
    const html = renderToStaticMarkup(
      createElement(IncomingOffer, {
        trade: { give: { wool: 2 }, receive: { brick: 1 }, responses: { 1: 'declined' } },
        own: RICH_OWN,
        mySeat: SEAT1,
        offererName: 'Alice',
        dispatch: NOOP,
      })
    );
    expect(html).toContain('data-testid="incoming-offer-status"');
    expect(html).toContain('You declined');
  });

  it('reflects only THIS seat\'s response, ignoring another seat\'s', () => {
    const html = renderToStaticMarkup(
      createElement(IncomingOffer, {
        trade: { give: { wool: 2 }, receive: { brick: 1 }, responses: { 2: 'accepted' } },
        own: RICH_OWN,
        mySeat: SEAT1,
        offererName: 'Alice',
        dispatch: NOOP,
      })
    );
    expect(html).not.toContain('data-testid="incoming-offer-status"');
  });

  it('disables Accept and shows a hint when this seat cannot fulfill the offer (B-21)', () => {
    const html = renderToStaticMarkup(
      createElement(IncomingOffer, {
        trade: { give: { wool: 2 }, receive: { brick: 1 }, responses: {} },
        own: BROKE_OWN, // holds no brick — can't give what the offerer asked for
        mySeat: SEAT1,
        offererName: 'Alice',
        dispatch: NOOP,
      })
    );
    expect(html).toContain('data-testid="incoming-offer-cant-accept"');
    // Accept carries the real `disabled=""` attribute; Decline does not (only aria-disabled="false").
    expect(html).toMatch(/data-testid="incoming-offer-accept"[^>]*\sdisabled=""/);
    expect(html).not.toMatch(/data-testid="incoming-offer-decline"[^>]*\sdisabled=""/);
  });
});
