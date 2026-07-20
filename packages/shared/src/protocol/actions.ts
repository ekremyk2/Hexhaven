// Zod schemas for the engine Action union (docs/03 §4) — the wire contract the server validates
// a client's intent against before it ever reaches `reduce`. One schema per Action variant,
// combined into a discriminated union `ActionSchema`. A type-level test at the bottom proves
// `z.infer<typeof ActionSchema>` is exactly the hand-written `Action` type from `../types.js` —
// any drift (a variant added/changed on one side and not the other) fails `pnpm -w typecheck`.

import { z } from 'zod';
import { GEOMETRY, GEOMETRY_EXT56, buildGeometry } from '../geometry.js';
import { SCENARIOS } from '../scenario.js';
import type {
  Action,
  CardModComboId,
  CardModDevCardId,
  Commodity,
  EPCargo,
  FishBenefit,
  HelperId,
  HexId,
  HexPieceKindId,
  ImprovementTrack,
  ProgressCardId,
  TBCommodity,
  VertexId,
  EdgeId,
} from '../types.js';
import type { ResourceBundle, ResourceType, Seat } from '../constants.js';

// ---- Shared primitives (also used by messages.ts) --------------------------------------------

// Wire ID bounds cover the LARGEST supported board across EVERY mode — base 19-hex, the 30-hex 5–6
// EXT56 board, AND every Seafarers scenario frame (the biggest today: "Heading for New Shores" 4p =
// 42 hexes / 117 vertices / 158 edges). DERIVED from the geometries (not hardcoded) so a new/larger
// board can never silently regress the cap. A too-small cap rejects valid placements as BAD_ACTION
// for human clients while server-driven bots (which bypass the wire) place fine — that was BUGS.md
// B-17 (EXT56 vs base) and B-25 (Seafarers vs EXT56). This is only a coarse wire sanity bound: the
// ENGINE still gates actual legality against the specific game's geometry + placement rules.
// `.transform` recasts the range-validated raw number into the branded type.
const ALL_GEOMETRIES = [
  GEOMETRY,
  GEOMETRY_EXT56,
  ...Object.values(SCENARIOS).flatMap((s) => Object.values(s.boards).map((b) => buildGeometry(b.layout))),
];
const MAX_HEX_ID = Math.max(...ALL_GEOMETRIES.map((g) => g.hexes.length)) - 1;
const MAX_VERTEX_ID = Math.max(...ALL_GEOMETRIES.map((g) => g.vertices.length)) - 1;
const MAX_EDGE_ID = Math.max(...ALL_GEOMETRIES.map((g) => g.edges.length)) - 1;

export const HexIdSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_HEX_ID)
  .transform((n) => n as HexId);

export const VertexIdSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_VERTEX_ID)
  .transform((n) => n as VertexId);

export const EdgeIdSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_EDGE_ID)
  .transform((n) => n as EdgeId);

export const SeatSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]) satisfies z.ZodType<Seat>;

export const ResourceTypeSchema = z.enum([
  'brick',
  'lumber',
  'wool',
  'grain',
  'ore',
]) satisfies z.ZodType<ResourceType>;

// Cities & Knights (T-802, C3.1/C4.1): the three commodities and improvement tracks.
export const CommoditySchema = z.enum(['paper', 'cloth', 'coin']) satisfies z.ZodType<Commodity>;

export const ImprovementTrackSchema = z.enum([
  'trade',
  'politics',
  'science',
]) satisfies z.ZodType<ImprovementTrack>;

// Cities & Knights (T-804, C6.5): the 25 distinct progress-card names.
export const ProgressCardIdSchema = z.enum([
  'alchemist',
  'crane',
  'engineer',
  'inventor',
  'irrigation',
  'medicine',
  'mining',
  'printer',
  'roadBuilding',
  'smith',
  'merchant',
  'merchantFleet',
  'commercialHarbor',
  'masterMerchant',
  'resourceMonopoly',
  'commodityMonopoly',
  'bishop',
  'constitution',
  'deserter',
  'diplomat',
  'intrigue',
  'saboteur',
  'spy',
  'warlord',
  'wedding',
]) satisfies z.ZodType<ProgressCardId>;

