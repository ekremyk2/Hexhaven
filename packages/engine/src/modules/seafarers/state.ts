// Seafarers ship-state helpers (T-702, docs/rules/seafarers-rules.md §S1/§S3). All Seafarers piece
// data lives under `state.ext.seafarers` (docs/10 §3) so base fields never change meaning; these thin
// accessors are the single read/write surface. Every accessor is a no-op / empty for a base game.

import type { EdgeId, GameConfig, GameState, HexId, ScenarioTerrain, Seat } from '@hexhaven/shared';

/** S1.1: 15 ships per player, tracked exactly like roads. */
export const SHIPS_PER_PLAYER = 15;

type SeafarersExt = NonNullable<NonNullable<GameState['ext']>['seafarers']>;

/** Is this a seafarers game? (A valid scenario toggle — resolveModules already gated the id.) */
export function isSeafarersConfig(config: Pick<GameConfig, 'expansions'>): boolean {
  return config.expansions.seafarers !== false;
}

export function isSeafarersState(state: GameState): boolean {
  return state.ext?.seafarers !== undefined;
}

/** The seafarers ext block, or `undefined` in a base game. */
export function seafarersExt(state: GameState): SeafarersExt | undefined {
  return state.ext?.seafarers;
}

/** A seat's ships (edge ids), or `[]` when there is no seafarers state / no ships. */
export function shipsOf(state: GameState, seat: Seat): readonly EdgeId[] {
  return state.ext?.seafarers?.ships[seat] ?? [];
}

/** A seat's remaining ship supply (0 when not a seafarers game). */
export function shipsLeftOf(state: GameState, seat: Seat): number {
  return state.ext?.seafarers?.shipsLeft[seat] ?? 0;
}

/** Authoritative scenario terrain for a hex (`sea`/`gold`/land); `undefined` in a base game. */
export function hexTerrainOf(state: GameState, hex: number): ScenarioTerrain | undefined {
  return state.ext?.seafarers?.hexTerrain[hex];
}

/** The pirate's current sea hex (S8), or `undefined` in a base game. */
export function pirateOf(state: GameState): HexId | undefined {
  return state.ext?.seafarers?.pirate;
}

/** A seat's earned small-island group ids (S10.6), or `[]` when not a seafarers game. */
export function islandChitsOf(state: GameState, seat: Seat): readonly number[] {
  return state.ext?.seafarers?.islandChits[seat] ?? [];
}

/** "Cloth for Hexhaven" (T-757) — a seat's cumulative cloth token count, or `0` when not that scenario
 *  (`ext.seafarers.cloth` absent, every other seafarers/base game). */
export function clothOf(state: GameState, seat: Seat): number {
  return state.ext?.seafarers?.cloth?.[seat] ?? 0;
}

/** "The Pirate Islands" (T-758) — a seat's captured lair hex ids, or `[]` when not that scenario
 *  (`ext.seafarers.lairs` absent, every other seafarers/base game). */
export function lairsOf(state: GameState, seat: Seat): readonly HexId[] {
  return state.ext?.seafarers?.lairs?.[seat] ?? [];
}

/** "The Wonders of Hexhaven" (T-759) — a seat's completed wonder-stage count, or `0` when not that
 *  scenario (`ext.seafarers.wonder` absent, every other seafarers/base game). */
export function wonderStagesOf(state: GameState, seat: Seat): number {
  return state.ext?.seafarers?.wonder?.[seat] ?? 0;
}

/** Is any player's ship on this edge? (S3.3: one piece per edge.) */
export function isShipOnEdge(state: GameState, edge: EdgeId): boolean {
  const ext = state.ext?.seafarers;
  if (!ext) return false;
  return ext.ships.some((list) => list.includes(edge));
}

/** Build the initial seafarers ext for `playerCount` players on `hexTerrain` (createGame, T-702/T-703).
 *  `pirate` is the pirate's start sea hex (S8.1, from `scenario.pirateStart`). `fog` (T-756) is the
 *  seeded Fog Islands hidden-set + reveal stack (`board.ts`'s `seedScenarioFog`), or `undefined` for
 *  every other scenario — the field is omitted entirely (not merely empty) so every non-Fog-Islands
 *  game's `ext.seafarers` shape is byte-identical to before this task. `cloth` (T-757) is the zeroed
 *  per-seat Cloth for Hexhaven counter, or `undefined` for every OTHER scenario — same omit-entirely
 *  discipline as `fog`, so a non-Cloth-for-Hexhaven game's `ext.seafarers` shape is unaffected.
 *  `pirateTrack` (T-758) is the Pirate Islands auto-moving pirate's starting `{ index, safe }`, and
 *  `lairs` is its zeroed per-seat lair-capture list — both `undefined` for every OTHER scenario, same
 *  omit-entirely discipline. `wonder` (T-759) is the Wonders of Hexhaven zeroed per-seat wonder-stage
 *  counter, `undefined` for every OTHER scenario — same omit-entirely discipline. */
export function initialSeafarersExt(
  playerCount: number,
  hexTerrain: ScenarioTerrain[],
  pirate: HexId,
  fog?: SeafarersExt['fog'],
  cloth?: number[],
  pirateTrack?: { index: number; safe: boolean },
  lairs?: HexId[][],
  wonder?: number[]
): SeafarersExt {
  return {
    ships: Array.from({ length: playerCount }, () => []),
    shipsLeft: Array.from({ length: playerCount }, () => SHIPS_PER_PLAYER),
    hexTerrain,
    movedShipOnTurn: -1,
    builtShips: { turn: -1, edges: [] },
    pirate,
    islandChits: Array.from({ length: playerCount }, () => []),
    ...(fog ? { fog } : {}),
    ...(cloth ? { cloth } : {}),
    ...(pirateTrack ? { pirateTrackIndex: pirateTrack.index, pirateTrackSafe: pirateTrack.safe } : {}),
    ...(lairs ? { lairs } : {}),
    ...(wonder ? { wonder } : {}),
  };
}

/** Replace the seafarers ext block on `state` immutably (spread-copy only that branch). */
export function withSeafarersExt(state: GameState, next: SeafarersExt): GameState {
  return { ...state, ext: { ...state.ext, seafarers: next } };
}
