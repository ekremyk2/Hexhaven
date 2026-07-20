import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import { StealPicker } from './StealPicker';
import { initTestI18n } from './testI18n';

describe('StealPicker (requirement 3: candidates carry counts, never resource types)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      createElement(StealPicker, { open: false, candidates: [], onPick: () => {} }),
    );
    expect(html).toBe('');
  });

  it("renders every candidate's nickname and card COUNT — no resource type ever appears", () => {
    const candidates = [
      { seat: 1 as Seat, name: 'Ali', resourceCount: 3 },
      { seat: 2 as Seat, name: 'Zeynep', resourceCount: 1 },
    ];
    const html = renderToStaticMarkup(createElement(StealPicker, { open: true, candidates, onPick: () => {} }));
    expect(html).toContain('Ali');
    expect(html).toContain('Zeynep');
    expect(html).toContain('3 cards');
    expect(html).toContain('1 card'); // singular plural form
    // Redaction guard: nothing here should ever mention a resource type by name.
    for (const type of ['brick', 'lumber', 'wool', 'grain', 'ore']) {
      expect(html.toLowerCase()).not.toContain(type);
    }
  });

  it('one row per candidate, addressable by seat', () => {
    const candidates = [
      { seat: 0 as Seat, name: 'A', resourceCount: 2 },
      { seat: 3 as Seat, name: 'B', resourceCount: 5 },
    ];
    const html = renderToStaticMarkup(createElement(StealPicker, { open: true, candidates, onPick: () => {} }));
    expect(html).toContain('data-testid="steal-candidate-0"');
    expect(html).toContain('data-testid="steal-candidate-3"');
  });
});
