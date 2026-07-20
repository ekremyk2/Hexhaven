// Canvas-drawn number-token texture (T-1400 requirement 5). Deliberately NOT drei's `<Text>`
// (troika-three-text): that component fetches its default font/glyph atlas over the network at
// runtime, which would violate the "self-contained/offline, no external HTTP fetches" constraint
// this task also holds `<Environment>` presets to (see `Board3D.tsx`'s lighting comment) — a plain
// 2D canvas, turned into a `THREE.CanvasTexture`, needs no asset at all and gives full control over
// the red-for-6/8 + pip-dot look `board/palette.ts` already defines for the flat SVG board.
import * as THREE from 'three';
import { INK, TOKEN_FACE, TOKEN_RED, TOKEN_RING, isRedNumber, pipCount } from '../board/palette';

/** Mirrors `BoardView.tsx`'s module-level `HIDDEN_TOKEN_GLYPH` — the "?" shown during blind setup
 *  placement (hiddenNumbers) or over a still-hidden E&P/Fog-Islands hex. */
const HIDDEN_GLYPH = '?';

const CANVAS_SIZE = 128;

// Finite key space (11 possible numbers + hidden, x2 for dimmed) — safe to cache for the app's
// lifetime rather than rebuild a canvas every render/frame.
const cache = new Map<string, THREE.CanvasTexture>();

function draw(value: number | null, hidden: boolean, dimmed: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('BUG: numberTexture — 2d canvas context unavailable');

  const cx = CANVAS_SIZE / 2;
  const cy = CANVAS_SIZE / 2;
  const r = CANVAS_SIZE * 0.46;

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.globalAlpha = dimmed ? 0.4 : 1;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = TOKEN_FACE;
  ctx.fill();
  ctx.lineWidth = CANVAS_SIZE * 0.04;
  ctx.strokeStyle = TOKEN_RING;
  ctx.stroke();

  if (hidden || value == null) {
    ctx.fillStyle = INK;
    ctx.font = `700 ${CANVAS_SIZE * 0.5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(HIDDEN_GLYPH, cx, cy);
  } else {
    const red = isRedNumber(value);
    ctx.fillStyle = red ? TOKEN_RED : INK;
    ctx.font = `700 ${CANVAS_SIZE * 0.42}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), cx, cy - CANVAS_SIZE * 0.05);

    const pips = pipCount(value);
    const pipR = CANVAS_SIZE * 0.035;
    const pipGap = CANVAS_SIZE * 0.09;
    const startX = cx - ((pips - 1) * pipGap) / 2;
    ctx.fillStyle = red ? TOKEN_RED : INK;
    for (let i = 0; i < pips; i++) {
      ctx.beginPath();
      ctx.arc(startX + i * pipGap, cy + CANVAS_SIZE * 0.22, pipR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** The (cached) token-face texture for a given value/hidden/dimmed combination. */
export function numberTokenTexture(value: number | null, hidden: boolean, dimmed: boolean): THREE.CanvasTexture {
  const key = `${value ?? 'x'}-${hidden ? 1 : 0}-${dimmed ? 1 : 0}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const texture = draw(value, hidden, dimmed);
  cache.set(key, texture);
  return texture;
}
