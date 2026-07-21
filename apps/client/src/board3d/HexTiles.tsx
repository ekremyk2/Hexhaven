// The island's hex tiles as real 3D meshes (T-1400 requirement 4; T-1505 generalizes this to the
// user's sculpted terrain/water STL models). Terrains WITH a supplied STL model (hills/forest/
// pasture/fields/mountains/desert/sea — see `terrainStlModels.ts`) render that model, one mesh per
// hex (deterministic per-hex variant + rotation, below); terrains WITHOUT one (`gold`, Seafarers) keep
// the original procedural beveled-prism `InstancedMesh` path (one draw call per terrain, unaffected by
// this task). Sea hexes used to be skipped entirely (the big ocean plane read as "the sea"); T-1505
// requirement 3 gives ON-BOARD sea hexes (Seafarers/E&P) their own `water` tile, and requirement
// "sea-hex ring" synthesizes a one-hex ring of `water` tiles around a LAND-ONLY board (base game) so
// coastal pieces don't sit against bare table — see `seaHexRing.ts`.
//
// T-1505 REWORK (user correction): harbors are SEA-HEX TILES, not separate props floating off the
// coast (the original pass's `overlays/Harbors3D.tsx`, now retired) — a sea tile that carries a
// harbor renders a ship/lighthouse model INSTEAD of plain water. `harborPlacement.ts`'s
// `computeHarborTiles` names which real hex or synthetic ring hex each `board.harbors` edge lands on
// (plus the island-facing yaw); this module just swaps THAT specific tile's render for
// `HarborStlTile` in the two loops below, same fallback/Suspense discipline as every other STL tile.
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useLoader } from '@react-three/fiber';
import { DoubleSide, InstancedMesh, Matrix4, type BufferGeometry } from 'three';
import type { BoardGeometry, GameState, HarborType, HexId, ScenarioTerrain } from '@hexhaven/shared';
import { RESOURCE_GLYPH } from '../hud/constants';
import { SEA, TERRAIN_FILL, TOKEN_FACE } from '../board/palette';
import { TOKEN_RADIUS } from './constants';
import { hexWorldCenter, type WorldVec3 } from './coords';
import { buildHexPrismGeometry } from './hexGeometryBuilders';
import { degToRad, HARBOR_VARIANT_IDS, isBandTerrainId, useDevTuningAvailable, useDevTuningStore } from './devTuning';
import { computeHarborTiles, type HarborTile } from './harborPlacement';
import { GlyphMarker3D } from './overlays/GlyphMarker3D';
import {
  PORT_MARKER_OFFSET,
  PORT_MARKER_SCALE,
  PORT_MARKER_YAW_BY_VARIANT,
  portMarkerUrlFor,
  PortMarkerSTLLoader,
} from './portMarkerModels';
import { computeSeaHexRing, type RingHex } from './seaHexRing';
import {
  applyHeightBandVertexColors,
  HARBOR_HEIGHT_BAND,
  hasStlCoverage,
  hexYaw,
  modelHeight,
  pickRotationStep,
  pickTerrainVariant,
  TERRAIN_HEIGHT_BAND,
  TerrainSTLLoader,
  type HarborVariantId,
} from './terrainStlModels';
import { terrainSurfaceTextures } from './terrainTexture';

type BoardState = GameState['board'];

/** Per-terrain PBR-ish tuning so tiles read as ground/rock/water rather than flat plastic
 *  (requirement 4). Roughness/metalness are the values three.js needs that a 2D fill color never
 *  carried. Non-STL terrains (`gold` + the fallback) still use `terrainTexture.ts`'s procedural
 *  canvas for their actual colour (T-1404); STL terrains (incl. `sea`, added T-1505) use a flat
 *  single colour instead — `TILE_FILL` below — per the user's "single colour, no multicolour" ask. */
const TERRAIN_MATERIAL: Record<string, { roughness: number; metalness: number; bumpScale: number }> = {
  hills: { roughness: 0.92, metalness: 0.04, bumpScale: 0.6 },
  forest: { roughness: 0.88, metalness: 0.02, bumpScale: 0.7 },
  pasture: { roughness: 0.82, metalness: 0.02, bumpScale: 0.5 },
  fields: { roughness: 0.78, metalness: 0.03, bumpScale: 0.5 },
  mountains: { roughness: 0.55, metalness: 0.2, bumpScale: 0.9 },
  desert: { roughness: 0.95, metalness: 0.0, bumpScale: 0.4 },
  gold: { roughness: 0.3, metalness: 0.6, bumpScale: 0.3 },
  sea: { roughness: 0.25, metalness: 0.15, bumpScale: 0.3 },
};

