// BoardView Seafarers rendering (T-704): sea + gold hexes on the real "Heading for New Shores"
// scenario geometry. Same `renderToStaticMarkup`/node-env convention as the other board tests.
// A base board render is also asserted to stay identical (no sea/gold leakage).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createGame, type GameConfig } from '@hexhaven/engine';
import { GEOMETRY, type EdgeId, type ScenarioTerrain, type Seat, type VertexId } from '@hexhaven/shared';
import { BoardView } from './BoardView';
import { Pieces } from './Pieces';
import { ExplorersPiratesPieces } from './ExplorersPiratesPieces';
import { boardGeometryFor } from './geometry';
import { boardProjection } from './projection';
import { HEX_SIZE } from './palette';

function seafarersGame(playerCount: 3 | 4) {
  const config: GameConfig = {
    playerCount,
    targetVp: 14,
    seed: `t704-${playerCount}`,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
  };
  const state = createGame(config);
  const geometry = boardGeometryFor(config);
  const hexTerrain = state.ext!.seafarers!.hexTerrain;
  return { state, geometry, hexTerrain };
}

function render(playerCount: 3 | 4): { html: string; hexTerrain: ScenarioTerrain[] } {
  const { state, geometry, hexTerrain } = seafarersGame(playerCount);
  const html = renderToStaticMarkup(
    createElement(BoardView, { board: state.board, geometry, hexTerrain }),
  );
  return { html, hexTerrain };
}

/** The opening `<g>` tag for a given hex id (carries data-terrain/data-token). */
function hexTag(html: string, hexId: number): string {
  const m = html.match(new RegExp(`<g[^>]*data-hex-id="${hexId}"[^>]*>`));
  if (!m) throw new Error(`no hex <g> for hex ${hexId}`);
  return m[0];
}

describe.each([3, 4] as const)('BoardView Seafarers scenario (%ip)', (playerCount) => {
  it('renders sea hexes with no token and gold hexes with their token', () => {
    const { html, hexTerrain } = render(playerCount);
    const seaHex = hexTerrain.findIndex((t) => t === 'sea');
    const goldHex = hexTerrain.findIndex((t) => t === 'gold');
    expect(seaHex).toBeGreaterThanOrEqual(0);
    expect(goldHex).toBeGreaterThanOrEqual(0);

    // Sea hex: classified sea, blank token.
    const seaG = hexTag(html, seaHex);
    expect(seaG).toContain('data-terrain="sea"');
    expect(seaG).toMatch(/data-token=""/);

    // Gold hex: classified gold, carries a numeric token (S9.1 gold is numbered).
    const goldG = hexTag(html, goldHex);
    expect(goldG).toContain('data-terrain="gold"');
    expect(goldG).toMatch(/data-token="\d+"/);
  });

  it('fills gold with the gold gradient and defines both scenario gradients', () => {
    const { html } = render(playerCount);
    expect(html).toContain('id="gold-grad"');
    expect(html).toContain('fill="url(#gold-grad)"');
    // Sea backdrop + sea hexes share the ocean gradient (blend, docs/11 §4).
    expect(html).toContain('id="sea-grad"');
  });
});

describe('BoardView base board (unchanged by T-704)', () => {
  it('renders base terrains and never a sea/gold classification', () => {
    const config: GameConfig = {
      playerCount: 4,
      targetVp: 10,
      seed: 'base-1',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    };
    const state = createGame(config);
    const html = renderToStaticMarkup(createElement(BoardView, { board: state.board }));
    expect(html).not.toContain('data-terrain="sea"');
    expect(html).not.toContain('data-terrain="gold"');
    // No hex polygon references the gold gradient in a base game.
    expect(html).not.toContain('fill="url(#gold-grad)"');
    expect(html).toContain('data-terrain=');
  });
});

describe('BoardView Explorers & Pirates fog (T-1108, §EP2.1/§EP5.1)', () => {
  it('renders a fog cover for every hex in epUnexplored, and none outside it', () => {
    const config: GameConfig = {
      playerCount: 4,
      targetVp: 8,
      seed: 't1108-fog-1',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false, explorersPirates: { scenario: 'landHo' } },
    };
    const state = createGame(config);
    const ep = state.ext!.explorersPirates!;
    const unexplored = ep.unexplored ?? [];
    expect(unexplored.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(
      createElement(BoardView, { board: state.board, hexTerrain: ep.seaMap, epUnexplored: unexplored }),
    );
    for (const hexId of unexplored) {
      expect(html).toContain(`data-testid="ep-fog-${hexId}"`);
    }
    // A hex NOT in `unexplored` (the home island) never gets a fog cover.
    const revealedHex = state.board.hexes.findIndex((_, i) => !unexplored.includes(i as never));
    expect(revealedHex).toBeGreaterThanOrEqual(0);
    expect(html).not.toContain(`data-testid="ep-fog-${revealedHex}"`);
  });

  it('renders no fog at all with epUnexplored omitted (RK-13 — base/other-expansion boards unchanged)', () => {
    const config: GameConfig = {
      playerCount: 4,
      targetVp: 10,
      seed: 'base-1108',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    };
    const state = createGame(config);
    const html = renderToStaticMarkup(createElement(BoardView, { board: state.board }));
    expect(html).not.toContain('data-testid="ep-fog-');
  });
});

