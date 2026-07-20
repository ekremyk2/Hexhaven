// Shared sizing constants for the WebGL 3D scene (T-1400). Every value here is derived from
// `board/palette.ts`'s `HEX_SIZE` (the same px-per-unit scale `coords.ts` uses) so the 3D scene's
// proportions read consistently with the flat SVG board rather than carrying their own hand-picked
// scale. These are 3D-only (tile thickness/bevel, token size) — the flat SVG board's own former
// `TILE_THICKNESS`/`HEX_INSET` skirt-polygon constants (tuned for the Phase-13 faux-3D tilt, a
// different rendering technique) were retired in T-1404 along with that technique.
import { HEX_SIZE } from '../board/palette';

/** How tall (world Y) a hex tile's prism body is, top face to base. */
export const TILE_HEIGHT = HEX_SIZE * 0.26;

/** The chamfered-edge bevel's size/thickness (world units) — small relative to the tile so it reads
 *  as a soft edge, not a second step. */
export const TILE_BEVEL_SIZE = HEX_SIZE * 0.05;
export const TILE_BEVEL_THICKNESS = HEX_SIZE * 0.04;

/** Number-token disc radius + how far above the tile's top face it floats (clears the bevel). */
export const TOKEN_RADIUS = HEX_SIZE * 0.34;
export const TOKEN_HOVER = HEX_SIZE * 0.06;

/** Sea plane: how far past the island's bounding radius it extends, and how far below the tile
 *  baseline (world Y=0) it sits so the tiles visibly rise above the water. */
export const SEA_MARGIN_FACTOR = 4;
export const SEA_DEPTH = HEX_SIZE * 0.12;