// docs/03 §2: `ResourceBundle = Partial<Record<ResourceType, number>>`; counts >= 1 where present.
// `.strict()` rejects any key outside the 5 resource types ("valid keys only"); `.min(1)` rejects
// zero/negative counts for any key that IS present.
export const ResourceBundleSchema = z
  .object({
    brick: z.number().int().min(1).optional(),
    lumber: z.number().int().min(1).optional(),
    wool: z.number().int().min(1).optional(),
    grain: z.number().int().min(1).optional(),
    ore: z.number().int().min(1).optional(),
  })
  .strict() satisfies z.ZodType<ResourceBundle>;

// ---- One schema per Action variant (docs/03 §4) -----------------------------------------------

export const PlaceSetupSettlementActionSchema = z
  .object({ type: z.literal('placeSetupSettlement'), vertex: VertexIdSchema })
  .strict();

export const PlaceSetupRoadActionSchema = z
  .object({ type: z.literal('placeSetupRoad'), edge: EdgeIdSchema })
  .strict();

export const RollDiceActionSchema = z.object({ type: z.literal('rollDice') }).strict();

export const DiscardActionSchema = z
  .object({ type: z.literal('discard'), cards: ResourceBundleSchema })
  .strict();

export const MoveRobberActionSchema = z
  .object({ type: z.literal('moveRobber'), hex: HexIdSchema })
  .strict();

// Seafarers (S8, T-703): relocate the pirate to a sea hex instead of the robber.
export const MovePirateActionSchema = z
  .object({ type: z.literal('movePirate'), hex: HexIdSchema })
  .strict();

// Multi-piece hex framework (T-902, docs/07 D-034): move-any — a named hex piece INSTEAD of the
// robber, only ever legal while the `hexPieces` modifier is active and the `moveRobber` sub-phase
// is open (the module intercepts it; a game without the modifier rejects it).
export const HexPieceKindIdSchema = z.enum([
  'wizard',
  'trader',
  'robinHood',
  'banker',
  'poaching',
]) satisfies z.ZodType<HexPieceKindId>;

export const MoveHexPieceActionSchema = z
  .object({ type: z.literal('moveHexPiece'), piece: HexPieceKindIdSchema, hex: HexIdSchema })
  .strict();

export const StealActionSchema = z
  .object({ type: z.literal('steal'), from: SeatSchema })
  .strict();

export const BuildRoadActionSchema = z
  .object({ type: z.literal('buildRoad'), edge: EdgeIdSchema })
  .strict();

export const BuildSettlementActionSchema = z
  .object({ type: z.literal('buildSettlement'), vertex: VertexIdSchema })
  .strict();

export const BuildCityActionSchema = z
  .object({ type: z.literal('buildCity'), vertex: VertexIdSchema })
  .strict();

// Seafarers (S4/S7, T-702): a ship placement, or an open-ship relocation carrying both ends.
export const BuildShipActionSchema = z
  .object({ type: z.literal('buildShip'), edge: EdgeIdSchema })
  .strict();

export const MoveShipActionSchema = z
  .object({ type: z.literal('moveShip'), from: EdgeIdSchema, to: EdgeIdSchema })
  .strict();

// Seafarers gold (S9/ER-S7, T-703): a player's free-resource choice during `chooseGoldResource`.
export const ChooseGoldResourceActionSchema = z
  .object({ type: z.literal('chooseGoldResource'), picks: ResourceBundleSchema })
  .strict();

export const BuyDevCardActionSchema = z.object({ type: z.literal('buyDevCard') }).strict();

export const PlayKnightActionSchema = z.object({ type: z.literal('playKnight') }).strict();

export const PlayRoadBuildingActionSchema = z
  .object({ type: z.literal('playRoadBuilding') })
  .strict();

export const PlaceFreeRoadActionSchema = z
  .object({ type: z.literal('placeFreeRoad'), edge: EdgeIdSchema })
  .strict();

// Seafarers (S11.1, T-703): a free SHIP placement during Road Building.
export const PlaceFreeShipActionSchema = z
  .object({ type: z.literal('placeFreeShip'), edge: EdgeIdSchema })
  .strict();