describe('BoardView Explorers & Pirates 5-6 (T-1156, landHo on the 37-hex buildLandHoBoard56 frame)', () => {
  // The E&P fog test above proves the 3-4 board (base 19-hex GEOMETRY). This mirrors it for a 5-6
  // game, whose board is the bigger 37-hex `LAND_HO_56_GEOMETRY` frame (`boardGeometryFor` →
  // `buildLandHoBoard56`). It is the render-side guard for the class of bug T-1160 fixed on the
  // action side: pieces must be looked up in the 37-hex geometry the game actually plays on, never
  // the base 19-hex one — an id past the base range (edge > 71 / vertex > 53) would resolve to
  // `undefined` and throw `BUG: edge/vertex …` in a hardcoded-base component.
  const config: GameConfig = {
    playerCount: 6,
    targetVp: 8,
    seed: 't1156-ep56-1',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: false, citiesKnights: false, explorersPirates: { scenario: 'landHo' } },
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };

  it('renders on the 37-hex frame — every unexplored hex gets a fog cover, all at valid ids', () => {
    const state = createGame(config);
    const geometry = boardGeometryFor(config);
    // Prove we are on the bigger frame, not the base 19-hex one (the whole point of the 5-6 board).
    expect(geometry.hexes.length).toBe(37);
    expect(geometry.hexes.length).toBeGreaterThan(GEOMETRY.hexes.length);
    expect(geometry.edges.length).toBeGreaterThan(GEOMETRY.edges.length);
    expect(geometry.vertices.length).toBeGreaterThan(GEOMETRY.vertices.length);

    const ep = state.ext!.explorersPirates!;
    const unexplored = ep.unexplored ?? [];
    expect(unexplored.length).toBeGreaterThan(0);
    // Every fogged hex id is a real hex on the 37-hex frame (none out of range — T-1160 bug class).
    for (const hexId of unexplored) {
      expect(hexId).toBeGreaterThanOrEqual(0);
      expect(hexId).toBeLessThan(geometry.hexes.length);
    }

    const html = renderToStaticMarkup(
      createElement(BoardView, { board: state.board, geometry, hexTerrain: ep.seaMap, epUnexplored: unexplored }),
    );
    for (const hexId of unexplored) {
      expect(html).toContain(`data-testid="ep-fog-${hexId}"`);
    }
    // A revealed hex (the home island) never gets a fog cover.
    const revealedHex = state.board.hexes.findIndex((_, i) => !unexplored.includes(i as never));
    expect(revealedHex).toBeGreaterThanOrEqual(0);
    expect(html).not.toContain(`data-testid="ep-fog-${revealedHex}"`);
  });

  it('renders ships + harbor settlements at 37-hex-only ids (past the base 19-hex range) without going out of range', () => {
    const state = createGame(config);
    const geometry = boardGeometryFor(config);
    // Ids that exist ONLY on the 37-hex frame: the last edge/vertex, both past the base board's
    // range (base has 72 edges / 54 vertices). A base-geometry-hardcoded render component would
    // resolve these to `undefined` and throw — rendering them proves the geometry is threaded end
    // to end (ships via <Pieces>, harbor settlements via <ExplorersPiratesPieces>, exactly as
    // routes/Game.tsx wires them).
    const shipEdge = (geometry.edges.length - 1) as EdgeId;
    const harborVertex = (geometry.vertices.length - 1) as VertexId;
    expect(shipEdge).toBeGreaterThanOrEqual(GEOMETRY.edges.length);
    expect(harborVertex).toBeGreaterThanOrEqual(GEOMETRY.vertices.length);

    const html = renderToStaticMarkup(
      createElement(
        BoardView,
        { board: state.board, geometry, hexTerrain: state.ext!.explorersPirates!.seaMap },
        createElement(Pieces, { geometry, ships: [{ edge: shipEdge, seat: 0 as Seat }] }),
        createElement(ExplorersPiratesPieces, {
          geometry,
          harborSettlements: [{ vertex: harborVertex, seat: 2 as Seat }],
        }),
      ),
    );
    // Both pieces rendered (no throw) at their 37-hex ids.
    expect(html).toContain(`data-testid="ship-${shipEdge}"`);
    expect(html).toContain(`data-edge-id="${shipEdge}"`);
    expect(html).toContain('data-testid="harbor-settlement-2"');
    expect(html).toContain('data-seat="2"');
  });
});

