// Cities & Knights board pieces (T-805, docs/rules/cities-knights-rules.md C4.6/C7/C9). Same
// `renderToStaticMarkup`/node-env convention as `Pieces.test.ts` — no jsdom, no interaction, mock
// props only (this task ships rendering-only components; T-806 wires the live store).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GEOMETRY, type Seat, type VertexId } from '@hexhaven/shared';
import { CitiesKnightsPieces, CityWall, KnightPiece, Metropolis } from './CitiesKnightsPieces';
import { HEX_SIZE, PLAYER_COLORS } from './palette';
import { KNIGHT_INACTIVE_FILL, TRACK_COLOR } from './citiesKnightsPalette';
import { boardProjection } from './projection';

const VERTEX_A = GEOMETRY.vertices[0]!.id as VertexId;
const VERTEX_B = GEOMETRY.vertices[1]!.id as VertexId;
const VERTEX_C = GEOMETRY.vertices[2]!.id as VertexId;

const px = (n: number) => n * HEX_SIZE;
function rawVertex(vid: VertexId) {
  const v = GEOMETRY.vertices[vid]!;
  return { x: px(v.x), y: px(v.y) };
}

function render(props: Partial<Parameters<typeof CitiesKnightsPieces>[0]> = {}) {
  return renderToStaticMarkup(createElement(CitiesKnightsPieces, props));
}

describe('CitiesKnightsPieces: draws nothing when no C&K state is supplied (base/Seafarers boards unchanged)', () => {
  it('renders an empty group with no props', () => {
    const html = render({});
    expect(html).not.toContain('data-testid="knight-');
    expect(html).not.toContain('data-testid="city-wall-');
    expect(html).not.toContain('data-testid="metropolis-');
  });
});

