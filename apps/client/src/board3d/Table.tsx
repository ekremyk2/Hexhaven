// <Table> — the SQUARE wooden tabletop the island rests on (user: "a square table"). Sized off
// `coords.ts`'s `boardWorldExtents` so it scales with every board size. With the sea plane removed,
// the table sits just below the board baseline and the brownish-black background reads as the room
// around it. Colour/size/thickness/roughness are live-tunable via the dev panel's Environment
// section (falling back to the baked `TABLE_*` constants when the panel is unavailable).
import { useMemo } from 'react';
import { DoubleSide } from 'three';
import type { BoardGeometry } from '@hexhaven/shared';
import { boardWorldExtents } from './coords';
import { SEA_DEPTH, TABLE_RIM_GAP, TABLE_ROUGHNESS, TABLE_SQUARE_FACTOR, TABLE_THICKNESS, TABLE_WOOD_COLOR } from './constants';
import { useDevTuningAvailable, useDevTuningStore } from './devTuning';

export function Table({ geometry }: { geometry: Pick<BoardGeometry, 'hexes'> }) {
  const extents = useMemo(() => boardWorldExtents(geometry), [geometry]);
  const tuningAvailable = useDevTuningAvailable();
  const tuning = useDevTuningStore();

  const sizeFactor = tuningAvailable ? tuning.tableSizeFactor : TABLE_SQUARE_FACTOR;
  const thickness = tuningAvailable ? tuning.tableThickness : TABLE_THICKNESS;
  const color = tuningAvailable ? tuning.tableColor : TABLE_WOOD_COLOR;
  const roughness = tuningAvailable ? tuning.tableRoughness : TABLE_ROUGHNESS;

  const side = extents.radius * sizeFactor * 2; // full square edge length
  const topY = -(SEA_DEPTH + TABLE_RIM_GAP);

  return (
    <mesh
      position={[extents.center.x, topY - thickness / 2, extents.center.z]}
      receiveShadow
      userData={{ isTable: true }}
    >
      <boxGeometry args={[side, thickness, side]} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={0.04} side={DoubleSide} />
    </mesh>
  );
}