describe('BoardView The Fog Islands (T-756, Seafarers 5-6 scenario)', () => {
  it('renders a fog cover for every hex in seafarersFogHidden, and none outside it', () => {
    const config: GameConfig = {
      playerCount: 6,
      targetVp: 10,
      seed: 't756-fog-1',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: true, seafarers: { scenario: 'fogIslands' }, citiesKnights: false },
      variants: { fiveSixTurnRule: 'pairedPlayers' },
    };
    const state = createGame(config);
    const geometry = boardGeometryFor(config); // the fogIslands 6p frame (63 hexes) — must match the board so every hidden hex has a polygon to cover
    const sf = state.ext!.seafarers!;
    const hidden = sf.fog?.hidden ?? [];
    expect(hidden.length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(
      createElement(BoardView, { board: state.board, geometry, hexTerrain: sf.hexTerrain, seafarersFogHidden: hidden }),
    );
    for (const hexId of hidden) {
      expect(html).toContain(`data-testid="ep-fog-${hexId}"`);
    }
    // A hex NOT in `hidden` (the starting island) never gets a fog cover.
    const revealedHex = state.board.hexes.findIndex((_, i) => !hidden.includes(i as never));
    expect(revealedHex).toBeGreaterThanOrEqual(0);
    expect(html).not.toContain(`data-testid="ep-fog-${revealedHex}"`);
  });

  it('renders no fog at all with seafarersFogHidden omitted (RK-13 — every other scenario unchanged)', () => {
    const config: GameConfig = {
      playerCount: 4,
      targetVp: 14,
      seed: 't756-not-fog',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
    };
    const state = createGame(config);
    const html = renderToStaticMarkup(
      createElement(BoardView, { board: state.board, hexTerrain: state.ext!.seafarers!.hexTerrain }),
    );
    expect(html).not.toContain('data-testid="ep-fog-');
  });
});

describe('BoardView 3D board (T-1210)', () => {
  const px = (n: number) => n * HEX_SIZE;
  const MARGIN = 46;

  const config: GameConfig = {
    playerCount: 4,
    targetVp: 10,
    seed: 't1210-1',
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
  };

  /** The pre-T-1210 viewBox formula — raw (un-projected) vertex extents, no skirt margin. */
  function flatViewBox(): string {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const v of GEOMETRY.vertices) {
      minX = Math.min(minX, px(v.x));
      minY = Math.min(minY, px(v.y));
      maxX = Math.max(maxX, px(v.x));
      maxY = Math.max(maxY, px(v.y));
    }
    return `${minX - MARGIN} ${minY - MARGIN} ${maxX - minX + MARGIN * 2} ${maxY - minY + MARGIN * 2}`;
  }

  /** The pre-T-1210 top-face polygon for a hex — its true, un-inset, un-tilted vertex positions. */
  function flatHexPoints(hexId: number): string {
    const h = GEOMETRY.hexes[hexId]!;
    return h.vertices
      .map((vid) => {
        const v = GEOMETRY.vertices[vid]!;
        return `${px(v.x)},${px(v.y)}`;
      })
      .join(' ');
  }

  it('3D off (identity projection) is byte-identical to the pre-T-1210 flat-board formula: viewBox + every hex polygon + no skirts', () => {
    const state = createGame(config);
    const html = renderToStaticMarkup(
      createElement(BoardView, { board: state.board, projection: boardProjection(false) }),
    );

    expect(html).toContain(`viewBox="${flatViewBox()}"`);
    for (const h of GEOMETRY.hexes) {
      expect(html).toContain(`points="${flatHexPoints(h.id)}"`);
    }
    expect(html).not.toContain('hex-skirt-');
  });

  it('3D on (the default) draws a skirt for every hex (base game has no sea hexes to exclude)', () => {
    const state = createGame(config);
    const html = renderToStaticMarkup(createElement(BoardView, { board: state.board }));
    for (const h of GEOMETRY.hexes) {
      // Every hex has SOME viewer-facing edge under the tilt (a regular hexagon's centre can never
      // sit exactly on the boundary between "front" and "back" halves), so every non-sea hex gets
      // at least one skirt polygon.
      expect(html).toContain(`data-testid="hex-skirt-${h.id}"`);
    }
  });

  it('3D on renders each hex\'s top face inset from (not equal to) the flat/true vertex positions', () => {
    const state = createGame(config);
    const html = renderToStaticMarkup(createElement(BoardView, { board: state.board }));
    for (const h of GEOMETRY.hexes) {
      expect(html).not.toContain(`points="${flatHexPoints(h.id)}"`);
    }
  });

  it('the viewBox grows to accommodate the skirt depth when 3D is on', () => {
    const state = createGame(config);
    const flatHtml = renderToStaticMarkup(
      createElement(BoardView, { board: state.board, projection: boardProjection(false) }),
    );
    const tiltedHtml = renderToStaticMarkup(createElement(BoardView, { board: state.board }));
    expect(tiltedHtml).not.toContain(`viewBox="${flatViewBox()}"`);
    expect(flatHtml).toContain(`viewBox="${flatViewBox()}"`);
  });
});
