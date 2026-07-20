// <SceneEnvironment> — offline image-based lighting (T-1500 requirement 2: "environment map for
// realistic reflections + ambient, WITHOUT any runtime external HTTP fetch").
//
// Why this is the offline-safe branch of drei's `<Environment>`, not a banned one: `<Environment
// preset=…>` and `<Environment files=…>` both fetch an `.hdr`/cubemap over HTTP at runtime (or from
// a bundled asset path) — the same constraint `Board3D.tsx`'s original T-1400 note already applied
// to drei's `<Text>`. Passing `<Environment>` CHILDREN instead (and no `preset`/`files`/`map` prop)
// takes drei's `EnvironmentPortal` code path: it renders the given children into a small, entirely
// local virtual scene and bakes that into a cubemap via a `<cubeCamera>` (`frames={1}` — baked once
// on mount, not re-baked every frame, since none of the Lightformers below ever move). Every pixel
// of the resulting "environment map" is geometry authored and rendered right here — no network
// request, no bundled binary asset, at build time or at runtime. (Confirmed by reading
// `@react-three/drei`'s `Environment.js`: `Environment(props)` renders `EnvironmentPortal` exactly
// when `props.children` is set and `map`/`preset`/`ground` are not.)
//
// The four `<Lightformer>` panels form a small "product photography" light box — a big bright
// overhead "sky" panel plus two dim side fills and a warm floor bounce — the "clean, bright, premium
// studio" read the task asks for (Catan-Universe-like), not a single harsh point light. Their
// position/scale numbers are coordinates in this SEPARATE virtual bake scene (drei's own internal
// convention), not world-space relative to the board, so they don't need to scale with
// `boardWorldExtents` the way every other board3d module's sizing does.
import { Environment, Lightformer } from '@react-three/drei';

export interface SceneEnvironmentProps {
  /** Cubemap bake resolution — `mobileBudget.ts` halves this on touch/small-viewport devices, the
   *  single biggest cost lever for a one-time bake (bigger cubemap faces = more bake-time pixels). */
  resolution: number;
}

export function SceneEnvironment({ resolution }: SceneEnvironmentProps) {
  return (
    <Environment resolution={resolution} frames={1}>
      {/* Overhead "sky" — the dominant soft light: big and bright so specular highlights on glossy
          tiles/pieces read like an overcast studio skylight, not one hard bulb. */}
      <Lightformer form="rect" color="#fbfdff" intensity={2.6} position={[0, 18, 0]} scale={[22, 22, 1]} target={[0, 0, 0]} />
      {/* Warm key-side fill — echoes the key directional light's side (Board3D.tsx) so the IBL
          reflections and the direct lighting agree on "where the light comes from." */}
      <Lightformer form="rect" color="#fff2dc" intensity={1.1} position={[14, 7, 9]} scale={[12, 9, 1]} target={[0, 0, 0]} />
      {/* Cool rim/back fill — dim, opposite side, so reflective surfaces show a gentle two-tone
          gradient instead of one flat blown-out highlight. */}
      <Lightformer form="rect" color="#e3edff" intensity={0.7} position={[-13, 6, -8]} scale={[12, 9, 1]} target={[0, 0, 0]} />
      {/* Warm floor bounce — a dim upward panel standing in for the light a real tabletop bounces
          back up onto the underside of tile bevels/pieces. */}
      <Lightformer form="rect" color="#caa06c" intensity={0.5} position={[0, -6, 0]} scale={[20, 20, 1]} target={[0, 0, 0]} />
    </Environment>
  );
}
