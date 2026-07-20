// Explorers & Pirates ext-state helpers (T-1102, docs/rules/explorers-pirates-rules.md §EP3/
// §EP12.2). Mirrors modules/seafarers/state.ts and modules/tradersBarbarians/state.ts: all E&P
// scenario data lives under `state.ext.explorersPirates` so base fields never change meaning; these
// thin accessors are the single read/write surface. Every accessor is a no-op / empty outside a live
// E&P game.
//
// `isExplorersPiratesState` gates on ext PRESENCE, not `state.config.expansions.explorersPirates` —
// deliberately, since `resolveModules` (modules/index.ts) rejects EVERY E&P scenario id today
// (`SHIPPED_EP_SCENARIOS` stays empty until T-1107's Land Ho!, docs/rules/explorers-pirates-rules.md
// §EP13's build order). A config-toggle check would make this whole subsystem untestable before a
// scenario ships; T-1102's tests instead craft `ext.explorersPirates` directly (testkit +
// `buildLandHoBoardV0`, board.ts) and call the handlers below without going through `reduce`'s
// `activeModules` gate — exactly the same shape `interceptAction` will use once T-1107 wires a real
// scenario into `createGame`.

import type { EdgeId, EPCargo, GameConfig, GameState, HexId, ScenarioTerrain, Seat, VertexId } from '@hexhaven/shared';

type EPExt = NonNullable<NonNullable<GameState['ext']>['explorersPirates']>;

/** The E&P ext block, or `undefined` outside a live E&P game. */
export function epExt(state: GameState): EPExt | undefined {
  return state.ext?.explorersPirates;
}

// ---- Scenario registry + per-scenario mission config (T-1101/T-1111, moved here from index.ts by
// T-1110) --------------------------------------------------------------------------------------------
//
// T-1110 needs this lookup INSIDE ships.ts/goldFishSpice.ts (to gate `haulFishOnArrival`/
// `deliverFishHandler`/`deliverSpiceHandler` on the scenario's own mission flags — the fish/spice
// cross-mission-leak fix, those files' own headers) — but both files are imported BY index.ts
// (`explorersPiratesIntercept`'s routing table), so importing this config back FROM index.ts would be
// a module cycle. `state.ts` imports from neither of them (only `@hexhaven/shared` types), so it's the
// natural shared home; `index.ts` now imports this from here too and re-exports the same public names
// unchanged — no external call site (createGame.ts/vp.ts/sim/bot.ts) needed to change its own import
// path.

/** Every declared E&P scenario id (EP1.1). A new scenario adds its id here + `ExplorersPiratesExt`
 *  fields (packages/shared) + its engine task. `⚠ VERIFY` the exact shipped set/names against the
 *  rulebook; ordered intro → full campaign. */
export const EP_SCENARIO_IDS = [
  'landHo',
  'fishForHexhaven',
  'spicesForHexhaven',
  'pirateLairs',
  'fullCampaign',
] as const;

export type EPScenarioId = (typeof EP_SCENARIO_IDS)[number];

/** Which E&P scenarios are BUILT + playable today. `landHo` (T-1107, the intro scenario — movement
 *  + exploration + founding, 8-VP win, no missions) shipped first, exactly as EP13's build order
 *  planned; `fishForHexhaven` (T-1111, Land Ho!'s frame + the fish mission ON) shipped second;
 *  `spicesForHexhaven` (T-1112, that same frame + the spice mission ON) shipped third; `pirateLairs`
 *  (T-1113, that same frame + the pirateLairs mission ON) shipped fourth; `fullCampaign` (T-1114,
 *  that same frame with ALL THREE missions ON at once) ships fifth and LAST — every declared E&P
 *  scenario is now shipped. Mirrors the Seafarers/T&B scenario-gating discipline (D-026). */
export const SHIPPED_EP_SCENARIOS: ReadonlySet<EPScenarioId> = new Set<EPScenarioId>([
  'landHo',
  'fishForHexhaven',
  'spicesForHexhaven',
  'pirateLairs',
  'fullCampaign',
]);