const FALLBACK_MATERIAL = TERRAIN_MATERIAL.desert!;

/** Flat single-colour fill for STL tiles (user: no multicolour) — reuses the existing terrain palette
 *  (`board/palette.ts`'s `TERRAIN_FILL`) plus `SEA` for the one STL-covered terrain that isn't in that
 *  record (`sea` was previously never given its own tile mesh at all — the big ocean plane stood in
 *  for it — so `TERRAIN_FILL` never needed a `sea` entry until T-1505's water tiles). */
const TILE_FILL: Partial<Record<ScenarioTerrain, string>> = { ...TERRAIN_FILL, sea: SEA };

/** `MeshStandardMaterial.color` MULTIPLIES its `vertexColors` (three.js semantics) — a banded tile
 *  (`TERRAIN_HEIGHT_BAND`/`HARBOR_HEIGHT_BAND` below) must use this neutral white so the baked
 *  base/feature colours show true, instead of the flat `TILE_FILL` tint muddying them. Terrains with
 *  NO band entry keep using their own `TILE_FILL` colour as before (no vertex colours enabled). */
const VERTEX_COLOR_NEUTRAL = '#ffffff';

export interface HexTilesProps {
  board: BoardState;
  geometry: BoardGeometry;
  /** Seafarers scenario terrain override — same contract as `BoardView`'s `hexTerrain` prop. */
  hexTerrain?: readonly ScenarioTerrain[];
}

