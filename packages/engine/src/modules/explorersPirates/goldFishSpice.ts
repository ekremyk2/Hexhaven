// Explorers & Pirates — Fish for Hexhaven, Spices for Hexhaven & the gold economy (T-1106, docs/rules/
// explorers-pirates-rules.md §EP6/§EP8/§EP9). The LAST two E&P missions + the gold economy — with
// T-1105's Pirate Lairs, all three missions + gold now exist; T-1107 assembles the scenarios.
// Builds on T-1102's ship/cargo engine (ships.ts, `'fish'`/`'spice'` are its own `EPCargo` kinds) and
// mirrors T-1105's own mission shape (`pirateLairs.ts`: a VP track + a deliver-to-target action).
//
// T-1110 (fish-auto-haul fidelity fix, FOLLOWUPS.md): the ORIGINAL v1 seeding (below) wrote BOTH
// `fishShoals` AND `villages`/`councilVertex` into `ext.explorersPirates` whenever EITHER
// `missions.fish` OR `missions.spice` was on (createGame.ts) — so e.g. Spices for Hexhaven (spice ON,
// fish OFF) also got real fish shoals, letting `haulFishOnArrival` auto-haul + `deliverFish` score
// fish points that scenario never intended (and the mirror case for Fish for Hexhaven/villages). This
// task closes it two ways: (1) createGame.ts now seeds `fishShoals` only when `missions.fish` and
// `villages` only when `missions.spice` (each independently, `councilVertex` still shared whenever
// either is on); (2) `haulFishOnArrival`/`deliverFishHandler`/`deliverSpiceHandler` below ALSO
// explicitly re-check `epFishMissionActive`/`epSpiceMissionActive` (state.ts) themselves, so the fix
// isn't solely load-bearing on createGame's own seeding discipline. Land Ho! (no missions) + the
// RK-13 base-game oracle are untouched by either change (their own paths never call any of this).
//
// v1 model (provisional — every constant a ⚠ VERIFY placeholder, same discipline as ships.ts/
// exploration.ts/settling.ts/pirateLairs.ts's own headers):
//  - **Gold compensation (EP6.1)**: on a producing `rollDice` (total !== 7 — a 7 never produces, so
//    "received no resource" would trivially include everyone; gated by checking the roll's own
//    `production` event, which only ever exists for a non-7 total), every seat with NO entry in that
//    event's `gains` (i.e. zero resources this roll) gets `GOLD_COMPENSATION` (1, ⚠ VERIFY) gold. A
//    `phaseHooks.afterAction` hook (`applyGoldCompensation`, index.ts wires it), E&P-gated the same
//    way `applyFishermenProduction` gates on `tbExt`'s scenario.
//  - **Gold fields folding into the compensation rule (EP6.1, ⚠ VERIFY — this task's own DECISION)**:
//    a revealed `'gold'` tile (exploration.ts) never writes a real `board.hexes` token — it stays the
//    sea proxy (`token: null`) — so a gold field can never itself match a roll total and produce
//    separately. Rather than invent a parallel "gold field production" mechanic with no `board.hexes`
//    entry to hang it off, v1 folds gold-field production entirely into EP6.1's flat no-resource
//    compensation above (every seat who owns a building on a gold field simply produces nothing there,
//    same as any other unmatched hex, and picks up their compensation gold like everyone else who
//    didn't produce this roll). ⚠ VERIFY against the physical rulebook whether gold fields should
//    instead mint gold on their OWN number independent of this compensation rule.
//  - **`shipGold` has no location requirement (EP6.2, ⚠ VERIFY — this task's own DECISION)**: gold is
//    an abstract per-seat tally (like T&B's own `gold`/`coins`), not a cargo piece — spending
//    `GOLD_PER_VP` (3, ⚠ VERIFY) of it for 1 VP is modeled as a flat main-phase fee-for-effect action
//    with no ship/board anchor, mirroring `exchangeFish`'s own "paid, effect anywhere" shape, NOT a
//    physical delivery (unlike `deliverFish`/`deliverSpice` below, which DO require a carrying ship).
//  - **Fish shoals auto-haul on arrival (EP8, ⚠ VERIFY — this task's own DECISION)**: rather than add
//    a fifth "haul" action, a ship's arrival at an edge bordering a `fishShoals` hex auto-loads one
//    `'fish'` cargo unit into its bay (if there's room — a full bay silently skips the haul, same
//    "arrival is a side effect of a legal move, not a validated request" discipline `revealOnArrival`
//    already established) — folded into `moveEPShipHandler` (ships.ts) right after the reveal step.
//    Shoals are NOT consumed by a haul in this v1 model (⚠ VERIFY) — a ship may re-haul the same shoal
//    by leaving and returning.
//  - **`tradeSpice` IS a dedicated, paid action (EP9, ⚠ VERIFY the cost/rate)**: unlike fish (free,
//    auto), spices cost `SPICE_TRADE_COST_GOLD` (1, ⚠ VERIFY) gold per cargo unit, paid at a village —
//    ties the gold economy to the spice mission, one documented rule.
//  - **The delivery VP is a flat per-delivery amount (EP8/EP9, ⚠ VERIFY — this task's own DECISION)**:
//    rather than a progressive multi-tier "fish/spice track" (no rulebook table on record for this
//    codebase to encode), `deliverFish`/`deliverSpice` each award a flat `FISH_VP_PER_DELIVERY`/
//    `SPICE_VP_PER_DELIVERY` (1 each, ⚠ VERIFY) — the simplest reading consistent with "named
//    constants + ⚠ VERIFY" that still lets a later task swap in a real ladder with a one-line change.
//  - **`spiceBenefit` is a per-delivery-incremented level capped for the ship-range bonus (EP9,
//    ⚠ VERIFY the ladder)**: every `deliverSpice` increments `spiceBenefit[seat]` by 1 (uncapped, an
//    open tally like `gold`); `spiceShipRangeBonus` reads it back capped at `SPICE_BENEFIT_MAX_BONUS`
//    (2, ⚠ VERIFY) extra sea-route hops, added to `SHIP_MOVE_RANGE` by `moveEPShipHandler` (ships.ts).
//  - **Seeding (`seedFishSpiceV0`, ⚠ VERIFY every count/placement)**: `fishShoals` are drawn from the
//    board's currently-fog (`'sea'`) hexes (a shoal is a sea feature, independent of exploration fog —
//    unlike a village, it needs no revealed land to sit on); `villages` are drawn from the board's
//    currently-REAL-terrain (non-`'sea'`, non-`'gold'`) hexes — i.e. the home island, already revealed
//    at init (`buildLandHoBoardV0`), resolving the "seed villages on revealed land" requirement without
//    waiting on any exploration reveal. `councilVertex` is a fixed vertex of the first such home-island
//    hex — the "home-island council delivery point" both missions ship cargo to.

