// DieFace (Priority 3 UI overhaul): a reusable SVG pip-face die — replaces every numeral-based
// dice display (this file's caller `DicePanel.tsx`'s persistent HUD dice, and `DiceRollOverlay.tsx`'s
// center-screen tumble) with real 1-6 pip layouts instead of a printed digit. Pure/presentational:
// no store access, no i18n copy of its own (an aria-label, if any, is the caller's responsibility —
// this renders `aria-hidden` since every current caller already carries its own accessible text).
export interface DieFaceProps {
  /** 1-6; `null` renders a blank (unrolled) die face. */
  value: number | null;
  /** Pixel size of the die's square bounding box (both width and height). */
  size?: number;
  className?: string;
}

// Standard pip layouts on a 0-100 viewBox, using the classic thirds grid (25/50/75).
const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [28, 22],
    [72, 22],
    [28, 50],
    [72, 50],
    [28, 78],
    [72, 78],
  ],
};

export function DieFace({ value, size = 32, className }: DieFaceProps) {
  const pips = value != null ? (PIP_LAYOUTS[value] ?? []) : [];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      <rect x={4} y={4} width={92} height={92} rx={18} fill="var(--panel)" stroke="var(--panel-edge)" strokeWidth={4} />
      {/* Bevel highlight (docs/11 §1's "2 strokes: light top-left, dark bottom-right") so the die
          reads as a physical piece rather than a flat sticker. */}
      <rect x={4} y={4} width={92} height={92} rx={18} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={2} />
      {pips.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={9} fill="var(--ink)" />
      ))}
    </svg>
  );
}
