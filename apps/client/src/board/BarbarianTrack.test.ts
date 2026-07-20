// <BarbarianTrack> (T-805, docs/rules/cities-knights-rules.md C8). Same node-env/renderToStaticMarkup
// convention as the other board tests, plus the per-feature `testI18n` bootstrap (see
// `robber/testI18n.ts`) so the rendered copy is real strings, not raw keys.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { CK_BARBARIAN_STEPS_TO_ATTACK } from '@hexhaven/shared';
import { BarbarianTrack } from './BarbarianTrack';
import { initTestI18n } from './testI18n';

describe('BarbarianTrack (C8: ship progress toward Hexhaven)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders one step marker per slot (0..totalSteps inclusive) plus the ship token', () => {
    const html = renderToStaticMarkup(createElement(BarbarianTrack, { position: 3, totalSteps: 7 }));
    for (let i = 0; i <= 7; i++) {
      expect(html).toContain(`data-testid="barbarian-step-${i}"`);
    }
    expect(html).toContain('data-testid="barbarian-ship"');
    expect(html).toContain('data-position="3"');
  });

  it('defaults totalSteps to the CK_BARBARIAN_STEPS_TO_ATTACK module constant', () => {
    const html = renderToStaticMarkup(createElement(BarbarianTrack, { position: 0 }));
    expect(html).toContain(`data-testid="barbarian-step-${CK_BARBARIAN_STEPS_TO_ATTACK}"`);
    expect(html).not.toContain(`data-testid="barbarian-step-${CK_BARBARIAN_STEPS_TO_ATTACK + 1}"`);
  });

  it('marks steps up to and including the ship position as filled', () => {
    const html = renderToStaticMarkup(createElement(BarbarianTrack, { position: 2, totalSteps: 5 }));
    expect(html).toMatch(new RegExp(`data-testid="barbarian-step-0"[^>]*data-filled="true"`));
    expect(html).toMatch(new RegExp(`data-testid="barbarian-step-2"[^>]*data-filled="true"`));
    expect(html).toMatch(new RegExp(`data-testid="barbarian-step-3"[^>]*data-filled="false"`));
  });

  it('shows the "attack imminent" state one step before the total, not earlier', () => {
    const notYet = renderToStaticMarkup(createElement(BarbarianTrack, { position: 4, totalSteps: 7 }));
    expect(notYet).not.toContain('data-testid="barbarian-imminent"');

    const imminent = renderToStaticMarkup(createElement(BarbarianTrack, { position: 6, totalSteps: 7 }));
    expect(imminent).toContain('data-testid="barbarian-imminent"');
    expect(imminent).toContain('Attack imminent!');
  });

  it('clamps an out-of-range position (defensive against a mid-resolution render)', () => {
    const html = renderToStaticMarkup(createElement(BarbarianTrack, { position: 99, totalSteps: 7 }));
    expect(html).toContain('data-position="7"');
    expect(html).toContain('data-testid="barbarian-imminent"');
  });

  it('renders the translated title, not a raw i18n key', () => {
    const html = renderToStaticMarkup(createElement(BarbarianTrack, { position: 0, totalSteps: 7 }));
    expect(html).toContain('Barbarian ship progress');
    expect(html).not.toContain('barbarianTrack.title');
  });
});
