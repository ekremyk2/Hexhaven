// T-1113: the "The Pirate Lairs" scenario's mode-specific invariants (docs/rules/
// explorers-pirates-rules.md §EP1.3(generalized)/§EP3/§EP4/§EP7/§EP12.4), asserted after every
// successful transition of a Pirate Lairs simulation ON TOP of the generalized base I1–I10
// (invariants.ts). The Pirate Lairs scenario reuses Land Ho!'s SAME board+movement+founding frame
// (createGame.ts's now-generalized E&P branch) with the pirateLairs mission additionally ON — so
// EP-LAIR1/2/3/4 below are the exact same checks as Land Ho!'s own EP-LH1/2/3/4 / Fish for Hexhaven's
// own EP-FISH1/2/3/4 / Spices for Hexhaven's own EP-SPICE1/2/3/4 (cargo cap / ship cap+uniqueness /
// harbor<=founded / fog never leaks). Each is an INDEPENDENT copy here, not imported from any of
// those three files, per this module's own "every scenario file is self-contained" precedent
// (explorersPiratesSpiceInvariants.ts's own header) — so none of those files (nor their own
// RK-13-adjacent byte-identity requirements) is ever touched by this task. EP-LAIR5/6/7 are the new
// ones this task actually adds: lair-capture VP accrues ONLY via a captured lair (never any other
// path), a seat's crew reserve never goes negative (crews built vs crews loaded stay reconciled —
// "crews ≤ supply"), and an ACTIVE (uncaptured) lair never persists holding
// `LAIR_CAPTURE_CREWS` (3) or more crews (T-1105's placeCrewOnLairHandler captures-and-removes the
// instant it reaches 3 — this is the sim's own belt-and-suspenders check that logic actually holds).
//
//   EP-LAIR1 CARGO CAP: every ship's cargo bay holds at most `SHIP_CARGO_CAP` (2) pieces.
//   EP-LAIR2 SHIP CAP / ONE-PER-EDGE: no seat holds more than `EP_MAX_SHIPS_PER_SEAT` ships, and no
//            two ships (any seat) sit on the same edge (EP3.1 "one ship per edge").
//   EP-LAIR3 HARBOR <= FOUNDED: the running count of `epHarborSettlementBuilt` events never exceeds
//            the running count of settlements ever placed (built/setupPlaced/epSettlementFounded).
//   EP-LAIR4 FOG NEVER LEAKS: for every seat's redacted view (`redact.ts`), every still-`unexplored`
//            hex reads as the fog placeholder in BOTH `board.hexes` and `ext.explorersPirates.seaMap`.
//   EP-LAIR5 LAIR POINTS ONLY VIA CAPTURE: a seat's running `lairPoints` total always equals exactly
//            the sum of that seat's own `vp` entries across every `epLairCaptured` event's `awards`
//            array ever emitted — never bumped by any other path (a trade, ship build/move,
//            founding, or a harbor upgrade never awards lair VP).
//   EP-LAIR6 CREWS <= SUPPLY: a seat's running unloaded crew reserve (`crewSupplyOf`) always equals
//            exactly (crews ever built via `epCrewBuilt`) minus (crews ever loaded onto a ship via
//            `loadCargo{piece:'crew'}`) — and that reserve is never negative (a seat can never load
//            more crews than it has built).
//   EP-LAIR7 ACTIVE LAIRS UNDER THRESHOLD: every still-active (uncaptured) entry in
//            `ext.explorersPirates.pirateLairs` holds strictly fewer than `LAIR_CAPTURE_CREWS` (3)
//            crews — the instant a lair reaches 3 it is captured and removed from this list
//            (pirateLairs.ts), so it must never be observed sitting at/above the threshold.

import type { Action, GameEvent, GameState, Seat } from '@hexhaven/shared';
import { redact } from '../redact.js';
import {
  EP_MAX_SHIPS_PER_SEAT,
  LAIR_CAPTURE_CREWS,
  SHIP_CARGO_CAP,
  crewSupplyOf,
  epExt,
  lairPointsOf,
  pirateLairsOf,
} from '../modules/explorersPirates/index.js';

export class ExplorersPiratesPirateLairsInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'ExplorersPiratesPirateLairsInvariantViolationError';
  }
}

/** Running totals EP-LAIR3/5/6 need: settlements ever placed vs harbor upgrades ever completed
 *  (mirrors `ExplorersPiratesSpiceAccumulator` exactly), plus each seat's own running lair-VP awarded
 *  (from `epLairCaptured` events' `awards`) and crews built/loaded (crew build/load events leave no
 *  standalone trace in `GameState` once the reserve counter moves on — same "keep an accumulator"
 *  discipline `ExplorersPiratesSpiceAccumulator.spiceDeliveriesBySeat` established). */
export interface ExplorersPiratesPirateLairsAccumulator {
  settlementsEverPlaced: number;
  harborUpgradesEverBuilt: number;
  lairVpAwardedBySeat: Partial<Record<Seat, number>>;
  crewsBuiltBySeat: Partial<Record<Seat, number>>;
  crewsLoadedBySeat: Partial<Record<Seat, number>>;
}

export function initialExplorersPiratesPirateLairsAccumulator(): ExplorersPiratesPirateLairsAccumulator {
  return {
    settlementsEverPlaced: 0,
    harborUpgradesEverBuilt: 0,
    lairVpAwardedBySeat: {},
    crewsBuiltBySeat: {},
    crewsLoadedBySeat: {},
  };
}

function checkCargoCap(state: GameState): void {
  const ext = epExt(state);
  if (!ext) return;
  for (const ship of ext.ships ?? []) {
    if (ship.cargo.length > SHIP_CARGO_CAP) {
      throw new ExplorersPiratesPirateLairsInvariantViolationError(
        'EP-LAIR1',
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
      throw new ExplorersPiratesPirateLairsInvariantViolationError(
        'EP-LAIR2',
        `edge ${ship.edge} carries two ships (EP3.1: one ship per edge)`
      );
    }
    seenEdges.add(ship.edge);
  }
  for (const [seat, count] of perSeat) {
    if (count > EP_MAX_SHIPS_PER_SEAT) {
      throw new ExplorersPiratesPirateLairsInvariantViolationError(
        'EP-LAIR2',
        `seat ${seat} holds ${count} ships > ${EP_MAX_SHIPS_PER_SEAT} (EP3.2, ⚠ VERIFY)`
      );
    }
  }
}

function checkHarborNeverExceedsFounded(acc: ExplorersPiratesPirateLairsAccumulator): void {
  if (acc.harborUpgradesEverBuilt > acc.settlementsEverPlaced) {
    throw new ExplorersPiratesPirateLairsInvariantViolationError(
      'EP-LAIR3',
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
        throw new ExplorersPiratesPirateLairsInvariantViolationError(
          'EP-LAIR4',
          `seat ${p.seat}'s view leaks hex ${hex}'s real board tile (still unexplored)`
        );
      }
      const seaMapEntry = epView?.seaMap?.[hex];
      if (seaMapEntry !== undefined && seaMapEntry !== 'sea') {
        throw new ExplorersPiratesPirateLairsInvariantViolationError(
          'EP-LAIR4',
          `seat ${p.seat}'s view leaks hex ${hex}'s real seaMap classification '${seaMapEntry}' (still unexplored)`
        );
      }
    }
  }
}

function checkLairPointsOnlyViaCapture(state: GameState, acc: ExplorersPiratesPirateLairsAccumulator): void {
  for (const p of state.players) {
    const expected = acc.lairVpAwardedBySeat[p.seat] ?? 0;
    const actual = lairPointsOf(state, p.seat);
    if (actual !== expected) {
      throw new ExplorersPiratesPirateLairsInvariantViolationError(
        'EP-LAIR5',
        `seat ${p.seat} has ${actual} lairPoints, expected exactly ${expected} (sum of this seat's epLairCaptured awards)`
      );
    }
  }
}

