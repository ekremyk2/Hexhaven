// Seafarers scenario schema + data (T-701/T-702, docs/rules/seafarers-rules.md §S10, docs/10 §5).
//
// A `Scenario` is PURE DATA — the Seafarers analogue of a `RuleModule`'s board data (T-601): it
// carries the board layout (land + sea cells), the victory-point target, the small-island bonus-VP
// rule, the number-token / harbor multisets, and the pirate/robber start cells. Later Phase-7 tasks
// (ships engine, gold/pirate/chit + scenario win, rendering, picker UI) consume this record;
// nothing here has engine behavior.
//
// T-702 STEP 1 — REAL "Heading for New Shores" board geometry (this file). The cell coordinates below
// are the actual 3-player (p.9) and 4-player (p.10) setup frames from the official booklet, traced in
// `docs/rules/preset-boards-RESEARCH.md` §B (lattice-fit to the printed diagrams; land structure /
// harbor cells / pirate / robber are HIGH confidence, the open-sea-tile ↔ frame boundary is MEDIUM).
// The verified MULTISETS (S10.2 — terrain per region, tokens, harbors) are unchanged from T-701.
//
// Terrain is placed RANDOMLY within each region's multiset at game-generation time (S10.4); the
// per-cell `terrain` in `hexes` below is therefore an EXAMPLE fill that realizes the exact region
// multiset, NOT a fixed board — with the sole exception of the 4p desert, which is fixed at (-1,0)
// (the robber start, S10.3). Downstream game-gen re-randomizes land terrain within region.

import type { HarborType } from './constants.js';
import type { BoardLayout, BoardGeometry, GeometryEdge } from './geometry.js';
import type { EdgeId, HexId } from './types.js';
import type { ScenarioTerrain } from './types.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Shipped scenario ids. Start with the MVP intro scenario; more are pure-data additions later. */
export type ScenarioId =
  | 'headingForNewShores'
  | 'newWorld'
  | 'throughTheDesert'
  | 'forgottenTribe'
  | 'sixIslands'
  | 'fogIslands'
  | 'clothForHexhaven'
  | 'pirateIslands'
  | 'wondersOfHexhaven';

export const SCENARIO_IDS = [
  'headingForNewShores',
  'newWorld',
  'throughTheDesert',
  'forgottenTribe',
  'sixIslands',
  'fogIslands',
  'clothForHexhaven',
  'pirateIslands',
  'wondersOfHexhaven',
] as const satisfies readonly ScenarioId[];

/** Structural region of a scenario cell (S10.2). `sea` = frame/water (S3.1); land splits into the
 *  `main` island (starting settlements go here, S10.5) and the `small` islands that score bonus VP
 *  the first time a player settles them (S10.6). */
export type HexRegion = 'sea' | 'main' | 'small';

/** Axial cell coordinate. */
export interface Cell {
  q: number;
  r: number;
}

/** One cell of a scenario board, aligned to `layout.hexes` by `(q, r)`. */
export interface ScenarioHex {
  q: number;
  r: number;
  /** EXAMPLE terrain realizing the region multiset (S10.4 randomizes it at game-gen); the 4p desert
   *  at (-1,0) is the one fixed land terrain. Sea cells are always `sea`. */
  terrain: ScenarioTerrain;
  region: HexRegion;
  /** Small-island group id (0-based), present only when `region === 'small'`. Cells sharing an id
   *  form one island for S10.6 bonus-VP scoring (research §B: 3 islands A/B/C per board). */
  island?: number;
}

/**
 * A scenario harbor, positioned by the SEA cell it sits in and the main-island hex(es) its dock
 * faces (research §B.1/§B.2 harbor tables). Seafarers harbors sit on INTERIOR island coasts (a
 * sea↔land edge), which `layout.harborCoastIndices` (indices into the OUTER coast cycle) cannot
 * express — hence this explicit representation. `resolveScenarioHarbors` turns each into the concrete
 * coastal `EdgeId` via geometry. The harbor TYPE is drawn face-down from `harborMix` at setup
 * (S2.3), so only POSITION is pinned here; `faces[0]` is the land hex the edge borders.
 */
export interface ScenarioHarbor {
  sea: Cell;
  /** Main-island hex(es) the harbor faces; `faces[0]` is edge-adjacent to `sea` (the harbor edge). A
   *  second entry documents the harbor mouth spanning toward that neighbour (MEDIUM: exact vertex). */
  faces: Cell[];
}

/** Board composition for one player count. The `layout` is what `buildGeometry` consumes; `hexes`
 *  is the aligned terrain/region classification; the multisets are the verified S10.2 data. */
export interface ScenarioBoard {
  playerCount: 3 | 4 | 5 | 6;
  /** Full hex grid (land + sea) for `buildGeometry` — the scenario frame. */
  layout: BoardLayout;
  /** Per-cell terrain/region/island, one entry per `layout.hexes`, in `(r, q)` (HexId) order. */
  hexes: ScenarioHex[];
  /** Verified production-number multiset placed randomly over the land hexes (S10.2, S10.4). */
  tokens: readonly number[];
  /** Verified harbor-token multiset; drawn face-down onto the scenario's harbor edges (S10.2/S2.3). */
  harborMix: readonly HarborType[];
  /** Harbor POSITIONS (research §B tables). `harborMix.length === harbors.length`; resolve to edges
   *  with `resolveScenarioHarbors`. Replaces the empty `layout.harborCoastIndices` (interior coasts). */
  harbors: readonly ScenarioHarbor[];
  /** Sea cell the pirate starts on (S8.1 — pirate-ship icon in the diagram). */
  pirateStart: Cell;
  /** Land cell the robber starts on, or `null` to start off-board and be placed on its first move
   *  (ER-S6). 4p: the desert (-1,0), verified. 3p: the diagram draws the robber on small-island cell
   *  (3,-3); ER-S6 off-board (`null`) is the defensible alternative for the desert-less board. */
  robberStart: Cell | null;
  /**
   * "The Fog Islands" (T-756) fog block: a SUBSET of `sea` cells that start face-down and are
   * revealed one at a time as a player's ship reaches an adjacent edge (S-analogue of the Explorers &
   * Pirates exploration fog, `modules/explorersPirates/exploration.ts` — mirrored in SHAPE only, no
   * shared code, docs/10 §3). Structurally these cells are `region: 'sea'` (they produce nothing and
   * behave exactly like open water until revealed, `buildScenarioBoard`'s normal terrain/token
   * assignment never touches them) — `fog.cells` and `fog.tiles` are ADDITIONAL bookkeeping the
   * engine (`modules/seafarers/board.ts`'s `seedScenarioFog`) reads at `createGame` to seed the
   * hidden reveal stack; `tiles.length` MUST equal `cells.length` (one draw per fog hex). Present ONLY
   * on the Fog Islands scenario's boards — every other `ScenarioBoard` (and this scenario's own
   * output before this field is spread on, see FOG_ISLANDS below) omits it entirely, so
   * `buildScenarioBoard` itself needed NO changes and every other scenario's board shape is
   * byte-identical to before this task.
   */
  fog?: {
    cells: readonly Cell[];
    /** The shuffled-at-seed-time draw pile's UNSHUFFLED source multiset (shuffling happens once, at
     *  `createGame`, threaded through `state.rng` — see `seedScenarioFog`). `terrain` is never `'sea'`
     *  (a fog tile always resolves to real land or a gold field, S9); `token` is `null` only for a
     *  `'desert'` tile (if any — this task's realization uses none, ⚠ VERIFY against the physical
     *  Fog Islands booklet). */
    tiles: readonly { terrain: ScenarioTerrain; token: number | null }[];
  };
  /**
   * "Cloth for Hexhaven" (T-757) village hexes: a SUBSET of `small`-region cells that produce cloth
   * tokens on their own number roll (reusing the hex's own randomly-assigned terrain/token — no
   * separate multiset, unlike `fog` above). `modules/seafarers/board.ts`'s `scenarioVillageHexesFor`
   * resolves these to concrete `HexId`s at read time (no `rng` draw needed — deterministic, purely
   * positional); `modules/seafarers/cloth.ts` grants 1 cloth per qualifying seat when a village's
   * CURRENT (per-game, S10.4-randomized) token matches the roll. Present ONLY on the Cloth for Hexhaven
   * scenario's boards — every other `ScenarioBoard` omits it entirely, so this field touches nothing
   * else (RK-13-adjacent, mirrors `fog`'s own isolation).
   */
  villages?: readonly Cell[];
  /**
   * "The Pirate Islands" (T-758) auto-moving pirate track: an ORDERED list of `sea`-region cells the
   * pirate steps through one per dice roll (wrapping at the end), each flagged `safe` (a `!` cell in
   * the printed booklet, where the pirate is inert that turn — no S8.5 blocking) or not.
   * `modules/seafarers/board.ts`'s `scenarioPirateTrackFor` resolves these to concrete `HexId`s at read
   * time (positional, no `rng` draw needed — mirrors `villages` above). Present ONLY on the Pirate
   * Islands scenario's boards — every other `ScenarioBoard` omits it entirely, so this field touches
   * nothing else (RK-13-adjacent, mirrors `fog`/`villages`'s own isolation).
   */
  pirateTrack?: readonly { cell: Cell; safe: boolean }[];
  /**
   * "The Pirate Islands" (T-758) pirate-lair hexes: the FIRST seat to place a ship or settlement on an
   * edge/vertex touching one captures it for a small VP bonus (`modules/seafarers/lairs.ts`'s
   * `grantLairCapture`, mirroring `chits.ts`'s island-chit shape). `modules/seafarers/board.ts`'s
   * `scenarioLairHexesFor` resolves these to concrete `HexId`s at read time (positional, mirrors
   * `pirateTrack` above). Present ONLY on the Pirate Islands scenario's boards.
   */
  lairs?: readonly Cell[];
}

/** A full scenario: board data per player count + the scenario-level rules (S10.1/S10.6). */
export interface Scenario {
  id: ScenarioId;
  /** Victory-point target — 14 for "Heading for New Shores" (S10.1), not the base 10. */
  targetVp: number;
  /** Bonus VP for the first settlement a player builds on each small island (S10.6). Used as-is for
   *  every scenario EXCEPT one that defines `islandRewards` (T-754), where it is only the fallback for
   *  an island id absent from that table. */
  smallIslandVp: number;
  /** OPTIONAL per-island reward table (T-754, "The Forgotten Tribe") — small-island group id → the VP
   *  granted for the first settlement built there, REPLACING the flat `smallIslandVp` for islands
   *  present in the table (an id absent from the table still falls back to `smallIslandVp`). Absent
   *  entirely (every scenario before T-754) ⇒ `grantIslandChit`/`islandChitVp` keep the flat
   *  `smallIslandVp`-per-island behaviour byte-for-byte — this field is opt-in, config-gated by
   *  scenario data, never by a new event/action/phase. The real "Forgotten Tribe" tokens mix VP/
   *  harbor/resource bonuses; this table APPROXIMATES all of them as VP (⚠ VERIFY, see `verify[]`). */
  islandRewards?: Record<number, number>;
  /** Board data per SUPPORTED player count. A PARTIAL record (Phase 7B): the base Seafarers box ships
   *  3/4-player boards; the Seafarers 5–6 extension adds 5/6-player scenario boards. A scenario only
   *  has entries for the counts it actually supports — `scenarioBoardFor`/the fiveSix+seafarers guard
   *  read `boards[playerCount]` and gate on its presence. */
  boards: Partial<Record<3 | 4 | 5 | 6, ScenarioBoard>>;
  /** Human-facing verification flags: what must be checked against the printed diagrams before this
   *  scenario is played/rendered (S10.7). Kept in-data so downstream tasks surface it, not lose it. */
  verify: readonly string[];
}

// ---------------------------------------------------------------------------
// "Heading for New Shores" — verified multisets (S10.2), authoritative
// ---------------------------------------------------------------------------

type LandCounts = Partial<Record<ScenarioTerrain, number>>;

interface CountSpec {
  /** Land terrains of the main island (S10.2). */
  mainLand: LandCounts;
  /** Land terrains of the small islands (S10.2). */
  smallLand: LandCounts;
  tokens: readonly number[];
  harborMix: readonly HarborType[];
}

/** S10.2 (3 players): 14 main land + 8 small land + 13 sea = 35 hexes. */
const SPEC_3P: CountSpec = {
  mainLand: { fields: 3, hills: 2, mountains: 2, pasture: 4, forest: 3 }, // 14
  smallLand: { gold: 2, fields: 1, hills: 2, mountains: 2, pasture: 1 }, // 8
  // 22 tokens = 14 main + 8 small (S10.2 columns, combined).
  tokens: [2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 8, 8, 8, 9, 9, 10, 10, 10, 11, 11, 12],
  // 8 harbors = one 2:1 per resource + 3 generic 3:1.
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic'],
};

/** S10.2 (4 players): 19 main land + 9 small land + 14 sea = 42 hexes. */
const SPEC_4P: CountSpec = {
  mainLand: { desert: 1, fields: 4, hills: 3, mountains: 3, pasture: 4, forest: 4 }, // 19
  smallLand: { gold: 2, fields: 1, hills: 2, mountains: 2, pasture: 1, forest: 1 }, // 9
  // 27 tokens = 18 main + 9 small (the 1 desert carries none).
  tokens: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12],
  // 9 harbors = one 2:1 per resource + 4 generic 3:1.
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic', 'generic'],
};

// T-751 (Seafarers 5–6 extension) — 5p/6p multisets. The PDF setup diagrams for these boards could
// not be rendered on this machine (README Phase 7B fidelity caveat); the 6p resource/sea/hex totals
// below are the one verified figure handed down for this task, everything else (main/small split,
// exact tokens, harbor composition, and the ENTIRE 5p multiset) is a best-effort reconstruction
// following the SPEC_3P/SPEC_4P pattern (gold only on small islands, desert only on main). Flagged
// exhaustively in `HEADING_FOR_NEW_SHORES.verify`.

/** ⚠ VERIFY (T-751): 6 players — 56 hexes total (sea 16 · gold 3 · hills 7 · forest 7 · pasture 7 ·
 *  fields 7 · mountains 7 · desert 2, verified) → 40 land + 16 sea = 56; 38 numbered hexes = 38
 *  tokens. Main/small split (27/13) and per-region breakdown are NOT verified — best-effort, mirrors
 *  the 4p pattern (gold only on small islands, desert only on main). */
