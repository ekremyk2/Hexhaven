// R3F wrapper components for the STL piece models (T-1503) — `Pieces3D.tsx` swaps its settlement/
// city/road `<...Body color=.../>` procedural meshes for the matching `<...Model color=.../>` here,
// same `color` prop contract, so the swap is a one-line change per piece type at each call site.
//
// Suspense + error boundary (requirement 6, "on STL load failure fall back to the procedural body —
// don't crash"): `useLoader` (per `@react-three/fiber`'s own doc) must be called under a
// `React.Suspense` boundary, and re-throws a stored error on the next render if the load rejects —
// both need a boundary ABOVE the loading component, so each model here nests a plain-React
// `StlFallbackBoundary` (catches the re-thrown error) around a `<Suspense>` (catches the pending
// promise) around the actual STL mesh, both rendering the SAME procedural body as their fallback.
// This means an STL that's merely still loading renders the procedural piece too, briefly, rather
// than nothing — no pop from invisible to visible once the model resolves, since `PlacementGroup`'s
// drop-in animation wraps whichever body is currently mounted.
import { Component, Suspense, useMemo, type ReactNode } from 'react';
import { useLoader } from '@react-three/fiber';
import { DoubleSide, MeshStandardMaterial } from 'three';
import { CityBody, RoadBody, SettlementBody } from './PieceBodies';
import {
  CitySTLLoader,
  RoadSTLLoader,
  SettlementSTLLoader,
  cityStlUrl,
  roadStlUrl,
  settlementStlUrl,
} from './stlModels';

/** Requirement 3's "polished game-render look — clean matte/painted, slight sheen": shinier than
 *  `PieceBodies.tsx`'s own procedural `MATERIAL_DEFAULTS` (0.72 roughness / 0.06 metalness, tuned
 *  for flat-shaded primitives) since the STL pieces are the deliberately upgraded render. `DoubleSide`
 *  for the same defensive reason every other board3d mesh carries it (`Board3D.tsx`'s top-of-file
 *  note): a user-supplied STL's face winding isn't a guarantee this codebase controls. */
const STL_MATERIAL_DEFAULTS = { roughness: 0.38, metalness: 0.12, side: DoubleSide } as const;

/** One shared `MeshStandardMaterial` per seat colour (requirement 3), reused across settlement/city/
 *  road for that seat — a plain module-level cache (not a hook) since the tiny, fixed set of seat
 *  colours (`PLAYER_COLORS`) never changes at runtime; no dependency array/hook-rules concern. */
const seatMaterialCache = new Map<string, MeshStandardMaterial>();
function seatMaterial(color: string): MeshStandardMaterial {
  let material = seatMaterialCache.get(color);
  if (!material) {
    material = new MeshStandardMaterial({ color, ...STL_MATERIAL_DEFAULTS });
    seatMaterialCache.set(color, material);
  }
  return material;
}

/** Catches the error `useLoader` re-throws on a failed load (requirement 6) — a plain class
 *  component since React's error-boundary contract has no hook equivalent. Renders `fallback`
 *  instead of `children` once tripped; never resets (a failed STL stays failed for the session,
 *  which is fine — the procedural body it falls back to is a complete, correct rendering on its
 *  own, not a degraded placeholder). */
class StlFallbackBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function SettlementMesh({ color }: { color: string }) {
  const geometry = useLoader(SettlementSTLLoader, settlementStlUrl);
  return <mesh castShadow receiveShadow geometry={geometry} material={useMemo(() => seatMaterial(color), [color])} />;
}

function CityMesh({ color }: { color: string }) {
  const geometry = useLoader(CitySTLLoader, cityStlUrl);
  return <mesh castShadow receiveShadow geometry={geometry} material={useMemo(() => seatMaterial(color), [color])} />;
}

function RoadMesh({ color }: { color: string }) {
  const geometry = useLoader(RoadSTLLoader, roadStlUrl);
  return <mesh castShadow receiveShadow geometry={geometry} material={useMemo(() => seatMaterial(color), [color])} />;
}

/** Settlement — STL geometry (shared/cached by `useLoader`, normalized once by `SettlementSTLLoader`)
 *  tinted to `color`, falling back to `PieceBodies.tsx`'s `SettlementBody` while loading or on
 *  failure. Same local-space convention as every other piece body: origin at ground level, caller
 *  (`Pieces3D.tsx`'s `PlacementGroup`) owns position/rotation/animation. */
export function SettlementModel({ color }: { color: string }) {
  return (
    <StlFallbackBoundary fallback={<SettlementBody color={color} />}>
      <Suspense fallback={<SettlementBody color={color} />}>
        <SettlementMesh color={color} />
      </Suspense>
    </StlFallbackBoundary>
  );
}

/** City — see `SettlementModel`'s doc; `city.stl`'s ~71k triangles are loaded/parsed/normalized
 *  ONCE total (per `stlModels.ts`'s loader-subclass note) and the resulting geometry is shared
 *  across every city instance on the board (no per-instance clone), the same geometry-sharing
 *  discipline `Board3D.tsx`'s hex tiles use for their own instanced meshes. */
export function CityModel({ color }: { color: string }) {
  return (
    <StlFallbackBoundary fallback={<CityBody color={color} />}>
      <Suspense fallback={<CityBody color={color} />}>
        <CityMesh color={color} />
      </Suspense>
    </StlFallbackBoundary>
  );
}

/** Road — see `SettlementModel`'s doc; `RoadSTLLoader`'s `'length'` fit mode already aligns the
 *  model's long axis onto local +X and centers/grounds it, matching `PieceBodies.tsx`'s `RoadBody`
 *  convention exactly, so no extra rotation is needed here — the caller's `rotationY` (the edge's own
 *  direction, from `coords.ts`) is all that's left to apply, and that already happens one level up in
 *  `Pieces3D.tsx`'s `PlacementGroup`. */
export function RoadModel({ color }: { color: string }) {
  return (
    <StlFallbackBoundary fallback={<RoadBody color={color} />}>
      <Suspense fallback={<RoadBody color={color} />}>
        <RoadMesh color={color} />
      </Suspense>
    </StlFallbackBoundary>
  );
}