describe('KnightPiece (C7.1): level + active/inactive + owner color', () => {
  it('renders an active knight in full owner color with a level-tagged testid', () => {
    const html = renderToStaticMarkup(
      createElement(KnightPiece, { x: 10, y: 10, vertex: VERTEX_A, seat: 1 as Seat, level: 2, active: true }),
    );
    expect(html).toContain(`data-testid="knight-${VERTEX_A}"`);
    expect(html).toContain('data-level="2"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain(`fill="${PLAYER_COLORS[1]}"`);
  });

  it('renders an inactive knight desaturated (the "black & white side"), keeping owner color on the outline', () => {
    const html = renderToStaticMarkup(
      createElement(KnightPiece, { x: 10, y: 10, vertex: VERTEX_A, seat: 2 as Seat, level: 1, active: false }),
    );
    expect(html).toContain('data-active="false"');
    // Body fill is the shared muted tone, not the owner color…
    expect(html).toContain(`fill="${KNIGHT_INACTIVE_FILL}"`);
    // …but the shield outline still carries the owner's seat color (ownership stays legible).
    expect(html).toContain(`stroke="${PLAYER_COLORS[2]}"`);
  });

  it('draws one chevron per knight level (basic=1, strong=2, mighty=3)', () => {
    const basic = renderToStaticMarkup(
      createElement(KnightPiece, { x: 10, y: 10, vertex: VERTEX_A, seat: 0 as Seat, level: 1, active: true }),
    );
    const mighty = renderToStaticMarkup(
      createElement(KnightPiece, { x: 10, y: 10, vertex: VERTEX_A, seat: 0 as Seat, level: 3, active: true }),
    );
    const countPaths = (html: string) => (html.match(/<path/g) ?? []).length;
    expect(countPaths(mighty)).toBe(countPaths(basic) + 2);
  });

  it('the aggregate component renders one knight per entry, positioned via geometry', () => {
    const html = render({
      knights: [
        { vertex: VERTEX_A, seat: 0 as Seat, level: 1, active: true },
        { vertex: VERTEX_B, seat: 1 as Seat, level: 3, active: false },
      ],
    });
    expect(html).toContain(`data-testid="knight-${VERTEX_A}"`);
    expect(html).toContain(`data-testid="knight-${VERTEX_B}"`);
  });
});

describe('CityWall (C9.1): a neutral stone ring, not owner-colored', () => {
  it('renders under the given vertex, tagged with owner seat for test/debug hooks', () => {
    const html = renderToStaticMarkup(
      createElement(CityWall, { x: 10, y: 10, vertex: VERTEX_C, seat: 3 as Seat }),
    );
    expect(html).toContain(`data-testid="city-wall-${VERTEX_C}"`);
    expect(html).toContain('data-seat="3"');
    // Wall stroke is NOT the owner's seat color (it's a fortification, not identity art).
    expect(html).not.toContain(`stroke="${PLAYER_COLORS[3]}"`);
  });

  it('the aggregate component renders one wall per entry', () => {
    const html = render({ walls: [{ vertex: VERTEX_A, seat: 0 as Seat }] });
    expect(html).toContain(`data-testid="city-wall-${VERTEX_A}"`);
  });
});

describe('Metropolis (C4.6): track-colored gates adornment', () => {
  it.each(['trade', 'politics', 'science'] as const)('renders the %s metropolis in its track color', (track) => {
    const html = renderToStaticMarkup(
      createElement(Metropolis, { x: 10, y: 10, vertex: VERTEX_A, track }),
    );
    expect(html).toContain(`data-testid="metropolis-${VERTEX_A}"`);
    expect(html).toContain(`data-track="${track}"`);
    expect(html).toContain(`fill="${TRACK_COLOR[track]}"`);
  });

  it('the aggregate component renders every metropolis entry given', () => {
    const html = render({
      metropolises: [
        { vertex: VERTEX_A, track: 'trade' },
        { vertex: VERTEX_B, track: 'science' },
      ],
    });
    expect(html).toContain(`data-testid="metropolis-${VERTEX_A}"`);
    expect(html).toContain(`data-testid="metropolis-${VERTEX_B}"`);
  });
});

describe('T-1212 "3D board": CitiesKnightsPieces reprojection', () => {
  it('KnightPiece renders byte-identical to pre-phase-13 when extruded is omitted (every existing caller)', () => {
    const html = renderToStaticMarkup(
      createElement(KnightPiece, { x: 10, y: 10, vertex: VERTEX_A, seat: 1 as Seat, level: 2, active: true }),
    );
    // No ground-shadow ellipse, and the shield's points sit at the exact ground y (10), matching the
    // pre-T-1212 formula exactly (bodyY === y when not extruded).
    const s = HEX_SIZE * 0.24;
    const x = 10;
    const y = 10;
    const pts = `${x - s},${y - s * 0.7} ${x + s},${y - s * 0.7} ${x + s},${y + s * 0.15} ${x},${y + s * 1.15} ${x - s},${y + s * 0.15}`;
    expect(html).not.toContain('<ellipse');
    expect(html).toContain(`points="${pts}"`);
  });

  it('with 3D off (identity projection), the aggregate places every marker at the raw px position — byte-identical to pre-phase-13', () => {
    const raw = rawVertex(VERTEX_A);
    const html = render({
      walls: [{ vertex: VERTEX_A, seat: 0 as Seat }],
      knights: [{ vertex: VERTEX_A, seat: 0 as Seat, level: 1, active: true }],
      metropolises: [{ vertex: VERTEX_A, track: 'trade' }],
      projection: boardProjection(false),
    });
    // CityWall's arc starts at (x-r, y+r*0.5) — reconstructible from the raw point only if the
    // component received the exact raw px coordinates (no tilt, no height offset).
    const r = HEX_SIZE * 0.34;
    expect(html).toContain(`d="M ${raw.x - r} ${raw.y + r * 0.5}`);
    // No ground-shadow ellipse anywhere (every piece-like marker's `extruded` flag is false off).
    expect(html).not.toContain('<ellipse');
  });

  it('with 3D on, a knight stands raised with a ground shadow and the aggregate differs from 3D off', () => {
    const props = { knights: [{ vertex: VERTEX_A, seat: 0 as Seat, level: 1 as const, active: true }] };
    const flat = render({ ...props, projection: boardProjection(false) });
    const tilted = render({ ...props, projection: boardProjection(true) });
    expect(tilted).not.toBe(flat);
    expect(tilted).toContain('<ellipse');
    expect(flat).not.toContain('<ellipse');
  });

  it('a city-wall marker never gets a ground shadow (flat-on-tile, even with 3D on)', () => {
    const html = render({ walls: [{ vertex: VERTEX_A, seat: 0 as Seat }], projection: boardProjection(true) });
    expect(html).not.toContain('<ellipse');
  });
});
