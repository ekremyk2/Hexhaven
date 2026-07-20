// T-304 requirement 5 tests for the presentational layer. Like apps/client/src/ui/primitives.test.ts
// (see its header comment), this workspace's vitest runs under the `node` environment with no
// jsdom/@testing-library, so real pointer/click events can't be simulated here — instead this
// asserts on the static markup `renderToStaticMarkup` produces: which hit-areas are actually
// clickable (`pointer-events` gating IS the click gate — a browser never delivers a click to a
// `pointer-events:none` element) and which legal targets get a ghost highlight. Click -> Action
// dispatch and Escape-cancel are the same underlying logic (`resolvePick`/`computeUiTargets`),
// covered directly in `store/uiMode.test.ts`; a live click/Escape walkthrough is a PM dev-server
// check (see the task's Implementation notes).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import { InteractionLayer } from './InteractionLayer';
import { PLAYER_COLORS } from './palette';

const GHOST_COLOR = PLAYER_COLORS[0];

function render(props: Partial<Parameters<typeof InteractionLayer>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(InteractionLayer, {
      mode: null,
      targets: new Set<number>(),
      onPick: () => {},
      ghostColor: GHOST_COLOR,
      ...props,
    }),
  );
}

/** Occurrences of an exact attribute-value substring (avoids matching the embedded `<style>`
 * text, which also contains the bare class name as a CSS selector). */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('InteractionLayer: guard rail — not the viewer\'s decision (requirement 3/5)', () => {
  it('mode=null renders nothing interactive: every hit-area is pointer-events:none', () => {
    const html = render({ mode: null, targets: new Set() });
    expect(count(html, 'pointer-events:fill')).toBe(0);
    expect(count(html, 'pointer-events:stroke')).toBe(0);
    // one hit-area per vertex/edge/hex, all inert, plus the (always inert) ghost group wrapper.
    expect(count(html, 'pointer-events:none')).toBe(
      GEOMETRY.vertices.length + GEOMETRY.edges.length + GEOMETRY.hexes.length + 1,
    );
  });

  it('mode=null draws no ghost highlights even if a stale `targets` set is passed', () => {
    const staleVertexIds = new Set([GEOMETRY.vertices[0]!.id, GEOMETRY.vertices[1]!.id]);
    const html = render({ mode: null, targets: staleVertexIds });
    expect(count(html, 'class="hexhaven-legal-pulse"')).toBe(0);
  });
});

describe('InteractionLayer: only ids in `targets` are interactive (requirement 1)', () => {
  it('vertex mode: exactly the targeted vertices get pointer-events:fill + a ghost', () => {
    const ids = [GEOMETRY.vertices[3]!.id, GEOMETRY.vertices[9]!.id, GEOMETRY.vertices[40]!.id];
    const html = render({ mode: 'vertex', targets: new Set(ids) });
    expect(count(html, 'pointer-events:fill')).toBe(ids.length);
    expect(count(html, 'class="hexhaven-legal-pulse"')).toBe(ids.length);
    // every other vertex, plus every edge/hex hit-area, stays inert (+1 for the ghost wrapper).
    expect(count(html, 'pointer-events:none')).toBe(
      GEOMETRY.vertices.length - ids.length + GEOMETRY.edges.length + GEOMETRY.hexes.length + 1,
    );
  });

  it('edge mode: exactly the targeted edges get pointer-events:stroke + a ghost; vertices/hexes stay inert', () => {
    const ids = [GEOMETRY.edges[5]!.id, GEOMETRY.edges[20]!.id];
    const html = render({ mode: 'edge', targets: new Set(ids) });
    expect(count(html, 'pointer-events:stroke')).toBe(ids.length);
    expect(count(html, 'pointer-events:fill')).toBe(0); // no vertex/hex is active in edge mode
    expect(count(html, 'class="hexhaven-legal-pulse"')).toBe(ids.length);
  });

  it('hex mode: exactly the targeted hexes get pointer-events:fill + a ghost; vertices/edges stay inert', () => {
    const ids = [GEOMETRY.hexes[0]!.id, GEOMETRY.hexes[9]!.id, GEOMETRY.hexes[18]!.id];
    const html = render({ mode: 'hex', targets: new Set(ids) });
    expect(count(html, 'pointer-events:fill')).toBe(ids.length);
    expect(count(html, 'pointer-events:stroke')).toBe(0); // no edge is active in hex mode
    expect(count(html, 'class="hexhaven-legal-pulse"')).toBe(ids.length);
  });

  it('a category mismatch (vertex ids passed under hex mode) leaves everything inert', () => {
    // Ids are branded numbers, not distinct runtime types — pick vertex ids OUTSIDE the 0..18
    // hex-id range so this genuinely tests "wrong category", not an incidental numeric collision
    // between a vertex id and a same-valued hex id (real callers only ever pair `mode` with a
    // `targets` set computeUiTargets built FOR that same mode, so this pairing can't arise there).
    const vertexIds = [GEOMETRY.vertices[30]!.id, GEOMETRY.vertices[40]!.id];
    const html = render({ mode: 'hex', targets: new Set(vertexIds) });
    expect(count(html, 'pointer-events:fill')).toBe(0);
    expect(count(html, 'class="hexhaven-legal-pulse"')).toBe(0);
  });
});

describe('InteractionLayer: renders every id (budget, docs/11 §6)', () => {
  it('renders exactly one hit-area per geometry vertex/edge/hex', () => {
    const html = render({ mode: null, targets: new Set() });
    expect(count(html, '<circle')).toBe(GEOMETRY.vertices.length);
    expect(count(html, '<line')).toBe(GEOMETRY.edges.length);
    expect(count(html, '<polygon')).toBe(GEOMETRY.hexes.length);
  });
});
