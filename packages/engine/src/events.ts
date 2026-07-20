// Event constructors — one per GameEvent type (docs/03 §5), so every engine module emits
// identically-shaped events. Events carry data only; the client translates them (docs/05 §7).
// Redaction of hidden fields (discarded cards, stolen card, bought dev card) happens server-side
// in T-204 — constructors here always build the full, unredacted event.

import type {
  AnyDevCardId,
  CardModComboId,
  Commodity,
  EdgeId,
  EPCargo,
  EPTile,
  EventDieFace,
  FishBenefit,
  GameConfig,
  GameEvent,
  HexId,
  HexPieceKindId,
  ImprovementTrack,
  KnightLevel,
  ProgressCardId,
  ResourceBundle,
  ResourceType,
  Seat,
  VertexId,
} from '@hexhaven/shared';

/** The narrow GameEvent member with tag `T`. */
type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>;

export function gameStarted(config: GameConfig, board: Ev<'gameStarted'>['board']): Ev<'gameStarted'> {
  return { type: 'gameStarted', config, board };
}

export function setupPlaced(
  seat: Seat,
  piece: 'settlement' | 'road',
  location: VertexId | EdgeId
): Ev<'setupPlaced'> {
  return { type: 'setupPlaced', seat, piece, location };
}

export function startingResources(seat: Seat, gained: ResourceBundle): Ev<'startingResources'> {
  return { type: 'startingResources', seat, gained };
}

export function diceRolled(seat: Seat, roll: [number, number]): Ev<'diceRolled'> {
  return { type: 'diceRolled', seat, roll };
}

/** Event Cards modifier (T-904b): the number drawn from the deck this turn. */
export function eventCardDrawn(seat: Seat, total: number): Ev<'eventCardDrawn'> {
  return { type: 'eventCardDrawn', seat, total };
}

export function production(
  gains: { seat: Seat; resources: ResourceBundle }[],
  shortages: ResourceType[]
): Ev<'production'> {
  return { type: 'production', gains, shortages };
}

export function discardRequired(seats: { seat: Seat; amount: number }[]): Ev<'discardRequired'> {
  return { type: 'discardRequired', seats };
}

export function discarded(seat: Seat, cards: ResourceBundle): Ev<'discarded'> {
  return { type: 'discarded', seat, cards };
}

export function robberMoved(seat: Seat, hex: HexId): Ev<'robberMoved'> {
  return { type: 'robberMoved', seat, hex };
}

export function stolen(from: Seat, to: Seat, card: ResourceType): Ev<'stolen'> {
  return { type: 'stolen', from, to, card };
}

// ---- Multi-piece hex framework (T-902, docs/07 D-034) ------------------------------------------

export function hexPieceMoved(seat: Seat, piece: HexPieceKindId, hex: HexId): Ev<'hexPieceMoved'> {
  return { type: 'hexPieceMoved', seat, piece, hex };
}

export function hexPieceProduction(
  piece: HexPieceKindId,
  hex: HexId,
  resource: ResourceType,
  gains: { seat: Seat; amount: number }[]
): Ev<'hexPieceProduction'> {
  return { type: 'hexPieceProduction', piece, hex, resource, gains };
}

export function built(
  seat: Seat,
  piece: 'road' | 'settlement' | 'city',
  location: VertexId | EdgeId
): Ev<'built'> {
  return { type: 'built', seat, piece, location };
}

// ---- Seafarers ship events (S4/S7, T-702) — data only; the client translates ------------------

export function shipBuilt(seat: Seat, edge: EdgeId): Ev<'shipBuilt'> {
  return { type: 'shipBuilt', seat, edge };
}

export function shipMoved(seat: Seat, from: EdgeId, to: EdgeId): Ev<'shipMoved'> {
  return { type: 'shipMoved', seat, from, to };
}

// ---- Seafarers pirate / gold / island chits (S8/S9/S10.6, T-703) — data only ------------------