// `extra` (T-906, docs/07 D-034 `customConstants.yearOfPlentyCount`) is ADDITIVE-ONLY: absent for
// every base/default (count 2) submission, so the wire shape stays bit-identical there (RK-13).
export const PlayYearOfPlentyActionSchema = z
  .object({
    type: z.literal('playYearOfPlenty'),
    a: ResourceTypeSchema,
    b: ResourceTypeSchema,
    extra: z.array(ResourceTypeSchema).optional(),
  })
  .strict();

export const PlayMonopolyActionSchema = z
  .object({ type: z.literal('playMonopoly'), resource: ResourceTypeSchema })
  .strict();

export const BankTradeActionSchema = z
  .object({ type: z.literal('bankTrade'), give: ResourceTypeSchema, receive: ResourceTypeSchema })
  .strict();

export const OfferTradeActionSchema = z
  .object({
    type: z.literal('offerTrade'),
    give: ResourceBundleSchema,
    receive: ResourceBundleSchema,
  })
  .strict();

export const RespondTradeActionSchema = z
  .object({
    type: z.literal('respondTrade'),
    response: z.union([z.literal('accept'), z.literal('decline')]),
  })
  .strict();

export const ConfirmTradeActionSchema = z
  .object({ type: z.literal('confirmTrade'), with: SeatSchema })
  .strict();

export const CancelTradeActionSchema = z.object({ type: z.literal('cancelTrade') }).strict();

export const EndTurnActionSchema = z.object({ type: z.literal('endTurn') }).strict();

// 5–6 extension (X12, T-602): the extra builder yields — ends an SBP special-build turn or a
// Paired-Players partial turn. No payload.
export const PassSpecialBuildActionSchema = z.object({ type: z.literal('passSpecialBuild') }).strict();

// Cities & Knights (T-802, C4.1/C4.2): advance one city-improvement track by one level.
export const BuildImprovementActionSchema = z
  .object({ type: z.literal('buildImprovement'), track: ImprovementTrackSchema })
  .strict();

// Cities & Knights (T-802, C4.5 Trading House / base 4:1): a commodity bank trade.
export const CommodityBankTradeActionSchema = z
  .object({
    type: z.literal('commodityBankTrade'),
    give: CommoditySchema,
    receive: z.union([ResourceTypeSchema, CommoditySchema]),
  })
  .strict();

// Cities & Knights knights/barbarians (T-803, C7).
export const BuildKnightActionSchema = z
  .object({ type: z.literal('buildKnight'), vertex: VertexIdSchema })
  .strict();

export const ActivateKnightActionSchema = z
  .object({ type: z.literal('activateKnight'), vertex: VertexIdSchema })
  .strict();

export const PromoteKnightActionSchema = z
  .object({ type: z.literal('promoteKnight'), vertex: VertexIdSchema })
  .strict();

export const MoveKnightActionSchema = z
  .object({ type: z.literal('moveKnight'), from: VertexIdSchema, to: VertexIdSchema })
  .strict();

export const KnightDisplaceActionSchema = z
  .object({ type: z.literal('knightDisplace'), from: VertexIdSchema, to: VertexIdSchema })
  .strict();

export const ChaseRobberActionSchema = z
  .object({
    type: z.literal('chaseRobber'),
    knightVertex: VertexIdSchema,
    toHex: HexIdSchema,
    stealFrom: SeatSchema.optional(),
  })
  .strict();

// Cities & Knights (T-804, C9.1): a direct city-wall build (2 brick); Engineer builds one free via
// `playProgressCard` instead.
export const BuildCityWallActionSchema = z
  .object({ type: z.literal('buildCityWall'), vertex: VertexIdSchema })
  .strict();

// Cities & Knights progress cards (T-804, C6.4/C6.5): one flat schema covering every card's
// optional parameters — see the `Action` union member in types.ts for the field-by-card mapping.
const ResourceOrCommoditySchema = z.union([ResourceTypeSchema, CommoditySchema]);

