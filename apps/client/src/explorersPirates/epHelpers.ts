// Explorers & Pirates — Land Ho! client helpers (T-1108): pure, store-agnostic lookups over a
// redacted `PlayerView` — the single place every E&P UI piece (HUD, action panel, board layer)
// reads `view.ext.explorersPirates` from, mirroring `tradersBarbarians/tbHelpers.ts`'s `tbOf`/
// `isTradersBarbariansGame` precedent exactly. Only Land Ho! is shipped (T-1108's scope note), so
// every helper here is written for that one scenario — a later task widens `isLandHoGame`'s sibling
// checks the same way T&B's per-scenario guards grew one at a time.
import { EP_SCENARIO_CONFIG, isEPScenarioId } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import type { EdgeId, EPCargo, HexId, Seat, VertexId } from '@hexhaven/shared';
import { boardGeometryFor } from '../board/geometry';

/** The `ext.explorersPirates` block's shape, as `redact.ts` exposes it to any viewer. */
export type ExplorersPiratesView = NonNullable<NonNullable<PlayerView['ext']>['explorersPirates']>;

/** Is this an Explorers & Pirates game at all? (Only `landHo` is shipped today, T-1108.) */
export function isExplorersPiratesGame(view: PlayerView): boolean {
  return view.ext?.explorersPirates != null;
}

/** The E&P public state, or `undefined` outside an E&P game. */
export function epOf(view: PlayerView): ExplorersPiratesView | undefined {
  return view.ext?.explorersPirates;
}

export function isLandHoGame(view: PlayerView): boolean {
  return epOf(view)?.scenario === 'landHo';
}

// ---- Mission gating (T-1154, §EP1.3/§EP11): which mission action-panel sections to show ------------
//
// Mirrors the engine's own `epFishMissionActive`/`epSpiceMissionActive` (modules/explorersPirates/
// state.ts) exactly, just resolved off the redacted `PlayerView`'s public `scenario` field instead of
// a live `GameState` — `EP_SCENARIO_CONFIG`/`isEPScenarioId` are pure lookups (no hidden info), so this
// never drifts from what the engine itself gates `deliverFish`/`deliverSpice`/`tradeSpice` on. NOT
// derived from `fishShoals`/`villages`/`pirateLairs` array PRESENCE (those start non-empty for
// fish/spice at game start but `pirateLairs` starts EMPTY until the first `'pirate'` tile reveal —
// gating pirate-lair controls on array length would hide `buildEPCrew`/load-crew before any lair ever
// appears, even though both are legal from turn one in that scenario).

function epScenarioMissions(
  view: PlayerView
): { fish: boolean; spice: boolean; pirateLairs: boolean } | null {
  const scenario = epOf(view)?.scenario;
  if (scenario === undefined || !isEPScenarioId(scenario)) return null;
  return EP_SCENARIO_CONFIG[scenario].missions;
}

/** Is the FISH mission (§EP8, "Fish for Hexhaven"/full campaign) active for `view`'s own scenario? */
export function isFishMissionActive(view: PlayerView): boolean {
  return epScenarioMissions(view)?.fish ?? false;
}

/** Is the SPICE mission (§EP9, "Spices for Hexhaven"/full campaign) active for `view`'s own scenario? */
export function isSpiceMissionActive(view: PlayerView): boolean {
  return epScenarioMissions(view)?.spice ?? false;
}

/** Is the PIRATE LAIRS mission (§EP7, "The Pirate Lairs"/full campaign) active for `view`'s own
 *  scenario? */
export function isPirateLairsMissionActive(view: PlayerView): boolean {
  return epScenarioMissions(view)?.pirateLairs ?? false;
}

/** `shipGold` (§EP6.2) has no engine-side mission gate of its own (the gold economy/compensation runs
 *  in every live E&P game, `applyGoldCompensation`) — but per this task's own spec, Land Ho! (no
 *  missions at all) shows NO mission controls, `shipGold` included. This is true exactly when at least
 *  one of the three missions above is on, i.e. every scenario except `landHo`. */
export function isAnyEpMissionActive(view: PlayerView): boolean {
  const missions = epScenarioMissions(view);
  return !!missions && (missions.fish || missions.spice || missions.pirateLairs);
}