import { GEOMETRY } from '@hexhaven/shared';
import type {
  Action,
  BoardGeometry,
  EdgeId,
  EngineErrorCode,
  EPCargo,
  GameEvent,
  GameState,
  HexId,
  ScenarioTerrain,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import {
  epFishDelivered,
  epFishHauled,
  epGoldCompensated,
  epGoldShipped,
  epSpiceDelivered,
  epSpiceTraded,
} from '../../events.js';
import { shuffle } from '../../rng.js';
import { geometryForState } from '../index.js';
import { epExt, epFishMissionActive, epSpiceMissionActive, isExplorersPiratesState, withEpExt } from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

// ---- Fixed constants (EP6/EP8/EP9, ⚠ VERIFY every number against the physical rulebook) ----------

/** EP6.1 ⚠ VERIFY: gold gained by a seat that produced no resources on a producing roll. */
export const GOLD_COMPENSATION = 1;

/** EP6.2 ⚠ VERIFY: gold cost of `shipGold`'s flat 1 VP. */
export const GOLD_PER_VP = 3;

/** EP9 ⚠ VERIFY: gold cost of `tradeSpice`'s one `'spice'` cargo unit. */
export const SPICE_TRADE_COST_GOLD = 1;

/** EP8 ⚠ VERIFY (this file's own v1 flat-amount DECISION — see header): VP awarded per `deliverFish`. */
export const FISH_VP_PER_DELIVERY = 1;

/** EP9 ⚠ VERIFY (mirrors `FISH_VP_PER_DELIVERY`): VP awarded per `deliverSpice`. */
export const SPICE_VP_PER_DELIVERY = 1;

/** EP9 ⚠ VERIFY: the cap on how many extra sea-route hops `spiceBenefit` can add to `SHIP_MOVE_RANGE`. */
export const SPICE_BENEFIT_MAX_BONUS = 2;

/** T-1106 ⚠ VERIFY (this file's own v1 seeding numbers — see header): how many fish shoals / villages
 *  `seedFishSpiceV0` seeds. */
export const FISH_SHOAL_COUNT = 3;
export const VILLAGE_COUNT = 2;

/** T-1150 (Phase 11B, ⚠ VERIFY — forward-looking plumbing for T-1152): scaled ~1.5-2x counts for a
 *  5–6 player game, sized against `buildLandHoBoard56`'s bigger frame (18 fog hexes / 19 home-island
 *  hexes, vs the 3–4 board's 12/7). NOT wired into `createGame` by this task — only `landHo` (which
 *  has no missions at all) ships at 5–6 today, so `seedFishSpiceV0` never actually runs for a 5–6 game
 *  yet; T-1152 (extending fishForHexhaven/spicesForHexhaven/pirateLairs/fullCampaign to 5–6) is expected to
 *  pass these via `seedFishSpiceV0`'s new optional `opts` below once it wires those scenarios' own
 *  5–6 board support. */
export const FISH_SHOAL_COUNT_56 = 5;
export const VILLAGE_COUNT_56 = 3;

// ---- Seeding (init helper — TESTS only, no `createGame` wiring yet, mirrors `seedExplorationV0`) --

/**
 * `seedFishSpiceV0(rng, built, opts?)` (T-1106 init helper — used by TESTS only, no `createGame`
 * wiring yet, mirroring T-1102/T-1103's own `ext.explorersPirates` discipline): see this file's header
 * for why shoals come from the fog (`'sea'`) hexes and villages/council from the already-revealed
 * home-island (non-`'sea'`, non-`'gold'`) hexes. Throws (a `BUG:` programmer error, mirroring
 * `seedExplorationV0`'s own guard) if the board doesn't have enough of either hex kind.
 *
 * T-1150 (Phase 11B): `opts` is a new, fully optional 3rd parameter — every existing call site is
 * untouched and gets the exact same defaults (base `GEOMETRY`, `FISH_SHOAL_COUNT`/`VILLAGE_COUNT`) as
 * before this task (RK-13). Lets a future 5–6 caller (T-1152) pass the resolved board geometry (so
 * `councilVertex` resolves against the RIGHT board) plus scaled counts (`FISH_SHOAL_COUNT_56`/
 * `VILLAGE_COUNT_56` above).
 */
export function seedFishSpiceV0(
  rng: GameState['rng'],
  built: { seaMap: readonly ScenarioTerrain[] },
  opts?: { geometry?: BoardGeometry; fishShoalCount?: number; villageCount?: number }
): {
  fishShoals: HexId[];
  villages: HexId[];
  councilVertex: VertexId;
  rng: GameState['rng'];
} {
  const geometry = opts?.geometry ?? GEOMETRY;
  const fishShoalCount = opts?.fishShoalCount ?? FISH_SHOAL_COUNT;
  const villageCount = opts?.villageCount ?? VILLAGE_COUNT;
  const seaHexIds: HexId[] = [];
  const landHexIds: HexId[] = [];
  built.seaMap.forEach((t, hex) => {
    if (t === 'sea') seaHexIds.push(hex as HexId);
    else if (t !== 'gold') landHexIds.push(hex as HexId);
  });

  if (seaHexIds.length < fishShoalCount) {
    throw new Error(
      `BUG: seedFishSpiceV0 expected at least ${fishShoalCount} fog (sea) hexes for fish shoals, found ${seaHexIds.length}`
    );
  }
  if (landHexIds.length < villageCount) {
    throw new Error(
      `BUG: seedFishSpiceV0 expected at least ${villageCount} revealed land hexes for villages, found ${landHexIds.length}`
    );
  }

  const shoalShuffle = shuffle(rng, seaHexIds);
  const fishShoals = shoalShuffle.array.slice(0, fishShoalCount);
  const villageShuffle = shuffle(shoalShuffle.state, landHexIds);
  const villages = villageShuffle.array.slice(0, villageCount);

  const councilHex = landHexIds[0]!;
  const councilVertex = geometry.hexes[councilHex]?.vertices[0];
  if (councilVertex === undefined) {
    throw new Error(`BUG: seedFishSpiceV0 found no vertex on council hex ${councilHex}`);
  }

  return { fishShoals, villages, councilVertex, rng: villageShuffle.state };
}

// ---- Gold compensation (EP6.1, module `phaseHooks.afterAction` on `rollDice`) ----------------------

/**
 * EP6.1 (see this file's header for the "fold gold fields into this rule" decision): on a producing
 * roll (`events` already contains a `production` event — the ONLY way to tell a non-7 roll from a 7
 * without re-deriving the total here), every seat absent from that event's `gains` gets
 * `GOLD_COMPENSATION` gold. Returns `null` outside a live E&P game, on a 7 (no `production` event to
 * find), or when every seat produced something.
 */
export function applyGoldCompensation(
  next: GameState,
  events: readonly GameEvent[]
): { state: GameState; events: GameEvent[] } | null {
  const ext = epExt(next);
  if (!ext) return null;

  const productionEvent = events.find(
    (e): e is Extract<GameEvent, { type: 'production' }> => e.type === 'production'
  );
  if (!productionEvent) return null; // a 7 (discard/robber) — no producing roll to compensate

  const producingSeats = new Set(productionEvent.gains.map((g) => g.seat));
  const gold = [...(ext.gold ?? next.players.map(() => 0))];
  const gains: { seat: Seat; amount: number }[] = [];
  for (const p of next.players) {
    if (!producingSeats.has(p.seat)) {
      gold[p.seat] = (gold[p.seat] ?? 0) + GOLD_COMPENSATION;
      gains.push({ seat: p.seat, amount: GOLD_COMPENSATION });
    }
  }
  if (gains.length === 0) return null;

  const withExt = withEpExt(next, { ...ext, gold });
  return { state: withExt, events: [...events, epGoldCompensated(gains)] };
}

// ---- shipGold (EP6.2) ------------------------------------------------------------------------------

// No `action` parameter: `shipGold`'s only field is its discriminant `type` (same "no payload"
// precedent as `buildEPCrew`/`buildEPSettler`).
export function shipGoldHandler(state: GameState, seat: Seat): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'gold requires a live Explorers & Pirates game (EP6.2)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'gold is shipped in the main phase (EP6.2)');

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in shipGoldHandler');
  const gold = [...(ext.gold ?? state.players.map(() => 0))];
  if ((gold[seat] ?? 0) < GOLD_PER_VP) {
    return fail('NOT_ENOUGH_GOLD', `seat ${seat} needs ${GOLD_PER_VP} gold to ship for 1 VP (EP6.2, ⚠ VERIFY)`);
  }
  gold[seat] = (gold[seat] ?? 0) - GOLD_PER_VP;
  const goldPoints = (ext.goldPoints ?? state.players.map(() => 0)).map((v, i) => (i === seat ? v + 1 : v));
  const next = withEpExt(state, { ...ext, gold, goldPoints });
  return { ok: true, state: next, events: [epGoldShipped(seat)] };
}

