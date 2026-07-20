// Explorers & Pirates — exploration + fog reveal (T-1103, docs/rules/explorers-pirates-rules.md
// §EP5/§EP12.4). Builds onto T-1102's ship-movement engine (ships.ts): a ship's arrival at a sea
// edge bordering an unexplored hex reveals it — draws the next `EPTile` from the seeded
// `explorationSupply`, writes its real content into `board.hexes`/`ext.explorersPirates.seaMap`, and
// removes the hex from `unexplored`. Folded into `moveEPShipHandler` (ships.ts) per this task's own
// recommendation — no dedicated `explore` action, no new `EngineErrorCode` (a reveal can't fail from
// the acting seat's point of view; it's a side effect of a legal move, not a validated request).
//
// v1 model (⚠ VERIFY every item — same discipline as ships.ts's own header comment):
//  - **Reveal trigger** (EP5.1, "roll the die... when a ship reaches an unexplored hex-edge/tile"):
//    checked ONLY against the ship's DESTINATION edge (`moveEPShip`'s `to`), not every edge along the
//    BFS path it glided through this move (the engine doesn't track the literal hop-by-hop path
//    taken, only the reachability distance — see ships.ts's `seaEdgesWithinRange`). ⚠ VERIFY against
//    the physical rulebook whether intermediate hops should also trigger reveals.
//  - **Draw order** (EP5.1 "roll the die" — modeled as a draw, not a fresh `state.rng` call): the
//    "die roll" is consuming the NEXT entry of the pre-shuffled `explorationSupply` queue (shuffled
//    once at `seedExplorationV0` init, the "seeded" part of "seeded draw pile"). Reveal itself is a
//    pure function of the supply's remaining order — no extra rng threading through
//    `moveEPShipHandler`, mirroring how `devDeck`'s order (not a fresh roll) decides a dev-card draw.
//  - **Multiple hexes per reveal**: a sea edge borders up to 2 hexes (`GEOMETRY.edges[e].hexes`); if
//    BOTH are still unexplored, both are revealed by the same `moveEPShip`, each drawing its own
//    supply entry (consumed in `edge.hexes` array order) and emitting its own `epTileRevealed` event.
//  - **gold/nothing outcomes don't touch `board.hexes`**: only a `terrain` outcome writes a real
//    land tile there; `board.hexes[hex]` is already the sea proxy (`{terrain:'desert', token:null}`,
//    board.ts) for every unrevealed hex, so a `gold` outcome only touches `seaMap` (`'gold'`,
//    mirroring seafarers' own sea/gold proxy split); `nothing` touches neither — the emitted event is
//    the only record.
//  - **`pirate` (T-1105 update, §EP7.2, ⚠ VERIFY): a pirate reveal IS a lair on a gold field** — the
//    Pirate Lairs mission's own reading of "a gold field with a pirate lair" (docs/tasks/phase-11/
//    T-1105-pirate-lairs.md). `board.hexes` stays the sea proxy (same as a plain `gold` reveal) but
//    `seaMap[hex]` is written `'gold'` (not left as `'sea'`, unlike this file's ORIGINAL T-1103
//    behavior) AND a fresh, uncaptured `{ hex, crews: [] }` entry is appended to
//    `ext.explorersPirates.pirateLairs` — this is the "one documented place" lairs are created (see
//    `modules/explorersPirates/pirateLairs.ts`'s own header for the rest of the mission).

import type { EdgeId, EPTile, GameEvent, GameState, HexId, ScenarioTerrain, Seat } from '@hexhaven/shared';
import { shuffle } from '../../rng.js';
import { epTileRevealed } from '../../events.js';
import { geometryForState } from '../index.js';
import { epExt, withEpExt } from './state.js';

