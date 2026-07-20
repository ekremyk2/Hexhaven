// T-1107: the Explorers & Pirates "Land Ho!" scenario's simulation & invariant gate (docs/rules/
// explorers-pirates-rules.md §EP1.3/§EP2/§EP3/§EP4/§EP5/§EP12.4, docs/tasks/phase-11/
// T-1107-land-ho-scenario.md). Plays seeded Land Ho! games at BOTH supported player counts (3 and 4,
// §EP1.2 — E&P is 3–4p only for now) with the random-legal-move bot (sim/bot.ts, taught the E&P ship/
// settler/founding/harbor actions), asserting the base invariants I1–I10 (invariants.ts, whose I7 is
// already target-aware via `winTargetFor`/`state.config.targetVp`) AND the Land Ho! EP-LH1–EP-LH4
// invariants (explorersPiratesLandHoInvariants.ts: cargo cap, ship cap/uniqueness, harbor <= founded,
// fog never leaks) after EVERY successful transition. `simulate` throws on the first violation or an
// I10 timeout, with the seed + action index + offending action folded in for a ready repro.
//
// Land Ho! uses NONE of the three missions (§EP11.1) — only movement + exploration + founding
// settlements/harbor settlements to 8 VP (§EP1.3) — so this suite doesn't assert anything about
// crews/lairs/fish/spice/gold (sim/bot.ts deliberately never proposes those actions for this
// scenario either).

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Games per player count — enough to exercise ship/exploration/founding/harbor play repeatedly
 *  without the full 500-game headline gate T-706 uses for a bigger scenario acceptance sweep. */
const GAMES_PER = 60;

/** Land Ho!'s board/economy is smaller than base (a 7-hex home island + a 12-hex fog ring) but the
 *  ship-movement/exploration/founding loop adds real actions on top of base play — a little headroom
 *  over the base 4,000-action I10 cap, mirroring every other scenario test's own allowance. */
const MAX_ACTIONS = 6000;

function landHoConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // overridden to EP_LANDHO_TARGET_VP (8) by createGame — §EP1.3.
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      explorersPirates: { scenario: 'landHo' },
    },
  };
}

interface CellStats {
  cell: string;
  playerCount: number;
  games: number;
  meanTurns: number;
  meanActions: number;
  maxActions: number;
  winsBySeat: Partial<Record<Seat, number>>;
  meanShipsBuilt: number;
  meanShipMoves: number;
  meanTilesRevealed: number;
  meanSettlementsFounded: number;
  meanHarborSettlementsBuilt: number;
  gamesWithAFoundingFraction: number;
  gamesWithAHarborUpgradeFraction: number;
}

function runCell(playerCount: 3 | 4): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`landho${playerCount}-${i}`, { config: landHoConfig(playerCount), maxActions: MAX_ACTIONS })
    );
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let shipsBuilt = 0;
  let shipMoves = 0;
  let tilesRevealed = 0;
  let settlementsFounded = 0;
  let harborSettlementsBuilt = 0;
  let gamesWithFounding = 0;
  let gamesWithHarborUpgrade = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    shipsBuilt += r.epShipsBuilt ?? 0;
    shipMoves += r.epShipMoves ?? 0;
    tilesRevealed += r.epTilesRevealed ?? 0;
    settlementsFounded += r.epSettlementsFounded ?? 0;
    harborSettlementsBuilt += r.epHarborSettlementsBuilt ?? 0;
    if ((r.epSettlementsFounded ?? 0) > 0) gamesWithFounding += 1;
    if ((r.epHarborSettlementsBuilt ?? 0) > 0) gamesWithHarborUpgrade += 1;
  }

  const stats: CellStats = {
    cell: `${playerCount}p`,
    playerCount,
    games: GAMES_PER,
    meanTurns: results.reduce((s, r) => s + r.turns, 0) / GAMES_PER,
    meanActions: results.reduce((s, r) => s + r.actions, 0) / GAMES_PER,
    maxActions: Math.max(...results.map((r) => r.actions)),
    winsBySeat,
    meanShipsBuilt: shipsBuilt / GAMES_PER,
    meanShipMoves: shipMoves / GAMES_PER,
    meanTilesRevealed: tilesRevealed / GAMES_PER,
    meanSettlementsFounded: settlementsFounded / GAMES_PER,
    meanHarborSettlementsBuilt: harborSettlementsBuilt / GAMES_PER,
    gamesWithAFoundingFraction: gamesWithFounding / GAMES_PER,
    gamesWithAHarborUpgradeFraction: gamesWithHarborUpgrade / GAMES_PER,
  };
  return { results, stats };
}

describe('T-1107 Explorers & Pirates Land Ho! simulation & invariant suite (3p + 4p)', () => {
  it(
    `plays ${GAMES_PER * 2} games (${GAMES_PER}× each of 3p/4p) to the 8-VP win with zero invariant violations`,
    () => {
      const allStats: CellStats[] = [];
      for (const playerCount of [3, 4] as const) {
        const { results, stats } = runCell(playerCount);
        allStats.push(stats);

        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          // §EP1.3: Land Ho! plays to 8 VP, not the base 10 passed in `landHoConfig`.
          expect(r.winnerVp).toBeGreaterThanOrEqual(8);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        // ---- E&P mechanics were actually exercised, not just legal in principle -----------------
        expect(stats.meanShipsBuilt).toBeGreaterThan(0.5);
        expect(stats.meanShipMoves).toBeGreaterThan(0.5);
        expect(stats.meanTilesRevealed).toBeGreaterThan(0);
        expect(stats.gamesWithAHarborUpgradeFraction).toBeGreaterThan(0.3);
      }

      process.stdout.write(`\nT-1107 Land Ho! sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    300_000
  );
});
