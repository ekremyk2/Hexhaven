// Seafarers scenario board generation (T-702, requirement 1; docs/rules/seafarers-rules.md §S2/§S10).
// T-701 encoded the scenario frame (sea/land cells, harbor positions, pirate/robber starts) as pure
// data in `@hexhaven/shared`; this file stands up a concrete `GameState['board']` from it at `createGame`
// so a seafarers game plays on the real "Heading for New Shores" board instead of the base 19-hex one.
//
// Purity: deterministic in the threaded rng (docs/03 §6) — no Math.random/Date/IO. Sea hexes produce
// nothing and never carry a token (S3.1); gold hexes carry a token but produce nothing in T-702 (gold
// production is T-703, ER-S7). Because base render/production code reads `HexTile.terrain: TerrainType`,
// `board.hexes` stores a base-terrain PROXY (sea/gold → `desert`) while the authoritative scenario
// terrain rides in `ext.seafarers.hexTerrain` (state.ts) for ship-edge detection and later gold work.

import { buildGeometry, getScenario, resolveScenarioHarbors } from '@hexhaven/shared';
import type {
  BoardGeometry,
  GameConfig,
  GameState,
  HarborType,
  HexId,
  HexTile,
  Scenario,
  ScenarioBoard,
  ScenarioTerrain,
  TerrainType,
} from '@hexhaven/shared';
import { shuffle } from '../../rng.js';

/** A seafarers player count. The base box ships 3/4-player boards; the Seafarers 5–6 extension (Phase
 *  7B) adds 5/6-player scenario boards — which board a config actually gets is gated on
 *  `scenario.boards[pc]` presence in `scenarioBoardFor` below. */
type ScenarioPlayerCount = 3 | 4 | 5 | 6;

function scenarioPlayerCount(config: Pick<GameConfig, 'playerCount'>): ScenarioPlayerCount | null {
  const pc = config.playerCount;
  return pc === 3 || pc === 4 || pc === 5 || pc === 6 ? pc : null;
}

/** The scenario id a seafarers config selected, or `null` when seafarers is off. */
function scenarioIdOf(config: Pick<GameConfig, 'expansions'>): string | null {
  return config.expansions.seafarers === false ? null : config.expansions.seafarers.scenario;
}

/** Resolve the concrete `ScenarioBoard` for a seafarers config, or `null` if not applicable. */
export function scenarioBoardFor(
  config: Pick<GameConfig, 'expansions' | 'playerCount'>
): ScenarioBoard | null {
  const id = scenarioIdOf(config);
  const pc = scenarioPlayerCount(config);
  if (id === null || pc === null) return null;
  const scenario = getScenario(id);
  return scenario?.boards[pc] ?? null;
}

/** The `Scenario` (rules: target VP, small-island bonus) a seafarers config selected, or `null`. */
export function scenarioFor(config: Pick<GameConfig, 'expansions'>): Scenario | null {
  const id = scenarioIdOf(config);
  return id === null ? null : (getScenario(id) ?? null);
}

/**
 * The small-island group id for hex `hexId` on this config's scenario board (S10.6), or `null` for a
 * main-island / sea hex or a base config. `scenarioBoard.hexes` is aligned to geometry HexId order
 * (board.ts / scenario.ts), so `hexes[hexId]` is the classification of that hex.
 */
export function islandOfHex(
  config: Pick<GameConfig, 'expansions' | 'playerCount'>,
  hexId: HexId
): number | null {
  const board = scenarioBoardFor(config);
  return board?.hexes[hexId]?.island ?? null;
}

// Geometry is expensive to build (buildGeometry) and the scenario board is static data — memoize one
// frozen geometry per (scenarioId, playerCount). Pure: same key ⇒ same frozen object every time.
const geometryCache = new Map<string, BoardGeometry>();