/**
 * ⚠ VERIFY v1 approximation (die->tile table, EP5.1): 12 entries — exactly the T-1102 v0 test
 * board's non-home (open-sea-ring) hex count (`buildLandHoBoardV0`, board.ts) — 6 resource-terrain
 * tiles (plausible tokens, no 6/8-adjacency check, same allowance as board.ts's own
 * `LAND_HO_V0_TOKENS`), 2 gold fields, 2 pirates, 2 "nothing" tiles. The real Land Ho! exploration-
 * tile supply is T-1107's to author from the physical rulebook/mission guide.
 */
export const EP_EXPLORATION_TILES: readonly EPTile[] = [
  { kind: 'terrain', terrain: 'hills', token: 4 },
  { kind: 'terrain', terrain: 'forest', token: 9 },
  { kind: 'terrain', terrain: 'pasture', token: 10 },
  { kind: 'terrain', terrain: 'fields', token: 11 },
  { kind: 'terrain', terrain: 'mountains', token: 5 },
  { kind: 'terrain', terrain: 'forest', token: 6 },
  { kind: 'gold' },
  { kind: 'gold' },
  { kind: 'pirate' },
  { kind: 'pirate' },
  { kind: 'nothing' },
  { kind: 'nothing' },
];

/**
 * T-1150 (Phase 11B, ⚠ VERIFY liberally — no rulebook source): the 5–6 player extension's exploration
 * supply — 18 entries, exactly `buildLandHoBoard56`'s open-sea-ring hex count (vs the 3–4 board's 12)
 * — scaled ~1.5x from `EP_EXPLORATION_TILES` proportionally: 9 terrain tiles (plausible tokens, no
 * 6/8-adjacency check, same allowance as the 3–4 table), 3 gold fields, 3 pirates (so up to 3 pirate
 * lairs can spawn over a 5–6 game, vs 2 at 3–4 — this IS the "lair count" scaling; lairs have no
 * separate seed constant of their own, see `pirateLairs.ts`'s header), 3 "nothing" tiles.
 */
export const EP_EXPLORATION_TILES_56: readonly EPTile[] = [
  { kind: 'terrain', terrain: 'hills', token: 4 },
  { kind: 'terrain', terrain: 'forest', token: 9 },
  { kind: 'terrain', terrain: 'pasture', token: 10 },
  { kind: 'terrain', terrain: 'fields', token: 11 },
  { kind: 'terrain', terrain: 'mountains', token: 5 },
  { kind: 'terrain', terrain: 'forest', token: 6 },
  { kind: 'terrain', terrain: 'hills', token: 8 },
  { kind: 'terrain', terrain: 'pasture', token: 3 },
  { kind: 'terrain', terrain: 'fields', token: 12 },
  { kind: 'gold' },
  { kind: 'gold' },
  { kind: 'gold' },
  { kind: 'pirate' },
  { kind: 'pirate' },
  { kind: 'pirate' },
  { kind: 'nothing' },
  { kind: 'nothing' },
  { kind: 'nothing' },
];

/**
 * `seedExplorationV0(rng, built, tiles?)` (T-1103 init helper — used by TESTS only, no `createGame`
 * wiring yet, mirroring T-1102's own `ext.explorersPirates` discipline, see state.ts's header): every
 * hex the given board classifies `'sea'` (⚠ VERIFY — "non-home hex" read as "not yet real
 * land/desert", matching `buildLandHoBoardV0`'s own home-island/open-sea split) becomes `unexplored`;
 * `explorationSupply` is `tiles` shuffled via the threaded `rng` (never `Math.random`, docs/05 §2).
 * Throws (a `BUG:` programmer error, mirroring `buildLandHoBoardV0`'s own hex-count guard) if the
 * board's sea-hex count doesn't match `tiles`'s length.
 *
 * T-1150 (Phase 11B): `tiles` is now an optional 3rd parameter defaulting to `EP_EXPLORATION_TILES`
 * (the ORIGINAL, only, argument before this task) — every existing call site is untouched and gets
 * the exact same behavior (RK-13); `createGame`'s E&P branch passes `EP_EXPLORATION_TILES_56`
 * explicitly for a `fiveSix` game (the bigger board's bigger fog-hex count needs the bigger table).
 */
