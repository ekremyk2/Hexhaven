// Pieces motion tests (T-409, docs/11 §5 "Placement" pop + "Robber move" arc hop). Same
// `renderToStaticMarkup`/no-jsdom convention as InteractionLayer.test.ts (this workspace's vitest
// runs under `environment: "node"` — docs/12 quickstart). `robberHopOffset` is pure geometry math,
// tested directly; the render-level tests assert the classes/CSS vars it feeds into `<Robber>`.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { GEOMETRY, type EdgeId, type HexId, type Seat, type VertexId } from '@hexhaven/shared';
import { Pieces, robberHopOffset } from './Pieces';
import { HEX_SIZE, PLAYER_BADGES, PLAYER_COLORS } from './palette';
import { boardProjection } from './projection';

const SEAT0 = 0 as const;
const HEX_A = GEOMETRY.hexes[0]!.id;
const HEX_B = GEOMETRY.hexes[1]!.id;
const VERTEX_A = GEOMETRY.vertices[0]!.id as VertexId;
const EDGE_A = GEOMETRY.edges[0]!.id;
const EDGE_B = GEOMETRY.edges[1]!.id;

function render(props: Partial<Parameters<typeof Pieces>[0]> = {}) {
  return renderToStaticMarkup(createElement(Pieces, props));
}

describe('robberHopOffset (pure geometry, docs/11 §5 "arc hop between hexes")', () => {
  it('returns null when there is no previous hex (initial placement)', () => {
    expect(robberHopOffset(null, HEX_A)).toBeNull();
  });

  it('returns null when the hex did not actually change', () => {
    expect(robberHopOffset(HEX_A, HEX_A)).toBeNull();
  });

  it('returns a nonzero delta between two distinct hexes', () => {
    const offset = robberHopOffset(HEX_A, HEX_B);
    expect(offset).not.toBeNull();
    expect(offset!.dx !== 0 || offset!.dy !== 0).toBe(true);
  });
});

describe('Pieces: placement pop (docs/11 §5, "1.08→1 scale pop, 200ms")', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('applies the pop class to settlements/cities/roads by default', () => {
    const html = render({
      settlements: [{ vertex: VERTEX_A, seat: SEAT0 }],
      cities: [],
      roads: [],
    });
    expect(html).toContain('hexhaven-piece-pop');
  });

  it('keeps a road POSITIONING transform separate from the pop class (regression: roads jumped to the corner)', () => {
    const html = render({ roads: [{ edge: EDGE_A, seat: SEAT0 }] });
    // The road's translate+rotate that pins it to its edge must be present…
    expect(html).toMatch(/transform="translate\([^"]+\) rotate\([^"]+\)"/);
    // …and must NOT sit on the same element as the pop class, whose CSS `transform: scale()` would
    // otherwise override (clobber) that positioning transform.
    expect(html).not.toMatch(/transform="translate\([^"]+\) rotate\([^"]+\)"[^>]*hexhaven-piece-pop/);
    expect(html).toContain('hexhaven-piece-pop');
  });

  it('suppresses the pop class under prefers-reduced-motion', () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    };
    const html = render({ settlements: [{ vertex: VERTEX_A, seat: SEAT0 }] });
    expect(html).not.toContain('hexhaven-piece-pop');
  });
});

describe('Pieces: Seafarers ships/pirate/chits (T-704)', () => {
  it('renders a ship on each given sea edge in the owner seat colour', () => {
    const html = render({
      ships: [
        { edge: EDGE_A, seat: 0 as Seat },
        { edge: EDGE_B, seat: 1 as Seat },
      ],
    });
    // One ship group per edge, tagged with its edge + seat, positioned on the edge (translate+rotate).
    expect(html).toContain(`data-testid="ship-${EDGE_A}"`);
    expect(html).toContain(`data-testid="ship-${EDGE_B}"`);
    expect(html).toMatch(/transform="translate\([^"]+\) rotate\([^"]+\)"[^>]*data-testid="ship-\d+"/);
    // Owner colours: seat 0 (red) and seat 1 (blue) hulls/sails.
    expect(html).toContain(`fill="${PLAYER_COLORS[0]}"`);
    expect(html).toContain(`fill="${PLAYER_COLORS[1]}"`);
  });

  it('renders the pirate on its hex, distinct from the robber', () => {
    const html = render({ pirate: HEX_A as HexId, robber: HEX_B as HexId });
    expect(html).toContain('data-testid="pirate"');
    expect(html).toContain(`data-testid="pirate"`);
    // Both pirate and robber are present and carry their own hex ids.
    expect(html).toMatch(new RegExp(`data-testid="pirate"[^>]*data-hex-id="${HEX_A}"`));
    expect(html).toMatch(new RegExp(`data-testid="robber"[^>]*data-hex-id="${HEX_B}"`));
  });

  it('renders an island-chit marker on the island hex in the owner colour', () => {
    const html = render({ islandChits: [{ hex: HEX_A as HexId, seat: 2 as Seat }] });
    expect(html).toContain(`data-testid="island-chit-${HEX_A}"`);
    expect(html).toContain(`data-seat="2"`);
    // The chit disc is ringed in the owner's seat colour.
    expect(html).toContain(`stroke="${PLAYER_COLORS[2]}"`);
  });

  it('draws nothing extra when no Seafarers pieces are supplied (base games)', () => {
    const html = render({ roads: [{ edge: EDGE_A, seat: SEAT0 }] });
    expect(html).not.toContain('data-testid="ship-');
    expect(html).not.toContain('data-testid="pirate"');
    expect(html).not.toContain('data-testid="island-chit-');
  });
});

