// PART B — port markers seated in each harbor's housing (mirrors `numberTokenModels.ts`'s asset/
// loader split from its render component: this module owns the asset URLs + fit-normalization
// logic; `HexTiles.tsx` owns the render component that mounts them as a CHILD of the harbor tile's
// rotation group so they turn with the harbor's own yaw).
//
// 6 marker STLs, one generic (3:1) + one per resource (2:1) — decimated via the same raw -> opt
// pipeline every other print-resolution model in this directory uses
// (`apps/client/scripts/optimize-models.mjs`; `portMarkerWool.stl` was the only one clearly over
// budget, ~76k tris raw -> ~20k after decimation, the other 5 were already light and kept as-is).
import portMarkerGenericUrl from './models/opt/portMarkerGeneric.stl?url';
import portMarkerBrickUrl from './models/opt/portMarkerBrick.stl?url';
import portMarkerLumberUrl from './models/opt/portMarkerLumber.stl?url';
import portMarkerWoolUrl from './models/opt/portMarkerWool.stl?url';
import portMarkerGrainUrl from './models/opt/portMarkerGrain.stl?url';
import portMarkerOreUrl from './models/opt/portMarkerOre.stl?url';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { BufferGeometry } from 'three';
import type { HarborType } from '@hexhaven/shared';
import { HEX_SIZE } from '../board/palette';
import { normalizeStlGeometry } from './stlModels';
import type { HarborVariantId } from './terrainStlModels';

/** `board.harbors`' `HarborType` (`ResourceType | 'generic'`, `@hexhaven/shared`'s `constants.ts`) ->
 *  the marker STL that seats in that harbor's housing. Resource keys already match the marker
 *  filenames 1:1 (`lumber`/`grain` are the shared resource-key names — no separate "wood"/"wheat"
 *  marker exists, so no renaming needed here). */
export const PORT_MARKER_URL: Record<HarborType, string> = {
  generic: portMarkerGenericUrl,
  brick: portMarkerBrickUrl,
  lumber: portMarkerLumberUrl,
  wool: portMarkerWoolUrl,
  grain: portMarkerGrainUrl,
  ore: portMarkerOreUrl,
};

export function portMarkerUrlFor(type: HarborType): string {
  return PORT_MARKER_URL[type];
}

/** Target footprint every port-marker model normalizes to (its largest horizontal extent, same
 *  `'footprint'` fit convention `stlModels.ts` uses for settlement/city) — one shared target since
 *  all 6 markers are meant to seat in the same-sized housing recess on the harbor hull. Deliberately
 *  small relative to `terrainStlModels.ts`'s `TERRAIN_FOOTPRINT` (a marker is a small disc/token
 *  inset into the hull, not a hex-sized tile). USER-TUNABLE alongside `PORT_MARKER_SCALE` below —
 *  this one sets the BASE size before the day-to-day multiplier; `PORT_MARKER_SCALE` is the easier
 *  dial to reach for first (mirrors `constants.ts`'s `TOKEN_SOCKET_SCALE`-vs-sheet-sizing split). */
export const PORT_MARKER_FOOTPRINT = HEX_SIZE * 0.42;

/** Single shared `STLLoader` subclass for every marker — safe because they all normalize to the same
 *  `PORT_MARKER_FOOTPRINT` (same rationale as `terrainStlModels.ts`'s `TerrainSTLLoader`). A stable
 *  module-level class keeps `useLoader`'s `(Proto, url)` cache key stable across renders. */
export class PortMarkerSTLLoader extends STLLoader {
  override parse(data: ArrayBuffer | string): BufferGeometry {
    return normalizeStlGeometry(super.parse(data), PORT_MARKER_FOOTPRINT, 'footprint');
  }
}

/** PART B fit-in-housing tunables — ONE obvious set, all user-calibrated starting guesses (this
 *  sandbox can't render WebGL to seat these visually; the user fits them on :8080). Every marker
 *  uses the SAME three constants: change one here to re-fit every harbor's marker at once.
 *   - `PORT_MARKER_OFFSET`: local position (world units) within the harbor's own rotation group —
 *     {0,0,0} starts the marker at the harbor tile's own origin/rotation-group pivot; raise `y` to
 *     lift it onto the hull's housing, nudge `x`/`z` to slide it fore/aft or side-to-side.
 *   - `PORT_MARKER_YAW`: extra local rotation (radians) ON TOP OF the harbor's own yaw (which the
 *     marker already inherits by being mounted inside the same rotation group) — corrects for the
 *     marker STL's own authored "front" not matching the harbor hull's.
 *   - `PORT_MARKER_SCALE`: extra uniform multiplier on top of `PORT_MARKER_FOOTPRINT`'s normalization
 *     — the day-to-day size dial (mirrors `TOKEN_SOCKET_SCALE`'s role for number-token inserts). */
export const PORT_MARKER_OFFSET = { x: 0.555, y: 7.0, z: 20.0 }; // user-calibrated
export const PORT_MARKER_YAW = -1.5708; // -90° (default; ship3 overridden below)
export const PORT_MARKER_SCALE = 1.6; // user-calibrated

/** Desired WORLD yaw (radians) of each marker's icon — NOT relative to the harbour. `HexTiles.tsx`
 *  counter-rotates out the harbour's own facing so the icon points this fixed world direction on every
 *  harbour (that's what stops "some are 180° off": a seated marker otherwise inherits its harbour's
 *  facing). One shared value works for all — kept per-variant only so the dev panel can fine-tune a
 *  model whose housing sits at an odd angle. Start all at 0 (user re-calibrates one value). */
export const PORT_MARKER_YAW_BY_VARIANT: Record<HarborVariantId, number> = {
  ship1: 0,
  ship2: 0,
  ship3: 0,
  lighthouse: 0,
};
