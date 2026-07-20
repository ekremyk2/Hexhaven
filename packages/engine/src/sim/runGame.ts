// T-112: `simulate(seed)` plays one full game from `createGame` to `ended` using the random-legal-
// move bot (sim/bot.ts), asserting I1–I9 (sim/invariants.ts) after every transition, I9's replay
// spot-check every 50 actions (docs/03 §7), and I10 (termination within 4,000 actions). Exported
// from the engine's public API (index.ts) so T-305 (hot-seat), T-204's tests, and future bots can
// reuse it without reaching into `sim/` directly.

import type { Action, GameConfig, GameState, Seat } from '@hexhaven/shared';
import { createGame } from '../createGame.js';
import { reduce } from '../reduce.js';
import { partialTurnOf } from '../modules/fiveSix/common.js';
import { hashSeed } from '../rng.js';
import { computeVp } from '../vp.js';
import { randomBot } from './bot.js';
import { checkInvariants, initialInvariantAccumulator } from './invariants.js';
import type { InvariantAccumulator } from './invariants.js';
import { checkFiveSixInvariants, initialFiveSixAccumulator } from './fivesixInvariants.js';
import { checkSeafarersInvariants, initialSeafarersAccumulator } from './seafarersInvariants.js';
import { checkCitiesKnightsInvariants, initialCitiesKnightsAccumulator } from './citiesKnightsInvariants.js';
import { checkFishermenInvariants, initialFishermenAccumulator } from './fishermenInvariants.js';
import { checkRiversInvariants, initialRiversAccumulator } from './riversInvariants.js';
import { checkCaravansInvariants, initialCaravansAccumulator } from './caravansInvariants.js';
import {
  checkBarbarianAttackInvariants,
  initialBarbarianAttackAccumulator,
} from './barbarianAttackInvariants.js';
import {
  checkTradersBarbariansMainInvariants,
  initialTradersBarbariansMainAccumulator,
} from './tradersBarbariansMainInvariants.js';
import {
  checkExplorersPiratesLandHoInvariants,
  initialExplorersPiratesLandHoAccumulator,
} from './explorersPiratesLandHoInvariants.js';
import {
  checkExplorersPiratesFishInvariants,
  initialExplorersPiratesFishAccumulator,
} from './explorersPiratesFishInvariants.js';
import {
  checkExplorersPiratesSpiceInvariants,
  initialExplorersPiratesSpiceAccumulator,
} from './explorersPiratesSpiceInvariants.js';
import {
  checkExplorersPiratesPirateLairsInvariants,
  initialExplorersPiratesPirateLairsAccumulator,
} from './explorersPiratesPirateLairsInvariants.js';
import {
  checkExplorersPiratesFullCampaignInvariants,
  initialExplorersPiratesFullCampaignAccumulator,
} from './explorersPiratesFullCampaignInvariants.js';
import { islandChitsOf, wonderStagesOf } from '../modules/seafarers/state.js';
import { isWondersOfHexhavenState } from '../modules/seafarers/wonder.js';
import {
  fishPointsOf,
  harborSettlementsOf,
  lairPointsOf,
  spiceBenefitOf,
  spicePointsOf,
} from '../modules/explorersPirates/state.js';
import { oldBootHolder } from '../modules/tradersBarbarians/state.js';

/** Fixed base-game config (docs/10 §3) — only `seed` varies per game. This is the RK-13 oracle's
 *  config: `simulate(seed)` with no options must stay byte-identical, so never change it. */
