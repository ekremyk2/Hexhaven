// StatTile primitive (visual-cohesion pass): the shared "glyph + value (+ small label)" chip used
// for resource/commodity/count readouts (bank remaining, hand counts, HUD tallies) — replacing the
// ad-hoc `<span className="inline-flex items-center gap-1">` markup that had drifted slightly
// different between `hud/BankPanel.tsx`, `hud/Scoreboard.tsx`, and `citiesKnights/CitiesKnightsHud.tsx`.
import type { ReactNode } from 'react';

export interface StatTileProps {
  icon: ReactNode;
  /** The accessible, translated content (a count or "N resource" string) — never the glyph alone. */
  children: ReactNode;
  /** Visually de-emphasizes the value (e.g. a bank resource below the shortage threshold uses the
   *  danger color instead — callers pass that via `valueClassName`). */
  valueClassName?: string;
  className?: string;
  'data-testid'?: string;
}

export function StatTile({ icon, children, valueClassName, className, ...rest }: StatTileProps) {
  return (
    <span className={['inline-flex items-center gap-1', className].filter(Boolean).join(' ')} {...rest}>
      <span aria-hidden="true" className="text-14 leading-none">
        {icon}
      </span>
      <span className={['font-ui text-12 font-semibold text-ink', valueClassName].filter(Boolean).join(' ')}>
        {children}
      </span>
    </span>
  );
}
