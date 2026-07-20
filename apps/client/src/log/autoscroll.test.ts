import { describe, expect, it } from 'vitest';
import { isAtBottom } from './autoscroll';

describe('isAtBottom (T-407 requirement 2: autoscroll pin logic)', () => {
  it('is true when scrolled exactly to the bottom', () => {
    expect(isAtBottom({ scrollTop: 100, scrollHeight: 200, clientHeight: 100 })).toBe(true);
  });

  it('is true within the pin tolerance (subpixel/rounding slack)', () => {
    expect(isAtBottom({ scrollTop: 90, scrollHeight: 200, clientHeight: 100 })).toBe(true);
  });

  it('is false once scrolled up past the tolerance', () => {
    expect(isAtBottom({ scrollTop: 50, scrollHeight: 200, clientHeight: 100 })).toBe(false);
  });

  it('is true when content is shorter than the viewport (nothing to scroll)', () => {
    expect(isAtBottom({ scrollTop: 0, scrollHeight: 50, clientHeight: 100 })).toBe(true);
  });
});