export function pirateMoved(seat: Seat, hex: HexId): Ev<'pirateMoved'> {
  return { type: 'pirateMoved', seat, hex };
}

export function goldChosen(seat: Seat, picks: ResourceBundle): Ev<'goldChosen'> {
  return { type: 'goldChosen', seat, picks };
}

export function islandSettled(seat: Seat, island: number, vp: number): Ev<'islandSettled'> {
  return { type: 'islandSettled', seat, island, vp };
}

export function devBought(seat: Seat, card: AnyDevCardId): Ev<'devBought'> {
  return { type: 'devBought', seat, card };
}

export function devPlayed(seat: Seat, card: AnyDevCardId | CardModComboId, detail?: unknown): Ev<'devPlayed'> {
  // Omit `detail` entirely when not supplied, so events serialize without noise keys.
  return detail === undefined
    ? { type: 'devPlayed', seat, card }
    : { type: 'devPlayed', seat, card, detail };
}

export function monopolyResolved(
  seat: Seat,
  resource: ResourceType,
  taken: { seat: Seat; count: number }[]
): Ev<'monopolyResolved'> {
  return { type: 'monopolyResolved', seat, resource, taken };
}

export function bankTraded(
  seat: Seat,
  gave: ResourceBundle,
  got: ResourceBundle,
  rate: 2 | 3 | 4
): Ev<'bankTraded'> {
  return { type: 'bankTraded', seat, gave, got, rate };
}

export function tradeOffered(
  from: Seat,
  give: ResourceBundle,
  receive: ResourceBundle
): Ev<'tradeOffered'> {
  return { type: 'tradeOffered', from, give, receive };
}

export function tradeResponded(
  responder: Seat,
  response: 'accepted' | 'declined'
): Ev<'tradeResponded'> {
  return { type: 'tradeResponded', responder, response };
}

// `with` is a reserved word, so the parameter is `withSeat`; the event field stays `with`.
export function tradeCompleted(
  from: Seat,
  withSeat: Seat,
  give: ResourceBundle,
  receive: ResourceBundle
): Ev<'tradeCompleted'> {
  return { type: 'tradeCompleted', from, with: withSeat, give, receive };
}

export function tradeCancelled(): Ev<'tradeCancelled'> {
  return { type: 'tradeCancelled' };
}

export function awardMoved(
  award: 'longestRoad' | 'largestArmy' | 'harbormaster',
  holder: Seat | null,
  value: number
): Ev<'awardMoved'> {
  return { type: 'awardMoved', award, holder, value };
}

export function turnEnded(seat: Seat, next: Seat): Ev<'turnEnded'> {
  return { type: 'turnEnded', seat, next };
}

// ---- 5–6 extension extra-build events (X12) — emitted only by the fiveSix module -------------

export function specialBuildStarted(builder: Seat, queue: Seat[]): Ev<'specialBuildStarted'> {
  return { type: 'specialBuildStarted', builder, queue };
}

export function specialBuildPassed(seat: Seat): Ev<'specialBuildPassed'> {
  return { type: 'specialBuildPassed', seat };
}

export function pairedBuildStarted(builder: Seat): Ev<'pairedBuildStarted'> {
  return { type: 'pairedBuildStarted', builder };
}

export function pairedBuildEnded(seat: Seat): Ev<'pairedBuildEnded'> {
  return { type: 'pairedBuildEnded', seat };
}

export function gameWon(seat: Seat, vpBreakdown: unknown): Ev<'gameWon'> {
  return { type: 'gameWon', seat, vpBreakdown };
}

// ---- Cities & Knights (T-802, docs/rules/cities-knights-rules.md) — data only, the client
// translates. Emitted only by the citiesKnights module. -----------------------------------------

export function commodityProduction(
  gains: { seat: Seat; commodities: Partial<Record<Commodity, number>> }[],
  shortages: Commodity[]
): Ev<'commodityProduction'> {
  return { type: 'commodityProduction', gains, shortages };
}

