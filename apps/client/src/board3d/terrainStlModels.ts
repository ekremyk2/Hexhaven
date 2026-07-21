// T-1505 — sculpted terrain/water/harbor STL models, generalizing the forest-only SPIKE
// (`forestStlModel.ts`, now retired/replaced by this module) to every terrain the user supplied a
// model for. Reuses T-1503's STL loading + bbox-normalize infrastructure (`stlModels.ts`'s
// `normalizeStlGeometry`/`StlFitMode`) rather than duplicating it — only the asset URLs, the
// measured height data, and the deterministic per-hex variant/rotation picks are new here.
//
// Assets loaded from `models/opt/` (T-1505 requirement 1: DECIMATED, committed copies — see
// `apps/client/scripts/optimize-models.mjs`), never `models/raw/` (the ~35 MB print-resolution
// source set, gitignored, not shipped). Same `?url` convention as `stlModels.ts` (content-hashed
// filename + correct path under the GitHub-Pages base).
import fields1Url from './models/opt/fields1.stl?url';
import fields2Url from './models/opt/fields2.stl?url';
import forest1Url from './models/opt/forest1.stl?url';
import forest2Url from './models/opt/forest2.stl?url';
import forest3Url from './models/opt/forest3.stl?url';
import harborLighthouseUrl from './models/opt/harborLighthouse.stl?url';
import harborShip1Url from './models/opt/harborShip1.stl?url';
import harborShip2Url from './models/opt/harborShip2.stl?url';
import harborShip3Url from './models/opt/harborShip3.stl?url';
import hills1Url from './models/opt/hills1.stl?url';
import hills2Url from './models/opt/hills2.stl?url';
import mountains1Url from './models/opt/mountains1.stl?url';
import mountains2Url from './models/opt/mountains2.stl?url';
import pasture1Url from './models/opt/pasture1.stl?url';
import pasture2Url from './models/opt/pasture2.stl?url';
import desert1Url from './models/opt/desert1.stl?url';
import waterUrl from './models/opt/water.stl?url';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { BufferAttribute, Color, type BufferGeometry } from 'three';
import type { EdgeId, ScenarioTerrain } from '@hexhaven/shared';
import { HEX_SIZE, SEA } from '../board/palette';
import { normalizeStlGeometry } from './stlModels';

/** Target footprint every terrain/water/harbor tile model normalizes to — the real hex tile's own
 *  vertex-to-vertex diameter (`2 * HEX_SIZE`), exactly `forestStlModel.ts`'s spike measurement
 *  generalized: EVERY one of the user's sculpted models (measured directly off each `models/opt/*`
 *  file's own raw bounding box, `apps/client/scripts/optimize-models.mjs`'s sibling measurement pass)
 *  shares the same ~2R x sqrt(3)R hex-shaped footprint, so one shared scale target and one shared
 *  `TerrainSTLLoader` (below) serve every model in this module, not just forest. */
export const TERRAIN_FOOTPRINT = HEX_SIZE * 2;

/** One model variant: its (decimated, committed) asset URL and its measured height-to-footprint
 *  ratio (raw Z-range / raw max(X,Y)-range, BEFORE normalization — measured directly off each
 *  `models/opt/*.stl` file, the same one-time-measurement approach `forestStlModel.ts`'s spike used
 *  for `forest1.stl` alone, generalized here to every model). `modelHeight` below turns this ratio
 *  into the actual world-Y height once normalized to `TERRAIN_FOOTPRINT` — computed instead of
 *  re-measured at runtime so a hex's token/fog/piece elevation (`tileElevation.ts`) never needs to
 *  wait on an async STL load just to ask "how tall is this tile".
 *
 *  NOTE: decimation (SimplifyModifier, requirement 1) reduces triangle count, not overall bounding
 *  box — verified during optimization: the decimated `forest1.stl`'s bbox matches the spike's
 *  hardcoded raw measurement (91.374 x 79.076 x 16.301) to 3 decimal places, so measuring the
 *  post-decimation `opt/` file (what actually ships) is exactly as accurate as measuring the raw one. */
export interface TerrainModelVariant {
  url: string;
  heightRatio: number;
}

/** The normalized world-Y height of a given model variant (its measured `heightRatio` scaled to
 *  `TERRAIN_FOOTPRINT`, the target every model in this module normalizes to) — exported for
 *  `overlays/Harbors3D.tsx` (needs a harbor variant's height to float its ratio/resource label above
 *  the model, not just a terrain hex's). */
export function modelHeight(variant: TerrainModelVariant): number {
  return TERRAIN_FOOTPRINT * variant.heightRatio;
}

