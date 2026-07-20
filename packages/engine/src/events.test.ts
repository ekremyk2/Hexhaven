import { describe, expect, it } from 'vitest';
import type { EdgeId, GameEvent, HexId, VertexId } from '@hexhaven/shared';
import * as ev from './events.js';
import { stateWith } from './testkit.js';

const base = stateWith();

// Compile-time exhaustiveness: this record fails to typecheck the moment a GameEvent member is
// added, removed or renamed without a matching constructor here (docs/03 §5 stays in lockstep).
const CONSTRUCTED: Record<GameEvent['type'], GameEvent> = {
  gameStarted: ev.gameStarted(base.config, base.board),
  setupPlaced: ev.setupPlaced(0, 'settlement', 12 as VertexId),
  startingResources: ev.startingResources(1, { brick: 1, ore: 1 }),
  diceRolled: ev.diceRolled(2, [3, 4]),
  production: ev.production([{ seat: 0, resources: { wool: 2 } }], ['ore']),
  discardRequired: ev.discardRequired([{ seat: 1, amount: 4 }]),
  discarded: ev.discarded(1, { wool: 2, grain: 2 }),
  robberMoved: ev.robberMoved(0, 5 as HexId),
  stolen: ev.stolen(0, 1, 'grain'),
  built: ev.built(0, 'road', 7 as EdgeId),
  shipBuilt: ev.shipBuilt(0, 9 as EdgeId),
  shipMoved: ev.shipMoved(0, 9 as EdgeId, 11 as EdgeId),
  pirateMoved: ev.pirateMoved(0, 5 as HexId),
  goldChosen: ev.goldChosen(0, { grain: 1, ore: 1 }),
  islandSettled: ev.islandSettled(0, 1, 2),
  devBought: ev.devBought(3, 'knight'),
  devPlayed: ev.devPlayed(3, 'monopoly', { resource: 'ore' }),
  monopolyResolved: ev.monopolyResolved(3, 'ore', [{ seat: 0, count: 2 }]),
  bankTraded: ev.bankTraded(0, { brick: 4 }, { ore: 1 }, 4),
  tradeOffered: ev.tradeOffered(0, { brick: 1 }, { wool: 1 }),
  tradeResponded: ev.tradeResponded(2, 'accepted'),
  tradeCompleted: ev.tradeCompleted(0, 2, { brick: 1 }, { wool: 1 }),
  tradeCancelled: ev.tradeCancelled(),
  awardMoved: ev.awardMoved('longestRoad', 1, 5),
  turnEnded: ev.turnEnded(0, 1),
  specialBuildStarted: ev.specialBuildStarted(1, [2, 3]),
  specialBuildPassed: ev.specialBuildPassed(1),
  pairedBuildStarted: ev.pairedBuildStarted(3),
  pairedBuildEnded: ev.pairedBuildEnded(3),
  commodityProduction: ev.commodityProduction([{ seat: 0, commodities: { paper: 1 } }], ['coin']),
  aqueductGranted: ev.aqueductGranted(0, 'ore'),
  improvementBuilt: ev.improvementBuilt(0, 'science', 1),
  metropolisPlaced: ev.metropolisPlaced(0, 'science'),
  metropolisCaptured: ev.metropolisCaptured(0, 1, 'science'),
  commodityTraded: ev.commodityTraded(0, 'paper', 4, 'ore', 4),
  eventDieRolled: ev.eventDieRolled(0, 'ship'),
  barbarianAdvanced: ev.barbarianAdvanced(3),
  progressGateOpened: ev.progressGateOpened('trade', 2),
  barbarianAttackResolved: ev.barbarianAttackResolved(3, 2, 'defeated', null, [], [{ seat: 0, vertex: 5 as VertexId }]),
  knightBuilt: ev.knightBuilt(0, 12 as VertexId, 1),
  knightActivated: ev.knightActivated(0, 12 as VertexId),
  knightPromoted: ev.knightPromoted(0, 12 as VertexId, 2),
  knightMoved: ev.knightMoved(0, 12 as VertexId, 14 as VertexId),
  knightDisplaced: ev.knightDisplaced(0, 12 as VertexId, 14 as VertexId, 1, 16 as VertexId),
  progressCardDrawn: ev.progressCardDrawn(0, 'science', 'smith'),
  progressCardRevealed: ev.progressCardRevealed(0, 'printer'),
  progressCardDiscarded: ev.progressCardDiscarded(0, 'smith'),
  progressCardPlayed: ev.progressCardPlayed(0, 'warlord'),
  progressCardsTransferred: ev.progressCardsTransferred(0, 1, { ore: 1 }, { coin: 1 }),
  progressCardTaken: ev.progressCardTaken(0, 1, 'spy'),
  merchantPlaced: ev.merchantPlaced(0, 5 as HexId),
  cityWallBuilt: ev.cityWallBuilt(0, 12 as VertexId),
  knightRemoved: ev.knightRemoved(0, 12 as VertexId),
  roadRemoved: ev.roadRemoved(0, 7 as EdgeId, true),
  numberTokensSwapped: ev.numberTokensSwapped(0 as HexId, 1 as HexId),
  commodityMonopolyResolved: ev.commodityMonopolyResolved(0, 'paper', [{ seat: 1, count: 1 }]),
  helperDealt: ev.helperDealt(0, 'mayor'),
  helperUsed: ev.helperUsed(0, 'mayor', 'A', { resource: 'brick' }),
  helperSwapped: ev.helperSwapped(0, 'mayor', 'priest'),
  eventCardDrawn: ev.eventCardDrawn(0, 7),
  hexPieceMoved: ev.hexPieceMoved(0, 'wizard', 5 as HexId),
  hexPieceProduction: ev.hexPieceProduction('wizard', 5 as HexId, 'ore', [{ seat: 0, amount: 1 }]),
  fishProduced: ev.fishProduced([{ seat: 0, amount: 2 }]),
  oldBootAwarded: ev.oldBootAwarded(0),
  oldBootPassed: ev.oldBootPassed(0, 1),
  fishExchanged: ev.fishExchanged(0, 'removeRobber', 2),
  bridgeBuilt: ev.bridgeBuilt(0, 7 as EdgeId),
  coinsAwarded: ev.coinsAwarded(0, 1, 'shore'),
  coinsTraded: ev.coinsTraded(0, 2, 'ore', 2),
  caravanVoteOpened: ev.caravanVoteOpened(0, [0, 1, 2]),
  caravanVoteCast: ev.caravanVoteCast(0, 2),
  caravanVoteResolved: ev.caravanVoteResolved(1),
  camelPlaced: ev.camelPlaced(1, 7 as EdgeId),
  tbKnightRecruited: ev.tbKnightRecruited(0, 7 as EdgeId),
  tbKnightMoved: ev.tbKnightMoved(0, 7 as EdgeId, 9 as EdgeId, false),
  tbBarbariansAdvanced: ev.tbBarbariansAdvanced([{ from: 1 as HexId, to: 0 as HexId }]),
  tbBarbarianCombatResolved: ev.tbBarbarianCombatResolved(0 as HexId, 1, [{ seat: 0, captured: true, gold: 0 }]),
  tbBarbarianPillaged: ev.tbBarbarianPillaged(0 as HexId, 1, 5 as VertexId, 'city', []),
  tbBarbarianDispersed: ev.tbBarbarianDispersed(0 as HexId),
  tbWagonPlaced: ev.tbWagonPlaced(0, 12 as VertexId),
  tbWagonMoved: ev.tbWagonMoved(0, 1, [7 as EdgeId], 2, 'sand'),
  tbCommodityProduced: ev.tbCommodityProduced(3 as HexId, [{ seat: 0, commodities: { sand: 1 } }]),
  tbDeliveryCompleted: ev.tbDeliveryCompleted(0, 3 as HexId, 'quarry', ['sand', 'marble'], 2),
  epShipBuilt: ev.epShipBuilt(0, 7 as EdgeId),
  epShipMoved: ev.epShipMoved(0, 7 as EdgeId, 9 as EdgeId),
  epCargoLoaded: ev.epCargoLoaded(0, 7 as EdgeId, 'crew'),
  epCargoUnloaded: ev.epCargoUnloaded(0, 7 as EdgeId, 'crew'),
  epTileRevealed: ev.epTileRevealed(0, 5 as HexId, { kind: 'gold' }),
  epSettlerBuilt: ev.epSettlerBuilt(0),
  epSettlementFounded: ev.epSettlementFounded(0, 12 as VertexId),
  epHarborSettlementBuilt: ev.epHarborSettlementBuilt(0, 12 as VertexId),
  epCrewBuilt: ev.epCrewBuilt(0),
  epCrewPlacedOnLair: ev.epCrewPlacedOnLair(0, 5 as HexId),
  epLairCaptured: ev.epLairCaptured(5 as HexId, [{ seat: 0, vp: 1 }]),
  epGoldCompensated: ev.epGoldCompensated([{ seat: 0, amount: 1 }]),
  epGoldShipped: ev.epGoldShipped(0),
  epFishHauled: ev.epFishHauled(0, 5 as HexId),
  epFishDelivered: ev.epFishDelivered(0, 1),
  epSpiceTraded: ev.epSpiceTraded(0, 5 as HexId),
  epSpiceDelivered: ev.epSpiceDelivered(0, 1, 1),
  gameWon: ev.gameWon(0, { total: 10 }),
};

