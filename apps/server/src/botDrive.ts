// T-411 §3: pure helpers for the server's bot auto-drive (session.ts's `driveBots`). Split out of
// session.ts so "who must act right now" is unit-testable without spinning up a hub/session.

import type { GameState, Seat } from "@hexhaven/shared";
import type { Room } from "./lobby.js";

/**
 * Every seat with something to decide RIGHT NOW. Mirrors T-410's own validated actor-selection —
 * `packages/engine/src/ai/testHarness.ts`'s `nextActor`, proven infinite-loop-free across its
 * 60-200-game dominance benchmark — rather than inventing a second model: setup/preRoll/
 * moveRobber/steal/roadBuilding are single, phase-locked actors (the turn owner); `discard` names
 * its own `pending` list; `main` with an open domestic trade offer (R8.1) is the one case where the
 * turn owner is NOT the actor — every seat that hasn't yet responded gets to act FIRST, and the
 * turn owner is blocked from acting again until every response is in.
 *
 * That blocking is the load-bearing bit, not an arbitrary simplification: an early version of this
 * function let the turn owner keep acting (build, or re-offer a trade) WHILE responses were still
 * pending. A bot/scripted turn owner can legally re-offer a trade at any time (`offerTrade` auto-
 * cancels whatever's open, R8.1), so with the owner unblocked a low-budget search could cycle
 * offer→cancel→re-offer forever — `confirmTrade` isn't even reachable from the ROOT of `chooseAction`
 * (bot.ts's own comment: the offerer can never verify the accepter still holds the cards from a
 * `PlayerView` alone), so nothing ever forces the trade to a close except the responses actually
 * resolving. Matching `nextActor`'s "responders only, owner blocked" ordering removes that whole
 * class of stall.
 */
export function pendingActors(state: GameState): Seat[] {
  switch (state.phase.kind) {
    case "discard":
      return state.phase.pending;
    case "chooseGoldResource":
      // Seafarers gold (S9/ER-S7): any seat owed a gold choice acts — like `discard`, this may be a
      // NON-owner (a bot whose building borders the gold hex on the human turn owner's roll). The
      // old `default` returned `[turn.player]`, so a bot owed gold on a human's turn was never driven
      // and the game soft-locked with the human seeing no dialog (BUGS.md B-26). Mirrors the sim's
      // `nextActor` (sim/runGame.ts), which has always handled this phase.
      return state.phase.pending;
    case "caravanVote": {
      // Traders & Barbarians Caravans (§TB4.2, T-1004): `pending` is EVERY seat (builder first), so
      // the bidder due right now is routinely a NON-owner exactly like `chooseGoldResource` above —
      // same B-26 class of bug, just missed for this phase (BUGS.md B-50). Once every seat has bid,
      // the resolved `winner` (who may also not be `turn.player`) owes a `placeCamel`; the old
      // `default` returned `[turn.player]` in both cases, so a bot due a bid/placement on a HUMAN
      // turn owner's turn was never driven — permanent soft-lock (a caravanVote phase never returns
      // to `main` on its own). Mirrors `ai/candidates.ts`'s own `caravanVote` case, which has always
      // handled this correctly for the search/eval bot — only this drive-target selector diverged.
      if (state.phase.pending.length > 0) return state.phase.pending;
      return state.phase.winner !== null ? [state.phase.winner] : [];
    }
    case "ended":
      return [];
    case "specialBuild":
      // 5–6 SBP (X12, T-602): the special builder acts while `turn.player` is still the seat whose
      // turn just ended — so the drive must target `phase.builder`, NOT the turn owner, or a bot
      // builder would never be nudged and the game would hang (mirrors sim/runGame.ts `nextActor`).
      // Paired Players makes `turn.player` the paired builder, so it correctly uses `default` below.
      return [state.phase.builder];
    case "main": {
      if (state.trade) {
        const trade = state.trade;
        const responders = state.players
          .map((p) => p.seat)
          .filter((seat) => seat !== state.turn.player && trade.responses[seat] === undefined);
        if (responders.length > 0) return responders;
      }
      return [state.turn.player];
    }
    default:
      return [state.turn.player];
  }
}

/** Is `seat` a host-added bot (T-411 §1's occupant model)? */
export function isBotSeat(room: Room, seat: Seat): boolean {
  return room.seats[seat]?.occupant === "bot";
}

/**
 * The first seat (in `pendingActors` priority order) that's a bot, or `null` if the game is
 * currently waiting on a human — or nobody at all (`phase.kind === 'ended'`). `session.ts`'s
 * `driveBots` calls this after every applied action (human, bot, or timer auto-action) and loops
 * while it keeps returning a seat.
 */
export function nextBotActor(room: Room, state: GameState): Seat | null {
  for (const seat of pendingActors(state)) {
    if (isBotSeat(room, seat)) return seat;
  }
  return null;
}
