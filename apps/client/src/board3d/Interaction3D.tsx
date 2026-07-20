// <Interaction3D> — the WebGL 3D board's click/hover layer (T-1402), the 3D counterpart of the flat
// SVG `<InteractionLayer>` (T-304/board/InteractionLayer.tsx). Same prop contract exactly —
// `geometry`/`mode`/`targets`/`onPick`/`ghostColor` — so the PM can drop this straight in wherever
// `useUiInteraction()` (store/uiMode.ts) is already wired, no new store plumbing needed.
//
// Why 3 categories cover EVERY uiMode: `mode` is `TargetMode = 'vertex' | 'edge' | 'hex'`
// (store/uiMode.ts) — every one of `computeUiTargets`'s ~40 `UiMode` cases (build road/settlement/
// city, move robber/pirate/hex-piece, ship/knight build+move, every Cities & Knights progress card,
// every Traders & Barbarians/Explorers & Pirates action, …) already resolves down to exactly one of
// these 3 board-target categories before it ever reaches `InteractionLayer` — that reduction is
// `uiMode.ts`'s job, not this component's. So handling `vertex`/`edge`/`hex` exhaustively (this file)
// reproduces every one of those flows automatically, the same way the SVG layer does with the exact
// same 3-case switch. See this task's Implementation notes for the full mode -> category table.
//
// Ghost placeholder note (parallel-work constraint): `Pieces3D.tsx` (T-1401) is being built
// concurrently by another agent and isn't available to import yet, so the hover ghost here is a
// simple primitive (sphere/capsule/hex-cap) in `ghostColor` rather than the real piece mesh.
// TODO(PM/T-1403): swap the ghost placeholders below for the real `Pieces3D` meshes once merged.
//
// Click vs. drag (requirement 4): a raw browser `click` event fires on the canvas after ANY
// pointerdown+pointerup pair regardless of how far the pointer travelled in between (orbiting the
// camera IS such a pair) — so every target's `onClick` is gated behind `useOrbitClickGuard`'s
// "did the pointer move past a small pixel threshold since it went down" check
// (`interactionTargets.ts`'s `exceedsDragThreshold`), independent of and non-interfering with
// `OrbitControls`'s own listeners on the same `<canvas>` element.
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { DoubleSide, type MeshStandardMaterial } from 'three';
import { GEOMETRY, type BoardGeometry, type GeometryEdge, type GeometryHex, type GeometryVertex } from '@hexhaven/shared';
import type { TargetMode } from '../store/uiMode';
import { edgeWorldPosition, hexWorldCenter, vertexWorldPosition } from './coords';
import { buildHexCapGeometry } from './hexGeometryBuilders';
import {
  activeTargetIds,
  EDGE_GHOST_LENGTH,
  EDGE_GHOST_RADIUS,
  EDGE_HIT_LENGTH,
  EDGE_HIT_RADIUS,
  exceedsDragThreshold,
  HEX_MARKER_ELEVATION,
  nextHoverAfterTargetsChange,
  pulseOpacity,
  VERTEX_EDGE_MARKER_ELEVATION,
  VERTEX_GHOST_RADIUS,
  VERTEX_HIT_RADIUS,
} from './interactionTargets';

const PULSE_MIN = 0.35;
const PULSE_MAX = 0.6;
const PULSE_PERIOD_SEC = 1.2;
const HOVER_OPACITY = 0.85;
const HOVER_EMISSIVE = 0.75;
const IDLE_EMISSIVE = 0.3;
const DRAG_THRESHOLD_PX = 6;

/** Assigned to a mesh's `raycast` prop to make it invisible to the `Raycaster` entirely — the ghost
 *  preview meshes are purely visual (mirrors the SVG layer's `style={{ pointerEvents: 'none' }}`
 *  ghost group) so only the dedicated hit-test mesh underneath ever receives pointer events. */
const disableRaycast = () => undefined;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

export interface Interaction3DProps {
  geometry?: BoardGeometry;
  /** Which category is currently listening; `null` means nothing is interactive. */
  mode: TargetMode | null;
  /** Ids (within `mode`'s category) that are currently legal — only these ever receive pointer
   *  events or a ghost/highlight, exactly like the SVG layer's own `targets` prop. */
  targets: Set<number>;
  onPick: (id: number) => void;
  /** Ghost/hover highlight color — the acting seat's player color (`board/palette.ts`'s
   *  `PLAYER_COLORS`), passed straight through from the SAME value `Game.tsx` feeds the SVG layer. */
  ghostColor: string;
}

