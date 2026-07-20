// T-403 requirement 3 tests: T-206's optional per-seat deadline rendered only when present.
// `remainingSeconds` is pure math (unit-tested directly); the component's own live tick relies on
// `Date.now()`/`setInterval`, so its render tests only check the initial static markup.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { initTestI18n } from '../hud/testI18n';
import { Countdown, remainingSeconds } from './Countdown';

describe('remainingSeconds (pure math)', () => {
  it('rounds up to the next whole second', () => {
    expect(remainingSeconds(10_400, 9_000)).toBe(2); // 1.4s -> 2
  });

  it('never goes negative once the deadline has passed', () => {
    expect(remainingSeconds(1_000, 5_000)).toBe(0);
  });

  it('is exactly 0 right at the deadline', () => {
    expect(remainingSeconds(5_000, 5_000)).toBe(0);
  });
});

describe('Countdown (requirement 3: render only when a deadline is present)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders nothing when no deadline is active', () => {
    const html = renderToStaticMarkup(createElement(Countdown, { deadline: null }));
    expect(html).toBe('');
  });

  it('renders a "Ns" badge when a deadline is active', () => {
    const html = renderToStaticMarkup(createElement(Countdown, { deadline: Date.now() + 42_000 }));
    expect(html).toContain('data-testid="countdown"');
    expect(html).toMatch(/4[0-2]s/); // ~42s, allow for test-execution jitter
  });
});
