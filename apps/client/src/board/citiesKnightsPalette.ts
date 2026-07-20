// Cities & Knights render constants (T-805, docs/rules/cities-knights-rules.md C3/C4/C9).
// docs/11-visual-design.md predates C&K and has no dedicated token section for tracks/commodities/
// walls yet (docs/tasks/phase-8/README-cities-knights-plan.md's PM checklist item 3 — "Extend
// docs/11" — is still open). Per docs/05 §8 ("no ad-hoc hex"), every color below REUSES an existing
// docs/11 §1 token from `./palette.ts` (mirrored the same way that file mirrors theme/tokens.css)
// rather than inventing new hex — see the per-constant comments for which token and why. PM: once
// docs/11 gets its own C&K section, swap these to whatever it specifies.

import type { Commodity, ImprovementTrack } from '@hexhaven/shared';
import { TERRAIN_FILL } from './palette';

/** C4.1 track colors ("Trade (yellow) ← cloth; Politics (blue) ← coin; Science (green) ← paper").
 *  trade → `--accent-gold` (existing yellow/gold token); politics → `--seat-1` (the only blue token
 *  in the palette — reused rather than declaring a new one; this DOES coincide with seat 1's own
 *  color, flagged in the T-805 report as a follow-up for the docs/11 extension); science → terrain
 *  forest green (thematically apt: paper's source terrain, C3.2). */
export const TRACK_COLOR: Record<ImprovementTrack, string> = {
  trade: '#c9a227',
  politics: '#1e5fb4',
  science: TERRAIN_FILL.forest,
};

/** C3.1 commodity colors, called out explicitly in the rules text: "paper (green), cloth (yellow/
 *  gold), coin (grey)" — note `coin` is grey here even though its track (politics) is blue; the
 *  rules distinguish a commodity's own color from its track's badge color. Reuses `TERRAIN_FILL`
 *  tokens tied to each commodity's producing terrain (C3.2: forest→paper, mountains→coin) plus the
 *  shared gold accent for cloth. */
export const COMMODITY_COLOR: Record<Commodity, string> = {
  paper: TERRAIN_FILL.forest,
  cloth: '#c9a227',
  coin: TERRAIN_FILL.mountains,
};

/** Which track each commodity buys into (C4.1) — paper→science, cloth→trade, coin→politics. */
export const COMMODITY_TRACK: Record<Commodity, ImprovementTrack> = {
  paper: 'science',
  cloth: 'trade',
  coin: 'politics',
};

/** A knight's "black & white side" (C7.1 physical piece flip) when inactive: reuses `--ink-soft`,
 *  the palette's existing muted ink tone, so the body reads as desaturated/off while the owner's
 *  seat color still shows on the outline + badge (double-coding ownership even when inactive). */
export const KNIGHT_INACTIVE_FILL = '#6b5f47';

/** City wall (C9): a stone-grey ring, reusing the mountains terrain grey (no dedicated wall token
 *  in docs/11 yet) rather than a player color — walls are a fortification, not owner-identity art
 *  (ownership is already carried by the city above it). */
export const WALL_FILL = TERRAIN_FILL.mountains;
export const WALL_STROKE = '#5a5c61';

/** Barbarian-track "attack imminent" tone (last step before resolution): reuses `--danger-solid`'s
 *  hex (the palette has no local copy of this token, so it's mirrored here the same way
 *  `board/palette.ts` mirrors `theme/tokens.css` elsewhere in this module). */
export const BARBARIAN_ALERT = '#8c2a1f';
