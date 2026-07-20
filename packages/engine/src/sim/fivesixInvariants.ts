// T-604: the 5–6 Player Extension's mode-specific invariants, asserted after every successful
// transition of a fiveSix simulation (on TOP of the generalized base I1–I10 in invariants.ts,
// which already run config-aware at 30 hexes). These encode docs/rules/fivesix-rules.md §X12 for
// BOTH editions — the 2015 Special Building Phase (SBP) and the 2022 Paired Players revision.
//
// Like invariants.ts, every check is a from-scratch recomputation over `prev`/`next`/`events`
// (never a read of a flag the engine set), so a bug in the very code being cross-checked is caught.
//
// SBP invariants (X12, 2015):
//   FS-SBP1  entry order — on opening the SBP, builder = (ender+1)%n and queue is the remaining
//            seats clockwise; turn.player stays the ender.
//   FS-SBP2  pass advance — passSpecialBuild hands off to the queue head (queue shrinks by one).
//   FS-SBP3  exit — the pass that empties the queue resumes the next player's preRoll (turn rotates
//            ender→ender+1), or ends the game for that incoming owner (own-turn win, R13.2).
//   FS-SBP4  action matrix — while in the SBP, ONLY build/buy/pass are ever accepted (no trading,
//            no dev-card plays, no rolling).
//   FS-SBP5  no mid-phase win — a build/buy during the SBP never ends the game (win is own-turn only).
//
// Paired-Players invariants (X12, 2022):
//   FS-PP1   marker placement — on opening a partial turn, builder = (player1+3)%n, resumeFrom =
//            player1, and player 2 becomes the turn owner of a `main` turn.
//   FS-PP2   markers advance left — ending the partial turn resumes rotation at (resumeFrom+1)%n,
//            so both markers step one seat left each round.
//   FS-PP3   action matrix — during the partial turn the builder may NOT player-trade or roll.
//   FS-PP4   player 2 CAN win — a win reached during the partial turn is credited to the builder
//            (recorded as a capability stat, not a violation).
//
// Shared:
//   FS-DEV1  at most one development card is played per turn (R9.3; also the X12 partial-turn ≤1).

import type { Action, GameEvent, GameState, Seat } from '@hexhaven/shared';
import { fiveSixTurnRule, partialTurnOf } from '../modules/fiveSix/common.js';

export class FiveSixInvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'FiveSixInvariantViolationError';
  }
}

/** Accumulator threaded across a whole fiveSix game: the per-turn dev-play tally (FS-DEV1 needs a
 *  running count within a turn) and the capability flag FS-PP4 records once seen. */
export interface FiveSixAccumulator {
  /** `${turn.number}:${turn.player}` of the turn the last dev-play tally belongs to. */
  turnKey: string;
  devPlaysThisTurn: number;
  /** Set once a game is won by the Paired-Players "player 2" during their partial turn. */
  wonDuringPartialTurn: boolean;
}

export function initialFiveSixAccumulator(): FiveSixAccumulator {
  return { turnKey: '', devPlaysThisTurn: 0, wonDuringPartialTurn: false };
}

const SBP_ALLOWED: ReadonlySet<Action['type']> = new Set([
  'buildRoad',
  'buildSettlement',
  'buildCity',
  'buyDevCard',
  'passSpecialBuild',
]);

const PARTIAL_TURN_FORBIDDEN: ReadonlySet<Action['type']> = new Set([
  'offerTrade',
  'respondTrade',
  'confirmTrade',
  'cancelTrade',
  'rollDice',
]);

/** The seats that should form the SBP queue after `ender`: clockwise, next player first. */
function expectedSbpOrder(ender: Seat, n: number): Seat[] {
  const order: Seat[] = [];
  for (let i = 1; i < n; i++) order.push(((ender + i) % n) as Seat);
  return order;
}

