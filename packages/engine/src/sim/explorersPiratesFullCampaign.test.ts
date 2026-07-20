// T-1114: the Explorers & Pirates "The Explorers & Pirates" full campaign scenario's simulation &
// invariant gate (docs/rules/explorers-pirates-rules.md §EP1.3(generalized)/§EP2/§EP3/§EP4/§EP7/
// §EP8/§EP9/§EP12.4, docs/tasks/phase-11/T-1114-full-campaign.md). Plays seeded full-campaign games
// at BOTH supported player counts (3 and 4, §EP1.2 — E&P is 3–4p only for now) with the random-legal-
// move bot (sim/bot.ts — every mission's candidate helpers already gate on their own
// `epXxxMissionActive` reading `EP_SCENARIO_CONFIG[scenario].missions`, so ALL THREE flows activate
// automatically once `fullCampaign` sets every flag true), asserting the base invariants I1–I10
// (invariants.ts) AND the COMPOSED EP-FISH1–5 + EP-SPICE1–6 + EP-LAIR1–7 invariants
// (explorersPiratesFullCampaignInvariants.ts) after EVERY successful transition.
//
// The full campaign reuses Land Ho!'s exact board/movement/founding frame with fish AND spice AND
// pirate lairs ALL additionally ON at once (createGame.ts's generalized E&P branch,
// `EP_SCENARIO_CONFIG.fullCampaign`) — the highest VP ceiling (17, ⚠ VERIFY) any E&P scenario offers,
// and the LAST E&P scenario to ship. This suite is the task's own literal completion-bar proof: it
// asserts BOTH that every game completes to the 17-VP target (not maxActions — the task's explicit
// "the sim is the arbiter" requirement, mirroring Six Islands'/Pirate Islands' own win-target
// tuning), AND that all three missions genuinely contribute VP across the run (fishPoints > 0 AND
// spicePoints > 0 AND lairPoints > 0 in aggregate) — proof the full campaign actually exercises
// everything at once, not just legal in principle.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Games per player count — mirrors every other E&P scenario suite's own headroom allowance. */
const GAMES_PER = 60;

/** The full campaign asks for the highest win target (17, vs. 10 for every single-mission scenario)
 *  with three missions (plus the T-1114 gold->VP safety net, `shipGold`) competing for the same
 *  3-ships-per-seat/2-cargo-slot budget at once — tuned empirically against this suite's own runs
 *  (the task's "the sim is the arbiter" mandate). Observed peak across all 120 games at this cap is
 *  under 4,000 actions (the `shipGold` safety net + the BFS-directed ship steering, both T-1114
 *  additions, keep even an unlucky seed — e.g. one with a ship stranded by exploration — from
 *  stalling forever; see bot.ts's own headers on `epGoldShipCandidates`/`seaEdgeDistanceToGoals`);
 *  this cap keeps generous (~2.5x) headroom over that without being needlessly huge. */
const MAX_ACTIONS = 10_000;

function fullCampaignConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // overridden to EP_SCENARIO_CONFIG.fullCampaign.winTarget (17, ⚠ VERIFY) by createGame.
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      explorersPirates: { scenario: 'fullCampaign' },
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
  meanFishHauled: number;
  meanFishDelivered: number;
  totalFishPointsAwarded: number;
  meanSpiceTraded: number;
  meanSpiceDelivered: number;
  totalSpicePointsAwarded: number;
  meanCrewsBuilt: number;
  meanCrewsLoaded: number;
  meanCrewsPlacedOnLair: number;
  totalLairsCaptured: number;
  totalLairPointsAwarded: number;
  gamesWithAFoundingFraction: number;
  gamesWithAFishDeliveryFraction: number;
  gamesWithASpiceDeliveryFraction: number;
  gamesWithACrewPlacementFraction: number;
}