export function seedExplorationV0(
  rng: GameState['rng'],
  built: { seaMap: readonly ScenarioTerrain[] },
  tiles: readonly EPTile[] = EP_EXPLORATION_TILES
): { explorationSupply: EPTile[]; unexplored: HexId[]; rng: GameState['rng'] } {
  const unexplored: HexId[] = [];
  built.seaMap.forEach((t, hex) => {
    if (t === 'sea') unexplored.push(hex as HexId);
  });
  if (unexplored.length !== tiles.length) {
    throw new Error(
      `BUG: seedExplorationV0 expected exactly ${tiles.length} non-home (sea) hexes, found ${unexplored.length} — the exploration tile table must match the board's fog-hex count (⚠ VERIFY)`
    );
  }
  const shuffled = shuffle(rng, tiles);
  return { explorationSupply: shuffled.array, unexplored, rng: shuffled.state };
}

/**
 * The reveal trigger (EP5.1, see this module's header for the v1 adjacency/draw-order model): for
 * every still-`unexplored` hex bordering `edge`, draws the next `explorationSupply` entry, writes its
 * real content into `board.hexes`/`ext.explorersPirates.seaMap`, drops the hex from `unexplored`, and
 * returns an `epTileRevealed` event for it. A no-op (`state` unchanged, `events: []`) outside a live
 * E&P game, when `edge` borders no unexplored hex, or once the supply is exhausted (defensive — never
 * hit by a correctly-sized `EP_EXPLORATION_TILES`, see `seedExplorationV0`'s guard).
 */
export function revealOnArrival(
  state: GameState,
  seat: Seat,
  edge: EdgeId
): { state: GameState; events: GameEvent[] } {
  const ext = epExt(state);
  if (!ext) return { state, events: [] };
  const unexplored = ext.unexplored ?? [];
  if (unexplored.length === 0) return { state, events: [] };

  const geomEdge = geometryForState(state).edges[edge];
  const candidateHexes = (geomEdge?.hexes ?? []).filter((h) => unexplored.includes(h));
  if (candidateHexes.length === 0) return { state, events: [] };

  const supply = [...(ext.explorationSupply ?? [])];
  const seaMap = [...(ext.seaMap ?? [])];
  const pirateLairs = [...(ext.pirateLairs ?? [])];
  let hexes = state.board.hexes;
  const revealed: HexId[] = [];
  const events: GameEvent[] = [];

  for (const hex of candidateHexes) {
    const tile = supply.shift();
    if (!tile) break; // defensive: see this fn's header comment.
    revealed.push(hex);

    if (tile.kind === 'terrain') {
      if (hexes === state.board.hexes) hexes = hexes.slice();
      hexes[hex] = { terrain: tile.terrain, token: tile.token };
      seaMap[hex] = tile.terrain;
    } else if (tile.kind === 'gold') {
      seaMap[hex] = 'gold';
    } else if (tile.kind === 'pirate') {
      // T-1105 (§EP7.2, ⚠ VERIFY — see this file's header): a pirate reveal is a lair on a gold
      // field — same seaMap write as a plain 'gold' reveal, plus a fresh active lair.
      seaMap[hex] = 'gold';
      pirateLairs.push({ hex, crews: [] });
    }
    // 'nothing': board.hexes/seaMap already correctly read as open sea (the sea proxy) — nothing to
    // write there; the event below is the only record.

    events.push(epTileRevealed(seat, hex, tile));
  }

  if (events.length === 0) return { state, events: [] };

  const board = hexes === state.board.hexes ? state.board : { ...state.board, hexes };
  const nextUnexplored = unexplored.filter((h) => !revealed.includes(h));
  const next = withEpExt(
    { ...state, board },
    { ...ext, seaMap, explorationSupply: supply, unexplored: nextUnexplored, pirateLairs }
  );
  return { state: next, events };
}