export const PlayProgressCardActionSchema = z
  .object({
    type: z.literal('playProgressCard'),
    card: ProgressCardIdSchema,
    yellowDie: z.number().int().min(1).max(6).optional(),
    redDie: z.number().int().min(1).max(6).optional(),
    track: ImprovementTrackSchema.optional(),
    vertex: VertexIdSchema.optional(),
    hex: HexIdSchema.optional(),
    hexA: HexIdSchema.optional(),
    hexB: HexIdSchema.optional(),
    give: ResourceOrCommoditySchema.optional(),
    receive: ResourceOrCommoditySchema.optional(),
    resource: ResourceTypeSchema.optional(),
    commodity: CommoditySchema.optional(),
    targetSeat: SeatSchema.optional(),
    targetVertex: VertexIdSchema.optional(),
    targetCard: ProgressCardIdSchema.optional(),
    // Spy (T-806): positional card selection when the client can't see the target's hidden hand.
    targetCardIndex: z.number().int().min(0).optional(),
    edge: EdgeIdSchema.optional(),
  })
  .strict();

// Spy peek reveal (redact.ts hidden-info UX fix, C6.5): the "begin" half of a two-step Spy play —
// see the `Action` union member in types.ts for the full contract.
export const PeekSpyTargetActionSchema = z
  .object({ type: z.literal('peekSpyTarget'), targetSeat: SeatSchema })
  .strict();

// ---- cardMods modifier (T-904, docs/tasks/modifiers-cards-RESEARCH.md) -----------------------

export const CardModDevCardIdSchema = z.enum([
  'bumperCrop',
  'merchantsBoon',
  'roadToll',
  'trailblazer',
  'windfall',
  'highwayman',
]) satisfies z.ZodType<CardModDevCardId>;

export const CardModComboIdSchema = z.enum([
  'rideByNight',
  'nightOfPlenty',
  'monorail',
  'megaKnight',
  'superSettle',
]) satisfies z.ZodType<CardModComboId>;

export const PlayCardModCardActionSchema = z
  .object({
    type: z.literal('playCardModCard'),
    card: CardModDevCardIdSchema,
    give: ResourceTypeSchema.optional(),
    receive: ResourceTypeSchema.optional(),
    resource: ResourceTypeSchema.optional(),
    edge: EdgeIdSchema.optional(),
    hex: HexIdSchema.optional(),
  })
  .strict();

export const PlayCardModComboActionSchema = z
  .object({
    type: z.literal('playCardModCombo'),
    combo: CardModComboIdSchema,
    resource: ResourceTypeSchema.optional(),
    edge: EdgeIdSchema.optional(),
    edges: z.array(EdgeIdSchema).optional(),
    hex: HexIdSchema.optional(),
    vertex: VertexIdSchema.optional(),
    targetSeat: SeatSchema.optional(),
  })
  .strict();

// ---- "The Helpers of Hexhaven" modifier (T-905, docs/tasks/modifiers-helpers-RESEARCH.md) --------

export const HelperIdSchema = z.enum([
  'mayor',
  'general',
  'explorer',
  'mendicant',
  'robberBride',
  'merchant',
  'captain',
  'noblewoman',
  'architect',
  'priest',
]) satisfies z.ZodType<HelperId>;

// `Partial<Record<Seat, ResourceType>>` — one optional field per seat number (Merchant's giveBack).
const SeatResourceMapSchema = z
  .object({
    0: ResourceTypeSchema.optional(),
    1: ResourceTypeSchema.optional(),
    2: ResourceTypeSchema.optional(),
    3: ResourceTypeSchema.optional(),
    4: ResourceTypeSchema.optional(),
    5: ResourceTypeSchema.optional(),
  })
  .strict();

// Each `useHelper` variant shares `type: 'useHelper'` but is discriminated by `helper` — nested as
// its OWN discriminated union (below) rather than as 9 top-level entries in the outer
// `z.discriminatedUnion('type', …)`, which requires distinct top-level discriminator values.
const UseHelperMayorActionSchema = z
  .object({ type: z.literal('useHelper'), helper: z.literal('mayor'), resource: ResourceTypeSchema })
  .strict();
