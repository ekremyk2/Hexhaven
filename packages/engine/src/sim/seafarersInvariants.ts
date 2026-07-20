// T-706: the Seafarers scenario's mode-specific invariants, asserted after every successful
// transition of a seafarers simulation (on TOP of the generalized base I1–I10 in invariants.ts,
// which already run config-aware over the scenario geometry and whose `checkSeafarers` covers ship
// supply *conservation*, ship-on-sea-edge, and one-piece-per-edge). This file adds the whole-state
// seafarers properties the base suite does not: ship-supply BOUNDS, the pirate staying on a sea hex
// (so it can never block production, S8.5), and island-chit legitimacy (S10.6).
//
// Like invariants.ts, every check is a from-scratch recomputation over `next` (never a read of a flag
// the engine set), so a bug in the very code being cross-checked is caught.
//
//   SF-SHIP1  ship supply bounds — 0 ≤ shipsLeft ≤ 15 and 0 ≤ ships.built ≤ 15 for every seat
//             (S1.1). Strengthens checkSeafarers's sum-only check, which a negative shipsLeft masking
//             >15 built ships would otherwise slip past.
//   SF-PIRATE the pirate always sits on a SEA hex (S8.1/S8.5). Sea hexes never produce (S3.1), so
//             this is exactly "the pirate never blocks production" re-derived from board terrain.
//   SF-CHIT1  each seat's earned island ids are DISTINCT (S10.6 "once per island").
//   SF-CHIT2  every earned island id is a real small-island group that STILL hosts one of that seat's
//             buildings — a chit is only ever earned by settling there, and buildings are never
//             removed, so the board must corroborate every recorded chit.

import type { Action, GameEvent, GameState } from '@hexhaven/shared';
import { islandOfVertex } from '../modules/seafarers/chits.js';
import { SHIPS_PER_PLAYER, hexTerrainOf, islandChitsOf, shipsLeftOf, shipsOf } from '../modules/seafarers/state.js';

export class SeafarersInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'SeafarersInvariantViolationError';
  }
}

/** Whole-game seafarers observations threaded across a game for the sim's stat report (not violations):
 *  the most ships any single seat held on the board at once, and whether an island chit was ever seen
 *  earned (an `islandSettled` event). */
export interface SeafarersAccumulator {
  peakShipsOnBoard: number;
  sawIslandSettled: boolean;
}

export function initialSeafarersAccumulator(): SeafarersAccumulator {
  return { peakShipsOnBoard: 0, sawIslandSettled: false };
}

// ---- SF-SHIP1: ship supply bounds ---------------------------------------------------------------

function checkShipBounds(state: GameState): void {
  for (const p of state.players) {
    const built = shipsOf(state, p.seat).length;
    const left = shipsLeftOf(state, p.seat);
    if (built < 0 || built > SHIPS_PER_PLAYER) {
      throw new SeafarersInvariantViolationError(
        'SF-SHIP1',
        `seat ${p.seat} has ${built} ships on the board (must be 0..${SHIPS_PER_PLAYER}, S1.1)`
      );
    }
    if (left < 0 || left > SHIPS_PER_PLAYER) {
      throw new SeafarersInvariantViolationError(
        'SF-SHIP1',
        `seat ${p.seat} has ${left} ships left in supply (must be 0..${SHIPS_PER_PLAYER}, S1.1)`
      );
    }
  }
}

// ---- SF-PIRATE: pirate on a sea hex (never blocks production) ------------------------------------

function checkPirateOnSea(state: GameState): void {
  const pirate = state.ext?.seafarers?.pirate;
  if (pirate === undefined) return;
  const terrain = hexTerrainOf(state, pirate);
  if (terrain !== 'sea') {
    throw new SeafarersInvariantViolationError(
      'SF-PIRATE',
      `pirate sits on hex ${pirate} of terrain '${String(terrain)}' — must be a sea hex (S8.1/S8.5)`
    );
  }
}

// ---- SF-CHIT1/2: island-chit legitimacy ---------------------------------------------------------

function checkIslandChits(state: GameState): void {
  for (const p of state.players) {
    const earned = islandChitsOf(state, p.seat);
    // SF-CHIT1: distinct island ids (S10.6 — once per island).
    if (new Set(earned).size !== earned.length) {
      throw new SeafarersInvariantViolationError(
        'SF-CHIT1',
        `seat ${p.seat} earned a duplicate island chit: [${earned.join(',')}]`
      );
    }
    // SF-CHIT2: every earned island still hosts one of the seat's buildings.
    const ownIslands = new Set<number>();
    for (const v of [...p.settlements, ...p.cities]) {
      const island = islandOfVertex(state, v);
      if (island !== null) ownIslands.add(island);
    }
    for (const island of earned) {
      if (!ownIslands.has(island)) {
        throw new SeafarersInvariantViolationError(
          'SF-CHIT2',
          `seat ${p.seat} holds an island-${island} chit but has no building on that island (S10.6)`
        );
      }
    }
  }
}

/**
 * Assert the seafarers scenario invariants for one successful transition. Throws
 * `SeafarersInvariantViolationError` on the first violation; returns the threaded accumulator (peak
 * ships on board, whether an island was ever settled) for the sim's stat report otherwise.
 */
export function checkSeafarersInvariants(
  next: GameState,
  _action: Action,
  events: readonly GameEvent[],
  acc: SeafarersAccumulator
): SeafarersAccumulator {
  checkShipBounds(next);
  checkPirateOnSea(next);
  checkIslandChits(next);

  let peakShipsOnBoard = acc.peakShipsOnBoard;
  for (const p of next.players) peakShipsOnBoard = Math.max(peakShipsOnBoard, shipsOf(next, p.seat).length);
  const sawIslandSettled = acc.sawIslandSettled || events.some((e) => e.type === 'islandSettled');
  return { peakShipsOnBoard, sawIslandSettled };
}
