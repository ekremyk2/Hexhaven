// A number token on a hex tile (T-1400 requirement 5) — a billboarded textured quad so it stays
// legible as the camera orbits (drei's `<Billboard>` rotates it to face the camera every frame; pure
// three.js/drei, no network fetch). The texture itself (value + red-for-6/8 + pip dots, or a "?" for
// `hidden`) comes from `numberTexture.ts`'s canvas drawer, cached there.
import { Billboard } from '@react-three/drei';
import { useMemo } from 'react';
import { DoubleSide } from 'three';
import { TOKEN_RADIUS } from './constants';
import { numberTokenTexture } from './numberTexture';

export interface NumberToken3DProps {
  position: readonly [number, number, number];
  /** The rolled number; omitted/null only when `hidden` (withheld during blind setup placement). */
  value?: number | null;
  hidden?: boolean;
  /** The robber sits on this hex — dims the token, mirrors `BoardView`'s `NumberToken` prop. */
  dimmed?: boolean;
}

export function NumberToken3D({ position, value = null, hidden = false, dimmed = false }: NumberToken3DProps) {
  const texture = useMemo(() => numberTokenTexture(value, hidden, dimmed), [value, hidden, dimmed]);
  return (
    <Billboard position={[position[0], position[1], position[2]]}>
      <mesh userData={{ isNumberToken: true }}>
        <planeGeometry args={[TOKEN_RADIUS * 2, TOKEN_RADIUS * 2]} />
        <meshBasicMaterial map={texture} transparent side={DoubleSide} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}
