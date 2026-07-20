// Tests for the STL piece models' pure normalization math (T-1503) — bounding-box center/scale/
// orient, à la `coords.test.ts`/`pieceAnimation.test.ts`. Builds small synthetic `BufferGeometry`
// boxes rather than parsing a real STL file — `STLLoader.parse()` itself is three's own well-tested
// code; what THIS module owns (and needs its own coverage) is what happens to the geometry AFTER
// that parse.
import { describe, expect, it } from 'vitest';
import { BoxGeometry, Vector3 } from 'three';
import { CITY_FOOTPRINT, ROAD_LENGTH, SETTLEMENT_FOOTPRINT, normalizeStlGeometry } from './stlModels';

/** A `BoxGeometry` centered at its own local origin, standing in for a parsed STL — its known
 *  width/height/depth let each assertion below reason about the exact expected post-normalization
 *  numbers instead of eyeballing them. */
function box(width: number, height: number, depth: number) {
  return new BoxGeometry(width, height, depth);
}

describe('normalizeStlGeometry — orientation (Z-up source -> Y-up world)', () => {
  it('maps the source Z axis onto world Y (the tallest source dimension ends up vertical)', () => {
    // A 10 (x) x 4 (y) x 20 (z) box, authored Z-up, should end up with its 20-unit span vertical.
    const geometry = box(10, 4, 20);
    normalizeStlGeometry(geometry, 100 /* huge target so scale ~= 1:1, isolating orientation */, 'footprint');
    geometry.computeBoundingBox();
    const size = new Vector3();
    geometry.boundingBox!.getSize(size);
    // Post-rotation (before scale) the vertical (Y) span was the source's Z span (20); scale is
    // uniform, so Y/horizontal-max ratio is preserved: 20 / hypot(10, 4) — assert Y is the LARGEST
    // dimension, confirming the 20-unit source axis (Z) is the one that ended up vertical.
    expect(size.y).toBeGreaterThan(size.x);
    expect(size.y).toBeGreaterThan(size.z);
  });

  it('places the model\'s lowest point at y=0 (ground level)', () => {
    const geometry = box(6, 6, 8);
    normalizeStlGeometry(geometry, 10, 'footprint');
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0, 6);
  });

  it('centers the model on the horizontal (X/Z) origin', () => {
    const geometry = box(6, 6, 8);
    normalizeStlGeometry(geometry, 10, 'footprint');
    geometry.computeBoundingBox();
    const center = new Vector3();
    geometry.boundingBox!.getCenter(center);
    expect(center.x).toBeCloseTo(0, 6);
    expect(center.z).toBeCloseTo(0, 6);
  });
});

describe('normalizeStlGeometry — footprint fit mode (settlement/city)', () => {
  it('scales the largest horizontal (X/Z) extent to exactly targetSize', () => {
    // Source box 8 (x) x 3 (y, becomes up) x 5 (z) -> after Rx(-90deg): x=8, y=5(was z), z=3(was -y,
    // abs 3) -> horizontal max is max(8, 3) = 8.
    const geometry = box(8, 3, 5);
    const target = 20;
    normalizeStlGeometry(geometry, target, 'footprint');
    geometry.computeBoundingBox();
    const size = new Vector3();
    geometry.boundingBox!.getSize(size);
    expect(Math.max(size.x, size.z)).toBeCloseTo(target, 3);
  });

  it('a city normalizes to a strictly larger footprint target than a settlement', () => {
    expect(CITY_FOOTPRINT).toBeGreaterThan(SETTLEMENT_FOOTPRINT);
  });
});

describe('normalizeStlGeometry — length fit mode (road)', () => {
  it('scales the long (X) axis to exactly targetSize when the model is already X-long', () => {
    // 10 (x) x 2 (y->up) x 3 (z): after rotation, x=10 (unchanged), still the long horizontal axis.
    const geometry = box(10, 2, 3);
    const target = ROAD_LENGTH;
    normalizeStlGeometry(geometry, target, 'length');
    geometry.computeBoundingBox();
    const size = new Vector3();
    geometry.boundingBox!.getSize(size);
    expect(size.x).toBeCloseTo(target, 3);
  });

  it('auto-rotates a Z-long model onto X before scaling (long axis ends up == targetSize on X)', () => {
    // Source 3 (x) x 12 (y) x 2 (z): `Rx(-90deg)` swaps the source Y/Z extents onto the new Z/Y —
    // the 12-unit span (source Y) lands on the new horizontal Z axis, longer than the new X (3),
    // so the auto-correction should yaw it onto X before scaling.
    const geometry = box(3, 12, 2);
    const target = ROAD_LENGTH;
    normalizeStlGeometry(geometry, target, 'length');
    geometry.computeBoundingBox();
    const size = new Vector3();
    geometry.boundingBox!.getSize(size);
    expect(size.x).toBeCloseTo(target, 3);
    // And X should now be the dominant horizontal axis (the yaw actually happened, not a no-op).
    expect(size.x).toBeGreaterThan(size.z);
  });
});

describe('normalizeStlGeometry — degenerate input', () => {
  it('does not divide by zero / produce NaN for a zero-size geometry', () => {
    const geometry = box(0, 0, 0);
    expect(() => normalizeStlGeometry(geometry, 10, 'footprint')).not.toThrow();
    geometry.computeBoundingBox();
    const size = new Vector3();
    geometry.boundingBox!.getSize(size);
    expect(Number.isNaN(size.x)).toBe(false);
  });
});