export function aqueductGranted(seat: Seat, resource: ResourceType): Ev<'aqueductGranted'> {
  return { type: 'aqueductGranted', seat, resource };
}

export function improvementBuilt(seat: Seat, track: ImprovementTrack, level: number): Ev<'improvementBuilt'> {
  return { type: 'improvementBuilt', seat, track, level };
}

export function metropolisPlaced(seat: Seat, track: ImprovementTrack): Ev<'metropolisPlaced'> {
  return { type: 'metropolisPlaced', seat, track };
}

export function metropolisCaptured(from: Seat, to: Seat, track: ImprovementTrack): Ev<'metropolisCaptured'> {
  return { type: 'metropolisCaptured', from, to, track };
}

export function commodityTraded(
  seat: Seat,
  give: Commodity,
  giveAmount: number,
  receive: ResourceType | Commodity,
  rate: 2 | 4
): Ev<'commodityTraded'> {
  return { type: 'commodityTraded', seat, give, giveAmount, receive, rate };
}

// ---- Cities & Knights knights/barbarians (T-803, docs/rules/cities-knights-rules.md C5/C7/C8) --

export function eventDieRolled(seat: Seat, face: EventDieFace): Ev<'eventDieRolled'> {
  return { type: 'eventDieRolled', seat, face };
}

export function barbarianAdvanced(position: number): Ev<'barbarianAdvanced'> {
  return { type: 'barbarianAdvanced', position };
}

export function progressGateOpened(track: ImprovementTrack, redDie: number): Ev<'progressGateOpened'> {
  return { type: 'progressGateOpened', track, redDie };
}

export function barbarianAttackResolved(
  attackStrength: number,
  defenseStrength: number,
  result: 'defended' | 'defeated',
  defenderSeat: Seat | null,
  tiedSeats: Seat[],
  pillaged: { seat: Seat; vertex: VertexId }[]
): Ev<'barbarianAttackResolved'> {
  return {
    type: 'barbarianAttackResolved',
    attackStrength,
    defenseStrength,
    result,
    defenderSeat,
    tiedSeats,
    pillaged,
  };
}

export function knightBuilt(seat: Seat, vertex: VertexId, level: KnightLevel): Ev<'knightBuilt'> {
  return { type: 'knightBuilt', seat, vertex, level };
}

export function knightActivated(seat: Seat, vertex: VertexId): Ev<'knightActivated'> {
  return { type: 'knightActivated', seat, vertex };
}

export function knightPromoted(seat: Seat, vertex: VertexId, level: KnightLevel): Ev<'knightPromoted'> {
  return { type: 'knightPromoted', seat, vertex, level };
}

export function knightMoved(seat: Seat, from: VertexId, to: VertexId): Ev<'knightMoved'> {
  return { type: 'knightMoved', seat, from, to };
}

export function knightDisplaced(
  seat: Seat,
  from: VertexId,
  to: VertexId,
  displacedSeat: Seat,
  displacedTo: VertexId | null
): Ev<'knightDisplaced'> {
  return { type: 'knightDisplaced', seat, from, to, displacedSeat, displacedTo };
}

// ---- Cities & Knights progress cards (T-804, docs/rules/cities-knights-rules.md C6) -----------

export function progressCardDrawn(seat: Seat, track: ImprovementTrack, card: ProgressCardId): Ev<'progressCardDrawn'> {
  return { type: 'progressCardDrawn', seat, track, card };
}

export function progressCardRevealed(seat: Seat, card: 'printer' | 'constitution'): Ev<'progressCardRevealed'> {
  return { type: 'progressCardRevealed', seat, card };
}

export function progressCardDiscarded(seat: Seat, card: ProgressCardId): Ev<'progressCardDiscarded'> {
  return { type: 'progressCardDiscarded', seat, card };
}

export function progressCardPlayed(seat: Seat, card: ProgressCardId, detail?: unknown): Ev<'progressCardPlayed'> {
  return detail === undefined
    ? { type: 'progressCardPlayed', seat, card }
    : { type: 'progressCardPlayed', seat, card, detail };
}