/** Every ship on the board, flattened for board rendering (mirrors `TbHelpers`'s own knight/wagon
 *  flattening) — `{ edge, seat }`, dropping `cargo` (board rendering only needs owner + position;
 *  the action panel reads cargo straight off `epOf(view)?.ships` itself). */
export function epShipsFlattened(view: PlayerView): { edge: EdgeId; seat: Seat }[] {
  return (epOf(view)?.ships ?? []).map((s) => ({ edge: s.edge, seat: s.seat }));
}

/** Every harbor settlement on the board, flattened for board rendering — `ext.harborSettlements` is
 *  indexed by seat (a `VertexId[]` per seat, T-1104), so this fans it out to `{ vertex, seat }`. */
export function epHarborSettlementsFlattened(view: PlayerView): { vertex: VertexId; seat: Seat }[] {
  const list = epOf(view)?.harborSettlements ?? [];
  return list.flatMap((vertices, seat) => vertices.map((vertex) => ({ vertex, seat: seat as Seat })));
}

/** `seat`'s own ships (edge + cargo), for the action panel's ship list / cargo pickers. */
export function ownEpShipsOf(view: PlayerView, seat: Seat): { edge: EdgeId; cargo: EPCargo[] }[] {
  return (epOf(view)?.ships ?? [])
    .filter((s) => s.seat === seat)
    .map((s) => ({ edge: s.edge, cargo: [...s.cargo] }));
}

export function ownGoldOf(view: PlayerView, seat: Seat): number {
  return epOf(view)?.gold?.[seat] ?? 0;
}

export function ownHarborSettlementsOf(view: PlayerView, seat: Seat): VertexId[] {
  return epOf(view)?.harborSettlements?.[seat] ?? [];
}

export function ownSettlerSupplyOf(view: PlayerView, seat: Seat): number {
  return epOf(view)?.settlerSupply?.[seat] ?? 0;
}

/** `seat`'s own un-loaded crew reserve (T-1154, §EP7.1 — mirrors `ownSettlerSupplyOf` exactly). */
export function ownCrewSupplyOf(view: PlayerView, seat: Seat): number {
  return epOf(view)?.crewSupply?.[seat] ?? 0;
}

/** Hexes still face-down (T-1103, §EP2.1/§EP5.1) — the client renders a fog placeholder over each of
 *  these (`BoardView`'s `epUnexplored` prop). Empty outside an E&P game. */
export function unexploredHexesOf(view: PlayerView): HexId[] {
  return epOf(view)?.unexplored ?? [];
}

/** Does `seat` have a settlement/city/harbor settlement at one of `edge`'s two endpoints? The v1
 *  "harbor substitute" anchor `loadCargoHandler`/`unloadCargoHandler` (ships.ts) require for cargo
 *  load/unload — composed here from PUBLIC fields only (`view.players[seat]`'s settlements/cities +
 *  `epOf(view)`'s harborSettlements), never a re-derivation of an engine RULE, so this can never
 *  drift from what the handler actually checks (it reads the exact same three public lists).
 *
 * T-1154 fix (found while wiring the load-crew mission control at 5–6): this used to index the fixed
 * base `GEOMETRY` directly, so any edge unique to the bigger 5–6 frame (`LAND_HO_56_GEOMETRY`, 109
 * edges vs the base board's 72) always looked up `undefined` and silently returned `false` — breaking
 * load/unload-settler (and now load-crew) legality for any 5–6 ship sitting past edge id 71. Resolves
 * `boardGeometryFor(view.config)` instead, the same client-side resolver `epActionLogic.ts`'s own
 * composers use (T-1160's fix for that file) — geometry-correct at both player counts now. */
export function shipTouchesOwnBuilding(view: PlayerView, seat: Seat, edge: EdgeId): boolean {
  const e = boardGeometryFor(view.config).edges[edge];
  if (!e) return false;
  const player = view.players.find((p) => p.seat === seat);
  if (!player) return false;
  const harborVertices = ownHarborSettlementsOf(view, seat);
  return [e.a, e.b].some(
    (v) => player.settlements.includes(v) || player.cities.includes(v) || harborVertices.includes(v),
  );
}