/** Every terrain the user supplied sculpted model(s) for, with per-variant measured height ratios.
 *  `gold` (Seafarers) has no supplied model — `HexTiles.tsx` keeps rendering it as the flat
 *  procedural prism, same fallback path every terrain used before this task (`hasStlCoverage` below
 *  is how callers tell the two paths apart). */
const TERRAIN_MODEL_VARIANTS: Partial<Record<ScenarioTerrain, TerrainModelVariant[]>> = {
  forest: [
    { url: forest1Url, heightRatio: 0.1784 },
    { url: forest2Url, heightRatio: 0.2003 },
    { url: forest3Url, heightRatio: 0.2004 },
  ],
  pasture: [
    { url: pasture1Url, heightRatio: 0.2212 },
    { url: pasture2Url, heightRatio: 0.1566 },
  ],
  mountains: [
    { url: mountains1Url, heightRatio: 0.3708 },
    { url: mountains2Url, heightRatio: 0.3277 },
  ],
  fields: [
    { url: fields1Url, heightRatio: 0.2088 },
    { url: fields2Url, heightRatio: 0.2088 },
  ],
  hills: [
    { url: hills1Url, heightRatio: 0.1906 },
    { url: hills2Url, heightRatio: 0.2574 },
  ],
  desert: [{ url: desert1Url, heightRatio: 0.1038 }],
  sea: [{ url: waterUrl, heightRatio: 0.0984 }],
};

export function hasStlCoverage(terrain: ScenarioTerrain): boolean {
  return terrain in TERRAIN_MODEL_VARIANTS;
}

function terrainVariants(terrain: ScenarioTerrain): TerrainModelVariant[] {
  return TERRAIN_MODEL_VARIANTS[terrain] ?? [];
}

// --- Deterministic per-hex pick (requirement: variant + rotation vary hex-to-hex, but are STABLE
// across re-renders — seeded from the hex id, never `Math.random()`) --------------------------------

/** Integer hash (Wang/Jenkins-style avalanche mix) — small, dependency-free, and well-distributed
 *  enough for this module's tiny input domain (hex ids 0..~60, edge ids 0..~90, or a synthetic
 *  sea-ring seed, see `seaHexRing.ts`). Two different `salt`s off the SAME id produce
 *  uncorrelated-looking outputs (used below to pick variant vs. rotation independently from one hex
 *  id without one silently determining the other). */
function mixHash(seed: number, salt: number): number {
  let x = ((seed | 0) * 2 + salt) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return x >>> 0;
}

/** Deterministically picks one of `variantCount` variants from an integer seed (a hex id, or a
 *  synthetic seed for a sea-ring hex that has no real `HexId`). */
export function pickVariantIndex(seed: number, variantCount: number): number {
  if (variantCount <= 1) return 0;
  return mixHash(seed, 1) % variantCount;
}

/** Deterministically picks one of the 6 hex-symmetric rotation steps (`k` in `hexYaw`) from an
 *  integer seed — independent of `pickVariantIndex`'s pick off the same seed (different salt). */
export function pickRotationStep(seed: number): number {
  return mixHash(seed, 2) % 6;
}

/** The user-confirmed base orientation (T-1505 "User direction": 30° seats every terrain model
 *  flush) plus one of 6 hex-symmetric 60° steps — any `step` in 0..5 still sits flush (the hexagon's
 *  own 6-fold symmetry), so this is purely rotation VARIETY, never a flush/not-flush distinction. */
export function hexYaw(step: number): number {
  return Math.PI / 6 + step * (Math.PI / 3);
}

/** The variant a given hex/seed renders — `undefined` when `terrain` has no STL coverage at all
 *  (caller falls back to the procedural prism; see `hasStlCoverage`). */
export function pickTerrainVariant(terrain: ScenarioTerrain, seed: number): TerrainModelVariant | undefined {
  const variants = terrainVariants(terrain);
  if (variants.length === 0) return undefined;
  return variants[pickVariantIndex(seed, variants.length)];
}

/** The world-Y height of the sculpted model a given hex/seed will render for `terrain` — 0 when
 *  `terrain` has no STL coverage (callers needing a real elevation, e.g. `tileElevation.ts`, fall
 *  back to the flat prism's `TILE_HEIGHT` instead of using this 0 directly). */
export function hexModelHeight(terrain: ScenarioTerrain, seed: number): number {
  const variant = pickTerrainVariant(terrain, seed);
  return variant ? modelHeight(variant) : 0;
}