// ---- Fish auto-haul on arrival (EP8, called from ships.ts's moveEPShipHandler) ---------------------

/**
 * EP8 (see this file's header): if `edge` borders a `fishShoals` hex and the seat's ship there has
 * room in its cargo bay (`cargoCap`, passed in from ships.ts's `SHIP_CARGO_CAP` to avoid a circular
 * import), auto-loads one `'fish'` cargo unit. A no-op (`state` unchanged, `events: []`) outside a
 * live E&P game, when `edge` borders no shoal, when the seat has no ship there, or the bay is full.
 *
 * T-1110 (fish-auto-haul fidelity fix, FOLLOWUPS.md): also a no-op when the scenario's OWN fish
 * mission is off (`epFishMissionActive`) — belt-and-suspenders on top of createGame.ts only ever
 * seeding `fishShoals` for a fish-mission scenario in the first place (`ext.fishShoals` should
 * already read `[]` for e.g. Spices for Hexhaven, making `shoals.length === 0` below catch it too), but
 * this handler no longer TRUSTS that invariant implicitly — any future/hand-crafted state carrying a
 * stray `fishShoals` list still can't auto-haul fish in a scenario that never turned the mission on.
 */
export function haulFishOnArrival(
  state: GameState,
  seat: Seat,
  edge: EdgeId,
  cargoCap: number
): { state: GameState; events: GameEvent[] } {
  const ext = epExt(state);
  if (!ext) return { state, events: [] };
  if (!epFishMissionActive(state)) return { state, events: [] };
  const shoals = ext.fishShoals ?? [];
  if (shoals.length === 0) return { state, events: [] };

  const geomEdge = geometryForState(state).edges[edge];
  const shoalHex = geomEdge?.hexes.find((h) => shoals.includes(h));
  if (shoalHex === undefined) return { state, events: [] };

  const ships = ext.ships ?? [];
  const shipIdx = ships.findIndex((s) => s.seat === seat && s.edge === edge);
  if (shipIdx < 0) return { state, events: [] };
  const ship = ships[shipIdx]!;
  if (ship.cargo.length >= cargoCap) return { state, events: [] }; // bay full — no haul (v1, ⚠ VERIFY)

  const nextShips = ships.map((s, i) =>
    i === shipIdx ? { ...s, cargo: [...s.cargo, 'fish' as EPCargo] } : s
  );
  const next = withEpExt(state, { ...ext, ships: nextShips });
  return { state: next, events: [epFishHauled(seat, shoalHex)] };
}

