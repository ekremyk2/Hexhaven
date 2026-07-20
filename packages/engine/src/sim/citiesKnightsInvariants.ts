// T-807: the Cities & Knights invariant suite, asserted after every successful transition of a
// C&K simulation (on TOP of the generalized base I1–I10 in invariants.ts, which already run
// config-aware — 13-VP target, base resource bank/piece supply, dev deck composition trivially
// conserved since `buyDevCard` is always rejected in a C&K game, C11.1). This file adds the
// whole-state C&K properties the base suite knows nothing about: commodity supply bounds (C3.1),
// knight piece caps + board uniqueness (C7.1), city-wall legitimacy (C9.1/C9.3), improvement-level
// range + metropolis consistency (C4.1/C4.6), the barbarian ship's position bound (C8.1/C8.2), the
// robber staying put in the desert while locked (C10.1), Defender-of-Hexhaven VP bookkeeping (C8.5),
// the progress-card hand limit (C6.3), and full 54-card multiset conservation across the three
// decks + all hands + revealed Printer/Constitution + a running played-card tally (C6.1) — the
// progress-card analogue of invariants.ts's dev-deck check I3 (a PLAYED progress card has no
// "discard pile" in the data model, so the tally must be threaded the same way I3 threads
// `playedDevCards`).
//
// Like invariants.ts/seafarersInvariants.ts, every check is a from-scratch recomputation over
// `next` (never a read of a flag the engine itself set), so a bug in the very code being
// cross-checked is caught.

import { CK_BARBARIAN_STEPS_TO_ATTACK, CK_COMMODITY_SUPPLY, CK_KNIGHT_CAP, CK_MAX_WALLS, CK_PROGRESS_DECK_COMPOSITION, CK_PROGRESS_HAND_LIMIT } from '@hexhaven/shared';
import type { Commodity, CitiesKnightsExt, GameEvent, GameState, HexId, ImprovementTrack, KnightLevel, ProgressCardId } from '@hexhaven/shared';
import { resolveConstants } from '../modules/index.js';
import { citiesKnightsExt } from '../modules/citiesKnights/state.js';

export class CitiesKnightsInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'CitiesKnightsInvariantViolationError';
  }
}

const TRACKS: readonly ImprovementTrack[] = ['trade', 'politics', 'science'];
const COMMODITIES: readonly Commodity[] = ['paper', 'cloth', 'coin'];
const KNIGHT_LEVELS: readonly KnightLevel[] = [1, 2, 3];

/** C6.1: the full 54-card catalog's per-name copy count, flattened across the three decks. */
const CARD_TOTALS: Partial<Record<ProgressCardId, number>> = (() => {
  const out: Partial<Record<ProgressCardId, number>> = {};
  for (const track of TRACKS) {
    for (const { card, count } of CK_PROGRESS_DECK_COMPOSITION[track]) out[card] = count;
  }
  return out;
})();

/** Running tally of progress cards PLAYED so far (mirrors invariants.ts's `playedDevCards` — a
 *  played progress card has no discard pile in the data model, C6.1, so the conservation check
 *  needs this running total the same way I3 needs `playedDevCards`). */
export interface CitiesKnightsAccumulator {
  playedProgressCards: Partial<Record<ProgressCardId, number>>;
  /** The robber's hex the first time it was seen while locked — used to assert it never MOVES while
   *  locked on a board with no desert (Seafarers 3p combo, which has no desert to lock it in). */
  lockedRobberHex: HexId | null;
}

export function initialCitiesKnightsAccumulator(): CitiesKnightsAccumulator {
  return { playedProgressCards: {}, lockedRobberHex: null };
}

// ---- CK-COMM: commodity supply bounds (C3.1) ----------------------------------------------------

function checkCommodities(ck: CitiesKnightsExt): void {
  for (const c of COMMODITIES) {
    let total = 0;
    ck.commodities.forEach((holdings, seat) => {
      if (holdings[c] < 0) {
        throw new CitiesKnightsInvariantViolationError('CK-COMM', `seat ${seat} holds negative ${c}: ${holdings[c]}`);
      }
      total += holdings[c];
    });
    if (total > CK_COMMODITY_SUPPLY) {
      throw new CitiesKnightsInvariantViolationError(
        'CK-COMM',
        `${c}: ${total} in seats' hands exceeds the ${CK_COMMODITY_SUPPLY}-unit supply (C3.1)`
      );
    }
  }
}

// ---- CK-KNIGHT: per-level piece caps + board-wide vertex uniqueness (C7.1) ----------------------