export function HexTiles({ board, geometry, hexTerrain }: HexTilesProps) {
  const tileGeometry = useMemo(() => buildHexPrismGeometry(geometry), [geometry]);

  // Split every board hex into "procedural instanced prism" (no STL coverage: gold, or a missing
  // tile) vs. "sculpted STL tile" (everything else, incl. sea — T-1505), and note whether the board
  // has ANY real sea hex at all (gates the synthetic sea-ring below).
  const { proceduralByTerrain, stlHexes, anySeaHex } = useMemo(() => {
    const proceduralByTerrain = new Map<string, Matrix4[]>();
    const stlHexes: { id: HexId; center: WorldVec3; terrain: ScenarioTerrain }[] = [];
    let anySeaHex = false;
    for (const hex of geometry.hexes) {
      const tile = board.hexes[hex.id];
      if (!tile) continue;
      const terrain: ScenarioTerrain = hexTerrain?.[hex.id] ?? tile.terrain;
      if (terrain === 'sea') anySeaHex = true;
      if (hasStlCoverage(terrain)) {
        stlHexes.push({ id: hex.id, center: hexWorldCenter(hex), terrain });
        continue;
      }
      const center = hexWorldCenter(hex);
      const matrix = new Matrix4().makeTranslation(center.x, center.y, center.z);
      const list = proceduralByTerrain.get(terrain);
      if (list) list.push(matrix);
      else proceduralByTerrain.set(terrain, [matrix]);
    }
    return { proceduralByTerrain, stlHexes, anySeaHex };
  }, [board, geometry, hexTerrain]);

  // Sea-hex ring (T-1505): only for a board with NO real sea hex anywhere (the base game / any
  // land-only scenario) — Seafarers/E&P already carry real sea hexes in `geometry` (handled above,
  // as ordinary `stlHexes` entries), so they don't need synthetic filler.
  const seaRing = useMemo<RingHex[]>(() => (anySeaHex ? [] : computeSeaHexRing(geometry)), [geometry, anySeaHex]);

  // DEV-TUNING (board3d/devTuning.ts) requirement 2: a live PER-VARIANT override for
  // `HARBOR_VARIANT_YAW_OFFSET` (one yaw per `HarborVariantId` — `ship1`/`ship2`/`ship3`/
  // `lighthouse`), gated on the panel actually being available (DEV, or `?tune=1`/localStorage on a
  // prod build) AND the override toggle itself — `undefined` (the default, and ALWAYS in a normal
  // production render) reproduces `computeHarborTiles`'s original behavior exactly. Rebuilt fresh
  // whenever the store's `variantYawDeg` changes so dragging one variant's slider re-renders only
  // that variant's harbours (the other 3 ids' offsets are unchanged, so their tiles' computed `yaw`
  // is unchanged too).
  const tuningAvailable = useDevTuningAvailable();
  const tuning = useDevTuningStore();
  const variantYawOffsetOverride = useMemo<Partial<Record<HarborVariantId, number>> | undefined>(() => {
    if (!tuningAvailable || !tuning.yawOverrideEnabled) return undefined;
    const entries = HARBOR_VARIANT_IDS.map((id) => [id, degToRad(tuning.variantYawDeg[id])] as const);
    return Object.fromEntries(entries) as Record<HarborVariantId, number>;
  }, [tuningAvailable, tuning.yawOverrideEnabled, tuning.variantYawDeg]);

  // T-1505 rework: which sea tile (real hex or ring hex) each `board.harbors` edge lands on, keyed
  // for O(1) lookup in the two render loops below (a hex id, or a ring's `q,r` key — a real HexId and
  // a ring position never collide since the ring is only ever populated with positions that ARE NOT
  // real board hexes, see `seaHexRing.ts`).
  const { harborByHexId, harborByRingKey } = useMemo(() => {
    const tiles = computeHarborTiles(board, geometry, hexTerrain, seaRing, variantYawOffsetOverride);
    const harborByHexId = new Map<HexId, HarborTile>();
    const harborByRingKey = new Map<string, HarborTile>();
    for (const tile of tiles) {
      if (tile.target.kind === 'hex') harborByHexId.set(tile.target.hexId, tile);
      else harborByRingKey.set(`${tile.target.q},${tile.target.r}`, tile);
    }
    return { harborByHexId, harborByRingKey };
  }, [board, geometry, hexTerrain, seaRing, variantYawOffsetOverride]);

  return (
    <group>
      {[...proceduralByTerrain.entries()].map(([terrain, matrices]) => (
        <TerrainInstancedTiles key={terrain} terrain={terrain} matrices={matrices} geometry={tileGeometry} />
      ))}
      {stlHexes.map(({ id, center, terrain }) => {
        const harbor = terrain === 'sea' ? harborByHexId.get(id) : undefined;
        if (harbor) {
          return <HarborStlTile key={`t${id}`} harbor={harbor} center={center} fallbackGeometry={tileGeometry} />;
        }
        return <TerrainStlTile key={`t${id}`} terrain={terrain} seed={id} center={center} fallbackGeometry={tileGeometry} />;
      })}
      {seaRing.map((ring) => {
        const harbor = harborByRingKey.get(`${ring.q},${ring.r}`);
        const center = hexWorldCenter(ring);
        if (harbor) {
          return <HarborStlTile key={`ring${ring.q},${ring.r}`} harbor={harbor} center={center} fallbackGeometry={tileGeometry} />;
        }
        return (
          <TerrainStlTile
            key={`ring${ring.q},${ring.r}`}
            terrain="sea"
            seed={ring.seed}
            center={center}
            fallbackGeometry={tileGeometry}
          />
        );
      })}
    </group>
  );
}

function TerrainInstancedTiles({
  terrain,
  matrices,
  geometry,
}: {
  terrain: string;
  matrices: Matrix4[];
  geometry: BufferGeometry;
}) {
  const meshRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);

  const material = TERRAIN_MATERIAL[terrain] ?? FALLBACK_MATERIAL;
  const textures = useMemo(
    () => terrainSurfaceTextures(terrain as ScenarioTerrain),
    [terrain],
  );

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, matrices.length]}
      castShadow
      receiveShadow
      userData={{ isHexTile: true }}
    >
      <meshStandardMaterial
        map={textures.color}
        bumpMap={textures.bump}
        bumpScale={material.bumpScale}
        roughnessMap={textures.bump}
        roughness={material.roughness}
        metalness={material.metalness}
        side={DoubleSide}
      />
    </instancedMesh>
  );
}

// --- T-1505: sculpted STL terrain/water tile, generalizing the retired forest-only SPIKE -----------
// (`forestStlModel.ts`) to every terrain with a supplied model. Single-colour `MeshStandardMaterial`
// (`TILE_FILL`, not the procedural canvas texture the instanced prism uses) per the user's "single
// colour, no multicolour" ask. `useLoader` + `<Suspense>` is this module's LAZY-LOAD mechanism
// (requirement: "so first paint isn't blocked") — the fallback (the same flat procedural prism every
// non-STL terrain renders) shows immediately while the STL fetches/parses in the background, exactly
// the retired spike's own approach, just no longer forest-only.