const SPEC_6P: CountSpec = {
  mainLand: { desert: 2, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5 }, // 27
  smallLand: { gold: 3, fields: 2, hills: 2, mountains: 2, pasture: 2, forest: 2 }, // 13
  // 38 tokens = 27 main (25 non-desert) + 13 small. ⚠ VERIFY: exact printed multiset not in hand —
  // this is a best-effort balanced distribution (no 7; extremes 2/12 ×3, all others ×4).
  tokens: [
    2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10,
    11, 11, 11, 11, 12, 12, 12,
  ],
  // 11 harbors = 6× resource 2:1 (verified count) + 5× generic 3:1 (verified count). ⚠ VERIFY: which
  // resource is doubled is NOT verified — wool chosen to mirror the base 5–6 extension's own
  // EXT56_HARBOR_MIX convention (constants.ts X5: base + wool doubled), not a seafarers-specific source.
  harborMix: ['brick', 'lumber', 'wool', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic', 'generic', 'generic'],
};

/** ⚠ VERIFY (T-751): 5 players — ENTIRELY best-effort, no printed diagram or multiset in hand. Sized
 *  as a proportionally smaller board than SPEC_6P (48 hexes: sea 14 + land 34), same main/small
 *  pattern (gold only on small, desert only on main). Every number here is invented, not sourced. */
const SPEC_5P: CountSpec = {
  mainLand: { desert: 2, fields: 4, hills: 4, mountains: 4, pasture: 4, forest: 4 }, // 22
  smallLand: { gold: 2, fields: 2, hills: 2, mountains: 2, pasture: 2, forest: 2 }, // 12
  // 32 tokens = 22 main (20 non-desert) + 12 small. ⚠ VERIFY: invented balanced distribution (no 7).
  tokens: [
    2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 11, 11, 11,
    12, 12,
  ],
  // 10 harbors = one 2:1 per resource + 5 generic 3:1. ⚠ VERIFY: count and composition both invented.
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic', 'generic', 'generic'],
};

// ---------------------------------------------------------------------------
// Real frames (research §B — traced from the printed setup diagrams)
// ---------------------------------------------------------------------------

const cell = (q: number, r: number): Cell => ({ q, r });

/** One small island: a group id + its land cells (research §B island tables). */
interface IslandGroup {
  island: number;
  cells: Cell[];
}

/** The full frame of one scenario board: land regions + sea cells + harbors + starts. */
interface Frame {
  main: Cell[];
  /** Small islands, each = one group for the S10.6 bonus (A=0, B=1, C=2 in research order). */
  small: IslandGroup[];
  sea: Cell[];
  /** Fixed desert cell(s) (4p: 1; 5p/6p: 2, T-751). Any main cell in this list is forced to
   *  `desert` terrain regardless of `mainLand` flatten order; count must match `mainLand.desert`. */
  desert?: Cell[];
  harbors: ScenarioHarbor[];
  pirateStart: Cell;
  robberStart: Cell | null;
}

// --- 3-player frame (research §B.1): 14 main + 8 small + 13 sea = 35 --------
const FRAME_3P: Frame = {
  // Main island — 14 land (S10.5 starting settlements go here).
  main: [
    cell(-3, 0), cell(-2, -1), cell(-1, -2), cell(0, -2), cell(1, -2),
    cell(-2, 0), cell(-1, -1), cell(0, -1), cell(1, -1),
    cell(-3, 1), cell(-2, 1), cell(-1, 0), cell(0, 0), cell(-1, 1),
  ],
  // Small islands — 8 land in 3 groups (each = one island for +2 VP, S10.6).
  small: [
    { island: 0, cells: [cell(3, -3), cell(3, -2)] }, // A (top-right)
    { island: 1, cells: [cell(1, 1), cell(2, 0), cell(2, 1), cell(0, 2)] }, // B (right/bottom)
    { island: 2, cells: [cell(-3, 3), cell(-2, 3)] }, // C (bottom-left)
  ],
  // Sea — 13 (8 harbor cells + pirate + 4 open-sea).
  sea: [
    cell(-2, -2), cell(0, -3), cell(1, -3), cell(-3, -1), cell(-4, 1), cell(1, 0), cell(0, 1),
    cell(-3, 2), cell(0, 3), cell(2, -2), cell(2, -1), cell(-2, 2), cell(1, 2),
  ],
  // Harbors — 8, each on the sea↔main edge facing `faces[0]` (research §B.1 table).
  harbors: [
    { sea: cell(-2, -2), faces: [cell(-1, -2), cell(-2, -1)] },
    { sea: cell(0, -3), faces: [cell(0, -2), cell(-1, -2)] },
    { sea: cell(1, -3), faces: [cell(0, -2), cell(1, -2)] },
    { sea: cell(-3, -1), faces: [cell(-2, -1), cell(-3, 0)] },
    { sea: cell(-4, 1), faces: [cell(-3, 0), cell(-3, 1)] },
    { sea: cell(1, 0), faces: [cell(1, -1), cell(0, 0)] },
    { sea: cell(0, 1), faces: [cell(0, 0), cell(-1, 1)] },
    { sea: cell(-3, 2), faces: [cell(-3, 1), cell(-2, 1)] },
  ],
  pirateStart: cell(0, 3),
  // Diagram draws the robber on small-island cell (3,-3); ER-S6 off-board is the alternative.
  robberStart: cell(3, -3),
};

// --- 4-player frame (research §B.2): 19 main + 9 small + 14 sea = 42 --------
const FRAME_4P: Frame = {
  // Main island — 19 land incl. the desert at (-1,0).
  main: [
    cell(-1, -2), cell(0, -2), cell(1, -2),
    cell(-2, -1), cell(-1, -1), cell(0, -1),
    cell(-3, 0), cell(-2, 0), cell(-1, 0), cell(1, -1),
    cell(-3, 1), cell(-2, 1), cell(0, 0), cell(1, 0),
    cell(-3, 2), cell(-2, 2), cell(-1, 1), cell(0, 1),
    cell(-1, 2),
  ],
  small: [
    { island: 0, cells: [cell(3, -3), cell(3, -2)] }, // A (top-right)
    { island: 1, cells: [cell(3, 0), cell(2, 1), cell(2, 2), cell(1, 2), cell(0, 3)] }, // B
    { island: 2, cells: [cell(-3, 4), cell(-2, 4)] }, // C (bottom-left)
  ],
  // Sea — 14 (9 harbor cells + pirate + 4 open-sea). NOTE: research §B.2 reconstructed the open-sea
  // set as {(2,0),(0,2),(1,3),(-2,3)} (MEDIUM). That leaves (2,-2) an enclosed hole (an un-tiled cell
  // surrounded by 6 board cells) → an invalid two-cycle coastline. Tracing that boundary as sea and
  // dropping (2,0) (the peripheral channel cell between the main island and island B) yields the
  // single simple coastline `buildGeometry` requires, keeping 14 sea / 42 total. Flagged in verify[].
  sea: [
    cell(-2, -2), cell(0, -3), cell(-4, 0), cell(2, -3), cell(-4, 2), cell(2, -1), cell(-3, 3),
    cell(1, 1), cell(-1, 3), cell(0, 4), cell(2, -2), cell(0, 2), cell(-2, 3), cell(1, 3),
  ],
  desert: [cell(-1, 0)],
  harbors: [
    { sea: cell(-2, -2), faces: [cell(-1, -2), cell(-2, -1)] },
    { sea: cell(0, -3), faces: [cell(0, -2), cell(1, -2)] },
    { sea: cell(-4, 0), faces: [cell(-3, 0)] },
    { sea: cell(2, -3), faces: [cell(1, -2)] },
    { sea: cell(-4, 2), faces: [cell(-3, 1), cell(-3, 2)] },
    { sea: cell(2, -1), faces: [cell(1, -1), cell(1, 0)] },
    { sea: cell(-3, 3), faces: [cell(-3, 2), cell(-2, 2)] },
    { sea: cell(1, 1), faces: [cell(1, 0), cell(0, 1)] },
    { sea: cell(-1, 3), faces: [cell(-1, 2), cell(0, 1)] },
  ],
  pirateStart: cell(0, 4),
  robberStart: cell(-1, 0), // the desert (verified)
};

// --- 6-player frame (T-751, ⚠ VERIFY — best-effort, no printed diagram traced): -------------------
// 27 main + 13 small (4/5/4) + 16 sea = 56. Built as a solid, hole-free 9-row hex block (rows r=-4..4)
// so the union of ALL cells (main ∪ small ∪ sea) is exactly that block — buildGeometry's coastal
// cycle is a property of the FULL cell footprint, not the region labels, so any main/small/sea split
// over a hole-free block is automatically a single simple coastline (confirmed via buildGeometry in
// scenario.test.ts). Verified this way — no cell-for-cell fidelity to a printed board is claimed.
const FRAME_6P: Frame = {
  main: [
    cell(1, -4), cell(0, -3), cell(1, -3),
    cell(-2, -2), cell(-1, -2), cell(0, -2), cell(1, -2), cell(2, -2),
    cell(-3, -1), cell(-2, -1), cell(-1, -1), cell(0, -1), cell(1, -1), cell(2, -1),
    cell(-3, 0), cell(-2, 0), cell(-1, 0), cell(0, 0), cell(1, 0),
    cell(-4, 1), cell(-3, 1), cell(-2, 1), cell(-1, 1), cell(0, 1),
    cell(-4, 2), cell(-1, 2), cell(0, 2),
  ],
  small: [
    { island: 0, cells: [cell(3, -4), cell(4, -4), cell(4, -3), cell(4, -2)] }, // A (top-right)
    { island: 1, cells: [cell(4, 0), cell(3, 1), cell(2, 2), cell(2, 1), cell(1, 3)] }, // B (right/bottom)
    { island: 2, cells: [cell(-3, 3), cell(-3, 4), cell(-2, 4), cell(-1, 4)] }, // C (bottom-left)
  ],
  sea: [
    cell(2, -4), cell(3, -3), cell(2, -3), cell(3, -2), cell(4, -1), cell(3, -1), cell(3, 0),
    cell(1, 2), cell(1, 1), cell(2, 0), cell(0, 3), cell(0, 4), cell(-2, 3), cell(-2, 2),
    cell(-3, 2), cell(-1, 3),
  ],
  desert: [cell(0, 0), cell(-3, 0)],
  harbors: [
    { sea: cell(2, -4), faces: [cell(1, -4)] },
    { sea: cell(3, -3), faces: [cell(2, -2)] },
    { sea: cell(2, -3), faces: [cell(1, -3)] },
    { sea: cell(3, -2), faces: [cell(2, -2)] },
    { sea: cell(3, -1), faces: [cell(2, -1)] },
    { sea: cell(1, 2), faces: [cell(0, 2)] },
    { sea: cell(1, 1), faces: [cell(0, 1)] },
    { sea: cell(2, 0), faces: [cell(1, 0)] },
    { sea: cell(-1, 3), faces: [cell(0, 2)] },
    { sea: cell(-2, 3), faces: [cell(-1, 2)] },
    { sea: cell(-3, 2), faces: [cell(-4, 2)] },
  ],
  pirateStart: cell(0, 4),
  robberStart: cell(0, 0), // one of the two desert cells; ⚠ VERIFY (arbitrary pick, not sourced)
};

// --- 5-player frame (T-751, ⚠ VERIFY — ENTIRELY best-effort, no printed diagram in hand): ----------
// 22 main + 12 small (4/4/4) + 14 sea = 48. Same hole-free-block construction as FRAME_6P (a subset
// of its 9-row block, dropping the outermost top/bottom rows), so the single-simple-coastline
// property holds for the same reason — verified via buildGeometry in scenario.test.ts.
const FRAME_5P: Frame = {
  main: [
    cell(0, -3), cell(1, -3),
    cell(-2, -2), cell(-1, -2), cell(0, -2),
    cell(-3, -1), cell(-2, -1), cell(-1, -1), cell(0, -1), cell(1, -1), cell(2, -1),
    cell(-3, 0), cell(-2, 0), cell(-1, 0), cell(0, 0), cell(1, 0), cell(2, 0),
    cell(-4, 1), cell(-1, 1), cell(0, 1), cell(1, 1),
    cell(-4, 2),
  ],
  small: [
    { island: 0, cells: [cell(2, -3), cell(3, -3), cell(4, -3), cell(4, -2)] }, // A (top-right)
    { island: 1, cells: [cell(4, 0), cell(3, 1), cell(2, 2), cell(1, 3)] }, // B (right/bottom)
    { island: 2, cells: [cell(-3, 2), cell(-3, 3), cell(-2, 3), cell(-1, 3)] }, // C (bottom-left)
  ],
  sea: [
    cell(2, -2), cell(1, -2), cell(3, -2), cell(4, -1), cell(3, -1), cell(3, 0), cell(2, 1),
    cell(1, 2), cell(0, 3), cell(-2, 2), cell(-2, 1), cell(-3, 1), cell(-1, 2), cell(0, 2),
  ],
  desert: [cell(0, 0), cell(-3, 0)],
  harbors: [
    { sea: cell(2, -2), faces: [cell(2, -1)] },
    { sea: cell(1, -2), faces: [cell(0, -2)] },
    { sea: cell(3, -1), faces: [cell(2, -1)] },
    { sea: cell(3, 0), faces: [cell(2, 0)] },
    { sea: cell(2, 1), faces: [cell(1, 1)] },
    { sea: cell(-2, 2), faces: [cell(-1, 1)] },
    { sea: cell(-2, 1), faces: [cell(-1, 1)] },
    { sea: cell(-3, 1), faces: [cell(-4, 1)] },
    { sea: cell(-1, 2), faces: [cell(0, 1)] },
    { sea: cell(0, 2), faces: [cell(1, 1)] },
  ],
  pirateStart: cell(0, 3),
  robberStart: cell(0, 0), // one of the two desert cells; ⚠ VERIFY (arbitrary pick, not sourced)
};

// ---------------------------------------------------------------------------
// "New World" (T-752, Seafarers 5–6 extension) — RANDOM-BY-DESIGN, no printed diagram
// ---------------------------------------------------------------------------
// The official "New World" scenario ships with NO canonical layout — the rulebook has the players
// assemble the board randomly from a fixed piece pool each game (unlike "Heading for New Shores",
// which traces a printed setup diagram). There is therefore nothing to be unfaithful to: a balanced,
// convention-following terrain/token/harbor multiset over a hole-free frame (main island + 3 small
// island groups + sea, same shape family as HEADING_FOR_NEW_SHORES) IS a correct New World board.
// Every figure below is nonetheless a CHOSEN best-effort split (the printed piece-pool COUNTS were
// not transcribed on this machine) — flagged once in `NEW_WORLD.verify` rather than per-field, since
// "best-effort by design" applies uniformly here (no partial fidelity claim to walk back).
// Ships ONLY at 5/6 players (S10.1-style "5–6 extension" scenario, `boardPresets.ts` gates the
// picker to `players: [5, 6]`) — no 3p/4p entries in `boards`.

/** 6 players — 63 hexes (sea 18 · land 45 = desert 2 + gold 3 + 40 resources, 8/type). */
const NW_SPEC_6P: CountSpec = {
  mainLand: { desert: 2, fields: 6, hills: 6, mountains: 6, pasture: 6, forest: 6 }, // 32
  smallLand: { gold: 3, fields: 2, hills: 2, mountains: 2, pasture: 2, forest: 2 }, // 13
  // 43 tokens = 30 main (non-desert) + 13 small. Balanced, no 7.
  tokens: [
    2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9,
    10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 12,
  ],
  // 11 harbors = 6 resource 2:1 (ore doubled — arbitrary, ⚠ VERIFY) + 5 generic 3:1.
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'ore', 'generic', 'generic', 'generic', 'generic', 'generic'],
};

/** 5 players — 54 hexes (sea 15 · land 39 = desert 2 + gold 2 + 35 resources, 7/type), the same
 *  shape scaled down. */
const NW_SPEC_5P: CountSpec = {
  mainLand: { desert: 2, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5 }, // 27
  smallLand: { gold: 2, fields: 2, hills: 2, mountains: 2, pasture: 2, forest: 2 }, // 12
  // 37 tokens = 25 main (non-desert) + 12 small. Balanced, no 7.
  tokens: [
    2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10,
    11, 11, 11, 12, 12, 12,
  ],
  // 10 harbors = one 2:1 per resource + 5 generic 3:1.
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic', 'generic', 'generic'],
};

// --- 6-player frame (T-752): a solid, hole-free 9×7 rectangle block (r=-4..4, q=0..6) = 63 cells,
// so ANY main/small/sea partition of it is a single simple coastline (same trick as FRAME_5P/6P
// above — verified via buildGeometry in scenario.test.ts). Main = the left 4 columns (q0-3) over 8
// rows (r=-3..4, a solid rectangle, trivially connected); 3 small island groups sit in the right 3
// columns (q4-6), each a connected cluster; sea fills the remaining right-column cells.
const NW_FRAME_6P: Frame = {
  main: [
    cell(0, -3), cell(1, -3), cell(2, -3), cell(3, -3),
    cell(0, -2), cell(1, -2), cell(2, -2), cell(3, -2),
    cell(0, -1), cell(1, -1), cell(2, -1), cell(3, -1),
    cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0),
    cell(0, 1), cell(1, 1), cell(2, 1), cell(3, 1),
    cell(0, 2), cell(1, 2), cell(2, 2), cell(3, 2),
    cell(0, 3), cell(1, 3), cell(2, 3), cell(3, 3),
    cell(0, 4), cell(1, 4), cell(2, 4), cell(3, 4),
  ],
  small: [
    { island: 0, cells: [cell(4, -4), cell(5, -4), cell(4, -3), cell(5, -3)] }, // A (top-right)
    { island: 1, cells: [cell(5, -1), cell(6, -1), cell(5, 0), cell(6, 0), cell(6, 1)] }, // B (right)
    { island: 2, cells: [cell(4, 3), cell(5, 3), cell(4, 4), cell(5, 4)] }, // C (bottom-right)
  ],
  sea: [
    cell(0, -4), cell(1, -4), cell(2, -4), cell(3, -4), cell(6, -4), cell(6, -3), cell(4, -2),
    cell(5, -2), cell(6, -2), cell(4, -1), cell(4, 0), cell(4, 1), cell(5, 1), cell(4, 2), cell(5, 2),
    cell(6, 2), cell(6, 3), cell(6, 4),
  ],
  desert: [cell(1, 0), cell(2, 1)],
  harbors: [
    { sea: cell(0, -4), faces: [cell(0, -3)] },
    { sea: cell(1, -4), faces: [cell(1, -3)] },
    { sea: cell(2, -4), faces: [cell(2, -3)] },
    { sea: cell(3, -4), faces: [cell(3, -3)] },
    { sea: cell(4, -2), faces: [cell(3, -2)] },
    { sea: cell(4, -1), faces: [cell(3, -1)] },
    { sea: cell(4, 0), faces: [cell(3, 0)] },
    { sea: cell(4, 1), faces: [cell(3, 1)] },
    { sea: cell(4, 2), faces: [cell(3, 2)] },
    { sea: cell(6, -4), faces: [cell(5, -4)] }, // faces small island A
    { sea: cell(6, -3), faces: [cell(5, -3)] }, // faces small island A
  ],
  pirateStart: cell(6, -2),
  robberStart: cell(1, 0), // one of the two desert cells (arbitrary pick — random-by-design)
};

