// T-758: "The Pirate Islands" — the auto-moving pirate track (`advancePirateTrack`) + lair capture
// (`grantLairCapture`/`lairVp`). Mirrors cloth.test.ts's shape: these tests drive the pure functions
// directly (a real `rollDice`/`buildSettlement` action threads rng/turn state this file doesn't need
// to reconstruct), since the mechanics themselves are deterministic and track-driven; `sim/
// seafarers.test.ts`'s T-758 smoke is the end-to-end proof both hooks actually fire during ordinary
// bot play (and that the pirate never deadlocks a game, the task's own CRITICAL risk).

import { describe, expect, it } from 'vitest';
import type { GameConfig, GameState, HexId, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { redact } from '../../redact.js';
import { computeVp } from '../../vp.js';
import { geometryForState } from '../index.js';
import { scenarioLairHexesFor, scenarioPirateTrackFor } from './board.js';
import { LAIR_VP, grantLairCapture, isPirateIslandsState, lairVp } from './lairs.js';
import { edgeBordersPirate } from './pirate.js';
import { advancePirateTrack } from './pirateTrack.js';
import { lairsOf, pirateOf } from './state.js';

/** A Seafarers 5–6 extension config for a given scenario id. */
function fiveSixSeafarersConfig(scenario: string, playerCount: 5 | 6 = 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario }, citiesKnights: false },
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

/** Put `patch` onto one seat's player record (mirrors chits.test.ts/cloth.test.ts's `withSeat`). */
function withSeat(state: GameState, seat: Seat, patch: Partial<GameState['players'][number]>): GameState {
  return { ...state, players: state.players.map((p) => (p.seat === seat ? { ...p, ...patch } : p)) };
}

/** The first lair hex + one incident vertex (mirrors cloth.test.ts's `firstVillage`). */
function firstLair(state: GameState): { hex: HexId; vertex: VertexId } {
  const lairs = scenarioLairHexesFor(state.config);
  const hex = lairs[0];
  if (hex === undefined) throw new Error('no lair hex on this board');
  const geomHex = geometryForState(state).hexes[hex];
  const vertex = geomHex?.vertices[0];
  if (vertex === undefined) throw new Error('lair hex has no vertex');
  return { hex, vertex };
}

describe('T-758 The Pirate Islands — advancePirateTrack', () => {
  it('a scenario without a pirate track (Heading for New Shores) is untouched: advancePirateTrack is a no-op', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('headingForNewShores'), seed: 'pi-baseline' });
    expect(isPirateIslandsState(g)).toBe(false);
    expect(g.ext?.seafarers?.pirateTrackIndex).toBeUndefined();
    expect(advancePirateTrack(g)).toBe(g); // reference-equal no-op
  });

  it('Pirate Islands seeds the pirate at track index 0, matching the generated pirate hex', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('pirateIslands'), seed: 'pi-seed' });
    const track = scenarioPirateTrackFor(g.config);
    expect(track.length).toBeGreaterThan(0);
    expect(g.ext?.seafarers?.pirateTrackIndex).toBe(0);
    expect(pirateOf(g)).toBe(track[0]!.hex);
    expect(g.ext?.seafarers?.pirateTrackSafe).toBe(track[0]!.safe);
  });

  it('each advance moves the pirate exactly ONE step deterministically, and wraps at the end', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('pirateIslands'), seed: 'pi-advance' });
    const track = scenarioPirateTrackFor(g.config);

    let state = g;
    for (let i = 1; i <= track.length; i++) {
      const next = advancePirateTrack(state);
      const expectedIndex = i % track.length;
      const expectedEntry = track[expectedIndex]!;
      expect(next.ext?.seafarers?.pirateTrackIndex).toBe(expectedIndex);
      expect(pirateOf(next)).toBe(expectedEntry.hex);
      expect(next.ext?.seafarers?.pirateTrackSafe).toBe(expectedEntry.safe);
      expect(next).not.toBe(state); // spread-copied, not mutated
      state = next;
    }
    // After exactly `track.length` advances, we've wrapped all the way back to the start.
    expect(state.ext?.seafarers?.pirateTrackIndex).toBe(0);
    expect(pirateOf(state)).toBe(track[0]!.hex);
  });
});