describe('Pieces: T-903 hex pieces (multi-piece hex framework)', () => {
  it('renders a marker for each active hex piece, tagged with its kind and hex', () => {
    const html = render({
      hexPieces: [
        { hex: HEX_A as HexId, kind: 'wizard' },
        { hex: HEX_B as HexId, kind: 'trader' },
      ],
    });
    expect(html).toContain('data-testid="hex-piece-wizard"');
    expect(html).toContain('data-testid="hex-piece-trader"');
    expect(html).toMatch(new RegExp(`data-testid="hex-piece-wizard"[^>]*data-hex-id="${HEX_A}"`));
    expect(html).toMatch(new RegExp(`data-testid="hex-piece-trader"[^>]*data-hex-id="${HEX_B}"`));
  });

  it('coexists with the base robber on a DIFFERENT hex without either occluding the other', () => {
    const html = render({ robber: HEX_A as HexId, hexPieces: [{ hex: HEX_B as HexId, kind: 'banker' }] });
    expect(html).toContain('data-testid="robber"');
    expect(html).toContain('data-testid="hex-piece-banker"');
  });

  it('every kind gets its own distinct fill color', () => {
    const kinds = ['wizard', 'trader', 'robinHood', 'banker', 'poaching'] as const;
    const html = render({ hexPieces: kinds.map((kind) => ({ hex: HEX_A as HexId, kind })) });
    const fills = new Set<string>();
    for (const kind of kinds) {
      const match = html.match(new RegExp(`data-testid="hex-piece-${kind}"[\\s\\S]*?fill="(#[0-9a-f]{6})"`));
      expect(match).not.toBeNull();
      fills.add(match![1]!);
    }
    expect(fills.size).toBe(kinds.length);
  });

  it('fans multiple pieces sharing a hex to DISTINCT positions (playtest: all pieces start on the desert with the robber and used to stack into one invisible blob)', () => {
    const kinds = ['wizard', 'trader', 'robinHood', 'banker', 'poaching'] as const;
    const html = render({ robber: HEX_A as HexId, hexPieces: kinds.map((kind) => ({ hex: HEX_A as HexId, kind })) });
    const centers = new Set<string>();
    for (const kind of kinds) {
      const match = html.match(new RegExp(`data-testid="hex-piece-${kind}"[\\s\\S]*?<circle cx="([\\-0-9.]+)" cy="([\\-0-9.]+)"`));
      expect(match).not.toBeNull();
      centers.add(`${match![1]},${match![2]}`);
    }
    // Every co-located piece must land on its own point (the fan) — not all at one spot.
    expect(centers.size).toBe(kinds.length);
  });

  it('draws nothing extra when no hex pieces are supplied (base games / modifier off)', () => {
    const html = render({ roads: [{ edge: EDGE_A, seat: SEAT0 }] });
    expect(html).not.toContain('data-testid="hex-piece-');
  });
});

describe('Pieces: cosmetic theme (T-907 PM wiring)', () => {
  it('defaults to the classic theme (identity — no reskin) when themeId is omitted', () => {
    const html = render({ robber: HEX_A as HexId });
    expect(html).toMatch(new RegExp(`data-testid="robber"[^>]*data-theme-id="classic"`));
  });

  it("threads a non-classic themeId through to the robber's art", () => {
    const html = render({ robber: HEX_A as HexId, themeId: 'pirates' });
    expect(html).toMatch(new RegExp(`data-testid="robber"[^>]*data-theme-id="pirates"`));
  });

  it('classic renders byte-identical robber body markup to before theming existed', () => {
    const classic = render({ robber: HEX_A as HexId, themeId: 'classic' });
    const omitted = render({ robber: HEX_A as HexId });
    expect(classic).toBe(omitted);
  });
});

