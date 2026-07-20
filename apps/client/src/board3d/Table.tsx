// <Table> — the wooden tabletop surface the whole island+sea assembly rests on (T-1500 requirement
// 1: "a game being played on an actual table," not floating in a void). Sized off `coords.ts`'s
// `boardWorldExtents` (same convention `Sea.tsx` already uses for its own margin) so it scales with
// every board size (base 19 -> EXT56 30 -> Seafarers/E&P 37+), rather than a hardcoded footprint.
//
// Positioning: the table's footprint (`TABLE_MARGIN_FACTOR`, constants.ts) is deliberately much
// bigger than `Sea.tsx`'s own `SEA_MARGIN_FACTOR`, and its top surface sits a hairline
// (`TABLE_RIM_GAP`) below the sea plane's — the two footprints fully overlap out to the sea's own
// radius, where the (higher) sea plane occludes the (lower) table entirely; only beyond the sea's
// edge does the table itself become visible, reading as "the sea sits on the table," not a stepped
// moat. `side: DoubleSide` mirrors every other board3d surface's defensive-rendering convention
// (`Board3D.tsx`'s top-of-file note): this task can't be visually verified in this sandbox, so a
// winding-direction slip degrades to "looks odd from below" rather than "silently invisible."
import { useMemo } from 'react';
import { DoubleSide } from 'three';
import type { BoardGeometry } from '@hexhaven/shared';
import { boardWorldExtents } from './coords';
import { SEA_DEPTH, TABLE_MARGIN_FACTOR, TABLE_RIM_GAP, TABLE_THICKNESS, TABLE_WOOD_COLOR } from './constants';

export function Table({ geometry }: { geometry: Pick<BoardGeometry, 'hexes'> }) {
  const extents = useMemo(() => boardWorldExtents(geometry), [geometry]);
  const radius = extents.radius * TABLE_MARGIN_FACTOR;
  const topY = -(SEA_DEPTH + TABLE_RIM_GAP);

  return (
    <mesh
      position={[extents.center.x, topY - TABLE_THICKNESS / 2, extents.center.z]}
      receiveShadow
      userData={{ isTable: true }}
    >
      {/* A slight taper (radiusBottom < radiusTop) is free realism from `cylinderGeometry` itself —
          a real wooden tray/tabletop edge is rarely a perfectly vertical cut. 96 radial segments
          keeps the rim looking round at any camera distance without instancing/LOD complexity the
          task doesn't need for a single always-present mesh. */}
      <cylinderGeometry args={[radius, radius * 0.985, TABLE_THICKNESS, 96]} />
      <meshStandardMaterial color={TABLE_WOOD_COLOR} roughness={0.62} metalness={0.04} side={DoubleSide} />
    </mesh>
  );
}
