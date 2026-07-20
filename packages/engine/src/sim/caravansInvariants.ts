// T-1004: the Caravans scenario's mode-specific invariants (docs/rules/traders-barbarians-rules.md
// §TB4), asserted after every successful transition of a caravans simulation on TOP of the
// generalized base I1–I10 in invariants.ts. Like invariants.ts, every check is a from-scratch
// recomputation over `next`, never a read of a flag the engine itself set.
//
//   CAR1  camel PLACEMENT: every placed camel sits on a `routeEdges` edge, at most one camel per
//         edge, and the total never exceeds the 22-piece supply (`CARAVANS_CAMEL_SUPPLY`).
//   CAR2  `caravanVote` phase SHAPE: `builder`/`winner` (when set) name real seats; `pending` has no
//         duplicates and is a subset of the real seats; once `winner` is set, `pending` is empty.
//   CAR3  between-two-camels VP: `computeVp`'s `caravansVp` matches an independent recomputation
//         from `ext.camels`/each seat's settlements+cities (never trusting the engine's own value).
//   CAR4  the caravans win target (12, §TB4.4) is honored — redundant with the general I7 check in
//         invariants.ts, re-asserted here directly against the fixed scenario rule for a
//         scenario-scoped failure message.

import type { Action, GameEvent, GameState } from '@hexhaven/shared';
import { computeVp } from '../vp.js';
import { geometryForState } from '../modules/index.js';
import { CARAVANS_CAMEL_SUPPLY, CARAVANS_TARGET_VP } from '../modules/tradersBarbarians/caravans.js';
import { tbExt } from '../modules/tradersBarbarians/state.js';

export class CaravansInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'CaravansInvariantViolationError';
  }
}

/** No running state needed (unlike fish/coins, camels are never spent) — a placeholder accumulator
 *  kept only so `checkCaravansInvariants` mirrors the other scenario checkers' threaded shape. */
export interface CaravansAccumulator {
  votesOpened: number;
  votesCastTotal: number;
  camelsPlacedTotal: number;
}

export function initialCaravansAccumulator(): CaravansAccumulator {
  return { votesOpened: 0, votesCastTotal: 0, camelsPlacedTotal: 0 };
}

function checkCamelPlacement(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  const routeEdges = new Set(ext.routeEdges ?? []);
  const camels = ext.camels ?? [];
  if (camels.length > CARAVANS_CAMEL_SUPPLY) {
    throw new CaravansInvariantViolationError(
      'CAR1',
      `${camels.length} camels placed exceeds the ${CARAVANS_CAMEL_SUPPLY}-piece supply (§TB4.1)`
    );
  }
  const seen = new Set<number>();
  for (const edge of camels) {
    if (!routeEdges.has(edge)) {
      throw new CaravansInvariantViolationError('CAR1', `camel on edge ${edge} is not a caravan-route edge (§TB4.1)`);
    }
    if (seen.has(edge)) {
      throw new CaravansInvariantViolationError('CAR1', `edge ${edge} carries more than one camel`);
    }
    seen.add(edge);
  }
}

function checkVotePhaseShape(state: GameState): void {
  if (state.phase.kind !== 'caravanVote') return;
  const phase = state.phase;
  const realSeats = new Set(state.players.map((p) => p.seat));
  if (!realSeats.has(phase.builder)) {
    throw new CaravansInvariantViolationError('CAR2', `caravanVote builder ${phase.builder} is not a real seat`);
  }
  if (phase.winner !== null && !realSeats.has(phase.winner)) {
    throw new CaravansInvariantViolationError('CAR2', `caravanVote winner ${phase.winner} is not a real seat`);
  }
  const pendingSet = new Set(phase.pending);
  if (pendingSet.size !== phase.pending.length) {
    throw new CaravansInvariantViolationError('CAR2', `caravanVote pending has duplicate seats: ${JSON.stringify(phase.pending)}`);
  }
  for (const s of phase.pending) {
    if (!realSeats.has(s)) {
      throw new CaravansInvariantViolationError('CAR2', `caravanVote pending seat ${s} is not a real seat`);
    }
  }
  if (phase.winner !== null && phase.pending.length !== 0) {
    throw new CaravansInvariantViolationError(
      'CAR2',
      `caravanVote has a resolved winner (${phase.winner}) but pending is not empty: ${JSON.stringify(phase.pending)}`
    );
  }
}

function checkBetweenCamelsVp(state: GameState): void {
  const ext = tbExt(state);
  if (!ext) return;
  const camelSet = new Set(ext.camels ?? []);
  // T-1053 (5–6): reads THIS game's resolved geometry (base or `GEOMETRY_EXT56`) rather than always
  // the base `GEOMETRY` — a caravans+fiveSix game's vertex ids only resolve against the 30-hex board.
  const geometry = geometryForState(state);
  for (const p of state.players) {
    let expected = 0;
    if (camelSet.size >= 2) {
      for (const v of [...p.settlements, ...p.cities]) {
        const vert = geometry.vertices[v];
        if (!vert) continue;
        const camelEdgesHere = vert.edges.filter((e) => camelSet.has(e));
        if (camelEdgesHere.length >= 2) expected += 1;
      }
    }
    const vp = computeVp(state, p.seat);
    if ((vp.caravansVp ?? 0) !== expected) {
      throw new CaravansInvariantViolationError(
        'CAR3',
        `seat ${p.seat} caravansVp=${vp.caravansVp} != expected ${expected} (camels=${JSON.stringify([...camelSet])})`
      );
    }
  }
}

function checkWinTarget(state: GameState): void {
  const ext = tbExt(state);
  if (!ext || state.phase.kind !== 'ended') return;
  const winner = state.phase.winner;
  const vp = computeVp(state, winner).total;
  if (vp < CARAVANS_TARGET_VP) {
    throw new CaravansInvariantViolationError(
      'CAR4',
      `caravans win target not honored: winner seat ${winner} has ${vp} VP, needs >= ${CARAVANS_TARGET_VP} (§TB4.4)`
    );
  }
}

/**
 * Runs CAR1–CAR4 against one successful transition, threading a running action-count tally purely
 * for the sim's coverage report (never used to gate a check). Throws `CaravansInvariantViolationError`
 * on the first violation; returns the accumulator otherwise. No-op (immediate passthrough) outside a
 * caravans game.
 */
export function checkCaravansInvariants(
  next: GameState,
  action: Action,
  events: readonly GameEvent[],
  acc: CaravansAccumulator
): CaravansAccumulator {
  const ext = tbExt(next);
  if (!ext || ext.scenario !== 'caravans') return acc;

  let votesOpened = acc.votesOpened;
  let votesCastTotal = acc.votesCastTotal;
  let camelsPlacedTotal = acc.camelsPlacedTotal;
  for (const e of events) {
    if (e.type === 'caravanVoteOpened') votesOpened += 1;
    if (e.type === 'caravanVoteCast') votesCastTotal += 1;
    if (e.type === 'camelPlaced') camelsPlacedTotal += 1;
  }
  void action;

  checkCamelPlacement(next);
  checkVotePhaseShape(next);
  checkBetweenCamelsVp(next);
  checkWinTarget(next);

  return { votesOpened, votesCastTotal, camelsPlacedTotal };
}