// ---- tradeSpice (EP9) ------------------------------------------------------------------------------

export function tradeSpiceHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'tradeSpice' }>,
  cargoCap: number
): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'spice trading requires a live Explorers & Pirates game (EP9)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'spice is traded in the main phase (EP9)');

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in tradeSpiceHandler');
  const villages = ext.villages ?? [];
  if (!villages.includes(action.hex)) {
    return fail('VILLAGE_NOT_FOUND', `hex ${action.hex} has no active village (EP9)`);
  }

  const geometry = geometryForState(state);
  const ships = ext.ships ?? [];
  const shipIdx = ships.findIndex((s) => {
    if (s.seat !== seat) return false;
    const edge = geometry.edges[s.edge];
    return !!edge && edge.hexes.includes(action.hex);
  });
  if (shipIdx < 0) {
    return fail('NOT_CONNECTED', `no ship of seat ${seat} is adjacent to village hex ${action.hex} (EP9)`);
  }
  const ship = ships[shipIdx]!;
  if (ship.cargo.length >= cargoCap) {
    return fail('CARGO_FULL', `the ship at hex ${action.hex} already carries ${cargoCap} cargo piece(s) (EP9)`);
  }

  const gold = [...(ext.gold ?? state.players.map(() => 0))];
  if ((gold[seat] ?? 0) < SPICE_TRADE_COST_GOLD) {
    return fail(
      'NOT_ENOUGH_GOLD',
      `seat ${seat} needs ${SPICE_TRADE_COST_GOLD} gold to trade for spice (EP9, ⚠ VERIFY)`
    );
  }
  gold[seat] = (gold[seat] ?? 0) - SPICE_TRADE_COST_GOLD;

  const nextShips = ships.map((s, i) =>
    i === shipIdx ? { ...s, cargo: [...s.cargo, 'spice' as EPCargo] } : s
  );
  const next = withEpExt(state, { ...ext, ships: nextShips, gold });
  return { ok: true, state: next, events: [epSpiceTraded(seat, action.hex)] };
}

