// Tests for the WebGL feature gate (T-1400). The workspace's vitest runs under `environment: "node"`
// (no jsdom, see board3d.test.ts's own note) — `document` is genuinely undefined here, so this
// exercises the real SSR/test-safe path rather than a stub.
import { describe, expect, it } from 'vitest';
import { hasWebGL } from './webgl';

describe('hasWebGL', () => {
  it('is false when there is no document (SSR/test-safe, never throws)', () => {
    expect(typeof document).toBe('undefined');
    expect(hasWebGL()).toBe(false);
  });
});
