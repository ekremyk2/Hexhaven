// Explorers & Pirates board pieces (T-1108 requirement D). Same `renderToStaticMarkup`/node-env
// convention as `TradersBarbariansPieces.test.ts` — no jsdom, no interaction, mock props only.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GEOMETRY, type Seat, type VertexId } from '@hexhaven/shared';
import { ExplorersPiratesPieces } from './ExplorersPiratesPieces';

const VERTEX_A = GEOMETRY.vertices[0]!.id as VertexId;
const VERTEX_B = GEOMETRY.vertices[1]!.id as VertexId;

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