describe('T-758 The Pirate Islands — safe (`!`) track cells suppress S8.5 blocking', () => {
  it('a non-safe track cell blocks an adjacent edge exactly like the ordinary S8 pirate', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('pirateIslands'), seed: 'pi-blocking' });
    const track = scenarioPirateTrackFor(g.config);
    const nonSafeIdx = track.findIndex((t) => !t.safe);
    expect(nonSafeIdx).toBeGreaterThanOrEqual(0);

    // Drive the pirate to the non-safe entry.
    let state = g;
    for (let i = 0; i < 20 && state.ext?.seafarers?.pirateTrackIndex !== nonSafeIdx; i++) {
      state = advancePirateTrack(state);
    }
    expect(state.ext?.seafarers?.pirateTrackIndex).toBe(nonSafeIdx);
    expect(state.ext?.seafarers?.pirateTrackSafe).toBe(false);

    const geometry = geometryForState(state);
    const pirateHex = pirateOf(state)!;
    const edge = geometry.hexes[pirateHex]?.edges[0];
    expect(edge).toBeDefined();
    expect(edgeBordersPirate(state, geometry, edge!)).toBe(true);
  });

  it('a safe track cell makes the pirate inert (no S8.5 blocking) despite sitting on the hex', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('pirateIslands'), seed: 'pi-safe' });
    const track = scenarioPirateTrackFor(g.config);
    const safeIdx = track.findIndex((t) => t.safe);
    expect(safeIdx).toBeGreaterThanOrEqual(0);

    let state = g;
    for (let i = 0; i < 20 && state.ext?.seafarers?.pirateTrackIndex !== safeIdx; i++) {
      state = advancePirateTrack(state);
    }
    expect(state.ext?.seafarers?.pirateTrackIndex).toBe(safeIdx);
    expect(state.ext?.seafarers?.pirateTrackSafe).toBe(true);

    const geometry = geometryForState(state);
    const pirateHex = pirateOf(state)!;
    expect(pirateHex).toBe(track[safeIdx]!.hex); // the pirate DOES sit on the safe hex (still renders)
    const edge = geometry.hexes[pirateHex]?.edges[0];
    expect(edge).toBeDefined();
    // The blocking check is suppressed, even though this edge borders the pirate's hex.
    expect(edgeBordersPirate(state, geometry, edge!)).toBe(false);
  });

  it('other seafarers scenarios never set pirateTrackSafe, so edgeBordersPirate is unaffected there', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('headingForNewShores'), seed: 'pi-other-scenario' });
    expect(g.ext?.seafarers?.pirateTrackSafe).toBeUndefined();
    const geometry = geometryForState(g);
    const pirateHex = pirateOf(g)!;
    const edge = geometry.hexes[pirateHex]?.edges[0];
    expect(edge).toBeDefined();
    expect(edgeBordersPirate(g, geometry, edge!)).toBe(true); // ordinary S8 blocking, unchanged
  });
});