// --- Harbors (requirement 5): ship (3 variants) or lighthouse, picked per harbor edge --------------

const HARBOR_SHIP_VARIANTS: TerrainModelVariant[] = [
  { url: harborShip1Url, heightRatio: 0.1303 },
  { url: harborShip2Url, heightRatio: 0.1303 },
  { url: harborShip3Url, heightRatio: 0.1971 },
];
const HARBOR_LIGHTHOUSE_VARIANT: TerrainModelVariant = { url: harborLighthouseUrl, heightRatio: 0.2909 };

/** Deterministically picks a harbor's model (mostly ships, an occasional lighthouse for variety) from
 *  its `EdgeId` — stable across renders, same discipline as `pickTerrainVariant`. */
export function pickHarborVariant(edgeId: EdgeId): TerrainModelVariant {
  const useLighthouse = mixHash(edgeId, 3) % 4 === 0; // 1-in-4 — ships are the common case
  if (useLighthouse) return HARBOR_LIGHTHOUSE_VARIANT;
  return HARBOR_SHIP_VARIANTS[mixHash(edgeId, 4) % HARBOR_SHIP_VARIANTS.length]!;
}

/** Single shared `STLLoader` subclass for EVERY model this module loads (terrain, water, harbor
 *  ship/lighthouse) — safe because they all normalize to the exact same `TERRAIN_FOOTPRINT` (see
 *  this module's top doc comment on the shared measured footprint), unlike `stlModels.ts`'s piece
 *  loaders which each need a different target size. A stable module-level class (not constructed per
 *  render) keeps `useLoader`'s `(Proto, url)` cache key stable across renders — same rationale as
 *  `stlModels.ts`'s own loader subclasses and the retired `ForestSTLLoader`. */
export class TerrainSTLLoader extends STLLoader {
  override parse(data: ArrayBuffer | string): BufferGeometry {
    return normalizeStlGeometry(super.parse(data), TERRAIN_FOOTPRINT, 'footprint');
  }
}

// --- T-1505 polish: height-banded vertex colouring (terrains + harbour) ----------------------------
// STL models are single-colour; the user asked for each model's VERTICES to be coloured by their own
// local Y (base at 0, per `normalizeStlGeometry`'s "sit at y=0" convention, up to the model's own
// normalized `modelHeight`) — a BASE colour below a per-terrain threshold blending into a FEATURE
// colour above it, across a small smooth band. Baked ONCE into a `color` `BufferAttribute` on the
// geometry (see `applyHeightBandVertexColors`'s cache-guard below) — the same "mutate the shared
// cached geometry object exactly once" discipline `stlModels.ts`'s `normalizeStlGeometry` already
// uses for shape, just triggered from the mesh component (`HexTiles.tsx`) instead of the loader's
// `parse()` (the ONE shared `TerrainSTLLoader` class serves every terrain, so it has no per-terrain
// palette to reach for at parse-time — the calling mesh component knows `terrain` already).

/** One terrain's (or the harbour model's) base->feature palette. ALL user-tunable — the user will
 *  calibrate these once terrains/harbours actually render on :8080. */
export interface HeightBandPalette {
  /** Colour below the threshold (earth/rock/soil/water at the model's base). CSS colour string. */
  base: string;
  /** Colour above the threshold (canopy/peak/crest/wheat/grass/hull). CSS colour string. */
  feature: string;
  /** Where the base->feature transition CENTERS, as a fraction (0..1) of the model's OWN normalized
   *  height (`modelHeight`/`hexModelHeight` — NOT a fraction of `TERRAIN_FOOTPRINT`). Raise toward 1
   *  to push the feature colour further up the model; lower toward 0 to let it spread further down. */
  thresholdFraction: number;
}

/** Width of the smooth blend band straddling each terrain's threshold, as a fraction of the model's
 *  own height — ONE shared knob (the user asked for "a small blend band" generically, not a
 *  per-terrain width) rather than a per-palette field. 0 would read as a hard edge; raise it for a
 *  softer, more gradual transition. */
export const HEIGHT_BAND_BLEND_FRACTION = 0.08;

/** Per-terrain base/feature palette + threshold — USER-CALIBRATED STARTING VALUES (T-1505 polish).
 *  Every value here is a plain named constant, editable in place: change a `base`/`feature` hex
 *  string or a `thresholdFraction` number and rebuild, no logic elsewhere needs to change. Terrains
 *  with NO entry here (`desert`, `sea`) stay single-tone — `HexTiles.tsx` only enables `vertexColors`
 *  when a palette entry exists, otherwise keeping its existing flat `TILE_FILL` material colour. */