/**
 * T-1111 (§EP1.3/§EP11, ⚠ VERIFY every target — no rulebook images on record for this codebase): the
 * per-scenario mission-activation framework. `createGame`'s (now-generalized) E&P branch reads this
 * to decide (a) the win target and (b) whether to seed the fish/spice mission state
 * (`seedFishSpiceV0`) on top of the board+exploration seeding every shipped scenario shares. T-1110
 * additionally gates `haulFishOnArrival`/`deliverFishHandler`/`deliverSpiceHandler` (goldFishSpice.ts,
 * `epFishMissionActive`/`epSpiceMissionActive` below) and the createGame seeding call itself directly
 * on these same flags (see createGame.ts's own comment) — closing the cross-mission leak where a
 * spice-only (or fish-only) scenario incidentally seeded/hauled/delivered the OTHER mission's cargo.
 * See goldFishSpice.ts's header for the full leak/fix writeup.
 *
 * Land Ho! = 8 VP / all missions off. `fishForHexhaven` reuses Land Ho!'s same board/movement/founding
 * frame with the fish mission additionally ON — 10, ⚠ VERIFY. `spicesForHexhaven` (T-1112) mirrors that
 * exact same reasoning with the spice mission ON instead of fish — also 10, ⚠ VERIFY. `pirateLairs`
 * (T-1113) ships the placeholder entry that already existed here from T-1111 unchanged — same
 * reasoning, pirateLairs mission ON instead of fish/spice, 10, ⚠ VERIFY. `fullCampaign` (T-1114, the
 * LAST E&P scenario) bumps `winTarget` to 17 (⚠ VERIFY) with all THREE mission point tracks in play.
 */
export const EP_SCENARIO_CONFIG: Record<
  EPScenarioId,
  { winTarget: number; missions: { fish: boolean; spice: boolean; pirateLairs: boolean } }
> = {
  landHo: { winTarget: 8, missions: { fish: false, spice: false, pirateLairs: false } },
  fishForHexhaven: { winTarget: 10, missions: { fish: true, spice: false, pirateLairs: false } },
  spicesForHexhaven: { winTarget: 10, missions: { fish: false, spice: true, pirateLairs: false } },
  pirateLairs: { winTarget: 10, missions: { fish: false, spice: false, pirateLairs: true } },
  fullCampaign: { winTarget: 17, missions: { fish: true, spice: true, pirateLairs: true } },
};

/** Type guard: is `id` a declared E&P scenario? */
export function isEPScenarioId(id: string): id is EPScenarioId {
  return (EP_SCENARIO_IDS as readonly string[]).includes(id);
}

/**
 * T-1150 (Phase 11B, mirrors `TB_SCENARIO_SUPPORTS_56` — modules/tradersBarbarians/index.ts, T-1050):
 * which E&P scenarios support the 5–6 player extension TODAY. Unlike T&B (whose scenarios play on the
 * shared BASE board, so 5–6 support only ever needed a player-count gate), E&P has its OWN scenario
 * board (`buildLandHoBoardV0`/`buildLandHoBoard56`, board.ts) — T-1150 built that BIGGER frame + the
 * framework for `landHo` only, and proved it with a sim.
 *
 * T-1152 (Phase 11B): the other four scenarios now ALSO declare 5–6 support — each reuses the exact
 * same `buildLandHoBoard56` frame T-1150 built (no second board builder needed); their own mission
 * seeding (`seedFishSpiceV0`, goldFishSpice.ts) now takes the resolved 5–6 geometry + the scaled
 * `FISH_SHOAL_COUNT_56`/`VILLAGE_COUNT_56` counts (createGame.ts), and pirate lairs are created purely
 * from exploration reveals (`EP_EXPLORATION_TILES_56`'s 3 `'pirate'` entries, already plumbed by
 * T-1150), so no further per-scenario board work was needed. `resolveModules` (modules/index.ts) is
 * the actual gate; this table is its single source of truth (server lobby / client picker defer to it
 * too). */
export const EP_SCENARIO_SUPPORTS_56: Record<EPScenarioId, boolean> = {
  landHo: true,
  fishForHexhaven: true,
  spicesForHexhaven: true,
  pirateLairs: true,
  fullCampaign: true,
};

/** The selected E&P scenario id for a config, or `null` when E&P is off. */
export function explorersPiratesScenario(config: Pick<GameConfig, 'expansions'>): EPScenarioId | null {
  const ep = config.expansions.explorersPirates;
  if (!ep) return null;
  return isEPScenarioId(ep.scenario) ? ep.scenario : null;
}

