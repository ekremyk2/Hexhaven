// Contrast math (WCAG 2.1 relative luminance / contrast ratio, §1.4.3 / §1.4.11) + a tiny CSS
// custom-property parser, so a11y.test.ts can assert against the *actual* values in tokens.css
// rather than a hand-copied duplicate (docs/11 §7 — no silent drift from the token file).

/** Parses `--name: value;` declarations out of a `:root { ... }` block. Good enough for the flat,
 * single-value declarations tokens.css uses (no `var()`-in-`var()` chains, no media queries). */
export function parseCssCustomProperties(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const name = match[1];
    const value = match[2];
    if (name && value) out.set(name.trim(), value.trim());
  }
  return out;
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) {
    throw new Error(`BUG: "${hex}" is not a #rrggbb color`);
  }
  return [r, g, b];
}

/** Relative luminance of a `#rrggbb` color (WCAG 2.1 §1.4.3 formula). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio between two `#rrggbb` colors, always >= 1 (order doesn't matter). */
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Minimum ratios per WCAG 2.1: normal text 4.5:1, large text (>=24px, or >=18.66px bold) 3:1,
 * non-text UI components/focus indicators (§1.4.11) 3:1. */
export const MIN_CONTRAST_TEXT = 4.5;
export const MIN_CONTRAST_LARGE_TEXT = 3;
export const MIN_CONTRAST_UI = 3;