export const TERRAIN_HEIGHT_BAND: Partial<Record<ScenarioTerrain, HeightBandPalette>> = {
  forest: { base: '#6b4a2b', feature: '#2f6b3c', thresholdFraction: 0.35 },
  mountains: { base: '#6f727a', feature: '#e9edf2', thresholdFraction: 0.65 },
  hills: { base: '#7a4a2c', feature: '#b45d33', thresholdFraction: 0.5 },
  fields: { base: '#8a6a2e', feature: '#dfae3c', thresholdFraction: 0.4 },
  pasture: { base: '#6d6a3a', feature: '#7fb05a', thresholdFraction: 0.4 },
};

/** The harbour ship/lighthouse model's own band — kept separate from `TERRAIN_HEIGHT_BAND` (keyed by
 *  `ScenarioTerrain`, and a harbour isn't a terrain) — base = the SEA tint below the waterline
 *  (matching the surrounding water tiles, same intent as `HexTiles.tsx`'s retired flat
 *  `HARBOR_TILE_COLOR`), feature = a wood-hull tint above it. USER-CALIBRATED starting value. */
export const HARBOR_HEIGHT_BAND: HeightBandPalette = { base: SEA, feature: '#8a6a42', thresholdFraction: 0.42 };

/** Smooth (cubic Hermite) 0->1 ramp — used instead of a hard cutoff or a linear ramp so the
 *  base/feature transition reads as a soft blend, not a visible seam. */
function smoothstep01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** `y` (a vertex's local height, base at 0) -> blend weight toward `palette.feature` (0 = pure base,
 *  1 = pure feature) — smoothed across a band of width `blendFraction * modelHeightY` centered at
 *  `palette.thresholdFraction * modelHeightY`. Pure/framework-free (no three.js dependency at all),
 *  so it's unit-testable in isolation from `applyHeightBandVertexColors`'s geometry mutation. A
 *  degenerate `modelHeightY <= 0` (shouldn't happen for a real STL-covered terrain, defensive) reads
 *  as fully base rather than dividing by zero. */
export function heightBandWeight(
  y: number,
  modelHeightY: number,
  thresholdFraction: number,
  blendFraction: number = HEIGHT_BAND_BLEND_FRACTION,
): number {
  if (modelHeightY <= 0) return 0;
  const thresholdY = thresholdFraction * modelHeightY;
  const halfBand = (blendFraction * modelHeightY) / 2;
  if (halfBand <= 0) return y >= thresholdY ? 1 : 0;
  return smoothstep01((y - (thresholdY - halfBand)) / (halfBand * 2));
}

/** Bakes a `color` vertex `BufferAttribute` onto `geometry`, blending `palette.base` -> `palette.
 *  feature` across each vertex's own local Y via `heightBandWeight` — mutates and returns the SAME
 *  geometry object (mirrors `normalizeStlGeometry`'s own convention).
 *
 *  CACHE GUARD (the actual "compute once per shared geometry" mechanism): a no-op if `geometry`
 *  already carries a `color` attribute. Every hex/harbor mesh instance that shares the SAME cached
 *  (terrain, variant) geometry object (`useLoader`'s own cache, keyed by url — T-1505's original
 *  module doc) calls this on every render; only whichever instance mounts FIRST for a given geometry
 *  actually walks its vertices, every other instance (this one on a later render, or a different hex
 *  showing the same variant) sees the attribute already present and returns immediately. */
export function applyHeightBandVertexColors(
  geometry: BufferGeometry,
  modelHeightY: number,
  palette: HeightBandPalette,
): BufferGeometry {
  if (geometry.getAttribute('color')) return geometry;
  // `getAttribute` is typed to return `BufferAttribute | InterleavedBufferAttribute | GLBufferAttribute`
  // for ANY key (three's `BufferGeometry` isn't generically parameterized here) — `STLLoader` always
  // produces a plain `BufferAttribute` position (never interleaved/GL), so this cast is safe; it's
  // what lets `.getY()`/`.count` below type-check at all.
  const position = geometry.getAttribute('position') as BufferAttribute | undefined;
  if (!position) return geometry; // defensive: an empty/degenerate geometry — nothing to colour.

  const base = new Color(palette.base);
  const feature = new Color(palette.feature);
  const blended = new Color();
  const count = position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const weight = heightBandWeight(position.getY(i), modelHeightY, palette.thresholdFraction);
    blended.copy(base).lerp(feature, weight);
    colors[i * 3] = blended.r;
    colors[i * 3 + 1] = blended.g;
    colors[i * 3 + 2] = blended.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}
