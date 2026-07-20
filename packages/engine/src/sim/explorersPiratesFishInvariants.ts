// T-1111: the "Fish for Hexhaven" scenario's mode-specific invariants (docs/rules/
// explorers-pirates-rules.md §EP1.3(generalized)/§EP3/§EP4/§EP8/§EP12.4), asserted after every
// successful transition of a Fish for Hexhaven simulation ON TOP of the generalized base I1–I10
// (invariants.ts). Fish for Hexhaven reuses Land Ho!'s SAME board+movement+founding frame
// (createGame.ts's now-generalized E&P branch) with the fish mission additionally ON — so
// EP-FISH1/2/3/4 below are the exact same checks as Land Ho!'s own EP-LH1/2/3/4 (cargo cap / ship
// cap+uniqueness / harbor<=founded / fog never leaks). Each is an INDEPENDENT copy here, not imported
// from explorersPiratesLandHoInvariants.ts, per this module's own "every scenario file is
// self-contained" precedent (mirrors board.ts's `hexDistance`, tradersBarbarians's own per-scenario
// invariant files) — so Land Ho!'s own file (and its RK-13-adjacent byte-identity requirement) is
// never touched by this task. EP-FISH5 is the new one this task actually adds: the fish mission's own
// delivery-only VP accrual.
//
//   EP-FISH1 CARGO CAP: every ship's cargo bay holds at most `SHIP_CARGO_CAP` (2) pieces.
//   EP-FISH2 SHIP CAP / ONE-PER-EDGE: no seat holds more than `EP_MAX_SHIPS_PER_SEAT` ships, and no
//            two ships (any seat) sit on the same edge (EP3.1 "one ship per edge").
//   EP-FISH3 HARBOR <= FOUNDED: the running count of `epHarborSettlementBuilt` events never exceeds
//            the running count of settlements ever placed (built/setupPlaced/epSettlementFounded).
//   EP-FISH4 FOG NEVER LEAKS: for every seat's redacted view (`redact.ts`), every still-`unexplored`
//            hex reads as the fog placeholder in BOTH `board.hexes` and `ext.explorersPirates.seaMap`.
//   EP-FISH5 FISH POINTS ONLY VIA DELIVERY: a seat's running `fishPoints` total always equals exactly
//            `FISH_VP_PER_DELIVERY` times the number of `epFishDelivered` events that seat has ever
//            produced — never bumped by any other path (a haul, ship build/move, founding, or a
//            harbor upgrade never award fish VP).

import type { Action, GameEvent, GameState, Seat } from '@hexhaven/shared';
import { redact } from '../redact.js';
import {
  EP_MAX_SHIPS_PER_SEAT,
  FISH_VP_PER_DELIVERY,
  SHIP_CARGO_CAP,
  epExt,
  fishPointsOf,
} from '../modules/explorersPirates/index.js';

export class ExplorersPiratesFishInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'ExplorersPiratesFishInvariantViolationError';
  }
}

/** Running totals EP-FISH3/EP-FISH5 need: settlements ever placed vs harbor upgrades ever completed
 *  (mirrors `ExplorersPiratesLandHoAccumulator` exactly), plus each seat's own running `deliverFish`
 *  count (fish deliveries leave no standalone trace in `GameState` once the mission tally moves on —
 *  same "keep an accumulator" discipline `InvariantAccumulator.playedDevCards` established). */
export interface ExplorersPiratesFishAccumulator {
  settlementsEverPlaced: number;
  harborUpgradesEverBuilt: number;
  fishDeliveriesBySeat: Partial<Record<Seat, number>>;
}

export function initialExplorersPiratesFishAccumulator(): ExplorersPiratesFishAccumulator {
  return { settlementsEverPlaced: 0, harborUpgradesEverBuilt: 0, fishDeliveriesBySeat: {} };
}