export function progressCardsTransferred(
  from: Seat,
  to: Seat,
  resources: ResourceBundle,
  commodities: Partial<Record<Commodity, number>>
): Ev<'progressCardsTransferred'> {
  return { type: 'progressCardsTransferred', from, to, resources, commodities };
}

export function progressCardTaken(from: Seat, to: Seat, card: ProgressCardId): Ev<'progressCardTaken'> {
  return { type: 'progressCardTaken', from, to, card };
}

export function merchantPlaced(seat: Seat, hex: HexId): Ev<'merchantPlaced'> {
  return { type: 'merchantPlaced', seat, hex };
}

export function cityWallBuilt(seat: Seat, vertex: VertexId): Ev<'cityWallBuilt'> {
  return { type: 'cityWallBuilt', seat, vertex };
}

export function knightRemoved(seat: Seat, vertex: VertexId): Ev<'knightRemoved'> {
  return { type: 'knightRemoved', seat, vertex };
}

export function roadRemoved(seat: Seat, edge: EdgeId, rebuilt: boolean): Ev<'roadRemoved'> {
  return { type: 'roadRemoved', seat, edge, rebuilt };
}

export function numberTokensSwapped(hexA: HexId, hexB: HexId): Ev<'numberTokensSwapped'> {
  return { type: 'numberTokensSwapped', hexA, hexB };
}

export function commodityMonopolyResolved(
  seat: Seat,
  commodity: Commodity,
  taken: { seat: Seat; count: number }[]
): Ev<'commodityMonopolyResolved'> {
  return { type: 'commodityMonopolyResolved', seat, commodity, taken };
}

// ---- "The Helpers of Hexhaven" modifier (T-905) ---------------------------------------------------

export function helperDealt(seat: Seat, helper: Ev<'helperDealt'>['helper']): Ev<'helperDealt'> {
  return { type: 'helperDealt', seat, helper };
}

export function helperUsed(
  seat: Seat,
  helper: Ev<'helperUsed'>['helper'],
  side: 'A' | 'B',
  detail?: unknown
): Ev<'helperUsed'> {
  return detail === undefined
    ? { type: 'helperUsed', seat, helper, side }
    : { type: 'helperUsed', seat, helper, side, detail };
}

export function helperSwapped(
  seat: Seat,
  gave: Ev<'helperSwapped'>['gave'],
  took: Ev<'helperSwapped'>['took']
): Ev<'helperSwapped'> {
  return { type: 'helperSwapped', seat, gave, took };
}

// ---- Traders & Barbarians — Fishermen (T-1002, docs/rules/traders-barbarians-rules.md §TB2) -----

export function fishProduced(gains: { seat: Seat; amount: number }[]): Ev<'fishProduced'> {
  return { type: 'fishProduced', gains };
}

export function oldBootAwarded(seat: Seat): Ev<'oldBootAwarded'> {
  return { type: 'oldBootAwarded', seat };
}

export function oldBootPassed(from: Seat, to: Seat): Ev<'oldBootPassed'> {
  return { type: 'oldBootPassed', from, to };
}

export function fishExchanged(
  seat: Seat,
  benefit: FishBenefit,
  cost: number,
  detail?: unknown
): Ev<'fishExchanged'> {
  return detail === undefined
    ? { type: 'fishExchanged', seat, benefit, cost }
    : { type: 'fishExchanged', seat, benefit, cost, detail };
}

// ---- Traders & Barbarians — Rivers (T-1003, docs/rules/traders-barbarians-rules.md §TB3) --------

export function bridgeBuilt(seat: Seat, edge: EdgeId): Ev<'bridgeBuilt'> {
  return { type: 'bridgeBuilt', seat, edge };
}

export function coinsAwarded(seat: Seat, amount: number, source: 'shore' | 'bridge'): Ev<'coinsAwarded'> {
  return { type: 'coinsAwarded', seat, amount, source };
}

