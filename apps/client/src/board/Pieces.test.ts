// Pieces motion tests (T-409, docs/11 §5 "Placement" pop + "Robber move" arc hop). Same
// `renderToStaticMarkup`/no-jsdom convention as InteractionLayer.test.ts (this workspace's vitest
// runs under `environment: "node"` — docs/12 quickstart). `robberHopOffset` is pure geometry math,
// tested directly; the render-level tests assert the classes/CSS vars it feeds into `<Robber>`.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { GEOMETRY, type HexId, type Seat, type VertexId } from '@hexhaven/shared';
import { Pieces, robberHopOffset } from './Pieces';
import { PLAYER_COLORS } from './palette';

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