describe('event constructors (docs/03 §5)', () => {
  it('cover every GameEvent type with a matching tag', () => {
    for (const [key, event] of Object.entries(CONSTRUCTED)) {
      expect(event.type).toBe(key);
    }
    expect(Object.keys(CONSTRUCTED)).toHaveLength(101);
  });

  it('pass their payloads through verbatim', () => {
    expect(ev.turnEnded(2, 3)).toEqual({ type: 'turnEnded', seat: 2, next: 3 });
    expect(ev.stolen(1, 3, 'brick')).toEqual({ type: 'stolen', from: 1, to: 3, card: 'brick' });
    expect(ev.awardMoved('largestArmy', null, 0)).toEqual({
      type: 'awardMoved',
      award: 'largestArmy',
      holder: null,
      value: 0,
    });
    expect(ev.bankTraded(1, { grain: 2 }, { ore: 1 }, 2)).toEqual({
      type: 'bankTraded',
      seat: 1,
      gave: { grain: 2 },
      got: { ore: 1 },
      rate: 2,
    });
  });

  it('tradeCompleted writes the reserved-word field `with`', () => {
    const e = ev.tradeCompleted(0, 2, { brick: 1 }, { wool: 1 });
    expect(e.with).toBe(2);
    expect(e.from).toBe(0);
  });

  it('devPlayed omits `detail` entirely when not supplied', () => {
    expect('detail' in ev.devPlayed(0, 'knight')).toBe(false);
    expect(ev.devPlayed(0, 'yearOfPlenty', { a: 'ore', b: 'wool' })).toHaveProperty('detail', {
      a: 'ore',
      b: 'wool',
    });
  });
});
