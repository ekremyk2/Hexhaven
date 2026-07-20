// Procedural per-terrain surface detail (T-1404 requirement 1: "subtle procedural texture/normal
// detail so terrains read as materials ... not flat colors"). Same discipline as `numberTexture.ts`
// (a plain 2D canvas turned into a `THREE.CanvasTexture`, cached for the app's lifetime) — no network
// fetch, no imported image asset, so it holds the same offline/self-contained constraint the task
// applies to `<Environment>` presets and drei's `<Text>`.
//
// Deliberately NOT a true tangent-space normal map: hand-deriving normal-map encoding without any
// way to visually verify the result risks a silently-wrong (inverted/washed-out) lighting response —
// exactly the failure mode `hexGeometryBuilders.ts`'s own top-of-file note warns about for its
// `Rx(-90°)` transform. A `bumpMap` (a plain grayscale height field — `MeshStandardMaterial` derives
// the perturbed normal from its own luminance gradient) is a much lower-risk way to get the same
// "not flat plastic" read: even a wrong height field only ever makes the bump subtler or stronger,
// never inverts a normal or hides the whole tile. The same grayscale canvas doubles as a
// `roughnessMap`, so the fleck pattern reads as micro-roughness variation too.
//
// Every tile of a given terrain shares ONE canvas (drawn once, cached) rather than a per-tile/
// per-instance texture — `HexTiles.tsx` already instances same-terrain tiles onto one shared
// geometry, so every instance also gets the identical UV-mapped noise. That's a deliberate
// simplification (no tiling/repeat-seam risk to reason about blind) rather than a bug: it still
// reads as "this terrain has surface detail", just not per-tile-unique detail.
import * as THREE from 'three';
import type { ScenarioTerrain } from '@hexhaven/shared';
import { GOLD, TERRAIN_FILL, darken, lighten } from '../board/palette';

const CANVAS_SIZE = 256;

/** Deterministic PRNG (mulberry32) seeded per terrain — the speckle pattern is reproducible (same
 *  look every load/every instance of a terrain) rather than genuinely random, which also makes this
 *  module trivially unit-testable if a future task wants pixel-level assertions. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(terrain: string): number {
  let h = 0;
  for (let i = 0; i < terrain.length; i++) h = (h * 31 + terrain.charCodeAt(i)) | 0;
  return h;
}

interface TerrainDrawResult {
  color: THREE.CanvasTexture;
  /** Grayscale height/roughness field shared by `bumpMap` + `roughnessMap` — see the file header for
   *  why a bump map (not a true normal map) is the deliberate choice here. */
  bump: THREE.CanvasTexture;
}

/** Draws `count` soft-edged blobs of `fill` at `radius` (±`radiusJitter`) scattered over the canvas,
 *  the shared primitive every terrain's speckle pattern below is built from. */
