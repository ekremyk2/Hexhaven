// <InteractionLayer> — the topmost BoardView layer (T-304, docs/02 §8, docs/11 §5): generous
// invisible hit-areas over every vertex/edge/hex, pointer-events gated to the active category AND
// to ids in `targets` (only legal targets are ever clickable), with a soft pulsing ghost preview
// on every legal target that solidifies on hover. Pure/presentational — no store access; callers
// (the fixture page here, later T-403's real board) supply `mode`/`targets`/`onPick` themselves,
// e.g. from `src/store/uiMode.ts`'s `useUiInteraction()`.

import { useEffect, useState } from 'react';
import { GEOMETRY, type BoardGeometry } from '@hexhaven/shared';
import { HEX_SIZE } from './palette';
import type { TargetMode } from '../store/uiMode';

const S = HEX_SIZE;
const px = (n: number) => n * S;

const HIT_VERTEX_R = 16; // requirement 1: "circles r≈16px"
const HIT_EDGE_WIDTH = 22; // requirement 1: "capsules (wide invisible strokes)"

export interface InteractionLayerProps {
  geometry?: BoardGeometry;
  /** Which category is currently listening; `null` means nothing is interactive (requirement 3's
   * guard rail — not the viewer's decision — resolves to this from the caller). */
  mode: TargetMode | null;
  /** Ids (within `mode`'s category) that are currently legal. Only these ever receive pointer
   * events or a ghost highlight — requirement 1: "**only** ids in targets are interactive". */
  targets: Set<number>;
  onPick: (id: number) => void;
  /** Ghost/hover highlight color — the acting seat's player color (palette.ts `PLAYER_COLORS`). */
  ghostColor: string;
}

/** docs/11 §5 motion catalog: "Legal targets: soft pulsing ghost (opacity 35→60%), 1.2s loop",
 * reduced to an instant static state under `prefers-reduced-motion` (§5 tail note). Scoped inline
 * so this component stays self-contained (no shared stylesheet edit needed for one recipe). */
const PULSE_CSS = `
  @keyframes hexhaven-legal-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.6; } }
  .hexhaven-legal-pulse { animation: hexhaven-legal-pulse 1.2s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .hexhaven-legal-pulse { animation: none; opacity: 0.48; }
  }
  /* Priority 4 / T-506 requirement 2 (mobile touch targets): the invisible hit areas grow under a
     COARSE pointer (touch) so vertex/edge taps are comfortable on a phone, without changing
     anything for a mouse — SVG geometry properties (r/stroke-width) are themselves CSS-settable
     (SVG2), so this is a pure CSS override with no JS/prop plumbing. Ghost ring sizes are untouched
     (still keyed off the base HIT_VERTEX_R/HIT_EDGE_WIDTH constants below) — only the actual
     clickable area grows. A NARROW-VIEWPORT rule is layered on alongside pointer:coarse: a desktop
     browser window resized down to phone width (or this app's own /styleguide "Mobile" preview, or
     an automated test driving a fixed-size viewport with a synthetic mouse) never reports a coarse
     pointer even though the same fat-finger-tolerance need applies -- sizing off viewport width,
     not merely input type, is what T-506 requirement 2 ("touch/small viewports") asks for. 767px
     matches every other mobile breakpoint in this app (md:, ui/Modal.tsx's bottom-sheet cutover).
     Both media queries resolve to the SAME enlarged values, so a touch phone in portrait (which
     satisfies both) doesn't get double-enlarged -- CSS just applies the one identical rule twice. */
  circle.hexhaven-hit-vertex { r: ${HIT_VERTEX_R}px; }
  line.hexhaven-hit-edge { stroke-width: ${HIT_EDGE_WIDTH}px; }
  @media (pointer: coarse), (max-width: 767px) {
    circle.hexhaven-hit-vertex { r: 24px; }
    line.hexhaven-hit-edge { stroke-width: 32px; }
  }
`;

function vertexPoint(geometry: BoardGeometry, id: number) {
  const v = geometry.vertices[id];
  if (!v) throw new Error(`BUG: vertex ${id}`);
  return { x: px(v.x), y: px(v.y) };
}

function hexPoints(geometry: BoardGeometry, hexId: number): string {
  const h = geometry.hexes[hexId];
  if (!h) throw new Error(`BUG: hex ${hexId}`);
  return h.vertices
    .map((vid) => {
      const p = vertexPoint(geometry, vid);
      return `${p.x},${p.y}`;
    })
    .join(' ');
}