/** Tracks whether the pointer has moved past `DRAG_THRESHOLD_PX` since its last `pointerdown` on the
 *  canvas — read (not subscribed to) by every target's `onClick` handler so an orbit-rotate drag
 *  never misfires a placement (requirement 4). Lives on the canvas's own `gl.domElement`, entirely
 *  independent of `OrbitControls`'s own listeners on that same element — neither interferes with the
 *  other; this purely observes raw pointer movement to gate `onPick`. */
function useOrbitClickGuard(): MutableRefObject<boolean> {
  const { gl } = useThree();
  const draggedRef = useRef(false);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = gl.domElement;
    const onPointerDown = (e: PointerEvent) => {
      downPosRef.current = { x: e.clientX, y: e.clientY };
      draggedRef.current = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      const start = downPosRef.current;
      if (!start) return;
      if (exceedsDragThreshold(e.clientX - start.x, e.clientY - start.y, DRAG_THRESHOLD_PX)) {
        draggedRef.current = true;
      }
    };
    const onPointerUp = () => {
      downPosRef.current = null;
    };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, [gl]);

  return draggedRef;
}

/** Per-frame pulse-opacity + hover-solidify writer, shared by every marker kind below — mirrors the
 *  SVG layer's `hexhaven-legal-pulse` CSS animation (dashed outline breathing 35%→60%) that solidifies
 *  to a filled `fillOpacity={0.85}` shape on hover. Reduced-motion parity: `prefers-reduced-motion`
 *  freezes at the CSS fallback's static 0.48 mid-value instead of animating. */
function useGhostMaterial(hovered: boolean): RefObject<MeshStandardMaterial> {
  const matRef = useRef<MeshStandardMaterial>(null);
  const reducedMotion = useMemo(prefersReducedMotion, []);
  useFrame(({ clock }) => {
    const mat = matRef.current;
    if (!mat) return;
    if (hovered) {
      mat.opacity = HOVER_OPACITY;
      mat.emissiveIntensity = HOVER_EMISSIVE;
      return;
    }
    mat.opacity = reducedMotion
      ? (PULSE_MIN + PULSE_MAX) / 2
      : pulseOpacity(clock.getElapsedTime(), PULSE_MIN, PULSE_MAX, PULSE_PERIOD_SEC);
    mat.emissiveIntensity = IDLE_EMISSIVE;
  });
  return matRef;
}

interface TargetHandlers {
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onPick: () => void;
}

function targetPointerProps(handlers: TargetHandlers) {
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      handlers.onHoverStart();
    },
    onPointerOut: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      handlers.onHoverEnd();
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      handlers.onPick();
    },
  };
}

// ---- Vertex target: settlement/city/knight-vertex placeholder (a sphere) ----------------------

