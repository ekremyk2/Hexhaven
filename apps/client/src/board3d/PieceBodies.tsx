// The actual 3D geometry for each piece type (T-1401 requirement 2), reproducing `board/Pieces.tsx`'s
// SVG silhouettes as real meshes: settlement = house (walls + pitched roof), city = clearly larger
// multi-part building (wider base + a short secondary tower + a taller main tower + roof cap), road =
// a beveled/rounded bar, ship = hull + mast + sail, robber/pirate = standing pieces distinct from each
// other. Every body is built from three.js PRIMITIVE geometries only (box/cone/cylinder/sphere +
// one flat `ShapeGeometry` for the sail) — deliberately no custom hand-derived `ExtrudeGeometry`
// transform like `hexGeometryBuilders.ts`'s: this task (like T-1400) cannot be visually verified in
// this sandbox, and a primitive's orientation is a three.js built-in guarantee, not a hand-rotated
// axis mapping that could be silently wrong. `side={DoubleSide}` on every material for the same
// defensive reason `Board3D.tsx`/`HexTiles.tsx`/`Sea.tsx` already give (T-1400 top-of-file note).
//
// Local space convention: every body is authored with its OWN origin at "ground level" (y=0 = the
// vertex/edge/hex surface it stands on) — the caller (`Pieces3D.tsx`'s `PlacementGroup`/`HopGroup`)
// positions/rotates/animates the WRAPPING group, never these meshes directly.
//
// Colour: two-tone shading mirrors `board/Pieces.tsx`'s own convention exactly — `darken`/`lighten`
// (from `board/palette.ts`) derive a "shadow wall" and "lit roof" shade from the seat's own base
// colour, so no piece needs a hand-picked second colour. Seat colour is the primary identity signal
// (requirement 5); shape differs per piece TYPE (house vs tower-building vs bar vs hull), which is
// the "distinct silhouette per piece type" fallback the requirement allows in lieu of 3D shape badges
// (a flat text badge glyph doesn't read at oblique 3D camera angles the way it does on a 2D SVG).
import { useMemo } from 'react';
import { DoubleSide, Shape } from 'three';
import { HEX_SIZE as S, darken, lighten } from '../board/palette';

/** Mirrors `board/Pieces.tsx`'s own (module-private) shading amounts exactly, so a piece's 3D body
 *  reads at the same lit/shadow contrast as its flat SVG counterpart. Duplicated here rather than
 *  imported since the SVG file doesn't export them (they're `Pieces.tsx`-local tuning constants). */
const WALL_DARKEN = 0.4;
const ROOF_LIGHTEN = 0.34;

const MATERIAL_DEFAULTS = { roughness: 0.72, metalness: 0.06 } as const;

/** A settlement — a small house: a box wall (shadow-shade of the seat colour) topped by a
 *  4-sided pyramid roof (lit-shade), matching `Settlement`'s wall/roof two-tone split in the SVG. */
export function SettlementBody({ color }: { color: string }) {
  const wallW = S * 0.36;
  const wallD = S * 0.32;
  const wallH = S * 0.22;
  const roofH = S * 0.17;
  const roofRadius = Math.hypot(wallW / 2, wallD / 2) * 1.05;
  const wallColor = darken(color, WALL_DARKEN);
  const roofColor = lighten(color, ROOF_LIGHTEN);
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, wallH / 2, 0]}>
        <boxGeometry args={[wallW, wallH, wallD]} />
        <meshStandardMaterial color={wallColor} {...MATERIAL_DEFAULTS} side={DoubleSide} />
      </mesh>
      {/* 4-segment cone == a square pyramid; rotate 45° so its faces align with the box's sides
          rather than its corners. */}
      <mesh castShadow receiveShadow position={[0, wallH + roofH / 2, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[roofRadius, roofH, 4]} />
        <meshStandardMaterial color={roofColor} roughness={0.65} metalness={0.04} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** A city — requirement 2's "clearly larger, multi-part (towers/larger footprint)": a wider/taller
 *  base wall than `SettlementBody`'s, plus a short secondary tower and a taller main tower (with its
 *  own roof cap) — both footprint and overall height end up noticeably bigger than a settlement's. */
