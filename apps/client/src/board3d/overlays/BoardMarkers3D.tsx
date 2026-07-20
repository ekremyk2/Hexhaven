// Island bonus-VP chits (Seafarers S10.6) + T-903 hex pieces (Wizard/Trader/Robin Hood/Banker/
// Poaching) in 3D (T-1403) — the two board markers `board/Pieces.tsx` draws that `Pieces3D.tsx`
// (T-1401) explicitly left out of its own scope ("island chits / hex pieces / C&K-T&B-E&P overlays
// (T-1403)"). Both are flat-on-tile decoration (no standing height, per requirement 1 — a coin lying
// on the island, not a piece standing on it), positioned via `coords.ts` (T-1400), drawn with the
// shared `GlyphMarker3D` billboard (T-1403). Fully public info in both cases (the board/robber
// position discipline `board/Pieces.tsx`'s own `Robber` doc comment cites applies here too), so no
// redaction concern rendering them straight off `PlayerView`.
import { GEOMETRY, type BoardGeometry, type HexId, type HexPieceKindId, type Seat } from '@hexhaven/shared';
import { HEX_SIZE, PLAYER_COLORS } from '../../board/palette';
import { hexWorldCenter } from '../coords';
import { TILE_HEIGHT, TOKEN_HOVER } from '../constants';
import { GlyphMarker3D } from './GlyphMarker3D';
import { ringFanOffset } from './overlayGeometry';

const S = HEX_SIZE;

// Mirrors `board/Pieces.tsx`'s own module-level glyph/color constants exactly (decorative pictograms,
// not i18n text — same discipline as that file's header comment documents).
const CHIT_GLYPH = '★';
const CHIT_FILL = '#e7b526';

const HEX_PIECE_GLYPH: Readonly<Record<HexPieceKindId, string>> = {
  wizard: '★',
  trader: '⚖',
  robinHood: '➹',
  banker: '¤',
  poaching: '⚑',
};
const HEX_PIECE_COLOR: Readonly<Record<HexPieceKindId, string>> = {
  wizard: '#7c3aed',
  trader: '#0891b2',
  robinHood: '#16a34a',
  banker: '#ca8a04',
  poaching: '#dc2626',
};

const CHIT_RADIUS = S * 0.2;
const HEX_PIECE_RADIUS = S * 0.17;
const HEX_PIECE_FAN_RADIUS = S * 0.4;

export interface BoardMarkers3DProps {
  geometry?: BoardGeometry;
  /** Seafarers (T-704): earned small-island bonus chits — from `view.ext.seafarers.islandChits`,
   *  resolved to `{ hex, seat }` by the caller (mirrors `board/Pieces.tsx`'s own `islandChits` prop;
   *  `Game.tsx`'s SVG branch doesn't wire this today either — the resolution from per-seat island-id
   *  lists to a hex needs scenario island-layout data this task doesn't add, see Implementation
   *  notes — so this prop stays supported-but-currently-unfed on BOTH renderers, not a 3D-only gap). */
  islandChits?: { hex: HexId; seat: Seat }[];
  /** T-903 (multi-piece hex framework): every currently active hex piece — from
   *  `view.ext.hexPieces.pieces`, same shape `board/Pieces.tsx`'s `hexPieces` prop takes. */
  hexPieces?: { hex: HexId; kind: HexPieceKindId }[];
}

export function BoardMarkers3D({ geometry = GEOMETRY, islandChits = [], hexPieces = [] }: BoardMarkers3DProps) {
  const hexOf = (id: HexId) => {
    const h = geometry.hexes[id];
    if (!h) throw new Error(`BUG: BoardMarkers3D hex ${id}`);
    return h;
  };

  return (
    <group>
      {islandChits.map(({ hex: hid, seat }, i) => {
        const c = hexWorldCenter(hexOf(hid), TILE_HEIGHT + TOKEN_HOVER);
        return (
          <GlyphMarker3D
            key={`ch${hid}-${i}`}
            position={[c.x, c.y, c.z]}
            radius={CHIT_RADIUS}
            glyph={CHIT_GLYPH}
            fill={CHIT_FILL}
            fillOpacity={1}
            stroke={PLAYER_COLORS[seat]}
            strokeWidth={5}
            textColor="#2b2416"
          />
        );
      })}

      {/* Fanned around the hex center (mirrors `board/Pieces.tsx`'s own `HexPieceMarker` ring — any
          subset of the 5 kinds can coexist on the SAME hex, always starting on the robber's desert
          hex, docs/tasks/phase-9/PICKS.md), clear of the number token/robber at the center. */}
      {hexPieces.map(({ hex: hid, kind }, i) => {
        const sameHex = hexPieces.filter((p) => p.hex === hid);
        const indexInHex = hexPieces.slice(0, i).filter((p) => p.hex === hid).length;
        const c = hexWorldCenter(hexOf(hid), TILE_HEIGHT + TOKEN_HOVER);
        const { dx, dz } = ringFanOffset(indexInHex, sameHex.length, HEX_PIECE_FAN_RADIUS);
        return (
          <GlyphMarker3D
            key={`hx${hid}-${kind}`}
            position={[c.x + dx, c.y, c.z + dz]}
            radius={HEX_PIECE_RADIUS}
            glyph={HEX_PIECE_GLYPH[kind]}
            fill={HEX_PIECE_COLOR[kind]}
            fillOpacity={1}
            textColor="#ffffff"
          />
        );
      })}
    </group>
  );
}