/** Catches the error `useLoader` re-throws on a failed load (`useLoader` needs an error boundary
 *  ABOVE it — a `Suspense` alone only catches the pending promise, mirrors `StlPieceModels.tsx`'s own
 *  `StlFallbackBoundary` and the retired spike's `ForestFallbackBoundary`). Falls back to the ordinary
 *  procedural prism so a tile never goes invisible if its STL fails to load. */
class TerrainFallbackBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function TerrainFallbackMesh({ terrain, geometry }: { terrain: ScenarioTerrain; geometry: BufferGeometry }) {
  const material = TERRAIN_MATERIAL[terrain] ?? FALLBACK_MATERIAL;
  return (
    <mesh castShadow receiveShadow geometry={geometry}>
      <meshStandardMaterial
        color={TILE_FILL[terrain] ?? TERRAIN_FILL.desert}
        roughness={material.roughness}
        metalness={material.metalness}
        side={DoubleSide}
      />
    </mesh>
  );
}

function TerrainStlMesh({
  terrain,
  url,
  modelHeightY,
}: {
  terrain: ScenarioTerrain;
  url: string;
  /** The model's own normalized height (`modelHeight(variant)`) — the band's `thresholdFraction` is
   *  relative to THIS, not `TERRAIN_FOOTPRINT`. */
  modelHeightY: number;
}) {
  const geometry = useLoader(TerrainSTLLoader, url);
  const band = TERRAIN_HEIGHT_BAND[terrain];
  // Production bake-once (UNCHANGED): idempotent past the first call for this shared geometry object
  // — see the cache-guard doc on `applyHeightBandVertexColors` itself. Runs every render, same as
  // before this task; the guard (no `force`) makes every call after the first a no-op.
  if (band) applyHeightBandVertexColors(geometry, modelHeightY, band);

  // DEV-TUNING (board3d/devTuning.ts) "Colour thresholds" section: LIVE re-bake, gated on the panel
  // being available at all (no separate enable toggle, unlike sections 1/2 above) — dragging this
  // terrain's threshold slider or the shared blend slider recomputes + REPLACES the shared geometry's
  // baked `color` attribute via `force: true`, overriding whatever the bake-once call above wrote.
  // `undefined` (tuning unavailable, or `terrain` has no threshold slider) skips the effect entirely,
  // so a normal production render never runs this — the geometry keeps exactly what the bake-once call
  // wrote and this effect never fires.
  const tuningAvailable = useDevTuningAvailable();
  const tuning = useDevTuningStore();
  const liveThreshold = isBandTerrainId(terrain) ? tuning.terrainThreshold[terrain] : undefined;
  const liveBlend = tuning.blendFraction;
  useEffect(() => {
    if (!tuningAvailable || !band || liveThreshold === undefined) return;
    applyHeightBandVertexColors(
      geometry,
      modelHeightY,
      { ...band, thresholdFraction: liveThreshold },
      { blendFraction: liveBlend, force: true },
    );
  }, [tuningAvailable, geometry, band, modelHeightY, liveThreshold, liveBlend]);

  const material = TERRAIN_MATERIAL[terrain] ?? FALLBACK_MATERIAL;
  return (
    <mesh castShadow receiveShadow geometry={geometry}>
      <meshStandardMaterial
        color={band ? VERTEX_COLOR_NEUTRAL : (TILE_FILL[terrain] ?? TERRAIN_FILL.desert)}
        vertexColors={!!band}
        roughness={material.roughness}
        metalness={material.metalness}
        side={DoubleSide}
      />
    </mesh>
  );
}

/** One sculpted terrain/water hex — `seed` picks its model variant + rotation deterministically
 *  (`terrainStlModels.ts`'s `pickTerrainVariant`/`pickRotationStep`: the real `HexId` for a board hex,
 *  or a synthetic-but-stable seed for a sea-ring filler hex, see `seaHexRing.ts`). Positioned at the
 *  hex's world center, base at y=0 (`normalizeStlGeometry`'s "sit at y=0" convention). */