function eqSeats(a: readonly Seat[], b: readonly Seat[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function countDevPlays(events: readonly GameEvent[]): number {
  let c = 0;
  for (const e of events) if (e.type === 'devPlayed') c += 1;
  return c;
}

/**
 * Assert the X12 turn-rule invariants for one successful transition of a fiveSix game. `seat` is the
 * actor. Throws `FiveSixInvariantViolationError` on the first violation; returns the threaded
 * accumulator otherwise.
 */
export function checkFiveSixInvariants(
  prev: GameState,
  action: Action,
  next: GameState,
  events: readonly GameEvent[],
  seat: Seat,
  acc: FiveSixAccumulator
): FiveSixAccumulator {
  const n = next.config.playerCount;
  const rule = fiveSixTurnRule(next.config);

  // ---- FS-DEV1: at most one dev card played per turn (identified by prev's turn owner+number) ----
  const turnKey = `${prev.turn.number}:${prev.turn.player}`;
  let devPlaysThisTurn = acc.turnKey === turnKey ? acc.devPlaysThisTurn : 0;
  devPlaysThisTurn += countDevPlays(events);
  if (devPlaysThisTurn > 1) {
    throw new FiveSixInvariantViolationError(
      'FS-DEV1',
      `${devPlaysThisTurn} dev cards played in turn ${turnKey} (max 1, R9.3 / X12 partial-turn ≤1)`
    );
  }

  let wonDuringPartialTurn = acc.wonDuringPartialTurn;

  if (rule === 'sbp') {
    const inSbpPrev = prev.phase.kind === 'specialBuild';
    const inSbpNext = next.phase.kind === 'specialBuild';

    // FS-SBP1: entry.
    if (!inSbpPrev && inSbpNext) {
      const ender = prev.turn.player;
      const expected = expectedSbpOrder(ender, n);
      const [builder, ...queue] = expected;
      if (next.phase.kind !== 'specialBuild') throw new FiveSixInvariantViolationError('FS-SBP1', 'unreachable');
      if (next.phase.builder !== builder) {
        throw new FiveSixInvariantViolationError(
          'FS-SBP1',
          `SBP opened with builder ${next.phase.builder}, expected ${builder} (ender ${ender}, n ${n})`
        );
      }
      if (!eqSeats(next.phase.queue, queue)) {
        throw new FiveSixInvariantViolationError(
          'FS-SBP1',
          `SBP queue ${JSON.stringify(next.phase.queue)} != expected ${JSON.stringify(queue)}`
        );
      }
      if (next.turn.player !== ender) {
        throw new FiveSixInvariantViolationError(
          'FS-SBP1',
          `turn.player moved to ${next.turn.player} on SBP entry; must stay the ender ${ender}`
        );
      }
    }

    // FS-SBP4: action matrix while inside the SBP.
    if (inSbpPrev && !SBP_ALLOWED.has(action.type)) {
      throw new FiveSixInvariantViolationError(
        'FS-SBP4',
        `action '${action.type}' was accepted during the SBP (only build/buy/pass are allowed, X12)`
      );
    }

    // FS-SBP2 / FS-SBP3: pass semantics.
    if (inSbpPrev && action.type === 'passSpecialBuild') {
      if (prev.phase.kind !== 'specialBuild') throw new FiveSixInvariantViolationError('FS-SBP2', 'unreachable');
      const [nextBuilder, ...rest] = prev.phase.queue;
      if (nextBuilder !== undefined) {
        // FS-SBP2: hand off to the queue head.
        if (!inSbpNext || next.phase.kind !== 'specialBuild') {
          throw new FiveSixInvariantViolationError('FS-SBP2', 'a non-final pass must stay in the SBP');
        }
        if (next.phase.builder !== nextBuilder || !eqSeats(next.phase.queue, rest)) {
          throw new FiveSixInvariantViolationError(
            'FS-SBP2',
            `pass advanced to builder ${next.phase.builder} queue ${JSON.stringify(
              next.phase.queue
            )}, expected builder ${nextBuilder} queue ${JSON.stringify(rest)}`
          );
        }
      } else {
        // FS-SBP3: the final pass resumes the next player's turn (or ends the game for them).
        if (next.phase.kind !== 'preRoll' && next.phase.kind !== 'ended') {
          throw new FiveSixInvariantViolationError(
            'FS-SBP3',
            `final SBP pass produced phase '${next.phase.kind}', expected preRoll or ended`
          );
        }
        const expectedOwner = ((prev.turn.player + 1) % n) as Seat;
        if (next.turn.player !== expectedOwner) {
          throw new FiveSixInvariantViolationError(
            'FS-SBP3',
            `SBP exit rotated to seat ${next.turn.player}, expected ${expectedOwner}`
          );
        }
      }
    }

    // FS-SBP5: a build/buy during the SBP never ends the game (no mid-phase win).
    if (inSbpPrev && action.type !== 'passSpecialBuild' && next.phase.kind === 'ended') {
      throw new FiveSixInvariantViolationError(
        'FS-SBP5',
        `a '${action.type}' during the SBP ended the game — win must be own-turn only (X12/R13.2)`
      );
    }
  } else {
    // ---- Paired Players ----
    const ptPrev = partialTurnOf(prev);
    const ptNext = partialTurnOf(next);

    // FS-PP1: partial-turn opening.
    if (ptPrev === null && ptNext !== null) {
      const p1 = prev.turn.player;
      const expectedBuilder = ((p1 + 3) % n) as Seat;
      if (ptNext.builder !== expectedBuilder) {
        throw new FiveSixInvariantViolationError(
          'FS-PP1',
          `partial turn opened with builder ${ptNext.builder}, expected (player1 ${p1} + 3)%${n} = ${expectedBuilder}`
        );
      }
      if (ptNext.resumeFrom !== p1) {
        throw new FiveSixInvariantViolationError(
          'FS-PP1',
          `partial turn resumeFrom ${ptNext.resumeFrom}, expected player1 ${p1}`
        );
      }
      // Player 2 takes ownership as a 'main' turn — UNLESS they already hold the win the instant the
      // partial turn opens, in which case the base start-of-turn win check ends the game in this same
      // transition (FAQ #16: "player 2 CAN win"). That's common in a Cities & Knights game, where VP
      // accrues out of turn (barbarian Defender-of-Hexhaven VP on others' rolls, metropolis) so player 2
      // can cross the target while not the turn owner. Accept the open-and-win outcome as a legit
      // player-2 win (recorded below), only enforcing 'main' ownership when the game continues.
      const openedIntoWin = next.phase.kind === 'ended' && next.phase.winner === expectedBuilder;
      if (openedIntoWin) {
        wonDuringPartialTurn = true;
      } else if (next.turn.player !== expectedBuilder || next.phase.kind !== 'main') {
        throw new FiveSixInvariantViolationError(
          'FS-PP1',
          `player 2 must own a 'main' turn; got seat ${next.turn.player} phase ${next.phase.kind}`
        );
      }
    }

    // FS-PP3: the partial-turn matrix — no player trade, no roll, by the builder in `main`.
    if (ptPrev !== null && prev.phase.kind === 'main' && seat === ptPrev.builder && PARTIAL_TURN_FORBIDDEN.has(action.type)) {
      throw new FiveSixInvariantViolationError(
        'FS-PP3',
        `action '${action.type}' was accepted during a Paired-Players partial turn (forbidden by X12)`
      );
    }

    // FS-PP2: ending the partial turn resumes rotation one seat left of player 1.
    if (ptPrev !== null && ptNext === null && next.phase.kind !== 'ended') {
      const expectedOwner = ((ptPrev.resumeFrom + 1) % n) as Seat;
      if (next.turn.player !== expectedOwner || next.phase.kind !== 'preRoll') {
        throw new FiveSixInvariantViolationError(
          'FS-PP2',
          `partial turn ended into seat ${next.turn.player}/${next.phase.kind}, expected ${expectedOwner}/preRoll`
        );
      }
    }

    // FS-PP4 (capability, not a violation): a win reached during the partial turn is player 2's.
    if (ptPrev !== null && next.phase.kind === 'ended' && next.phase.winner === ptPrev.builder) {
      wonDuringPartialTurn = true;
    }
  }

  return { turnKey, devPlaysThisTurn, wonDuringPartialTurn };
}
