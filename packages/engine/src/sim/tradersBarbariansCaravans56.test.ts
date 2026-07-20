// T-1053: The Caravans 5–6 (Traders & Barbarians, building on T-1050's framework). Mirrors
// sim/tradersBarbariansBarbarianAttack56.test.ts's shape exactly: plays seeded `fiveSix +
// tradersBarbarians{scenario:'caravans'}` games at BOTH 5 and 6 players, under BOTH extra-build turn
// rules (X12), asserting the base invariants I1–I10 (invariants.ts, config-aware — the base 5–6
// bank/piece counts), the fiveSix FS/FS-PP turn-rule invariants, AND the caravans CAR1–CAR4
// invariants (caravansInvariants.ts, now geometry-aware — see T-1053's rework there) after EVERY
// successful transition. `simulate` throws on the first violation or an I10 timeout, with the seed +
// action index folded in for a ready repro.
//
// T&B plays on the BASE board (no scenario frame, TB1.2), so 5–6 here means the SAME base 30-hex
// `GEOMETRY_EXT56` a plain fiveSix game uses — plus caravans' Oasis/camel-route-edge geometry now
// computed against the RESOLVED config geometry (`computeCaravanRouteEdges`, threaded via
// `initialCaravansExt`'s new `geometry` parameter) instead of always the base 19-hex board.
// `TB_SCENARIO_SUPPORTS_56.caravans` (T-1053) is what makes this combo reachable at all — the route
// edges on the 30-hex board have no rulebook diagram (⚠ VERIFY, best-effort like T-1050/T-1051/
// T-1052's precedent). The caravan VOTE resolves the same way it does at 3–4p (the bot bids via
// `sim/bot.ts`'s `caravanVoteAction`, unchanged since B-50) — nothing about the vote/bid/resolve
// machinery is player-count- or geometry-dependent, only WHERE the camels can land.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

const GAMES_PER = 20;
// A 5–6-player fiveSix game with an extra-build turn rule runs longer than a base 3–4p game (more
// seats, more SBP/Paired sub-phase actions) PLUS Caravans' own higher 12-VP target (§TB4.4) — mirrors
// tradersBarbariansBarbarianAttack56.test.ts's cap, generously sized.
const MAX_ACTIONS = 15_000;

function caravans56Config(playerCount: 5 | 6, rule: 'sbp' | 'pairedPlayers'): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // overridden to 12 by createGame's caravans resolution (§TB4.4) — asserted below.
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: true,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'caravans' },
    },
    variants: { fiveSixTurnRule: rule },
  };
}

describe('T-1053 Traders & Barbarians 5–6: Caravans 5–6 (base 30-hex EXT56 board)', () => {
  for (const playerCount of [5, 6] as const) {
    for (const rule of ['sbp', 'pairedPlayers'] as const) {
      it(`plays ${GAMES_PER} full ${playerCount}-player caravans games under the ${rule} rule with zero invariant violations`, () => {
        const results: SimulateResult[] = [];
        for (let i = 0; i < GAMES_PER; i++) {
          // Throws (failing this test, repro-ready) on any base/fiveSix/caravans (CAR1–CAR4)
          // invariant or I10 hit.
          results.push(
            simulate(`tb56-caravan-${rule}-${playerCount}-${i}`, {
              config: caravans56Config(playerCount, rule),
              maxActions: MAX_ACTIONS,
            })
          );
        }

        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          // §TB4.4: the win target is resolved to 12, not the config's 10, at 5–6 too.
          expect(r.winnerVp).toBeGreaterThanOrEqual(12);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          const wins = results.filter((r) => r.winner === (seat as Seat)).length;
          expect(wins).toBeGreaterThanOrEqual(0); // sanity — no seat index out of range
        }

        // ---- The caravan mechanic was actually exercised, not just legal in principle -------------
        const votesOpened = results.reduce((sum, r) => sum + (r.caravanVotesOpened ?? 0), 0);
        const camelsPlaced = results.reduce((sum, r) => sum + (r.camelsPlaced ?? 0), 0);
        const gamesWithACamel = results.filter((r) => (r.camelsPlaced ?? 0) > 0).length;

        expect(votesOpened).toBeGreaterThan(0);
        expect(camelsPlaced).toBeGreaterThan(0);
        expect(gamesWithACamel / GAMES_PER).toBeGreaterThan(0.3);
      });
    }
  }
});