function TerrainStlTile({
  terrain,
  seed,
  center,
  fallbackGeometry,
}: {
  terrain: ScenarioTerrain;
  seed: number;
  center: WorldVec3;
  fallbackGeometry: BufferGeometry;
}) {
  const variant = pickTerrainVariant(terrain, seed);
  const fallback = <TerrainFallbackMesh terrain={terrain} geometry={fallbackGeometry} />;
  // No STL coverage after all (shouldn't happen — `HexTiles` only routes STL-covered terrains here —
  // defensive fallback rather than throwing mid-render).
  if (!variant) return <group position={[center.x, center.y, center.z]}>{fallback}</group>;

  // The yaw only applies to the STL model itself — NOT to the fallback prism (shown while loading,
  // or permanently on a load error): the fallback's geometry is built directly from the real hex's
  // own vertex offsets (`hexGeometryBuilders.ts`), so it already matches the true hex outline exactly
  // and would visibly mis-align (a hexagon only repeats its own outline every 60°, not 30°) if it
  // inherited the STL's 30°-based yaw. Wrapping just the STL mesh in its own inner rotated group
  // (sharing the outer group's origin, i.e. still rotating around the hex's true center) keeps the
  // fallback's un-rotated footprint correct in both the loading and error states.
  const yaw = hexYaw(pickRotationStep(seed));
  return (
    <group position={[center.x, center.y, center.z]}>
      <TerrainFallbackBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <group rotation={[0, yaw, 0]}>
            <TerrainStlMesh terrain={terrain} url={variant.url} modelHeightY={modelHeight(variant)} />
          </group>
        </Suspense>
      </TerrainFallbackBoundary>
    </group>
  );
}

// --- T-1505 REWORK: harbors as sea-hex tiles (retires `overlays/Harbors3D.tsx`'s edge-prop version)
// -------------------------------------------------------------------------------------------------
// A harbor tile occupies the EXACT slot a plain water tile would (its caller above only renders one
// or the other, never both) — so if its own STL fails to load, falling back to NOTHING (as the
// retired prop version did, reasonably, since it was just an accent) would leave a hole in the sea
// ring; it must fall back to the ordinary plain-water tile instead, same discipline as every other
// STL tile in this file.

// T-1505 polish: the harbor model's own base tint (below the waterline) is now the SAME SEA colour
// via `HARBOR_HEIGHT_BAND.base` (blending into a wood-hull `feature` colour above it) rather than a
// flat single-colour material — retires the old flat `HARBOR_TILE_COLOR` constant this replaced;
// "blends into the surrounding sea ring at the waterline, hull reads as wood above it" carries the
// same original intent ("make harbors sea color too") forward.

const HARBOR_LABEL_FILL = '#efe4c6';
const HARBOR_LABEL_TEXT = '#2b2416'; // matches board/palette.ts's INK

/** PART B: the billboarded ratio/resource label is retired in favor of the 3D port marker seated in
 *  the harbor's own housing (`PortMarker3D`, below) — the marker now conveys the ratio/resource
 *  itself. Kept available but OFF by default (task: "optional tiny label gated off by default"); flip
 *  to `true` for a quick A/B while calibrating the marker's fit on :8080. */
const SHOW_HARBOR_RATIO_LABEL = false;

/** DEV-TUNING requirement 1: the harbour model's own base orientation + uniform scale, applied to
 *  EVERY harbour ship/lighthouse model on top of `normalizeStlGeometry`'s fixed Z-up->Y-up remap and
 *  BEFORE the per-tile placement yaw (`harbor.yaw`, the outer `<group>` in `HarborStlTile` below) —
 *  the likely real fix if a model is lying flat / on the wrong up-axis, which no yaw offset alone can
 *  correct. `tuningAvailable` false (always true in a normal production render) collapses this to a
 *  no-op identity transform, byte-identical to the pre-tuning-panel render. */
