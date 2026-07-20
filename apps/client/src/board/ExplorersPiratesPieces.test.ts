// Explorers & Pirates board pieces (T-1108 requirement D). Same `renderToStaticMarkup`/node-env
// convention as `TradersBarbariansPieces.test.ts` — no jsdom, no interaction, mock props only.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GEOMETRY, type Seat, type VertexId } from '@hexhaven/shared';
import { ExplorersPiratesPieces } from './ExplorersPiratesPieces';
import { HEX_SIZE, PLAYER_COLORS } from './palette';

const VERTEX_A = GEOMETRY.vertices[0]!.id as VertexId;
const VERTEX_B = GEOMETRY.vertices[1]!.id as VertexId;

const px = (n: number) => n * HEX_SIZE;
function vertexPoint(vid: VertexId) {
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

  it('renders the plain flat pentagon (single polygon) at the vertex point, in the owner seat colour', () => {
    const p = vertexPoint(VERTEX_A);
    const s = HEX_SIZE * 0.24;
    const pts = `${p.x - s},${p.y + s} ${p.x - s},${p.y - s * 0.2} ${p.x},${p.y - s} ${p.x + s},${p.y - s * 0.2} ${p.x + s},${p.y + s}`;
    const html = render({ harborSettlements: [{ vertex: VERTEX_A, seat: 0 as Seat }] });
    expect(html).toContain(`points="${pts}"`);
    expect(html).toContain(`fill="${PLAYER_COLORS[0]}"`);
    expect(html.match(/<polygon/g)?.length).toBe(1);
  });
});
