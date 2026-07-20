import { describe, expect, it } from 'vitest';
import { LAND_HO_56_GEOMETRY } from '@hexhaven/engine';
import { GEOMETRY, GEOMETRY_EXT56 } from '@hexhaven/shared';
import type { GameConfig } from '@hexhaven/shared';
import { boardGeometryFor, scenarioGeometryFor } from './geometry';

const base = (fiveSix: boolean): Pick<GameConfig, 'expansions'> => ({
  expansions: { fiveSix, seafarers: false, citiesKnights: false },
});

const seafarers = (playerCount: 3 | 4): GeometryLike => ({
  playerCount,
  expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
});

type GeometryLike = Pick<GameConfig, 'expansions'> & { playerCount?: GameConfig['playerCount'] };

describe('boardGeometryFor', () => {
  it('returns the 30-hex EXT56 geometry for a fiveSix game', () => {
    const g = boardGeometryFor(base(true));
    expect(g).toBe(GEOMETRY_EXT56);
    expect(g.hexes.length).toBe(30);
  });

  it('returns the base 19-hex geometry otherwise', () => {
    const g = boardGeometryFor(base(false));
    expect(g).toBe(GEOMETRY);
    expect(g.hexes.length).toBe(19);
  });

  it('defaults to the base geometry when config is undefined', () => {
    expect(boardGeometryFor(undefined)).toBe(GEOMETRY);
  });

  it('returns the "Heading for New Shores" scenario frame for a Seafarers game (3p=35, 4p=42 hexes)', () => {
    const g3 = boardGeometryFor(seafarers(3));
    const g4 = boardGeometryFor(seafarers(4));
    expect(g3.hexes.length).toBe(35);
    expect(g4.hexes.length).toBe(42);
    // 3p and 4p are distinct frames, and neither is the base/EXT56 geometry.
    expect(g3).not.toBe(g4);
    expect(g3).not.toBe(GEOMETRY);
    expect(g4).not.toBe(GEOMETRY_EXT56);
  });

  it('memoizes one geometry per (scenario, playerCount)', () => {
    expect(boardGeometryFor(seafarers(3))).toBe(boardGeometryFor(seafarers(3)));
  });

  it('returns the "Heading for New Shores" 5/6-player frames too (T-751)', () => {
    const g5 = boardGeometryFor({
      playerCount: 5,
      expansions: { fiveSix: true, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
    });
    const g6 = boardGeometryFor({
      playerCount: 6,
      expansions: { fiveSix: true, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
    });
    expect(g5.hexes.length).toBe(48);
    expect(g6.hexes.length).toBe(56);
    expect(g5).not.toBe(g6);
    expect(g5).not.toBe(GEOMETRY_EXT56);
  });
});

describe('scenarioGeometryFor', () => {
  it('resolves a Seafarers config to its frame and returns null otherwise', () => {
    expect(scenarioGeometryFor(seafarers(4))!.hexes.length).toBe(42);
    expect(scenarioGeometryFor(base(false))).toBeNull();
    expect(scenarioGeometryFor(base(true))).toBeNull();
  });

  it('resolves 5/6-player Seafarers configs too (T-751 — headingForNewShores ships 5/6 boards)', () => {
    const g5 = scenarioGeometryFor({
      playerCount: 5,
      expansions: { fiveSix: true, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
    });
    const g6 = scenarioGeometryFor({
      playerCount: 6,
      expansions: { fiveSix: true, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
    });
    expect(g5!.hexes.length).toBe(48);
    expect(g6!.hexes.length).toBe(56);
  });

  it('still returns null for an unshipped scenario id, regardless of player count', () => {
    expect(
      scenarioGeometryFor({
        playerCount: 4,
        expansions: { fiveSix: false, seafarers: { scenario: 'atlantis' }, citiesKnights: false },
      }),
    ).toBeNull();
  });
});

// T-1150 (Phase 11B): E&P has its OWN board frame (unlike T&B, which plays on the shared base/EXT56
// board and needed no `boardGeometryFor` change) — a 5–6 E&P game must NOT fall through to the
// unrelated 30-hex `GEOMETRY_EXT56` the generic `fiveSix` branch would otherwise hand back.
describe('boardGeometryFor — Explorers & Pirates (T-1150)', () => {
  const ep34: GameConfig['expansions'] = {
    fiveSix: false,
    seafarers: false,
    citiesKnights: false,
    explorersPirates: { scenario: 'landHo' },
  };
  const ep56: GameConfig['expansions'] = {
    fiveSix: true,
    seafarers: false,
    citiesKnights: false,
    explorersPirates: { scenario: 'landHo' },
  };

  it('returns the base 19-hex geometry for a 3–4 E&P game (unchanged)', () => {
    const g = boardGeometryFor({ expansions: ep34 });
    expect(g).toBe(GEOMETRY);
  });

  it('returns the bigger 37-hex LAND_HO_56_GEOMETRY for a 5–6 E&P game, NOT the 30-hex EXT56', () => {
    const g = boardGeometryFor({ playerCount: 5, expansions: ep56 });
    expect(g).toBe(LAND_HO_56_GEOMETRY);
    expect(g.hexes.length).toBe(37);
    expect(g).not.toBe(GEOMETRY_EXT56);
  });

  it('an unshipped/unknown E&P scenario id falls through to the generic fiveSix geometry', () => {
    const g = boardGeometryFor({
      playerCount: 5,
      expansions: { ...ep56, explorersPirates: { scenario: 'atlantis' } },
    });
    expect(g).toBe(GEOMETRY_EXT56);
  });
});