// ---- deliverFish / deliverSpice (EP8/EP9) -----------------------------------------------------------

// No `action` parameter for either: same "no payload" precedent as `buildEPCrew` — the delivery
// target (`councilVertex`) is fixed board state, not a submitted field.
export function deliverFishHandler(state: GameState, seat: Seat): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'fish delivery requires a live Explorers & Pirates game (EP8)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'fish is delivered in the main phase (EP8)');
  // T-1110: fish can only ever be delivered in a scenario whose fish mission is actually ON (mirrors
  // `haulFishOnArrival`'s own gate above) — closes the cross-mission leak where e.g. Spices for Hexhaven
  // (spice on, fish off) could otherwise still deliver a stray fish cargo unit for VP.
  if (!epFishMissionActive(state)) {
    return fail('FISH_NOT_FOUND', 'this scenario has no fish mission (EP8)');
  }

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in deliverFishHandler');
  const council = ext.councilVertex;
  if (council === undefined) return fail('FISH_NOT_FOUND', 'no council vertex seeded (EP8)');
  const vert = geometryForState(state).vertices[council];
  if (!vert) return fail('FISH_NOT_FOUND', `council vertex ${council} is off the board (EP8)`);

  const ships = ext.ships ?? [];
  const shipIdx = ships.findIndex(
    (s) => s.seat === seat && s.cargo.includes('fish') && vert.edges.includes(s.edge)
  );
  if (shipIdx < 0) {
    return fail('FISH_NOT_FOUND', `no ship carrying fish is adjacent to the council (EP8)`);
  }

  const ship = ships[shipIdx]!;
  const cargoIdx = ship.cargo.indexOf('fish');
  const nextCargo = [...ship.cargo];
  nextCargo.splice(cargoIdx, 1);
  const nextShips = ships.map((s, i) => (i === shipIdx ? { ...s, cargo: nextCargo } : s));

  const fishPoints = (ext.fishPoints ?? state.players.map(() => 0)).map((v, i) =>
    i === seat ? v + FISH_VP_PER_DELIVERY : v
  );
  const next = withEpExt(state, { ...ext, ships: nextShips, fishPoints });
  return { ok: true, state: next, events: [epFishDelivered(seat, FISH_VP_PER_DELIVERY)] };
}

