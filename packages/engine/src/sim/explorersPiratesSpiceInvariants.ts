// T-1112: the "Spices for Hexhaven" scenario's mode-specific invariants (docs/rules/
// explorers-pirates-rules.md §EP1.3(generalized)/§EP3/§EP4/§EP9/§EP12.4), asserted after every
// successful transition of a Spices for Hexhaven simulation ON TOP of the generalized base I1–I10
// (invariants.ts). Spices for Hexhaven reuses Land Ho!'s SAME board+movement+founding frame
// (createGame.ts's now-generalized E&P branch) with the spice mission additionally ON — so
// EP-SPICE1/2/3/4 below are the exact same checks as Land Ho!'s own EP-LH1/2/3/4 / Fish for Hexhaven's
// own EP-FISH1/2/3/4 (cargo cap / ship cap+uniqueness / harbor<=founded / fog never leaks). Each is an
// INDEPENDENT copy here, not imported from explorersPiratesLandHoInvariants.ts/
// explorersPiratesFishInvariants.ts, per this module's own "every scenario file is self-contained"
// precedent (mirrors board.ts's `hexDistance`, tradersBarbarians's own per-scenario invariant files) —
// so neither of those files (nor their own RK-13-adjacent byte-identity requirements) is ever touched
// by this task. EP-SPICE5/EP-SPICE6 are the new ones this task actually adds: the spice mission's own
// delivery-only VP accrual, and the `spiceBenefit`-derived ship-range bonus staying internally
// consistent with its own cap.
//
//   EP-SPICE1 CARGO CAP: every ship's cargo bay holds at most `SHIP_CARGO_CAP` (2) pieces.
//   EP-SPICE2 SHIP CAP / ONE-PER-EDGE: no seat holds more than `EP_MAX_SHIPS_PER_SEAT` ships, and no
//             two ships (any seat) sit on the same edge (EP3.1 "one ship per edge").
//   EP-SPICE3 HARBOR <= FOUNDED: the running count of `epHarborSettlementBuilt` events never exceeds
//             the running count of settlements ever placed (built/setupPlaced/epSettlementFounded).
//   EP-SPICE4 FOG NEVER LEAKS: for every seat's redacted view (`redact.ts`), every still-`unexplored`
//             hex reads as the fog placeholder in BOTH `board.hexes` and `ext.explorersPirates.seaMap`.
//   EP-SPICE5 SPICE POINTS ONLY VIA DELIVERY: a seat's running `spicePoints` total always equals
//             exactly `SPICE_VP_PER_DELIVERY` times the number of `epSpiceDelivered` events that seat
//             has ever produced — never bumped by any other path (a trade, ship build/move, founding,
//             or a harbor upgrade never award spice VP).
//   EP-SPICE6 SPICE BENEFIT CONSISTENT: a seat's running `spiceBenefit` level always equals exactly the
//             number of `epSpiceDelivered` events that seat has ever produced (every delivery bumps it
//             by exactly 1, uncapped, per `deliverSpiceHandler`'s own v1 model), AND
//             `spiceShipRangeBonus` (the actual ship-move-range bonus `ships.ts` consumes) always
//             equals that level capped at `SPICE_BENEFIT_MAX_BONUS` — the widened range a bot's ships
//             see is never inconsistent with the seat's own delivery count.

import type { Action, GameEvent, GameState, Seat } from '@hexhaven/shared';
import { redact } from '../redact.js';
import {
  EP_MAX_SHIPS_PER_SEAT,
  SHIP_CARGO_CAP,
  SPICE_BENEFIT_MAX_BONUS,
  SPICE_VP_PER_DELIVERY,
  epExt,
  spiceBenefitOf,
  spicePointsOf,
  spiceShipRangeBonus,
} from '../modules/explorersPirates/index.js';

export class ExplorersPiratesSpiceInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'ExplorersPiratesSpiceInvariantViolationError';
  }
}

/** Running totals EP-SPICE3/EP-SPICE5/EP-SPICE6 need: settlements ever placed vs harbor upgrades ever
 *  completed (mirrors `ExplorersPiratesFishAccumulator` exactly), plus each seat's own running
 *  `deliverSpice` count (spice deliveries leave no standalone trace in `GameState` once the mission
 *  tally moves on — same "keep an accumulator" discipline `InvariantAccumulator.playedDevCards`
 *  established). */
export interface ExplorersPiratesSpiceAccumulator {
  settlementsEverPlaced: number;
  harborUpgradesEverBuilt: number;
  spiceDeliveriesBySeat: Partial<Record<Seat, number>>;
}

export function initialExplorersPiratesSpiceAccumulator(): ExplorersPiratesSpiceAccumulator {
  return { settlementsEverPlaced: 0, harborUpgradesEverBuilt: 0, spiceDeliveriesBySeat: {} };
}

