// DEV-ONLY live tuning state for the harbour ship/lighthouse model's base orientation + the port
// marker's fit inside the harbour housing — the sandbox this repo is developed against cannot render
// WebGL (see `terrainStlModels.ts`/`portMarkerModels.ts`'s "USER-CALIBRATED starting guesses" doc
// comments), so blind constant-guessing wasn't converging. This lets the USER drag sliders on a live
// board and read the resulting numbers back to hard-code into `HARBOR_VARIANT_YAW_OFFSET`
// (terrainStlModels.ts) / `PORT_MARKER_OFFSET`/`PORT_MARKER_YAW`/`PORT_MARKER_SCALE`
// (portMarkerModels.ts).
//
// Deliberately a SEPARATE, isolated zustand store — NOT a slice of `store/index.ts`'s `RootState`
// (that combined store's own doc comment: "Components only ever import from here [...] never from an
// individual slice file [...] directly" — this is throwaway calibration scratch state with no server
// sync, no persistence beyond localStorage's visibility flag below, and no business belonging next to
// lobby/game/chat state).
//
// Visibility gate: `import.meta.env.DEV` is true under Vite's dev server (`pnpm --filter
// @hexhaven/client dev`, :5173) but FALSE in the built prod bundle the user actually runs day-to-day
// (:8080) — where this panel is most useful, since that's the build with the real assets/base path.
// So the panel ALSO shows behind a `?tune=1` URL flag (which persists itself to a localStorage key so
// it survives a plain reload without retyping the query string) or that localStorage key set
// directly (`?tune=0` clears it again).
import { useState } from 'react';
import { create } from 'zustand';
import { HEX_SIZE } from '../board/palette';
import {
  HARBOR_HEIGHT_BAND,
  HARBOR_VARIANT_YAW_OFFSET,
  HEIGHT_BAND_BLEND_FRACTION,
  TERRAIN_HEIGHT_BAND,
  type HarborVariantId,
} from './terrainStlModels';
import { PORT_MARKER_OFFSET, PORT_MARKER_SCALE, PORT_MARKER_YAW_BY_VARIANT } from './portMarkerModels';

/** The 4 harbor model variants the yaw-override sliders cover, in the order the panel renders them —
 *  re-exported so `DevTuningPanel.tsx`/`HexTiles.tsx` don't need their own copy of this list. */
export const HARBOR_VARIANT_IDS: readonly HarborVariantId[] = ['ship1', 'ship2', 'ship3', 'lighthouse'];

/** The 5 terrains `TERRAIN_HEIGHT_BAND` (`terrainStlModels.ts`) carries a palette for, in the order
 *  the panel's "Colour thresholds" section renders their sliders — re-exported so
 *  `DevTuningPanel.tsx`/`HexTiles.tsx` don't need their own copy of this list, and so it can't drift
 *  from `TERRAIN_HEIGHT_BAND`'s actual keys. */
export const BAND_TERRAIN_IDS = ['forest', 'mountains', 'hills', 'fields', 'pasture'] as const;

export type BandTerrainId = (typeof BAND_TERRAIN_IDS)[number];

/** True when `terrain` is one of `BAND_TERRAIN_IDS` — i.e. it has a live threshold slider in
 *  `tuning.terrainThreshold`. Callers (`HexTiles.tsx`'s `TerrainStlMesh`) use this to narrow a plain
 *  `ScenarioTerrain` before indexing into that record. */
export function isBandTerrainId(terrain: string): terrain is BandTerrainId {
  return (BAND_TERRAIN_IDS as readonly string[]).includes(terrain);
}

const TUNE_STORAGE_KEY = 'hexhaven:tune';
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

export function degToRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

export function radToDeg(rad: number): number {
  return rad * RAD_TO_DEG;
}

/** True when the dev tuning panel should render. Guards every `window`/`location` access so it's
 *  safe to call from a non-browser context (SSR/vitest's default jsdom-less unit tests import this
 *  module transitively via `HexTiles.tsx` — defensive, not currently exercised by those, but cheap
 *  insurance). `localStorage` can also throw in a locked-down/private-browsing context; treated the
 *  same as "not available" rather than crashing the board over a calibration nicety. */
