// Explorers & Pirates — crews & the Pirate Lairs mission (T-1105, docs/rules/
// explorers-pirates-rules.md §EP7/§EP10/§EP12). Builds on T-1102's ship/cargo engine (ships.ts,
// extended by this task to draw/return `'crew'` cargo from `crewSupply`, mirroring T-1104's own
// settler-reserve extension) and T-1103's exploration/fog reveal (exploration.ts, extended by this
// task so a revealed `'pirate'` tile creates an active lair instead of being inert — see that
// file's own T-1105 update). The FIRST of E&P's three missions (EP7-EP9); fish/spice (T-1106) and
// active pirate-ship combat (EP10) are explicitly out of this task's scope.
//
// v1 model (provisional — every constant a ⚠ VERIFY placeholder, same discipline as ships.ts/
// exploration.ts/settling.ts's own headers):
//  - `EP_CREW_COST` (1 ore + 1 wool, EP7.1) is this task's own decided-v1 number.
//  - **A crew is built at a harbor settlement** (EP7.1: "placed in a harbor settlement's basin") —
//    unlike ships/settlers (T-1102/T-1104's "any coastal building" substitute, adopted only because
//    harbor settlements didn't exist yet at T-1102), `buildEPCrew` requires the seat to already own
//    AT LEAST one harbor settlement (`harborSettlementsOf`, settling.ts) — ⚠ VERIFY this is the
//    intended anchor now that harbor settlements are real (T-1104 shipped). A built crew sits in
//    `crewSupply[seat]` (mirrors `settlerSupply` exactly) until `loadCargo{piece:'crew'}` (ships.ts)
//    draws one unit onto a ship's cargo bay.
//  - **Pirate lairs come from exploration, not scenario setup** (this task's own decided "one
//    documented place", ⚠ VERIFY): `revealOnArrival` (exploration.ts) now treats a `'pirate'` tile
//    outcome as "a gold field WITH a lair" — it writes `seaMap[hex] = 'gold'` (same as a plain
//    `'gold'` reveal) AND appends a fresh `{ hex, crews: [] }` to `ext.explorersPirates.pirateLairs`.
//    `seedExplorationV0` (T-1103) is untouched — a lair is a reveal-time side effect, not a setup
//    step.
//  - **Landing a crew** (EP7.2): a ship of the acting seat carrying a `'crew'` cargo unit whose edge
//    borders the lair's hex (mirrors `isSeaEdge`'s own edge/hex adjacency check, ships.ts) lands ONE
//    crew — the cargo unit is consumed (never returned to `crewSupply`; the crew piece is now on the
//    board, same "this handler IS its own unload" discipline as `foundSettlement`, settling.ts) and
//    `seat` is appended to that lair's `crews` array. Multiple crews from the SAME seat on the SAME
//    lair are allowed (EP7.2: "3 crews total, any players").
//  - **Capture + the VP split — this task's own DECISION (⚠ VERIFY against the physical rulebook)**:
//    the moment a lair's `crews` reaches `LAIR_CAPTURE_CREWS` (3), it is captured — removed from the
//    active `pirateLairs` list (⚠ VERIFY: a captured lair cannot be landed on again, there is no
//    "captured lairs" list kept) — and its VP is split PROPORTIONALLY: each contributing seat scores
//    `LAIR_CREW_VP` (1) VP per crew IT personally contributed to that lair (so a seat that placed 2
//    of the 3 crews scores 2, the seat that placed the 3rd scores 1 — `LAIR_CAPTURE_CREWS` VP total
//    is always awarded, split across 1-3 distinct seats). The alternative reading — a flat award to
//    whichever seat happens to land the deciding 3rd crew — was rejected here because "the capturing
//    CONTRIBUTOR(S) score VP" (§EP7.2) reads as plural/proportional, not winner-take-all; a
//    proportional split is also the simpler, branch-free bookkeeping (accumulate once per landed
//    crew's seat, no need to single out "the last one").

