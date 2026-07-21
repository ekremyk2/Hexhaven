// T-1505 requirement: a one-hex-thick ring of sea hexes surrounding the land island, so coastal
// settlements/roads on the outer rim sit against a sea tile instead of empty table (user: "so the
// roads and settlements in the corner will look good"). Pure/geometric — no react/three imports, same
// discipline as `coords.ts` — computed once per `BoardGeometry` from the SAME axial neighbor deltas
// `packages/shared/src/geometry.ts` used to build the board in the first place (E, W, NE, NW, SE, SW),
// duplicated here rather than imported: `geometry.ts` doesn't export them, and this is the one place
// in `board3d/**` (a client-only package per this task's own "client-only" scope) that needs them.
//
// This ring is PURELY VISUAL FILLER: a synthetic axial (q, r) never becomes a real `HexId`/board hex
// (no vertices/edges/interaction target), it just tells `HexTiles.tsx` where to float an extra water
// tile. Scenarios whose `BoardGeometry` already includes real sea hexes (Seafarers/E&P) don't need
// this — the caller (`HexTiles.tsx`) only renders the ring when the board has NO sea hex at all (see
// that file's `anySeaHex` check); this module itself doesn't know or care which case it's in.
import type { BoardGeometry } from '@hexhaven/shared';

const SQRT3 = Math.sqrt(3);

/** Mirrors `packages/shared/src/geometry.ts`'s own `NEIGHBOR_DELTAS` (E, W, NE, NW, SE, SW) exactly —
 *  see that file's comment for the derivation. Any hex adjacent to a board hex, in one of these 6
 *  directions, that ISN'T itself a board hex is a ring candidate. */
const NEIGHBOR_DELTAS: readonly { q: number; r: number }[] = [
  { q: 1, r: 0 },
  { q: -1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
];

export interface RingHex {
  q: number;
  r: number;
  /** Unit-space (pre-`HEX_SIZE`-scale) center, same formula/units as a real `GeometryHex.x`/`.y`
   *  (`geometry.ts`'s module doc: `x = √3·(q + r/2), y = 1.5·r`) — pass straight into `coords.ts`'s
   *  `hexWorldCenter` exactly like a real hex. */
  x: number;
  y: number;
  /** A stable, hex-id-shaped integer for this synthetic hex — used ONLY as a hash seed
   *  (`terrainStlModels.ts`'s deterministic variant/rotation pick needs SOME stable integer per hex;
   *  a synthetic ring hex has no real `HexId`, so this stands in for one). Not a real `HexId` and
   *  never used as one (no vertices/edges/interaction — see this module's top doc comment). */
  seed: number;
}

function axialKey(q: number, r: number): string {
  return `${q},${r}`;
}

/** A synthetic-but-stable integer per (q, r) — arbitrary beyond "distinct for distinct (q, r) pairs
 *  across any board this app ships" (largest scenario frames span roughly -10..10 in both axes, well
 *  under this offset/multiplier's collision-free range). */
function ringSeed(q: number, r: number): number {
  return (q + 1000) * 2000 + (r + 1000);
}

/** The one-hex-thick ring of sea-hex positions surrounding `geometry`'s land block — every axial
 *  neighbor of every board hex that ISN'T itself a board hex, deduped. Pure function of the geometry
 *  alone (doesn't know about terrain/scenario data); see this module's top doc comment for when a
 *  caller should actually render it. */
export function computeSeaHexRing(geometry: Pick<BoardGeometry, 'hexes'>): RingHex[] {
  const occupied = new Set<string>();
  for (const hex of geometry.hexes) occupied.add(axialKey(hex.q, hex.r));

  const ring = new Map<string, RingHex>();
  for (const hex of geometry.hexes) {
    for (const d of NEIGHBOR_DELTAS) {
      const q = hex.q + d.q;
      const r = hex.r + d.r;
      const key = axialKey(q, r);
      if (occupied.has(key) || ring.has(key)) continue;
      ring.set(key, { q, r, x: SQRT3 * (q + r / 2), y: 1.5 * r, seed: ringSeed(q, r) });
    }
  }
  return [...ring.values()];
}