const UseHelperExplorerActionSchema = z
  .object({ type: z.literal('useHelper'), helper: z.literal('explorer'), from: EdgeIdSchema, to: EdgeIdSchema })
  .strict();
const UseHelperMendicantActionSchema = z
  .object({
    type: z.literal('useHelper'),
    helper: z.literal('mendicant'),
    edge: EdgeIdSchema,
    replace: ResourceTypeSchema,
    substitute: ResourceTypeSchema,
  })
  .strict();
const UseHelperRobberBrideActionSchema = z
  .object({ type: z.literal('useHelper'), helper: z.literal('robberBride'), target: SeatSchema.optional() })
  .strict();
const UseHelperMerchantActionSchema = z
  .object({
    type: z.literal('useHelper'),
    helper: z.literal('merchant'),
    targets: z.array(SeatSchema),
    demand: ResourceTypeSchema,
    giveBack: SeatResourceMapSchema,
  })
  .strict();
const UseHelperCaptainActionSchema = z
  .object({ type: z.literal('useHelper'), helper: z.literal('captain'), resource: ResourceTypeSchema })
  .strict();
const UseHelperNoblewomanActionSchema = z
  .object({ type: z.literal('useHelper'), helper: z.literal('noblewoman'), target: SeatSchema })
  .strict();
// Architect peek reveal (redact.ts hidden-info UX fix): two mutually-exclusive shapes, both under
// `helper: 'architect'` — since zod's `discriminatedUnion` forbids duplicate discriminator values
// across its members, these are combined via a plain `z.union` below (same precedent as the outer
// `ActionSchema`'s `z.union([discriminatedUnion, UseHelperActionSchema])`), not folded into the
// `helper`-discriminated union alongside the other 8.
const UseHelperArchitectBeginActionSchema = z
  .object({ type: z.literal('useHelper'), helper: z.literal('architect'), beginPeek: z.literal(true) })
  .strict();
const UseHelperArchitectCommitActionSchema = z
  .object({
    type: z.literal('useHelper'),
    helper: z.literal('architect'),
    beginPeek: z.literal(false).optional(),
    pick: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    replace: ResourceTypeSchema,
    substitute: ResourceTypeSchema,
  })
  .strict();
const UseHelperPriestActionSchema = z
  .object({
    type: z.literal('useHelper'),
    helper: z.literal('priest'),
    build: z.union([z.literal('settlement'), z.literal('city')]),
    vertex: VertexIdSchema,
  })
  .strict();

export const UseHelperActionSchema = z.union([
  z.discriminatedUnion('helper', [
    UseHelperMayorActionSchema,
    UseHelperExplorerActionSchema,
    UseHelperMendicantActionSchema,
    UseHelperRobberBrideActionSchema,
    UseHelperMerchantActionSchema,
    UseHelperCaptainActionSchema,
    UseHelperNoblewomanActionSchema,
    UseHelperPriestActionSchema,
  ]),
  UseHelperArchitectBeginActionSchema,
  UseHelperArchitectCommitActionSchema,
]);

export const SwapHelperActionSchema = z
  .object({ type: z.literal('swapHelper'), take: HelperIdSchema })
  .strict();

// ---- Traders & Barbarians — Fishermen (T-1002, docs/rules/traders-barbarians-rules.md §TB2) ----

export const FishBenefitSchema = z.enum([
  'removeRobber',
  'steal',
  'bankResource',
  'freeRoad',
  'devCard',
]) satisfies z.ZodType<FishBenefit>;

export const ExchangeFishActionSchema = z
  .object({
    type: z.literal('exchangeFish'),
    benefit: FishBenefitSchema,
    from: SeatSchema.optional(),
    resource: ResourceTypeSchema.optional(),
    edge: EdgeIdSchema.optional(),
  })
  .strict();

export const PassOldBootActionSchema = z
  .object({ type: z.literal('passOldBoot'), to: SeatSchema })
  .strict();

// ---- Traders & Barbarians — Rivers (T-1003, docs/rules/traders-barbarians-rules.md §TB3) -------

export const BuildBridgeActionSchema = z
  .object({ type: z.literal('buildBridge'), edge: EdgeIdSchema })
  .strict();