export function isDevTuningAvailable(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('tune')) {
      const on = params.get('tune') !== '0';
      window.localStorage.setItem(TUNE_STORAGE_KEY, on ? '1' : '0');
      return on;
    }
    return window.localStorage.getItem(TUNE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Memoizes `isDevTuningAvailable()` for the lifetime of the component (computed once on mount) —
 *  every board3d component that needs to know "is tuning live right now" calls this instead of
 *  re-parsing `location.search`/re-reading `localStorage` on every render. */
export function useDevTuningAvailable(): boolean {
  const [available] = useState(() => isDevTuningAvailable());
  return available;
}

/** Starting values for the PER-VARIANT yaw-override sliders (task requirement 5: "start each slider
 *  at the CURRENT constant value so nothing changes until dragged") — each of the 4 harbor model
 *  variants (`ship1`/`ship2`/`ship3`/`lighthouse`) starts at its own `HARBOR_VARIANT_YAW_OFFSET[id]`
 *  value, since each model's authored "front" faces a different way and a single shared value can't
 *  orient all of them at once (the bug this per-variant override replaces). The override itself
 *  starts DISABLED (`yawOverrideEnabled: false`) so nothing changes until the user opts in, even
 *  though these default numeric values aren't 0. */
const DEFAULT_VARIANT_YAW_DEG: Record<HarborVariantId, number> = {
  ship1: radToDeg(HARBOR_VARIANT_YAW_OFFSET.ship1),
  ship2: radToDeg(HARBOR_VARIANT_YAW_OFFSET.ship2),
  ship3: radToDeg(HARBOR_VARIANT_YAW_OFFSET.ship3),
  lighthouse: radToDeg(HARBOR_VARIANT_YAW_OFFSET.lighthouse),
};

/** Starting values for the PER-VARIANT port-marker fit — mirrors `DEFAULT_VARIANT_YAW_DEG` above 1:1,
 *  but for the marker's offset/yaw/scale instead of the ship's own yaw. Each of the 4 harbor model
 *  variants starts at the SAME global `PORT_MARKER_OFFSET`/`PORT_MARKER_YAW`/`PORT_MARKER_SCALE`
 *  value (the one shared constant every harbor used before this override existed) — so nothing
 *  changes for ANY harbor until a specific variant's slider is dragged, same "start at the current
 *  constant" discipline as every other section of this store. A single global marker fit seats the
 *  marker correctly on SOME harbors but not others because each variant's model has its ship/
 *  lighthouse housing authored at a different local spot — this per-variant record lets each be
 *  tuned independently, same rationale as the per-variant yaw override above. */
const DEFAULT_VARIANT_MARKER_OFFSET: Record<HarborVariantId, { x: number; y: number; z: number }> = {
  ship1: { ...PORT_MARKER_OFFSET },
  ship2: { ...PORT_MARKER_OFFSET },
  ship3: { ...PORT_MARKER_OFFSET },
  lighthouse: { ...PORT_MARKER_OFFSET },
};

const DEFAULT_VARIANT_MARKER_YAW_DEG: Record<HarborVariantId, number> = {
  ship1: radToDeg(PORT_MARKER_YAW_BY_VARIANT.ship1),
  ship2: radToDeg(PORT_MARKER_YAW_BY_VARIANT.ship2),
  ship3: radToDeg(PORT_MARKER_YAW_BY_VARIANT.ship3),
  lighthouse: radToDeg(PORT_MARKER_YAW_BY_VARIANT.lighthouse),
};

const DEFAULT_VARIANT_MARKER_SCALE: Record<HarborVariantId, number> = {
  ship1: PORT_MARKER_SCALE,
  ship2: PORT_MARKER_SCALE,
  ship3: PORT_MARKER_SCALE,
  lighthouse: PORT_MARKER_SCALE,
};

/** Starting values for the LIVE colour-threshold sliders ("Colour thresholds" section) — each terrain
 *  slider starts at its own `TERRAIN_HEIGHT_BAND[id].thresholdFraction` (non-null: `BAND_TERRAIN_IDS`
 *  is exactly `TERRAIN_HEIGHT_BAND`'s populated keys, see that constant's definition). Same "start at
 *  the current constant so nothing changes until dragged" discipline as `DEFAULT_VARIANT_YAW_DEG`. */
const DEFAULT_TERRAIN_THRESHOLD: Record<BandTerrainId, number> = {
  forest: TERRAIN_HEIGHT_BAND.forest!.thresholdFraction,
  mountains: TERRAIN_HEIGHT_BAND.mountains!.thresholdFraction,
  hills: TERRAIN_HEIGHT_BAND.hills!.thresholdFraction,
  fields: TERRAIN_HEIGHT_BAND.fields!.thresholdFraction,
  pasture: TERRAIN_HEIGHT_BAND.pasture!.thresholdFraction,
};

export interface DevTuningValues {
  // 1: harbour ship/lighthouse model base orientation + scale — applied to EVERY harbour model
  // BEFORE its per-tile placement yaw (`harbor.yaw`, from `harborPlacement.ts`). The likely real fix
  // for a model lying flat / on the wrong up-axis, which no yaw offset alone can correct.
  harborBaseRotXDeg: number;
  harborBaseRotYDeg: number;
  harborBaseRotZDeg: number;
  harborBaseScale: number;
  // 2: PER-VARIANT override for `HARBOR_VARIANT_YAW_OFFSET` — one yaw (degrees) per model variant
  // (`ship1`/`ship2`/`ship3`/`lighthouse`), gated by a single enable checkbox. Each model's authored
  // "front" faces a different way, so a single global yaw offset can only ever fix one variant while
  // breaking the others — this record lets each be tuned independently.
  yawOverrideEnabled: boolean;
  variantYawDeg: Record<HarborVariantId, number>;
  // 3: port marker fit — PER-VARIANT (mirrors `variantYawDeg` above 1:1), keyed by `HarborVariantId`.
  // Each variant's model has its housing authored at a different local spot, so a single global
  // offset/yaw/scale can only ever seat the marker correctly on some harbors — see
  // `DEFAULT_VARIANT_MARKER_OFFSET`'s doc comment above. Read LIVE (no separate enable checkbox, same
  // as section 4 below) whenever the tuning panel is available — `HexTiles.tsx`'s `PortMarker3D` falls
  // back to the global `PORT_MARKER_*` constants (`portMarkerModels.ts`) when tuning is unavailable,
  // reproducing the exact production values unchanged.
  markerOffset: Record<HarborVariantId, { x: number; y: number; z: number }>;
  markerYawDeg: Record<HarborVariantId, number>;
  markerScale: Record<HarborVariantId, number>;
  // 4: LIVE height-band colour-threshold overrides — mirrors `TERRAIN_HEIGHT_BAND`'s per-terrain
  // `thresholdFraction` (`terrainStlModels.ts`), `HARBOR_HEIGHT_BAND.thresholdFraction`, and the
  // shared `HEIGHT_BAND_BLEND_FRACTION` 1:1. Unlike sections 1-3 above, `HexTiles.tsx` reads these
  // LIVE (no separate enable checkbox) whenever the tuning panel itself is available
  // (`useDevTuningAvailable()`) — dragging a slider here re-bakes the affected shared geometry's
  // vertex colours immediately (see `applyHeightBandVertexColors`'s `force` option).
  terrainThreshold: Record<BandTerrainId, number>;
  harborThreshold: number;
  blendFraction: number;
}

export interface DevTuningState extends DevTuningValues {
  set: (patch: Partial<DevTuningValues>) => void;
  reset: () => void;
}

/** Every slider's starting value — each one equals the corresponding hardcoded constant (or, for the
 *  two toggle-gated fields, a neutral/no-op starting point), so nothing visually changes until the
 *  user actually drags something (task requirement 5). */
export const DEV_TUNING_DEFAULTS: DevTuningValues = {
  harborBaseRotXDeg: 0,
  harborBaseRotYDeg: 0,
  harborBaseRotZDeg: 0,
  harborBaseScale: 1,
  yawOverrideEnabled: false,
  variantYawDeg: { ...DEFAULT_VARIANT_YAW_DEG },
  markerOffset: {
    ship1: { ...DEFAULT_VARIANT_MARKER_OFFSET.ship1 },
    ship2: { ...DEFAULT_VARIANT_MARKER_OFFSET.ship2 },
    ship3: { ...DEFAULT_VARIANT_MARKER_OFFSET.ship3 },
    lighthouse: { ...DEFAULT_VARIANT_MARKER_OFFSET.lighthouse },
  },
  markerYawDeg: { ...DEFAULT_VARIANT_MARKER_YAW_DEG },
  markerScale: { ...DEFAULT_VARIANT_MARKER_SCALE },
  terrainThreshold: { ...DEFAULT_TERRAIN_THRESHOLD },
  harborThreshold: HARBOR_HEIGHT_BAND.thresholdFraction,
  blendFraction: HEIGHT_BAND_BLEND_FRACTION,
};

export const useDevTuningStore = create<DevTuningState>((set) => ({
  ...DEV_TUNING_DEFAULTS,
  set: (patch) => set(patch),
  reset: () => set({ ...DEV_TUNING_DEFAULTS }),
}));

/** Slider range for the three marker offset axes (task requirement 5: "offsets roughly -HEX_SIZE..
 *  HEX_SIZE") — re-exported so the panel component doesn't need its own import of `board/palette.ts`. */
export const MARKER_OFFSET_RANGE = HEX_SIZE;