export function CityBody({ color }: { color: string }) {
  const baseW = S * 0.5;
  const baseD = S * 0.4;
  const baseH = S * 0.34;
  const towerR = S * 0.15;
  const towerH = S * 0.3;
  const tower2R = S * 0.12;
  const tower2H = S * 0.16;
  const roofH = towerR * 1.3;
  const wallColor = darken(color, WALL_DARKEN);
  const roofColor = lighten(color, ROOF_LIGHTEN);
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, baseH / 2, 0]}>
        <boxGeometry args={[baseW, baseH, baseD]} />
        <meshStandardMaterial color={wallColor} {...MATERIAL_DEFAULTS} side={DoubleSide} />
      </mesh>
      {/* Secondary (shorter) tower — same shadow shade as the base wall. */}
      <mesh castShadow receiveShadow position={[baseW * 0.22, baseH + tower2H / 2, 0]}>
        <cylinderGeometry args={[tower2R, tower2R, tower2H, 12]} />
        <meshStandardMaterial color={wallColor} {...MATERIAL_DEFAULTS} side={DoubleSide} />
      </mesh>
      {/* Main (taller) tower — base seat colour, its own lit roof cap on top. */}
      <mesh castShadow receiveShadow position={[-baseW * 0.2, baseH + towerH / 2, 0]}>
        <cylinderGeometry args={[towerR, towerR, towerH, 12]} />
        <meshStandardMaterial color={color} {...MATERIAL_DEFAULTS} side={DoubleSide} />
      </mesh>
      <mesh castShadow receiveShadow position={[-baseW * 0.2, baseH + towerH + roofH / 2, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[towerR * 1.25, roofH, 4]} />
        <meshStandardMaterial color={roofColor} roughness={0.65} metalness={0.04} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** A road — a beveled/rounded bar (requirement 2), oriented along local +X (the caller's wrapping
 *  group carries the edge's `rotationY` so +X already points along the edge direction — see
 *  `coords.ts`'s `edgeWorldPosition` doc comment for that derivation). Rounded end-caps (matching the
 *  flat SVG's `rx` rounded-rect) are the "bevel" read in 3D. */
export function RoadBody({ color }: { color: string }) {
  const len = S * 0.66;
  const width = S * 0.17;
  const height = S * 0.12;
  const barLen = len - width;
  return (
    <group position={[0, height / 2, 0]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[barLen, height, width]} />
        <meshStandardMaterial color={color} {...MATERIAL_DEFAULTS} side={DoubleSide} />
      </mesh>
      <mesh castShadow receiveShadow position={[-barLen / 2, 0, 0]}>
        <cylinderGeometry args={[width / 2, width / 2, height, 12]} />
        <meshStandardMaterial color={color} {...MATERIAL_DEFAULTS} side={DoubleSide} />
      </mesh>
      <mesh castShadow receiveShadow position={[barLen / 2, 0, 0]}>
        <cylinderGeometry args={[width / 2, width / 2, height, 12]} />
        <meshStandardMaterial color={color} {...MATERIAL_DEFAULTS} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** Builds the flat triangular sail shape once (memoized by the caller) — a `THREE.Shape` lies in its
 *  local XY plane with its face normal along local Z, which (unrotated) is already a vertical plane
 *  facing "across" the ship's beam — exactly how a sail should be viewed from the side, with no
 *  rotation math needed (unlike `hexGeometryBuilders.ts`'s hex prism, which extrudes into a
 *  ground-plane footprint and therefore DOES need the `Rx(-90°)` remap). */
function useSailShape(width: number, height: number): Shape {
  return useMemo(() => {
    const shape = new Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0, height);
    shape.lineTo(width, height * 0.18);
    shape.closePath();
    return shape;
  }, [width, height]);
}

/** Shared hull (requirement 2's "hull + sail") used by both the owner-coloured `Ship` and the
 *  neutral dark `Pirate` — a rectangular hull box with a diamond-rotated "bow" box chamfering the
 *  front end (reads as a pointed prow from above without any custom extrude geometry), plus a
 *  darker freeboard sliver hanging below the waterline (mirrors the SVG `Ship`/`Pirate`'s own
 *  freeboard shading). */
function Hull({ hullColor, freeboardColor }: { hullColor: string; freeboardColor: string }) {
  const hullLen = S * 0.5;
  const hullBeam = S * 0.22;
  const hullDraft = S * 0.16;
  const bowSize = hullBeam * 0.95;
  return (
    <group position={[0, hullDraft / 2, 0]}>
      <mesh castShadow receiveShadow position={[-hullLen * 0.12, 0, 0]}>
        <boxGeometry args={[hullLen * 0.8, hullDraft, hullBeam]} />
        <meshStandardMaterial color={hullColor} roughness={0.6} metalness={0.05} side={DoubleSide} />
      </mesh>
      {/* Bow: a box rotated 45° about Y so its corner points forward — a simple, low-risk chamfer
          (no custom geometry/rotation-sensitive math) that reads as a pointed prow from above. */}
      <mesh castShadow receiveShadow position={[hullLen * 0.36, 0, 0]} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[bowSize, hullDraft, bowSize]} />
        <meshStandardMaterial color={hullColor} roughness={0.6} metalness={0.05} side={DoubleSide} />
      </mesh>
      {/* Freeboard: darker sliver below the waterline — visible hull thickness, same shading
          language as the flat SVG's `Ship`/`Pirate` freeboard path. */}
      <mesh castShadow receiveShadow position={[-hullLen * 0.05, -hullDraft * 0.55, 0]}>
        <boxGeometry args={[hullLen * 0.7, hullDraft * 0.5, hullBeam * 0.75]} />
        <meshStandardMaterial color={freeboardColor} roughness={0.7} metalness={0.03} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** A ship — `Hull` (owner-coloured) + a mast + a lit-shade triangular sail (requirement 2). */
export function ShipBody({ color }: { color: string }) {
  const hullDraft = S * 0.16;
  const mastHeight = S * 0.34;
  const mastX = -S * 0.07;
  const sailColor = lighten(color, ROOF_LIGHTEN);
  const sailShape = useSailShape(S * 0.24, mastHeight * 0.62);
  return (
    <group>
      <Hull hullColor={color} freeboardColor={darken(color, WALL_DARKEN)} />
      <mesh castShadow position={[mastX, hullDraft, mastHeight / 2]}>
        {/* Cylinder default axis is local Y (up) — no rotation needed for a vertical mast. */}
        <cylinderGeometry args={[S * 0.015, S * 0.015, mastHeight, 6]} />
        <meshStandardMaterial color="#5b3d22" roughness={0.85} metalness={0.02} />
      </mesh>
      <mesh castShadow position={[mastX, hullDraft, 0]}>
        <shapeGeometry args={[sailShape]} />
        <meshStandardMaterial color={sailColor} roughness={0.85} metalness={0} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** Neutral colours (no seat owns the robber/pirate) — dark stone/wood + near-black hull, distinct
 *  from every possible seat colour in `board/palette.ts`'s `PLAYER_COLORS`. */
const ROBBER_COLOR = '#3a352c';
const PIRATE_HULL_COLOR = '#211d17';
const PIRATE_FREEBOARD_COLOR = '#12100c';
const PIRATE_FLAG_COLOR = '#12100c';

/** The robber — a standing pawn (cone body + sphere head), visually distinct from `PirateBody`'s
 *  hull-and-flag silhouette (requirement 2's "robber/pirate ... visually distinct"). Always the same
 *  neutral colour regardless of seat (the robber has no owner). */
export function RobberBody() {
  const bodyH = S * 0.3;
  const bodyR = S * 0.16;
  const headR = S * 0.1;
  return (
    <group>
      <mesh castShadow receiveShadow position={[0, bodyH / 2, 0]}>
        <coneGeometry args={[bodyR, bodyH, 14]} />
        <meshStandardMaterial color={ROBBER_COLOR} roughness={0.55} metalness={0.15} side={DoubleSide} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, bodyH + headR * 0.85, 0]}>
        <sphereGeometry args={[headR, 14, 12]} />
        <meshStandardMaterial color={ROBBER_COLOR} roughness={0.45} metalness={0.2} side={DoubleSide} />
      </mesh>
    </group>
  );
}

/** The pirate (Seafarers) — `Hull` in near-black tones + a mast flying a dark flag with a small pale
 *  "skull" dot (mirrors the flat SVG `Pirate`'s flag+dot), deliberately UNLIKE `RobberBody`'s pawn
 *  silhouette so the two read as different threats on the same board (requirement 2). */
export function PirateBody() {
  const hullDraft = S * 0.16;
  const mastHeight = S * 0.3;
  const mastX = 0;
  return (
    <group>
      <Hull hullColor={PIRATE_HULL_COLOR} freeboardColor={PIRATE_FREEBOARD_COLOR} />
      <mesh castShadow position={[mastX, hullDraft, 0]}>
        <cylinderGeometry args={[S * 0.016, S * 0.016, mastHeight, 6]} />
        <meshStandardMaterial color="#12100c" roughness={0.8} metalness={0.05} />
      </mesh>
      {/* Flag: a thin box near the masthead, angled outward. */}
      <mesh castShadow position={[mastX + S * 0.09, hullDraft + mastHeight * 0.42, 0]} rotation={[0, 0, -0.15]}>
        <boxGeometry args={[S * 0.18, S * 0.1, S * 0.01]} />
        <meshStandardMaterial color={PIRATE_FLAG_COLOR} roughness={0.9} metalness={0} side={DoubleSide} />
      </mesh>
      {/* Skull dot — small pale sphere on the flag, matching the SVG's accent circle. */}
      <mesh position={[mastX + S * 0.09, hullDraft + mastHeight * 0.42, S * 0.007]}>
        <sphereGeometry args={[S * 0.018, 8, 8]} />
        <meshStandardMaterial color="#f7f1e3" roughness={0.6} metalness={0} />
      </mesh>
    </group>
  );
}
