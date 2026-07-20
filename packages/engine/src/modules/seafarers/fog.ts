// Fog Islands (T-756, Seafarers 5–6 extension) — fog reveal mechanic. Mirrors Explorers & Pirates'
// exploration reveal (`modules/explorersPirates/exploration.ts`'s `revealOnArrival`) in SHAPE only —
// no shared code, the two expansions stay separate (docs/10 §3). Folded into the seafarers module's
// EXISTING `afterAction` hook (index.ts) after `buildShip`/`moveShip`: NO new action. When a ship's
// edge borders a still-`fog.hidden` hex, reveal it — pop the next `{terrain, token}` tile from the
// pre-shuffled `ext.seafarers.fog.stack` (shuffled once at `createGame`, `board.ts`'s
// `seedScenarioFog`, threaded through `state.rng` — no FURTHER rng draw here; the "draw" IS consuming
// the next entry of the already-shuffled stack, exactly like E&P's `explorationSupply` order / the
// dev deck's draw order), write it into `board.hexes` (base-terrain proxy, sea/gold -> desert,
// matching every other seafarers hex, board.ts's own convention) + `ext.seafarers.hexTerrain` (the
// real classification), and drop the hex from `fog.hidden`.
//
// NO events: the task's hard constraint forbids a new GameEvent (a dedicated "tile revealed" log
// entry is an explicit FOLLOW-UP, not this task) — the client re-renders from board/ext state, same
// as any other board mutation that doesn't carry its own event.

import type { EdgeId, GameState, HexId, ScenarioTerrain, TerrainType } from '@hexhaven/shared';
import { geometryForState } from '../index.js';
import { seafarersExt, withSeafarersExt } from './state.js';

/** Base-terrain PROXY for a revealed fog tile (sea/gold -> desert) — mirrors `board.ts`'s own
 *  sea/gold proxy convention: `board.hexes` never carries a raw `ScenarioTerrain`, only a
 *  `TerrainType`, so gold/sea always read as an inert `desert` there (the real classification lives
 *  in `ext.seafarers.hexTerrain`, updated alongside). A fog tile's `terrain` is never itself `'sea'`
 *  (scenario.ts's `fogTiles` never draws one — a fog tile always resolves to real land or gold). */
function terrainProxy(t: ScenarioTerrain): TerrainType {
  return t === 'sea' || t === 'gold' ? 'desert' : t;
}

/**
 * Fog Islands (T-756, engine reveal-trigger): for every still-`fog.hidden` hex bordering `edge`,
 * pops the next `fog.stack` entry, writes its real content into `board.hexes`/
 * `ext.seafarers.hexTerrain`, and drops the hex from `fog.hidden`. Returns `state` UNCHANGED
 * (reference-equal) when there is no seafarers/fog state, `fog.hidden` is already empty, `edge`
 * borders no hidden hex, or (defensively) the stack is exhausted — never hit given
 * `seedScenarioFog`'s length guard. Called from the seafarers module's `afterAction` hook
 * (index.ts) after a `buildShip`/`moveShip` action succeeds — NOT a new action/event itself.
 */
export function revealFogAt(state: GameState, edge: EdgeId): GameState {
  const ext = seafarersExt(state);
  const fog = ext?.fog;
  if (!ext || !fog || fog.hidden.length === 0) return state;

  const geometry = geometryForState(state);
  const geomEdge = geometry.edges[edge];
  const candidates: HexId[] = (geomEdge?.hexes ?? []).filter((h) => fog.hidden.includes(h));
  if (candidates.length === 0) return state;

  const stack = [...fog.stack];
  const hexTerrain = [...ext.hexTerrain];
  let hexes = state.board.hexes;
  const revealed: HexId[] = [];

  for (const hex of candidates) {
    const tile = stack.shift();
    if (!tile) break; // defensive: fog.cells/fog.tiles are length-matched at seed time (board.ts)
    revealed.push(hex);
    if (hexes === state.board.hexes) hexes = hexes.slice();
    hexes[hex] = { terrain: terrainProxy(tile.terrain), token: tile.token };
    hexTerrain[hex] = tile.terrain;
  }
  if (revealed.length === 0) return state;

  const board = { ...state.board, hexes };
  const hidden = fog.hidden.filter((h) => !revealed.includes(h));
  return withSeafarersExt({ ...state, board }, { ...ext, hexTerrain, fog: { ...fog, hidden, stack } });
}
