// Explorers & Pirates board pieces (T-1108 requirement D). Same `renderToStaticMarkup`/node-env
// convention as `TradersBarbariansPieces.test.ts` — no jsdom, no interaction, mock props only.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GEOMETRY, type Seat, type VertexId } from '@hexhaven/shared';
import { ExplorersPiratesPieces } from './ExplorersPiratesPieces';
import { HEX_SIZE, PLAYER_COLORS } from './palette';
import { boardProjection } from './projection';

const VERTEX_A = GEOMETRY.vertices[0]!.id as VertexId;
const VERTEX_B = GEOMETRY.vertices[1]!.id as VertexId;

const px = (n: number) => n * HEX_SIZE;
function rawVertex(vid: VertexId) {
  const v = GEOMETRY.vertices[vid]!;
  return { x: px(v.x), y: px(v.y) };
}

function render(props: Partial<Parameters<typeof ExplorersPiratesPieces>[0]> = {}) {
  return renderToStaticMarkup(createElement(ExplorersPiratesPieces, props));
}

describe('ExplorersPiratesPieces: draws nothing with no props (base/other-expansion boards unchanged)', () => {
  it('renders an empty group', () => {
    const html = render({});
    expect(html).not.toContain('data-testid="harbor-settlement-');
  });
});

describe('Harbor settlements (§EP4.2)', () => {
  it('renders one per entry, tagged with its owner seat', () => {
    const html = render({
      harborSettlements: [
        { vertex: VERTEX_A, seat: 0 as Seat },
        { vertex: VERTEX_B, seat: 2 as Seat },
      ],
    });
    expect(html).toContain('data-testid="harbor-settlement-0"');
    expect(html).toContain('data-testid="harbor-settlement-2"');
    expect(html).toContain('data-seat="0"');
    expect(html).toContain('data-seat="2"');
  });
});

describe('T-1212 "3D board": ExplorersPiratesPieces reprojection', () => {
  it('with 3D off (identity projection), the harbor settlement is the plain pre-phase-13 pentagon at the raw vertex point', () => {
    const raw = rawVertex(VERTEX_A);
    const s = HEX_SIZE * 0.24;
    const pts = `${raw.x - s},${raw.y + s} ${raw.x - s},${raw.y - s * 0.2} ${raw.x},${raw.y - s} ${raw.x + s},${raw.y - s * 0.2} ${raw.x + s},${raw.y + s}`;
    const html = render({ harborSettlements: [{ vertex: VERTEX_A, seat: 0 as Seat }], projection: boardProjection(false) });
    expect(html).toContain(`points="${pts}"`);
    expect(html).toContain(`fill="${PLAYER_COLORS[0]}"`);
    expect(html.match(/<polygon/g)?.length).toBe(1);
  });

  it('with 3D on, the harbor settlement stands on a two-tone wall+roof (not the flat single-fill pentagon)', () => {
    const html = render({ harborSettlements: [{ vertex: VERTEX_A, seat: 0 as Seat }], projection: boardProjection(true) });
    expect(html.match(/<polygon/g)?.length).toBe(2); // wall + roof
    expect(html).not.toContain(`fill="${PLAYER_COLORS[0]}"`); // both faces are shaded, not the plain seat fill
  });

  it('3D on differs from 3D off for the same props', () => {
    const props = { harborSettlements: [{ vertex: VERTEX_A, seat: 0 as Seat }] };
    const flat = render({ ...props, projection: boardProjection(false) });
    const tilted = render({ ...props, projection: boardProjection(true) });
    expect(tilted).not.toBe(flat);
  });
});