export function deliverSpiceHandler(state: GameState, seat: Seat): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'spice delivery requires a live Explorers & Pirates game (EP9)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'spice is delivered in the main phase (EP9)');
  // T-1110: spice can only ever be delivered in a scenario whose spice mission is actually ON (mirrors
  // `deliverFishHandler`'s own gate above) — closes the mirror-image cross-mission leak where e.g.
  // Fish for Hexhaven (fish on, spice off) could otherwise still deliver a stray spice cargo unit for VP.
  if (!epSpiceMissionActive(state)) {
    return fail('SPICE_NOT_FOUND', 'this scenario has no spice mission (EP9)');
  }

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in deliverSpiceHandler');
  const council = ext.councilVertex;
  if (council === undefined) return fail('SPICE_NOT_FOUND', 'no council vertex seeded (EP9)');
  const vert = geometryForState(state).vertices[council];
  if (!vert) return fail('SPICE_NOT_FOUND', `council vertex ${council} is off the board (EP9)`);

  const ships = ext.ships ?? [];
  const shipIdx = ships.findIndex(
    (s) => s.seat === seat && s.cargo.includes('spice') && vert.edges.includes(s.edge)
  );
  if (shipIdx < 0) {
    return fail('SPICE_NOT_FOUND', `no ship carrying spice is adjacent to the council (EP9)`);
  }

  const ship = ships[shipIdx]!;
  const cargoIdx = ship.cargo.indexOf('spice');
  const nextCargo = [...ship.cargo];
  nextCargo.splice(cargoIdx, 1);
  const nextShips = ships.map((s, i) => (i === shipIdx ? { ...s, cargo: nextCargo } : s));

  const spicePoints = (ext.spicePoints ?? state.players.map(() => 0)).map((v, i) =>
    i === seat ? v + SPICE_VP_PER_DELIVERY : v
  );
  const spiceBenefit = (ext.spiceBenefit ?? state.players.map(() => 0)).map((v, i) =>
    i === seat ? v + 1 : v
  );
  const next = withEpExt(state, { ...ext, ships: nextShips, spicePoints, spiceBenefit });
  return {
    ok: true,
    state: next,
    events: [epSpiceDelivered(seat, SPICE_VP_PER_DELIVERY, spiceBenefit[seat]!)],
  };
}

// ---- Ship-range wiring (EP9, consumed by ships.ts's moveEPShipHandler) -----------------------------

/** `seat`'s extra sea-route hops from its `spiceBenefit` level, capped at `SPICE_BENEFIT_MAX_BONUS` —
 *  0 outside a live E&P game / before any spice delivery. */
export function spiceShipRangeBonus(state: GameState, seat: Seat): number {
  const level = epExt(state)?.spiceBenefit?.[seat] ?? 0;
  return Math.min(level, SPICE_BENEFIT_MAX_BONUS);
}

// ---- VP (EP6.2/EP8/EP9, consumed by vp.ts's computeVp) ---------------------------------------------

/** `seat`'s VP from `shipGold` (EP6.2) — 0 outside a live E&P game. */
export function goldPointsVpFor(state: GameState, seat: Seat): number {
  return epExt(state)?.goldPoints?.[seat] ?? 0;
}

/** `seat`'s VP from `deliverFish` (EP8) — 0 outside a live E&P game. */
export function fishPointsVpFor(state: GameState, seat: Seat): number {
  return epExt(state)?.fishPoints?.[seat] ?? 0;
}

/** `seat`'s VP from `deliverSpice` (EP9) — 0 outside a live E&P game. */
export function spicePointsVpFor(state: GameState, seat: Seat): number {
  return epExt(state)?.spicePoints?.[seat] ?? 0;
}