// --- 5-player frame (T-752): same construction, a 9×6 rectangle (r=-4..4, q=0..5) = 54 cells. Main
// = the left 3 columns (q0-2) over all 9 rows (solid rectangle); 3 small island groups + sea fill
// the right 3 columns (q3-5).
const NW_FRAME_5P: Frame = {
  main: [
    cell(0, -4), cell(1, -4), cell(2, -4),
    cell(0, -3), cell(1, -3), cell(2, -3),
    cell(0, -2), cell(1, -2), cell(2, -2),
    cell(0, -1), cell(1, -1), cell(2, -1),
    cell(0, 0), cell(1, 0), cell(2, 0),
    cell(0, 1), cell(1, 1), cell(2, 1),
    cell(0, 2), cell(1, 2), cell(2, 2),
    cell(0, 3), cell(1, 3), cell(2, 3),
    cell(0, 4), cell(1, 4), cell(2, 4),
  ],
  small: [
    { island: 0, cells: [cell(3, -4), cell(4, -4), cell(3, -3), cell(4, -3)] }, // A (top-right)
    { island: 1, cells: [cell(4, -1), cell(5, -1), cell(4, 0), cell(5, 0)] }, // B (right)
    { island: 2, cells: [cell(3, 3), cell(4, 3), cell(3, 4), cell(4, 4)] }, // C (bottom-right)
  ],
  sea: [
    cell(5, -4), cell(5, -3), cell(3, -2), cell(4, -2), cell(5, -2), cell(3, -1), cell(3, 0),
    cell(3, 1), cell(4, 1), cell(5, 1), cell(3, 2), cell(4, 2), cell(5, 2), cell(5, 3), cell(5, 4),
  ],
  desert: [cell(1, 0), cell(1, 1)],
  harbors: [
    { sea: cell(3, -2), faces: [cell(2, -2)] },
    { sea: cell(3, -1), faces: [cell(2, -1)] },
    { sea: cell(3, 0), faces: [cell(2, 0)] },
    { sea: cell(3, 1), faces: [cell(2, 1)] },
    { sea: cell(3, 2), faces: [cell(2, 2)] },
    { sea: cell(5, -3), faces: [cell(4, -3)] }, // faces small island A
    { sea: cell(5, -2), faces: [cell(5, -1)] }, // faces small island B
    { sea: cell(5, 1), faces: [cell(5, 0)] }, // faces small island B
    { sea: cell(5, 3), faces: [cell(4, 3)] }, // faces small island C
    { sea: cell(5, 4), faces: [cell(4, 4)] }, // faces small island C
  ],
  pirateStart: cell(5, -4),
  robberStart: cell(1, 0), // one of the two desert cells (arbitrary pick — random-by-design)
};

// ---------------------------------------------------------------------------
// "Through the Desert" (T-753, Seafarers 5–6 extension) — one main island crossed by a desert band
// ---------------------------------------------------------------------------
// Through the Desert fits the same data model as Heading for New Shores / New World: ONE connected
// main island (S10.5), here containing a "crossing" — a contiguous BAND of desert hexes running
// through the main island that a player must build roads across to reach the resource land beyond
// it — plus 3 small-island groups past the coast (S10.6). No new mechanic: standard Seafarers ship/
// gold/island/pirate rules (S10.1's 14-VP target, S10.6's +2 small-island bonus).
//
// Only the hex TOTAL (~63 for 6p) was handed down for this task; the printed terrain/token/harbor
// multiset and the exact desert-band shape were NOT transcribed (the setup-diagram PDF can't render
// on this machine) — same "best-effort, flagged in verify[]" norm as T-751/T-752. The frame reuses
// the T-752 solid hole-free 9×7 / 9×6 rectangle-block construction (guarantees buildGeometry accepts
// a single simple coastline for ANY main/small/sea partition of the block, confirmed in
// scenario.test.ts) and places the desert band as a vertical run of cells in one interior column of
// the main island's rectangle — a straight line of mutually-adjacent hexes, i.e. a real "band" rather
// than scattered desert cells. Ships ONLY at 5/6 players (`boardPresets.ts` gates `players: [5, 6]`).

/** 6 players — 63 hexes (sea 18 · main 32 [desert 3 + 29 resource] · small 13 [gold 3 + 10 resource]). */
const TD_SPEC_6P: CountSpec = {
  mainLand: { desert: 3, fields: 6, hills: 6, mountains: 6, pasture: 5, forest: 6 }, // 32
  smallLand: { gold: 3, fields: 2, hills: 2, mountains: 2, pasture: 2, forest: 2 }, // 13
  // 42 tokens = 29 main (non-desert) + 13 small. Balanced, no 7, 6/8 the most common ("reds").
  tokens: [
    2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 10,
    10, 10, 10, 11, 11, 11, 11, 12, 12, 12,
  ],
  // 11 harbors = 6 resource 2:1 (grain doubled — arbitrary, ⚠ VERIFY) + 5 generic 3:1.
  harborMix: [
    'brick', 'lumber', 'wool', 'grain', 'grain', 'ore', 'generic', 'generic', 'generic', 'generic',
    'generic',
  ],
};

/** 5 players — 54 hexes (sea 15 · main 27 [desert 2 + 25 resource] · small 12 [gold 2 + 10 resource]),
 *  the same shape proportionally scaled down (T-753: crossing shrinks to a 2-cell band). */
const TD_SPEC_5P: CountSpec = {
  mainLand: { desert: 2, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5 }, // 27
  smallLand: { gold: 2, fields: 2, hills: 2, mountains: 2, pasture: 2, forest: 2 }, // 12
  // 37 tokens = 25 main (non-desert) + 12 small. Balanced, no 7.
  tokens: [
    2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10,
    11, 11, 11, 12, 12, 12,
  ],
  // 10 harbors = one 2:1 per resource + 5 generic 3:1 (no doubling — smaller board).
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic', 'generic', 'generic'],
};

// --- 6-player frame (T-753): same solid, hole-free 9×7 rectangle block (r=-4..4, q=0..6) = 63 cells
// as NW_FRAME_6P — main = left 4 columns (q0-3) over 8 rows (r=-3..4), 3 small island groups in the
// right 3 columns (q4-6), sea fills the rest. The DESERT band sits in the main block's column q=1,
// rows r=-1..1 — 3 vertically-adjacent cells (a straight line, same-q/r±1 neighbours), splitting the
// main island's resource hexes into a q=0 side and a q=2..3 side that players cross via roads.
const TD_FRAME_6P: Frame = {
  main: [
    cell(0, -3), cell(1, -3), cell(2, -3), cell(3, -3),
    cell(0, -2), cell(1, -2), cell(2, -2), cell(3, -2),
    cell(0, -1), cell(1, -1), cell(2, -1), cell(3, -1),
    cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0),
    cell(0, 1), cell(1, 1), cell(2, 1), cell(3, 1),
    cell(0, 2), cell(1, 2), cell(2, 2), cell(3, 2),
    cell(0, 3), cell(1, 3), cell(2, 3), cell(3, 3),
    cell(0, 4), cell(1, 4), cell(2, 4), cell(3, 4),
  ],
  small: [
    { island: 0, cells: [cell(4, -4), cell(5, -4), cell(4, -3), cell(5, -3)] }, // A (top-right)
    { island: 1, cells: [cell(5, -1), cell(6, -1), cell(5, 0), cell(6, 0), cell(6, 1)] }, // B (right)
    { island: 2, cells: [cell(4, 3), cell(5, 3), cell(4, 4), cell(5, 4)] }, // C (bottom-right)
  ],
  sea: [
    cell(0, -4), cell(1, -4), cell(2, -4), cell(3, -4), cell(6, -4), cell(6, -3), cell(4, -2),
    cell(5, -2), cell(6, -2), cell(4, -1), cell(4, 0), cell(4, 1), cell(5, 1), cell(4, 2), cell(5, 2),
    cell(6, 2), cell(6, 3), cell(6, 4),
  ],
  desert: [cell(1, -1), cell(1, 0), cell(1, 1)], // the crossing: a 3-cell vertical band
  harbors: [
    { sea: cell(0, -4), faces: [cell(0, -3)] },
    { sea: cell(1, -4), faces: [cell(1, -3)] },
    { sea: cell(2, -4), faces: [cell(2, -3)] },
    { sea: cell(3, -4), faces: [cell(3, -3)] },
    { sea: cell(4, -2), faces: [cell(3, -2)] },
    { sea: cell(4, -1), faces: [cell(3, -1)] },
    { sea: cell(4, 0), faces: [cell(3, 0)] },
    { sea: cell(4, 1), faces: [cell(3, 1)] },
    { sea: cell(4, 2), faces: [cell(3, 2)] },
    { sea: cell(6, -4), faces: [cell(5, -4)] }, // faces small island A
    { sea: cell(6, -3), faces: [cell(5, -3)] }, // faces small island A
  ],
  pirateStart: cell(6, -2),
  robberStart: cell(1, 0), // the middle desert cell of the crossing; ⚠ VERIFY (arbitrary pick)
};

// --- 5-player frame (T-753): same 9×6 rectangle (r=-4..4, q=0..5) = 54 cells as NW_FRAME_5P. The
// crossing shrinks to a 2-cell vertical band in column q=1, rows r=-1..0.
const TD_FRAME_5P: Frame = {
  main: [
    cell(0, -4), cell(1, -4), cell(2, -4),
    cell(0, -3), cell(1, -3), cell(2, -3),
    cell(0, -2), cell(1, -2), cell(2, -2),
    cell(0, -1), cell(1, -1), cell(2, -1),
    cell(0, 0), cell(1, 0), cell(2, 0),
    cell(0, 1), cell(1, 1), cell(2, 1),
    cell(0, 2), cell(1, 2), cell(2, 2),
    cell(0, 3), cell(1, 3), cell(2, 3),
    cell(0, 4), cell(1, 4), cell(2, 4),
  ],
  small: [
    { island: 0, cells: [cell(3, -4), cell(4, -4), cell(3, -3), cell(4, -3)] }, // A (top-right)
    { island: 1, cells: [cell(4, -1), cell(5, -1), cell(4, 0), cell(5, 0)] }, // B (right)
    { island: 2, cells: [cell(3, 3), cell(4, 3), cell(3, 4), cell(4, 4)] }, // C (bottom-right)
  ],
  sea: [
    cell(5, -4), cell(5, -3), cell(3, -2), cell(4, -2), cell(5, -2), cell(3, -1), cell(3, 0),
    cell(3, 1), cell(4, 1), cell(5, 1), cell(3, 2), cell(4, 2), cell(5, 2), cell(5, 3), cell(5, 4),
  ],
  desert: [cell(1, -1), cell(1, 0)], // the crossing: a 2-cell vertical band
  harbors: [
    { sea: cell(3, -2), faces: [cell(2, -2)] },
    { sea: cell(3, -1), faces: [cell(2, -1)] },
    { sea: cell(3, 0), faces: [cell(2, 0)] },
    { sea: cell(3, 1), faces: [cell(2, 1)] },
    { sea: cell(3, 2), faces: [cell(2, 2)] },
    { sea: cell(5, -3), faces: [cell(4, -3)] }, // faces small island A
    { sea: cell(5, -2), faces: [cell(5, -1)] }, // faces small island B
    { sea: cell(5, 1), faces: [cell(5, 0)] }, // faces small island B
    { sea: cell(5, 3), faces: [cell(4, 3)] }, // faces small island C
    { sea: cell(5, 4), faces: [cell(4, 4)] }, // faces small island C
  ],
  pirateStart: cell(5, -4),
  robberStart: cell(1, 0), // the "lower" desert cell of the crossing; ⚠ VERIFY (arbitrary pick)
};

// ---------------------------------------------------------------------------
// Board builder
// ---------------------------------------------------------------------------

/** Flatten a land-terrain count map into a repeated list (deterministic key order). */
function flattenLand(counts: LandCounts): ScenarioTerrain[] {
  const out: ScenarioTerrain[] = [];
  for (const [terrain, n] of Object.entries(counts) as [ScenarioTerrain, number][]) {
    for (let i = 0; i < n; i++) out.push(terrain);
  }
  return out;
}

const keyOf = (c: Cell): string => `${c.q},${c.r}`;

/**
 * Build a `ScenarioBoard` from a real frame + verified `CountSpec`.
 *
 * The frame (which cells are main/small/sea, island grouping, harbors, starts) is diagram-accurate
 * (research §B) for 3p/4p; best-effort (T-751, flagged in `verify[]`) for 5p/6p. Terrain is an
 * EXAMPLE fill realizing each region's exact multiset (S10.4 randomizes it at game-gen), except the
 * fixed desert cell(s) at `frame.desert` (4p: 1; 5p/6p: 2).
 */
function buildScenarioBoard(playerCount: 3 | 4 | 5 | 6, spec: CountSpec, frame: Frame): ScenarioBoard {
  // Example terrain fill per region (multiset-exact; spatial arrangement is illustrative).
  const mainTerrains = flattenLand(spec.mainLand);
  const smallTerrains = flattenLand(spec.smallLand);

  const desertKeys = new Set((frame.desert ?? []).map(keyOf));

  // Assign main terrains, forcing the fixed desert cell(s) and dealing the rest in order.
  const mainNonDesert = mainTerrains.filter((t) => t !== 'desert');
  const desertCount = mainTerrains.length - mainNonDesert.length;
  if (desertCount !== desertKeys.size) {
    throw new Error('BUG: scenario mainLand desert count does not match frame.desert cells');
  }
  let mainIdx = 0;
  const mainCells = frame.main.map((c) => {
    if (desertKeys.has(keyOf(c))) {
      return { c, terrain: 'desert' as ScenarioTerrain, region: 'main' as HexRegion };
    }
    const terrain = mainNonDesert[mainIdx++];
    if (terrain === undefined) throw new Error('BUG: scenario main terrain underflow');
    return { c, terrain, region: 'main' as HexRegion };
  });
  if (mainIdx !== mainNonDesert.length) throw new Error('BUG: scenario main terrain leftover');

  // Assign small-island terrains in group-then-cell order, tagging each with its island id.
  let smallIdx = 0;
  const smallCells: { c: Cell; terrain: ScenarioTerrain; region: HexRegion; island: number }[] = [];
  for (const group of frame.small) {
    for (const c of group.cells) {
      const terrain = smallTerrains[smallIdx++];
      if (terrain === undefined) throw new Error('BUG: scenario small terrain underflow');
      smallCells.push({ c, terrain, region: 'small', island: group.island });
    }
  }
  if (smallIdx !== smallTerrains.length) throw new Error('BUG: scenario small terrain leftover');

  const seaCells = frame.sea.map((c) => ({ c, terrain: 'sea' as ScenarioTerrain, region: 'sea' as HexRegion }));

  // Full coord set, sorted into HexId (r, q) order so `hexes[i]` aligns with `buildGeometry`.
  const all: { c: Cell; terrain: ScenarioTerrain; region: HexRegion; island?: number }[] = [
    ...mainCells,
    ...smallCells,
    ...seaCells,
  ];
  all.sort((a, b) => a.c.r - b.c.r || a.c.q - b.c.q);

  const hexes: ScenarioHex[] = all.map((x) =>
    x.island === undefined
      ? { q: x.c.q, r: x.c.r, terrain: x.terrain, region: x.region }
      : { q: x.c.q, r: x.c.r, terrain: x.terrain, region: x.region, island: x.island }
  );

  const coords = all.map((x) => ({ q: x.c.q, r: x.c.r }));
  // spiralStart must sit on the outermost ring; the (r,q)-minimal cell (topmost-then-leftmost) always
  // does (it has no r-1 neighbour, so < 6 neighbours). Token spiral is unused for this scenario (S10.4
  // randomizes tokens) but `buildGeometry` requires a valid start.
  const spiralStart = coords[0] ?? { q: 0, r: 0 };

  const layout: BoardLayout = {
    hexes: coords,
    // Empty: Seafarers harbors are interior sea↔land coasts, carried on `harbors` (resolved to edges
    // by `resolveScenarioHarbors`), not on the outer coast cycle this indexes into.
    harborCoastIndices: [],
    spiralStart,
  };

  return {
    playerCount,
    layout,
    hexes,
    tokens: spec.tokens,
    harborMix: spec.harborMix,
    harbors: frame.harbors,
    pirateStart: frame.pirateStart,
    robberStart: frame.robberStart,
  };
}

// ---------------------------------------------------------------------------
// Harbor resolver — scenario harbors → concrete geometry edges
// ---------------------------------------------------------------------------

/** A scenario harbor resolved to a concrete edge: the sea↔land coast the dock sits on. The harbor
 *  TYPE is not fixed here (drawn face-down from `harborMix` at setup, S2.3) — only the POSITION. */
export interface ResolvedHarbor {
  /** Index into `board.harbors` / `board.harborMix` (same order). */
  index: number;
  edge: EdgeId;
  seaHex: HexId;
  landHex: HexId;
}

