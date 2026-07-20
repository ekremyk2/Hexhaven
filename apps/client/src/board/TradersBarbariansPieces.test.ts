// Traders & Barbarians board pieces (T-1008 requirement D). Same `renderToStaticMarkup`/node-env
// convention as `CitiesKnightsPieces.test.ts` — no jsdom, no interaction, mock props only.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GEOMETRY, type EdgeId, type HexId, type Seat, type VertexId } from '@hexhaven/shared';
import { TradersBarbariansPieces } from './TradersBarbariansPieces';
import { HEX_SIZE } from './palette';
import { boardProjection } from './projection';

const HEX_A = GEOMETRY.hexes[0]!.id as HexId;
const EDGE_A = GEOMETRY.edges[0]!.id as EdgeId;
const VERTEX_A = GEOMETRY.vertices[0]!.id as VertexId;

const px = (n: number) => n * HEX_SIZE;
function rawEdge(eid: EdgeId) {
  const e = GEOMETRY.edges[eid]!;
  return { x: px(e.x), y: px(e.y), angleDeg: e.angleDeg };
}

function render(props: Partial<Parameters<typeof TradersBarbariansPieces>[0]> = {}) {
  return renderToStaticMarkup(createElement(TradersBarbariansPieces, props));
}

describe('TradersBarbariansPieces: draws nothing with no props (base/other-expansion boards unchanged)', () => {
  it('renders an empty group', () => {
    const html = render({});
    expect(html).not.toContain('data-testid="tb-');
  });
});

describe('Fishermen (§TB2.1/§TB2.2)', () => {
  it('renders the Lake glyph + a fishing-ground marker', () => {
    const html = render({ lakeHex: HEX_A, fishingGrounds: [{ token: 6, vertices: [VERTEX_A, GEOMETRY.vertices[1]!.id as VertexId] }] });
    expect(html).toContain(`data-testid="tb-lake-${HEX_A}"`);
    expect(html).toContain('data-testid="tb-fishing-ground-6"');
  });
});

describe('Rivers (§TB3.1/§TB3.2)', () => {
  it('renders a bridge tagged with its owner seat', () => {
    const html = render({ bridges: [{ edge: EDGE_A, seat: 2 as Seat }] });
    expect(html).toContain(`data-testid="tb-bridge-${EDGE_A}"`);
    expect(html).toContain('data-seat="2"');
  });
});

describe('Caravans (§TB4.1-§TB4.3)', () => {
  it('renders the Oasis glyph + a camel', () => {
    const html = render({ oasisHex: HEX_A, camels: [EDGE_A] });
    expect(html).toContain(`data-testid="tb-oasis-${HEX_A}"`);
    expect(html).toContain(`data-testid="tb-camel-${EDGE_A}"`);
  });
});

describe('Barbarian Attack (§TB5.2)', () => {
  it('renders a barbarian on its hex + an edge-based knight tagged active/seat', () => {
    const html = render({
      barbarianHexes: [HEX_A],
      tbKnights: [{ edge: EDGE_A, seat: 3 as Seat, active: true }],
    });
    expect(html).toContain(`data-testid="tb-barbarian-${HEX_A}"`);
    expect(html).toContain(`data-testid="tb-knight-${EDGE_A}"`);
    expect(html).toContain('data-seat="3"');
    expect(html).toContain('data-active="true"');
  });
});

describe('The main scenario (§TB6.1-§TB6.3)', () => {
  it('renders a trade hex, a wagon, and a path barbarian', () => {
    const html = render({
      tradeHexes: [{ hex: HEX_A, kind: 'quarry' }],
      wagons: [{ at: VERTEX_A, seat: 1 as Seat, cargo: null }],
      pathBarbarians: [EDGE_A],
    });
    expect(html).toContain(`data-testid="tb-trade-hex-${HEX_A}"`);
    expect(html).toContain('data-kind="quarry"');
    expect(html).toContain(`data-testid="tb-wagon-${VERTEX_A}"`);
    expect(html).toContain(`data-testid="tb-path-barbarian-${EDGE_A}"`);
  });
});

describe('T-1212 "3D board": TradersBarbariansPieces reprojection', () => {
  it('with 3D off (identity projection), a bridge renders the single pre-phase-13 rect anchored at the raw edge point', () => {
    const raw = rawEdge(EDGE_A);
    const html = render({ bridges: [{ edge: EDGE_A, seat: 2 as Seat }], projection: boardProjection(false) });
    expect(html).toContain(`transform="translate(${raw.x} ${raw.y}) rotate(${raw.angleDeg})"`);
    expect(html.match(/<rect/g)?.length).toBe(1);
  });

  it('with 3D on, a bridge renders TWO stacked faces (visible thickness), mirroring Pieces.tsx\'s RoadBody', () => {
    const html = render({ bridges: [{ edge: EDGE_A, seat: 2 as Seat }], projection: boardProjection(true) });
    expect(html.match(/<rect/g)?.length).toBe(2);
  });

  it('flat-on-tile markers (lake glyph) never gain a ground shadow even with 3D on', () => {
    const html = render({ lakeHex: HEX_A, projection: boardProjection(true) });
    expect(html).not.toContain('<ellipse');
  });

  it('piece-like markers (barbarian, camel, tb-knight, wagon) gain a ground-shadow ellipse only when 3D is on', () => {
    const props = {
      barbarianHexes: [HEX_A],
      camels: [EDGE_A],
      tbKnights: [{ edge: EDGE_A, seat: 0 as Seat, active: true }],
      wagons: [{ at: VERTEX_A, seat: 1 as Seat, cargo: null }],
    };
    const flat = render({ ...props, projection: boardProjection(false) });
    const tilted = render({ ...props, projection: boardProjection(true) });
    expect(flat).not.toContain('<ellipse');
    expect(tilted.match(/<ellipse/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('a wagon standing on 3D shows two-tone base+roof rects instead of the flat single-fill rect', () => {
    const flat = render({ wagons: [{ at: VERTEX_A, seat: 1 as Seat, cargo: null }], projection: boardProjection(false) });
    const tilted = render({ wagons: [{ at: VERTEX_A, seat: 1 as Seat, cargo: null }], projection: boardProjection(true) });
    expect(flat.match(/<rect/g)?.length).toBe(1);
    expect(tilted.match(/<rect/g)?.length).toBe(2);
  });

  it('the aggregate with 3D off is otherwise unaffected: same testids/data-attrs as always', () => {
    const html = render({
      lakeHex: HEX_A,
      bridges: [{ edge: EDGE_A, seat: 2 as Seat }],
      barbarianHexes: [HEX_A],
      projection: boardProjection(false),
    });
    expect(html).toContain(`data-testid="tb-lake-${HEX_A}"`);
    expect(html).toContain(`data-testid="tb-bridge-${EDGE_A}"`);
    expect(html).toContain(`data-testid="tb-barbarian-${HEX_A}"`);
  });
});