import type { Action, EngineErrorCode, GameEvent, GameState, ResourceBundle, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { epCrewBuilt, epCrewPlacedOnLair, epLairCaptured } from '../../events.js';
import { canAfford, payToBank } from '../../rules/afford.js';
import { geometryForState } from '../index.js';
import { epExt, harborSettlementsOf, isExplorersPiratesState, withEpExt } from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

// ---- Fixed constants (EP7, ⚠ VERIFY every number against the physical rulebook) ------------------

/** EP7.1 ⚠ VERIFY: a crew costs 1 ore + 1 wool (paid to the bank). */
export const EP_CREW_COST: ResourceBundle = { ore: 1, wool: 1 };

/** EP7.2: a lair is captured once it holds this many landed crews (any seats, any mix). */
export const LAIR_CAPTURE_CREWS = 3;

/** EP7.2 ⚠ VERIFY (this file's own v1 DECISION — see header): VP awarded per crew a contributing
 *  seat landed on a captured lair. `LAIR_CAPTURE_CREWS` total VP is always split this way. */
export const LAIR_CREW_VP = 1;

// ---- buildEPCrew (EP7.1) ---------------------------------------------------------------------------

// No `action` parameter: `buildEPCrew`'s only field is its discriminant `type` (same "no payload"
// precedent as `buildEPSettler`, settling.ts).
export function buildEPCrewHandler(state: GameState, seat: Seat): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'crews require a live Explorers & Pirates game (EP7.1)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'crews are built in the main phase (EP7.1)');

  if (harborSettlementsOf(state, seat).length === 0) {
    return fail('NOT_CONNECTED', 'a crew is built at one of your own harbor settlements (EP7.1, ⚠ VERIFY)');
  }

  const player = state.players[seat];
  if (!player) throw new Error(`BUG: buildEPCrew for unknown seat ${seat}`);
  if (!canAfford(player, EP_CREW_COST)) {
    return fail('CANT_AFFORD', 'an E&P crew costs 1 ore + 1 wool (EP7.1, ⚠ VERIFY)');
  }

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in buildEPCrewHandler');
  const { players, bank } = payToBank(state, seat, EP_CREW_COST);
  const crewSupply = (ext.crewSupply ?? state.players.map(() => 0)).map((n, i) => (i === seat ? n + 1 : n));
  const next = withEpExt({ ...state, players, bank }, { ...ext, crewSupply });
  return { ok: true, state: next, events: [epCrewBuilt(seat)] };
}

// ---- placeCrewOnLair (EP7.2) ------------------------------------------------------------------------

export function placeCrewOnLairHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'placeCrewOnLair' }>
): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'pirate lairs require a live Explorers & Pirates game (EP7.2)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'crews land in the main phase (EP7.2)');

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in placeCrewOnLairHandler');
  const lairs = ext.pirateLairs ?? [];
  const lairIdx = lairs.findIndex((l) => l.hex === action.hex);
  if (lairIdx < 0) return fail('LAIR_NOT_FOUND', `hex ${action.hex} has no active pirate lair (EP7.2)`);

  const geometry = geometryForState(state);
  const ships = ext.ships ?? [];
  const shipIdx = ships.findIndex((s) => {
    if (s.seat !== seat || !s.cargo.includes('crew')) return false;
    const edge = geometry.edges[s.edge];
    return !!edge && edge.hexes.includes(action.hex);
  });
  if (shipIdx < 0) {
    return fail('CREW_NOT_FOUND', `no ship carrying a crew is adjacent to hex ${action.hex} (EP7.2)`);
  }

  const ship = ships[shipIdx]!;
  const cargoIdx = ship.cargo.indexOf('crew');
  const nextCargo = [...ship.cargo];
  nextCargo.splice(cargoIdx, 1);
  const nextShips = ships.map((s, i) => (i === shipIdx ? { ...s, cargo: nextCargo } : s));

  const lair = lairs[lairIdx]!;
  const nextCrews = [...lair.crews, seat];
  const events: GameEvent[] = [epCrewPlacedOnLair(seat, action.hex)];

  if (nextCrews.length < LAIR_CAPTURE_CREWS) {
    const nextLairs = lairs.map((l, i) => (i === lairIdx ? { ...l, crews: nextCrews } : l));
    const next = withEpExt(state, { ...ext, ships: nextShips, pirateLairs: nextLairs });
    return { ok: true, state: next, events };
  }

  // EP7.2 capture (this file's own v1 VP-split DECISION — see header): `LAIR_CREW_VP` per crew a
  // contributing seat landed on THIS lair; the lair is removed from the active list.
  const counts = new Map<Seat, number>();
  for (const s of nextCrews) counts.set(s, (counts.get(s) ?? 0) + 1);
  const awards = [...counts.entries()].map(([s, count]) => ({ seat: s, vp: count * LAIR_CREW_VP }));

  const lairPoints = (ext.lairPoints ?? state.players.map(() => 0)).map((v, i) => {
    const award = awards.find((a) => a.seat === i);
    return award ? v + award.vp : v;
  });
  const nextLairs = lairs.filter((_, i) => i !== lairIdx);
  const next = withEpExt(state, { ...ext, ships: nextShips, pirateLairs: nextLairs, lairPoints });
  events.push(epLairCaptured(action.hex, awards));
  return { ok: true, state: next, events };
}

// ---- VP (EP7.2, consumed by vp.ts's computeVp) -----------------------------------------------------

/** `seat`'s lair-capture VP (0 outside a live E&P game / before any lair is captured). */
export function lairPointsVpFor(state: GameState, seat: Seat): number {
  return epExt(state)?.lairPoints?.[seat] ?? 0;
}