describe('T-758 The Pirate Islands — grantLairCapture / lairVp', () => {
  it('a scenario without lairs (Heading for New Shores) is untouched', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('headingForNewShores'), seed: 'pi-lair-baseline' });
    expect(isPirateIslandsState(g)).toBe(false);
    expect(lairVp(g, 0)).toBe(0);
    expect(computeVp(g, 0).lairVp).toBeUndefined(); // key omitted entirely (bit-identity discipline)
    const geometry = geometryForState(g);
    const anyEdge = geometry.edges[0]!;
    expect(grantLairCapture(g, 0, anyEdge.hexes)).toBeNull();
  });

  it('Pirate Islands seeds an empty lair-capture list for every seat', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('pirateIslands'), seed: 'pi-lair-seed' });
    expect(isPirateIslandsState(g)).toBe(true);
    expect(g.ext?.seafarers?.lairs).toEqual([[], [], [], [], [], []]);
  });

  it('a settlement touching a lair hex captures it, granting lairVp once', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('pirateIslands'), seed: 'pi-lair-capture' });
    const { hex, vertex } = firstLair(g);
    const s = withSeat(g, 0, { settlements: [vertex] });

    const geomVertex = geometryForState(s).vertices[vertex]!;
    const result = grantLairCapture(s, 0, geomVertex.hexes);
    expect(result).not.toBeNull();
    const next = result!.state;
    expect(lairsOf(next, 0)).toContain(hex);
    expect(lairVp(next, 0)).toBe(LAIR_VP);
    expect(computeVp(next, 0).lairVp).toBe(LAIR_VP);
    expect(next.ext!.seafarers!.lairs).not.toBe(s.ext!.seafarers!.lairs); // spread-copied, not mutated
  });

  it('the SAME lair cannot be captured twice, even by a different seat (first seat wins)', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('pirateIslands'), seed: 'pi-lair-once' });
    const { vertex } = firstLair(g);
    const s0 = withSeat(g, 0, { settlements: [vertex] });
    const geomVertex = geometryForState(s0).vertices[vertex]!;
    const afterFirst = grantLairCapture(s0, 0, geomVertex.hexes)!.state;

    // A second seat touching the SAME lair hex gains nothing — it's already captured.
    const s1 = withSeat(afterFirst, 1, { settlements: [vertex] });
    const second = grantLairCapture(s1, 1, geomVertex.hexes);
    expect(second).toBeNull();
    expect(lairVp(s1, 1)).toBe(0);
    expect(lairVp(s1, 0)).toBe(LAIR_VP);
  });

  it('a ship edge touching a lair hex also captures it (not settlement-only)', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('pirateIslands'), seed: 'pi-lair-ship' });
    const { hex } = firstLair(g);
    const geometry = geometryForState(g);
    const edge = geometry.hexes[hex]?.edges[0];
    expect(edge).toBeDefined();
    const geomEdge = geometry.edges[edge!]!;

    const result = grantLairCapture(g, 2, geomEdge.hexes);
    expect(result).not.toBeNull();
    expect(lairsOf(result!.state, 2)).toContain(hex);
  });

  it('a placement NOT touching any lair hex grants nothing', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('pirateIslands'), seed: 'pi-lair-nonadjacent' });
    const geometry = geometryForState(g);
    const lairHexes = new Set(scenarioLairHexesFor(g.config));
    // Find any edge whose hexes don't touch a lair.
    const farEdge = geometry.edges.find((e) => e.hexes.every((h) => !lairHexes.has(h)));
    expect(farEdge).toBeDefined();
    expect(grantLairCapture(g, 0, farEdge!.hexes)).toBeNull();
  });
});

describe('T-758 The Pirate Islands — redaction (public pass-through, no masking)', () => {
  it('pirateTrackIndex/pirateTrackSafe/lairs pass through unredacted for every viewer, incl. non-owners', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('pirateIslands'), seed: 'pi-redact' });
    const { vertex } = firstLair(g);
    const s = withSeat(g, 0, { settlements: [vertex] });
    const geomVertex = geometryForState(s).vertices[vertex]!;
    const captured = grantLairCapture(s, 0, geomVertex.hexes)!.state;

    for (const viewer of [0, 1, 2] as Seat[]) {
      const view = redact(captured, viewer);
      expect(view.ext?.seafarers?.pirateTrackIndex).toBe(captured.ext?.seafarers?.pirateTrackIndex);
      expect(view.ext?.seafarers?.pirateTrackSafe).toBe(captured.ext?.seafarers?.pirateTrackSafe);
      expect(view.ext?.seafarers?.lairs).toEqual(captured.ext?.seafarers?.lairs);
    }
  });

  it('every other seafarers scenario omits pirateTrackIndex/pirateTrackSafe/lairs entirely from the view', () => {
    const g = createGame({ ...fiveSixSeafarersConfig('headingForNewShores'), seed: 'pi-redact-other' });
    const view = redact(g, 0);
    expect(view.ext?.seafarers?.pirateTrackIndex).toBeUndefined();
    expect(view.ext?.seafarers?.pirateTrackSafe).toBeUndefined();
    expect(view.ext?.seafarers?.lairs).toBeUndefined();
  });
});
