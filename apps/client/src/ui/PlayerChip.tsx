// PlayerChip primitive (T-307 requirement 4): the canonical seat-identity component — color +
// shape badge, colorblind-safe double-coding (docs/11 §4). Shape glyphs come from board/palette.ts
// (the existing seat-identity source of truth also used by the board/piece SVGs — T-302/T-303 own
// that file, this just consumes it rather than re-declaring seat glyphs).
//
// Seat *colors* are applied via the `bg-seat-N`/`text-*` Tailwind utilities (theme/tokens.css ->
// tailwind.config.js), not inline hex, so "no raw hex outside tokens.css" holds for this file even
// though the six seat colors are dynamic per-seat (Tailwind needs literal class strings to detect
// them at build time — hence the explicit maps below rather than a templated `bg-seat-${seat}`).
import type { Seat } from '@hexhaven/shared';
import { PLAYER_BADGES } from '../board/palette';

const SEAT_BG_CLASS: Record<Seat, string> = {
  0: 'bg-seat-0',
  1: 'bg-seat-1',
  2: 'bg-seat-2',
  3: 'bg-seat-3',
  4: 'bg-seat-4',
  5: 'bg-seat-5',
};

// Mirrors board/palette.ts's contrastInk(): seat2 (near-white) reads with dark ink, every other
// seat gets the light cream ink. Seat colors are theme-independent, so these use the STABLE inks
// (--ink-ondark / --ink-onlight) rather than --panel/--ink, which flip in dark mode and would
// otherwise invert the label right off its (unchanged) seat color.
const SEAT_TEXT_CLASS: Record<Seat, string> = {
  0: 'text-ink-ondark',
  1: 'text-ink-ondark',
  2: 'text-ink-onlight',
  3: 'text-ink-ondark',
  4: 'text-ink-ondark',
  5: 'text-ink-ondark',
};

export interface PlayerChipProps {
  seat: Seat;
  /** Display name — plain data from the game/lobby, not a UI string, so no i18n key here. */
  name: string;
  /** Highlights the chip as the active turn (docs/11 §5 "Turn change" glow). */
  active?: boolean;
}

export function PlayerChip({ seat, name, active }: PlayerChipProps) {
  return (
    <span
      // "hexhaven-turn-glow" (theme/motion.css) is a plain CSS *transition* on box-shadow — since the
      // ring above is itself a box-shadow utility, toggling `active` crossfades it in/out over
      // 250ms (docs/11 §5 "Turn change: active panel glow crossfade") with no JS retrigger needed;
      // `@media (prefers-reduced-motion: reduce)` collapses it to an instant swap.
      className={[
        'hexhaven-turn-glow inline-flex items-center gap-2 rounded-full px-3 py-1 font-ui text-14 font-semibold shadow-soft',
        SEAT_BG_CLASS[seat],
        SEAT_TEXT_CLASS[seat],
        active ? 'ring-2 ring-accent-gold ring-offset-2 ring-offset-panel' : '',
      ].join(' ')}
    >
      <span aria-hidden="true" className="text-16 leading-none">
        {PLAYER_BADGES[seat]}
      </span>
      <span>{name}</span>
    </span>
  );
}