const CONFIG: Omit<GameConfig, 'seed'> = {
  playerCount: 4,
  targetVp: 10,
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

/** I10: a random-legal-move base game must terminate before this many actions. */
const MAX_ACTIONS = 4000;

/** I9's replay spot-check cadence (docs/03 §7: "every 50 actions"). */
const REPLAY_INTERVAL = 50;

export interface LoggedAction {
  seat: Seat;
  action: Action;
}

export interface SimulateResult {
  seed: string;
  winner: Seat;
  /** The winner's final total VP (≥ the resolved target — 10 base, 14 for a seafarers scenario). */
  winnerVp: number;
  /** Final `turn.number` when the game ended. */
  turns: number;
  /** Total actions successfully applied. */
  actions: number;
  longestRoadHolder: Seat | null;
  longestRoadLength: number;
  largestArmyHolder: Seat | null;
  largestArmyCount: number;
  /** The full seat+action trail — lets a caller replay or shrink a failure. */
  log: LoggedAction[];
  /** fiveSix-only observations (undefined for a base game): whether the game exercised the SBP /
   *  a Paired-Players partial turn, and whether "player 2" won on a partial turn (X12 FS-PP4). */
  sawSpecialBuild?: boolean;
  sawPartialTurn?: boolean;
  wonDuringPartialTurn?: boolean;
  /** Seafarers-only observations (undefined for a non-seafarers game, T-706): how many ships were
   *  built / moved over the game, the peak ships any one seat held at once, the total distinct
   *  island chits earned across all seats at game end, and the winner's own island-chit count. */
  shipsBuilt?: number;
  shipMoves?: number;
  peakShipsOnBoard?: number;
  islandChitsEarned?: number;
  winnerIslandChits?: number;
  /** Fog Islands-only observation (undefined for a non-Fog-Islands seafarers game, T-756): how many
   *  fog hexes were revealed over the whole game (`ext.seafarers.fog.hidden`'s shrinkage from its
   *  seeded starting count to its count at game end) — the sim's coverage confirmation that the fog
   *  reveal mechanic (folded into `buildShip`/`moveShip`) actually fires during real play. */
  fogTilesRevealed?: number;
  /** "Cloth for Hexhaven" (T-757, undefined for a non-Cloth-for-Hexhaven seafarers game): total cloth
   *  tokens granted across every seat over the whole game (`ext.seafarers.cloth`'s final sum) — the
   *  sim's coverage confirmation that the cloth-village production hook (folded into `rollDice`)
   *  actually fires during ordinary random-bot play, mirroring `fogTilesRevealed`'s role for T-756. */
  clothTotal?: number;
  /** "The Pirate Islands" (T-758, undefined for a non-seafarers game): the auto-moving pirate's FINAL
   *  track index (`ext.seafarers.pirateTrackIndex`) — 0 for every scenario other than Pirate Islands
   *  (field absent there) — and the total number of pirate lairs captured across every seat over the
   *  whole game (`ext.seafarers.lairs`'s final sum). The sim's coverage confirmation that BOTH the
   *  auto-move hook (folded into `rollDice`) and the lair-capture hook (folded into
   *  `buildShip`/`moveShip`/`buildSettlement`) actually fire during ordinary random-bot play. */
  pirateTrackIndexFinal?: number;
  /** Ground-truth count of every `ext.seafarers.pirateTrackIndex` change over the whole game (see the
   *  field's own in-loop comment in `simulate` for why this isn't simply "the number of rolls"). */
  pirateAdvances?: number;
  lairsCaptured?: number;
  /** "The Wonders of Hexhaven" (T-759, undefined for a non-Wonders-of-Hexhaven seafarers game): every
   *  seat's final wonder-stage count (`ext.seafarers.wonder`) and whether the WINNER personally
   *  completed every stage (`winnerWonderStagesDone >= WONDER_STAGES`) — i.e. this game was decided
   *  by the alternate win, not the normal VP-target race. The sim's coverage confirmation that the
   *  build-hook (folded into `buildSettlement`/`buildCity`) AND the alternate win (`checkWin`) both
   *  actually fire during ordinary random-bot play, mirroring `clothTotal`/`lairsCaptured`'s role for
   *  T-757/T-758. */
  wonderStagesFinal?: number[];
  winnerWonderStagesDone?: number;
  /** Cities & Knights-only observations (undefined for a non-C&K game, T-807): per-subsystem action
   *  counts over the whole game — how many times each C&K action type was actually taken — plus
   *  barbarian-attack/metropolis/progress-card-draw totals pulled from events, so the sim's report
   *  can show every subsystem was genuinely exercised (not just legal in principle). */
  improvementsBuilt?: number;
  knightsBuilt?: number;
  knightActivations?: number;
  knightPromotions?: number;
  knightMoves?: number;
  knightDisplacements?: number;
  cityWallsBuilt?: number;
  commodityBankTrades?: number;
  chaseRobberUses?: number;
  progressCardsPlayed?: number;
  progressCardsDrawn?: number;
  barbarianAttacks?: number;
  metropolisesPlaced?: number;
  /** Fishermen-only observations (undefined for a non-fishermen game, T-1002): how many times fish
   *  were exchanged / the Old Boot changed hands, total fish ever produced, and whether the WINNER
   *  personally held the Old Boot at game end (its +1-to-win catch-up actually mattered). */
  fishExchanges?: number;
  oldBootPasses?: number;
  totalFishProduced?: number;
  winnerHeldOldBoot?: boolean;
  /** Rivers-only observations (undefined for a non-rivers game, T-1003): bridges built / coin
   *  trades made over the whole game, total coins ever awarded, and the WINNER's final coin total. */
  bridgesBuilt?: number;
  coinTrades?: number;
  totalCoinsAwarded?: number;
  winnerCoins?: number;
  /** Caravans-only observations (undefined for a non-caravans game, T-1004): how many camel votes
   *  were opened / bids cast / camels actually placed over the whole game, and the WINNER's final
   *  between-two-camels VP. */
  caravanVotesOpened?: number;
  caravanVotesCast?: number;
  camelsPlaced?: number;
  winnerCaravansVp?: number;
  /** Barbarian Attack-only observations (undefined for a non-barbarianAttack game, T-1005): knight
   *  recruits/moves and barbarian combat/pillage/dispersal counts over the whole game, and the
   *  WINNER's final captured-barbarian VP. */
  knightsRecruited?: number;
  barbarianKnightMoves?: number;
  barbarianCombatsResolved?: number;
  barbarianPillages?: number;
  barbarianDispersals?: number;
  winnerBarbarianAttackVp?: number;
  /** The main scenario-only observations (undefined for a non-tradersBarbarians game, T-1006):
   *  wagons placed/moved and deliveries completed over the whole game, and the WINNER's final
   *  delivery VP. */
  wagonsPlaced?: number;
  wagonMoves?: number;
  deliveriesCompleted?: number;
  winnerDeliveryVp?: number;
  /** Explorers & Pirates Land Ho!-only observations (undefined for a non-E&P game, T-1107): ships
   *  built/moved, tiles revealed, settlements founded via ship, and harbor settlements built over the
   *  whole game, plus the WINNER's final settlement + harbor-settlement VP. */
  epShipsBuilt?: number;
  epShipMoves?: number;
  epTilesRevealed?: number;
  epSettlementsFounded?: number;
  epHarborSettlementsBuilt?: number;
  winnerHarborSettlements?: number;
  /** Explorers & Pirates "Fish for Hexhaven"-only observations (undefined for a non-fishForHexhaven game,
   *  T-1111): the SAME ship/founding/harbor stats as Land Ho! above (this scenario reuses that exact
   *  frame), plus how many times fish were hauled (auto, on ship arrival at a shoal) / delivered to
   *  the council, the total fish-delivery VP awarded across every seat, and the WINNER's own fish VP —
   *  the sim's coverage confirmation that the fish mission (T-1106's `deliverFish`) actually fires
   *  during ordinary random-bot play, not just legal in principle (mirrors `totalFishProduced`'s role
   *  for the unrelated Traders & Barbarians "Fishermen" scenario, T-1002). */
  epFishHauled?: number;
  epFishDelivered?: number;
  totalFishPointsAwarded?: number;
  winnerFishPoints?: number;
  /** Explorers & Pirates "Spices for Hexhaven"-only observations (undefined for a non-spicesForHexhaven
   *  game, T-1112): the SAME ship/founding/harbor stats as Land Ho!/Fish for Hexhaven above (this
   *  scenario reuses that exact frame), plus how many times spice was traded (paid, at a village) /
   *  delivered to the council, the total spice-delivery VP awarded across every seat, and the
   *  WINNER's own spice VP + `spiceBenefit` level — the sim's coverage confirmation that the spice
   *  mission (T-1106's `deliverSpice`) actually fires during ordinary random-bot play, not just legal
   *  in principle (mirrors `totalFishPointsAwarded`'s role for Fish for Hexhaven, T-1111). */
  epSpiceTraded?: number;
  epSpiceDelivered?: number;
  totalSpicePointsAwarded?: number;
  winnerSpicePoints?: number;
  winnerSpiceBenefit?: number;
  /** T-1110 (fish-auto-haul fidelity fix, FOLLOWUPS.md): the CROSS-mission leak-proof counters —
   *  populated (never undefined) for a Fish for Hexhaven / Spices for Hexhaven / Pirate Lairs game only,
   *  each reading the OTHER mission's own haul/trade/deliver counts + awarded VP that scenario's
   *  mission flags leave off. Every one of these must be exactly 0 for every game: e.g. for a Spices
   *  for Hexhaven result (`missions.fish` off), `leakFishHauled`/`leakFishDelivered`/
   *  `leakTotalFishPointsAwarded` prove fish never accrues there anymore (the leak this task closes —
   *  before the fix, a spice-only game could incidentally seed+haul+deliver fish too); for a Fish for
   *  Hexhaven result (`missions.spice` off), the mirror `leakSpiceTraded`/`leakSpiceDelivered`/
   *  `leakTotalSpicePointsAwarded` prove the same for the opposite direction; for a Pirate Lairs
   *  result (neither mission on), the fish-side trio proves it too (never affected by the leak in the
   *  first place, included here for a uniform confirmatory check across every non-fish/non-spice
   *  scenario). `undefined` for every other scenario (Land Ho!/full campaign — full campaign has
   *  every mission on, so there is no "other mission" to prove zero for). */
  leakFishHauled?: number;
  leakFishDelivered?: number;
  leakTotalFishPointsAwarded?: number;
  leakSpiceTraded?: number;
  leakSpiceDelivered?: number;
  leakTotalSpicePointsAwarded?: number;
  /** Explorers & Pirates "The Pirate Lairs"-only observations (undefined for a non-pirateLairs game,
   *  T-1113): the SAME ship/founding/harbor stats as Land Ho!/Fish/Spice above (this scenario reuses
   *  that exact frame), plus how many crews were built / loaded onto a ship / landed on a lair, how
   *  many lairs were captured, the total lair-capture VP awarded across every seat, and the WINNER's
   *  own lair VP — the sim's coverage confirmation that the pirate-lairs mission (T-1105's
   *  `buildEPCrew`/`placeCrewOnLair`) actually fires during ordinary random-bot play, not just legal
   *  in principle (mirrors `totalSpicePointsAwarded`'s role for Spices for Hexhaven, T-1112). */
  epCrewsBuilt?: number;
  epCrewsLoaded?: number;
  epCrewsPlacedOnLair?: number;
  epLairsCaptured?: number;
  totalLairPointsAwarded?: number;
  winnerLairPoints?: number;
  /** Explorers & Pirates full campaign games (T-1114) reuse every field above — `epShipsBuilt`
   *  through `winnerLairPoints` — exactly as Land Ho!/Fish/Spice/Pirate Lairs do (each scenario is
   *  mutually exclusive per game, so no two blocks ever populate the same field for the same result;
   *  see runGame's own `explorersPiratesFullCampaign` branch), PLUS `winnerSpiceBenefit` from the
   *  spice block above. No new fields needed: the full campaign is simply the scenario where fish AND
   *  spice AND lair stats are all simultaneously nonzero-eligible in one result. */
}

/** Options for `simulate`. Omit everything for the RK-13 base-oracle game (4-player, no expansions,
 *  4,000-action cap) — that path must stay byte-identical. */
export interface SimulateOptions {
  /** Config override (everything but `seed`). Enables 5–6 player / fiveSix simulations. */
  config?: Omit<GameConfig, 'seed'>;
  /** I10 action cap. Defaults to 4,000 (base); 5–6 games with an extra-build rule run longer. */
  maxActions?: number;
}

/**
 * Which seat may legally act on `state` right now (mirrors reduce.ts's actor guard, docs/03 §4):
 * a still-pending discard seat first (R6.1), else an unresponded seat while a domestic trade offer
 * is open (R8.1 — `respondTrade` is only routable while `phase.kind === 'main'`, same as
 * `offerTrade`/`confirmTrade`/`cancelTrade`; a trade opened before a Knight play can otherwise
 * outlive the phase it was opened in, docs/03 §3), else the turn owner.
 */
function nextActor(state: GameState): Seat {
  if (state.phase.kind === 'discard') {
    const seat = state.phase.pending[0];
    if (seat === undefined) throw new Error('BUG: discard phase entered with no pending seats');
    return seat;
  }
  // Seafarers gold (S9/ER-S7): any pending seat acts (possibly a non-owner), like discards.
  if (state.phase.kind === 'chooseGoldResource') {
    const seat = state.phase.pending[0];
    if (seat === undefined) throw new Error('BUG: gold phase entered with no pending seats');
    return seat;
  }
  // Caravans camel-placement vote (T-1004, §TB4.2): any still-pending seat bids next (possibly a
  // non-owner, like discards/gold); once every seat has bid, the resolved winner (possibly a
  // non-owner too) places the camel.
  if (state.phase.kind === 'caravanVote') {
    const pendingSeat = state.phase.pending[0];
    if (pendingSeat !== undefined) return pendingSeat;
    if (state.phase.winner === null) {
      throw new Error('BUG: caravanVote phase has no pending seats and no winner (should have returned to main)');
    }
    return state.phase.winner;
  }
  // 5–6 SBP (X12): the special builder acts while `turn.player` is the seat whose turn just ended.
  // (Paired Players makes `turn.player` the paired builder, so it falls through to the base return.)
  if (state.phase.kind === 'specialBuild') return state.phase.builder;
  if (state.phase.kind === 'main' && state.trade != null) {
    const owner = state.turn.player;
    const trade = state.trade;
    const responder = state.players
      .map((p) => p.seat)
      .find((s) => s !== owner && trade.responses[s] === undefined);
    if (responder !== undefined) return responder;
  }
  return state.turn.player;
}

/** Structural deep-equality over the JSON-safe `GameState` shape — order-independent on object
 * keys (unlike `JSON.stringify` comparison), which is what a replay spot-check needs. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
}

/**
 * Plays one full game to completion from `seed` with the random-legal-move bot. Throws on the
 * first I1–I9 violation (with the seed, action index, and offending action folded into the
 * message — the task's "shrink to a minimal repro" starting point) or on an I10 timeout.
 *
 * The bot's own randomness is a SEPARATE seeded rng stream from `state.rng` (hashed off `seed`),
 * never `Math.random` (engine purity, docs/05 §2) and never mixed into the engine's own
 * determinism — replaying `log` through `reduce` alone (no bot involved) must reproduce the same
 * trajectory, which is exactly what the periodic I9 check below re-verifies mid-game.
 */
export function simulate(seed: string, options: SimulateOptions = {}): SimulateResult {
  const config = options.config ?? CONFIG;
  const maxActions = options.maxActions ?? MAX_ACTIONS;
  let state = createGame({ ...config, seed });
  let botRng = hashSeed(`${seed}#bot`);
  let acc: InvariantAccumulator = initialInvariantAccumulator();

  // fiveSix games get the X12 turn-rule invariants on top of the (config-aware) base I1–I10.
  const fiveSix = state.config.expansions.fiveSix;
  let fsAcc = initialFiveSixAccumulator();
  let sawSpecialBuild = false;
  let sawPartialTurn = false;

  // seafarers games get the S-clause invariants on top of the base I1–I10, plus ship/island stats.
  const seafarers = state.ext?.seafarers !== undefined;
  let sfAcc = initialSeafarersAccumulator();
  let shipsBuilt = 0;
  // The Pirate Islands (T-758): a ground-truth count of every time `ext.seafarers.pirateTrackIndex`
  // actually changed value across the whole game — NOT the same as the number of `rollDice` actions
  // (a 7 routes to `discard`/`moveRobber` instead of `main`, so `advancePirateTrack`'s dice-roll hook
  // never fires for it; see modules/seafarers/index.ts's `afterAction`). `0` for every other scenario.
  let pirateAdvances = 0;
  let shipMoves = 0;
  // Fog Islands (T-756): captured once, right after `createGame` seeds `ext.seafarers.fog` — `0` for
  // every other seafarers scenario/game (no `fog` block), so `fogTilesRevealed` is always `0` there.
  const initialFogHidden = state.ext?.seafarers?.fog?.hidden.length ?? 0;

  // Cities & Knights games (T-807) get the C-clause invariants on top of the base I1–I10, plus
  // per-subsystem action/event counts for the sim's coverage report.
  const citiesKnights = state.ext?.citiesKnights !== undefined;
  let ckAcc = initialCitiesKnightsAccumulator();
  let improvementsBuilt = 0;
  let knightsBuilt = 0;
  let knightActivations = 0;
  let knightPromotions = 0;
  let knightMoves = 0;
  let knightDisplacements = 0;
  let cityWallsBuilt = 0;
  let commodityBankTrades = 0;
  let chaseRobberUses = 0;
  let progressCardsPlayed = 0;
  let progressCardsDrawn = 0;
  let barbarianAttacks = 0;
  let metropolisesPlaced = 0;

  // Fishermen games (T-1002) get the FISH-clause invariants on top of the base I1–I10 (whose I7 is
  // already fishermen-aware), plus exchange/boot/production stats for the sim's coverage report.
  const fishermen = state.ext?.tradersBarbarians?.scenario === 'fishermen';
  let fishAcc = initialFishermenAccumulator();
  let fishExchanges = 0;
  let oldBootPasses = 0;
  let totalFishProduced = 0;

  // Rivers games (T-1003) get the RIV-clause invariants on top of the base I1–I10, plus
  // bridge/coin-trade stats for the sim's coverage report.
  const rivers = state.ext?.tradersBarbarians?.scenario === 'rivers';
  let riversAcc = initialRiversAccumulator();
  let bridgesBuilt = 0;
  let coinTrades = 0;
  let totalCoinsAwarded = 0;

  // Caravans games (T-1004) get the CAR-clause invariants on top of the base I1–I10, plus
  // vote/camel stats for the sim's coverage report.
  const caravans = state.ext?.tradersBarbarians?.scenario === 'caravans';
  let caravansAcc = initialCaravansAccumulator();
  let caravanVotesOpened = 0;
  let caravanVotesCast = 0;
  let camelsPlaced = 0;

  // Barbarian Attack games (T-1005) get the BAR-clause invariants on top of the base I1–I10, plus
  // knight/combat/pillage stats for the sim's coverage report.
  const barbarianAttack = state.ext?.tradersBarbarians?.scenario === 'barbarianAttack';
  let barbarianAttackAcc = initialBarbarianAttackAccumulator();

  // The main scenario games (T-1006) get the TBM-clause invariants on top of the base I1–I10, plus
  // wagon/delivery stats for the sim's coverage report.
  const tradersBarbariansMain = state.ext?.tradersBarbarians?.scenario === 'tradersBarbarians';
  let tradersBarbariansMainAcc = initialTradersBarbariansMainAccumulator();

  // Explorers & Pirates Land Ho! games (T-1107) get the EP-LH-clause invariants on top of the base
  // I1–I10, plus ship/founding/harbor stats for the sim's coverage report.
  const explorersPiratesLandHo = state.ext?.explorersPirates?.scenario === 'landHo';
  let epAcc = initialExplorersPiratesLandHoAccumulator();
  let epShipsBuilt = 0;
  let epShipMoves = 0;
  let epTilesRevealed = 0;
  let epSettlementsFounded = 0;
  let epHarborSettlementsBuilt = 0;

  // Explorers & Pirates "Fish for Hexhaven" games (T-1111) get the EP-FISH-clause invariants on top of
  // the base I1–I10, plus the SAME ship/founding/harbor stats as Land Ho! above (this scenario reuses
  // that exact frame) and fish-mission-specific haul/delivery stats for the sim's coverage report.
  const explorersPiratesFish = state.ext?.explorersPirates?.scenario === 'fishForHexhaven';
  let epFishAcc = initialExplorersPiratesFishAccumulator();
  let epFishShipsBuilt = 0;
  let epFishShipMoves = 0;
  let epFishTilesRevealed = 0;
  let epFishSettlementsFounded = 0;
  let epFishHarborSettlementsBuilt = 0;
  let epFishHauled = 0;
  let epFishDelivered = 0;
  let totalFishPointsAwarded = 0;
  // T-1110 (fish-auto-haul fidelity fix leak proof, mirrored): Fish for Hexhaven's own spice mission is
  // off, so these must stay 0 for EVERY game — proves the mirror-image leak (a fish-only scenario
  // incidentally trading/delivering spice) stays closed, same discipline as the spice/lair blocks'
  // own fish-leak counters below.
  let epFishLeakSpiceTraded = 0;
  let epFishLeakSpiceDelivered = 0;
  let totalFishLeakSpicePointsAwarded = 0;

  // Explorers & Pirates "Spices for Hexhaven" games (T-1112) get the EP-SPICE-clause invariants on top
  // of the base I1–I10, plus the SAME ship/founding/harbor stats as Land Ho!/Fish for Hexhaven above
  // (this scenario reuses that exact frame) and spice-mission-specific trade/delivery stats for the
  // sim's coverage report.
  const explorersPiratesSpice = state.ext?.explorersPirates?.scenario === 'spicesForHexhaven';
  let epSpiceAcc = initialExplorersPiratesSpiceAccumulator();
  let epSpiceShipsBuilt = 0;
  let epSpiceShipMoves = 0;
  let epSpiceTilesRevealed = 0;
  let epSpiceSettlementsFounded = 0;
  let epSpiceHarborSettlementsBuilt = 0;
  let epSpiceTraded = 0;
  let epSpiceDelivered = 0;
  let totalSpicePointsAwarded = 0;
  // T-1110 (fish-auto-haul fidelity fix leak proof): Spices for Hexhaven's own fish mission is off, so
  // these must stay 0 for EVERY game now that `fishShoals` is only ever seeded for a fish-mission
  // scenario (createGame.ts) and `haulFishOnArrival`/`deliverFishHandler` also explicitly re-check
  // `epFishMissionActive` (goldFishSpice.ts) — this is the sim's own proof the cross-mission leak
  // (FOLLOWUPS.md) is closed, not just legal-in-principle.
  let epSpiceLeakFishHauled = 0;
  let epSpiceLeakFishDelivered = 0;
  let totalSpiceLeakFishPointsAwarded = 0;

  // Explorers & Pirates "The Pirate Lairs" games (T-1113) get the EP-LAIR-clause invariants on top of
  // the base I1–I10, plus the SAME ship/founding/harbor stats as Land Ho!/Fish/Spice above (this
  // scenario reuses that exact frame) and crew/lair-mission-specific build/load/place/capture stats
  // for the sim's coverage report.
  const explorersPiratesPirateLairs = state.ext?.explorersPirates?.scenario === 'pirateLairs';
  let epLairAcc = initialExplorersPiratesPirateLairsAccumulator();
  let epLairShipsBuilt = 0;
  let epLairShipMoves = 0;
  let epLairTilesRevealed = 0;
  let epLairSettlementsFounded = 0;
  let epLairHarborSettlementsBuilt = 0;
  let epCrewsBuilt = 0;
  let epCrewsLoaded = 0;
  let epCrewsPlacedOnLair = 0;
  let epLairsCaptured = 0;
  let totalLairPointsAwarded = 0;
  // T-1110 (fish-auto-haul fidelity fix leak proof, mirrors the Spices for Hexhaven block above): Pirate
  // Lairs has neither the fish nor the spice mission on, so both must stay 0 for every game.
  let epLairLeakFishHauled = 0;
  let epLairLeakFishDelivered = 0;
  let totalLairLeakFishPointsAwarded = 0;

  // Explorers & Pirates "The Explorers & Pirates" full campaign (T-1114) games get ALL THREE
  // mission-clause invariant sets (EP-FISH/EP-SPICE/EP-LAIR, composed —
  // explorersPiratesFullCampaignInvariants.ts) on top of the base I1–I10, plus the SAME
  // ship/founding/harbor stats as every other E&P scenario above (this scenario reuses that exact
  // frame too) and every mission's own build/haul/trade/deliver/capture stats for the sim's coverage
  // report — this scenario is the only one where fish AND spice AND lair stats are all simultaneously
  // meaningful.
  const explorersPiratesFullCampaign = state.ext?.explorersPirates?.scenario === 'fullCampaign';
  let epFullAcc = initialExplorersPiratesFullCampaignAccumulator();
  let epFullShipsBuilt = 0;
  let epFullShipMoves = 0;
  let epFullTilesRevealed = 0;
  let epFullSettlementsFounded = 0;
  let epFullHarborSettlementsBuilt = 0;
  let epFullFishHauled = 0;
  let epFullFishDelivered = 0;
  let totalFullFishPointsAwarded = 0;
  let epFullSpiceTraded = 0;
  let epFullSpiceDelivered = 0;
  let totalFullSpicePointsAwarded = 0;
  let epFullCrewsBuilt = 0;
  let epFullCrewsLoaded = 0;
  let epFullCrewsPlacedOnLair = 0;
  let epFullLairsCaptured = 0;
  let totalFullLairPointsAwarded = 0;

  const log: LoggedAction[] = [];
  let checkpoint = state;
  let sinceCheckpoint: LoggedAction[] = [];
  let actions = 0;

  while (state.phase.kind !== 'ended') {
    if (actions >= maxActions) {
      // Diagnostic detail (action-type histogram, current VPs, last few actions) rides on the
      // thrown message so an I10 hit is a ready-made repro bundle (task requirement 5) rather than
      // a bare "it didn't finish" — this is exactly what caught seed "sim-836"'s domestic-trade
      // churn during implementation (bot.ts's `mainAction` now rate-limits `offerTrade`).
      const actionCounts: Partial<Record<Action['type'], number>> = {};
      for (const entry of log) actionCounts[entry.action.type] = (actionCounts[entry.action.type] ?? 0) + 1;
      const vps = state.players.map((p) => computeVp(state, p.seat).total);
      throw new Error(
        `I10 violation: seed "${seed}" did not terminate within ${maxActions} actions. ` +
          `vps=${JSON.stringify(vps)} actionCounts=${JSON.stringify(actionCounts)} ` +
          `lastActions=${JSON.stringify(log.slice(-10))}`
      );
    }

    const actor = nextActor(state);
    const decision = randomBot(state, actor, botRng);
    botRng = decision.rng;

    const result = reduce(state, actor, decision.action);
    if (!result.ok) {
      throw new Error(
        `BUG: sim bot proposed an illegal action for seed "${seed}" at action ${actions}: ` +
          `seat ${actor} ${JSON.stringify(decision.action)} -> ${result.error.code} (${result.error.message})`
      );
    }

    const prev = state;
    state = result.state;
    actions += 1;
    const entry: LoggedAction = { seat: actor, action: decision.action };
    log.push(entry);
    sinceCheckpoint.push(entry);

    // The Pirate Islands (T-758): count every actual track-index change (cheap no-op comparison for
    // every other seafarers scenario/game, where `pirateTrackIndex` is always `undefined` on both
    // sides).
    if (seafarers && prev.ext?.seafarers?.pirateTrackIndex !== state.ext?.seafarers?.pirateTrackIndex) {
      pirateAdvances += 1;
    }

    try {
      acc = checkInvariants(prev, decision.action, state, result.events, acc);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
      );
    }

    if (fiveSix) {
      try {
        fsAcc = checkFiveSixInvariants(prev, decision.action, state, result.events, actor, fsAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `fiveSix invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
      if (state.phase.kind === 'specialBuild') sawSpecialBuild = true;
      if (partialTurnOf(state) !== null) sawPartialTurn = true;
    }

    if (seafarers) {
      try {
        sfAcc = checkSeafarersInvariants(state, decision.action, result.events, sfAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `seafarers invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
      if (decision.action.type === 'buildShip' || decision.action.type === 'placeFreeShip') shipsBuilt += 1;
      if (decision.action.type === 'moveShip') shipMoves += 1;
    }

    if (citiesKnights) {
      try {
        ckAcc = checkCitiesKnightsInvariants(state, result.events, ckAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `citiesKnights invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
      switch (decision.action.type) {
        case 'buildImprovement':
          improvementsBuilt += 1;
          break;
        case 'buildKnight':
          knightsBuilt += 1;
          break;
        case 'activateKnight':
          knightActivations += 1;
          break;
        case 'promoteKnight':
          knightPromotions += 1;
          break;
        case 'moveKnight':
          knightMoves += 1;
          break;
        case 'knightDisplace':
          knightDisplacements += 1;
          break;
        case 'buildCityWall':
          cityWallsBuilt += 1;
          break;
        case 'commodityBankTrade':
          commodityBankTrades += 1;
          break;
        case 'chaseRobber':
          chaseRobberUses += 1;
          break;
        case 'playProgressCard':
          progressCardsPlayed += 1;
          break;
        default:
          break;
      }
      for (const e of result.events) {
        if (e.type === 'barbarianAttackResolved') barbarianAttacks += 1;
        if (e.type === 'metropolisPlaced' || e.type === 'metropolisCaptured') metropolisesPlaced += 1;
        if (e.type === 'progressCardDrawn') progressCardsDrawn += 1;
      }
    }

    if (fishermen) {
      try {
        fishAcc = checkFishermenInvariants(state, decision.action, result.events, fishAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `fishermen invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
      if (decision.action.type === 'exchangeFish') fishExchanges += 1;
      if (decision.action.type === 'passOldBoot') oldBootPasses += 1;
      for (const e of result.events) {
        if (e.type === 'fishProduced') totalFishProduced += e.gains.reduce((sum, g) => sum + g.amount, 0);
      }
    }

    if (rivers) {
      try {
        riversAcc = checkRiversInvariants(state, decision.action, result.events, riversAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `rivers invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
      if (decision.action.type === 'buildBridge') bridgesBuilt += 1;
      if (decision.action.type === 'tradeCoins') coinTrades += 1;
      for (const e of result.events) {
        if (e.type === 'coinsAwarded') totalCoinsAwarded += e.amount;
      }
    }

    if (caravans) {
      try {
        caravansAcc = checkCaravansInvariants(state, decision.action, result.events, caravansAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `caravans invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
      for (const e of result.events) {
        if (e.type === 'caravanVoteOpened') caravanVotesOpened += 1;
        if (e.type === 'caravanVoteCast') caravanVotesCast += 1;
        if (e.type === 'camelPlaced') camelsPlaced += 1;
      }
    }

    if (barbarianAttack) {
      try {
        barbarianAttackAcc = checkBarbarianAttackInvariants(state, decision.action, result.events, barbarianAttackAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `barbarianAttack invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
    }

    if (tradersBarbariansMain) {
      try {
        tradersBarbariansMainAcc = checkTradersBarbariansMainInvariants(
          state,
          decision.action,
          result.events,
          tradersBarbariansMainAcc
        );
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `tradersBarbariansMain invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
    }

    if (explorersPiratesLandHo) {
      try {
        epAcc = checkExplorersPiratesLandHoInvariants(state, decision.action, result.events, epAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `explorersPiratesLandHo invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
      if (decision.action.type === 'buildEPShip') epShipsBuilt += 1;
      if (decision.action.type === 'moveEPShip') epShipMoves += 1;
      for (const e of result.events) {
        if (e.type === 'epTileRevealed') epTilesRevealed += 1;
        if (e.type === 'epSettlementFounded') epSettlementsFounded += 1;
        if (e.type === 'epHarborSettlementBuilt') epHarborSettlementsBuilt += 1;
      }
    }

    if (explorersPiratesFish) {
      try {
        epFishAcc = checkExplorersPiratesFishInvariants(state, decision.action, result.events, epFishAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `explorersPiratesFish invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
      if (decision.action.type === 'buildEPShip') epFishShipsBuilt += 1;
      if (decision.action.type === 'moveEPShip') epFishShipMoves += 1;
      for (const e of result.events) {
        if (e.type === 'epTileRevealed') epFishTilesRevealed += 1;
        if (e.type === 'epSettlementFounded') epFishSettlementsFounded += 1;
        if (e.type === 'epHarborSettlementBuilt') epFishHarborSettlementsBuilt += 1;
        if (e.type === 'epFishHauled') epFishHauled += 1;
        if (e.type === 'epFishDelivered') {
          epFishDelivered += 1;
          totalFishPointsAwarded += e.vp;
        }
        // T-1110 leak proof (mirror direction): Fish for Hexhaven's own spice mission is off.
        if (e.type === 'epSpiceTraded') epFishLeakSpiceTraded += 1;
        if (e.type === 'epSpiceDelivered') {
          epFishLeakSpiceDelivered += 1;
          totalFishLeakSpicePointsAwarded += e.vp;
        }
      }
    }

    if (explorersPiratesSpice) {
      try {
        epSpiceAcc = checkExplorersPiratesSpiceInvariants(state, decision.action, result.events, epSpiceAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `explorersPiratesSpice invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
      if (decision.action.type === 'buildEPShip') epSpiceShipsBuilt += 1;
      if (decision.action.type === 'moveEPShip') epSpiceShipMoves += 1;
      for (const e of result.events) {
        if (e.type === 'epTileRevealed') epSpiceTilesRevealed += 1;
        if (e.type === 'epSettlementFounded') epSpiceSettlementsFounded += 1;
        if (e.type === 'epHarborSettlementBuilt') epSpiceHarborSettlementsBuilt += 1;
        if (e.type === 'epSpiceTraded') epSpiceTraded += 1;
        if (e.type === 'epSpiceDelivered') {
          epSpiceDelivered += 1;
          totalSpicePointsAwarded += e.vp;
        }
        // T-1110 leak proof: Spices for Hexhaven's own fish mission is off — these must stay 0.
        if (e.type === 'epFishHauled') epSpiceLeakFishHauled += 1;
        if (e.type === 'epFishDelivered') {
          epSpiceLeakFishDelivered += 1;
          totalSpiceLeakFishPointsAwarded += e.vp;
        }
      }
    }

    if (explorersPiratesPirateLairs) {
      try {
        epLairAcc = checkExplorersPiratesPirateLairsInvariants(state, decision.action, result.events, epLairAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `explorersPiratesPirateLairs invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
      if (decision.action.type === 'buildEPShip') epLairShipsBuilt += 1;
      if (decision.action.type === 'moveEPShip') epLairShipMoves += 1;
      for (const e of result.events) {
        if (e.type === 'epTileRevealed') epLairTilesRevealed += 1;
        if (e.type === 'epSettlementFounded') epLairSettlementsFounded += 1;
        if (e.type === 'epHarborSettlementBuilt') epLairHarborSettlementsBuilt += 1;
        if (e.type === 'epCrewBuilt') epCrewsBuilt += 1;
        if (e.type === 'epCargoLoaded' && e.piece === 'crew') epCrewsLoaded += 1;
        if (e.type === 'epCrewPlacedOnLair') epCrewsPlacedOnLair += 1;
        if (e.type === 'epLairCaptured') {
          epLairsCaptured += 1;
          totalLairPointsAwarded += e.awards.reduce((sum, a) => sum + a.vp, 0);
        }
        // T-1110 leak proof: Pirate Lairs has neither fish nor spice on — these must stay 0.
        if (e.type === 'epFishHauled') epLairLeakFishHauled += 1;
        if (e.type === 'epFishDelivered') {
          epLairLeakFishDelivered += 1;
          totalLairLeakFishPointsAwarded += e.vp;
        }
      }
    }

    if (explorersPiratesFullCampaign) {
      try {
        epFullAcc = checkExplorersPiratesFullCampaignInvariants(state, decision.action, result.events, epFullAcc);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        throw new Error(
          `explorersPiratesFullCampaign invariant violation for seed "${seed}" at action ${actions} (seat ${actor} ${JSON.stringify(decision.action)}): ${detail}`
        );
      }
      if (decision.action.type === 'buildEPShip') epFullShipsBuilt += 1;
      if (decision.action.type === 'moveEPShip') epFullShipMoves += 1;
      for (const e of result.events) {
        if (e.type === 'epTileRevealed') epFullTilesRevealed += 1;
        if (e.type === 'epSettlementFounded') epFullSettlementsFounded += 1;
        if (e.type === 'epHarborSettlementBuilt') epFullHarborSettlementsBuilt += 1;
        if (e.type === 'epFishHauled') epFullFishHauled += 1;
        if (e.type === 'epFishDelivered') {
          epFullFishDelivered += 1;
          totalFullFishPointsAwarded += e.vp;
        }
        if (e.type === 'epSpiceTraded') epFullSpiceTraded += 1;
        if (e.type === 'epSpiceDelivered') {
          epFullSpiceDelivered += 1;
          totalFullSpicePointsAwarded += e.vp;
        }
        if (e.type === 'epCrewBuilt') epFullCrewsBuilt += 1;
        if (e.type === 'epCargoLoaded' && e.piece === 'crew') epFullCrewsLoaded += 1;
        if (e.type === 'epCrewPlacedOnLair') epFullCrewsPlacedOnLair += 1;
        if (e.type === 'epLairCaptured') {
          epFullLairsCaptured += 1;
          totalFullLairPointsAwarded += e.awards.reduce((sum, a) => sum + a.vp, 0);
        }
      }
    }

    if (actions % REPLAY_INTERVAL === 0) {
      let replay = checkpoint;
      for (const step of sinceCheckpoint) {
        const r = reduce(replay, step.seat, step.action);
        if (!r.ok) {
          throw new Error(
            `I9 replay violation for seed "${seed}": action ${JSON.stringify(step)} failed to reapply from checkpoint`
          );
        }
        replay = r.state;
      }
      if (!deepEqual(replay, state)) {
        throw new Error(
          `I9 replay violation for seed "${seed}": replayed state diverges from the live state at action ${actions}`
        );
      }
      checkpoint = state;
      sinceCheckpoint = [];
    }
  }

  return {
    seed,
    winner: state.phase.winner,
    winnerVp: computeVp(state, state.phase.winner).total,
    turns: state.turn.number,
    actions,
    longestRoadHolder: state.awards.longestRoad.holder,
    longestRoadLength: state.awards.longestRoad.length,
    largestArmyHolder: state.awards.largestArmy.holder,
    largestArmyCount: state.awards.largestArmy.count,
    log,
    ...(fiveSix
      ? {
          sawSpecialBuild,
          sawPartialTurn,
          wonDuringPartialTurn: fsAcc.wonDuringPartialTurn,
        }
      : {}),
    ...(seafarers
      ? {
          shipsBuilt,
          shipMoves,
          peakShipsOnBoard: sfAcc.peakShipsOnBoard,
          islandChitsEarned: state.players.reduce((sum, p) => sum + islandChitsOf(state, p.seat).length, 0),
          winnerIslandChits: islandChitsOf(state, state.phase.winner).length,
          fogTilesRevealed: initialFogHidden - (state.ext?.seafarers?.fog?.hidden.length ?? initialFogHidden),
          clothTotal: state.ext?.seafarers?.cloth?.reduce((sum, c) => sum + c, 0) ?? 0,
          pirateTrackIndexFinal: state.ext?.seafarers?.pirateTrackIndex ?? 0,
          pirateAdvances,
          lairsCaptured: state.ext?.seafarers?.lairs?.reduce((sum, list) => sum + list.length, 0) ?? 0,
          ...(isWondersOfHexhavenState(state)
            ? {
                wonderStagesFinal: state.players.map((p) => wonderStagesOf(state, p.seat)),
                winnerWonderStagesDone: wonderStagesOf(state, state.phase.winner),
              }
            : {}),
        }
      : {}),
    ...(citiesKnights
      ? {
          improvementsBuilt,
          knightsBuilt,
          knightActivations,
          knightPromotions,
          knightMoves,
          knightDisplacements,
          cityWallsBuilt,
          commodityBankTrades,
          chaseRobberUses,
          progressCardsPlayed,
          progressCardsDrawn,
          barbarianAttacks,
          metropolisesPlaced,
        }
      : {}),
    ...(fishermen
      ? {
          fishExchanges,
          oldBootPasses,
          totalFishProduced,
          winnerHeldOldBoot: oldBootHolder(state) === state.phase.winner,
        }
      : {}),
    ...(rivers
      ? {
          bridgesBuilt,
          coinTrades,
          totalCoinsAwarded,
          winnerCoins: state.ext?.tradersBarbarians?.coins?.[state.phase.winner] ?? 0,
        }
      : {}),
    ...(caravans
      ? {
          caravanVotesOpened,
          caravanVotesCast,
          camelsPlaced,
          winnerCaravansVp: computeVp(state, state.phase.winner).caravansVp ?? 0,
        }
      : {}),
    ...(barbarianAttack
      ? {
          knightsRecruited: barbarianAttackAcc.knightsRecruited,
          barbarianKnightMoves: barbarianAttackAcc.knightMoves,
          barbarianCombatsResolved: barbarianAttackAcc.combatsResolved,
          barbarianPillages: barbarianAttackAcc.pillages,
          barbarianDispersals: barbarianAttackAcc.dispersals,
          winnerBarbarianAttackVp: computeVp(state, state.phase.winner).barbarianAttackVp ?? 0,
        }
      : {}),
    ...(tradersBarbariansMain
      ? {
          wagonsPlaced: tradersBarbariansMainAcc.wagonsPlaced,
          wagonMoves: tradersBarbariansMainAcc.wagonMoves,
          deliveriesCompleted: tradersBarbariansMainAcc.deliveriesCompleted,
          winnerDeliveryVp: computeVp(state, state.phase.winner).tradersBarbariansMainVp ?? 0,
        }
      : {}),
    ...(explorersPiratesLandHo
      ? {
          epShipsBuilt,
          epShipMoves,
          epTilesRevealed,
          epSettlementsFounded,
          epHarborSettlementsBuilt,
          winnerHarborSettlements: harborSettlementsOf(state, state.phase.winner).length,
        }
      : {}),
    ...(explorersPiratesFish
      ? {
          epShipsBuilt: epFishShipsBuilt,
          epShipMoves: epFishShipMoves,
          epTilesRevealed: epFishTilesRevealed,
          epSettlementsFounded: epFishSettlementsFounded,
          epHarborSettlementsBuilt: epFishHarborSettlementsBuilt,
          winnerHarborSettlements: harborSettlementsOf(state, state.phase.winner).length,
          epFishHauled,
          epFishDelivered,
          totalFishPointsAwarded,
          winnerFishPoints: fishPointsOf(state, state.phase.winner),
          // T-1110 leak proof (mirror direction): Fish for Hexhaven's own spice mission is off.
          leakSpiceTraded: epFishLeakSpiceTraded,
          leakSpiceDelivered: epFishLeakSpiceDelivered,
          leakTotalSpicePointsAwarded: totalFishLeakSpicePointsAwarded,
        }
      : {}),
    ...(explorersPiratesSpice
      ? {
          epShipsBuilt: epSpiceShipsBuilt,
          epShipMoves: epSpiceShipMoves,
          epTilesRevealed: epSpiceTilesRevealed,
          epSettlementsFounded: epSpiceSettlementsFounded,
          epHarborSettlementsBuilt: epSpiceHarborSettlementsBuilt,
          winnerHarborSettlements: harborSettlementsOf(state, state.phase.winner).length,
          epSpiceTraded,
          epSpiceDelivered,
          totalSpicePointsAwarded,
          winnerSpicePoints: spicePointsOf(state, state.phase.winner),
          winnerSpiceBenefit: spiceBenefitOf(state, state.phase.winner),
          // T-1110 leak proof: Spices for Hexhaven's own fish mission is off — must stay 0.
          leakFishHauled: epSpiceLeakFishHauled,
          leakFishDelivered: epSpiceLeakFishDelivered,
          leakTotalFishPointsAwarded: totalSpiceLeakFishPointsAwarded,
        }
      : {}),
    ...(explorersPiratesPirateLairs
      ? {
          epShipsBuilt: epLairShipsBuilt,
          epShipMoves: epLairShipMoves,
          epTilesRevealed: epLairTilesRevealed,
          epSettlementsFounded: epLairSettlementsFounded,
          epHarborSettlementsBuilt: epLairHarborSettlementsBuilt,
          winnerHarborSettlements: harborSettlementsOf(state, state.phase.winner).length,
          // T-1110 leak proof: Pirate Lairs has neither fish nor spice on — must stay 0.
          leakFishHauled: epLairLeakFishHauled,
          leakFishDelivered: epLairLeakFishDelivered,
          leakTotalFishPointsAwarded: totalLairLeakFishPointsAwarded,
          epCrewsBuilt,
          epCrewsLoaded,
          epCrewsPlacedOnLair,
          epLairsCaptured,
          totalLairPointsAwarded,
          winnerLairPoints: lairPointsOf(state, state.phase.winner),
        }
      : {}),
    ...(explorersPiratesFullCampaign
      ? {
          epShipsBuilt: epFullShipsBuilt,
          epShipMoves: epFullShipMoves,
          epTilesRevealed: epFullTilesRevealed,
          epSettlementsFounded: epFullSettlementsFounded,
          epHarborSettlementsBuilt: epFullHarborSettlementsBuilt,
          winnerHarborSettlements: harborSettlementsOf(state, state.phase.winner).length,
          epFishHauled: epFullFishHauled,
          epFishDelivered: epFullFishDelivered,
          totalFishPointsAwarded: totalFullFishPointsAwarded,
          winnerFishPoints: fishPointsOf(state, state.phase.winner),
          epSpiceTraded: epFullSpiceTraded,
          epSpiceDelivered: epFullSpiceDelivered,
          totalSpicePointsAwarded: totalFullSpicePointsAwarded,
          winnerSpicePoints: spicePointsOf(state, state.phase.winner),
          winnerSpiceBenefit: spiceBenefitOf(state, state.phase.winner),
          epCrewsBuilt: epFullCrewsBuilt,
          epCrewsLoaded: epFullCrewsLoaded,
          epCrewsPlacedOnLair: epFullCrewsPlacedOnLair,
          epLairsCaptured: epFullLairsCaptured,
          totalLairPointsAwarded: totalFullLairPointsAwarded,
          winnerLairPoints: lairPointsOf(state, state.phase.winner),
        }
      : {}),
  };
}
