// @hexhaven/engine public API (docs/02 §4). The testkit is deliberately NOT exported here — it
// ships via the `@hexhaven/engine/testkit` subpath so app code never bundles test factories.
// PHASE_HANDLERS (the registration surface for T-103…T-109) is engine-internal on purpose.

export const ENGINE_VERSION = '0.1.0';

export { hashSeed, nextRand, pickIndex, rollDie, shuffle } from './rng.js';
export { createGame, validateConfig } from './createGame.js';
export { reduce } from './reduce.js';
export type { EngineError, EngineResult, PhaseHandler } from './reduce.js';
export { advanceTurn, handleEndTurn, requireMain, requireRolled } from './turn.js';
export { checkWin, computeVp } from './vp.js';
export type { VpBreakdown } from './vp.js';
// T-906 (docs/07 D-034 "limits + winnability"): the pre-game winnability calculator — pure over a
// `GameConfig`, no board/GameState needed, so the lobby/hot-seat options UI can warn before start.
export { effectiveTargetVp, isConfigWinnable, maxAchievableVp } from './winnability.js';
export type { MaxVpBreakdown, WinnabilityCheck, WinnabilityNote, WinnabilityResult } from './winnability.js';
export * as events from './events.js';
// T-204: server-authoritative redaction (docs/02 §6) — the only place hidden info is stripped.
export { redact, redactEvent } from './redact.js';
export type { OtherPlayerView, OwnPlayerView, PlayerView, PlayerViewEntry, ViewerEvent } from './redact.js';
export {
  legalSetupSettlements,
  legalSetupRoads,
  canRollDice,
  legalRoadEdges,
  legalFreeRoadEdges,
  legalSettlementVertices,
  legalCityVertices,
  buildAffordability,
  bankTradeOptions,
  pendingDiscards,
  legalRobberHexes,
  legalPirateHexes,
  legalHexPieceHexes,
  stealCandidates,
  pirateSteals,
  pendingGoldChoices,
  goldPickCount,
  legalFreeShipEdges,
  // T-705: Seafarers ship interactions need these enumerators in the client (ship build, the
  // two-step move-ship). They already live in legal.ts (re-exported from the seafarers module);
  // this only widens the public API surface — no gameplay change.
  legalShipEdges,
  movableShips,
  shipMoveTargets,
  tradeOfferSummary,
  playableDevCards,
  publicVp,
  ownVp,
} from './legal.js';
export type { TradeOfferSummary, DevCardPlayability, DevCardBlockedReason } from './legal.js';
export { computeProduction } from './rules/production.js';
export { playerHarbors, tradeRate } from './rules/harbors.js';

// Phase-9 play-UI follow-up (cardMods/helpers modifiers, T-904/T-905): the client needs the exact
// same "held + not already played a card this turn + not bought this same turn" (R9.3/R9.4) gate
// the base dev-card play buttons use, to disable a cardMods combo's Play button when one of its two
// component base cards isn't currently playable, without reimplementing this guard a second time
// against `resolveConstants(...).allowDevCardSameTurnPlay` (the `playDevSameTurn` modifier's seam).
export { commonPlayBlockReason } from './phases/devCards.js';

// T-901 (docs/07 D-034): the Modifiers-menu framework's public surface. `resolveModules` is the
// single source of truth for "is this expansion+modifier combination legal" (the server's lobby
// validation calls it directly, mirroring `validateConfig` above); `modifierAvailability` is the
// pure per-modifier gate the client's Modifiers menu greys out invalid choices with.
export { MODIFIER_IDS, MODIFIERS, modifierAvailability, resolveModules } from './modules/index.js';
export type { ModifierAvailability } from './modules/index.js';
// T-902 (multi-piece hex framework): the kind registry's public ids, for a future per-kind picker
// (T-903 widens this beyond just the Wizard).
export { HEX_PIECE_KIND_IDS } from './modules/modifiers/hexPieces/index.js';
export { CUSTOM_CONSTANTS_BOUNDS } from './modules/modifiers/customConstants.js';

// Cities & Knights (T-806): client legal-target enumerators (mirrors the Seafarers ship exports
// above) + the module-detection/track-cost helpers the client needs to gate/build its C&K UI.
export {
  chaseRobberHexTargets,
  chaseRobberKnights,
  diplomatOpenRoads,
  displaceableKnights,
  intrigueTargets,
  isCitiesKnightsState,
  knightDisplaceTargets,
  knightMoveTargets,
  knightPlacementVertices,
  legalKnightVertices,
  merchantHexes,
  movableKnights,
  TRACK_COMMODITY,
  wallEligibleCities,
} from './modules/citiesKnights/index.js';

// T-112: the random-legal-move simulation harness — reused by T-305 (hot-seat), T-204's tests, and
// future bots. `randomBot`/`checkInvariants`/`InvariantViolationError` stay sim-internal (imported
// via relative path by anything inside packages/engine that needs them, e.g. longestRoad.test.ts).
export { simulate } from './sim/runGame.js';
export type { LoggedAction, SimulateResult } from './sim/runGame.js';

// T-410: the strongest-play bot's entry point — fed only the redacted `PlayerView` (T-204/redact.ts
// above), never a full GameState. `search`/`evaluate`/`determinize`/`greedyBaseline` stay ai-internal
// (imported via relative path by T-411 or tests that need them directly).
export { chooseAction, DEFAULT_BUDGET } from './ai/bot.js';
export type { ChooseActionOpts } from './ai/bot.js';
// `enumerateCandidates` lists every legal action for a seat in a given state. The server uses it on
// the REAL state as a safe fallback when a bot's determinized search fails, so a bot bug can never
// hang a live game (apps/server/src/session.ts driveBots).
export { enumerateCandidates } from './ai/candidates.js';

