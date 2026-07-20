// Generic canvas-drawn "glyph disc" texture (T-1403), extending `numberTexture.ts`'s pattern (a plain
// 2D canvas turned into a `THREE.CanvasTexture` — no drei `<Text>`/troika, no network font fetch, same
// offline/self-contained constraint `Board3D.tsx`'s lighting comment documents) to every FLAT/glyph
// marker this task's overlays need: island chits, T-903 hex pieces, Traders & Barbarians' lake/oasis/
// trade-hex glyphs, camel/barbarian/wagon badges, Explorers & Pirates' harbor-settlement anchor. One
// parameterized drawer instead of N one-off canvas functions.
import * as THREE from 'three';

const CANVAS_SIZE = 128;

// Finite-ish key space (every overlay uses a handful of fixed glyph/color/pip combinations) — safe to
// cache for the app's lifetime, mirroring `numberTexture.ts`'s own cache discipline.
const cache = new Map<string, THREE.CanvasTexture>();

export interface GlyphDiscOptions {
  /** The pictogram/text drawn at the disc's center (an emoji, a badge glyph, a short numeral). */
  glyph: string;
  /** Disc fill color; pass `'none'` to skip the background disc entirely (glyph-only, e.g. a knight's
   *  level pip row drawn under its own body rather than inside a coin). */
  fill: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  textColor?: string;
  fontSize?: number;
  fontWeight?: number;
  /** Extra small pip dots along the bottom (Cities & Knights' knight level, C7.1 — mirrors
   *  `board/palette.ts`'s `pipCount` dots under a number token) — 0 draws none. */
  pips?: number;
  pipColor?: string;
}

type ResolvedOptions = Required<GlyphDiscOptions>;

const DEFAULTS: Omit<ResolvedOptions, 'glyph' | 'fill'> = {
  fillOpacity: 0.6,
  stroke: '#ffffffaa',
  strokeWidth: CANVAS_SIZE * 0.03,
  textColor: '#f7f1e3',
  fontSize: CANVAS_SIZE * 0.48,
  fontWeight: 700,
  pips: 0,
  pipColor: '#f7f1e3',
};

function draw(opts: ResolvedOptions): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('BUG: glyphTexture — 2d canvas context unavailable');

  const cx = CANVAS_SIZE / 2;
  const cy = CANVAS_SIZE / 2;
  const r = CANVAS_SIZE * 0.46;

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  if (opts.fill !== 'none') {
    ctx.globalAlpha = opts.fillOpacity;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = opts.fill;
    ctx.fill();
    if (opts.strokeWidth > 0) {
      ctx.lineWidth = opts.strokeWidth;
      ctx.strokeStyle = opts.stroke;
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = opts.textColor;
  ctx.font = `${opts.fontWeight} ${opts.fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(opts.glyph, cx, cy - (opts.pips > 0 ? CANVAS_SIZE * 0.06 : 0));

  if (opts.pips > 0) {
    const pipR = CANVAS_SIZE * 0.035;
    const pipGap = CANVAS_SIZE * 0.1;
    const startX = cx - ((opts.pips - 1) * pipGap) / 2;
    ctx.fillStyle = opts.pipColor;
    for (let i = 0; i < opts.pips; i++) {
      ctx.beginPath();
      ctx.arc(startX + i * pipGap, cy + CANVAS_SIZE * 0.3, pipR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function cacheKey(opts: ResolvedOptions): string {
  return [
    opts.glyph,
    opts.fill,
    opts.fillOpacity,
    opts.stroke,
    opts.strokeWidth,
    opts.textColor,
    opts.fontSize,
    opts.fontWeight,
    opts.pips,
    opts.pipColor,
  ].join('|');
}

/** The (cached) glyph-disc texture for a given option set. Merges field-by-field with `??` rather
 *  than a blanket object spread: every optional field on `GlyphDiscOptions` is routed through
 *  `GlyphMarker3D`'s own destructured props, which are `undefined` (not simply absent) whenever a
 *  caller doesn't pass them — `{ ...DEFAULTS, ...options }` would let each of those explicit
 *  `undefined`s silently CLOBBER its default (`{ ...{ a: 1 }, ...{ a: undefined } }` is `{ a:
 *  undefined }` in JS, not `{ a: 1 }`), so every un-set option would render with `undefined` instead
 *  of its intended default. */
export function glyphDiscTexture(options: GlyphDiscOptions): THREE.CanvasTexture {
  const resolved: ResolvedOptions = {
    glyph: options.glyph,
    fill: options.fill,
    fillOpacity: options.fillOpacity ?? DEFAULTS.fillOpacity,
    stroke: options.stroke ?? DEFAULTS.stroke,
    strokeWidth: options.strokeWidth ?? DEFAULTS.strokeWidth,
    textColor: options.textColor ?? DEFAULTS.textColor,
    fontSize: options.fontSize ?? DEFAULTS.fontSize,
    fontWeight: options.fontWeight ?? DEFAULTS.fontWeight,
    pips: options.pips ?? DEFAULTS.pips,
    pipColor: options.pipColor ?? DEFAULTS.pipColor,
  };
  const key = cacheKey(resolved);
  const cached = cache.get(key);
  if (cached) return cached;
  const texture = draw(resolved);
  cache.set(key, texture);
  return texture;
}
