import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PlayerView } from '@hexhaven/engine';
import type { Seat, VertexId } from '@hexhaven/shared';
import { makeAwards, makeOwnPlayerView } from './testFixtures';
import { VpWidget } from './VpWidget';
import { initTestI18n } from './testI18n';

const SEAT = 0 as Seat;

/** A minimal view carrying only what `computeExtraVp` reads (`ext.harbormaster` / `ext.citiesKnights`
 *  via `ckOf`). Everything else on `PlayerView` is unused by VpWidget, so a cast is safe here. */
function makeView(ext?: PlayerView['ext']): PlayerView {
  return { ext } as unknown as PlayerView;
}

describe('VpWidget (T-402 requirement 5: own public + hidden VP total, with breakdown tooltip)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('shows the total including hidden VP cards, and a breakdown tooltip', () => {
    const own = makeOwnPlayerView(SEAT, {
      settlements: [1, 2] as VertexId[],
      devCards: [{ type: 'victoryPoint', boughtOnTurn: 3 }],
    });
    const html = renderToStaticMarkup(createElement(VpWidget, { own, awards: makeAwards(), view: makeView() }));
    expect(html).toContain('3 VP'); // 2 settlements + 1 hidden VP card
    // The breakdown tooltip is a hover-only portal now (Tooltip.tsx) — not in static markup.
    expect(html).toContain('data-testid="vp-widget"');
  });

  it('folds in the harbormaster +2 award the engine counts (B-38: won at true 15 shown as 13)', () => {
    const own = makeOwnPlayerView(SEAT, { settlements: [1, 2] as VertexId[] });
    const view = makeView({ harbormaster: { holder: SEAT, points: 4 } });
    const html = renderToStaticMarkup(createElement(VpWidget, { own, awards: makeAwards(), view }));
    expect(html).toContain('4 VP'); // 2 settlements + 2 harbormaster
  });
});
