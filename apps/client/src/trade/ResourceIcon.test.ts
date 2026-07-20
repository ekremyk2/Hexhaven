import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResourceBundleIcons, ResourceIcon, RESOURCE_GLYPH } from './ResourceIcon';

describe('ResourceIcon (T-404 requirement 4)', () => {
  it.each(['brick', 'lumber', 'wool', 'grain', 'ore'] as const)('renders the %s glyph', (resource) => {
    const html = renderToStaticMarkup(createElement(ResourceIcon, { resource }));
    expect(html).toContain(RESOURCE_GLYPH[resource]);
    expect(html).toContain(`data-testid="resource-icon-${resource}"`);
  });

  it('shows a count badge only when `count` is provided (including 0)', () => {
    const withCount = renderToStaticMarkup(createElement(ResourceIcon, { resource: 'brick', count: 0 }));
    expect(withCount).toContain('data-testid="resource-icon-brick-count"');
    expect(withCount).toMatch(/>0</);

    const bare = renderToStaticMarkup(createElement(ResourceIcon, { resource: 'brick' }));
    expect(bare).not.toContain('data-testid="resource-icon-brick-count"');
  });
});

describe('ResourceBundleIcons', () => {
  it('renders one icon per non-zero resource, skipping zero/undefined entries', () => {
    const html = renderToStaticMarkup(
      createElement(ResourceBundleIcons, { bundle: { brick: 2, lumber: 0, wool: 1 } })
    );
    expect(html).toContain('data-testid="resource-icon-brick"');
    expect(html).toContain('data-testid="resource-icon-wool"');
    expect(html).not.toContain('data-testid="resource-icon-lumber"');
  });

  it('renders nothing for an empty bundle', () => {
    const html = renderToStaticMarkup(createElement(ResourceBundleIcons, { bundle: {} }));
    expect(html).not.toContain('resource-icon');
  });
});
