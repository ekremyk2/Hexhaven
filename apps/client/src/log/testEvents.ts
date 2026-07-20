// Fixture builders for src/log/**'s tests: one sample `ViewerEvent` per `GameEvent` type (T-407
// requirement 4: "a test walks every event type"). Kept in one place so formatEvent.test.ts and
// timeline.test.ts share exactly the same canonical inputs.
import type { EdgeId, HexId, ResourceBundle, Seat, VertexId } from '@hexhaven/shared';
import type { ViewerEvent } from '@hexhaven/engine';

const RESOURCES: ResourceBundle = { brick: 1, lumber: 2 };

/** One `ViewerEvent` fixture per `GameEvent['type']`, keyed by that type string — used to assert
 * `formatEvent` covers every branch (`Object.values` walked in a `describe.each`). */
export const SAMPLE_VIEWER_EVENTS: Record<string, ViewerEvent> = {
  gameStarted: {
    type: 'gameStarted',
    config: {
      playerCount: 4,
      targetVp: 10,
      seed: 'x',
      board: 'random',
      tokenMethod: 'spiral',
      expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
    },
    board: { hexes: [], robber: 0 as HexId, harbors: {} },
  },
  setupPlaced: { type: 'setupPlaced', seat: 0 as Seat, piece: 'settlement', location: 1 as VertexId },
  startingResources: { type: 'startingResources', seat: 0 as Seat, gained: RESOURCES },
  diceRolled: { type: 'diceRolled', seat: 0 as Seat, roll: [3, 6] },
  production: {
    type: 'production',
    gains: [{ seat: 0 as Seat, resources: RESOURCES }],
    shortages: ['ore'],
  },
  discardRequired: { type: 'discardRequired', seats: [{ seat: 0 as Seat, amount: 4 }] },
  discardedSelf: { type: 'discarded', seat: 0 as Seat, cards: RESOURCES },
  discardedOther: { type: 'discarded', seat: 1 as Seat, count: 3 },
  robberMoved: { type: 'robberMoved', seat: 0 as Seat, hex: 5 as HexId },
  stolenActor: { type: 'stolen', from: 0 as Seat, to: 1 as Seat, card: 'ore' },
  stolenViewer: { type: 'stolen', from: 1 as Seat, to: 0 as Seat, card: 'ore' },
  stolenOther: { type: 'stolen', from: 1 as Seat, to: 2 as Seat },
  builtRoad: { type: 'built', seat: 0 as Seat, piece: 'road', location: 2 as EdgeId },
  builtSettlement: { type: 'built', seat: 0 as Seat, piece: 'settlement', location: 2 as VertexId },
  builtCity: { type: 'built', seat: 0 as Seat, piece: 'city', location: 2 as VertexId },
  devBoughtSelf: { type: 'devBought', seat: 0 as Seat, card: 'knight' },
  devBoughtOther: { type: 'devBought', seat: 1 as Seat },
  devPlayedKnight: { type: 'devPlayed', seat: 0 as Seat, card: 'knight' },
  devPlayedRoadBuilding: { type: 'devPlayed', seat: 0 as Seat, card: 'roadBuilding' },
  devPlayedYearOfPlenty: { type: 'devPlayed', seat: 0 as Seat, card: 'yearOfPlenty' },
  devPlayedMonopoly: { type: 'devPlayed', seat: 0 as Seat, card: 'monopoly' },
  devPlayedVictoryPoint: { type: 'devPlayed', seat: 0 as Seat, card: 'victoryPoint' },
  monopolyResolved: {
    type: 'monopolyResolved',
    seat: 0 as Seat,
    resource: 'grain',
    taken: [{ seat: 1 as Seat, count: 2 }, { seat: 2 as Seat, count: 3 }],
  },
  bankTraded: { type: 'bankTraded', seat: 0 as Seat, gave: { brick: 4 }, got: { ore: 1 }, rate: 4 },
  tradeOffered: { type: 'tradeOffered', from: 0 as Seat, give: { brick: 1 }, receive: { ore: 1 } },
  tradeRespondedAccepted: { type: 'tradeResponded', responder: 1 as Seat, response: 'accepted' },
  tradeRespondedDeclined: { type: 'tradeResponded', responder: 1 as Seat, response: 'declined' },
  tradeCompleted: {
    type: 'tradeCompleted',
    from: 0 as Seat,
    with: 1 as Seat,
    give: { brick: 1 },
    receive: { ore: 1 },
  },
  tradeCancelled: { type: 'tradeCancelled' },
  awardMovedLongestRoad: { type: 'awardMoved', award: 'longestRoad', holder: 0 as Seat, value: 6 },
  awardMovedLongestRoadCleared: { type: 'awardMoved', award: 'longestRoad', holder: null, value: 0 },
  awardMovedLargestArmy: { type: 'awardMoved', award: 'largestArmy', holder: 0 as Seat, value: 3 },
  awardMovedLargestArmyCleared: { type: 'awardMoved', award: 'largestArmy', holder: null, value: 0 },
  turnEnded: { type: 'turnEnded', seat: 0 as Seat, next: 1 as Seat },
  pirateMoved: { type: 'pirateMoved', seat: 0 as Seat, hex: 7 as HexId },
  goldChosen: { type: 'goldChosen', seat: 0 as Seat, picks: RESOURCES },
  islandSettled: { type: 'islandSettled', seat: 0 as Seat, island: 1, vp: 2 },
  gameWon: { type: 'gameWon', seat: 0 as Seat, vpBreakdown: { total: 10 } },
};
