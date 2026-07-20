// T-403 requirement 2 tests: the classic building-costs card colors each resource have/need
// against the viewer's current hand (R7.1), the same "warn before it surprises you" idea
// `BankPanel.test.ts` exercises for the R5.3 shortage threshold.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { OwnPlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { initTestI18n } from '../hud/testI18n';
import { CostCard } from './CostCard';

function ownWith(resources: Partial<OwnPlayerView['resources']>): OwnPlayerView {
  return {
    seat: 0 as Seat,
    color: 'blue',
    resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0, ...resources },
    devCards: [],
    playedKnights: 0,
    piecesLeft: { roads: 15, settlements: 5, cities: 4 },
    roads: [],
    settlements: [],
    cities: [],
  };
}

function spanFor(html: string, testid: string): string {
  return html.match(new RegExp(`<span[^>]*data-testid="${testid}"[^>]*>[^<]*</span>`))?.[0] ?? '';
}

describe('CostCard (requirement 2: have/need coloring against the current hand, R7.1)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders every item\'s cost bundle', () => {
    const html = renderToStaticMarkup(createElement(CostCard, { own: ownWith({}) }));
    expect(html).toContain('Road');
    expect(html).toContain('Settlement');
    expect(html).toContain('City');
    expect(html).toContain('Development card');
  });

  it('flags a short resource (have < need) as danger-colored', () => {
    const html = renderToStaticMarkup(createElement(CostCard, { own: ownWith({ brick: 0 }) }));
    expect(spanFor(html, 'cost-road-brick')).toContain('text-danger');
  });

  it('does not flag a resource the viewer holds enough of', () => {
    const html = renderToStaticMarkup(createElement(CostCard, { own: ownWith({ brick: 3, lumber: 3 }) }));
    expect(spanFor(html, 'cost-road-brick')).not.toContain('text-danger');
    expect(spanFor(html, 'cost-road-lumber')).not.toContain('text-danger');
  });

  it('flags city\'s ore/grain independently from road\'s brick/lumber', () => {
    const html = renderToStaticMarkup(createElement(CostCard, { own: ownWith({ ore: 0, grain: 5 }) }));
    expect(spanFor(html, 'cost-city-ore')).toContain('text-danger');
    expect(spanFor(html, 'cost-city-grain')).not.toContain('text-danger');
  });
});
