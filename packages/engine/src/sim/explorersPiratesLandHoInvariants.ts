// T-1107: the "Land Ho!" scenario's mode-specific invariants (docs/rules/explorers-pirates-rules.md
// §EP1.3/§EP3/§EP4/§EP5/§EP12.4), asserted after every successful transition of a Land Ho!
// simulation ON TOP of the generalized base I1–I10 (invariants.ts). Like every other per-scenario
// invariant file (fishermenInvariants.ts et al.), every check is a from-scratch recomputation over
// `state` (or `state` + a threaded accumulator for the one DELTA-shaped property), never a read of
// a flag the engine itself set.
//
//   EP-LH1 CARGO CAP: every ship's cargo bay holds at most `SHIP_CARGO_CAP` (2) pieces.
//   EP-LH2 SHIP CAP / ONE-PER-EDGE: no seat holds more than `EP_MAX_SHIPS_PER_SEAT` ships, and no
//          two ships (any seat) sit on the same edge (EP3.1 "one ship per edge").
//   EP-LH3 HARBOR <= FOUNDED: the running count of `epHarborSettlementBuilt` events never exceeds
//          the running count of settlements ever placed (`built`{piece:'settlement'} — home-island
//          building — + `setupPlaced`{piece:'settlement'} + `epSettlementFounded`) — an upgrade
//          always consumes an existing settlement instance, so it can never outpace the total ever
//          placed, even though a recycled piece can be built/upgraded/rebuilt many times over.
//   EP-LH4 FOG NEVER LEAKS: for every seat's redacted view (`redact.ts`), every still-`unexplored`
//          hex reads as the fog placeholder in BOTH `board.hexes` (base-terrain proxy) and
//          `ext.explorersPirates.seaMap` (the authoritative classification) — never the real
//          terrain/gold underneath (EP12.4's cheat-proof boundary).
//
// Deliberately NOT asserted: that every ship's CURRENT edge is still classified a "sea edge". A ship
// resting on a coastal (or single-hex boundary) edge that itself triggers a `'terrain'` reveal
// legitimately converts that edge into a land-only edge the instant the reveal lands — the ship
// doesn't teleport away, and `moveEPShipHandler`'s own reachability search never re-validates a
// ship's OWN resting edge (only the hops leading away from it, ships.ts's `seaEdgesWithinRange`) — so
// this is an accepted v1 quirk of the reveal-on-arrival design (exploration.ts's header flags the
// reveal-trigger model itself as ⚠ VERIFY), not a bug this suite should flag as one.

import type { Action, GameEvent, GameState, Seat } from '@hexhaven/shared';
import { redact } from '../redact.js';
import { EP_MAX_SHIPS_PER_SEAT, SHIP_CARGO_CAP, epExt } from '../modules/explorersPirates/index.js';

export class ExplorersPiratesLandHoInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'ExplorersPiratesLandHoInvariantViolationError';
  }
}

/** Running totals EP-LH3 needs: settlements ever placed (setup + home-island build + ship-founded)
 *  vs harbor upgrades ever completed — neither leaves a standalone trace in `GameState` itself once
 *  a piece cycles (built -> upgraded -> rebuilt elsewhere), so the invariant checker keeps its own
 *  tally from events, mirroring `InvariantAccumulator.playedDevCards`. */
export interface ExplorersPiratesLandHoAccumulator {
  settlementsEverPlaced: number;
  harborUpgradesEverBuilt: number;
}

export function initialExplorersPiratesLandHoAccumulator(): ExplorersPiratesLandHoAccumulator {
  return { settlementsEverPlaced: 0, harborUpgradesEverBuilt: 0 };
}

function checkCargoCap(state: GameState): void {
  const ext = epExt(state);
  if (!ext) return;
  for (const ship of ext.ships ?? []) {
    if (ship.cargo.length > SHIP_CARGO_CAP) {
      throw new ExplorersPiratesLandHoInvariantViolationError(
        'EP-LH1',
        `ship on edge ${ship.edge} (seat ${ship.seat}) carries ${ship.cargo.length} > ${SHIP_CARGO_CAP} cargo`
      );
    }
  }
}