export const TradeCoinsActionSchema = z
  .object({
    type: z.literal('tradeCoins'),
    give: z.number().int().min(1),
    receive: ResourceTypeSchema,
  })
  .strict();

// ---- Traders & Barbarians — Caravans (T-1004, docs/rules/traders-barbarians-rules.md §TB4) ------

export const CaravanVoteActionSchema = z
  .object({
    type: z.literal('caravanVote'),
    grain: z.number().int().min(0),
    wool: z.number().int().min(0),
  })
  .strict();

export const PlaceCamelActionSchema = z
  .object({ type: z.literal('placeCamel'), edge: EdgeIdSchema })
  .strict();

// ---- Traders & Barbarians — Barbarian Attack (T-1005, docs/rules/traders-barbarians-rules.md
// §TB5) --------------------------------------------------------------------------------------

export const RecruitKnightActionSchema = z
  .object({ type: z.literal('recruitKnight'), edge: EdgeIdSchema })
  .strict();

export const MoveBarbarianKnightActionSchema = z
  .object({
    type: z.literal('moveBarbarianKnight'),
    from: EdgeIdSchema,
    to: EdgeIdSchema,
    extended: z.boolean().optional(),
  })
  .strict();

// ---- Traders & Barbarians — the main scenario (T-1006, docs/rules/traders-barbarians-rules.md
// §TB6) --------------------------------------------------------------------------------------

export const TBCommoditySchema = z.enum([
  'marble',
  'glass',
  'sand',
  'tools',
]) satisfies z.ZodType<TBCommodity>;

export const MoveWagonActionSchema = z
  .object({
    type: z.literal('moveWagon'),
    wagon: z.number().int().min(0),
    path: z.array(EdgeIdSchema),
    load: TBCommoditySchema.optional(),
  })
  .strict();

// ---- Explorers & Pirates — ship movement + crew/cargo (T-1102, docs/rules/
// explorers-pirates-rules.md §EP3) --------------------------------------------------------------

export const EPCargoSchema = z.enum([
  'crew',
  'settler',
  'fish',
  'spice',
]) satisfies z.ZodType<EPCargo>;

export const BuildEPShipActionSchema = z
  .object({ type: z.literal('buildEPShip'), edge: EdgeIdSchema })
  .strict();

export const MoveEPShipActionSchema = z
  .object({ type: z.literal('moveEPShip'), from: EdgeIdSchema, to: EdgeIdSchema })
  .strict();

export const LoadCargoActionSchema = z
  .object({ type: z.literal('loadCargo'), ship: EdgeIdSchema, piece: EPCargoSchema })
  .strict();

export const UnloadCargoActionSchema = z
  .object({ type: z.literal('unloadCargo'), ship: EdgeIdSchema, piece: EPCargoSchema })
  .strict();

// ---- Explorers & Pirates — settlers, founding & harbor settlements (T-1104, docs/rules/
// explorers-pirates-rules.md §EP4) ----------------------------------------------------------------

export const BuildEPSettlerActionSchema = z.object({ type: z.literal('buildEPSettler') }).strict();

export const FoundSettlementActionSchema = z
  .object({ type: z.literal('foundSettlement'), vertex: VertexIdSchema })
  .strict();

export const UpgradeToHarborActionSchema = z
  .object({ type: z.literal('upgradeToHarbor'), vertex: VertexIdSchema })
  .strict();

// ---- Explorers & Pirates — crews & the Pirate Lairs mission (T-1105, docs/rules/
// explorers-pirates-rules.md §EP7) ------------------------------------------------------------

export const BuildEPCrewActionSchema = z.object({ type: z.literal('buildEPCrew') }).strict();

export const PlaceCrewOnLairActionSchema = z
  .object({ type: z.literal('placeCrewOnLair'), hex: HexIdSchema })
  .strict();

// ---- Explorers & Pirates — fish/spice missions & the gold economy (T-1106, docs/rules/
// explorers-pirates-rules.md §EP6/§EP8/§EP9) ---------------------------------------------------

export const ShipGoldActionSchema = z.object({ type: z.literal('shipGold') }).strict();

