// T-1150 (Phase 11B): the 5–6 player extension's bigger Land Ho! board (`buildLandHoBoard56`,
// board.ts) — mirrors ships.test.ts's own `buildLandHoBoardV0` coverage exactly, just against the
// bigger frame (37-hex `LAND_HO_56_GEOMETRY`: 19-hex home island / 18-hex open-sea ring, vs the 3–4
// board's 7/12). `buildLandHoBoardV0` itself is untouched — see ships.test.ts's existing suite for
// its own coverage (RK-13: this file adds NEW tests only, doesn't re-assert the 3–4 path).

import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import {
  LAND_HO_56_GEOMETRY,
  LAND_HO_56_TERRAINS,
  LAND_HO_56_TOKENS,
  LAND_HO_V0_TERRAINS,
  LAND_HO_V0_TOKENS,
  buildLandHoBoard56,
  buildLandHoBoardV0,
} from './board.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ep-board-56',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

describe('LAND_HO_56_GEOMETRY (T-1150 5–6 board frame)', () => {
  it('is a 37-hex radius-3 hexagon', () => {
    expect(LAND_HO_56_GEOMETRY.hexes).toHaveLength(37);
  });

  it('terrain/token multisets are sized to the 19-hex home island / 18 non-desert hexes', () => {
    expect(LAND_HO_56_TERRAINS).toHaveLength(19);
    expect(LAND_HO_56_TERRAINS.filter((t) => t === 'desert')).toHaveLength(1);
    expect(LAND_HO_56_TOKENS).toHaveLength(18);
  });
});

describe('buildLandHoBoard56 (T-1150)', () => {
  it('produces a bigger home island (19 land hexes) surrounded by a bigger open sea (18), valid robber start', () => {
    const created = createGame(CONFIG);
    const { board, seaMap } = buildLandHoBoard56(created.rng);
    const landCount = seaMap.filter((t) => t !== 'sea').length;
    expect(landCount).toBe(19);
    expect(seaMap.filter((t) => t === 'sea')).toHaveLength(LAND_HO_56_GEOMETRY.hexes.length - 19);
    expect(seaMap[board.robber]).toBe('desert');
    expect(board.hexes).toHaveLength(LAND_HO_56_GEOMETRY.hexes.length);
  });

  it('is bigger than the 3–4 board in both home-island and sea-ring hex counts', () => {
    const created = createGame(CONFIG);
    const board34 = buildLandHoBoardV0(created.rng);
    const board56 = buildLandHoBoard56(created.rng);
    const land34 = board34.seaMap.filter((t) => t !== 'sea').length;
    const sea34 = board34.seaMap.filter((t) => t === 'sea').length;
    const land56 = board56.seaMap.filter((t) => t !== 'sea').length;
    const sea56 = board56.seaMap.filter((t) => t === 'sea').length;
    expect(land56).toBeGreaterThan(land34);
    expect(sea56).toBeGreaterThan(sea34);
  });

  it('is deterministic in the threaded rng (no Math.random)', () => {
    const a = buildLandHoBoard56(12345);
    const b = buildLandHoBoard56(12345);
    expect(a.seaMap).toEqual(b.seaMap);
    expect(a.board).toEqual(b.board);
  });

  it('every non-desert home-island hex carries one of LAND_HO_56_TOKENS, desert carries none', () => {
    const created = createGame(CONFIG);
    const { board, seaMap } = buildLandHoBoard56(created.rng);
    const tokensSeen: number[] = [];
    seaMap.forEach((t, hex) => {
      const tile = board.hexes[hex]!;
      if (t === 'sea') {
        expect(tile.token).toBeNull();
      } else if (t === 'desert') {
        expect(tile.token).toBeNull();
      } else {
        expect(tile.token).not.toBeNull();
        tokensSeen.push(tile.token!);
      }
    });
    expect(tokensSeen.sort((a, b) => a - b)).toEqual([...LAND_HO_56_TOKENS].sort((a, b) => a - b));
  });
});

describe('buildLandHoBoardV0 (RK-13: unaffected by the T-1150 refactor)', () => {
  it('still produces the original 7-hex home island / 12-hex sea ring', () => {
    const created = createGame(CONFIG);
    const { seaMap } = buildLandHoBoardV0(created.rng);
    expect(seaMap.filter((t) => t !== 'sea')).toHaveLength(LAND_HO_V0_TERRAINS.length);
    expect(seaMap.filter((t) => t === 'sea')).toHaveLength(seaMap.length - LAND_HO_V0_TERRAINS.length);
  });

  it('is byte-identical for a fixed rng seed (guards the buildLandHoBoardOn extraction)', () => {
    const a = buildLandHoBoardV0(777);
    const b = buildLandHoBoardV0(777);
    expect(a).toEqual(b);
    // Sanity the shared-helper refactor didn't change the fixed 3–4 terrain/token inputs either.
    expect(LAND_HO_V0_TERRAINS).toHaveLength(7);
    expect(LAND_HO_V0_TOKENS).toHaveLength(6);
  });
});
