// Shared types and utilities
export const VERSION = "0.1.0";

// Constants (docs/03 §2)
export type { ResourceType, TerrainType, DevCardType, HarborType, Seat, PlayerColor, ResourceBundle } from './constants.js';
export {
  TERRAIN_RESOURCE,
  TERRAIN_COUNTS,
  TOKEN_SPIRAL,
  HARBOR_MIX,
  BANK_PER_RESOURCE,
  DEV_DECK,
  PIECES_PER_PLAYER,
  COSTS,
  TARGET_VP,
  DISCARD_THRESHOLD,
  LIMITLESS_CAP,
  EXT56_TERRAIN_COUNTS,
  EXT56_TOKEN_SPIRAL,
  EXT56_HARBOR_MIX,
  EXT56_BANK_PER_RESOURCE,
  EXT56_DEV_DECK,
  CK_TARGET_VP,
  CK_BARBARIAN_STEPS_TO_ATTACK,
  CK_COMMODITY_SUPPLY,
  CK_KNIGHT_CAP,
  CK_PROGRESS_HAND_LIMIT,
  CK_DISCARD_LIMIT_BASE,
  CK_DISCARD_LIMIT_PER_WALL,
  CK_MAX_WALLS,
  CK_PROGRESS_DECK_COMPOSITION,
  CK_CARD_TRACK,
  ckImprovementCost,
  ckCardDrawEligible,
  ckDeckCards,
} from './constants.js';

// Types (docs/03 §3–§5)
export type {
  HexId,
  VertexId,
  EdgeId,
  GameConfig,
  HexTile,
  PlayerState,
  Phase,
  GameState,
  Action,
  EngineErrorCode,
  GameEvent,
  // T-901 (docs/07 D-034): modifier wire ids/config, orthogonal to the expansion registry above.
  ModifierId,
  ModifierConfig,
  ModifierConfigMap,
  // T-906 (docs/07 D-034 `customConstants`): the broad tunable-constants modifier's config shape.
  CustomConstantsConfig,
  // T-904 (cardMods modifier): the wider dev-card/combo id vocabulary.
  AnyDevCardId,
  CardModDevCardId,
  CardModComboId,
  PlayCardModCardAction,
  PlayCardModComboAction,
  // T-905 ("The Helpers of Hexhaven" modifier).
  HelperId,
  HelperAssignment,
  HelpersExt,
  UseHelperAction,
  SwapHelperAction,
  // T-902 (multi-piece hex framework, docs/07 D-034).
  HexPieceKindId,
  HexPieceInstance,
} from './types.js';

// Bundle helpers (docs/03 §2)
export { bundleTotal, addBundles, subtractBundles, hasAtLeast } from './bundles.js';

// Board geometry (docs/03 §1)
export type {
  BoardLayout,
  BoardGeometry,
  GeometryHex,
  GeometryVertex,
  GeometryEdge,
} from './geometry.js';
export {
  BASE_LAYOUT,
  GEOMETRY,
  EXT56_LAYOUT,
  GEOMETRY_EXT56,
  buildGeometry,
  vertexAdjacentHexes,
  vertexAdjacentVertices,
  vertexEdges,
  edgeEndpoints,
  edgesOfHex,
  verticesOfHex,
} from './geometry.js';

// Seafarers scenario schema + data (docs/rules/seafarers-rules.md, docs/10 §5) — T-701
export type { ScenarioTerrain, PieceKind } from './types.js';

// Cities & Knights data-model scaffolding (docs/rules/cities-knights-rules.md) — T-801/T-803
export type {
  Commodity,
  ImprovementTrack,
  KnightLevel,
  Knight,
  ProgressCardId,
  CitiesKnightsExt,
  EventDieFace,
} from './types.js';
export type {
  ScenarioId,
  HexRegion,
  Cell,
  ScenarioHex,
  ScenarioHarbor,
  ScenarioBoard,
  Scenario,
  ResolvedHarbor,
} from './scenario.js';

// Traders & Barbarians — Fishermen (docs/rules/traders-barbarians-rules.md §TB2) — T-1002
export type { FishBenefit } from './types.js';
// Traders & Barbarians — the main scenario (docs/rules/traders-barbarians-rules.md §TB6) — T-1006
export type { TBCommodity } from './types.js';
// Explorers & Pirates — ship movement + crew/cargo (docs/rules/explorers-pirates-rules.md §EP3) — T-1102
export type { EPCargo } from './types.js';
// Explorers & Pirates — exploration + fog (docs/rules/explorers-pirates-rules.md §EP5/§EP12.4) — T-1103
export type { EPTile } from './types.js';
export {
  SCENARIO_IDS,
  SCENARIOS,
  HEADING_FOR_NEW_SHORES,
  NEW_WORLD,
  THROUGH_THE_DESERT,
  FORGOTTEN_TRIBE,
  SIX_ISLANDS,
  FOG_ISLANDS,
  CLOTH_FOR_HEXHAVEN,
  PIRATE_ISLANDS,
  WONDERS_OF_HEXHAVEN,
  getScenario,
  isScenarioId,
  resolveScenarioHarbors,
} from './scenario.js';

// Board-preset registry (docs/rules/preset-boards-RESEARCH.md §C.3/§D) — T-607
export type { BoardMode, BoardPresetKind, BuildableBoardPresetId, BoardPreset } from './boardPresets.js';
export {
  BOARD_PRESETS,
  boardPresetsForMode,
  getBoardPreset,
  boardModeForExpansions,
  isBuildableBoardPresetId,
  boardPresetScenario,
  isFiveSixOnlyScenario,
} from './boardPresets.js';

// Protocol: zod message & action schemas (docs/02 §5, docs/03 §4) — T-202
export * from './protocol/index.js';
