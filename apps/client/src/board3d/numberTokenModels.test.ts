import { describe, it, expect } from 'vitest';
import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import {
  applyTokenHeightColors,
  NUMBER_TOKEN_URL,
  NUMBER_TOKEN_VALUES,
  numberTokenUrlFor,
  TOKEN_BASE_BLACK,
  TOKEN_BASE_RED,
  TOKEN_RED_VALUES,
  TOKEN_TOP_COLOR,
  tokenBaseColorFor,
} from './numberTokenModels';

describe('number token value set', () => {
  it('covers the base-game values with no 7', () => {
    expect([...NUMBER_TOKEN_VALUES]).toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
    expect(NUMBER_TOKEN_VALUES).not.toContain(7);
  });

  it('has a distinct url for every value', () => {
    for (const v of NUMBER_TOKEN_VALUES) {
      expect(typeof numberTokenUrlFor(v)).toBe('string');
      expect(numberTokenUrlFor(v)).toBe(NUMBER_TOKEN_URL[v]);
    }
    const urls = NUMBER_TOKEN_VALUES.map((v) => numberTokenUrlFor(v));
    expect(new Set(urls).size).toBe(NUMBER_TOKEN_VALUES.length);
  });

  it('returns undefined for a value with no model', () => {
    expect(numberTokenUrlFor(7)).toBeUndefined();
    expect(numberTokenUrlFor(13)).toBeUndefined();
  });
});

describe('token base colour', () => {
  it('is red for the high-probability 6 and 8', () => {
    expect(TOKEN_RED_VALUES.has(6)).toBe(true);
    expect(TOKEN_RED_VALUES.has(8)).toBe(true);
    expect(tokenBaseColorFor(6)).toBe(TOKEN_BASE_RED);
    expect(tokenBaseColorFor(8)).toBe(TOKEN_BASE_RED);
  });

  it('is black for every other value', () => {
    for (const v of [2, 3, 4, 5, 9, 10, 11, 12]) {
      expect(tokenBaseColorFor(v)).toBe(TOKEN_BASE_BLACK);
    }
  });
});

/** Two rows of vertices spanning y in [0, 1] so the colour gradient's endpoints are testable. */
function stripGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const pos = [
    -1, 0, 0, 1, 0, 0, 0, 0, 1, // bottom row (y=0)
    -1, 1, 0, 1, 1, 0, 0, 1, 1, // top row (y=1)
  ];
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(pos), 3));
  return g;
}

describe('applyTokenHeightColors', () => {
  it('bakes a base->top gradient into a colour attribute', () => {
    const g = applyTokenHeightColors(stripGeometry(), TOKEN_BASE_BLACK, TOKEN_TOP_COLOR, 0.5, 0.1);
    const color = g.getAttribute('color');
    expect(color).toBeTruthy();
    expect(color.count).toBe(6);

    const base = new Color(TOKEN_BASE_BLACK);
    const top = new Color(TOKEN_TOP_COLOR);
    // bottom vertices (y=0, below the split) read the base colour...
    expect(color.getX(0)).toBeCloseTo(base.r, 5);
    expect(color.getY(0)).toBeCloseTo(base.g, 5);
    // ...top vertices (y=1, above the split) read the top colour.
    expect(color.getX(3)).toBeCloseTo(top.r, 5);
    expect(color.getY(3)).toBeCloseTo(top.g, 5);
  });

  it('moving the split up keeps more of the puck in the base colour', () => {
    // vertices at y=0, 0.5, 1 so the mid vertex (index 1, t=0.5) sits below a high split, above a low.
    const col = () => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(new Float32Array([0, 0, 0, 0, 0.5, 0, 0, 1, 0]), 3));
      return g;
    };
    const base = new Color(TOKEN_BASE_RED);
    const low = applyTokenHeightColors(col(), TOKEN_BASE_RED, TOKEN_TOP_COLOR, 0.2, 0.05);
    const high = applyTokenHeightColors(col(), TOKEN_BASE_RED, TOKEN_TOP_COLOR, 0.9, 0.05);
    // the mid vertex reads base under the high split but the light top under the low split.
    const distHigh = Math.abs(high.getAttribute('color').getX(1) - base.r);
    const distLow = Math.abs(low.getAttribute('color').getX(1) - base.r);
    expect(distHigh).toBeLessThan(distLow);
  });
});
