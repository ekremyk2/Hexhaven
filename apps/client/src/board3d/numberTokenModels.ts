// T-1506 — 3D socket number-token inserts. The user supplied ONE STL per token VALUE (a full puck:
// disc + raised digit relief), replacing the earlier single-sheet-slicing approach whose per-cell
// centring was wrong. Each value's model is loaded + normalised exactly like the other STL pieces
// (`stlModels.ts`'s `normalizeStlGeometry`, footprint-fit), then `NumberTokenInsert3D.tsx` mounts the
// right value in an STL-terrain hex's sculpted socket recess (spun to face the camera on Y only).
//
// Colour: the raw models carry no colour, so `applyTokenHeightColors` bakes a height gradient into a
// vertex-colour attribute — a BASE colour at the puck's bottom fading to a light TOP at the raised
// number face. Base colour is red for the two highest-probability rolls (6 & 8) and black for every
// other value, matching a real Catan number-token set. The split height + blend are user-tunable
// (`devTuning.ts` / the tuning panel), same live-rebake discipline as the terrain colour bands.
import { BufferGeometry, Color, Float32BufferAttribute, type BufferAttribute } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { TOKEN_RADIUS } from './constants';
import { normalizeStlGeometry } from './stlModels';

import numberToken2Url from './models/opt/numberToken2.stl?url';
import numberToken3Url from './models/opt/numberToken3.stl?url';
import numberToken4Url from './models/opt/numberToken4.stl?url';
import numberToken5Url from './models/opt/numberToken5.stl?url';
import numberToken6Url from './models/opt/numberToken6.stl?url';
import numberToken8Url from './models/opt/numberToken8.stl?url';
import numberToken9Url from './models/opt/numberToken9.stl?url';
import numberToken10Url from './models/opt/numberToken10.stl?url';
import numberToken11Url from './models/opt/numberToken11.stl?url';
import numberToken12Url from './models/opt/numberToken12.stl?url';

/** The base-game token values that have a model (no 7 — the desert carries no token). */
export const NUMBER_TOKEN_VALUES = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] as const;

/** value -> its per-value STL asset URL (Vite `?url`, base-path + content-hash safe, same rationale
 *  as `stlModels.ts`). */
export const NUMBER_TOKEN_URL: Record<number, string> = {
  2: numberToken2Url,
  3: numberToken3Url,
  4: numberToken4Url,
  5: numberToken5Url,
  6: numberToken6Url,
  8: numberToken8Url,
  9: numberToken9Url,
  10: numberToken10Url,
  11: numberToken11Url,
  12: numberToken12Url,
};

export function numberTokenUrlFor(value: number): string | undefined {
  return NUMBER_TOKEN_URL[value];
}

/** Target world-diameter (before `constants.ts`'s `TOKEN_SOCKET_SCALE`) a token puck normalises to.
 *  USER-CALIBRATED via the tuning panel's socket scale. */
export const TOKEN_INSERT_DIAMETER = TOKEN_RADIUS * 1.6;

/** Per-value normalising loader — footprint-fit to `TOKEN_INSERT_DIAMETER`, same Z-up->Y-up remap and
 *  "sit at y=0" placement `stlModels.ts` documents. One stable module-level class keeps `useLoader`'s
 *  `(Proto, url)` cache key stable across renders (each value's url is its own cache entry). */
export class NumberTokenSTLLoader extends STLLoader {
  override parse(data: ArrayBuffer | string): BufferGeometry {
    return normalizeStlGeometry(super.parse(data), TOKEN_INSERT_DIAMETER, 'footprint');
  }
}

/** The two highest-probability rolls print red on a real Catan set; everything else prints black. */
export const TOKEN_RED_VALUES: ReadonlySet<number> = new Set([6, 8]);
export const TOKEN_BASE_BLACK = '#161616';
export const TOKEN_BASE_RED = '#b0201c';
/** Light "engraved face" colour the gradient fades up to at the top of the puck. */
export const TOKEN_TOP_COLOR = '#efeadb';

export function tokenBaseColorFor(value: number): string {
  return TOKEN_RED_VALUES.has(value) ? TOKEN_BASE_RED : TOKEN_BASE_BLACK;
}

/** Height fraction (0 bottom .. 1 top) at which the base->top colour split sits, and the blend width
 *  around it. User-tunable starting values; the terrain bands use the same fraction/blend idea. */
export const TOKEN_COLOR_THRESHOLD = 0.55;
export const TOKEN_COLOR_BLEND = 0.14;

/**
 * Bakes a vertical base->top colour gradient into `geometry`'s `color` attribute (mutates + returns
 * it): vertices below `threshold - blend/2` of the model's own height get `baseHex`, those above
 * `threshold + blend/2` get `topHex`, with a smoothstep blend between — so the puck body reads in the
 * base colour and the raised number face reads light. Assumes the geometry is already Y-up with its
 * base at y~=0 (`normalizeStlGeometry`). Renders via a `vertexColors` material.
 */
export function applyTokenHeightColors(
  geometry: BufferGeometry,
  baseHex: string,
  topHex: string = TOKEN_TOP_COLOR,
  threshold: number = TOKEN_COLOR_THRESHOLD,
  blend: number = TOKEN_COLOR_BLEND,
): BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const position = geometry.getAttribute('position') as BufferAttribute | undefined;
  if (!box || !position) return geometry; // defensive: empty/degenerate geometry.

  const minY = box.min.y;
  const span = box.max.y - minY || 1;
  const half = Math.max(blend, 1e-4) / 2;
  const lo = threshold - half;
  const hi = threshold + half;
  const base = new Color(baseHex);
  const top = new Color(topHex);
  const c = new Color();

  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const t = (position.getY(i) - minY) / span;
    let m = t <= lo ? 0 : t >= hi ? 1 : (t - lo) / (hi - lo);
    m = m * m * (3 - 2 * m); // smoothstep
    c.copy(base).lerp(top, m);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}
