// Meter primitive (visual-cohesion pass, docs/11 §1 tokens only): a compact segmented-pip level
// display — the shared shape behind every "level 0..max" track in the client (city-improvement
// tracks today; any future N-step track can reuse this instead of hand-rolling pips again).
// Extracted from `board/CommodityIcon.tsx`'s `ImprovementTrackDisplay`, which now composes this
// instead of drawing its own pip row, so there is exactly one meter recipe in the app.
import type { ReactNode } from 'react';

export interface MeterProps {
  /** Current level, clamped into `[0, max]`. */
  value: number;
  /** Total segments (docs/11 has no fixed scale for this — C&K's improvement tracks are 0-5). */
  max: number;
  /** CSS color for filled segments; empty segments render as a hollow outline in the same color. */
  color: string;
  /** Segment size in px (a bit larger than the default for touch-friendly standalone use). */
  size?: number;
  /** Optional trailing content (e.g. "3/5") — kept as a prop instead of always rendering the
   *  fraction so callers that already show the number elsewhere don't duplicate it. */
  trailing?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

export function Meter({ value, max, color, size = 10, trailing, className, ...rest }: MeterProps) {
  const clamped = Math.max(0, Math.min(value, max));
  return (
    <span className={['inline-flex items-center gap-1.5', className].filter(Boolean).join(' ')} {...rest}>
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            className="inline-block rounded-full border"
            style={{
              width: size,
              height: size,
              backgroundColor: i < clamped ? color : 'transparent',
              borderColor: color,
            }}
          />
        ))}
      </span>
      {trailing != null ? <span className="tabular-nums text-ink-soft">{trailing}</span> : null}
    </span>
  );
}