/**
 * Resolve a scenario board's harbors to concrete `EdgeId`s on its geometry. Each harbor sits on the
 * edge shared by its sea cell and `faces[0]` (an interior sea↔land border — the reason Seafarers
 * harbors can't use `harborCoastIndices`). Throws `BUG:` if a harbor's cells or their shared edge are
 * absent from the geometry (guards the frame/harbor data against drift).
 *
 * Pass the geometry from `buildGeometry(board.layout)`. Edge/hex ids match that geometry.
 */
export function resolveScenarioHarbors(board: ScenarioBoard, geometry: BoardGeometry): ResolvedHarbor[] {
  const idOfHex = new Map<string, HexId>();
  for (const h of geometry.hexes) idOfHex.set(`${h.q},${h.r}`, h.id);

  const hexId = (c: Cell): HexId => {
    const id = idOfHex.get(keyOf(c));
    if (id === undefined) throw new Error(`BUG: scenario harbor references missing hex (${c.q},${c.r})`);
    return id;
  };

  // Index edges by their (sorted) bordering-hex pair for O(1) sea↔land lookup.
  const edgeByHexPair = new Map<string, GeometryEdge>();
  for (const e of geometry.edges) {
    if (e.hexes.length !== 2) continue;
    const a = e.hexes[0];
    const b = e.hexes[1];
    if (a === undefined || b === undefined) continue;
    edgeByHexPair.set(`${Math.min(a, b)},${Math.max(a, b)}`, e);
  }

  return board.harbors.map((harbor, index) => {
    const seaHex = hexId(harbor.sea);
    const face = harbor.faces[0];
    if (face === undefined) throw new Error(`BUG: scenario harbor ${index} has no faces`);
    const landHex = hexId(face);
    const key = `${Math.min(seaHex, landHex)},${Math.max(seaHex, landHex)}`;
    const edge = edgeByHexPair.get(key);
    if (!edge) {
      throw new Error(
        `BUG: scenario harbor ${index} has no shared edge between sea (${harbor.sea.q},${harbor.sea.r}) ` +
          `and land (${face.q},${face.r})`
      );
    }
    return { index, edge: edge.id, seaHex, landHex };
  });
}

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

export const HEADING_FOR_NEW_SHORES: Scenario = {
  id: 'headingForNewShores',
  targetVp: 14, // S10.1
  smallIslandVp: 2, // S10.6 (+2 chits under the first settlement on each small island)
  boards: {
    3: buildScenarioBoard(3, SPEC_3P, FRAME_3P), // 35 hexes
    4: buildScenarioBoard(4, SPEC_4P, FRAME_4P), // 42 hexes
    5: buildScenarioBoard(5, SPEC_5P, FRAME_5P), // 48 hexes (T-751, best-effort)
    6: buildScenarioBoard(6, SPEC_6P, FRAME_6P), // 56 hexes (T-751, best-effort)
  },
  verify: [
    'GEOMETRY ✅ ENCODED: cell coordinates are the real printed 3p (p.9) / 4p (p.10) frames from ' +
      'research §B — main island, small islands (A/B/C), sea cells, pirate & robber traced from the ' +
      'diagrams; both frames build a valid single simple coastline via buildGeometry.',
    'HARBORS ✅ ENCODED (positions): the 8 (3p) / 9 (4p) harbor cells + faced main hexes are from ' +
      'research §B; resolveScenarioHarbors turns them into sea↔land edges. Types stay a face-down ' +
      'draw from harborMix (S2.3). MEDIUM residual: the exact dock VERTEX pair per harbor (which end ' +
      'of the sea↔land edge) was not pixel-traced — resolveScenarioHarbors pins the edge (faces[0]).',
    'OPEN-SEA BOUNDARY (MEDIUM): research §B flags the open-sea-tile ↔ outer-frame boundary as its one ' +
      'MEDIUM item. 3p matches as traced. 4p: (2,-2) is encoded as sea and the reconstructed (2,0) is ' +
      'dropped so the frame is a single simple coastline (14 sea / 42 total preserved) — re-check ' +
      'against a clean p.10 diagram if pixel-fidelity is needed.',
    '3p ROBBER START: encoded as (3,-3) per the printed diagram (research §B.1). ER-S6 off-board ' +
      '(robberStart:null) is the defensible alternative for the desert-less board — PM decision.',
    'TERRAIN: per-cell terrain in `hexes` is an EXAMPLE fill realizing each region multiset (S10.2); ' +
      'S10.4 randomizes land terrain within region at game-gen. Only the 4p desert (-1,0) is fixed.',
    '⚠ VERIFY 6p (T-751): the 56-hex / sea 16 / gold 3 / hills 7 / forest 7 / pasture 7 / fields 7 / ' +
      'mountains 7 / desert 2 totals are the one verified figure for this board; the main/small split ' +
      '(27/13), the exact 38-token distribution, which resource is doubled among the 11 harbors (wool ' +
      'chosen, mirroring EXT56_HARBOR_MIX — not a seafarers-specific source), and the entire cell-layout ' +
      '(main blob / 3 small islands / sea / harbor positions / pirate & robber starts) are ALL ' +
      'best-effort reconstructions — the printed setup diagram could not be rendered on this machine ' +
      '(README Phase 7B fidelity caveat). Re-check every one of these against the official diagram.',
    '⚠ VERIFY 5p (T-751): NO printed diagram or verified multiset was available at all — the entire ' +
      'board (48 hexes: sea 14 / gold 2 / hills 6 / forest 6 / pasture 6 / fields 6 / mountains 6 / ' +
      'desert 2, main/small split, tokens, harbors, layout, starts) is an invented, proportionally- ' +
      'smaller best-effort board sized to be valid and playable, not sourced from any reference. ' +
      'Replace wholesale if the official 5p setup diagram becomes available.',
    '5p/6p GEOMETRY: both frames are constructed as solid, hole-free hex blocks (rows r=-4..4 for 6p, ' +
      'a subset for 5p) so the single-simple-coastline property `buildGeometry` requires holds for any ' +
      'main/small/sea partition of that block (verified in scenario.test.ts) — this guarantees validity ' +
      'but is NOT a claim of cell-for-cell fidelity to the printed frames.',
    '5p/6p DESERT: both boards fix 2 desert cells (frame.desert, generalized from the 4p single-cell ' +
      'case — see buildScenarioBoard). robberStart picks one of the two arbitrarily; ⚠ VERIFY against ' +
      'the printed diagram which desert (if either) the robber actually starts on.',
  ],
};

/**
 * "New World" (T-752) — the second Seafarers scenario, 5–6 players ONLY (`boardPresets.ts` gates
 * the picker to `players: [5, 6]`; no 3p/4p entries here). Ships at S10.1's 14-VP target with the
 * standard +2 small-island bonus (S10.6) — no scenario-specific rule beyond the board itself.
 */
export const NEW_WORLD: Scenario = {
  id: 'newWorld',
  targetVp: 14, // S10.1 (standard Seafarers 5–6 target — no scenario-specific override)
  smallIslandVp: 2, // S10.6
  boards: {
    5: buildScenarioBoard(5, NW_SPEC_5P, NW_FRAME_5P), // 54 hexes
    6: buildScenarioBoard(6, NW_SPEC_6P, NW_FRAME_6P), // 63 hexes
  },
  verify: [
    '⚠ VERIFY (T-752, RANDOM-BY-DESIGN): the official "New World" scenario ships with NO canonical ' +
      'layout — S10.4-style, the rulebook has players assemble the board randomly from a fixed piece ' +
      'pool each game, so there is no printed setup diagram this board could be unfaithful to. A ' +
      'balanced, convention-following terrain/token/harbor multiset over a valid hole-free frame (this ' +
      'file) correctly REALIZES that design intent. The specific numbers chosen here — 63 hexes (6p: ' +
      'sea 18 / desert 2 / gold 3 / 40 resource hexes, 8 per type) / 54 hexes (5p: sea 15 / desert 2 / ' +
      'gold 2 / 35 resource hexes, 7 per type), the 43-token (6p) / 37-token (5p) distributions, the ' +
      '11-harbor (6p, ore doubled — arbitrary) / 10-harbor (5p) mixes, the main/small-island split, and ' +
      'every cell position (pirate/robber starts, harbor faces) — are this task\'s CHOSEN best-effort ' +
      'realization, not transcribed from any printed piece-pool count table. Re-check against the ' +
      'official piece pool if exact counts become available; until then this is a fully valid, playable ' +
      '"New World" board by the scenario\'s own random-assembly rule.',
    'GEOMETRY: both frames (5p/6p) are solid, hole-free hex-block rectangles (9×6 / 9×7 in axial rows ' +
      'r=-4..4) — buildGeometry accepts any main/small/sea partition of such a block as a single simple ' +
      'coastline (same construction as HEADING_FOR_NEW_SHORES\' 5p/6p frames, T-751); confirmed via ' +
      'buildGeometry in scenario.test.ts. Main island is one connected blob; the 3 small islands (A/B/C) ' +
      'are each independently connected (S10.6).',
  ],
};

/**
 * "Through the Desert" (T-753) — the third Seafarers scenario, 5–6 players ONLY (`boardPresets.ts`
 * gates the picker to `players: [5, 6]`; no 3p/4p entries here). Ships at S10.1's 14-VP target with
 * the standard +2 small-island bonus (S10.6) — no scenario-specific rule beyond the board itself.
 */
export const THROUGH_THE_DESERT: Scenario = {
  id: 'throughTheDesert',
  targetVp: 14, // S10.1 — ⚠ VERIFY against the printed booklet (standard Seafarers 5–6 target assumed)
  smallIslandVp: 2, // S10.6 — ⚠ VERIFY against the printed booklet (standard bonus assumed)
  boards: {
    5: buildScenarioBoard(5, TD_SPEC_5P, TD_FRAME_5P), // 54 hexes
    6: buildScenarioBoard(6, TD_SPEC_6P, TD_FRAME_6P), // 63 hexes
  },
  verify: [
    '⚠ VERIFY (T-753, BEST-EFFORT): only the hex TOTAL (~63 for 6p) was handed down for this task — ' +
      'the printed terrain/token/harbor multiset and the exact desert-band shape/position were NOT ' +
      'transcribed (the setup-diagram PDF cannot render on this machine). Every number below — 63 ' +
      'hexes (6p: sea 18 / desert 3 / gold 3 / 40 resource hexes split 6/6/6/5/6) / 54 hexes (5p: sea ' +
      '15 / desert 2 / gold 2 / 35 resource hexes, 7/type split 5/type main + 2/type small), the ' +
      '42-token (6p) / 37-token (5p) distributions, the 11-harbor (6p, grain doubled — arbitrary) / ' +
      '10-harbor (5p) mixes, the main/small-island split, and every cell position (desert band, pirate/ ' +
      'robber starts, harbor faces) — is this task\'s CHOSEN best-effort realization, not transcribed ' +
      'from the official setup diagram. Re-check against the official booklet if it becomes available; ' +
      'until then this is a fully valid, playable "Through the Desert" board following the standard ' +
      'Seafarers 5–6 conventions (no 7 token, balanced 6/8 "reds", one 2:1 harbor per resource).',
    'DESERT BAND (⚠ VERIFY): modeled as a straight vertical run of desert cells (3 for 6p, 2 for 5p) ' +
      'inside one interior column of the main island\'s rectangle — a real contiguous "crossing" band ' +
      '(mutually axial-adjacent cells), not scattered desert cells. The band\'s exact shape/location and ' +
      'which side of it each starting settlement lands on are NOT sourced from the printed diagram — ' +
      'only the thematic requirement ("one main island crossed by a desert band") is satisfied.',
    'GEOMETRY: both frames (5p/6p) reuse the same solid, hole-free hex-block rectangles (9×6 / 9×7 in ' +
      'axial rows r=-4..4) as NEW_WORLD (T-752) — buildGeometry accepts any main/small/sea partition of ' +
      'such a block as a single simple coastline (confirmed via buildGeometry in scenario.test.ts). Main ' +
      'island is one connected blob (the desert band sits INSIDE it, not a separate region); the 3 small ' +
      'islands (A/B/C) are each independently connected (S10.6).',
  ],
};

// ---------------------------------------------------------------------------
// "The Forgotten Tribe" (T-754, Seafarers 5–6 extension) — per-island reward tokens
// ---------------------------------------------------------------------------
// The Forgotten Tribe's defining minor mechanic is per-island reward tokens: the printed scenario
// hands out a VP, a harbor, or a one-off resource bonus (varying per small island) to the first
// player who settles it, instead of the flat S10.6 bonus. Per the task's mandatory low-risk design,
// this ships as an OPTIONAL `Scenario.islandRewards` table consumed by the EXISTING
// `grantIslandChit`/`islandChitVp` hook (chits.ts) — NO new GameEvent/Action/Phase/ErrorCode. Every
// harbor/resource-bonus token in the real scenario is APPROXIMATED here as a VP amount (⚠ VERIFY,
// see `verify[]` below) — a deliberate, documented simplification, not an oversight.
//
// Same construction as NEW_WORLD/THROUGH_THE_DESERT: a solid, hole-free 9×7 / 9×6 rectangle block
// (buildGeometry accepts any main/small/sea partition of such a block as one simple coastline). Main
// = the same left-side rectangle as those two scenarios. The right-side region is repartitioned into
// MORE, SMALLER small-island groups (5, ids 0-4) than New Shores/New World/Through-the-Desert's 3 —
// "collecting them is the point" for this scenario — each isolated from its neighbours (and from the
// other small islands) by at least one full row of sea (main-vs-small-island touching, as in the
// prior 3 scenarios' frames, is tolerated: `islandOfVertex` still resolves such a vertex to the small
// island, which is the intended "the island edges the mainland" case, not a bug).
//
// Only the hex TOTAL (~63 for 6p) was handed down for this task — the printed terrain/token/harbor
// multiset, the exact island layout, and (per the mechanic itself) the printed reward table were NOT
// transcribed (the setup-diagram PDF cannot render on this machine) — same "best-effort, flagged in
// verify[]" norm as T-751/T-752/T-753.

/** 6 players — 63 hexes (sea 22 · main 32 [desert 2 + 30 resource] · small 9 [gold 3 + 6 resource]). */
const FT_SPEC_6P: CountSpec = {
  mainLand: { desert: 2, fields: 6, hills: 6, mountains: 6, pasture: 6, forest: 6 }, // 32
  smallLand: { gold: 3, fields: 2, hills: 1, mountains: 1, pasture: 1, forest: 1 }, // 9
  // 39 tokens = 30 main (non-desert) + 9 small. Balanced, no 7, 6 the most common ("reds").
  tokens: [
    2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 6, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10,
    10, 11, 11, 11, 11, 12, 12, 12,
  ],
  // 9 harbors = one 2:1 per resource + 4 generic 3:1.
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic', 'generic'],
};

/** 5 players — 54 hexes (sea 18 · main 27 [desert 2 + 25 resource] · small 9 [gold 3 + 6 resource]),
 *  the SAME small-island layout as the 6p board (shifted one column), only main shrinks. */
const FT_SPEC_5P: CountSpec = {
  mainLand: { desert: 2, fields: 5, hills: 5, mountains: 5, pasture: 5, forest: 5 }, // 27
  smallLand: { gold: 3, fields: 2, hills: 1, mountains: 1, pasture: 1, forest: 1 }, // 9
  // 34 tokens = 25 main (non-desert) + 9 small. Balanced, no 7.
  tokens: [
    2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 6, 6, 8, 8, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11,
    11, 12, 12, 12,
  ],
  // 7 harbors = one 2:1 per resource + 2 generic 3:1 (smaller board — fewer harbors than 6p).
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic', 'generic'],
};

