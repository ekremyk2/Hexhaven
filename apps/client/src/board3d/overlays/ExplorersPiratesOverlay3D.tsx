// Explorers & Pirates board overlays in 3D (T-1403), the WebGL counterpart of
// `board/ExplorersPiratesPieces.tsx`. E&P's ships reuse `Pieces3D`'s own `ships` prop already (the
// same hull+sail mesh Seafarers draws — `Game.tsx` merges both lists, mirroring the SVG board's own
// precedent); this file owns only the one piece with no base-game analogue: the harbor settlement
// (§EP4.2, "harbor settlements REPLACE cities" — E&P has no cities at all). Renders nothing outside a
// live E&P game (`harborSettlements` empty).
import { GEOMETRY, type BoardGeometry, type Seat, type VertexId } from '@hexhaven/shared';
import { HEX_SIZE, PLAYER_COLORS, contrastInk } from '../../board/palette';
import { SettlementBody } from '../PieceBodies';
import { vertexWorldPosition } from '../coords';
import { TILE_HEIGHT } from '../constants';
import { GlyphMarker3D } from './GlyphMarker3D';

const S = HEX_SIZE;

// Decorative glyph (not i18n text — mirrors `ExplorersPiratesPieces.tsx`'s own `ANCHOR_GLYPH`
// convention; always paired with a translated count/label elsewhere in the HUD).
const ANCHOR_GLYPH = '⚓';

// `SettlementBody` (PieceBodies.tsx) doesn't export its internal wall/roof height constants — this
// mirrors their combined magnitude (`wallH + roofH` there, `S * 0.22 + S * 0.17`) so the anchor badge
// floats just above the roof peak rather than guessing a height blind.
const SETTLEMENT_TOTAL_HEIGHT = S * 0.39;
const ANCHOR_RADIUS = S * 0.16;

export interface ExplorersPiratesOverlay3DProps {
  geometry?: BoardGeometry;
  /** Harbor settlements (§EP4.2), flattened — `{ vertex, seat }` (mirrors `epHelpers.ts`'s
   *  `epHarborSettlementsFlattened`), same shape the SVG `<ExplorersPiratesPieces>` takes. */
  harborSettlements?: { vertex: VertexId; seat: Seat }[];
}

export function ExplorersPiratesOverlay3D({
  geometry = GEOMETRY,
  harborSettlements = [],
}: ExplorersPiratesOverlay3DProps) {
  const vertexOf = (id: VertexId) => {
    const v = geometry.vertices[id];
    if (!v) throw new Error(`BUG: ExplorersPiratesOverlay3D vertex ${id}`);
    return v;
  };

  return (
    <group>
      {harborSettlements.map(({ vertex: vid, seat }, i) => {
        const p = vertexWorldPosition(vertexOf(vid), TILE_HEIGHT);
        return <HarborSettlement3D key={`hs${vid}-${i}`} position={[p.x, p.y, p.z]} vertex={vid} seat={seat} />;
      })}
    </group>
  );
}

/** A harbor settlement — the same standing house `PieceBodies.tsx`'s `SettlementBody` draws for a
 *  base settlement (T-1401 material/shape parity, "still a settlement-tier building"), topped with a
 *  gold anchor badge instead of a bare roof peak — visually distinct from both a plain settlement (no
 *  gold badge) and a base city (no second tower), mirroring `ExplorersPiratesPieces.tsx`'s
 *  `HarborSettlement`. */
function HarborSettlement3D({
  position,
  vertex,
  seat,
}: {
  position: readonly [number, number, number];
  vertex: VertexId;
  seat: Seat;
}) {
  const [x, y, z] = position;
  const color = PLAYER_COLORS[seat];
  return (
    <group userData={{ isHarborSettlement: true, vertex, seat }}>
      <mesh position={[x, y + 0.001, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => undefined}>
        <circleGeometry args={[S * 0.32, 16]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <group position={[x, y, z]}>
        <SettlementBody color={color} />
      </group>
      <GlyphMarker3D
        position={[x, y + SETTLEMENT_TOTAL_HEIGHT + ANCHOR_RADIUS * 0.8, z]}
        radius={ANCHOR_RADIUS}
        glyph={ANCHOR_GLYPH}
        fill="#c9a227"
        fillOpacity={0.95}
        textColor={contrastInk(seat)}
      />
    </group>
  );
}