describe('Pieces: robber hop (docs/11 §5)', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('never hops on the very first render (no prior position to hop from)', () => {
    const html = render({ robber: HEX_A as HexId });
    expect(html).not.toContain('hexhaven-robber-hop');
  });

  it('renders the robber even without a hop (static case is just the piece)', () => {
    const html = render({ robber: HEX_A as HexId });
    expect(html).toContain('<ellipse');
  });
});

describe('Pieces: 3D board (T-1211) — off is byte-identical to pre-T-1211 flat pieces', () => {
  const px = (n: number) => n * HEX_SIZE;

  function flatSettlementPoints(vid: VertexId): string {
    const v = GEOMETRY.vertices[vid]!;
    const x = px(v.x);
    const y = px(v.y);
    const s = HEX_SIZE * 0.22;
    return `${x - s},${y + s} ${x - s},${y - s * 0.2} ${x},${y - s} ${x + s},${y - s * 0.2} ${x + s},${y + s}`;
  }

  function flatCityPoints(vid: VertexId): { base: string; tower: string } {
    const v = GEOMETRY.vertices[vid]!;
    const x = px(v.x);
    const y = px(v.y);
    const s = HEX_SIZE * 0.26;
    return {
      base: `${x - s},${y + s} ${x - s},${y} ${x + s},${y} ${x + s},${y + s}`,
      tower: `${x - s},${y} ${x - s},${y - s * 0.9} ${x - s * 0.2},${y - s * 1.3} ${x + s * 0.4},${y - s * 0.9} ${x + s * 0.4},${y}`,
    };
  }

  function flatEdgeAnchor(eid: EdgeId) {
    const e = GEOMETRY.edges[eid]!;
    return { x: px(e.x), y: px(e.y), angleDeg: e.angleDeg };
  }

  function flatHexAnchor(hid: HexId) {
    const h = GEOMETRY.hexes[hid]!;
    return { x: px(h.x), y: px(h.y) };
  }

  it('a settlement is the plain pre-T-1211 pentagon in the exact seat colour (single polygon)', () => {
    const html = render({ settlements: [{ vertex: VERTEX_A, seat: SEAT0 }], projection: boardProjection(false) });
    expect(html).toContain(`points="${flatSettlementPoints(VERTEX_A)}"`);
    expect(html).toContain(`fill="${PLAYER_COLORS[SEAT0]}"`);
    expect(html.match(/<polygon/g)?.length).toBe(1);
  });

  it('a city is the plain pre-T-1211 base+tower silhouette in the exact seat colour (two polygons)', () => {
    const html = render({ cities: [{ vertex: VERTEX_A, seat: SEAT0 }], projection: boardProjection(false) });
    const { base, tower } = flatCityPoints(VERTEX_A);
    expect(html).toContain(`points="${base}"`);
    expect(html).toContain(`points="${tower}"`);
    expect(html.match(/<polygon/g)?.length).toBe(2);
  });

  it('a road is the single plain pre-T-1211 rect, anchored+rotated exactly as before', () => {
    const html = render({ roads: [{ edge: EDGE_A, seat: SEAT0 }], projection: boardProjection(false) });
    const a = flatEdgeAnchor(EDGE_A);
    expect(html).toContain(`transform="translate(${a.x} ${a.y}) rotate(${a.angleDeg})"`);
    expect(html.match(/<rect/g)?.length).toBe(1);
    expect(html).toContain(`fill="${PLAYER_COLORS[SEAT0]}"`);
  });

  it('a ship has no extra freeboard shading and the hull/sail stay the plain seat colour', () => {
    const html = render({ ships: [{ edge: EDGE_A, seat: SEAT0 }], projection: boardProjection(false) });
    // Exactly the 2 seat-colour fills pre-T-1211 (sail polygon + hull path) — no extra freeboard face.
    const fillMatches = html.match(new RegExp(`fill="${PLAYER_COLORS[SEAT0]}"`, 'g')) ?? [];
    expect(fillMatches.length).toBe(2);
  });

  it('the robber body/shadow render at the SAME (unelevated) point, no shading overlay', () => {
    const html = render({ robber: HEX_A as HexId, projection: boardProjection(false) });
    const h = flatHexAnchor(HEX_A);
    const s = HEX_SIZE * 0.34;
    expect(html).toContain(`<ellipse cx="${h.x}" cy="${h.y + s * 0.9}"`);
    // classicPawn draws exactly 1 path (body) + 1 circle (head) pre-T-1211 — no shadow/highlight extras.
    expect(html.match(/<path/g)?.length).toBe(1);
    expect(html.match(/<circle/g)?.length).toBe(1);
  });

  it('the pirate hull stays the single plain dark path, no freeboard shading', () => {
    const html = render({ pirate: HEX_A as HexId, projection: boardProjection(false) });
    expect(html).toContain('data-testid="pirate"');
    expect(html.match(/<path/g)?.length).toBe(1);
  });

  it('every piece anchor is projected through a non-identity tilt when 3D is on', () => {
    const props = {
      settlements: [{ vertex: VERTEX_A, seat: SEAT0 }],
      roads: [{ edge: EDGE_A, seat: SEAT0 }],
      robber: HEX_A as HexId,
    };
    const flat = render({ ...props, projection: boardProjection(false) });
    const tilted = render({ ...props, projection: boardProjection(true) });
    expect(tilted).not.toBe(flat);
  });

  it('a settlement standing on 3D shows a darker wall face and a lighter roof face (two-tone, not the flat pentagon)', () => {
    const html = render({ settlements: [{ vertex: VERTEX_A, seat: SEAT0 }], projection: boardProjection(true) });
    expect(html.match(/<polygon/g)?.length).toBe(2); // wall + roof
    expect(html).not.toContain(`fill="${PLAYER_COLORS[SEAT0]}"`); // both faces are shaded, not the plain seat fill
  });

  it('a city standing on 3D reads as a multi-tower building (base wall + 2 towers) and keeps two-tone shading', () => {
    const html = render({ cities: [{ vertex: VERTEX_A, seat: SEAT0 }], projection: boardProjection(true) });
    expect(html.match(/<polygon/g)?.length).toBe(3); // base wall + secondary tower + lit main tower
  });

  it('a road standing on 3D renders TWO stacked faces (a visible side + a lit top)', () => {
    const html = render({ roads: [{ edge: EDGE_A, seat: SEAT0 }], projection: boardProjection(true) });
    expect(html.match(/<rect/g)?.length).toBe(2);
  });

  it('a ship standing on 3D adds a darker freeboard face under the hull', () => {
    const html = render({ ships: [{ edge: EDGE_A, seat: SEAT0 }], projection: boardProjection(true) });
    expect(html.match(/<path/g)?.length).toBe(2); // freeboard + hull
  });

  it('the robber gets a shaded body (shadow silhouette + head highlight) when 3D is on', () => {
    const html = render({ robber: HEX_A as HexId, projection: boardProjection(true) });
    expect(html.match(/<path/g)?.length).toBe(2); // shadow silhouette + real body
    expect(html.match(/<ellipse/g)?.length).toBe(2); // ground shadow + head highlight
  });

  it('depth-sorts settlements back-to-front by board-space y when 3D is on (farther one drawn first)', () => {
    const sorted = [...GEOMETRY.vertices].sort((a, b) => a.y - b.y);
    const far = sorted[0]!.id as VertexId;
    const near = sorted[sorted.length - 1]!.id as VertexId;
    const html = render({
      settlements: [
        { vertex: near, seat: 0 as Seat },
        { vertex: far, seat: 1 as Seat },
      ],
      projection: boardProjection(true),
    });
    const nearBadgeIdx = html.indexOf(PLAYER_BADGES[0]);
    const farBadgeIdx = html.indexOf(PLAYER_BADGES[1]);
    expect(farBadgeIdx).toBeGreaterThanOrEqual(0);
    expect(nearBadgeIdx).toBeGreaterThan(farBadgeIdx);
  });

  it('does not depth-sort (keeps prop order) when 3D is off — same DOM order as pre-T-1211', () => {
    const sorted = [...GEOMETRY.vertices].sort((a, b) => a.y - b.y);
    const far = sorted[0]!.id as VertexId;
    const near = sorted[sorted.length - 1]!.id as VertexId;
    const html = render({
      settlements: [
        { vertex: near, seat: 0 as Seat },
        { vertex: far, seat: 1 as Seat },
      ],
      projection: boardProjection(false),
    });
    // Prop order preserved: seat 0 (listed first) appears before seat 1 in the DOM.
    expect(html.indexOf(PLAYER_BADGES[0])).toBeLessThan(html.indexOf(PLAYER_BADGES[1]));
  });
});