// --- 6-player frame (T-754): the SAME solid, hole-free 9×7 rectangle block (r=-4..4, q=0..6) = 63
// cells as NW_FRAME_6P/TD_FRAME_6P — main is the identical left-4-column rectangle. The right 3
// columns (q4-6), instead of 3 islands (A/B/C), are repartitioned into 5 SMALLER islands (ids 0-4),
// each a 1-2 cell group separated from its neighbours by a full row of sea — more, smaller islands to
// collect (the scenario's whole point), same total right-side footprint (27 cells: 9 small + 18 sea).
const FT_FRAME_6P: Frame = {
  main: [
    cell(0, -3), cell(1, -3), cell(2, -3), cell(3, -3),
    cell(0, -2), cell(1, -2), cell(2, -2), cell(3, -2),
    cell(0, -1), cell(1, -1), cell(2, -1), cell(3, -1),
    cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0),
    cell(0, 1), cell(1, 1), cell(2, 1), cell(3, 1),
    cell(0, 2), cell(1, 2), cell(2, 2), cell(3, 2),
    cell(0, 3), cell(1, 3), cell(2, 3), cell(3, 3),
    cell(0, 4), cell(1, 4), cell(2, 4), cell(3, 4),
  ],
  small: [
    { island: 0, cells: [cell(4, -4), cell(5, -4)] }, // A (top-right, 2 cells)
    { island: 1, cells: [cell(5, -2), cell(6, -2)] }, // B (upper-right, 2 cells)
    { island: 2, cells: [cell(4, 0), cell(5, 0)] }, // C (mid-right, 2 cells)
    { island: 3, cells: [cell(5, 2), cell(6, 2)] }, // D (lower-right, 2 cells)
    { island: 4, cells: [cell(5, 4)] }, // E (bottom-right, 1 cell — the smallest/rarest island)
  ],
  sea: [
    cell(0, -4), cell(1, -4), cell(2, -4), cell(3, -4), // top buffer row (above main)
    cell(6, -4), cell(4, -3), cell(5, -3), cell(6, -3), // buffer row between A and B
    cell(4, -2), cell(4, -1), cell(5, -1), cell(6, -1), // buffer row between B and C
    cell(6, 0), cell(4, 1), cell(5, 1), cell(6, 1), // buffer row between C and D
    cell(4, 2), cell(4, 3), cell(5, 3), cell(6, 3), // buffer row between D and E
    cell(4, 4), cell(6, 4), // flanking E
  ],
  desert: [cell(0, -2), cell(0, -1)], // 2 fixed desert cells, away from the harbor coast
  harbors: [
    { sea: cell(0, -4), faces: [cell(0, -3)] },
    { sea: cell(1, -4), faces: [cell(1, -3)] },
    { sea: cell(2, -4), faces: [cell(2, -3)] },
    { sea: cell(3, -4), faces: [cell(3, -3)] },
    { sea: cell(4, -2), faces: [cell(3, -2)] },
    { sea: cell(4, -1), faces: [cell(3, -1)] },
    { sea: cell(4, 1), faces: [cell(3, 1)] },
    { sea: cell(4, 2), faces: [cell(3, 2)] },
    { sea: cell(4, 3), faces: [cell(3, 3)] },
  ],
  pirateStart: cell(6, 1),
  robberStart: cell(0, -2), // one of the two desert cells; ⚠ VERIFY (arbitrary pick)
};

// --- 5-player frame (T-754): the SAME solid, hole-free 9×6 rectangle (r=-4..4, q=0..5) = 54 cells as
// NW_FRAME_5P/TD_FRAME_5P. Main is the identical left-3-column rectangle (full 9 rows); the same
// 5-island layout as the 6p frame, shifted one column left (q3-5 instead of q4-6).
const FT_FRAME_5P: Frame = {
  main: [
    cell(0, -4), cell(1, -4), cell(2, -4),
    cell(0, -3), cell(1, -3), cell(2, -3),
    cell(0, -2), cell(1, -2), cell(2, -2),
    cell(0, -1), cell(1, -1), cell(2, -1),
    cell(0, 0), cell(1, 0), cell(2, 0),
    cell(0, 1), cell(1, 1), cell(2, 1),
    cell(0, 2), cell(1, 2), cell(2, 2),
    cell(0, 3), cell(1, 3), cell(2, 3),
    cell(0, 4), cell(1, 4), cell(2, 4),
  ],
  small: [
    { island: 0, cells: [cell(3, -4), cell(4, -4)] }, // A (top-right, 2 cells)
    { island: 1, cells: [cell(4, -2), cell(5, -2)] }, // B (upper-right, 2 cells)
    { island: 2, cells: [cell(3, 0), cell(4, 0)] }, // C (mid-right, 2 cells)
    { island: 3, cells: [cell(4, 2), cell(5, 2)] }, // D (lower-right, 2 cells)
    { island: 4, cells: [cell(4, 4)] }, // E (bottom-right, 1 cell — the smallest/rarest island)
  ],
  sea: [
    cell(5, -4), cell(3, -3), cell(4, -3), cell(5, -3), // buffer row between A and B
    cell(3, -2), cell(3, -1), cell(4, -1), cell(5, -1), // buffer row between B and C
    cell(5, 0), cell(3, 1), cell(4, 1), cell(5, 1), // buffer row between C and D
    cell(3, 2), cell(3, 3), cell(4, 3), cell(5, 3), // buffer row between D and E
    cell(3, 4), cell(5, 4), // flanking E
  ],
  desert: [cell(0, -2), cell(0, -1)], // 2 fixed desert cells, away from the harbor coast
  harbors: [
    { sea: cell(3, -3), faces: [cell(2, -3)] },
    { sea: cell(3, -2), faces: [cell(2, -2)] },
    { sea: cell(3, -1), faces: [cell(2, -1)] },
    { sea: cell(3, 1), faces: [cell(2, 1)] },
    { sea: cell(3, 2), faces: [cell(2, 2)] },
    { sea: cell(3, 3), faces: [cell(2, 3)] },
    { sea: cell(3, 4), faces: [cell(2, 4)] },
  ],
  pirateStart: cell(5, 1),
  robberStart: cell(0, -2), // one of the two desert cells; ⚠ VERIFY (arbitrary pick)
};

/**
 * "The Forgotten Tribe" (T-754) — the fourth Seafarers scenario, 5–6 players ONLY
 * (`boardPresets.ts` gates the picker to `players: [5, 6]`; no 3p/4p entries here). Ships at S10.1's
 * 14-VP target. Its defining mechanic: PER-ISLAND reward VP (`islandRewards`) instead of the flat
 * S10.6 bonus — island 4 (the lone-hex island, hardest to reach) pays the most.
 */
export const FORGOTTEN_TRIBE: Scenario = {
  id: 'forgottenTribe',
  targetVp: 14, // S10.1 — ⚠ VERIFY against the printed booklet (standard Seafarers 5–6 target assumed)
  smallIslandVp: 2, // fallback for any island id absent from `islandRewards` (none, here — all 5 are listed)
  // ⚠ VERIFY (T-754): the real scenario's per-island tokens mix VP/harbor/resource bonuses; every one
  // is APPROXIMATED here as a flat VP amount. The spread (1/1/2/2/3) is a best-effort "smaller/harder
  // islands pay more" invention, not sourced from the printed reward table.
  islandRewards: { 0: 1, 1: 1, 2: 2, 3: 2, 4: 3 },
  boards: {
    5: buildScenarioBoard(5, FT_SPEC_5P, FT_FRAME_5P), // 54 hexes
    6: buildScenarioBoard(6, FT_SPEC_6P, FT_FRAME_6P), // 63 hexes
  },
  verify: [
    '⚠ VERIFY (T-754, BEST-EFFORT): only the hex TOTAL (~63 for 6p) was handed down for this task — ' +
      'the printed terrain/token/harbor multiset and the exact island layout were NOT transcribed (the ' +
      'setup-diagram PDF cannot render on this machine). Every number below — 63 hexes (6p: sea 22 / ' +
      'desert 2 / gold 3 / 36 resource hexes split 6/6/6/6/6 main + 2/1/1/1/1 small) / 54 hexes (5p: ' +
      'sea 18 / desert 2 / gold 3 / 31 resource hexes) — the 39-token (6p) / 34-token (5p) ' +
      'distributions, the 9-harbor (6p) / 7-harbor (5p) mixes, the main/small-island split, and every ' +
      'cell position (island shapes, pirate/robber starts, harbor faces) — is this task\'s CHOSEN ' +
      'best-effort realization, not transcribed from the official setup diagram. Re-check against the ' +
      'official booklet if it becomes available; until then this is a fully valid, playable "Forgotten ' +
      'Tribe" board following the standard Seafarers 5–6 conventions (no 7 token, one 2:1 harbor per ' +
      'resource, balanced token spread).',
    '⚠ VERIFY (PER-ISLAND REWARD TABLE, the scenario\'s defining mechanic): the real "Forgotten Tribe" ' +
      'grants the first settler of each small island a printed token that is a VP bonus, a harbor, OR a ' +
      'one-off resource bonus (varying per island) — NOT a uniform flat VP like the base S10.6 rule. ' +
      'This build APPROXIMATES every one of those token types as a flat VP amount via ' +
      '`Scenario.islandRewards` (island id → VP: {0:1, 1:1, 2:2, 3:2, 4:3}), reusing the existing ' +
      '`islandSettled` event with a variable amount instead of adding any new event/action/phase — a ' +
      'deliberate, low-risk simplification (harbor/resource tokens would need real new mechanics to ' +
      'model faithfully). The specific per-island split (which island pays 1 vs 2 vs 3, and that all 5 ' +
      'tokens are VP at all) is NOT sourced from the printed reward table — re-check and replace with ' +
      'the real VP/harbor/resource mix if the booklet becomes available.',
    'ISLANDS (⚠ VERIFY): 5 small-island groups (ids 0-4, sizes 2/2/2/2/1) instead of the 3 (A/B/C) used ' +
      'by Heading for New Shores/New World/Through-the-Desert — MORE, SMALLER islands, since collecting ' +
      'them is this scenario\'s whole point. Each island is separated from every OTHER small island by ' +
      'at least one full row of sea (verified via the connected-components check in scenario.test.ts); ' +
      'islands 0 and 2 (6p: cells (4,-4)/(5,-4) and (4,0)/(5,0)) DO edge the main island directly (no ' +
      'sea between them and the mainland) — this mirrors the SAME tolerated main-vs-small-island ' +
      'adjacency already present in NEW_WORLD/THROUGH_THE_DESERT\'s shipped frames (an island vertex ' +
      'bordering a main hex still resolves to that island via `islandOfVertex`, which is correct: the ' +
      'hex IS island territory), not a new defect this task introduces.',
    'GEOMETRY: both frames (5p/6p) reuse the same solid, hole-free hex-block rectangles (9×6 / 9×7 in ' +
      'axial rows r=-4..4) as NEW_WORLD/THROUGH_THE_DESERT (T-752/T-753) — buildGeometry accepts any ' +
      'main/small/sea partition of such a block as a single simple coastline (confirmed via ' +
      'buildGeometry in scenario.test.ts). Main island is one connected blob; each of the 5 small ' +
      'islands is independently connected (S10.6).',
  ],
};

// ---------------------------------------------------------------------------
// "The Six Islands" (T-755, Seafarers 5–6 extension) — BREAKS the main-island model
// ---------------------------------------------------------------------------
// Every scenario above (HEADING_FOR_NEW_SHORES/NEW_WORLD/THROUGH_THE_DESERT/FORGOTTEN_TRIBE) is ONE
// main island (region 'main', starting settlements + robber home, S10.5) plus a handful of small
// islands (region 'small', S10.6 bonus-VP). "The Six Islands" is the printed scenario that breaks that
// shape entirely: SIX roughly co-equal islands, none of them a "home" — every cell is `region: 'small'`
// and `regions.main === 0` (PM decision, T-755 spec §"The model" — not this task's to redecide).
//
// Consequence (the scenario's defining risk): with no main island, starting settlements land ON these
// small islands — `legalSetupSettlements` (packages/engine/src/legal.ts) has no main/small distinction
// at all (only `vertexTouchesLand`), so this "just works" with zero engine changes, PROVIDED each
// island is big enough that 5–6 players' 2 starting settlements each can find distance-2-legal spots.
// Every small island earns its S10.6 chit on first settlement too — since ALL land is 'small', this
// inflates starting VP for every player symmetrically (not a balance problem, since it's symmetric),
// which is why `targetVp` is raised from the usual 14 to 18 (tuned via the engine sim smoke, T-755).
//
// GEOMETRY: same "solid, hole-free rectangle" trick as T-751 (see NEW_WORLD's header) — the union of
// `small` + `sea` cells (no `main`) is a complete, gap-free rectangle in axial (q,r) space, so
// buildGeometry always resolves a single simple coastline no matter how the rectangle is partitioned
// into islands vs sea (confirmed in scenario.test.ts). Islands are laid out with at least one full
// sea column (6p: a 3×2 grid) or column (5p: a single row of 6) between every pair, so no two
// DIFFERENT islands are ever hex-adjacent (each island's `components()` count is exactly 1, and no
// island cell neighbors another island's cell — verified in scenario.test.ts).
//
// Only the ~56-hex total (6p) was handed down for this task (docs/tasks §"The model": "aim for ~6
// hexes per island"); the exact island shapes/positions, the terrain/token/harbor multiset, and the
// 5p board are ALL this task's own best-effort invention (no printed diagram available) — flagged in
// `verify[]` below, same norm as T-751/752/753/754.

/** Both player counts share the SAME 36-cell land layout (six islands × 6 hexes) — only the sea moat
 *  differs (6p: a 3×2 grid needs more separating sea; 5p: a single row of 6 needs less). `gold` is
 *  concentrated on island 0 (3 of its 6 cells) rather than spread 1-per-island: `buildScenarioBoard`
 *  fills each island's cells sequentially from one flattened multiset, and a per-island gold split
 *  would need a genuinely different (non-`LandCounts`) data shape to express — accepted as an
 *  invented simplification (⚠ VERIFY), same "one aggregate count per terrain" limitation `CountSpec`
 *  already has everywhere else. Islands 3/4/5 end up single-resource (mountains/pasture/forest
 *  respectively) as a side effect of the same sequential fill — thematically fine for six DISTINCT
 *  islands, not a bug.
 */
const SIX_ISLANDS_SMALL_LAND: LandCounts = {
  gold: 3,
  fields: 7,
  hills: 7,
  mountains: 7,
  pasture: 6,
  forest: 6,
}; // 36

/** 36 tokens (every land cell is numbered — no desert on this board, S10.4/T-755 "deserts optional").
 *  Two copies of the standard base-game 18-token spread (no 7s) — balanced, symmetric across the six
 *  islands' worth of land. */
const SIX_ISLANDS_TOKENS: readonly number[] = [
  2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11,
  11, 11, 12, 12,
];

const SIX_ISLANDS_SPEC_6P: CountSpec = {
  mainLand: {}, // NO main island on this board (regions.main === 0) — the model's defining break
  smallLand: SIX_ISLANDS_SMALL_LAND,
  tokens: SIX_ISLANDS_TOKENS,
  // 9 harbors = one 2:1 per resource + 4 generic 3:1 (mirrors FORGOTTEN_TRIBE's 6p count).
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic', 'generic', 'generic', 'generic'],
};

const SIX_ISLANDS_SPEC_5P: CountSpec = {
  mainLand: {},
  // Same 36-cell land total as the 6p board (T-755 spec: "same six-island shape scaled" — only the
  // sea moat shrinks for 5p; the six islands themselves stay ~6 hexes each either way).
  smallLand: SIX_ISLANDS_SMALL_LAND,
  tokens: SIX_ISLANDS_TOKENS,
  // 7 harbors = one 2:1 per resource + 2 generic 3:1 (mirrors FORGOTTEN_TRIBE's 5p count).
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic', 'generic'],
};

// --- 6-player frame (T-755): a solid, hole-free 8×7 rectangle (q=0..7, r=-3..3) = 56 cells. Six
// islands (2 wide × 3 tall = 6 cells each) sit in a 3-column × 2-row grid; a full sea column (q=2,5)
// separates the three island-columns and a full sea row (r=0) separates the two island-rows, so no
// two islands are ever hex-adjacent. 36 land + 20 sea = 56.
const SIX_ISLANDS_FRAME_6P: Frame = {
  main: [],
  small: [
    { island: 0, cells: [cell(0, -3), cell(1, -3), cell(0, -2), cell(1, -2), cell(0, -1), cell(1, -1)] },
    { island: 1, cells: [cell(3, -3), cell(4, -3), cell(3, -2), cell(4, -2), cell(3, -1), cell(4, -1)] },
    { island: 2, cells: [cell(6, -3), cell(7, -3), cell(6, -2), cell(7, -2), cell(6, -1), cell(7, -1)] },
    { island: 3, cells: [cell(0, 1), cell(1, 1), cell(0, 2), cell(1, 2), cell(0, 3), cell(1, 3)] },
    { island: 4, cells: [cell(3, 1), cell(4, 1), cell(3, 2), cell(4, 2), cell(3, 3), cell(4, 3)] },
    { island: 5, cells: [cell(6, 1), cell(7, 1), cell(6, 2), cell(7, 2), cell(6, 3), cell(7, 3)] },
  ],
  sea: [
    // gap column q=2 (separates island columns 0 and 1)
    cell(2, -3), cell(2, -2), cell(2, -1), cell(2, 0), cell(2, 1), cell(2, 2), cell(2, 3),
    // gap column q=5 (separates island columns 1 and 2)
    cell(5, -3), cell(5, -2), cell(5, -1), cell(5, 0), cell(5, 1), cell(5, 2), cell(5, 3),
    // gap row r=0 (separates island rows) for the non-gap-column q's
    cell(0, 0), cell(1, 0), cell(3, 0), cell(4, 0), cell(6, 0), cell(7, 0),
  ],
  // No fixed desert cell (T-755: "deserts optional" — this board has none; every land hex is numbered).
  harbors: [
    { sea: cell(2, -3), faces: [cell(1, -3)] }, // faces island 0
    { sea: cell(2, -1), faces: [cell(3, -1)] }, // faces island 1
    { sea: cell(2, 1), faces: [cell(1, 1)] }, // faces island 3
    { sea: cell(2, 3), faces: [cell(3, 3)] }, // faces island 4
    { sea: cell(5, -3), faces: [cell(4, -3)] }, // faces island 1
    { sea: cell(5, -1), faces: [cell(6, -1)] }, // faces island 2
    { sea: cell(5, 1), faces: [cell(4, 1)] }, // faces island 4
    { sea: cell(5, 3), faces: [cell(6, 3)] }, // faces island 5
    { sea: cell(0, 0), faces: [cell(0, -1)] }, // faces island 0
  ],
  pirateStart: cell(2, 0),
  // "Any land cell" (T-755 spec, requirement 3 — no desert to anchor it to). Island 0's 4th cell,
  // which this build's sequential terrain fill lands on `fields` (⚠ VERIFY — arbitrary pick).
  robberStart: cell(0, -1),
};