function runCell(playerCount: 3 | 4): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`fullcampaign${playerCount}-${i}`, {
        config: fullCampaignConfig(playerCount),
        maxActions: MAX_ACTIONS,
      })
    );
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let shipsBuilt = 0;
  let shipMoves = 0;
  let tilesRevealed = 0;
  let settlementsFounded = 0;
  let harborSettlementsBuilt = 0;
  let fishHauled = 0;
  let fishDelivered = 0;
  let fishPointsAwarded = 0;
  let spiceTraded = 0;
  let spiceDelivered = 0;
  let spicePointsAwarded = 0;
  let crewsBuilt = 0;
  let crewsLoaded = 0;
  let crewsPlacedOnLair = 0;
  let lairsCaptured = 0;
  let lairPointsAwarded = 0;
  let gamesWithFounding = 0;
  let gamesWithFishDelivery = 0;
  let gamesWithSpiceDelivery = 0;
  let gamesWithCrewPlacement = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    shipsBuilt += r.epShipsBuilt ?? 0;
    shipMoves += r.epShipMoves ?? 0;
    tilesRevealed += r.epTilesRevealed ?? 0;
    settlementsFounded += r.epSettlementsFounded ?? 0;
    harborSettlementsBuilt += r.epHarborSettlementsBuilt ?? 0;
    fishHauled += r.epFishHauled ?? 0;
    fishDelivered += r.epFishDelivered ?? 0;
    fishPointsAwarded += r.totalFishPointsAwarded ?? 0;
    spiceTraded += r.epSpiceTraded ?? 0;
    spiceDelivered += r.epSpiceDelivered ?? 0;
    spicePointsAwarded += r.totalSpicePointsAwarded ?? 0;
    crewsBuilt += r.epCrewsBuilt ?? 0;
    crewsLoaded += r.epCrewsLoaded ?? 0;
    crewsPlacedOnLair += r.epCrewsPlacedOnLair ?? 0;
    lairsCaptured += r.epLairsCaptured ?? 0;
    lairPointsAwarded += r.totalLairPointsAwarded ?? 0;
    if ((r.epSettlementsFounded ?? 0) > 0) gamesWithFounding += 1;
    if ((r.epFishDelivered ?? 0) > 0) gamesWithFishDelivery += 1;
    if ((r.epSpiceDelivered ?? 0) > 0) gamesWithSpiceDelivery += 1;
    if ((r.epCrewsPlacedOnLair ?? 0) > 0) gamesWithCrewPlacement += 1;
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
    meanFishHauled: fishHauled / GAMES_PER,
    meanFishDelivered: fishDelivered / GAMES_PER,
    totalFishPointsAwarded: fishPointsAwarded,
    meanSpiceTraded: spiceTraded / GAMES_PER,
    meanSpiceDelivered: spiceDelivered / GAMES_PER,
    totalSpicePointsAwarded: spicePointsAwarded,
    meanCrewsBuilt: crewsBuilt / GAMES_PER,
    meanCrewsLoaded: crewsLoaded / GAMES_PER,
    meanCrewsPlacedOnLair: crewsPlacedOnLair / GAMES_PER,
    totalLairsCaptured: lairsCaptured,
    totalLairPointsAwarded: lairPointsAwarded,
    gamesWithAFoundingFraction: gamesWithFounding / GAMES_PER,
    gamesWithAFishDeliveryFraction: gamesWithFishDelivery / GAMES_PER,
    gamesWithASpiceDeliveryFraction: gamesWithSpiceDelivery / GAMES_PER,
    gamesWithACrewPlacementFraction: gamesWithCrewPlacement / GAMES_PER,
  };
  return { results, stats };
}