function checkCargoCap(state: GameState): void {
  const ext = epExt(state);
  if (!ext) return;
  for (const ship of ext.ships ?? []) {
    if (ship.cargo.length > SHIP_CARGO_CAP) {
      throw new ExplorersPiratesSpiceInvariantViolationError(
        'EP-SPICE1',
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
      throw new ExplorersPiratesSpiceInvariantViolationError(
        'EP-SPICE2',
        `edge ${ship.edge} carries two ships (EP3.1: one ship per edge)`
      );
    }
    seenEdges.add(ship.edge);
  }
  for (const [seat, count] of perSeat) {
    if (count > EP_MAX_SHIPS_PER_SEAT) {
      throw new ExplorersPiratesSpiceInvariantViolationError(
        'EP-SPICE2',
        `seat ${seat} holds ${count} ships > ${EP_MAX_SHIPS_PER_SEAT} (EP3.2, ⚠ VERIFY)`
      );
    }
  }
}

function checkHarborNeverExceedsFounded(acc: ExplorersPiratesSpiceAccumulator): void {
  if (acc.harborUpgradesEverBuilt > acc.settlementsEverPlaced) {
    throw new ExplorersPiratesSpiceInvariantViolationError(
      'EP-SPICE3',
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
        throw new ExplorersPiratesSpiceInvariantViolationError(
          'EP-SPICE4',
          `seat ${p.seat}'s view leaks hex ${hex}'s real board tile (still unexplored)`
        );
      }
      const seaMapEntry = epView?.seaMap?.[hex];
      if (seaMapEntry !== undefined && seaMapEntry !== 'sea') {
        throw new ExplorersPiratesSpiceInvariantViolationError(
          'EP-SPICE4',
          `seat ${p.seat}'s view leaks hex ${hex}'s real seaMap classification '${seaMapEntry}' (still unexplored)`
        );
      }
    }
  }
}

function checkSpicePointsOnlyViaDelivery(state: GameState, acc: ExplorersPiratesSpiceAccumulator): void {
  for (const p of state.players) {
    const deliveries = acc.spiceDeliveriesBySeat[p.seat] ?? 0;
    const expected = deliveries * SPICE_VP_PER_DELIVERY;
    const actual = spicePointsOf(state, p.seat);
    if (actual !== expected) {
      throw new ExplorersPiratesSpiceInvariantViolationError(
        'EP-SPICE5',
        `seat ${p.seat} has ${actual} spicePoints, expected exactly ${expected} (= ${deliveries} deliverSpice x ${SPICE_VP_PER_DELIVERY} VP)`
      );
    }
  }
}

function checkSpiceBenefitConsistent(state: GameState, acc: ExplorersPiratesSpiceAccumulator): void {
  for (const p of state.players) {
    const deliveries = acc.spiceDeliveriesBySeat[p.seat] ?? 0;
    const benefit = spiceBenefitOf(state, p.seat);
    if (benefit !== deliveries) {
      throw new ExplorersPiratesSpiceInvariantViolationError(
        'EP-SPICE6',
        `seat ${p.seat} has spiceBenefit ${benefit}, expected exactly ${deliveries} (1 per deliverSpice, uncapped)`
      );
    }
    const bonus = spiceShipRangeBonus(state, p.seat);
    const expectedBonus = Math.min(benefit, SPICE_BENEFIT_MAX_BONUS);
    if (bonus !== expectedBonus) {
      throw new ExplorersPiratesSpiceInvariantViolationError(
        'EP-SPICE6',
        `seat ${p.seat} has spiceShipRangeBonus ${bonus}, expected exactly min(${benefit}, ${SPICE_BENEFIT_MAX_BONUS}) = ${expectedBonus}`
      );
    }
  }
}

/**
 * Runs EP-SPICE1–EP-SPICE6 against one successful transition, threading the running
 * settlements-placed / harbor-upgrades / per-seat spice-deliveries tallies EP-SPICE3/5/6 need.
 * Throws on the first violation; returns the accumulator otherwise. No-op (immediate passthrough)
 * outside a Spices for Hexhaven game.
 */
export function checkExplorersPiratesSpiceInvariants(
  state: GameState,
  _action: Action,
  events: readonly GameEvent[],
  acc: ExplorersPiratesSpiceAccumulator
): ExplorersPiratesSpiceAccumulator {
  let settlementsEverPlaced = acc.settlementsEverPlaced;
  let harborUpgradesEverBuilt = acc.harborUpgradesEverBuilt;
  const spiceDeliveriesBySeat = { ...acc.spiceDeliveriesBySeat };
  for (const e of events) {
    if (e.type === 'built' && e.piece === 'settlement') settlementsEverPlaced += 1;
    if (e.type === 'setupPlaced' && e.piece === 'settlement') settlementsEverPlaced += 1;
    if (e.type === 'epSettlementFounded') settlementsEverPlaced += 1;
    if (e.type === 'epHarborSettlementBuilt') harborUpgradesEverBuilt += 1;
    if (e.type === 'epSpiceDelivered') {
      spiceDeliveriesBySeat[e.seat] = (spiceDeliveriesBySeat[e.seat] ?? 0) + 1;
    }
  }

  const next = { settlementsEverPlaced, harborUpgradesEverBuilt, spiceDeliveriesBySeat };
  checkCargoCap(state);
  checkShipCapAndUniqueness(state);
  checkHarborNeverExceedsFounded(next);
  checkFogNeverLeaks(state);
  checkSpicePointsOnlyViaDelivery(state, next);
  checkSpiceBenefitConsistent(state, next);

  return next;
}