function checkCargoCap(state: GameState): void {
  const ext = epExt(state);
  if (!ext) return;
  for (const ship of ext.ships ?? []) {
    if (ship.cargo.length > SHIP_CARGO_CAP) {
      throw new ExplorersPiratesFishInvariantViolationError(
        'EP-FISH1',
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
      throw new ExplorersPiratesFishInvariantViolationError(
        'EP-FISH2',
        `edge ${ship.edge} carries two ships (EP3.1: one ship per edge)`
      );
    }
    seenEdges.add(ship.edge);
  }
  for (const [seat, count] of perSeat) {
    if (count > EP_MAX_SHIPS_PER_SEAT) {
      throw new ExplorersPiratesFishInvariantViolationError(
        'EP-FISH2',
        `seat ${seat} holds ${count} ships > ${EP_MAX_SHIPS_PER_SEAT} (EP3.2, ⚠ VERIFY)`
      );
    }
  }
}

function checkHarborNeverExceedsFounded(acc: ExplorersPiratesFishAccumulator): void {
  if (acc.harborUpgradesEverBuilt > acc.settlementsEverPlaced) {
    throw new ExplorersPiratesFishInvariantViolationError(
      'EP-FISH3',
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
        throw new ExplorersPiratesFishInvariantViolationError(
          'EP-FISH4',
          `seat ${p.seat}'s view leaks hex ${hex}'s real board tile (still unexplored)`
        );
      }
      const seaMapEntry = epView?.seaMap?.[hex];
      if (seaMapEntry !== undefined && seaMapEntry !== 'sea') {
        throw new ExplorersPiratesFishInvariantViolationError(
          'EP-FISH4',
          `seat ${p.seat}'s view leaks hex ${hex}'s real seaMap classification '${seaMapEntry}' (still unexplored)`
        );
      }
    }
  }
}

function checkFishPointsOnlyViaDelivery(state: GameState, acc: ExplorersPiratesFishAccumulator): void {
  for (const p of state.players) {
    const deliveries = acc.fishDeliveriesBySeat[p.seat] ?? 0;
    const expected = deliveries * FISH_VP_PER_DELIVERY;
    const actual = fishPointsOf(state, p.seat);
    if (actual !== expected) {
      throw new ExplorersPiratesFishInvariantViolationError(
        'EP-FISH5',
        `seat ${p.seat} has ${actual} fishPoints, expected exactly ${expected} (= ${deliveries} deliverFish x ${FISH_VP_PER_DELIVERY} VP)`
      );
    }
  }
}

/**
 * Runs EP-FISH1–EP-FISH5 against one successful transition, threading the running
 * settlements-placed / harbor-upgrades / per-seat fish-deliveries tallies EP-FISH3/EP-FISH5 need.
 * Throws on the first violation; returns the accumulator otherwise. No-op (immediate passthrough)
 * outside a Fish for Hexhaven game.
 */
export function checkExplorersPiratesFishInvariants(
  state: GameState,
  _action: Action,
  events: readonly GameEvent[],
  acc: ExplorersPiratesFishAccumulator
): ExplorersPiratesFishAccumulator {
  let settlementsEverPlaced = acc.settlementsEverPlaced;
  let harborUpgradesEverBuilt = acc.harborUpgradesEverBuilt;
  const fishDeliveriesBySeat = { ...acc.fishDeliveriesBySeat };
  for (const e of events) {
    if (e.type === 'built' && e.piece === 'settlement') settlementsEverPlaced += 1;
    if (e.type === 'setupPlaced' && e.piece === 'settlement') settlementsEverPlaced += 1;
    if (e.type === 'epSettlementFounded') settlementsEverPlaced += 1;
    if (e.type === 'epHarborSettlementBuilt') harborUpgradesEverBuilt += 1;
    if (e.type === 'epFishDelivered') {
      fishDeliveriesBySeat[e.seat] = (fishDeliveriesBySeat[e.seat] ?? 0) + 1;
    }
  }

  const next = { settlementsEverPlaced, harborUpgradesEverBuilt, fishDeliveriesBySeat };
  checkCargoCap(state);
  checkShipCapAndUniqueness(state);
  checkHarborNeverExceedsFounded(next);
  checkFogNeverLeaks(state);
  checkFishPointsOnlyViaDelivery(state, next);

  return next;
}