function HarborModelMesh({ url, modelHeightY }: { url: string; modelHeightY: number }) {
  const geometry = useLoader(TerrainSTLLoader, url);
  // Production bake-once (UNCHANGED): idempotent past the first call for this shared geometry object
  // — see the cache-guard doc on `applyHeightBandVertexColors` itself.
  applyHeightBandVertexColors(geometry, modelHeightY, HARBOR_HEIGHT_BAND);
  const tuningAvailable = useDevTuningAvailable();
  const tuning = useDevTuningStore();

  // DEV-TUNING "Colour thresholds" section: LIVE re-bake, same discipline as `TerrainStlMesh` above —
  // gated only on the panel being available; a normal production render (`tuningAvailable` false)
  // never runs this effect, so the bake-once call above is the only thing that ever touches this
  // geometry's `color` attribute in production.
  useEffect(() => {
    if (!tuningAvailable) return;
    applyHeightBandVertexColors(
      geometry,
      modelHeightY,
      { ...HARBOR_HEIGHT_BAND, thresholdFraction: tuning.harborThreshold },
      { blendFraction: tuning.blendFraction, force: true },
    );
  }, [tuningAvailable, geometry, modelHeightY, tuning.harborThreshold, tuning.blendFraction]);

  const rotX = tuningAvailable ? degToRad(tuning.harborBaseRotXDeg) : 0;
  const rotY = tuningAvailable ? degToRad(tuning.harborBaseRotYDeg) : 0;
  const rotZ = tuningAvailable ? degToRad(tuning.harborBaseRotZDeg) : 0;
  const scale = tuningAvailable ? tuning.harborBaseScale : 1;
  return (
    <group rotation={[rotX, rotY, rotZ]} scale={scale}>
      <mesh castShadow receiveShadow geometry={geometry}>
        <meshStandardMaterial color={VERTEX_COLOR_NEUTRAL} vertexColors roughness={0.75} metalness={0.05} side={DoubleSide} />
      </mesh>
    </group>
  );
}

// --- PART B: 3D port marker, seated in the harbor's own housing ------------------------------------
// Mounted as a CHILD of the harbor tile's rotation group (`HarborStlTile`, below) so it inherits the
// harbor's own yaw and turns WITH it — never rotated independently. Single-colour material
// (`TOKEN_FACE`, the same cream used for number-token inserts — a neutral read that works for both the
// generic 3:1 marker and every resource's 2:1 marker without needing 5 separate resource-tinted
// materials).

/** Catches the marker's own load error independently of the harbor hull's fallback boundary above —
 *  a failed/still-loading marker should never take the whole harbor tile down to plain water; it just
 *  renders nothing (the hull + island-facing yaw are still correct without it). */
class PortMarkerFallbackBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function PortMarkerMesh({ url }: { url: string }) {
  const geometry = useLoader(PortMarkerSTLLoader, url);
  return (
    <mesh castShadow receiveShadow geometry={geometry}>
      <meshStandardMaterial color={TOKEN_FACE} roughness={0.7} metalness={0.05} side={DoubleSide} />
    </mesh>
  );
}

/** One harbor's port marker — `PORT_MARKER_OFFSET`/`PORT_MARKER_YAW`/`PORT_MARKER_SCALE`
 *  (`portMarkerModels.ts`) are the user's ONE obvious tunable set for seating this in the housing.
 *  DEV-TUNING requirement 3: the live panel's marker sliders override these three constants when
 *  available; `tuningAvailable` false (always true in a normal production render) reproduces the
 *  original constants exactly. */
function PortMarker3D({ type, variantId, harborYaw }: { type: HarborType; variantId: HarborVariantId; harborYaw: number }) {
  const url = portMarkerUrlFor(type);
  const tuningAvailable = useDevTuningAvailable();
  const tuning = useDevTuningStore();
  // POSITION is seated in the harbour housing (offset lives in the ship's frame, so it follows the
  // harbour — NOT the camera; only number tokens billboard). ORIENTATION is locked to a FIXED WORLD
  // direction: we counter-rotate out the harbour's own facing (`harborYaw`), so every marker's icon
  // points the same way regardless of which way its harbour faces — this is what removes the "some are
  // 180° off" (a seated marker otherwise inherits its harbour's facing, and opposite harbours face
  // opposite ways). `markerYawDeg`/`PORT_MARKER_YAW_BY_VARIANT` now mean the DESIRED WORLD yaw.
  const off = tuningAvailable ? tuning.markerOffset[variantId] : PORT_MARKER_OFFSET;
  const worldYaw = tuningAvailable ? degToRad(tuning.markerYawDeg[variantId]) : PORT_MARKER_YAW_BY_VARIANT[variantId];
  const localYaw = worldYaw - harborYaw;
  const scale = tuningAvailable ? tuning.markerScale[variantId] : PORT_MARKER_SCALE;
  return (
    <group position={[off.x, off.y, off.z]} rotation={[0, localYaw, 0]} scale={scale}>
      <PortMarkerFallbackBoundary>
        <Suspense fallback={null}>
          <PortMarkerMesh url={url} />
        </Suspense>
      </PortMarkerFallbackBoundary>
    </group>
  );
}