/** T-1110 (§EP8, the fish-auto-haul fidelity fix): is the FISH mission actually ON for `state`'s own
 *  scenario? `false` outside a live E&P game or for a scenario whose `EP_SCENARIO_CONFIG` entry has
 *  `missions.fish` off (Land Ho!, Spices for Hexhaven, Pirate Lairs) — mirrors `epSpiceMissionActive`
 *  below and the pre-existing `epSpiceMissionActive`/`epPirateLairsMissionActive` gating discipline
 *  already used by sim/bot.ts and vp.ts for the sibling missions. Gates `haulFishOnArrival`/
 *  `deliverFishHandler` (goldFishSpice.ts) so fish can only ever accrue in a scenario whose fish
 *  mission is on. */
export function epFishMissionActive(state: GameState): boolean {
  const scenario = epExt(state)?.scenario;
  return scenario !== undefined && isEPScenarioId(scenario) && EP_SCENARIO_CONFIG[scenario].missions.fish;
}

/** T-1110 (§EP9, mirrors `epFishMissionActive` exactly): is the SPICE mission actually ON for
 *  `state`'s own scenario? `false` outside a live E&P game or for a scenario whose `EP_SCENARIO_CONFIG`
 *  entry has `missions.spice` off (Land Ho!, Fish for Hexhaven, Pirate Lairs). Gates `deliverSpiceHandler`
 *  (goldFishSpice.ts); `tradeSpiceHandler` needs no separate gate — it already rejects
 *  `VILLAGE_NOT_FOUND` once `villages` is only ever seeded when this flag is on (createGame.ts). */
export function epSpiceMissionActive(state: GameState): boolean {
  const scenario = epExt(state)?.scenario;
  return scenario !== undefined && isEPScenarioId(scenario) && EP_SCENARIO_CONFIG[scenario].missions.spice;
}

/** Is `state` a live E&P game (any scenario)? See this file's header comment for why this checks
 *  ext PRESENCE rather than the config toggle. */
export function isExplorersPiratesState(state: GameState): boolean {
  return state.ext?.explorersPirates !== undefined;
}

/** Every ship on the board (EP3, fully public), or `[]` outside a live E&P game. */
export function shipsOf(state: GameState): readonly { seat: Seat; edge: EdgeId; cargo: EPCargo[] }[] {
  return epExt(state)?.ships ?? [];
}

/** `seat`'s own ships only (a filtered view over `shipsOf`). */
export function shipsOfSeat(
  state: GameState,
  seat: Seat
): readonly { seat: Seat; edge: EdgeId; cargo: EPCargo[] }[] {
  return shipsOf(state).filter((s) => s.seat === seat);
}

/** Is there a ship (any seat) on `edge`? (EP3.1: one ship per edge, mirrors S3.3.) */
export function isShipOnEdge(state: GameState, edge: EdgeId): boolean {
  return shipsOf(state).some((s) => s.edge === edge);
}

/** Edges whose ship was BUILT this turn-owner rotation (EP3.1/EP3.2), or `[]`. */
export function shipsBuiltThisTurnOf(state: GameState): readonly EdgeId[] {
  return epExt(state)?.shipsBuiltThisTurn ?? [];
}

/** Edges whose ship has already MOVED this turn-owner rotation (EP3.2, ≤1/turn), or `[]`. */
export function movedShipsThisTurnOf(state: GameState): readonly EdgeId[] {
  return epExt(state)?.movedShipsThisTurn ?? [];
}

/** The scenario's authoritative per-hex sea/gold/land classification (mirrors seafarers'
 *  `hexTerrainOf`), or `[]` outside a live E&P game. */
export function seaMapOf(state: GameState): readonly ScenarioTerrain[] {
  return epExt(state)?.seaMap ?? [];
}

/** Authoritative scenario terrain for one hex, or `undefined` outside a live E&P game / an
 *  out-of-range hex. */
export function epTerrainOf(state: GameState, hex: number): ScenarioTerrain | undefined {
  return epExt(state)?.seaMap?.[hex];
}

/** A seat's gold total (EP6, seeded 0 — spent/earned by later tasks), or 0 outside a live E&P game. */
export function epGoldOf(state: GameState, seat: Seat): number {
  return epExt(state)?.gold?.[seat] ?? 0;
}

/** Hexes still fog (T-1103, §EP2.1/§EP5, fully PUBLIC — see redact.ts's `PlayerView['ext']
 *  ['explorersPirates']` field comment), or `[]` outside a live E&P game / before
 *  `seedExplorationV0`. */
export function unexploredOf(state: GameState): readonly HexId[] {
  return epExt(state)?.unexplored ?? [];
}

