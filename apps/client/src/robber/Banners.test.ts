import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { MoveRobberBanner, PendingDiscardBar } from './Banners';
import { initTestI18n } from './testI18n';

describe('PendingDiscardBar (requirement 1: subtle bar for unaffected players)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders nothing when nobody is pending', () => {
    expect(renderToStaticMarkup(createElement(PendingDiscardBar, { names: [] }))).toBe('');
  });

  it('lists every still-pending name', () => {
    const html = renderToStaticMarkup(createElement(PendingDiscardBar, { names: ['Ali', 'Zeynep'] }));
    expect(html).toContain('data-testid="discard-pending-bar"');
    expect(html).toContain('Ali, Zeynep');
  });
});

describe('MoveRobberBanner (requirement 2: board banner while relocating the robber)', () => {
  it('renders the banner text', () => {
    const html = renderToStaticMarkup(createElement(MoveRobberBanner, {}));
    expect(html).toContain('data-testid="move-robber-banner"');
    expect(html).toContain('Move the robber to a new hex.');
  });
});