/** The board geometry a seafarers config plays on, or `null` when not a (shipped) seafarers config. */
export function scenarioGeometryFor(
  config: Pick<GameConfig, 'expansions' | 'playerCount'>
): BoardGeometry | null {
  const id = scenarioIdOf(config);
  const pc = scenarioPlayerCount(config);
  if (id === null || pc === null) return null;
  const board = scenarioBoardFor(config);
  if (!board) return null;
  const key = `${id}:${pc}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;
  const geometry = buildGeometry(board.layout);
  geometryCache.set(key, geometry);
  return geometry;
}

/** The scenario's production-number multiset (I8 cross-check), or `null` for a base config. */
export function scenarioTokensFor(
  config: Pick<GameConfig, 'expansions' | 'playerCount'>
): readonly number[] | null {
  return scenarioBoardFor(config)?.tokens ?? null;
}

/** A `TerrainType` is a resource/desert terrain (produces or is a real desert), never sea/gold. */
function isResourceOrDesert(t: ScenarioTerrain): t is TerrainType {
  return t !== 'sea' && t !== 'gold';
}

/** The base-`TerrainType` proxy stored in `board.hexes` (sea/gold → desert; see file header). */
function terrainProxy(t: ScenarioTerrain): TerrainType {
  return isResourceOrDesert(t) ? t : 'desert';
}

/** Hex-to-hex adjacency (shared-edge) for the no-adjacent-red token constraint (S10.4). */
function hexNeighbors(geometry: BoardGeometry): HexId[][] {
  const out: HexId[][] = geometry.hexes.map(() => []);
  for (const edge of geometry.edges) {
    if (edge.hexes.length !== 2) continue;
    const [a, b] = edge.hexes as [HexId, HexId];
    out[a]!.push(b);
    out[b]!.push(a);
  }
  return out;
}

/**
 * Randomize land terrain within each region's verified multiset (S10.4): shuffle the non-desert
 * terrains among the non-desert land cells of each region, keeping sea cells and the fixed 4p desert
 * in place. Returns the authoritative per-hex `ScenarioTerrain` aligned to `geometry.hexes`.
 */
function assignTerrain(
  rng: number,
  board: ScenarioBoard
): { rng: number; hexTerrain: ScenarioTerrain[] } {
  const n = board.hexes.length;
  const hexTerrain: ScenarioTerrain[] = board.hexes.map((h) => (h.region === 'sea' ? 'sea' : h.terrain));
  let s = rng;
  for (const region of ['main', 'small'] as const) {
    const cells: number[] = [];
    for (let i = 0; i < n; i++) {
      const h = board.hexes[i]!;
      if (h.region === region && h.terrain !== 'desert') cells.push(i);
    }
    const bag = cells.map((i) => board.hexes[i]!.terrain);
    const draw = shuffle(s, bag);
    s = draw.state;
    cells.forEach((i, k) => {
      hexTerrain[i] = draw.array[k]!;
    });
  }
  return { rng: s, hexTerrain };
}

// Bounded retries to satisfy the no-adjacent-6/8 rule (S10.4); accept the last draw on exhaustion —
// the scenario is semi-random and no invariant enforces R2.5 here, so a rare adjacency is tolerable.
const MAX_TOKEN_ATTEMPTS = 200;

function isRedToken(token: number | null): boolean {
  return token === 6 || token === 8;
}

function hasAdjacentRed(tokens: (number | null)[], neighbors: HexId[][]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    if (!isRedToken(tokens[i] ?? null)) continue;
    for (const j of neighbors[i]!) {
      if (isRedToken(tokens[j] ?? null)) return true;
    }
  }
  return false;
}

/**
 * Assign the scenario's number-token multiset randomly to the numbered hexes (non-sea, non-desert —
 * gold IS numbered, S9.1), avoiding adjacent red 6/8 where possible (S10.4). Returns tokens aligned to
 * `geometry.hexes` (sea/desert → null) plus the advanced rng.
 */
function assignTokens(
  rng: number,
  board: ScenarioBoard,
  hexTerrain: ScenarioTerrain[],
  neighbors: HexId[][]
): { rng: number; tokens: (number | null)[] } {
  const numbered: number[] = [];
  for (let i = 0; i < hexTerrain.length; i++) {
    const t = hexTerrain[i]!;
    if (t !== 'sea' && t !== 'desert') numbered.push(i);
  }
  if (numbered.length !== board.tokens.length) {
    throw new Error(
      `BUG: scenario has ${numbered.length} numbered hexes but ${board.tokens.length} tokens`
    );
  }

  let s = rng;
  let best: (number | null)[] | null = null;
  for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
    const draw = shuffle(s, [...board.tokens]);
    s = draw.state;
    const tokens: (number | null)[] = hexTerrain.map(() => null);
    numbered.forEach((i, k) => {
      tokens[i] = draw.array[k]!;
    });
    best = tokens;
    if (!hasAdjacentRed(tokens, neighbors)) break;
  }
  return { rng: s, tokens: best ?? hexTerrain.map(() => null) };
}

/** Locate the HexId of a cell (q,r) in the geometry, or throw if absent. */
function hexIdOfCell(geometry: BoardGeometry, q: number, r: number): HexId {
  const hex = geometry.hexes.find((h) => h.q === q && h.r === r);
  if (!hex) throw new Error(`BUG: scenario cell (${q},${r}) is not in the geometry`);
  return hex.id;
}

export interface ScenarioBoardResult {
  rng: number;
  board: GameState['board'];
  hexTerrain: ScenarioTerrain[];
  /** The pirate's start sea hex (S8.1, from `scenario.pirateStart`). */
  pirate: HexId;
}

/**
 * Build a seafarers game's `board` (+ authoritative `hexTerrain`) from the scenario data,
 * deterministically from the threaded rng. Order: terrain (S10.4) → tokens (S10.4) → harbors drawn
 * face-down onto the scenario's harbor edges (S2.3) → robber start (S10.3/ER-S6). Throws for a config
 * that isn't a shipped 3/4-player seafarers scenario (createGame validates before calling this).
 */
export function generateScenarioBoard(
  rng: number,
  config: Pick<GameConfig, 'expansions' | 'playerCount'>
): ScenarioBoardResult {
  const scenarioBoard = scenarioBoardFor(config);
  const geometry = scenarioGeometryFor(config);
  if (!scenarioBoard || !geometry) {
    throw new Error('BUG: generateScenarioBoard called for a non-scenario config');
  }

  const neighbors = hexNeighbors(geometry);
  const terrainRes = assignTerrain(rng, scenarioBoard);
  const hexTerrain = terrainRes.hexTerrain;
  const tokenRes = assignTokens(terrainRes.rng, scenarioBoard, hexTerrain, neighbors);
  let s = tokenRes.rng;

  const hexes: HexTile[] = hexTerrain.map((t, i) => ({
    terrain: terrainProxy(t),
    token: tokenRes.tokens[i] ?? null,
  }));

  // S2.3: draw the harbor mix face-down onto the scenario's (interior sea↔land) harbor edges.
  const resolved = resolveScenarioHarbors(scenarioBoard, geometry);
  const harborDraw = shuffle(s, [...scenarioBoard.harborMix]);
  s = harborDraw.state;
  const harbors: Record<number, HarborType> = {};
  resolved.forEach((h, i) => {
    const type = harborDraw.array[i];
    if (type === undefined) throw new Error(`BUG: no harbor type for scenario harbor ${i}`);
    harbors[h.edge] = type;
  });

  // S10.3/ER-S6: robber start. Data pins a cell for both shipped boards (4p desert / 3p (3,-3)); a
  // null (off-board) start isn't representable by the base `robber: HexId` field, so fall back to the
  // first sea hex as an inert holding cell (produces nothing) if a future scenario leaves it null.
  const start = scenarioBoard.robberStart;
  const robber: HexId =
    start !== null
      ? hexIdOfCell(geometry, start.q, start.r)
      : (hexTerrain.findIndex((t) => t === 'sea') as HexId);

  // S8.1: the pirate starts on the scenario's marked sea cell.
  const pirate = hexIdOfCell(geometry, scenarioBoard.pirateStart.q, scenarioBoard.pirateStart.r);

  return {
    rng: s,
    board: { hexes, robber, harbors },
    hexTerrain,
    pirate,
  };
}

/** The Fog Islands (T-756) seeded fog block — the hidden hex set + the shuffled reveal stack. */
export interface ScenarioFogSeed {
  hidden: HexId[];
  stack: { terrain: ScenarioTerrain; token: number | null }[];
}

/**
 * Fog Islands (T-756, S-analogue of E&P's `seedExplorationV0`): resolve `scenarioBoard.fog`'s cells
 * to concrete `HexId`s and shuffle its tile multiset via the threaded `rng` into the reveal stack,
 * once at `createGame`. Returns `null` for every OTHER scenario/board (no `fog` block) — so a
 * non-Fog-Islands game's rng/ext are completely unaffected by this task (RK-13-adjacent). Throws
 * (BUG:) if `fog.cells`/`fog.tiles` are mismatched in length — a scenario-data invariant, defensive
 * only (scenario.ts's `fogTiles` helper already guarantees this at module load).
 */
export function seedScenarioFog(
  rng: number,
  config: Pick<GameConfig, 'expansions' | 'playerCount'>
): { rng: number; fog: ScenarioFogSeed } | null {
  const scenarioBoard = scenarioBoardFor(config);
  const geometry = scenarioGeometryFor(config);
  const fog = scenarioBoard?.fog;
  if (!scenarioBoard || !geometry || !fog) return null;

  const hidden = fog.cells.map((c) => hexIdOfCell(geometry, c.q, c.r));
  const draw = shuffle(rng, [...fog.tiles]);
  if (hidden.length !== draw.array.length) {
    throw new Error('BUG: seedScenarioFog: scenario fog.cells/fog.tiles length mismatch');
  }
  return { rng: draw.state, fog: { hidden, stack: draw.array } };
}

/**
 * Cloth for Hexhaven (T-757): resolve `scenarioBoard.villages`' cells to concrete `HexId`s, or `[]` for
 * every OTHER scenario/config (no `villages` block). Purely positional and deterministic — no `rng`
 * draw needed (unlike `seedScenarioFog`'s shuffled reveal stack), since a village produces off
 * whatever token S10.4's per-game terrain/token randomization happens to leave on that hex, exactly
 * like a gold hex does (see scenario.ts's CLOTH_FOR_HEXHAVEN header). Called on demand (memoized
 * indirectly via `scenarioGeometryFor`'s own cache) rather than seeded once into `ext.seafarers` at
 * `createGame`, since the result never changes over a game.
 */
export function scenarioVillageHexesFor(config: Pick<GameConfig, 'expansions' | 'playerCount'>): readonly HexId[] {
  const scenarioBoard = scenarioBoardFor(config);
  const geometry = scenarioGeometryFor(config);
  const villages = scenarioBoard?.villages;
  if (!scenarioBoard || !geometry || !villages) return [];
  return villages.map((c) => hexIdOfCell(geometry, c.q, c.r));
}

/** One resolved stop on the Pirate Islands (T-758) auto-moving pirate track. */
export interface ResolvedPirateTrackEntry {
  hex: HexId;
  safe: boolean;
}

/**
 * The Pirate Islands (T-758) auto-moving pirate track, resolved to concrete `HexId`s in scenario
 * order, or `[]` for every OTHER scenario/config (no `pirateTrack` block). Purely positional and
 * deterministic — no `rng` draw needed (mirrors `scenarioVillageHexesFor` above). Called on demand
 * (memoized indirectly via `scenarioGeometryFor`'s own cache) rather than seeded once into
 * `ext.seafarers` at `createGame`, since the resolved track never changes over a game — only the
 * mutable `pirateTrackIndex` (state.ts) does.
 */
export function scenarioPirateTrackFor(
  config: Pick<GameConfig, 'expansions' | 'playerCount'>
): readonly ResolvedPirateTrackEntry[] {
  const scenarioBoard = scenarioBoardFor(config);
  const geometry = scenarioGeometryFor(config);
  const track = scenarioBoard?.pirateTrack;
  if (!scenarioBoard || !geometry || !track) return [];
  return track.map((t) => ({ hex: hexIdOfCell(geometry, t.cell.q, t.cell.r), safe: t.safe }));
}

/**
 * The Pirate Islands (T-758) pirate-lair hexes, resolved to concrete `HexId`s, or `[]` for every
 * OTHER scenario/config (no `lairs` block). Purely positional, mirrors `scenarioVillageHexesFor`.
 */
export function scenarioLairHexesFor(config: Pick<GameConfig, 'expansions' | 'playerCount'>): readonly HexId[] {
  const scenarioBoard = scenarioBoardFor(config);
  const geometry = scenarioGeometryFor(config);
  const lairs = scenarioBoard?.lairs;
  if (!scenarioBoard || !geometry || !lairs) return [];
  return lairs.map((c) => hexIdOfCell(geometry, c.q, c.r));
}