function checkCrewsNeverExceedSupply(state: GameState, acc: ExplorersPiratesPirateLairsAccumulator): void {
  for (const p of state.players) {
    const built = acc.crewsBuiltBySeat[p.seat] ?? 0;
    const loaded = acc.crewsLoadedBySeat[p.seat] ?? 0;
    const expectedReserve = built - loaded;
    if (expectedReserve < 0) {
      throw new ExplorersPiratesPirateLairsInvariantViolationError(
        'EP-LAIR6',
        `seat ${p.seat} has loaded ${loaded} crews > ${built} ever built (crews must never exceed supply)`
      );
    }
    const actualReserve = crewSupplyOf(state, p.seat);
    if (actualReserve !== expectedReserve) {
      throw new ExplorersPiratesPirateLairsInvariantViolationError(
        'EP-LAIR6',
        `seat ${p.seat} has crewSupply ${actualReserve}, expected exactly ${expectedReserve} (= ${built} built - ${loaded} loaded)`
      );
    }
  }
}

function checkActiveLairsUnderThreshold(state: GameState): void {
  for (const lair of pirateLairsOf(state)) {
    if (lair.crews.length >= LAIR_CAPTURE_CREWS) {
      throw new ExplorersPiratesPirateLairsInvariantViolationError(
        'EP-LAIR7',
        `active lair at hex ${lair.hex} holds ${lair.crews.length} >= ${LAIR_CAPTURE_CREWS} crews (should have been captured+removed)`
      );
    }
  }
}

/**
 * Runs EP-LAIR1–EP-LAIR7 against one successful transition, threading the running
 * settlements-placed / harbor-upgrades / per-seat lair-VP / per-seat crew-built/loaded tallies
 * EP-LAIR3/5/6 need. Throws on the first violation; returns the accumulator otherwise. No-op
 * (immediate passthrough) outside a Pirate Lairs game.
 */
export function checkExplorersPiratesPirateLairsInvariants(
  state: GameState,
  _action: Action,
  events: readonly GameEvent[],
  acc: ExplorersPiratesPirateLairsAccumulator
): ExplorersPiratesPirateLairsAccumulator {
  let settlementsEverPlaced = acc.settlementsEverPlaced;
  let harborUpgradesEverBuilt = acc.harborUpgradesEverBuilt;
  const lairVpAwardedBySeat = { ...acc.lairVpAwardedBySeat };
  const crewsBuiltBySeat = { ...acc.crewsBuiltBySeat };
  const crewsLoadedBySeat = { ...acc.crewsLoadedBySeat };
  for (const e of events) {
    if (e.type === 'built' && e.piece === 'settlement') settlementsEverPlaced += 1;
    if (e.type === 'setupPlaced' && e.piece === 'settlement') settlementsEverPlaced += 1;
    if (e.type === 'epSettlementFounded') settlementsEverPlaced += 1;
    if (e.type === 'epHarborSettlementBuilt') harborUpgradesEverBuilt += 1;
    if (e.type === 'epCrewBuilt') {
      crewsBuiltBySeat[e.seat] = (crewsBuiltBySeat[e.seat] ?? 0) + 1;
    }
    if (e.type === 'epCargoLoaded' && e.piece === 'crew') {
      crewsLoadedBySeat[e.seat] = (crewsLoadedBySeat[e.seat] ?? 0) + 1;
    }
    if (e.type === 'epLairCaptured') {
      for (const award of e.awards) {
        lairVpAwardedBySeat[award.seat] = (lairVpAwardedBySeat[award.seat] ?? 0) + award.vp;
      }
    }
  }

  const next = { settlementsEverPlaced, harborUpgradesEverBuilt, lairVpAwardedBySeat, crewsBuiltBySeat, crewsLoadedBySeat };
  checkCargoCap(state);
  checkShipCapAndUniqueness(state);
  checkHarborNeverExceedsFounded(next);
  checkFogNeverLeaks(state);
  checkLairPointsOnlyViaCapture(state, next);
  checkCrewsNeverExceedSupply(state, next);
  checkActiveLairsUnderThreshold(state);

  return next;
}