function VertexTarget({
  vertex,
  color,
  hovered,
  handlers,
}: {
  vertex: GeometryVertex;
  color: string;
  hovered: boolean;
  handlers: TargetHandlers;
}) {
  const w = vertexWorldPosition(vertex, VERTEX_EDGE_MARKER_ELEVATION);
  const position: [number, number, number] = [w.x, w.y, w.z];
  const ghostMatRef = useGhostMaterial(hovered);

  return (
    <group position={position}>
      <mesh raycast={disableRaycast} userData={{ isInteractionGhost: true }}>
        <sphereGeometry args={[VERTEX_GHOST_RADIUS, 16, 12]} />
        <meshStandardMaterial
          ref={ghostMatRef}
          color={color}
          emissive={color}
          transparent
          opacity={PULSE_MIN}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh {...targetPointerProps(handlers)} userData={{ isInteractionHitArea: true, vertexId: vertex.id }}>
        <sphereGeometry args={[VERTEX_HIT_RADIUS, 10, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---- Edge target: road/ship/knight-edge placeholder (a capsule) --------------------------------

function EdgeTarget({
  edge,
  color,
  hovered,
  handlers,
}: {
  edge: GeometryEdge;
  color: string;
  hovered: boolean;
  handlers: TargetHandlers;
}) {
  const w = edgeWorldPosition(edge, VERTEX_EDGE_MARKER_ELEVATION);
  const position: [number, number, number] = [w.x, w.y, w.z];
  const ghostMatRef = useGhostMaterial(hovered);
  // A capsule's local long axis is Y by construction; rotating the mesh -90deg around local Z first
  // maps that axis onto local X — exactly the axis `coords.ts`'s `edgeWorldPosition.rotationY` is
  // documented to orient ("aligns a mesh's local +X axis with the edge's direction"). The parent
  // `<group>`'s own `rotation-y={w.rotationY}` then carries that local +X out to the edge's real
  // world direction.
  const axisAlign: [number, number, number] = [0, 0, -Math.PI / 2];

  return (
    <group position={position} rotation={[0, w.rotationY, 0]}>
      <mesh raycast={disableRaycast} rotation={axisAlign} userData={{ isInteractionGhost: true }}>
        <capsuleGeometry args={[EDGE_GHOST_RADIUS, EDGE_GHOST_LENGTH, 4, 8]} />
        <meshStandardMaterial
          ref={ghostMatRef}
          color={color}
          emissive={color}
          transparent
          opacity={PULSE_MIN}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh
        rotation={axisAlign}
        {...targetPointerProps(handlers)}
        userData={{ isInteractionHitArea: true, edgeId: edge.id }}
      >
        <capsuleGeometry args={[EDGE_HIT_RADIUS, EDGE_HIT_LENGTH, 4, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---- Hex target: robber/pirate/hex-piece/progress-card-hex placeholder (the tile's own footprint) -

function HexTarget({
  hex,
  capGeometry,
  color,
  hovered,
  handlers,
}: {
  hex: GeometryHex;
  capGeometry: ReturnType<typeof buildHexCapGeometry>;
  color: string;
  hovered: boolean;
  handlers: TargetHandlers;
}) {
  const c = hexWorldCenter(hex, HEX_MARKER_ELEVATION);
  const position: [number, number, number] = [c.x, c.y, c.z];
  const ghostMatRef = useGhostMaterial(hovered);

  return (
    <group position={position}>
      <mesh raycast={disableRaycast} geometry={capGeometry} userData={{ isInteractionGhost: true }}>
        <meshStandardMaterial
          ref={ghostMatRef}
          color={color}
          emissive={color}
          transparent
          opacity={PULSE_MIN}
          side={DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh
        geometry={capGeometry}
        {...targetPointerProps(handlers)}
        userData={{ isInteractionHitArea: true, hexId: hex.id }}
      >
        <meshBasicMaterial transparent opacity={0} side={DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function Interaction3D({ geometry = GEOMETRY, mode, targets, onPick, ghostColor }: Interaction3DProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const draggedRef = useOrbitClickGuard();
  const { gl } = useThree();

  // Stale-hover guard (requirement 2 parity with `InteractionLayer`'s identical `useEffect`).
  useEffect(() => {
    setHovered((h) => nextHoverAfterTargetsChange(h, targets));
  }, [mode, targets]);

  // Cursor affordance parity with the SVG layer's `cursor: pointer` on active hit areas — reset on
  // unmount/mode change so a stale pointer cursor never survives past this component's lifetime.
  useEffect(() => {
    const el = gl.domElement;
    el.style.cursor = hovered != null ? 'pointer' : 'auto';
    return () => {
      el.style.cursor = 'auto';
    };
  }, [gl, hovered]);

  const capGeometry = useMemo(() => (mode === 'hex' ? buildHexCapGeometry(geometry) : null), [geometry, mode]);

  const makeHandlers = (id: number): TargetHandlers => ({
    onHoverStart: () => setHovered(id),
    onHoverEnd: () => setHovered((cur) => (cur === id ? null : cur)),
    onPick: () => {
      if (draggedRef.current) return; // requirement 4: a drag-to-orbit release never places
      onPick(id);
    },
  });

  const activeIds = useMemo(() => new Set(activeTargetIds(geometry, mode, targets)), [geometry, mode, targets]);

  let children: ReactNode = null;
  if (mode === 'vertex') {
    children = geometry.vertices
      .filter((v) => activeIds.has(v.id))
      .map((v) => (
        <VertexTarget key={`ivt${v.id}`} vertex={v} color={ghostColor} hovered={hovered === v.id} handlers={makeHandlers(v.id)} />
      ));
  } else if (mode === 'edge') {
    children = geometry.edges
      .filter((e) => activeIds.has(e.id))
      .map((e) => (
        <EdgeTarget key={`iet${e.id}`} edge={e} color={ghostColor} hovered={hovered === e.id} handlers={makeHandlers(e.id)} />
      ));
  } else if (mode === 'hex' && capGeometry) {
    children = geometry.hexes
      .filter((h) => activeIds.has(h.id))
      .map((h) => (
        <HexTarget
          key={`iht${h.id}`}
          hex={h}
          capGeometry={capGeometry}
          color={ghostColor}
          hovered={hovered === h.id}
          handlers={makeHandlers(h.id)}
        />
      ));
  }

  return <group name="interaction3d">{children}</group>;
}