export function InteractionLayer({
  geometry = GEOMETRY,
  mode,
  targets,
  onPick,
  ghostColor,
}: InteractionLayerProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  // A stale hover (e.g. the target set shrank after a server update) should never solidify a
  // ghost that's no longer legal.
  useEffect(() => {
    setHovered((h) => (h != null && targets.has(h) ? h : null));
  }, [mode, targets]);

  const clearHover = (id: number) => setHovered((cur) => (cur === id ? null : cur));

  return (
    <g className="hexhaven-interaction-layer">
      <style>{PULSE_CSS}</style>

      {/* Ghost previews — legal targets only, drawn under the hit areas so they never block them. */}
      <g style={{ pointerEvents: 'none' }}>
        {mode === 'hex' &&
          geometry.hexes
            .filter((h) => targets.has(h.id))
            .map((h) => (
              <HexGhost
                key={`gh${h.id}`}
                points={hexPoints(geometry, h.id)}
                color={ghostColor}
                solid={hovered === h.id}
              />
            ))}
        {mode === 'edge' &&
          geometry.edges
            .filter((e) => targets.has(e.id))
            .map((e) => (
              <EdgeGhost
                key={`ge${e.id}`}
                cx={px(e.x)}
                cy={px(e.y)}
                angleDeg={e.angleDeg}
                color={ghostColor}
                solid={hovered === e.id}
              />
            ))}
        {mode === 'vertex' &&
          geometry.vertices
            .filter((v) => targets.has(v.id))
            .map((v) => {
              const p = vertexPoint(geometry, v.id);
              return (
                <VertexGhost key={`gv${v.id}`} x={p.x} y={p.y} color={ghostColor} solid={hovered === v.id} />
              );
            })}
      </g>

      {/* Hit areas: every vertex/edge/hex renders one, but only the active category's legal ids
          accept pointer events (requirement 1) — everything else is `pointer-events: none`. */}
      <g>
        {geometry.hexes.map((h) => {
          const active = mode === 'hex' && targets.has(h.id);
          return (
            <polygon
              key={`hh${h.id}`}
              // T-501 e2e requirement 3: every hit-area carries a stable testid + a `data-active`
              // flag so a scripted click can target "whichever legal id happens to be first" for a
              // given seeded board (`HEXHAVEN_TEST_SEED`) without the test needing to know real ids —
              // only active/legal targets ever actually receive the click (pointerEvents below is
              // still the real gate), matching requirement 1/5's "only legal targets are ever
              // clickable" guarantee.
              data-testid={`hex-target-${h.id}`}
              data-active={active}
              points={hexPoints(geometry, h.id)}
              fill="transparent"
              style={{ pointerEvents: active ? 'fill' : 'none', cursor: active ? 'pointer' : 'default' }}
              onPointerEnter={() => active && setHovered(h.id)}
              onPointerLeave={() => clearHover(h.id)}
              onClick={() => active && onPick(h.id)}
              aria-hidden={!active}
            />
          );
        })}
        {geometry.edges.map((e) => {
          const active = mode === 'edge' && targets.has(e.id);
          const a = vertexPoint(geometry, e.a);
          const b = vertexPoint(geometry, e.b);
          return (
            <line
              key={`he${e.id}`}
              data-testid={`edge-target-${e.id}`}
              data-active={active}
              className="hexhaven-hit-edge"
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="transparent"
              strokeWidth={HIT_EDGE_WIDTH}
              strokeLinecap="round"
              style={{ pointerEvents: active ? 'stroke' : 'none', cursor: active ? 'pointer' : 'default' }}
              onPointerEnter={() => active && setHovered(e.id)}
              onPointerLeave={() => clearHover(e.id)}
              onClick={() => active && onPick(e.id)}
              aria-hidden={!active}
            />
          );
        })}
        {geometry.vertices.map((v) => {
          const active = mode === 'vertex' && targets.has(v.id);
          const p = vertexPoint(geometry, v.id);
          return (
            <circle
              key={`hv${v.id}`}
              data-testid={`vertex-target-${v.id}`}
              data-active={active}
              className="hexhaven-hit-vertex"
              cx={p.x}
              cy={p.y}
              r={HIT_VERTEX_R}
              fill="transparent"
              style={{ pointerEvents: active ? 'fill' : 'none', cursor: active ? 'pointer' : 'default' }}
              onPointerEnter={() => active && setHovered(v.id)}
              onPointerLeave={() => clearHover(v.id)}
              onClick={() => active && onPick(v.id)}
              aria-hidden={!active}
            />
          );
        })}
      </g>
    </g>
  );
}

function VertexGhost({ x, y, color, solid }: { x: number; y: number; color: string; solid: boolean }) {
  const r = HIT_VERTEX_R * 0.7;
  if (solid) {
    return <circle cx={x} cy={y} r={r} fill={color} fillOpacity={0.85} stroke={color} strokeWidth={2} />;
  }
  return (
    <circle
      cx={x}
      cy={y}
      r={r}
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeDasharray="4 3"
      className="hexhaven-legal-pulse"
    />
  );
}

function EdgeGhost({
  cx,
  cy,
  angleDeg,
  color,
  solid,
}: {
  cx: number;
  cy: number;
  angleDeg: number;
  color: string;
  solid: boolean;
}) {
  const len = S * 0.66;
  const w = S * 0.17;
  return (
    <g transform={`translate(${cx} ${cy}) rotate(${angleDeg})`}>
      {solid ? (
        <rect x={-len / 2} y={-w / 2} width={len} height={w} rx={w * 0.4} fill={color} fillOpacity={0.85} stroke={color} strokeWidth={1.5} />
      ) : (
        <rect
          x={-len / 2}
          y={-w / 2}
          width={len}
          height={w}
          rx={w * 0.4}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="5 4"
          className="hexhaven-legal-pulse"
        />
      )}
    </g>
  );
}

function HexGhost({ points, color, solid }: { points: string; color: string; solid: boolean }) {
  if (solid) {
    return <polygon points={points} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={2} />;
  }
  return (
    <polygon
      points={points}
      fill="none"
      stroke={color}
      strokeWidth={3}
      strokeDasharray="8 5"
      className="hexhaven-legal-pulse"
    />
  );
}
