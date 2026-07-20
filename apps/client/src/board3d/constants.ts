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

// --- T-1500: tabletop surface ------------------------------------------------------------------
// The wooden table the whole island+sea assembly rests on (`Table.tsx`) — the single biggest lever
// for "a game being played on a real table" instead of floating in a void beyond the sea's own,
// much smaller, margin.

/** How far past the island's bounding radius the tabletop extends — more than double
 *  `SEA_MARGIN_FACTOR` so the wood fills the framed view (default AND zoomed-out via
 *  `OrbitControls.maxDistance`) well past where the sea plane itself ends, leaving no raw
 *  background colour visible behind/around the island at the board's normal viewing distances. */
export const TABLE_MARGIN_FACTOR = 9;

/** Tabletop slab thickness (world Y) — thick enough to read as a solid wooden slab/tray, not a
 *  flat decal, without needing its own beveled-edge geometry (that polish is T-1502's territory). */
export const TABLE_THICKNESS = HEX_SIZE * 0.9;

/** How far below the sea plane's own top surface the tabletop's top sits — the table's footprint
 *  fully underlaps the sea plane's (see `Table.tsx`), so this is a hairline offset purely to avoid
 *  z-fighting where the two coincide, not a visible step: small enough that the sea still reads as
 *  sitting directly on the table at the same "water level," not a stepped-down moat. */
export const TABLE_RIM_GAP = SEA_DEPTH * 0.08;

/** Warm mid-brown wood colour for the tabletop's solid PBR material (T-1500 — a plain solid colour
 *  is the task's explicit scope; a real wood-grain texture map is T-1502's job). A 3D-scene material
 *  colour, not a design token: this module already carries its own ad-hoc hex colours for the same
 *  reason `Board3D.tsx`'s light colours (`0xbfe0ff`, `0xdce8ff`) do — `docs/11-visual-design.md`'s
 *  token system governs the DOM/Tailwind chrome around the canvas, not materials inside the WebGL
 *  scene, which has never gone through that token pipeline (see `board/palette.ts`'s own
 *  `TERRAIN_FILL`/`GOLD` precedent). */
export const TABLE_WOOD_COLOR = 0x8a5a34;

/** How far above the tabletop's own top face the soft `<ContactShadows>` catcher plane floats —
 *  another hairline z-fighting guard (see `TABLE_RIM_GAP`'s note), and how tall a depth range (world
 *  Y) it samples above itself to catch the island block + pieces' silhouette. Generous relative to
 *  `TILE_HEIGHT` so it comfortably covers tiles + standing pieces without needing their exact height
 *  (over-covering just makes the falloff gentler, never breaks the read). */
export const CONTACT_SHADOW_LIFT = SEA_DEPTH * 0.03;
export const CONTACT_SHADOW_DEPTH = HEX_SIZE * 2.2;