describe('T-1114 Explorers & Pirates full campaign simulation & invariant suite (3p + 4p)', () => {
  it(
    `plays ${GAMES_PER * 2} games (${GAMES_PER}× each of 3p/4p) to the 17-VP win target with zero invariant violations, all three missions actually firing`,
    () => {
      const allStats: CellStats[] = [];
      let totalFishPointsAcrossRun = 0;
      let totalSpicePointsAcrossRun = 0;
      let totalLairPointsAcrossRun = 0;
      let totalLairsCapturedAcrossRun = 0;
      for (const playerCount of [3, 4] as const) {
        const { results, stats } = runCell(playerCount);
        allStats.push(stats);
        totalFishPointsAcrossRun += stats.totalFishPointsAwarded;
        totalSpicePointsAcrossRun += stats.totalSpicePointsAwarded;
        totalLairPointsAcrossRun += stats.totalLairPointsAwarded;
        totalLairsCapturedAcrossRun += stats.totalLairsCaptured;

        for (const r of results) {
          // The task's own hardest bar: games must COMPLETE (reach 17 VP), not merely stay under
          // maxActions by accident — `simulate` itself throws an I10 violation if a game never
          // terminates, so reaching this assertion at all already proves termination; this assertion
          // additionally proves the WINNER'S vp is the real 17-VP target, not a stale lower value.
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          // §EP1.3 (generalized): the full campaign plays to EP_SCENARIO_CONFIG.fullCampaign.winTarget
          // (17, ⚠ VERIFY), not the base 10 passed in `fullCampaignConfig` by coincidence of value —
          // same shape as every other E&P scenario's own "not just the base config value" check.
          expect(r.winnerVp).toBeGreaterThanOrEqual(17);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        // ---- E&P mechanics (reused from Land Ho!'s frame) were actually exercised -----------------
        expect(stats.meanShipsBuilt).toBeGreaterThan(0.5);
        expect(stats.meanShipMoves).toBeGreaterThan(0.5);
        expect(stats.meanTilesRevealed).toBeGreaterThan(0);

        // ---- EVERY mission is genuinely exercised per cell, not just legal in principle -----------
        // Thresholds are deliberately lower than Fish/Spice for Hexhaven's own single-mission suites
        // (0.3): here fish/spice/lairs AND the location-independent gold->VP path (`shipGold`, added
        // during this task's own bot tuning — see bot.ts's header on `epGoldShipCandidates`) all
        // compete for the same limited action budget, so no single mission engages in every game the
        // way it does when it's the ONLY mission running. The per-run AGGREGATE assertions below (the
        // task's own literal "fishPoints > 0 AND spicePoints > 0 AND lairPoints > 0" ask) are the real
        // bar; these per-cell checks just confirm engagement isn't a one-off fluke.
        expect(stats.meanFishDelivered).toBeGreaterThan(0);
        expect(stats.meanSpiceDelivered).toBeGreaterThan(0);
        expect(stats.meanCrewsBuilt).toBeGreaterThan(0);
        expect(stats.meanCrewsLoaded).toBeGreaterThan(0);
        expect(stats.gamesWithAFishDeliveryFraction).toBeGreaterThan(0.15);
        expect(stats.gamesWithASpiceDeliveryFraction).toBeGreaterThan(0.15);
      }

      // ---- THE FULL CAMPAIGN'S OWN PREMISE — ALL THREE missions contribute VP across the WHOLE run
      // (the task's own literal ask: "fishPoints > 0 AND spicePoints > 0 AND lairPoints > 0 in
      // aggregate"). Lair capture (3 landed crews on one lair) is a taller bar than a single fish
      // haul/spice trade — mirrors Pirate Lairs' own suite (T-1113), which needn't hit in every game/
      // cell, only in aggregate across the whole run. ------------------------------------------------
      expect(totalFishPointsAcrossRun).toBeGreaterThan(0);
      expect(totalSpicePointsAcrossRun).toBeGreaterThan(0);
      expect(totalLairsCapturedAcrossRun).toBeGreaterThan(0);
      expect(totalLairPointsAcrossRun).toBeGreaterThan(0);

      process.stdout.write(`\nT-1114 full campaign sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    600_000
  );
});