// --- 5-player frame (T-755): a solid, hole-free 17×3 rectangle (q=0..16, r=-1..1) = 51 cells. The
// SAME six 2×3 islands as the 6p frame, laid out in a single row (no room needed for a second
// island-row) — a full sea column between every consecutive pair keeps them non-adjacent. 36 land +
// 15 sea = 51 (within the task's "~48–52" 5p target).
const SIX_ISLANDS_FRAME_5P: Frame = {
  main: [],
  small: [
    { island: 0, cells: [cell(0, -1), cell(1, -1), cell(0, 0), cell(1, 0), cell(0, 1), cell(1, 1)] },
    { island: 1, cells: [cell(3, -1), cell(4, -1), cell(3, 0), cell(4, 0), cell(3, 1), cell(4, 1)] },
    { island: 2, cells: [cell(6, -1), cell(7, -1), cell(6, 0), cell(7, 0), cell(6, 1), cell(7, 1)] },
    { island: 3, cells: [cell(9, -1), cell(10, -1), cell(9, 0), cell(10, 0), cell(9, 1), cell(10, 1)] },
    { island: 4, cells: [cell(12, -1), cell(13, -1), cell(12, 0), cell(13, 0), cell(12, 1), cell(13, 1)] },
    { island: 5, cells: [cell(15, -1), cell(16, -1), cell(15, 0), cell(16, 0), cell(15, 1), cell(16, 1)] },
  ],
  sea: [
    cell(2, -1), cell(2, 0), cell(2, 1), // gap between islands 0/1
    cell(5, -1), cell(5, 0), cell(5, 1), // gap between islands 1/2
    cell(8, -1), cell(8, 0), cell(8, 1), // gap between islands 2/3
    cell(11, -1), cell(11, 0), cell(11, 1), // gap between islands 3/4
    cell(14, -1), cell(14, 0), cell(14, 1), // gap between islands 4/5
  ],
  harbors: [
    { sea: cell(2, -1), faces: [cell(1, -1)] }, // faces island 0
    { sea: cell(2, 1), faces: [cell(3, 1)] }, // faces island 1
    { sea: cell(5, -1), faces: [cell(4, -1)] }, // faces island 1
    { sea: cell(5, 1), faces: [cell(6, 1)] }, // faces island 2
    { sea: cell(8, 0), faces: [cell(9, 0)] }, // faces island 3
    { sea: cell(11, 0), faces: [cell(12, 0)] }, // faces island 4
    { sea: cell(14, 0), faces: [cell(15, 0)] }, // faces island 5
  ],
  pirateStart: cell(2, 0),
  // "Any land cell" — island 0's 4th cell, `fields` per this build's sequential terrain fill (matches
  // the 6p pick above; ⚠ VERIFY — arbitrary).
  robberStart: cell(1, 0),
};

/**
 * "The Six Islands" (T-755) — the fifth Seafarers scenario, 5–6 players ONLY (`boardPresets.ts` gates
 * the picker to `players: [5, 6]`; no 3p/4p entries here). BREAKS the main-island model every prior
 * scenario used: six co-equal small islands, `regions.main === 0`. `targetVp` is raised to 18 (from
 * the usual 14) because starting settlements land on — and earn the S10.6 chit for — these small
 * islands here, inflating starting VP symmetrically for every player (⚠ VERIFY — tune further if the
 * sim shows games ending too fast/slow).
 */
export const SIX_ISLANDS: Scenario = {
  id: 'sixIslands',
  targetVp: 18, // ⚠ VERIFY (T-755): raised from 14 because starting settlements earn island chits here
  smallIslandVp: 2, // S10.6 — every island uses the flat rate (no per-island `islandRewards` table)
  boards: {
    5: buildScenarioBoard(5, SIX_ISLANDS_SPEC_5P, SIX_ISLANDS_FRAME_5P), // 51 hexes
    6: buildScenarioBoard(6, SIX_ISLANDS_SPEC_6P, SIX_ISLANDS_FRAME_6P), // 56 hexes
  },
  verify: [
    '⚠ VERIFY (T-755, BEST-EFFORT): only the ~56-hex (6p) total and the "six islands, no main, ~6 ' +
      'hexes each" shape were handed down for this task (the setup-diagram PDF cannot render on this ' +
      'machine) — the exact island positions/shapes, the 51-hex 5p board, the terrain/token/harbor ' +
      'multiset, and every cell position (pirate/robber starts, harbor faces) are this task\'s CHOSEN ' +
      'best-effort realization, not transcribed from the official setup diagram. Re-check against the ' +
      'official booklet if it becomes available.',
    'NO MAIN ISLAND (the model\'s defining break, PM-decided — see docs/tasks/phase-7b/T-755): every ' +
      'cell is `region: \'small\'`; `regions.main === 0`. Verified structurally in scenario.test.ts ' +
      '(the shared "main island is a single connected blob" assertion is replaced here with ' +
      '`regions.main === 0` + a six-island connectivity check, WITHOUT touching any other shipped ' +
      'scenario\'s assertions).',
    'STARTING-SETTLEMENT FIT (the key risk): `legalSetupSettlements` (packages/engine/src/legal.ts) ' +
      'has no main/small region distinction, only `vertexTouchesLand` + the distance-2 rule, so 5–6 ' +
      'players placing 2 settlements each land freely across these six islands with zero engine ' +
      'changes — PROVIDED each island (6 hexes) has enough distance-2-legal vertices. Confirmed via the ' +
      'engine sim smoke (sim/seafarers.test.ts): pc5 AND pc6 setup both complete and games reach the ' +
      '18-VP target with zero invariant violations. If a future rebalance shrinks the islands, re-run ' +
      'that smoke before shipping — it is the arbiter, not this note.',
    'TARGET VP (⚠ VERIFY): raised from the usual Seafarers-5-6 14 to 18 because — uniquely on this ' +
      'board — EVERY starting settlement sits on a small island and earns its S10.6 chit (up to 2 ' +
      'islands × 2 VP = 4 bonus VP per player just from setup, symmetric across all seats). 18 was ' +
      'chosen and confirmed via the sim smoke to produce games of a comparable length to the other ' +
      'Seafarers 5-6 scenarios\' 14-VP games (not instant, not endless) — re-tune if actual play feels ' +
      'off.',
    'GOLD CONCENTRATION (⚠ VERIFY): `CountSpec.smallLand` is one aggregate count per terrain filled ' +
      'sequentially across islands (same mechanism every other scenario here uses) — this lands all 3 ' +
      'gold hexes on island 0 rather than spreading them 1-per-island. A deliberate accepted ' +
      'simplification, not an oversight; a genuinely even per-island gold spread would need a new, ' +
      'per-island-keyed data shape beyond `CountSpec`.',
    'GEOMETRY: both frames (5p: 17×3 / 6p: 8×7, axial rows) are solid, hole-free rectangles — ' +
      'buildGeometry accepts any region partition of such a rectangle as a single simple coastline ' +
      '(same trick as every 5-6 scenario since T-751; confirmed via buildGeometry in scenario.test.ts). ' +
      'Every pair of islands is separated by a full sea column (and, at 6p, a full sea row between the ' +
      'two island-rows) so no two DIFFERENT islands are ever hex-adjacent.',
  ],
};

// ---------------------------------------------------------------------------
// "The Fog Islands" (T-756, Seafarers 5–6 extension) — NEW MECHANIC: fog exploration
// ---------------------------------------------------------------------------
// The official Fog Islands scenario: a starting island (revealed at setup, like every other
// scenario's main island) surrounded by open sea in which a handful of hexes start FACE-DOWN
// ("fogged") and are REVEALED when a player's ship reaches an adjacent edge — the Seafarers analogue
// of the Explorers & Pirates exploration fog (`modules/explorersPirates/exploration.ts`, mirrored in
// SHAPE only inside this module, docs/10 §3 — the two expansions never share code). `ScenarioBoard.
// fog` (added by this task, see its own field comment above) carries the fog cell set + the facedown
// terrain/token multiset; the reveal mechanic lives in the ENGINE (`modules/seafarers/board.ts`'s
// `seedScenarioFog` seeds the shuffled stack at `createGame`; `modules/seafarers/fog.ts`'s
// `revealFogAt` pops it when a ship reaches an edge, folded into the EXISTING `buildShip`/`moveShip`
// afterAction hook — NO new action/event).
//
// ★ THE STRANDING CONSTRAINT (T-756 review fix — the load-bearing invariant of this board):
// fog cells are structurally `region: 'sea'` (they read as open water in `hexTerrain` until revealed,
// so a ship may legally sit on an edge bordering one). If a ship's edge bordered a fog hex as its
// SOLE sea neighbour, revealing that fog to LAND would leave the edge bordering no sea at all — an
// illegal ship position (S3.2), breaking invariant I5-ships (this is exactly the sim violation the
// first cut hit). The fix is geometric and total: **every fog cell is an ISOLATED interior sea hex —
// all 6 of its neighbours are real (non-fog, non-land, on-board) sea hexes.** Then every edge that
// borders a fog hex ALSO borders a real sea hex, so no reveal can ever strand a ship. `assertFog
// Isolated` below enforces this at module load (a `BUG:` throw, like `buildScenarioBoard`'s own
// guards), so the invariant can never silently regress. Consequence: each revealed fog hex is a
// single-hex island (surrounded by sea) — thematically "fog islands", and it also means a fog hex
// never carries an `island` tag (S10.6 bonus VP), so this board has NO `region: 'small'` cells and
// the small-island-chit mechanic never fires here (flagged in `verify[]`).
//
// REACHABILITY (T-756 review fix for "fog never revealed in 5p play"): fog cells sit NEAR-SHORE, at
// q=4 — one open-sea column (q=3) out from the island coast (q=2). A ship reaches a fog-bordering
// edge in ~2 builds from a coastal settlement (coast→q3 edge, then q3→q4 edge), so the random bot
// reliably reveals fog within a normal game at BOTH player counts (asserted by the sim smoke's
// `fogTilesRevealed > 0`). Deeper fog (q=6/7) rewards further exploration.

const rect = (qStart: number, qEnd: number, rStart: number, rEnd: number): Cell[] => {
  const out: Cell[] = [];
  for (let r = rStart; r <= rEnd; r++) {
    for (let q = qStart; q <= qEnd; q++) out.push(cell(q, r));
  }
  return out;
};

const FI_AXIAL_NEIGHBORS: readonly [number, number][] = [
  [1, 0], [-1, 0], [1, -1], [-1, 1], [0, 1], [0, -1],
];

/**
 * ★ The stranding-constraint guard (see this section's header): throws (`BUG:`) unless every fog cell
 * is an isolated interior sea hex — all 6 axial neighbours are on-board AND real sea (not land, not
 * another fog cell). This is what makes revealing fog provably safe for I5-ships; it runs at module
 * load, so a future edit that moves a fog cell somewhere unsafe fails the whole build loudly rather
 * than shipping a board that can strand a ship in play.
 */
function assertFogIsolated(fogCells: readonly Cell[], allCells: readonly Cell[], landCells: readonly Cell[]): void {
  const allKeys = new Set(allCells.map(keyOf));
  const landKeys = new Set(landCells.map(keyOf));
  const fogKeys = new Set(fogCells.map(keyOf));
  for (const c of fogCells) {
    for (const [dq, dr] of FI_AXIAL_NEIGHBORS) {
      const nk = keyOf({ q: c.q + dq, r: c.r + dr });
      if (!allKeys.has(nk)) {
        throw new Error(`BUG: Fog Islands fog cell (${c.q},${c.r}) touches the board boundary (neighbour ${nk} off-board) — fog must be interior sea (T-756)`);
      }
      if (landKeys.has(nk)) {
        throw new Error(`BUG: Fog Islands fog cell (${c.q},${c.r}) is adjacent to land ${nk} — fog must be surrounded by real sea, or a ship could strand on reveal (T-756)`);
      }
      if (fogKeys.has(nk)) {
        throw new Error(`BUG: Fog Islands fog cell (${c.q},${c.r}) is adjacent to another fog cell ${nk} — fog cells must be isolated (T-756)`);
      }
    }
  }
}

/** Pair a flattened land-terrain multiset with a same-length token list, in order (the fog reveal
 *  stack's SOURCE multiset — shuffling happens once at `createGame`, docs/03 §6). Throws (`BUG:`) on a
 *  length mismatch, mirroring `buildScenarioBoard`'s own defensive guards. Never emits a `'sea'` tile
 *  (a fog tile always reveals to real land or a gold field, S9). */
function fogTiles(
  counts: LandCounts,
  tokens: readonly number[]
): { terrain: ScenarioTerrain; token: number | null }[] {
  const terrains = flattenLand(counts);
  if (terrains.length !== tokens.length) {
    throw new Error('BUG: Fog Islands fogTiles terrain/token count mismatch');
  }
  return terrains.map((terrain, i) => ({ terrain, token: tokens[i] ?? null }));
}

/** Build a Fog Islands `ScenarioBoard`: the normal scenario board (fog cells are ordinary `sea`
 *  cells to `buildScenarioBoard`) PLUS the `fog` block — after asserting every fog cell is isolated
 *  interior sea (the stranding constraint). */
function buildFogIslandsBoard(
  playerCount: 5 | 6,
  spec: CountSpec,
  frame: Frame,
  fogCells: readonly Cell[],
  tiles: { terrain: ScenarioTerrain; token: number | null }[]
): ScenarioBoard {
  const allCells = [...frame.main, ...frame.sea];
  assertFogIsolated(fogCells, allCells, frame.main);
  if (fogCells.length !== tiles.length) {
    throw new Error('BUG: Fog Islands fog.cells / fog.tiles length mismatch');
  }
  return { ...buildScenarioBoard(playerCount, spec, frame), fog: { cells: [...fogCells], tiles } };
}

// --- 6-player frame (T-756): a solid, hole-free 9×7 rectangle (q=0..8, r=-3..3) = 63 cells — the
// task's one verified figure (⚠ VERIFY everything else, no printed diagram available). q=0..2 is the
// (revealed) starting island (21 land); q=3..8 is open sea (42). Six ISOLATED fog cells sit inside the
// sea — three near-shore at q=4, three deeper at q=6 — each surrounded by real sea (assertFogIsolated).
const FI_MAIN_6P = rect(0, 2, -3, 3); // 21 land
const FI_SEA_6P = rect(3, 8, -3, 3); // 42 sea (fog cells are a subset of these)
const FI_FOG_CELLS_6P: readonly Cell[] = [
  cell(4, -2), cell(4, 0), cell(4, 2), // near-shore (q=4): reached in ~2 ship builds from the coast
  cell(6, -2), cell(6, 0), cell(6, 2), // deeper (q=6): rewards further exploration
];

const FOG_ISLANDS_MAIN_6P: LandCounts = { desert: 1, fields: 4, hills: 4, mountains: 4, pasture: 4, forest: 4 }; // 21
// 20 tokens = 21 main land - 1 desert. ⚠ VERIFY: invented balanced distribution (no 7).
const FOG_ISLANDS_TOKENS_6P: readonly number[] = [
  2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12,
];
const FOG_ISLANDS_SPEC_6P: CountSpec = {
  mainLand: FOG_ISLANDS_MAIN_6P,
  smallLand: {}, // no small islands on this board — see the stranding-constraint note above
  tokens: FOG_ISLANDS_TOKENS_6P,
  // 7 harbors = one 2:1 per resource + 2 generic 3:1 — one per q=3 sea cell facing the starting
  // island's only exposed coast (the q=2↔q=3 boundary; map edges bound the island's other 3 sides).
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic', 'generic'],
};
const FOG_ISLANDS_FRAME_6P: Frame = {
  main: FI_MAIN_6P,
  small: [],
  sea: FI_SEA_6P,
  desert: [cell(1, 0)],
  harbors: [-3, -2, -1, 0, 1, 2, 3].map((r) => ({ sea: cell(3, r), faces: [cell(2, r)] })),
  pirateStart: cell(8, 0), // a deep, non-fog, non-harbour sea cell (SF-PIRATE: always on real sea)
  robberStart: cell(1, 0), // the fixed desert cell (mirrors every other scenario's robber-on-desert)
};
// 6 fog tiles (one per fog cell): a gold + 5 resources. ⚠ VERIFY: entirely invented (no diagram).
const FOG_ISLANDS_FOG_COUNTS_6P: LandCounts = { gold: 1, fields: 1, hills: 1, forest: 1, pasture: 1, mountains: 1 }; // 6
const FOG_ISLANDS_FOG_TOKENS_6P: readonly number[] = [4, 5, 6, 8, 9, 10];

