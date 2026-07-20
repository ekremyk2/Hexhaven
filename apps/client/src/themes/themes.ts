// Cosmetic theme registry (T-907, docs/tasks/phase-9/PICKS.md rank #1 "Cosmetic themes"). A theme
// is PURELY presentational: alternate display names + (for the robber) alternate SVG art. Zero rule
// effect — nothing here is consulted by `packages/engine`; it only changes what `ThemedPieces.tsx`
// draws and which i18n key a caller looks up for a piece's name.
//
// Deliberately NOT a `ModifierId` (packages/engine/src/modules/modifiers): that union feeds
// `resolveModules`/`RuleModule` and the compatibility matrix, both of which exist to gate actual
// RULE behavior. A theme changes nothing the engine can see, so it is threaded as a plain
// client-side selection instead — see this task's report for the PM wiring recommendation.

/** A shipped cosmetic theme id. Add a new one here + an entry in `THEMES` below + a same-named
 *  `theme.<id>`/`piece.<id>` block in `i18n/{en,tr}/themes.json` (key-parity guard enforces both
 *  languages stay in sync). */
export type ThemeId = 'classic' | 'pirates' | 'harvest';

export const THEME_IDS: readonly ThemeId[] = ['classic', 'pirates', 'harvest'];

/** The theme every game starts with absent an explicit choice — the vanilla look, i.e. no reskin
 *  at all (labels and art match the base game exactly). */
export const DEFAULT_THEME_ID: ThemeId = 'classic';

/** Which piece kinds carry a themed LABEL. Roads/settlements/cities keep their base geometry in
 *  every theme (only the name changes); the robber is the one piece whose ART also changes per
 *  theme (docs/tasks/phase-9/PICKS.md: "robber + pieces with alternate art + labels"). */
export type ThemedPieceKind = 'robber' | 'settlement' | 'city' | 'road';

/** Which silhouette `ThemedPieces.tsx`'s `ThemedRobber` draws. `classicPawn` is the same
 *  matte-charcoal-pawn silhouette as the base game's `board/Pieces.tsx` Robber — the `classic`
 *  theme reuses it verbatim (no reskin). */
export type RobberArtId = 'classicPawn' | 'piratePawn' | 'scarecrowPawn';

export interface ThemeDefinition {
  id: ThemeId;
  /** i18n key (in the `themes` namespace) for the theme's own display name, e.g. for a theme picker. */
  nameKey: string;
  /** i18n key for the theme's one-line description. */
  descriptionKey: string;
  /** Accent color drawn from docs/11 §1 tokens (never an ad-hoc hex) — trims the robber's
   *  hat/hatband so the reskin reads as intentional art, not just a recolor. */
  accent: string;
  robberArt: RobberArtId;
  /** i18n key per piece kind (`piece.<id>.<kind>` in the `themes` namespace). */
  labelKeys: Record<ThemedPieceKind, string>;
}

// docs/11 §1 tokens, mirrored here the same way `board/citiesKnightsPalette.ts` mirrors them into
// its own module rather than importing CSS vars into SVG fills: `--accent: #b3541e` (terracotta),
// `--accent-gold: #c9a227`.
const ACCENT_TERRACOTTA = '#b3541e';
const ACCENT_GOLD = '#c9a227';

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  classic: {
    id: 'classic',
    nameKey: 'theme.classic.name',
    descriptionKey: 'theme.classic.description',
    accent: ACCENT_TERRACOTTA,
    robberArt: 'classicPawn',
    labelKeys: {
      robber: 'piece.classic.robber',
      settlement: 'piece.classic.settlement',
      city: 'piece.classic.city',
      road: 'piece.classic.road',
    },
  },
  pirates: {
    id: 'pirates',
    nameKey: 'theme.pirates.name',
    descriptionKey: 'theme.pirates.description',
    accent: ACCENT_GOLD,
    robberArt: 'piratePawn',
    labelKeys: {
      robber: 'piece.pirates.robber',
      settlement: 'piece.pirates.settlement',
      city: 'piece.pirates.city',
      road: 'piece.pirates.road',
    },
  },
  harvest: {
    id: 'harvest',
    nameKey: 'theme.harvest.name',
    descriptionKey: 'theme.harvest.description',
    accent: ACCENT_GOLD,
    robberArt: 'scarecrowPawn',
    labelKeys: {
      robber: 'piece.harvest.robber',
      settlement: 'piece.harvest.settlement',
      city: 'piece.harvest.city',
      road: 'piece.harvest.road',
    },
  },
};

export function themeDefinition(themeId: ThemeId): ThemeDefinition {
  return THEMES[themeId];
}

/** i18n key for `kind`'s display name under `themeId` — the one lookup a caller needs:
 *  `t('themes:' + themedPieceLabelKey(themeId, 'robber'))` (namespace prefix per the caller's own
 *  `useTranslation` setup; see `ThemedPieces.tsx`'s `ThemedPieceLabel` for the concrete usage). */
export function themedPieceLabelKey(themeId: ThemeId, kind: ThemedPieceKind): string {
  return THEMES[themeId].labelKeys[kind];
}
