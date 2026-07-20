// Seafarers pirate — the sea robber (T-703, docs/rules/seafarers-rules.md §S8). The pirate is a
// second robber that lives on SEA hexes: on a 7 (or a Knight, R9.5/S8.3) the mover may relocate the
// pirate INSTEAD of the robber (S8.2). It steals 1 random card from a player who has a ship adjacent
// to its hex (S8.4), blocks ship build/move on adjacent edges (S8.5), and never blocks production.
//
// Wired through the seafarers module's `interceptAction` (index.ts) so the base reducer never names
// the pirate inline. The move parallels the robber pipeline (phases/robber.ts): 0 victims → skip the
// steal, exactly 1 → auto-steal, ≥2 → the base `steal` sub-phase (whose handler is generic over the
// candidate set, so it resolves a pirate steal identically — ER-S5).

import type { BoardGeometry, EdgeId, EngineErrorCode, GameEvent, GameState, HexId, Seat } from '@hexhaven/shared';
import { bundleTotal } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { pirateMoved } from '../../events.js';
import { resolveSteal } from '../../phases/robber.js';
import { geometryForState } from '../index.js';
import { hexTerrainOf, pirateOf, shipsOf } from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/** S8.5: is `edge` one of the pirate hex's 6 edges? Ships may not be built/moved onto such an edge
 *  (and a ship there may not be moved away). `false` when there is no pirate (base game), OR (T-758,
 *  "The Pirate Islands") the pirate currently sits on a `!` (safe) track cell —
 *  `ext.seafarers.pirateTrackSafe` is `undefined`/falsy for every other scenario, so this extra check
 *  is a no-op there. */
export function edgeBordersPirate(state: GameState, geometry: BoardGeometry, edge: EdgeId): boolean {
  const pirate = pirateOf(state);
  if (pirate === undefined) return false;
  if (state.ext?.seafarers?.pirateTrackSafe) return false;
  const e = geometry.edges[edge];
  return !!e && e.hexes.includes(pirate);
}

/**
 * S8.4/ER-S5 candidates for a hypothetical pirate hex: seats other than the active player who own a
 * ship on one of `hex`'s edges AND hold ≥1 resource card. Exported so legal.ts can preview them for
 * any hex while the pirate move is still being chosen.
 */
export function pirateStealCandidates(state: GameState, hex: HexId): Seat[] {
  const geometry = geometryForState(state);
  const geomHex = geometry.hexes[hex];
  if (!geomHex) return [];
  const owner = state.turn.player;
  const hexEdges = new Set<EdgeId>(geomHex.edges);
  return state.players
    .filter((p) => p.seat !== owner)
    .filter((p) => shipsOf(state, p.seat).some((e) => hexEdges.has(e)))
    .filter((p) => bundleTotal(p.resources) > 0)
    .map((p) => p.seat);
}

/**
 * S8.2/S8.4: relocate the pirate to a sea hex during the `moveRobber` sub-phase, then resolve the
 * steal from an adjacent ship's owner (mirrors phases/robber.ts's moveRobberHandler). Turn owner is
 * dispatcher-guaranteed. Returns to the phase the robber pipeline would (`returnTo`).
 */
export function movePirate(state: GameState, seat: Seat, hex: HexId): EngineResult {
  if (state.phase.kind !== 'moveRobber') return fail('WRONG_PHASE', 'not in the moveRobber phase');
  const returnTo = state.phase.returnTo;
  const geometry = geometryForState(state);
  if (!geometry.hexes[hex]) return fail('BAD_LOCATION', `hex ${hex} is off the board`);
  if (hexTerrainOf(state, hex) !== 'sea') {
    return fail('BAD_LOCATION', `the pirate may only move to a sea hex (S8.2)`);
  }
  if (hex === pirateOf(state)) {
    return fail('ROBBER_SAME_HEX', 'the pirate must move to a different hex (S8.2)');
  }

  const ext = state.ext?.seafarers;
  if (!ext) return fail('EXPANSION_NOT_AVAILABLE', 'the pirate requires a seafarers game (S8)');
  const moved: GameState = { ...state, ext: { ...state.ext, seafarers: { ...ext, pirate: hex } } };
  const events: GameEvent[] = [pirateMoved(seat, hex)];
  const candidates = pirateStealCandidates(moved, hex);

  if (candidates.length === 0) {
    // S8.4: no adjacent ship owner with cards — no steal.
    return { ok: true, state: { ...moved, phase: { kind: returnTo } }, events };
  }
  if (candidates.length === 1) {
    // ER-S5: exactly one eligible victim auto-resolves.
    return resolveSteal(moved, seat, candidates[0]!, returnTo, events);
  }
  return {
    ok: true,
    state: { ...moved, phase: { kind: 'steal', candidates, returnTo } },
    events,
  };
}