const FOG_ISLANDS_BOARD_6P = buildFogIslandsBoard(
  6,
  FOG_ISLANDS_SPEC_6P,
  FOG_ISLANDS_FRAME_6P,
  FI_FOG_CELLS_6P,
  fogTiles(FOG_ISLANDS_FOG_COUNTS_6P, FOG_ISLANDS_FOG_TOKENS_6P)
);

// --- 5-player frame (T-756): a solid, hole-free 9×6 rectangle (q=0..8, r=-2..3) = 54 cells. Same
// shape as 6p, one row shorter: q=0..2 island (18 land), q=3..8 sea (36). Five isolated fog cells,
// two near-shore at q=4.
const FI_MAIN_5P = rect(0, 2, -2, 3); // 18 land
const FI_SEA_5P = rect(3, 8, -2, 3); // 36 sea
const FI_FOG_CELLS_5P: readonly Cell[] = [
  cell(4, -1), cell(4, 2), // near-shore (q=4)
  cell(6, -1), cell(6, 2), cell(7, 0), // deeper
];

const FOG_ISLANDS_MAIN_5P: LandCounts = { desert: 1, fields: 3, hills: 3, mountains: 3, pasture: 4, forest: 4 }; // 18
// 17 tokens = 18 main land - 1 desert. ⚠ VERIFY: invented balanced distribution (no 7).
const FOG_ISLANDS_TOKENS_5P: readonly number[] = [
  2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 11, 12,
];
const FOG_ISLANDS_SPEC_5P: CountSpec = {
  mainLand: FOG_ISLANDS_MAIN_5P,
  smallLand: {},
  tokens: FOG_ISLANDS_TOKENS_5P,
  // 6 harbors = one 2:1 per resource + 1 generic 3:1.
  harborMix: ['brick', 'lumber', 'wool', 'grain', 'ore', 'generic'],
};
const FOG_ISLANDS_FRAME_5P: Frame = {
  main: FI_MAIN_5P,
  small: [],
  sea: FI_SEA_5P,
  desert: [cell(1, 0)],
  harbors: [-2, -1, 0, 1, 2, 3].map((r) => ({ sea: cell(3, r), faces: [cell(2, r)] })),
  pirateStart: cell(8, 0),
  robberStart: cell(1, 0),
};
const FOG_ISLANDS_FOG_COUNTS_5P: LandCounts = { gold: 1, fields: 1, hills: 1, forest: 1, pasture: 1 }; // 5
const FOG_ISLANDS_FOG_TOKENS_5P: readonly number[] = [4, 5, 6, 8, 9];

const FOG_ISLANDS_BOARD_5P = buildFogIslandsBoard(
  5,
  FOG_ISLANDS_SPEC_5P,
  FOG_ISLANDS_FRAME_5P,
  FI_FOG_CELLS_5P,
  fogTiles(FOG_ISLANDS_FOG_COUNTS_5P, FOG_ISLANDS_FOG_TOKENS_5P)
);

/**
 * "The Fog Islands" (T-756) — the sixth Seafarers scenario, 5–6 players ONLY (`boardPresets.ts` gates
 * the picker to `players: [5, 6]`; no 3p/4p entries here — the base 3–4p Fog Islands scenario is a
 * separate, unshipped catalog entry, not this task's scope). `targetVp` is the STANDARD Seafarers 14
 * (⚠ VERIFY) — unlike SIX_ISLANDS, starting settlements here sit on the ordinary revealed main island,
 * so nothing inflates starting VP the way it does there.
 */
export const FOG_ISLANDS: Scenario = {
  id: 'fogIslands',
  targetVp: 14, // ⚠ VERIFY (T-756): assumed standard — no starting-VP inflation mechanic on this board
  smallIslandVp: 2, // S10.6 flat rate — present for schema completeness; never actually granted here
  // (this board has no `region: 'small'` cells, see the stranding-constraint note above `FI_MAIN_6P`).
  boards: {
    5: FOG_ISLANDS_BOARD_5P, // 54 hexes
    6: FOG_ISLANDS_BOARD_6P, // 63 hexes — the task's one verified figure
  },
  verify: [
    '⚠ VERIFY (T-756, BEST-EFFORT): only the ~63-hex (6p) total and the "starting region + facedown ' +
      'fog hexes revealed by ship" mechanic were handed down for this task (the setup-diagram PDF ' +
      'cannot render on this machine) — the exact starting-island shape/position, the 54-hex 5p board, ' +
      'every fog/terrain/token/harbor multiset, and every fixed cell (pirate/robber starts, harbor ' +
      'faces, the desert) are this task\'s CHOSEN best-effort realization, not transcribed from the ' +
      'official setup diagram. Re-check against the physical booklet if it becomes available.',
    'STRANDING CONSTRAINT (the load-bearing invariant, T-756 review fix): every fog cell is an ISOLATED ' +
      'interior sea hex (all 6 neighbours are real sea) — enforced at module load by `assertFogIsolated`. ' +
      'This is what guarantees revealing a fog hex to land can never strand a ship (I5-ships) — every ' +
      'fog-bordering edge also borders a real sea hex. A side effect is that revealed fog hexes are ' +
      'single-hex islands and carry NO `island` tag, so this board has no `region: \'small\'` cells and ' +
      'the S10.6 small-island-chit mechanic never fires here. The real Fog Islands scenario likely hides ' +
      'some multi-hex / bonus-VP islands in its fog — a genuine gap, flagged as a FOLLOW-UP (representing ' +
      'it needs an `island` tag that survives a reveal, which the static `islandOfHex` lookup and the ' +
      '"never strand a ship" constraint together don\'t support today).',
    'FOG COUNT (⚠ VERIFY): only 6 (6p) / 5 (5p) fog cells, because the isolation constraint above caps ' +
      'how many non-adjacent interior sea hexes fit the near-shore band. Fewer than a literal "much of ' +
      'the map is fog" reading of the booklet — a best-effort engineering realization that keeps the ' +
      'mechanic provably safe. If the physical board is available, a larger fog field would need either ' +
      'multi-hex fog islands (see the stranding-constraint follow-up) or a bigger board.',
    'REACHABILITY (T-756 review fix): fog sits near-shore at q=4 (one sea column out from the q=2 coast) ' +
      'so the random bot reveals fog within a normal game at BOTH counts — asserted by the sim smoke\'s ' +
      '`fogTilesRevealed > 0`. The first cut placed fog 3+ columns out and 5p games ended before any ' +
      'ship reached it (revealed 0).',
    'REVEAL TRIGGER SCOPE: fog reveal fires from the two named ship actions only — `buildShip` (S4) ' +
      'and `moveShip` (S7), via the seafarers module\'s existing `afterAction` hook (`modules/' +
      'seafarers/index.ts`). A free ship placed by Road Building (`placeFreeShip`, S11.1) does NOT ' +
      'trigger a reveal even if it lands adjacent to a fog hex — a known, narrow gap (that fog hex just ' +
      'stays hidden until a later real build/move touches it), accepted to keep the reveal wired through ' +
      'the two actions the task spec named explicitly; never a correctness/leak bug (the hex stays ' +
      'correctly fogged, just revealed a little later).',
    'GOLD/TERRAIN COMPOSITION + TOKEN SPREADS (fog stacks and the starting island alike): entirely ' +
      'invented multisets (⚠ VERIFY) — no printed diagram in hand. Every token list avoids 7 but is ' +
      'NOT diagram-verified for adjacency-6/8 fairness beyond `generateScenarioBoard`\'s existing best- ' +
      'effort retry loop (S10.4).',
    'GEOMETRY: both frames (5p: 9×6 / 6p: 9×7, axial rows) are solid, hole-free rectangles — ' +
      'buildGeometry accepts any region partition of such a rectangle as a single simple coastline ' +
      '(same trick as every 5-6 scenario since T-751; confirmed via buildGeometry in scenario.test.ts). ' +
      'The starting island\'s only sea-adjacent coast is the q=2↔q=3 boundary (map edges bound the other ' +
      'three sides), so every harbor faces that one boundary.',
  ],
};

// ---------------------------------------------------------------------------
// "Cloth for Hexhaven" (T-757, Seafarers 5–6 extension) — NEW MECHANIC: cloth villages -> VP
// ---------------------------------------------------------------------------
// The official Cloth for Hexhaven scenario: small-island "villages" grant CLOTH tokens to nearby
// players whenever the village's number rolls; every 2 cloth = 1 VP. This task's model (PM-decided,
// docs/tasks/phase-7b/T-757): `ScenarioBoard.villages` (added by this task, see its own field comment
// above `ScenarioBoard`) marks WHICH small-island hexes are villages by POSITION only — no separate
// terrain/token multiset like `fog`'s hidden stack. A village PRODUCES CLOTH exactly like a normal
// hex produces resources: on its own per-game (S10.4-randomized) token, engine-side
// (`modules/seafarers/cloth.ts`'s `computeClothGains`, folded into the SAME dice-roll hook as gold
// production, gold.ts's shape) grants 1 cloth to every seat with a settlement/city touching it — the
// task's own documented SIMPLIFICATION of the printed "nearest two players split the cloth" rule (see
// verify[] below). `clothVp` (cloth.ts) then folds `floor(cloth/2)` into scoring, mirroring chits.ts's
// `islandChitVp` shape. NO new action/event/phase — `ext.seafarers.cloth[seat]` is the only new state.
//
// Board data REUSES New World's (T-752) exact terrain/token/harbor CountSpec and Frame geometry
// wholesale (both already proven, in scenario.test.ts, to build a valid single simple coastline with
// a balanced multiset) — the only NEW data this task contributes is `villages`: EVERY small-island
// hex (all 3 islands, in full) is tagged as a cloth-producing village. Terrain WITHIN each region is
// re-randomized per game (S10.4, `board.ts`'s `assignTerrain`), so a village's ACTUAL terrain (and
// therefore whether it occasionally lands on a shuffled gold cell too) varies game to game regardless
// of which position was picked here — an accepted, harmless emergent interaction (see verify[]), not
// a defect to engineer around.
//
// VILLAGE DENSITY (a sim-driven fix, T-757 review — the exact T-756 lesson "the mechanic never fired
// in real play" applied here): a first cut tagged only ONE hex per island (3 of 12-13 small-island
// cells); the sim smoke below caught a 20-game sample where bots settled a DIFFERENT small-island hex
// than the tagged one and produced zero cloth all game. Tagging EVERY small-island cell removes that
// gap: any settlement/city a bot places on ANY small island now produces cloth on its own roll, so
// production tracks the scenario's OWN (already-proven-nontrivial) island-settling rate instead of a
// much narrower "hits one specific hex" rate.

const CLOTH_FOR_HEXHAVEN_VILLAGES_6P: readonly Cell[] = [
  ...NW_FRAME_6P.small[0]!.cells,
  ...NW_FRAME_6P.small[1]!.cells,
  ...NW_FRAME_6P.small[2]!.cells,
];

const CLOTH_FOR_HEXHAVEN_VILLAGES_5P: readonly Cell[] = [
  ...NW_FRAME_5P.small[0]!.cells,
  ...NW_FRAME_5P.small[1]!.cells,
  ...NW_FRAME_5P.small[2]!.cells,
];

/** Build a Cloth for Hexhaven `ScenarioBoard`: the normal scenario board PLUS the `villages` tag list
 *  (positions only — see this section's header for why terrain/token need no separate multiset). */
function buildClothForHexhavenBoard(
  playerCount: 5 | 6,
  spec: CountSpec,
  frame: Frame,
  villages: readonly Cell[]
): ScenarioBoard {
  return { ...buildScenarioBoard(playerCount, spec, frame), villages };
}

const CLOTH_FOR_HEXHAVEN_BOARD_6P = buildClothForHexhavenBoard(6, NW_SPEC_6P, NW_FRAME_6P, CLOTH_FOR_HEXHAVEN_VILLAGES_6P);
const CLOTH_FOR_HEXHAVEN_BOARD_5P = buildClothForHexhavenBoard(5, NW_SPEC_5P, NW_FRAME_5P, CLOTH_FOR_HEXHAVEN_VILLAGES_5P);

/**
 * "Cloth for Hexhaven" (T-757) — the seventh Seafarers scenario, 5–6 players ONLY (`boardPresets.ts`
 * gates the picker to `players: [5, 6]`; no 3p/4p entries here). NEW MECHANIC: cloth-producing
 * villages (see this section's header). `targetVp` is the STANDARD Seafarers 14 (⚠ VERIFY) — cloth VP
 * is a separate, additive mechanic on top of the ordinary S10.6 small-island chit bonus, not a
 * replacement for it (`smallIslandVp` stays the flat 2, unchanged).
 */
export const CLOTH_FOR_HEXHAVEN: Scenario = {
  id: 'clothForHexhaven',
  targetVp: 14, // ⚠ VERIFY — assumed standard Seafarers 5-6 target (no printed booklet in hand)
  smallIslandVp: 2, // S10.6, unaffected by the cloth mechanic (additive, not a replacement)
  boards: {
    5: CLOTH_FOR_HEXHAVEN_BOARD_5P, // 54 hexes (reuses NEW_WORLD's 5p multiset/frame)
    6: CLOTH_FOR_HEXHAVEN_BOARD_6P, // 63 hexes (reuses NEW_WORLD's 6p multiset/frame)
  },
  verify: [
    '⚠ VERIFY (T-757, BEST-EFFORT): only the "small islands host cloth villages; every 2 cloth = 1 ' +
      'VP" mechanic shape was handed down for this task (the setup-diagram PDF cannot render on this ' +
      'machine) — this board REUSES New World\'s (T-752) exact terrain/token/harbor multiset and frame ' +
      'geometry wholesale (both already proven valid/balanced in scenario.test.ts); the only new data ' +
      'is `villages` (every small-island hex on all 3 islands — a sim-driven density choice, see the ' +
      '"VILLAGE DENSITY" header comment above this scenario\'s data). Re-check against the official ' +
      'booklet (which specific hexes are villages, and the target VP) if it becomes available.',
    '⚠ VERIFY (THE CLOTH MECHANIC, the scenario\'s defining simplification): the official rule splits ' +
      'each village\'s cloth between the NEAREST TWO players (by ship/settlement proximity) on its ' +
      'number roll. This build SIMPLIFIES that to "every seat with a settlement/city on a vertex ' +
      'touching the village hex gains 1 cloth" — no proximity ranking, no 2-player cap, and a seat with ' +
      'BOTH a settlement and a city on the same village still earns only 1 cloth per roll (dedup per ' +
      'hex/seat, `modules/seafarers/cloth.ts`\'s `computeClothGains`). A deliberate low-risk choice ' +
      '(matches the task spec\'s own mandated model) — replace with the real nearest-two-split rule if ' +
      'faithfulness becomes a priority.',
    'ROBBER INTERACTION: a village hex under the robber produces NO cloth on its number (mirrors R5.2\'s ' +
      'ordinary production block, and gold.ts\'s own S9.3 robber check) — not called out in the task ' +
      'spec explicitly, but the natural reading of "producing near a village" under the base robber rule.',
    'GOLD OVERLAP (harmless, not a bug): village POSITIONS are fixed, but S10.4 re-randomizes terrain ' +
      'WITHIN each region every game (`board.ts`\'s `assignTerrain`) — so a village occasionally lands ' +
      'on a shuffled `gold` cell in a given game, in which case its number roll ALSO opens the ' +
      '`chooseGoldResource` sub-phase (gold.ts) on top of granting cloth. Both mechanics read the same ' +
      'per-game token independently and neither interferes with the other\'s bank/resource accounting — ' +
      'an accepted emergent double-production hex, not a defect to engineer around.',
    'GEOMETRY: reuses NEW_WORLD\'s (T-752) exact 5p/6p frames (solid, hole-free hex-block rectangles, ' +
      '9×6 / 9×7 in axial rows r=-4..4) — buildGeometry accepts any main/small/sea partition of such a ' +
      'block as a single simple coastline (confirmed via buildGeometry in scenario.test.ts, same as ' +
      'every 5-6 scenario since T-751). Main island is one connected blob; the 3 small islands (A/B/C, ' +
      'every hex a village) are each independently connected (S10.6).',
  ],
};