export function coinsTraded(
  seat: Seat,
  gave: number,
  received: ResourceType,
  rate: 2 | 4
): Ev<'coinsTraded'> {
  return { type: 'coinsTraded', seat, gave, received, rate };
}

// ---- Traders & Barbarians — Caravans (T-1004, docs/rules/traders-barbarians-rules.md §TB4) ------

export function caravanVoteOpened(builder: Seat, pending: Seat[]): Ev<'caravanVoteOpened'> {
  return { type: 'caravanVoteOpened', builder, pending };
}

export function caravanVoteCast(seat: Seat, bid: number): Ev<'caravanVoteCast'> {
  return { type: 'caravanVoteCast', seat, bid };
}

export function caravanVoteResolved(winner: Seat | null): Ev<'caravanVoteResolved'> {
  return { type: 'caravanVoteResolved', winner };
}

export function camelPlaced(seat: Seat, edge: EdgeId): Ev<'camelPlaced'> {
  return { type: 'camelPlaced', seat, edge };
}

// ---- Traders & Barbarians — Barbarian Attack (T-1005, docs/rules/traders-barbarians-rules.md §TB5) ----

export function tbKnightRecruited(seat: Seat, edge: EdgeId): Ev<'tbKnightRecruited'> {
  return { type: 'tbKnightRecruited', seat, edge };
}

export function tbKnightMoved(seat: Seat, from: EdgeId, to: EdgeId, extended: boolean): Ev<'tbKnightMoved'> {
  return { type: 'tbKnightMoved', seat, from, to, extended };
}

export function tbBarbariansAdvanced(moves: { from: HexId; to: HexId }[]): Ev<'tbBarbariansAdvanced'> {
  return { type: 'tbBarbariansAdvanced', moves };
}

export function tbBarbarianCombatResolved(
  hex: HexId,
  barbariansDefeated: number,
  rewards: { seat: Seat; captured: boolean; gold: number }[]
): Ev<'tbBarbarianCombatResolved'> {
  return { type: 'tbBarbarianCombatResolved', hex, barbariansDefeated, rewards };
}

export function tbBarbarianPillaged(
  hex: HexId,
  seat: Seat,
  vertex: VertexId,
  downgraded: 'city' | 'settlement',
  knightsLost: { seat: Seat; edge: EdgeId; gold: number }[]
): Ev<'tbBarbarianPillaged'> {
  return { type: 'tbBarbarianPillaged', hex, seat, vertex, downgraded, knightsLost };
}

export function tbBarbarianDispersed(hex: HexId): Ev<'tbBarbarianDispersed'> {
  return { type: 'tbBarbarianDispersed', hex };
}

// ---- Traders & Barbarians — the main scenario (T-1006, docs/rules/traders-barbarians-rules.md
// §TB6) -------------------------------------------------------------------------------------

export function tbWagonPlaced(seat: Seat, vertex: VertexId): Ev<'tbWagonPlaced'> {
  return { type: 'tbWagonPlaced', seat, vertex };
}

export function tbWagonMoved(
  seat: Seat,
  wagon: number,
  path: EdgeId[],
  mpSpent: number,
  loaded?: Ev<'tbWagonMoved'>['loaded']
): Ev<'tbWagonMoved'> {
  return loaded === undefined
    ? { type: 'tbWagonMoved', seat, wagon, path, mpSpent }
    : { type: 'tbWagonMoved', seat, wagon, path, mpSpent, loaded };
}

export function tbCommodityProduced(
  hex: HexId,
  gains: Ev<'tbCommodityProduced'>['gains']
): Ev<'tbCommodityProduced'> {
  return { type: 'tbCommodityProduced', hex, gains };
}

export function tbDeliveryCompleted(
  seat: Seat,
  hex: HexId,
  kind: Ev<'tbDeliveryCompleted'>['kind'],
  gained: Ev<'tbDeliveryCompleted'>['gained'],
  gold: number
): Ev<'tbDeliveryCompleted'> {
  return { type: 'tbDeliveryCompleted', seat, hex, kind, gained, gold };
}

