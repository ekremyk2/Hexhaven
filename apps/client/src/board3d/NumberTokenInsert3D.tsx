// A REAL 3D number-token insert seated in an STL terrain hex's sculpted socket recess (T-1506) —
// `Board3D.tsx` mounts this instead of `NumberToken3D`'s flat billboard for hexes whose terrain has
// STL coverage (`terrainStlModels.ts`'s `hasStlCoverage`); non-STL `gold` hexes (no socket) keep the
// billboard, same fallback rationale `NumberToken3D.tsx` already documents.
//
// Unlike the billboard (a flat plane that fully faces the camera on every axis via drei's
// `<Billboard>`), this is a real mesh with volume sitting IN a socket — fully billboarding it would
// visibly lift/tilt it out of the recess as the camera's polar angle changes. It only spins around
// world Y (`useFrame` below), same "stays readable as the board orbits, without leaving the socket"
// contract the task asks for.
//
// Suspense + error boundary: same `StlFallbackBoundary` (catches the re-thrown load error) around
// `<Suspense>` (catches the pending load promise) discipline `StlPieceModels.tsx` established for
// every other STL-backed piece — both fall back to `NumberToken3D`'s billboard, so a still-loading or
// failed sheet never leaves a hex with no token at all.
import { Component, Suspense, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { DoubleSide, type Group } from 'three';
import { TOKEN_FACE } from '../board/palette';
import { TOKEN_SOCKET_SCALE, TOKEN_SOCKET_Y } from './constants';
import { getSlicedNumberTokenGeometries, NumberTokenSheetSTLLoader, numberTokensUrl } from './numberTokenModels';
import { NumberToken3D } from './NumberToken3D';

export interface NumberTokenInsert3DProps {
  position: readonly [number, number, number];
  value: number;
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

function NumberTokenInsertLoaded({ position, value, dimmed = false }: NumberTokenInsert3DProps) {
  const groupRef = useRef<Group>(null);
  const rawGeometry = useLoader(NumberTokenSheetSTLLoader, numberTokensUrl);
  const geometries = useMemo(() => getSlicedNumberTokenGeometries(rawGeometry), [rawGeometry]);
  const geometry = geometries.get(value);
  const { camera } = useThree();

  // Face-the-camera (Y only, requirement 5): spins the wrapping group's yaw so the token's printed
  // face always points toward the camera's horizontal bearing, without tilting out of the socket.
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    group.rotation.y = Math.atan2(camera.position.x - position[0], camera.position.z - position[2]);
  });

  // Defensive: a value outside the base-game 2..12 set this sheet covers (shouldn't happen — legal
  // token values are always in that set) falls back to the billboard rather than rendering nothing.
  if (!geometry) return <NumberToken3D position={position} value={value} dimmed={dimmed} />;

  return (
    <group ref={groupRef} position={[position[0], position[1] + TOKEN_SOCKET_Y, position[2]]}>
      <mesh geometry={geometry} scale={TOKEN_SOCKET_SCALE} castShadow receiveShadow userData={{ isNumberToken: true }}>
        <meshStandardMaterial color={TOKEN_FACE} side={DoubleSide} transparent={dimmed} opacity={dimmed ? 0.4 : 1} />
      </mesh>
    </group>
  );
}

export function NumberTokenInsert3D(props: NumberTokenInsert3DProps) {
  const fallback = <NumberToken3D position={props.position} value={props.value} dimmed={props.dimmed} />;
  return (
    <StlFallbackBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <NumberTokenInsertLoaded {...props} />
      </Suspense>
    </StlFallbackBoundary>
  );
}