// ---------------------------------------------------------------------------
// "The Pirate Islands" (T-758, Seafarers 5–6 extension) — NEW MECHANIC: an auto-moving pirate track
// + capturable lairs
// ---------------------------------------------------------------------------
// The official Pirate Islands scenario has the pirate ship patrol a fixed circuit of sea hexes,
// advancing automatically (no 7/knight needed) and threatening nearby pirate lairs a player can raid
// for bonus VP. This task's model (PM-decided, docs/tasks/phase-7b/T-758): `ScenarioBoard.pirateTrack`
// (added by this task, see its own field comment above `ScenarioBoard`) is an ORDERED list of sea
// cells (each flagged `safe` or not) the pirate steps through one cell per dice roll, wrapping at the
// end (`modules/seafarers/pirateTrack.ts`'s `advancePirateTrack`, folded into the SAME dice-roll hook
// gold/cloth production use — NO new Action). At a `safe` (`!`) cell the pirate is inert that turn (no
// S8.5 blocking); everywhere else it blocks ship build/move exactly like the ordinary S8 pirate
// (`modules/seafarers/pirate.ts`'s existing `edgeBordersPirate`, reused unchanged apart from the
// safe-cell gate). `ScenarioBoard.lairs` marks pirate-lair hexes; the FIRST seat to place a ship or
// settlement on an edge/vertex touching one captures it for a small VP bonus
// (`modules/seafarers/lairs.ts`'s `grantLairCapture`, mirroring chits.ts's `grantIslandChit` shape) —
// deliberately NO new event for the capture itself (this task's own DECISION, ⚠ VERIFY — see
// PIRATE_ISLANDS.verify below): the existing `islandSettled` event doesn't semantically fit a lair
// capture, and T-757's cloth-production hook already established the precedent that a silently-applied
// ext update needs no event of its own (the client reads the new PUBLIC `lairs` field straight off
// state, same as `cloth`).
//
// DEADLOCK AVOIDANCE (the task's own CRITICAL risk, docs/tasks/phase-7b/T-758): board data REUSES New
// World's (T-752) exact terrain/token/harbor multiset and frame geometry wholesale (both already proven
// valid/balanced in scenario.test.ts) — the only new data is `pirateTrack`/`lairs`. `pirateTrack` is
// confined to the frame's NON-HARBOR sea cells (every harbor-adjacent sea cell — the main-island-to-
// small-island channel bots actually need — is EXCLUDED), so the auto-moving pirate never blocks the
// primary settle/harbor lanes. It also advances on EVERY roll (not gated on a number match, unlike
// gold/cloth), so it never lingers on one cell for long, further thinning any blocking exposure.
// Verified against the sim (`sim/seafarers.test.ts`'s T-758 smoke): both 5p and 6p reliably COMPLETE
// (reach the 14-VP target, never hit maxActions) with zero invariant violations.

/** 6p track (7 cells, 2 marked safe) — every NW_FRAME_6P sea cell NOT also a harbor cell. Starts on
 *  the frame's own `pirateStart` (6,-2), so `createGame`'s generated pirate hex lines up with index 0. */
const PIRATE_ISLANDS_TRACK_6P: readonly { cell: Cell; safe: boolean }[] = [
  { cell: cell(6, -2), safe: false }, // = NW_FRAME_6P.pirateStart
  { cell: cell(5, -2), safe: true },
  { cell: cell(5, 1), safe: false },
  { cell: cell(5, 2), safe: false },
  { cell: cell(6, 2), safe: false },
  { cell: cell(6, 3), safe: true },
  { cell: cell(6, 4), safe: false },
];

/** 5p track (4 cells, 1 marked safe) — every NW_FRAME_5P sea cell NOT also a harbor cell. Starts on
 *  the frame's own `pirateStart` (5,-4). */
const PIRATE_ISLANDS_TRACK_5P: readonly { cell: Cell; safe: boolean }[] = [
  { cell: cell(5, -4), safe: false }, // = NW_FRAME_5P.pirateStart
  { cell: cell(4, -2), safe: true },
  { cell: cell(4, 1), safe: false },
  { cell: cell(4, 2), safe: false },
];

// Lairs: every cell of small island "C" (group id 2) — a density choice mirroring Cloth for Hexhaven's
// own "every small-island hex" fix (T-757's header: tagging only ONE hex per island risked bots
// settling a DIFFERENT hex and the mechanic never firing; tagging a whole island's cells removes that
// gap, so any settlement/ship reaching island C reliably captures its lair).
const PIRATE_ISLANDS_LAIRS_6P: readonly Cell[] = [...NW_FRAME_6P.small[2]!.cells];
const PIRATE_ISLANDS_LAIRS_5P: readonly Cell[] = [...NW_FRAME_5P.small[2]!.cells];

/** Build a Pirate Islands `ScenarioBoard`: the normal scenario board PLUS `pirateTrack`/`lairs`. */
function buildPirateIslandsBoard(
  playerCount: 5 | 6,
  spec: CountSpec,
  frame: Frame,
  pirateTrack: readonly { cell: Cell; safe: boolean }[],
  lairs: readonly Cell[]
): ScenarioBoard {
  return { ...buildScenarioBoard(playerCount, spec, frame), pirateTrack, lairs };
}

const PIRATE_ISLANDS_BOARD_6P = buildPirateIslandsBoard(
  6,
  NW_SPEC_6P,
  NW_FRAME_6P,
  PIRATE_ISLANDS_TRACK_6P,
  PIRATE_ISLANDS_LAIRS_6P
);
const PIRATE_ISLANDS_BOARD_5P = buildPirateIslandsBoard(
  5,
  NW_SPEC_5P,
  NW_FRAME_5P,
  PIRATE_ISLANDS_TRACK_5P,
  PIRATE_ISLANDS_LAIRS_5P
);

/**
 * "The Pirate Islands" (T-758) — the eighth Seafarers scenario, 5–6 players ONLY (`boardPresets.ts`
 * gates the picker to `players: [5, 6]`; no 3p/4p entries here). NEW MECHANIC: the auto-moving pirate
 * track + capturable lairs (see this section's header). `targetVp` is the STANDARD Seafarers 14
 * (⚠ VERIFY) — lair VP is a separate, additive mechanic on top of the ordinary S10.6 small-island chit
 * bonus, not a replacement for it (`smallIslandVp` stays the flat 2, unchanged).
 */
export const PIRATE_ISLANDS: Scenario = {
  id: 'pirateIslands',
  targetVp: 14, // ⚠ VERIFY — assumed standard Seafarers 5-6 target (no printed booklet in hand)
  smallIslandVp: 2, // S10.6, unaffected by the lair mechanic (additive, not a replacement)
  boards: {
    5: PIRATE_ISLANDS_BOARD_5P, // 54 hexes (reuses NEW_WORLD's 5p multiset/frame)
    6: PIRATE_ISLANDS_BOARD_6P, // 63 hexes (reuses NEW_WORLD's 6p multiset/frame)
  },
  verify: [
    '⚠ VERIFY (T-758, BEST-EFFORT): only the "pirate patrols a fixed track automatically; lairs give ' +
      'bonus VP when raided" mechanic SHAPE was handed down for this task (the setup-diagram PDF cannot ' +
      'render on this machine) — this board REUSES New World\'s (T-752) exact terrain/token/harbor ' +
      'multiset and frame geometry wholesale (both already proven valid/balanced in scenario.test.ts); ' +
      'the only new data is `pirateTrack` (7/4 non-harbor sea cells, T-758\'s own sim-tuned routing — ' +
      'see the "DEADLOCK AVOIDANCE" header comment above this scenario\'s data) and `lairs` (every cell ' +
      'of small island C). Re-check against the official booklet (the real track route, which cells are ' +
      '`!` safe, which hexes are lairs, and the target VP) if it becomes available.',
    '⚠ VERIFY (THE PIRATE TRACK, the scenario\'s defining mechanic): the real booklet\'s track is a ' +
      'printed loop of specific hexes with specific `!` markers; this build INVENTS a track confined to ' +
      'this board\'s non-harbor sea cells (T-758\'s own deadlock-avoidance choice, sim-verified in ' +
      'sim/seafarers.test.ts) rather than transcribing the physical layout. The pirate advances ONE step ' +
      'EVERY dice roll (not gated on a number match) — a documented SIMPLIFICATION versus any printed ' +
      '"moves on a 7" nuance, chosen because it is what T-758\'s task spec mandates and what the sim ' +
      'could actually verify game-to-game.',
    '⚠ VERIFY (LAIR CAPTURE, the scenario\'s other new mechanic): the official rule\'s exact capture ' +
      'condition/VP amount were not handed down. This build grants `LAIR_VP` (1, `modules/seafarers/' +
      'lairs.ts`) to the FIRST seat whose ship or settlement touches a lair hex, once per lair, with NO ' +
      'new event (see this section\'s header for why) — a deliberate low-risk choice, replace with the ' +
      'real capture rule/VP amount if the booklet becomes available.',
    'PIRATE-SAFE INTERACTION: a `!` track cell suppresses S8.5 blocking ONLY (`ext.seafarers.' +
      'pirateTrackSafe`, read by `edgeBordersPirate`) — the pirate still occupies the hex (renders, and ' +
      'still counts for SF-PIRATE\'s "pirate sits on a sea hex" invariant); it simply never blocks ships ' +
      'that turn. Not called out explicitly in the task spec, but the natural reading of "inert that ' +
      'turn" (S8.5 is the ONLY thing the pirate does outside a steal, and this scenario\'s pirate never ' +
      'steals).',
    'GEOMETRY: reuses NEW_WORLD\'s (T-752) exact 5p/6p frames (solid, hole-free hex-block rectangles, ' +
      '9×6 / 9×7 in axial rows r=-4..4) — buildGeometry accepts any main/small/sea partition of such a ' +
      'block as a single simple coastline (confirmed via buildGeometry in scenario.test.ts, same as ' +
      'every 5-6 scenario since T-751). Main island is one connected blob; the 3 small islands (A/B/C, ' +
      'island C entirely lairs) are each independently connected (S10.6).',
  ],
};

// ---------------------------------------------------------------------------
// "The Wonders of Hexhaven" (T-759, Seafarers 5–6 extension) — FINAL scenario. NEW MECHANIC: a
// build-a-wonder ALTERNATE WIN.
// ---------------------------------------------------------------------------
// The official scenario has players actively BUY wonder stages with dedicated resource sets — a new
// build Action, which the task's PM-decided model explicitly avoids (docs/tasks/phase-7b/T-759, "the
// exhaustive-switch cascade we avoid"). Instead, wonder progress is DERIVED from pieces a seat
// already builds: `modules/seafarers/wonder.ts`'s `advanceWonderProgress` (folded into the SAME
// settlement/city build afterAction hook, `modules/seafarers/index.ts`) completes a stage once the
// seat's cities+settlements COUNT crosses that stage's rising threshold while their CURRENT hand
// happens to hold that stage's resource stockpile — a best-effort proxy for "bought a wonder stage"
// (⚠ VERIFY heavily, see this scenario's `verify[]`). Completing every stage is an ALTERNATE WIN
// (`vp.ts`'s `checkWin`, gated strictly on `ext.seafarers.wonder` presence — absent for every other
// scenario/game, so the normal-VP win path is byte-for-byte unchanged elsewhere, RK-13). The board
// itself needs NO new `ScenarioBoard` field (unlike `villages`/`pirateTrack`/`lairs` before it) — the
// mechanic is purely per-seat piece/hand bookkeeping, not tied to any board position — so this reuses
// New World's (T-752) exact terrain/token/harbor multiset and frame geometry wholesale, unmodified.

/**
 * "The Wonders of Hexhaven" (T-759) — the ninth and FINAL Seafarers scenario, 5–6 players ONLY
 * (`boardPresets.ts` gates the picker to `players: [5, 6]`; no 3p/4p entries here). NEW MECHANIC:
 * build-a-wonder alternate win (see this section's header). `targetVp` is the STANDARD Seafarers 14
 * (⚠ VERIFY) — the normal VP-target win still applies IN PARALLEL with the wonder alternate win,
 * whichever a seat reaches first (`modules/seafarers/wonder.ts`'s header).
 */
export const WONDERS_OF_HEXHAVEN: Scenario = {
  id: 'wondersOfHexhaven',
  targetVp: 14, // ⚠ VERIFY — assumed standard Seafarers 5-6 target (no printed booklet in hand)
  smallIslandVp: 2, // S10.6, unaffected by the wonder mechanic (additive, not a replacement)
  boards: {
    5: buildScenarioBoard(5, NW_SPEC_5P, NW_FRAME_5P), // 54 hexes (reuses NEW_WORLD's 5p multiset/frame)
    6: buildScenarioBoard(6, NW_SPEC_6P, NW_FRAME_6P), // 63 hexes (reuses NEW_WORLD's 6p multiset/frame)
  },
  verify: [
    '⚠ VERIFY (T-759, BEST-EFFORT): only the "build a wonder in stages; completing it is an alternate ' +
      'win" mechanic SHAPE was handed down for this task (the setup-diagram/rules PDF cannot render on ' +
      'this machine) — this board REUSES New World\'s (T-752) exact terrain/token/harbor multiset and ' +
      'frame geometry wholesale, unmodified (no new board data at all — the mechanic is purely per-seat ' +
      'bookkeeping, `modules/seafarers/wonder.ts`). Re-check against the official booklet (the real board ' +
      'layout and target VP) if it becomes available.',
    '⚠ VERIFY (THE WONDER MODEL, the scenario\'s defining simplification — PM-decided, LOW-RISK): the ' +
      'official game has players actively BUY wonder stages with dedicated resource sets via their own ' +
      'action. This build has NO such action; instead `WONDER_STAGES` (4) complete automatically, one at ' +
      'a time, in the EXISTING settlement/city build afterAction hook, once the seat\'s cities+settlements ' +
      'COUNT reaches that stage\'s `WONDER_THRESHOLDS` entry AND their CURRENT hand (after the triggering ' +
      'build\'s own cost was paid) happens to hold that stage\'s `WONDER_STAGE_COSTS` resource stockpile — ' +
      'a proxy for "developed and resourced enough to plausibly have bought this many stages", not a real ' +
      'purchase (no resources are spent on it). Replace with the real stage costs/thresholds and a proper ' +
      'purchase action if the booklet becomes available.',
    '⚠ VERIFY (STAGE COUNT/COSTS): `WONDER_STAGES` (4) and every `WONDER_THRESHOLDS`/`WONDER_STAGE_COSTS` ' +
      'entry (`modules/seafarers/wonder.ts`) are this task\'s own INVENTED v1 numbers, sim-tuned only to ' +
      'confirm the alternate win actually decides some games (sim/seafarers.test.ts\'s T-759 smoke) — not ' +
      'sourced from any printed reference. The real wonder likely has per-wonder-type stage costs; this ' +
      'build ships exactly one generic wonder track for every seat.',
    '⚠ VERIFY (WONDER VP): each completed stage also grants 1 VP (`wonderVp`, `vp.ts`), a v1 DECISION to ' +
      'keep progress visible on the scoreboard before completion — additive to the alternate win, not a ' +
      'replacement for it. The real game may not award incremental VP for partial wonder progress.',
    'GEOMETRY: reuses NEW_WORLD\'s (T-752) exact 5p/6p frames (solid, hole-free hex-block rectangles, ' +
      '9×6 / 9×7 in axial rows r=-4..4) — buildGeometry accepts any main/small/sea partition of such a ' +
      'block as a single simple coastline (confirmed via buildGeometry in scenario.test.ts, same as ' +
      'every 5-6 scenario since T-751). Main island is one connected blob; the 3 small islands (A/B/C) ' +
      'are each independently connected (S10.6) — none of them carry any wonder-specific data.',
  ],
};

/** Registry of shipped scenarios, keyed by id (pure data — the Seafarers analogue of `RuleModule`). */
export const SCENARIOS: Record<ScenarioId, Scenario> = {
  headingForNewShores: HEADING_FOR_NEW_SHORES,
  newWorld: NEW_WORLD,
  throughTheDesert: THROUGH_THE_DESERT,
  forgottenTribe: FORGOTTEN_TRIBE,
  sixIslands: SIX_ISLANDS,
  fogIslands: FOG_ISLANDS,
  clothForHexhaven: CLOTH_FOR_HEXHAVEN,
  pirateIslands: PIRATE_ISLANDS,
  wondersOfHexhaven: WONDERS_OF_HEXHAVEN,
};

/** A known scenario by id, or `undefined` for an unshipped/unknown id (callers gate on this). */
export function getScenario(id: string): Scenario | undefined {
  return (SCENARIOS as Record<string, Scenario>)[id];
}

/** Type guard: is `id` a shipped `ScenarioId`? Used by engine/server config gating. */
export function isScenarioId(id: string): id is ScenarioId {
  return Object.prototype.hasOwnProperty.call(SCENARIOS, id);
}
