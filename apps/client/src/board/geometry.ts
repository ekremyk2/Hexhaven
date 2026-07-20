// Client-side board-geometry resolver. Mirrors the engine's `geometryForConfig`
// (packages/engine/src/modules/index.ts): a Seafarers game renders on its scenario frame (3p/4p
// differ), a fiveSix game on the 30-hex EXT56 geometry, every other config on the base 19-hex one.
//
// Without this the client always rendered the base `GEOMETRY`, so a 5–6 game drew only 19 of its 30
// hexes AND looked up the 30-hex board's harbor edge ids in the 19-hex geometry — placing harbors on
// the wrong (interior) edges (playtest bug: "board looks broken, 3:1 in the interior"). Seafarers has
// the same hazard: its frame is neither 19- nor 30-hex, so it must build from the scenario layout.
//
// T-1150 (Phase 11B): a shipped E&P scenario is ALSO checked (before the generic fiveSix branch,
// mirrors the engine's own `geometryForConfig` ordering) — E&P has its OWN board frame (unlike T&B,
// which plays on the shared base/EXT56 board and so needed no change here), so a `fiveSix` E&P game
// must render `LAND_HO_56_GEOMETRY` (37 hexes) rather than falling through to the unrelated 30-hex
// `GEOMETRY_EXT56`. A 3–4 E&P config is unaffected either way (its board already IS the base
// `GEOMETRY`, `LAND_HO_V0_TERRAINS`'s home island — `modules/explorersPirates/board.ts`).

import { LAND_HO_56_GEOMETRY, SHIPPED_EP_SCENARIOS, isEPScenarioId } from '@hexhaven/engine';
import {
  GEOMETRY,
  GEOMETRY_EXT56,
  buildGeometry,
  getScenario,
  type BoardGeometry,
  type GameConfig,
} from '@hexhaven/shared';

/** The config shape the resolver reads: `expansions` always, `playerCount` only for Seafarers (its
 *  3p/4p frames differ). Kept optional so base/EXT56 callers that pass only `{ expansions }` compile. */
export type GeometryConfig = Pick<GameConfig, 'expansions'> & {
  playerCount?: GameConfig['playerCount'];
};

// Scenario geometry is static per (scenarioId, playerCount) and `buildGeometry` is not free, so
// memoize one frozen geometry per key — the same discipline as the engine's `geometryCache`.
const scenarioGeometryCache = new Map<string, BoardGeometry>();

/** The scenario frame geometry a Seafarers config renders on, or `null` when it isn't a shipped
 *  3/4-player Seafarers config. Mirrors the engine's `scenarioGeometryFor`. */
export function scenarioGeometryFor(config: GeometryConfig | undefined): BoardGeometry | null {
  const sea = config?.expansions?.seafarers;
  if (!sea) return null; // `false` or undefined → not a Seafarers game
  const pc = config?.playerCount;
  // Scenarios ship 3p/4p (base Seafarers) and 5p/6p (T-751, fiveSix+Seafarers extension) boards; the
  // `board` presence guard below still gates on whether THIS scenario actually has that count.
  if (pc !== 3 && pc !== 4 && pc !== 5 && pc !== 6) return null;
  const scenario = getScenario(sea.scenario);
  if (!scenario) return null;
  const board = scenario.boards[pc]; // Phase 7B: boards is now a PARTIAL record — a scenario may not ship this count
  if (!board) return null;
  const key = `${sea.scenario}:${pc}`;
  const cached = scenarioGeometryCache.get(key);
  if (cached) return cached;
  const geometry = buildGeometry(board.layout);
  scenarioGeometryCache.set(key, geometry);
  return geometry;
}

/** The geometry a game with `config` renders on. Seafarers → its scenario frame; a shipped E&P
 *  scenario (T-1150) → its own board (the base 19-hex `GEOMETRY` at 3–4, the bigger 37-hex
 *  `LAND_HO_56_GEOMETRY` when `fiveSix` is also on); `expansions.fiveSix` truthy → 30-hex EXT56;
 *  otherwise the base 19-hex geometry. */
export function boardGeometryFor(config: GeometryConfig | undefined): BoardGeometry {
  const scenarioGeo = scenarioGeometryFor(config);
  if (scenarioGeo) return scenarioGeo;
  const ep = config?.expansions?.explorersPirates;
  if (ep && isEPScenarioId(ep.scenario) && SHIPPED_EP_SCENARIOS.has(ep.scenario)) {
    return config?.expansions?.fiveSix ? LAND_HO_56_GEOMETRY : GEOMETRY;
  }
  return config?.expansions?.fiveSix ? GEOMETRY_EXT56 : GEOMETRY;
}