/** Billboarded ratio + resource-icon label (carried over from the retired prop version) — RETIRED as
 *  the default (see `SHOW_HARBOR_RATIO_LABEL` above); the 3D port marker now conveys the ratio/
 *  resource. Still rendered when the flag is flipped on, so the 3:1/2:1 read stays legible at any
 *  camera angle, floating above the harbor model's own measured height. */
function HarborRatioLabel({ type, height }: { type: HarborType; height: number }) {
  const label = type === 'generic' ? '3:1' : '2:1';
  const labelY = height + TOKEN_RADIUS * 0.5;
  if (type === 'generic') {
    return (
      <GlyphMarker3D
        position={[0, labelY, 0]}
        radius={TOKEN_RADIUS * 0.85}
        glyph={label}
        fill={HARBOR_LABEL_FILL}
        fillOpacity={0.92}
        textColor={HARBOR_LABEL_TEXT}
      />
    );
  }
  // Resource harbor: icon above the ratio (mirrors BoardView.tsx's two-line "icon over 2:1" layout).
  return (
    <group>
      <GlyphMarker3D position={[0, labelY + TOKEN_RADIUS * 0.55, 0]} radius={TOKEN_RADIUS * 0.7} glyph={RESOURCE_GLYPH[type]} fill="none" />
      <GlyphMarker3D
        position={[0, labelY, 0]}
        radius={TOKEN_RADIUS * 0.6}
        glyph={label}
        fill={HARBOR_LABEL_FILL}
        fillOpacity={0.92}
        textColor={HARBOR_LABEL_TEXT}
        fontSize={TOKEN_RADIUS * 0.5}
      />
    </group>
  );
}

/** The sea tile a `board.harbors` edge lands on (`harborPlacement.ts`'s `computeHarborTiles`) —
 *  renders the ship/lighthouse model (`harbor.variant`) rotated to `harbor.yaw` (already the
 *  island-facing direction PLUS the user-calibrated `HARBOR_MODEL_YAW_OFFSET`, computed once in
 *  `harborPlacement.ts` — this component applies it verbatim, no further rotation math here) instead
 *  of the plain water tile this position would otherwise show, plus the billboarded ratio/resource
 *  label. Falls back to plain water (never nothing) while loading or on a load error — see this
 *  section's top comment. */
function HarborStlTile({
  harbor,
  center,
  fallbackGeometry,
}: {
  harbor: HarborTile;
  center: WorldVec3;
  fallbackGeometry: BufferGeometry;
}) {
  const fallback = <TerrainFallbackMesh terrain="sea" geometry={fallbackGeometry} />;
  const height = modelHeight(harbor.variant);
  return (
    <group position={[center.x, center.y, center.z]}>
      <TerrainFallbackBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          {/* baseYaw (real housing direction, inward) rotates BOTH the ship and the marker; the
              per-model authoring correction (modelYawOffset, e.g. ship3 +120°) rotates ONLY the ship
              mesh, so it can't fling the marker out of its housing (user: markers on rotated harbours
              were displaced by the yaw). */}
          <group rotation={[0, harbor.baseYaw, 0]}>
            <group rotation={[0, harbor.modelYawOffset, 0]}>
              <HarborModelMesh url={harbor.variant.url} modelHeightY={height} />
              {/* Marker is INSIDE the ship's full frame (baseYaw + per-model correction) so it tracks
                  the housing that's part of the ship mesh — seated, turning with the harbour, not the
                  camera. Per-variant offset/yaw/scale seat it (each ship model's housing differs). */}
              <PortMarker3D type={harbor.type} variantId={harbor.variant.id} harborYaw={harbor.yaw} />
            </group>
          </group>
        </Suspense>
      </TerrainFallbackBoundary>
      {SHOW_HARBOR_RATIO_LABEL && <HarborRatioLabel type={harbor.type} height={height} />}
    </group>
  );
}