function checkShipCapAndUniqueness(state: GameState): void {
  const ext = epExt(state);
  if (!ext) return;
  const ships = ext.ships ?? [];
  const perSeat = new Map<Seat, number>();
  const seenEdges = new Set<number>();
  for (const ship of ships) {
    perSeat.set(ship.seat, (perSeat.get(ship.seat) ?? 0) + 1);
    if (seenEdges.has(ship.edge)) {
      throw new ExplorersPiratesLandHoInvariantViolationError(
        'EP-LH2',
        `edge ${ship.edge} carries two ships (EP3.1: one ship per edge)`
      );
    }
    seenEdges.add(ship.edge);
  }
  for (const [seat, count] of perSeat) {
    if (count > EP_MAX_SHIPS_PER_SEAT) {
      throw new ExplorersPiratesLandHoInvariantViolationError(
        'EP-LH2',
        `seat ${seat} holds ${count} ships > ${EP_MAX_SHIPS_PER_SEAT} (EP3.2, ⚠ VERIFY)`
      );
    }
  }
}

function checkHarborNeverExceedsFounded(acc: ExplorersPiratesLandHoAccumulator): void {
  if (acc.harborUpgradesEverBuilt > acc.settlementsEverPlaced) {
    throw new ExplorersPiratesLandHoInvariantViolationError(
      'EP-LH3',
      `${acc.harborUpgradesEverBuilt} harbor upgrades ever built exceeds ${acc.settlementsEverPlaced} settlements ever placed`
    );
  }
}

function checkFogNeverLeaks(state: GameState): void {
  const ext = epExt(state);
  if (!ext) return;
  const unexplored = ext.unexplored ?? [];
  if (unexplored.length === 0) return;
  for (const p of state.players) {
    const view = redact(state, p.seat);
    const epView = view.ext?.explorersPirates;
    for (const hex of unexplored) {
      const tile = view.board.hexes[hex];
      if (!tile || tile.terrain !== 'desert' || tile.token !== null) {
        throw new ExplorersPiratesLandHoInvariantViolationError(
          'EP-LH4',
          `seat ${p.seat}'s view leaks hex ${hex}'s real board tile (still unexplored)`
        );
      }
      const seaMapEntry = epView?.seaMap?.[hex];
      if (seaMapEntry !== undefined && seaMapEntry !== 'sea') {
        throw new ExplorersPiratesLandHoInvariantViolationError(
          'EP-LH4',
          `seat ${p.seat}'s view leaks hex ${hex}'s real seaMap classification '${seaMapEntry}' (still unexplored)`
        );
      }
    }
  }
}

/**
 * Runs EP-LH1–EP-LH4 against one successful transition, threading the running settlements-placed /
 * harbor-upgrades tallies EP-LH3 needs. Throws on the first violation; returns the accumulator
 * otherwise. No-op (immediate passthrough) outside a Land Ho! game.
 */
export function checkExplorersPiratesLandHoInvariants(
  state: GameState,
  _action: Action,
  events: readonly GameEvent[],
  acc: ExplorersPiratesLandHoAccumulator
): ExplorersPiratesLandHoAccumulator {
  let settlementsEverPlaced = acc.settlementsEverPlaced;
  let harborUpgradesEverBuilt = acc.harborUpgradesEverBuilt;
  for (const e of events) {
    if (e.type === 'built' && e.piece === 'settlement') settlementsEverPlaced += 1;
    if (e.type === 'setupPlaced' && e.piece === 'settlement') settlementsEverPlaced += 1;
    if (e.type === 'epSettlementFounded') settlementsEverPlaced += 1;
    if (e.type === 'epHarborSettlementBuilt') harborUpgradesEverBuilt += 1;
  }

  checkCargoCap(state);
  checkShipCapAndUniqueness(state);
  checkHarborNeverExceedsFounded({ settlementsEverPlaced, harborUpgradesEverBuilt });
  checkFogNeverLeaks(state);

  return { settlementsEverPlaced, harborUpgradesEverBuilt };
}