export const TradeSpiceActionSchema = z
  .object({ type: z.literal('tradeSpice'), hex: HexIdSchema })
  .strict();

export const DeliverFishActionSchema = z.object({ type: z.literal('deliverFish') }).strict();

export const DeliverSpiceActionSchema = z.object({ type: z.literal('deliverSpice') }).strict();

// ---- Discriminated union ------------------------------------------------------------------

// `useHelper`'s 9 variants all share `type: 'useHelper'` and are discriminated by `helper` instead
// (see `UseHelperActionSchema` above) — zod's `discriminatedUnion` requires each top-level entry's
// discriminator value to be distinct, so the overall schema is a plain union of the big
// `type`-discriminated union (every other action, incl. `swapHelper`/the two cardMods actions) and
// the nested `helper`-discriminated one. `z.infer` of a `z.union` is still exactly the flattened
// member-type union, so the `ActionSchemaMatchesAction` contract test below is unaffected by this
// being a `union` rather than a single `discriminatedUnion`.
export const ActionSchema = z.union([
  z.discriminatedUnion('type', [
  PlaceSetupSettlementActionSchema,
  PlaceSetupRoadActionSchema,
  RollDiceActionSchema,
  DiscardActionSchema,
  MoveRobberActionSchema,
  MovePirateActionSchema,
  MoveHexPieceActionSchema,
  StealActionSchema,
  BuildRoadActionSchema,
  BuildSettlementActionSchema,
  BuildCityActionSchema,
  BuildShipActionSchema,
  MoveShipActionSchema,
  ChooseGoldResourceActionSchema,
  BuyDevCardActionSchema,
  PlayKnightActionSchema,
  PlayRoadBuildingActionSchema,
  PlaceFreeRoadActionSchema,
  PlaceFreeShipActionSchema,
  PlayYearOfPlentyActionSchema,
  PlayMonopolyActionSchema,
  BankTradeActionSchema,
  OfferTradeActionSchema,
  RespondTradeActionSchema,
  ConfirmTradeActionSchema,
  CancelTradeActionSchema,
  EndTurnActionSchema,
  PassSpecialBuildActionSchema,
  BuildImprovementActionSchema,
  CommodityBankTradeActionSchema,
  BuildKnightActionSchema,
  ActivateKnightActionSchema,
  PromoteKnightActionSchema,
  MoveKnightActionSchema,
  KnightDisplaceActionSchema,
  ChaseRobberActionSchema,
  BuildCityWallActionSchema,
  PlayProgressCardActionSchema,
  PeekSpyTargetActionSchema,
    PlayCardModCardActionSchema,
    PlayCardModComboActionSchema,
    SwapHelperActionSchema,
    ExchangeFishActionSchema,
    PassOldBootActionSchema,
    BuildBridgeActionSchema,
    TradeCoinsActionSchema,
    CaravanVoteActionSchema,
    PlaceCamelActionSchema,
    RecruitKnightActionSchema,
    MoveBarbarianKnightActionSchema,
    MoveWagonActionSchema,
    BuildEPShipActionSchema,
    MoveEPShipActionSchema,
    LoadCargoActionSchema,
    UnloadCargoActionSchema,
    BuildEPSettlerActionSchema,
    FoundSettlementActionSchema,
    UpgradeToHarborActionSchema,
    BuildEPCrewActionSchema,
    PlaceCrewOnLairActionSchema,
    ShipGoldActionSchema,
    TradeSpiceActionSchema,
    DeliverFishActionSchema,
    DeliverSpiceActionSchema,
  ]),
  UseHelperActionSchema,
]);

// ---- Type-level contract test ------------------------------------------------------------

// Standard "same type" probe (distributive-conditional trick): true iff A and B are mutually
// assignable in a way that also catches optionality/union-member differences plain `extends`
// assignability checks can miss. Exported for reuse by other protocol contract tests.
export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
export type Expect<T extends true> = T;

// If a variant is added/removed/reshaped in `Action` (types.ts) without a matching update here
// (or vice versa), this line fails to typecheck and `pnpm -w typecheck` fails the build.
export type ActionSchemaMatchesAction = Expect<Equal<z.infer<typeof ActionSchema>, Action>>;