function speckle(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  count: number,
  radius: number,
  radiusJitter: number,
  fill: string,
  alpha: number,
) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill;
  for (let i = 0; i < count; i++) {
    const x = rng() * CANVAS_SIZE;
    const y = rng() * CANVAS_SIZE;
    const r = radius + (rng() - 0.5) * 2 * radiusJitter;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Draws `count` short, slightly-wavy strokes — used for terrains whose real-world texture reads as
 *  grain/streaks (fields, hills, desert, sea) rather than discrete speckles (forest, pasture, gold). */
function streaks(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  count: number,
  length: number,
  stroke: string,
  width: number,
  alpha: number,
) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = rng() * CANVAS_SIZE;
    const y = rng() * CANVAS_SIZE;
    const angle = rng() * Math.PI;
    const len = length * (0.6 + rng() * 0.8);
    const dx = Math.cos(angle) * len;
    const dy = Math.sin(angle) * len * 0.35; // flattened — grain reads as mostly-horizontal
    ctx.beginPath();
    ctx.moveTo(x - dx / 2, y - dy / 2);
    ctx.quadraticCurveTo(x, y - Math.abs(dy) * 0.4, x + dx / 2, y + dy / 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function baseCanvas(fill: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('BUG: terrainTexture — 2d canvas context unavailable');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  return { canvas, ctx };
}

/** Renders both the colour + bump canvases for one terrain's pattern in a single pass (same RNG
 *  stream feeds both, at the same feature positions, so the visible speckle and its bump line up). */
function drawTerrain(terrain: ScenarioTerrain): TerrainDrawResult {
  const base = TERRAIN_FILL[terrain as keyof typeof TERRAIN_FILL] ?? TERRAIN_FILL.desert;
  const rngColor = mulberry32(seedFor(terrain));
  const rngBump = mulberry32(seedFor(terrain)); // identical seed ⇒ identical feature layout

  const colorCanvas = baseCanvas(base);
  const bumpCanvas = baseCanvas('#808080'); // neutral mid-grey = "no relief"

  switch (terrain) {
    case 'forest':
      speckle(colorCanvas.ctx, rngColor, 90, 9, 4, darken(base, 0.35), 0.5);
      speckle(colorCanvas.ctx, rngColor, 40, 6, 3, lighten(base, 0.2), 0.35);
      speckle(bumpCanvas.ctx, rngBump, 90, 9, 4, '#ffffff', 0.4);
      speckle(bumpCanvas.ctx, rngBump, 40, 6, 3, '#404040', 0.3);
      break;
    case 'pasture':
      speckle(colorCanvas.ctx, rngColor, 70, 7, 3, darken(base, 0.25), 0.35);
      speckle(colorCanvas.ctx, rngColor, 50, 4, 2, lighten(base, 0.3), 0.3);
      speckle(bumpCanvas.ctx, rngBump, 70, 7, 3, '#c0c0c0', 0.3);
      break;
    case 'fields':
      streaks(colorCanvas.ctx, rngColor, 60, 26, darken(base, 0.3), 3, 0.4);
      streaks(colorCanvas.ctx, rngColor, 30, 20, lighten(base, 0.35), 2, 0.3);
      streaks(bumpCanvas.ctx, rngBump, 60, 26, '#d8d8d8', 3, 0.35);
      break;
    case 'hills':
      speckle(colorCanvas.ctx, rngColor, 26, 22, 9, darken(base, 0.28), 0.4);
      speckle(colorCanvas.ctx, rngColor, 20, 12, 5, lighten(base, 0.22), 0.3);
      speckle(bumpCanvas.ctx, rngBump, 26, 22, 9, '#e8e8e8', 0.5);
      break;
    case 'mountains':
      speckle(colorCanvas.ctx, rngColor, 18, 30, 12, darken(base, 0.32), 0.45);
      speckle(colorCanvas.ctx, rngColor, 30, 10, 4, lighten(base, 0.3), 0.4);
      speckle(bumpCanvas.ctx, rngBump, 18, 30, 12, '#ffffff', 0.6);
      speckle(bumpCanvas.ctx, rngBump, 30, 10, 4, '#303030', 0.4);
      break;
    case 'desert':
      streaks(colorCanvas.ctx, rngColor, 45, 30, darken(base, 0.15), 4, 0.3);
      streaks(colorCanvas.ctx, rngColor, 25, 22, lighten(base, 0.2), 3, 0.25);
      streaks(bumpCanvas.ctx, rngBump, 45, 30, '#c8c8c8', 4, 0.3);
      break;
    case 'gold':
      speckle(colorCanvas.ctx, rngColor, 34, 5, 2.5, '#fff6d0', 0.55);
      speckle(colorCanvas.ctx, rngColor, 24, 3, 1.5, GOLD, 0.4);
      speckle(bumpCanvas.ctx, rngBump, 34, 5, 2.5, '#ffffff', 0.55);
      break;
    case 'sea':
      streaks(colorCanvas.ctx, rngColor, 40, 34, lighten(base, 0.18), 2.5, 0.3);
      streaks(bumpCanvas.ctx, rngBump, 40, 34, '#c0c0c0', 2.5, 0.3);
      break;
    default:
      break;
  }

  const color = new THREE.CanvasTexture(colorCanvas.canvas);
  color.colorSpace = THREE.SRGBColorSpace;
  color.needsUpdate = true;
  const bump = new THREE.CanvasTexture(bumpCanvas.canvas);
  bump.needsUpdate = true;

  // `Sea.tsx`'s plane is far larger (and a different shape) than a single hex tile's UV space, so
  // ITS ONLY consumer of the 'sea' entry tiles the texture across the water via `repeat` (set by
  // `Sea.tsx` itself, off the plane's own real-world size) — needs wrapping enabled here, unlike
  // every land terrain (drawn once per instanced tile, never repeated).
  if (terrain === 'sea') {
    for (const t of [color, bump]) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
    }
  }

  return { color, bump };
}

const cache = new Map<string, TerrainDrawResult>();

/** The (cached) colour + bump texture pair for a terrain — `HexTiles.tsx` wires `color` as the
 *  material's `map` and `bump` as both `bumpMap` and `roughnessMap` (see this file's header for why
 *  a shared grayscale field is a deliberately lower-risk stand-in for a true normal map). */
export function terrainSurfaceTextures(terrain: ScenarioTerrain): TerrainDrawResult {
  const cached = cache.get(terrain);
  if (cached) return cached;
  const drawn = drawTerrain(terrain);
  cache.set(terrain, drawn);
  return drawn;
}
