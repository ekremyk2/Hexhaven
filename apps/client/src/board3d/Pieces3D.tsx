// Player pieces on the WebGL 3D board (T-1401): roads/ships on edges, settlements/cities on
// vertices, the robber/pirate on their hex — the SAME prop shape `board/Pieces.tsx` (the flat SVG
// version) takes, so `Game.tsx` can pass it the identical `roads`/`settlements`/`cities`/`ships`/
// `robber`/`pirate` arrays it already builds for `<Pieces>`. Positions come from `coords.ts` (T-1400's
// geometry -> world mapping) rather than any new math of this component's own.
//
// Animation (requirement 4): a piece's placement pop is a drop-in + scale-in lerp, driven by
// `pieceAnimation.ts`'s pure easing curves inside a `useFrame` loop (no new animation dependency);
// the robber's move is a hop/slide reusing `board/Pieces.tsx`'s own `robberHopOffset` (the exact
// same pure geometry the flat board's CSS hop animation is keyed off), so the two renderers agree on
// "how far did the robber move" even though they animate it completely differently (CSS vs. r3f
// frame loop). Both respect `usePrefersReducedMotion()` — reduced motion renders every piece at its
// final resting transform with no per-frame work.
//
// Out of scope here (T-1401's own "Out of scope"): island chits / hex pieces / C&K-T&B-E&P overlays
// (T-1403), click/ghost interaction (T-1402) — this component is purely the STANDING pieces.
import { useEffect, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import {
  GEOMETRY,
  type BoardGeometry,
  type EdgeId,
  type GameState,
  type HexId,
  type ScenarioTerrain,
  type Seat,
  type VertexId,
} from '@hexhaven/shared';
import { PLAYER_COLORS } from '../board/palette';
import { robberHopOffset } from '../board/Pieces';
import { usePrefersReducedMotion } from '../theme/motion';
import { edgeWorldPosition, hexWorldCenter, vertexWorldPosition, type WorldVec3 } from './coords';
import { TILE_HEIGHT } from './constants';
import { PirateBody, RobberBody } from './PieceBodies';
import { HOP_DURATION_MS, PLACEMENT_DURATION_MS, hopOffset, placementDropOffset, placementScale } from './pieceAnimation';
import { edgeTopY, hexTopY, vertexTopY } from './tileElevation';
// T-1503: settlement/city/road now render the user-supplied STL models (tinted per seat), falling
// back to their `PieceBodies` procedural equivalents on load failure — see `StlPieceModels.tsx`.
// T-1505 part 2: the Seafarers ship joins them (`ShipModel`, the user-supplied `ship1.stl`). Robber
// and pirate stay procedural (no STL supplied for either — explicit out-of-scope both tasks agree on).
import { CityModel, RoadModel, ShipModel, SettlementModel } from './StlPieceModels';

/** How far above its resting spot a piece drops in from — big enough to read as a "landing" rather
 *  than an imperceptible nudge, small enough it never clips through the sky/other pieces. */
const DROP_HEIGHT = TILE_HEIGHT * 2;
/** How high the robber's hop arcs above the board mid-hop. */
const HOP_ARC_HEIGHT = TILE_HEIGHT * 1.6;

/** USER-CALIBRATED CONSTANT (T-1505 part 2) — the user will supply a value once ships render on
 *  :8080. Added on top of every ship's edge-direction rotation (`edgeWorldPosition`'s `rotationY`,
 *  the same yaw a road already gets) to correct for whichever direction the shipped `ship1.stl`
 *  model's own authored bow/front actually faces at local rotation 0 (unverified here — this sandbox
 *  can't render WebGL). Change ONLY this one constant to re-aim EVERY ship together; the per-ship
 *  edge-direction math (identical to a road's) must not need touching to recalibrate. Radians. */
const SHIP_MODEL_YAW_OFFSET = 0;

export interface Pieces3DProps {
  geometry?: BoardGeometry;
  /** T-1505: which terrain each hex shows (drives sculpted-tile heights, `tileElevation.ts`) — same
   *  `board`/`hexTerrain` contract every other board3d component already takes. Omitting `board`
   *  (e.g. a caller with no live game state) falls back to the flat `TILE_HEIGHT` everywhere, exactly
   *  this component's pre-T-1505 behaviour. */
  board?: Pick<GameState['board'], 'hexes'>;
  hexTerrain?: readonly ScenarioTerrain[];
  roads?: { edge: EdgeId; seat: Seat }[];
  settlements?: { vertex: VertexId; seat: Seat }[];
  cities?: { vertex: VertexId; seat: Seat }[];
  robber?: HexId | null;
  /** Seafarers: ships on sea edges, rendered like roads but as a hull + sail (T-1401 requirement 2). */
  ships?: { edge: EdgeId; seat: Seat }[];
  /** Seafarers: the pirate on its sea hex, distinct from the land robber. */
  pirate?: HexId | null;
}

const NO_HEXES: Pick<GameState['board'], 'hexes'> = { hexes: [] };

export function Pieces3D({
  geometry = GEOMETRY,
  board,
  hexTerrain,
  roads = [],
  settlements = [],
  cities = [],
  robber = null,
  ships = [],
  pirate = null,
}: Pieces3DProps) {
  const reducedMotion = usePrefersReducedMotion();
  const boardHexes = board ?? NO_HEXES;

  const vertexOf = (id: VertexId) => {
    const v = geometry.vertices[id];
    if (!v) throw new Error(`BUG: Pieces3D vertex ${id}`);
    return v;
  };
  const edgeOf = (id: EdgeId) => {
    const e = geometry.edges[id];
    if (!e) throw new Error(`BUG: Pieces3D edge ${id}`);
    return e;
  };
  const hexOf = (id: HexId) => {
    const h = geometry.hexes[id];
    if (!h) throw new Error(`BUG: Pieces3D hex ${id}`);
    return h;
  };

  // Tracks the robber's PREVIOUS hex across renders — the identical pattern `board/Pieces.tsx` uses
  // to feed its own CSS hop trigger, reused via the same `robberHopOffset` helper so the 3D board's
  // hop distance/direction is computed by the exact same pure function as the flat board's.
  const prevRobberHexRef = useRef<HexId | null>(robber);
  useEffect(() => {
    prevRobberHexRef.current = robber;
  }, [robber]);
  const hop = robber != null ? robberHopOffset(prevRobberHexRef.current, robber, geometry) : null;

  const pirateCenter =
    pirate != null ? hexWorldCenter(hexOf(pirate), hexTopY(boardHexes, hexTerrain, pirate)) : null;

  return (
    <group>
      {roads.map(({ edge: eid, seat }, i) => {
        const pos = edgeWorldPosition(edgeOf(eid), edgeTopY(boardHexes, geometry, hexTerrain, eid));
        return (
          <PlacementGroup key={`r${eid}-${i}`} position={pos} rotationY={pos.rotationY} reducedMotion={reducedMotion}>
            <RoadModel color={PLAYER_COLORS[seat]} />
          </PlacementGroup>
        );
      })}

      {ships.map(({ edge: eid, seat }, i) => {
        const pos = edgeWorldPosition(edgeOf(eid), edgeTopY(boardHexes, geometry, hexTerrain, eid));
        return (
          <PlacementGroup
            key={`sh${eid}-${i}`}
            position={pos}
            rotationY={pos.rotationY + SHIP_MODEL_YAW_OFFSET}
            reducedMotion={reducedMotion}
          >
            <ShipModel color={PLAYER_COLORS[seat]} />
          </PlacementGroup>
        );
      })}

      {settlements.map(({ vertex: vid, seat }, i) => {
        const pos = vertexWorldPosition(vertexOf(vid), vertexTopY(boardHexes, geometry, hexTerrain, vid));
        return (
          <PlacementGroup key={`s${vid}-${i}`} position={pos} reducedMotion={reducedMotion}>
            <SettlementModel color={PLAYER_COLORS[seat]} />
          </PlacementGroup>
        );
      })}

      {cities.map(({ vertex: vid, seat }, i) => {
        const pos = vertexWorldPosition(vertexOf(vid), vertexTopY(boardHexes, geometry, hexTerrain, vid));
        return (
          <PlacementGroup key={`ci${vid}-${i}`} position={pos} reducedMotion={reducedMotion}>
            <CityModel color={PLAYER_COLORS[seat]} />
          </PlacementGroup>
        );
      })}

      {robber != null && (
        <HopGroup
          key="robber"
          hexKey={robber}
          offsetDx={hop?.dx ?? 0}
          offsetDz={hop?.dy ?? 0}
          targetPosition={hexWorldCenter(hexOf(robber), hexTopY(boardHexes, hexTerrain, robber))}
          reducedMotion={reducedMotion}
          arcHeight={HOP_ARC_HEIGHT}
        >
          <RobberBody />
        </HopGroup>
      )}

      {/* Pirate: no hop/pop animation, matching `board/Pieces.tsx`'s own `Pirate` (which carries no
          animation class at all — only the robber's move is animated there). */}
      {pirateCenter && (
        <group key="pirate" position={[pirateCenter.x, pirateCenter.y, pirateCenter.z]}>
          <PirateBody />
        </group>
      )}
    </group>
  );
}

/** Wraps a newly-placed piece's body in a drop-in + scale-in lerp (requirement 4). Lazily captures
 *  "now" the first time THIS component instance renders — since each piece gets a stable React `key`
 *  (`${id}-${i}`, same convention `board/Pieces.tsx` uses), a fresh key mounts a fresh instance (and
 *  therefore a fresh animation start), while a piece that merely re-renders (some unrelated prop
 *  changed upstream) keeps its already-captured start time and reads as already-settled — mirroring
 *  the flat SVG board's `hexhaven-piece-pop` CSS class, which likewise only (re)plays when its DOM
 *  node is (re)created, not on every re-render. */
function PlacementGroup({
  position,
  rotationY = 0,
  reducedMotion,
  children,
}: {
  position: WorldVec3;
  rotationY?: number;
  reducedMotion: boolean;
  children: ReactNode;
}) {
  const groupRef = useRef<Group>(null);
  const startRef = useRef<number | null>(null);
  if (startRef.current === null) startRef.current = performance.now();

  useFrame(() => {
    if (reducedMotion) return;
    const group = groupRef.current;
    if (!group) return;
    const elapsed = performance.now() - (startRef.current ?? 0);
    const progress = Math.min(1, elapsed / PLACEMENT_DURATION_MS);
    group.scale.setScalar(placementScale(progress));
    group.position.set(position.x, position.y + placementDropOffset(progress, DROP_HEIGHT), position.z);
  });

  const initialScale = reducedMotion ? 1 : placementScale(0);
  const initialY = reducedMotion ? position.y : position.y + placementDropOffset(0, DROP_HEIGHT);

  return (
    <group
      ref={groupRef}
      position={[position.x, initialY, position.z]}
      rotation={[0, rotationY, 0]}
      scale={initialScale}
    >
      {children}
    </group>
  );
}

/** Wraps the robber (or any future hopping piece) in a hop/slide animation (requirement 4) that
 *  starts whenever `hexKey` changes to a NEW value with a non-zero offset — i.e. an actual move, not
 *  the piece's initial appearance (`board/Pieces.tsx`'s own robber has no entrance animation either;
 *  `robberHopOffset` returns `null`/a zero offset when there's no previous hex to hop from). The
 *  `hexKey !== seenKeyRef.current` check is React's documented "derive state during render from a
 *  changed prop" pattern (cheaper than an effect + extra render round-trip for something this
 *  latency-sensitive) — safe because it's idempotent per render and never loops. */
function HopGroup({
  hexKey,
  offsetDx,
  offsetDz,
  targetPosition,
  reducedMotion,
  arcHeight,
  children,
}: {
  hexKey: HexId;
  offsetDx: number;
  offsetDz: number;
  targetPosition: WorldVec3;
  reducedMotion: boolean;
  arcHeight: number;
  children: ReactNode;
}) {
  const groupRef = useRef<Group>(null);
  const seenKeyRef = useRef<HexId>(hexKey);
  const hopRef = useRef<{ dx: number; dz: number; start: number } | null>(null);

  if (hexKey !== seenKeyRef.current) {
    seenKeyRef.current = hexKey;
    hopRef.current =
      !reducedMotion && (offsetDx !== 0 || offsetDz !== 0)
        ? { dx: offsetDx, dz: offsetDz, start: performance.now() }
        : null;
  }

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const hop = hopRef.current;
    if (!hop) {
      group.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
      return;
    }
    const progress = Math.min(1, (performance.now() - hop.start) / HOP_DURATION_MS);
    const offset = hopOffset(progress, hop.dx, hop.dz, arcHeight);
    group.position.set(targetPosition.x + offset.x, targetPosition.y + offset.y, targetPosition.z + offset.z);
    if (progress >= 1) hopRef.current = null;
  });

  return (
    <group ref={groupRef} position={[targetPosition.x, targetPosition.y, targetPosition.z]}>
      {children}
    </group>
  );
}
