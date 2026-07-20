import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import { PlayerPanel } from './PlayerPanel';
import { makeAwards, makeOtherPlayerView } from './testFixtures';
import { initTestI18n } from './testI18n';

const SEAT = 1 as Seat;

describe('PlayerPanel (T-402 requirement 2: opponent counts, never identities)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders the exact resource/dev-card/knight counts from a redacted OtherPlayerView', () => {
    const entry = makeOtherPlayerView(SEAT, { resourceCount: 7, devCardCount: 3, playedKnights: 2 });
    const html = renderToStaticMarkup(
      createElement(PlayerPanel, { entry, name: 'Alice', active: false, awards: makeAwards() }),
    );
    expect(html).toContain('7 cards');
    expect(html).toContain('3 dev cards');
    expect(html).toContain('2 knights');
  });

  it('never renders a resource-type name — OtherPlayerView carries counts only (docs/02 §6)', () => {
    const entry = makeOtherPlayerView(SEAT, { resourceCount: 5 });
    const html = renderToStaticMarkup(
      createElement(PlayerPanel, { entry, name: 'Alice', active: false, awards: makeAwards() }),
    );
    for (const resourceWord of ['brick', 'lumber', 'wool', 'grain', 'ore']) {
      expect(html.toLowerCase()).not.toContain(resourceWord);
    }
  });

  it('shows the Longest Road / Largest Army badge only for the actual holder', () => {
    const holder = makeOtherPlayerView(SEAT);
    const awards = makeAwards({ longestRoad: { holder: SEAT, length: 6 } });
    const holderHtml = renderToStaticMarkup(
      createElement(PlayerPanel, { entry: holder, name: 'Alice', active: false, awards }),
    );
    expect(holderHtml).toContain('Longest Road');
    expect(holderHtml).not.toContain('Largest Army');

    const nonHolder = makeOtherPlayerView(2 as Seat);
    const nonHolderHtml = renderToStaticMarkup(
      createElement(PlayerPanel, { entry: nonHolder, name: 'Bilal', active: false, awards }),
    );
    expect(nonHolderHtml).not.toContain('Longest Road');
  });

  it('shows a discard-pending badge only while an amount is passed', () => {
    const entry = makeOtherPlayerView(SEAT);
    const pendingHtml = renderToStaticMarkup(
      createElement(PlayerPanel, { entry, name: 'Alice', active: false, discardAmount: 4, awards: makeAwards() }),
    );
    expect(pendingHtml).toContain('Discard 4 cards');

    const idleHtml = renderToStaticMarkup(
      createElement(PlayerPanel, { entry, name: 'Alice', active: false, awards: makeAwards() }),
    );
    expect(idleHtml).not.toContain('Discard');
  });

  it('marks the active seat with PlayerChip\'s turn-change glow', () => {
    const entry = makeOtherPlayerView(SEAT);
    const activeHtml = renderToStaticMarkup(
      createElement(PlayerPanel, { entry, name: 'Alice', active: true, awards: makeAwards() }),
    );
    const idleHtml = renderToStaticMarkup(
      createElement(PlayerPanel, { entry, name: 'Alice', active: false, awards: makeAwards() }),
    );
    expect(activeHtml).toContain('ring-accent-gold');
    expect(idleHtml).not.toContain('ring-accent-gold');
  });

  it('renders an offline connection dot only when connected is explicitly false', () => {
    const entry = makeOtherPlayerView(SEAT);
    const offlineHtml = renderToStaticMarkup(
      createElement(PlayerPanel, { entry, name: 'Alice', active: false, connected: false, awards: makeAwards() }),
    );
    expect(offlineHtml).toContain('Offline');

    const unknownHtml = renderToStaticMarkup(
      createElement(PlayerPanel, { entry, name: 'Alice', active: false, awards: makeAwards() }),
    );
    expect(unknownHtml).toContain('Online');
  });
});
