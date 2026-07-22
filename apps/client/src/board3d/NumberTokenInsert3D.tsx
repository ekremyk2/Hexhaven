// A REAL 3D number-token insert seated in an STL terrain hex's sculpted socket recess (T-1506) —
// `Board3D.tsx` mounts this instead of `NumberToken3D`'s flat billboard for hexes whose terrain has
// STL coverage (`terrainStlModels.ts`'s `hasStlCoverage`); non-STL `gold` hexes (no socket) keep the
// billboard, same fallback rationale `NumberToken3D.tsx` already documents.
//
// The user supplies one STL per token VALUE (`numberTokenModels.ts`); this loads the right one,
// bakes its black/red -> light height gradient (`applyTokenHeightColors`), seats it in the socket
// (position + scale user-tunable) and — unlike the flat billboard — only spins it around world Y
// (`useFrame` below) so the printed face stays readable as the board orbits without lifting the puck
// out of its recess.
//
// Suspense + error boundary: same `StlFallbackBoundary` (catches the re-thrown load error) around
// `<Suspense>` (catches the pending load promise) discipline the other STL pieces use — both fall
// back to `NumberToken3D`'s billboard, so a still-loading or failed model never leaves a hex bare.
import { Component, Suspense, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { DoubleSide, Vector3, type Group } from 'three';
import type { ScenarioTerrain } from '@hexhaven/shared';
import { TOKEN_SOCKET_SCALE, TOKEN_SOCKET_X, TOKEN_SOCKET_Y, TOKEN_SOCKET_Z } from './constants';
import { isBandTerrainId, useDevTuningAvailable, useDevTuningStore } from './devTuning';
import { HEX_RANDOM_ROTATION, hexRandomYaw, TERRAIN_TOKEN_OFFSET } from './terrainStlModels';
import {
  applyTokenHeightColors,
  NumberTokenSTLLoader,
  numberTokenUrlFor,
  TOKEN_COLOR_BLEND,
  TOKEN_COLOR_THRESHOLD,
  tokenBaseColorFor,
} from './numberTokenModels';
import { NumberToken3D } from './NumberToken3D';

/** Scratch vector reused across every token's per-frame facing update (no per-frame allocation) —
 *  useFrame runs sequentially, so a single module-level temp is safe. */
const CAMERA_FORWARD = new Vector3();
const Y_AXIS = new Vector3(0, 1, 0);

export interface NumberTokenInsert3DProps {
  position: readonly [number, number, number];
  value: number;
  /** The hex's terrain — selects this terrain's socket offset (`TERRAIN_TOKEN_OFFSET` / the tuning
   *  panel's per-terrain offset), since each sculpted model seats its socket at a different spot. */
  terrain: ScenarioTerrain;
  /** The hex's rotation seed (its `HexId`) — must match the terrain tile's, so the token's offset
   *  rotates by the SAME random yaw the sculpted model does and stays seated in the socket. */
  seed: number;
  dimmed?: boolean;
}

class StlFallbackBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function NumberTokenInsertLoaded({ position, value, terrain, seed, dimmed = false }: NumberTokenInsert3DProps) {
  const groupRef = useRef<Group>(null);
  // `url` is guaranteed defined here — the wrapper below only renders this component for values that
  // have a model, so `useLoader` (which must run unconditionally) always gets a valid url.
  const url = numberTokenUrlFor(value)!;
  const rawGeometry = useLoader(NumberTokenSTLLoader, url);
  const { camera } = useThree();

  const tuningAvailable = useDevTuningAvailable();
  const tuning = useDevTuningStore();
  // Per-terrain seat offset: the live tuning value when available, else the baked per-terrain override,
  // else the global socket default.
  const tuned = tuningAvailable && isBandTerrainId(terrain) ? tuning.tokenOffset[terrain] : undefined;
  const baked = TERRAIN_TOKEN_OFFSET[terrain];
  const socketX = tuned?.x ?? baked?.x ?? TOKEN_SOCKET_X;
  const socketY = tuned?.y ?? baked?.y ?? TOKEN_SOCKET_Y;
  const socketZ = tuned?.z ?? baked?.z ?? TOKEN_SOCKET_Z;
  const socketScale = tuningAvailable ? tuning.tokenSocketScale : TOKEN_SOCKET_SCALE;

  // The offset was calibrated with the model at its base+terrain yaw (random off). When the hex also
  // spins by a random `k·60°` (`hexRandomYaw`, same seed as the terrain tile), the socket rotates with
  // it — so rotate the offset by that SAME random yaw about the hex centre to follow it in.
  const randomOn = tuningAvailable ? tuning.hexRandomRotation : HEX_RANDOM_ROTATION;
  const offset = useMemo(
    () => new Vector3(socketX, socketY, socketZ).applyAxisAngle(Y_AXIS, hexRandomYaw(seed, randomOn)),
    [socketX, socketY, socketZ, seed, randomOn],
  );
  const threshold = tuningAvailable ? tuning.tokenColorThreshold : TOKEN_COLOR_THRESHOLD;
  const blend = tuningAvailable ? tuning.tokenColorBlend : TOKEN_COLOR_BLEND;

  // Clone + colour per instance (only ~18 hexes): the loaded geometry is shared across every hex of
  // this value via `useLoader`'s cache, so it must not be mutated in place — and the baked gradient
  // depends on the live-tunable threshold/blend, so it re-bakes when those change.
  const geometry = useMemo(
    () => applyTokenHeightColors(rawGeometry.clone(), tokenBaseColorFor(value), undefined, threshold, blend),
    [rawGeometry, value, threshold, blend],
  );

  // Face the camera SIDE, uniformly (Y only): every token gets the SAME yaw — the camera's horizontal
  // bearing (derived from the camera's own view direction, not each token's position) — so they all
  // read parallel in one direction rather than each fanning to aim directly at the camera (user).
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    camera.getWorldDirection(CAMERA_FORWARD);
    group.rotation.y = Math.atan2(-CAMERA_FORWARD.x, -CAMERA_FORWARD.z);
  });

  return (
    <group ref={groupRef} position={[position[0] + offset.x, position[1] + offset.y, position[2] + offset.z]}>
      <mesh geometry={geometry} scale={socketScale} castShadow receiveShadow userData={{ isNumberToken: true }}>
        <meshStandardMaterial vertexColors side={DoubleSide} transparent={dimmed} opacity={dimmed ? 0.4 : 1} />
      </mesh>
    </group>
  );
}

export function NumberTokenInsert3D(props: NumberTokenInsert3DProps) {
  const fallback = <NumberToken3D position={props.position} value={props.value} dimmed={props.dimmed} />;
  // A value with no model (e.g. the desert's absent token) falls back to the billboard rather than
  // calling `useLoader` with an undefined url.
  if (!numberTokenUrlFor(props.value)) return fallback;
  return (
    <StlFallbackBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <NumberTokenInsertLoaded {...props} />
      </Suspense>
    </StlFallbackBoundary>
  );
}
