// Tests for the shared reduced-motion hook (T-409, docs/11 §5 tail note). This workspace's vitest
// runs under `environment: "node"` (no jsdom — docs/12 quickstart) so there's no real `window`
// global; `window.matchMedia` is stubbed here as a plain object purely to give
// `usePrefersReducedMotion` something to read during render — no DOM is involved, matching the
// `renderToStaticMarkup` convention every other component test in this workspace uses.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { motionClass, usePrefersReducedMotion } from './motion';

function stubMatchMedia(matches: boolean) {
  (globalThis as { window?: unknown }).window = {
    matchMedia: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  };
}

function Probe() {
  const reduced = usePrefersReducedMotion();
  return createElement('span', { 'data-reduced': String(reduced) }, motionClass(reduced, 'animated', 'static'));
}

describe('usePrefersReducedMotion', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('defaults to false (motion is fine) when there is no window at all', () => {
    delete (globalThis as { window?: unknown }).window;
    const html = renderToStaticMarkup(createElement(Probe));
    expect(html).toContain('data-reduced="false"');
    expect(html).toContain('animated');
  });

  it('reads matches=true off a stubbed matchMedia as reduced motion', () => {
    stubMatchMedia(true);
    const html = renderToStaticMarkup(createElement(Probe));
    expect(html).toContain('data-reduced="true"');
    expect(html).toContain('static');
    expect(html).not.toContain('animated');
  });

  it('reads matches=false off a stubbed matchMedia as motion-is-fine', () => {
    stubMatchMedia(false);
    const html = renderToStaticMarkup(createElement(Probe));
    expect(html).toContain('data-reduced="false"');
    expect(html).toContain('animated');
  });
});

describe('motionClass', () => {
  it('returns the animated class when motion is fine', () => {
    expect(motionClass(false, 'a', 's')).toBe('a');
  });

  it('returns the static fallback (default empty) when reduced', () => {
    expect(motionClass(true, 'a', 's')).toBe('s');
    expect(motionClass(true, 'a')).toBe('');
  });
});