function checkKnights(state: GameState, ck: CitiesKnightsExt): void {
  // T-906 (docs/07 D-034 `customConstants.maxKnightsPerLevel`): the SAME resolved cap
  // `knights.ts`'s `resolvedKnightCap` reads — absent falls back to the literal `CK_KNIGHT_CAP`
  // (RK-13).
  const cap = resolveConstants(state.config).maxKnightsPerLevel;
  const seenVertex = new Set<number>();
  ck.knights.forEach((list, seat) => {
    const counts: Record<KnightLevel, number> = { 1: 0, 2: 0, 3: 0 };
    for (const k of list) {
      counts[k.level] += 1;
      if (seenVertex.has(k.vertex)) {
        throw new CitiesKnightsInvariantViolationError(
          'CK-KNIGHT',
          `vertex ${k.vertex} holds two knights (C7.1: one knight per intersection)`
        );
      }
      seenVertex.add(k.vertex);
    }
    for (const level of KNIGHT_LEVELS) {
      const levelCap = cap ?? CK_KNIGHT_CAP[level];
      if (counts[level] > levelCap) {
        throw new CitiesKnightsInvariantViolationError(
          'CK-KNIGHT',
          `seat ${seat} has ${counts[level]} level-${level} knights (cap ${levelCap}, C7.1)`
        );
      }
    }
  });
}

// ---- CK-WALL: per-player cap + every wall sits under that seat's OWN city (C9.1/C9.3) -----------

function checkWalls(state: GameState, ck: CitiesKnightsExt): void {
  // T-906 (`customConstants.maxCityWalls`): the SAME resolved cap `walls.ts`'s `resolvedMaxWalls`
  // reads — absent falls back to the literal `CK_MAX_WALLS` (RK-13).
  const maxWalls = resolveConstants(state.config).maxCityWalls ?? CK_MAX_WALLS;
  ck.walls.forEach((walls, seat) => {
    if (walls.length > maxWalls) {
      throw new CitiesKnightsInvariantViolationError('CK-WALL', `seat ${seat} has ${walls.length} walls (cap ${maxWalls}, C9.1)`);
    }
    if (new Set(walls).size !== walls.length) {
      throw new CitiesKnightsInvariantViolationError('CK-WALL', `seat ${seat} has a duplicate wall vertex`);
    }
    const player = state.players[seat];
    for (const v of walls) {
      if (!player?.cities.includes(v)) {
        throw new CitiesKnightsInvariantViolationError(
          'CK-WALL',
          `seat ${seat} has a wall at vertex ${v}, which is not one of their own cities (C9.1/C9.3 — a pillaged city's wall must be removed)`
        );
      }
    }
  });
}

// ---- CK-IMPROVEMENT: level range (C4.1) + metropolis holder is actually at level >=4 (C4.6) ------

function checkImprovements(ck: CitiesKnightsExt): void {
  ck.improvements.forEach((imp, seat) => {
    for (const track of TRACKS) {
      const level = imp[track];
      if (level < 0 || level > 5) {
        throw new CitiesKnightsInvariantViolationError(
          'CK-IMPROVEMENT',
          `seat ${seat} ${track} level ${level} is out of the 0..5 range (C4.1)`
        );
      }
    }
  });
  for (const track of TRACKS) {
    const holder = ck.metropolis[track];
    if (holder === null) continue;
    const level = ck.improvements[holder]?.[track] ?? 0;
    if (level < 4) {
      throw new CitiesKnightsInvariantViolationError(
        'CK-IMPROVEMENT',
        `seat ${holder} holds the ${track} metropolis but is only at level ${level} (C4.6 requires >=4)`
      );
    }
  }
}

// ---- CK-BARBARIAN: ship position stays inside 0..STEPS-1 (C8.1/C8.2) ----------------------------

function checkBarbarian(ck: CitiesKnightsExt): void {
  if (ck.barbarian.position < 0 || ck.barbarian.position >= CK_BARBARIAN_STEPS_TO_ATTACK) {
    throw new CitiesKnightsInvariantViolationError(
      'CK-BARBARIAN',
      `barbarian position ${ck.barbarian.position} is out of 0..${CK_BARBARIAN_STEPS_TO_ATTACK - 1} (C8.1/C8.2: an attack resets it)`
    );
  }
  if (ck.barbarian.attacksResolved < 0) {
    throw new CitiesKnightsInvariantViolationError('CK-BARBARIAN', 'attacksResolved is negative');
  }
}

// ---- CK-ROBBER-LOCK: while locked, the robber never MOVES from its start (C10.1) ----------------
// On a normal board the lock keeps it in the starting desert, so we assert that directly. On a
// desert-less board (the official Seafarers + Cities & Knights combo at 3 players — the robber
// starts on a non-desert hex, official rule: "the robber does not move until the first barbarian
// attack" regardless of where it sits) there is no desert to require, so we instead assert the
// stronger, desert-agnostic guarantee: it never leaves the hex it was first locked on.