/** `seat`'s own harbor settlements (T-1104, §EP4.2, fully public — a board piece like a
 *  settlement/city), or `[]` outside a live E&P game / before any upgrade. */
export function harborSettlementsOf(state: GameState, seat: Seat): readonly VertexId[] {
  return epExt(state)?.harborSettlements?.[seat] ?? [];
}

/** Is vertex `v` any seat's harbor settlement? (T-1104, §EP4.2 — E&P has no cities, so this is the
 *  harbor-settlement analogue of `isVertexOccupied`'s cities check.) */
export function isHarborSettlementAt(state: GameState, v: VertexId): boolean {
  return (epExt(state)?.harborSettlements ?? []).some((list) => (list ?? []).includes(v));
}

/** `seat`'s un-loaded settler reserve (T-1104, §EP4.1 — built via `buildEPSettler`, not yet drawn
 *  onto a ship's cargo bay), or 0 outside a live E&P game / before any settler is built. */
export function settlerSupplyOf(state: GameState, seat: Seat): number {
  return epExt(state)?.settlerSupply?.[seat] ?? 0;
}

/** `seat`'s un-loaded crew reserve (T-1105, §EP7.1 — built via `buildEPCrew`, not yet drawn onto a
 *  ship's cargo bay), or 0 outside a live E&P game / before any crew is built. Mirrors
 *  `settlerSupplyOf` exactly. */
export function crewSupplyOf(state: GameState, seat: Seat): number {
  return epExt(state)?.crewSupply?.[seat] ?? 0;
}

/** Every active (not yet captured) pirate lair (T-1105, §EP7.2, fully public), or `[]` outside a
 *  live E&P game / before any lair is revealed. */
export function pirateLairsOf(state: GameState): readonly { hex: HexId; crews: Seat[] }[] {
  return epExt(state)?.pirateLairs ?? [];
}

/** `seat`'s lair-capture VP earned so far (T-1105, §EP7.2), or 0 outside a live E&P game / before
 *  any lair is captured. */
export function lairPointsOf(state: GameState, seat: Seat): number {
  return epExt(state)?.lairPoints?.[seat] ?? 0;
}

/** Every sea hex holding a fish shoal (T-1106, §EP8, fully public), or `[]` outside a live E&P
 *  game / before `seedFishSpiceV0`. */
export function fishShoalsOf(state: GameState): readonly HexId[] {
  return epExt(state)?.fishShoals ?? [];
}

/** Every revealed-land hex holding a village (T-1106, §EP9, fully public), or `[]` outside a live
 *  E&P game / before `seedFishSpiceV0`. */
export function villagesOf(state: GameState): readonly HexId[] {
  return epExt(state)?.villages ?? [];
}

/** The home-island council delivery vertex (T-1106, §EP8/§EP9, fully public), or `undefined`
 *  outside a live E&P game / before `seedFishSpiceV0`. */
export function councilVertexOf(state: GameState): VertexId | undefined {
  return epExt(state)?.councilVertex;
}

/** `seat`'s fish-delivery VP earned so far (T-1106, §EP8), or 0 outside a live E&P game / before
 *  any delivery. */
export function fishPointsOf(state: GameState, seat: Seat): number {
  return epExt(state)?.fishPoints?.[seat] ?? 0;
}

/** `seat`'s spice-delivery VP earned so far (T-1106, §EP9), or 0 outside a live E&P game / before
 *  any delivery. */
export function spicePointsOf(state: GameState, seat: Seat): number {
  return epExt(state)?.spicePoints?.[seat] ?? 0;
}

/** `seat`'s VP earned from `shipGold` so far (T-1106, §EP6.2), or 0 outside a live E&P game / before
 *  any gold is shipped. */
export function goldPointsOf(state: GameState, seat: Seat): number {
  return epExt(state)?.goldPoints?.[seat] ?? 0;
}

/** `seat`'s spice-benefit level (T-1106, §EP9 — raised by `deliverSpice`, read by `moveEPShip`'s
 *  `spiceShipRangeBonus`), or 0 outside a live E&P game / before any delivery. */
export function spiceBenefitOf(state: GameState, seat: Seat): number {
  return epExt(state)?.spiceBenefit?.[seat] ?? 0;
}

/** Replace the E&P ext block on `state` immutably (spread-copy only that branch). */
export function withEpExt(state: GameState, next: EPExt): GameState {
  return { ...state, ext: { ...state.ext, explorersPirates: next } };
}