// Traders & Barbarians (T-1008 client UI): scenario registry + client legal-target enumerators +
// display constants + VP helpers, mirroring the Seafarers/C&K exports above. Every export here is a
// PURE re-export of code T-1001…T-1006 already built (no new logic) — the client casts its redacted
// `PlayerView` to `GameState` for these calls (same documented WIRE workaround `actionBarLogic.ts`/
// `ckHelpers.ts` use), which is safe because every field these functions read off `ext.tradersBarbarians`
// is fully public (redact.ts) except fishermen's `fish` (also fully surfaced, §TB8.4).
export {
  TB_SCENARIO_IDS,
  isTBScenarioId,
  SHIPPED_TB_SCENARIOS,
  TB_SCENARIO_SUPPORTS_56,
  FISH_EXCHANGE_COST,
  RIVERS_BRIDGE_COST,
  RIVERS_BRIDGE_COIN_REWARD,
  RIVERS_SHORE_COIN_REWARD,
  RIVERS_COIN_TRADE_RATE_EARLY,
  RIVERS_COIN_TRADE_RATE_LATE,
  RIVERS_RIVER_EDGES,
  RIVERS_SHORE_VERTICES,
  legalBridgeEdges,
  riversCoinTradeRate,
  riversVpFor,
  CARAVANS_CAMEL_SUPPLY,
  CARAVANS_TARGET_VP,
  caravansVpFor,
  legalCamelEdges,
  KNIGHT_COST,
  KNIGHT_MOVE_EXTEND_COST_GRAIN,
  KNIGHT_MOVE_EXTENDED_RANGE,
  KNIGHT_MOVE_RANGE,
  BARBARIAN_GOLD,
  KNIGHT_LOSS_GOLD,
  CAPTURED_VP_DIVISOR,
  barbarianAttackVpFor,
  legalKnightMoveTargets,
  legalKnightRecruitEdges,
  DELIVERY_GOLD,
  TB_COMMODITIES,
  TB_TRADE_RECIPES,
  WAGON_MP_PER_TURN,
  WAGON_MP_NO_ROAD,
  WAGON_MP_ROAD,
  WAGON_MP_BARBARIAN_EXTRA,
  WAGON_TOLL_GOLD,
  legalWagonDestinations,
  tradersBarbariansMainVpFor,
} from './modules/tradersBarbarians/index.js';
export type { TBScenarioId, WagonDestination } from './modules/tradersBarbarians/index.js';

// Explorers & Pirates — Land Ho! client (T-1108): scenario id/gating + client legal-target
// composition primitives + cost/VP constants, mirroring the Seafarers/T&B export blocks above.
// Every export here is a PURE re-export of code T-1101…T-1107 already built (no new logic) — the
// client casts its redacted `PlayerView` to `GameState` for these calls (same documented WIRE
// workaround `tbActionLogic.ts`/`ckActionLogic.ts` use), safe because every field these read off
// `ext.explorersPirates` is fully public (redact.ts) except the exploration SUPPLY (never surfaced
// at all, EP12.4). `satisfiesDistanceRule` (rules/placement.ts) is the one non-E&P-specific addition
// — needed alongside `vertexTouchesDiscoveredLand` to compose `legalFoundSettlementVertices`
// client-side without reimplementing the distance rule (EP4.1's founding has no road/connectivity
// requirement, so the existing `legalSettlementVertices` enumerator doesn't fit).
export {
  EP_SCENARIO_IDS,
  EP_SCENARIO_SUPPORTS_56,
  isEPScenarioId,
  SHIPPED_EP_SCENARIOS,
  EP_LANDHO_TARGET_VP,
  EP_SCENARIO_CONFIG,
  explorersPiratesScenario,
  EP_SHIP_COST,
  EP_MAX_SHIPS_PER_SEAT,
  SHIP_MOVE_RANGE,
  SHIP_CARGO_CAP,
  epShipPlacementError,
  epShipMoveTargets,
  movableEPShips,
  isSeaEdge,
  EP_SETTLER_COST,
  EP_HARBOR_COST,
  EP_HARBOR_SETTLEMENT_VP,
  vertexTouchesDiscoveredLand,
  // T-1150 (Phase 11B): the 5–6 board frame, needed by the client's own `boardGeometryFor`
  // (apps/client/src/board/geometry.ts) so a 5–6 E&P game renders on the RIGHT geometry instead of
  // incidentally falling through to T&B/C&K's shared `GEOMETRY_EXT56` (see that file's own T-1150
  // update).
  LAND_HO_56_GEOMETRY,
  // T-1154 (mission action UI): the three mission cost constants `epActionLogic.ts` needs to gate/
  // display `buildEPCrew`/`tradeSpice`/`shipGold` — pure re-exports, no logic change, same "widen the
  // public API surface" precedent T-1108 set for the rest of this block (EP_SCENARIO_CONFIG/
  // isEPScenarioId above already cover the mission-active check).
  EP_CREW_COST,
  GOLD_PER_VP,
  SPICE_TRADE_COST_GOLD,
} from './modules/explorersPirates/index.js';
export type { EPScenarioId } from './modules/explorersPirates/index.js';
export { satisfiesDistanceRule } from './rules/placement.js';

// Convenience re-exports: the shared types that appear in the engine API signatures.
export type {
  Action,
  EngineErrorCode,
  GameConfig,
  GameEvent,
  GameState,
  HexPieceKindId,
  HexPieceInstance,
  ModifierConfig,
  ModifierConfigMap,
  ModifierId,
  Phase,
  Seat,
} from '@hexhaven/shared';