function checkRobberLock(state: GameState, prevLockedHex: HexId | null, ck: CitiesKnightsExt): HexId | null {
  if (!ck.robberLocked) return prevLockedHex;
  const robber = state.board.robber;
  const hex = state.board.hexes[robber];
  // On a Seafarers board `board.hexes` proxies every SEA cell to `'desert'` terrain, so "is on a
  // desert hex" is meaningless there — and the official combo starts the robber on a non-desert land
  // hex (3p has no desert at all). Assert the desert-agnostic C10.1 guarantee instead: locked ⇒ it
  // never moved from where it was first seen locked. Base/5-6 C&K keeps the exact desert assertion.
  if (state.ext?.seafarers !== undefined) {
    if (prevLockedHex !== null && robber !== prevLockedHex) {
      throw new CitiesKnightsInvariantViolationError(
        'CK-ROBBER-LOCK',
        `the robber is locked (C10.1) but moved from hex ${prevLockedHex} to ${robber}`
      );
    }
  } else if (!hex || hex.terrain !== 'desert') {
    throw new CitiesKnightsInvariantViolationError(
      'CK-ROBBER-LOCK',
      `the robber is locked (C10.1) but sits on hex ${robber} of terrain '${hex?.terrain}', not the desert`
    );
  }
  return prevLockedHex ?? robber;
}

// ---- CK-DEFENDER: nonnegative, and never more total Defender VP than resolved attacks (C8.5) ----

function checkDefenderVp(ck: CitiesKnightsExt): void {
  let total = 0;
  ck.defenderVp.forEach((v, seat) => {
    if (v < 0) throw new CitiesKnightsInvariantViolationError('CK-DEFENDER', `seat ${seat} has negative defenderVp: ${v}`);
    total += v;
  });
  if (total > ck.barbarian.attacksResolved) {
    throw new CitiesKnightsInvariantViolationError(
      'CK-DEFENDER',
      `sum(defenderVp)=${total} exceeds attacksResolved=${ck.barbarian.attacksResolved} (C8.5: at most one Defender per resolved attack)`
    );
  }
}

// ---- CK-HAND: progress-card hand limit (C6.3) ----------------------------------------------------

function checkHandLimit(state: GameState, ck: CitiesKnightsExt): void {
  // T-906 (`customConstants.maxProgressCards`): the SAME resolved limit `progressCards.ts`'s
  // `resolvedProgressHandLimit` reads — absent falls back to the literal `CK_PROGRESS_HAND_LIMIT`
  // (RK-13).
  const limit = resolveConstants(state.config).maxProgressCards ?? CK_PROGRESS_HAND_LIMIT;
  ck.progressHand.forEach((hand, seat) => {
    if (hand.length > limit) {
      throw new CitiesKnightsInvariantViolationError(
        'CK-HAND',
        `seat ${seat} holds ${hand.length} progress cards (limit ${limit}, C6.3)`
      );
    }
  });
}

// ---- CK-PROGRESS-CONSERVE: decks + hands + revealed + played == the 54-card catalog (C6.1) ------

function checkProgressConservation(ck: CitiesKnightsExt, playedProgressCards: Partial<Record<ProgressCardId, number>>): void {
  const counts: Partial<Record<ProgressCardId, number>> = {};
  const add = (id: ProgressCardId, n: number): void => {
    counts[id] = (counts[id] ?? 0) + n;
  };
  for (const track of TRACKS) for (const card of ck.progressDecks[track]) add(card, 1);
  for (const hand of ck.progressHand) for (const card of hand) add(card, 1);
  for (const card of Object.keys(ck.revealedProgress) as ProgressCardId[]) add(card, 1);
  for (const [card, n] of Object.entries(playedProgressCards)) add(card as ProgressCardId, n ?? 0);

  for (const card of Object.keys(CARD_TOTALS) as ProgressCardId[]) {
    const expected = CARD_TOTALS[card]!;
    const got = counts[card] ?? 0;
    if (got !== expected) {
      throw new CitiesKnightsInvariantViolationError(
        'CK-PROGRESS-CONSERVE',
        `${card}: decks+hands+revealed+played = ${got}, expected ${expected} of ${expected} (C6.1, 54-card catalog)`
      );
    }
  }
}

/**
 * Assert every C&K invariant for one successful transition. Throws
 * `CitiesKnightsInvariantViolationError` on the first violation; returns the threaded accumulator
 * (the running played-progress-card tally CK-PROGRESS-CONSERVE needs) otherwise.
 */
export function checkCitiesKnightsInvariants(
  next: GameState,
  events: readonly GameEvent[],
  acc: CitiesKnightsAccumulator
): CitiesKnightsAccumulator {
  const ck = citiesKnightsExt(next);
  if (!ck) return acc;

  checkCommodities(ck);
  checkKnights(next, ck);
  checkWalls(next, ck);
  checkImprovements(ck);
  checkBarbarian(ck);
  const lockedRobberHex = checkRobberLock(next, acc.lockedRobberHex, ck);
  checkDefenderVp(ck);
  checkHandLimit(next, ck);

  const playedProgressCards = { ...acc.playedProgressCards };
  for (const e of events) {
    if (e.type === 'progressCardPlayed') playedProgressCards[e.card] = (playedProgressCards[e.card] ?? 0) + 1;
  }
  checkProgressConservation(ck, playedProgressCards);

  return { playedProgressCards, lockedRobberHex };
}