// ---- Explorers & Pirates — ship movement + crew/cargo (T-1102, docs/rules/
// explorers-pirates-rules.md §EP3) ---------------------------------------------------------------

export function epShipBuilt(seat: Seat, edge: EdgeId): Ev<'epShipBuilt'> {
  return { type: 'epShipBuilt', seat, edge };
}

export function epShipMoved(seat: Seat, from: EdgeId, to: EdgeId): Ev<'epShipMoved'> {
  return { type: 'epShipMoved', seat, from, to };
}

export function epCargoLoaded(seat: Seat, ship: EdgeId, piece: EPCargo): Ev<'epCargoLoaded'> {
  return { type: 'epCargoLoaded', seat, ship, piece };
}

export function epCargoUnloaded(seat: Seat, ship: EdgeId, piece: EPCargo): Ev<'epCargoUnloaded'> {
  return { type: 'epCargoUnloaded', seat, ship, piece };
}

// ---- Explorers & Pirates — exploration + fog (T-1103, docs/rules/explorers-pirates-rules.md
// §EP5/§EP12.4) -----------------------------------------------------------------------------------

export function epTileRevealed(seat: Seat, hex: HexId, tile: EPTile): Ev<'epTileRevealed'> {
  return { type: 'epTileRevealed', seat, hex, tile };
}

// ---- Explorers & Pirates — settlers, founding & harbor settlements (T-1104, docs/rules/
// explorers-pirates-rules.md §EP4) -----------------------------------------------------------------

export function epSettlerBuilt(seat: Seat): Ev<'epSettlerBuilt'> {
  return { type: 'epSettlerBuilt', seat };
}

export function epSettlementFounded(seat: Seat, vertex: VertexId): Ev<'epSettlementFounded'> {
  return { type: 'epSettlementFounded', seat, vertex };
}

export function epHarborSettlementBuilt(seat: Seat, vertex: VertexId): Ev<'epHarborSettlementBuilt'> {
  return { type: 'epHarborSettlementBuilt', seat, vertex };
}

// ---- Explorers & Pirates — crews & the Pirate Lairs mission (T-1105, docs/rules/
// explorers-pirates-rules.md §EP7) -----------------------------------------------------------------

export function epCrewBuilt(seat: Seat): Ev<'epCrewBuilt'> {
  return { type: 'epCrewBuilt', seat };
}

export function epCrewPlacedOnLair(seat: Seat, hex: HexId): Ev<'epCrewPlacedOnLair'> {
  return { type: 'epCrewPlacedOnLair', seat, hex };
}

export function epLairCaptured(hex: HexId, awards: Ev<'epLairCaptured'>['awards']): Ev<'epLairCaptured'> {
  return { type: 'epLairCaptured', hex, awards };
}

// ---- Explorers & Pirates — fish/spice missions & the gold economy (T-1106, docs/rules/
// explorers-pirates-rules.md §EP6/§EP8/§EP9) -------------------------------------------------------

export function epGoldCompensated(gains: Ev<'epGoldCompensated'>['gains']): Ev<'epGoldCompensated'> {
  return { type: 'epGoldCompensated', gains };
}

export function epGoldShipped(seat: Seat): Ev<'epGoldShipped'> {
  return { type: 'epGoldShipped', seat };
}

export function epFishHauled(seat: Seat, hex: HexId): Ev<'epFishHauled'> {
  return { type: 'epFishHauled', seat, hex };
}

export function epFishDelivered(seat: Seat, vp: number): Ev<'epFishDelivered'> {
  return { type: 'epFishDelivered', seat, vp };
}

export function epSpiceTraded(seat: Seat, hex: HexId): Ev<'epSpiceTraded'> {
  return { type: 'epSpiceTraded', seat, hex };
}

export function epSpiceDelivered(seat: Seat, vp: number, benefit: number): Ev<'epSpiceDelivered'> {
  return { type: 'epSpiceDelivered', seat, vp, benefit };
}
