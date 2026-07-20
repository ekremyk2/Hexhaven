// Presentational themed-piece renderers (T-907). `ThemedRobber` mirrors the render style of
// `board/Pieces.tsx`'s internal Robber (matte silhouette, elliptical shadow, shared `piece-shadow`
// SVG filter, pixel-space `x`/`y` props) so a themed robber drops into the same board SVG without
// visual mismatch — only the active theme's `accent` and `robberArt` change what gets drawn.
// `ThemedPieceLabel`/`useThemedPieceLabel` resolve a piece kind's themed display name via the
// `themes` i18n namespace. Everything here is pure/props-driven: zero engine or rule logic, and
// nothing reads or writes any game state — a caller decides which `themeId` is active.

import { useTranslation } from 'react-i18next';
import { GEOMETRY, type BoardGeometry, type HexId } from '@hexhaven/shared';
import { HEX_SIZE } from '../board/palette';
import { THEMES, themedPieceLabelKey, type RobberArtId, type ThemedPieceKind, type ThemeId } from './themes';

const S = HEX_SIZE;
const px = (n: number) => n * S;

export interface ThemedRobberProps {
  themeId: ThemeId;
  /** Pixel-space coordinates (same convention as `board/Pieces.tsx`'s Robber) — use
   *  `themedRobberPosition` below to resolve these from a `HexId` + the board geometry. */
  x: number;
  y: number;
  /** Optional: tags the rendered group with `data-hex-id`, mirroring `board/Pieces.tsx`'s Robber
   *  (useful for e2e/board-fingerprint assertions the same way that one is). */
  hexId?: HexId;
}

/** The board robber, reskinned per `themeId`. Purely a `<g>` of SVG shapes at `x`/`y` — no
 *  positioning/animation logic (that stays in `board/Pieces.tsx`, which owns the live board and can
 *  wrap this in its own hop/placement handling if a later task wires themes into the live board). */
export function ThemedRobber({ themeId, x, y, hexId }: ThemedRobberProps) {
  const theme = THEMES[themeId];
  const s = S * 0.34;
  return (
    <g
      filter="url(#piece-shadow)"
      opacity={0.95}
      data-testid="themed-robber"
      data-theme-id={themeId}
      data-robber-art={theme.robberArt}
      {...(hexId != null ? { 'data-hex-id': hexId } : {})}
    >
      <ellipse cx={x} cy={y + s * 0.9} rx={s * 0.7} ry={s * 0.25} fill="#00000033" />
      <RobberArt art={theme.robberArt} x={x} y={y} s={s} accent={theme.accent} />
    </g>
  );
}

/** Pure geometry helper (mirrors `board/Pieces.tsx`'s `robberHopOffset`'s convention): resolves a
 *  `HexId` to the pixel coords `ThemedRobber` expects, for a caller that only has the hex id. */
export function themedRobberPosition(hex: HexId, geometry: BoardGeometry = GEOMETRY): { x: number; y: number } {
  const h = geometry.hexes[hex];
  if (!h) throw new Error(`BUG: hex ${hex}`);
  return { x: px(h.x), y: px(h.y) };
}

/** The base charcoal-pawn silhouette every theme's robber starts from (identical to
 *  `board/Pieces.tsx`'s Robber body) — `classicPawn` draws exactly this; the other variants layer
 *  their reskin on top of the same body so the piece keeps a consistent footprint on the hex.
 *  Exported so `board/Pieces.tsx`'s live-board `Robber` can reuse the exact same body path. */
export function pawnBody(x: number, y: number, s: number): string {
  return `M ${x - s * 0.55} ${y + s} Q ${x - s * 0.7} ${y - s * 0.2} ${x} ${y - s * 0.4} Q ${x + s * 0.7} ${y - s * 0.2} ${x + s * 0.55} ${y + s} Z`;
}

/** Exported so `board/Pieces.tsx`'s live-board `Robber` can render the SAME per-theme art inside
 *  its own hop-animation wrapper, rather than duplicating the SVG per theme. */
export function RobberArt({ art, x, y, s, accent }: { art: RobberArtId; x: number; y: number; s: number; accent: string }) {
  const body = pawnBody(x, y, s);

  if (art === 'piratePawn') {
    // Same silhouette as classic, plus a tricorn hat (accent-trimmed brim) and an eyepatch dot so it
    // reads as a buccaneer, not a recolored robber.
    return (
      <>
        <path d={body} fill="#31302c" stroke="#000" strokeWidth={1} />
        <circle cx={x} cy={y - s * 0.55} r={s * 0.42} fill="#31302c" stroke="#000" strokeWidth={1} />
        <path
          d={`M ${x - s * 0.5} ${y - s * 0.75} Q ${x} ${y - s * 1.15} ${x + s * 0.5} ${y - s * 0.75} Q ${x} ${y - s * 0.55} ${x - s * 0.5} ${y - s * 0.75} Z`}
          fill="#12100c"
          stroke={accent}
          strokeWidth={1.5}
        />
        <circle cx={x - s * 0.12} cy={y - s * 0.55} r={s * 0.1} fill="#12100c" />
      </>
    );
  }

  if (art === 'scarecrowPawn') {
    // A straw-colored body, crossed-post "arms" instead of the pawn's rounded shoulders, and a wide
    // straw hat with a gold hatband — evokes a field scarecrow rather than a person.
    return (
      <>
        <path d={body} fill="#7a6a44" stroke="#000" strokeWidth={1} />
        <line
          x1={x - s * 0.65}
          y1={y + s * 0.1}
          x2={x + s * 0.65}
          y2={y + s * 0.1}
          stroke="#5a4c2f"
          strokeWidth={s * 0.18}
          strokeLinecap="round"
        />
        <circle cx={x} cy={y - s * 0.55} r={s * 0.42} fill="#e3d5ae" stroke="#000" strokeWidth={1} />
        <ellipse cx={x} cy={y - s * 0.78} rx={s * 0.62} ry={s * 0.16} fill="#dfae3c" stroke={accent} strokeWidth={1.5} />
      </>
    );
  }

  // classicPawn: identical to board/Pieces.tsx's Robber — no reskin.
  return (
    <>
      <path d={body} fill="#31302c" stroke="#000" strokeWidth={1} />
      <circle cx={x} cy={y - s * 0.55} r={s * 0.42} fill="#31302c" stroke="#000" strokeWidth={1} />
    </>
  );
}

export interface ThemedPieceLabelProps {
  themeId: ThemeId;
  kind: ThemedPieceKind;
}

/** The theme's display name for a piece kind — e.g. "Buccaneer" instead of "Robber" under the
 *  Pirate's Cove theme. Renders as a bare `<span>` so a caller can drop it into a tooltip, legend,
 *  or log line; use `useThemedPieceLabel` instead when a plain string (not an element) is needed. */
export function ThemedPieceLabel({ themeId, kind }: ThemedPieceLabelProps) {
  const label = useThemedPieceLabel(themeId, kind);
  return <span data-testid={`themed-label-${kind}`}>{label}</span>;
}

/** Non-JSX counterpart to `ThemedPieceLabel`, for callers that need the plain string (aria-labels,
 *  window titles, log text) rather than a rendered element. */
export function useThemedPieceLabel(themeId: ThemeId, kind: ThemedPieceKind): string {
  const { t } = useTranslation('themes');
  return t(themedPieceLabelKey(themeId, kind));
}
