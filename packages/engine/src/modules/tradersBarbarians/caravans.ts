// The Caravans of Hexhaven (T-1004, docs/rules/traders-barbarians-rules.md §TB4). The desert becomes
// an Oasis hex (no number token) three caravan routes radiate from (§TB4.1); building/upgrading a
// settlement opens a camel-placement VOTE — every seat bids grain/wool paid to the bank, highest
// bid places one camel on an empty route edge (§TB4.2); a settlement/city sitting between two
// camel-carrying edges scores +1 VP, and a camel-carrying road counts double for Longest Road
// (§TB4.3); the game is played to 12 VP (§TB4.4, TB1.3 override).
//
// Mirrors fishermen.ts/rivers.ts's shape: a scenario init for `createGame`, a `phaseHooks.afterAction`
// hook that opens the vote sub-phase after a qualifying build, and a dedicated PHASE HANDLER (the
// module's `phaseHandlers`, mirroring the fiveSix module's `specialBuild` / seafarers'
// `chooseGoldResource`) for the new `caravanVote` phase itself — the ONE new wrinkle earlier T&B
// scenarios didn't need, since Fishermen/Rivers only ever added base-phase actions via
// `interceptAction`, never a whole new blocking sub-phase.
//
// No board mutation beyond the per-game Oasis/route computation (§TB1.2/T-1004's decided data
// model): unlike Rivers' river edges (a load-time geometry CONSTANT, independent of board terrain),
// the Oasis is wherever THIS board's desert landed — so `oasisHex`/`routeEdges` are seeded once per
// game in `initialCaravansExt`, exactly like fishermen's `lakeHex`.
//
// T-1053 (5–6, Phase 10B): `computeCaravanRouteEdges` and `caravansVpFor` below are now parameterized
// on the RESOLVED `BoardGeometry` (base 19-hex, or the 30-hex `GEOMETRY_EXT56` for a fiveSix game)
// instead of always the module-load base `GEOMETRY` — mirrors T-1050/T-1051/T-1052's fishing-grounds/
// river-edge/barbarian-ring rework. `initialCaravansExt` takes `geometry` as a new parameter
// (threaded from `createGame` via `geometryForConfig(config)`); for a 3–4p game that resolves to the
// exact same `GEOMETRY` object reference, so `computeCaravanRouteEdges(GEOMETRY, oasisHex)` produces
// byte-identical output to before this task (RK-13) — no explicit reference-equality short-circuit is
// needed here (unlike rivers'/barbarianAttack's PRECOMPUTED base module constants) because
// `routeEdges` was already a per-game `createGame`-time computation, never a module-load constant, so
// simply threading the resolved geometry through preserves identical behavior at 3–4p. `caravansVpFor`
// (a live per-call read, not seeded once) uses `geometryForState` instead, mirroring
// `barbarianAttack.ts`'s knight recruit-edge/move-range lookups.

import type {
  Action,
  BoardGeometry,
  EdgeId,
  EngineErrorCode,
  GameEvent,
  GameState,
  HexId,
  Seat,
} from '@hexhaven/shared';
import type { EngineResult, PhaseHandler } from '../../reduce.js';
import { camelPlaced, caravanVoteCast, caravanVoteOpened, caravanVoteResolved } from '../../events.js';
import { updateAwards } from '../../rules/awards.js';
import { geometryForState } from '../index.js';
import { camelsOf, isCaravansState, routeEdgesOf, tbExt, withTbExt } from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

// ---- Fixed data (§TB4.1/§TB4.4, ⚠ VERIFY against the physical rulebook) --------------------------

/** §TB4.4: Caravans overrides the base 10-VP target (TB1.3) — unchanged at 5–6 (T-1053 ⚠ VERIFY:
 *  the rulebook gives no separate 5–6 target for this scenario either way, so the same 12 applies at
 *  every supported player count, mirroring how Seafarers' per-scenario targets don't vary by seat
 *  count). */
export const CARAVANS_TARGET_VP = 12;

/** §TB4.1: the physical camel-piece supply — a fixed physical-component count, not a per-seat one, so
 *  it stays 22 at 5–6 too (T-1053 ⚠ VERIFY: no larger box-set piece count is documented; the 30-hex
 *  EXT56 board's Oasis still only ever grows 3 routes / up to 6 route edges via
 *  `computeCaravanRouteEdges`, so this supply was never the binding constraint at 3–4p and stays that
 *  way at 5–6 — confirmed by the sim, sim/tradersBarbariansCaravans56.test.ts). Once every seat's
 *  camels sum to this, the vote is skipped entirely rather than opened with no legal placement (see
 *  `maybeOpenCaravanVote`). */
export const CARAVANS_CAMEL_SUPPLY = 22;

/**
 * ⚠ VERIFY exact route positions against the diagram — an approximate-but-CONNECTED set of route
 * edges is an explicitly-allowed v1 simplification (docs/rules/traders-barbarians-rules.md,
 * mirroring T-1002/T-1003's fishing-grounds/river-edge precedent). Three routes "radiate from the
 * Oasis" (§TB4.1): each starts at one of three alternating edges of the Oasis hex itself, then
 * extends one edge further outward (away from the Oasis, never back around its own boundary) from
 * whichever endpoint offers an unused edge — giving three 2-edge, 3-vertex paths, six edges total.
 * Pure function of `geometry` + the Oasis hex (never random), so no `rng` draw is needed at
 * `createGame` — same discipline as `initialFishermenExt`'s fishing grounds. Takes `geometry` as a
 * parameter (T-1053, 5–6) rather than always reading the base `GEOMETRY` — a fiveSix game passes
 * `GEOMETRY_EXT56` instead, so the routes radiate correctly over the 30-hex board too.
 */
function computeCaravanRouteEdges(geometry: BoardGeometry, oasisHex: HexId): EdgeId[] {
  const hex = geometry.hexes[oasisHex];
  if (!hex) throw new Error(`BUG: caravans oasis hex ${oasisHex} missing from geometry`);
  const hexEdgeSet = new Set(hex.edges);
  const routes: EdgeId[] = [];

  for (let i = 0; i < hex.edges.length; i += 2) {
    const seedEdge = hex.edges[i];
    if (seedEdge === undefined) continue;
    routes.push(seedEdge);
    const edge = geometry.edges[seedEdge];
    if (!edge) throw new Error(`BUG: caravans route seed edge ${seedEdge} missing from geometry`);

    // Extend one edge further OUTWARD from whichever endpoint offers an edge that isn't part of the
    // Oasis hex's own boundary and isn't already claimed by another route.
    let extended: EdgeId | undefined;
    for (const v of [edge.a, edge.b]) {
      const vert = geometry.vertices[v];
      if (!vert) continue;
      extended = vert.edges.find((e) => !hexEdgeSet.has(e) && !routes.includes(e));
      if (extended !== undefined) break;
    }
    if (extended !== undefined) routes.push(extended);
  }
  return routes;
}

// ---- Init (createGame) -----------------------------------------------------------------------

/**
 * Seed `ext.tradersBarbarians` for a caravans game (createGame, gated on `isCaravansConfig`).
 * `board` is the already-generated board — the Oasis is its desert hex (R2: the desert always
 * exists, exactly one, and never carries a token), exactly like fishermen's Lake. `geometry` is the
 * config's RESOLVED geometry (`geometryForConfig(config)` at the call site, T-1053) — the base 19-hex
 * board for a 3–4p game, or `GEOMETRY_EXT56` for a fiveSix one — so a 5–6 caravans game gets its own
 * route edges computed against the board actually in play. No `rng` draw needed (the routes are a
 * pure function of the Oasis hex + `geometry`).
 */
export function initialCaravansExt(
  board: GameState['board'],
  geometry: BoardGeometry
): NonNullable<NonNullable<GameState['ext']>['tradersBarbarians']> {
  const oasisIndex = board.hexes.findIndex((h) => h.terrain === 'desert');
  if (oasisIndex < 0) {
    throw new Error('BUG: caravans init found no desert hex on the board to seed as the Oasis (§TB4.1)');
  }
  const oasisHex = oasisIndex as HexId;
  return {
    scenario: 'caravans',
    oasisHex,
    routeEdges: computeCaravanRouteEdges(geometry, oasisHex),
    camels: [],
  };
}

// ---- Camel placement targets / VP (§TB4.1/§TB4.3) ----------------------------------------------

/** Every empty caravan-route edge right now — `[]` outside a caravans game or once every route
 *  edge already carries a camel. */
export function legalCamelEdges(state: GameState): EdgeId[] {
  if (!isCaravansState(state)) return [];
  const camels = camelsOf(state);
  return routeEdgesOf(state).filter((e) => !camels.includes(e));
}

/**
 * §TB4.3: +1 VP for each of `seat`'s settlements/cities that sits "between two camels" — a vertex
 * touching (at least) two DISTINCT camel-carrying route edges. Camels only ever sit on route edges
 * (`placeCamel`'s own validation), so "between two camels" and "between two camel-carrying route
 * edges" coincide — no separate per-route grouping is needed. 0 outside a caravans game. Reads
 * `geometryForState(state)` (T-1053, 5–6) rather than always the base `GEOMETRY` — works the same
 * whether `state` is the engine's own full `GameState` or a client's redacted `PlayerView` cast to
 * one (`config` rides through redaction unchanged either way, mirrors `barbarianAttack.ts`'s
 * `legalKnightRecruitEdges`).
 */
export function caravansVpFor(state: GameState, seat: Seat): number {
  if (!isCaravansState(state)) return 0;
  const camels = camelsOf(state);
  if (camels.length < 2) return 0;
  const camelSet = new Set(camels);
  const player = state.players[seat];
  if (!player) return 0;

  const geometry = geometryForState(state);
  let vp = 0;
  for (const v of [...player.settlements, ...player.cities]) {
    const vert = geometry.vertices[v];
    if (!vert) continue;
    const camelEdgesHere = vert.edges.filter((e) => camelSet.has(e));
    if (camelEdgesHere.length >= 2) vp += 1;
  }
  return vp;
}

// ---- Vote sub-phase open (module `phaseHooks.afterAction`) -------------------------------------

/**
 * §TB4.2: after a `buildSettlement`/`buildCity` lands back in `main`, open the camel-placement vote
 * — `pending` is every seat, builder first. Skipped entirely (no vote opened) once the camel supply
 * is exhausted OR every route edge already carries a camel (whichever binds first for this game's
 * small, approximate route set) — opening a vote with no legal placement would strand its winner.
 * `null` outside a caravans game / for every other action (the module's `afterAction` hook forwards
 * `null` to fall through to its other checks, docs/10 §3).
 *
 * MAIN-PHASE ONLY (T-1056 audit decision): deliberately does NOT open a vote when the qualifying
 * build happened during the fiveSix 2015 SBP sub-phase (`phase.kind === 'specialBuild'`). Opening a
 * full multi-seat vote mid-SBP and then correctly resuming the SBP at the exact interrupted builder
 * proved too error-prone (an early attempt broke the FS-SBP1 entry-order invariant) for what is a
 * DISABLED edge case — `SBP_ENABLED = false` in the client picker (apps/client OptionsPanel), so no
 * real game ever reaches the SBP; only the 5–6 sim exercises it under the `sbp` rule. The accepted
 * gap (a missed camel opportunity from an SBP build) is logged in docs/tasks/FOLLOWUPS.md. This
 * differs from T-1054's `applyWagonPlacement` accepting `'specialBuild'` — placing a wagon is a
 * simple additive no-phase-change hook, whereas a caravan vote opens a whole blocking sub-phase.
 */
export function maybeOpenCaravanVote(
  next: GameState,
  action: Action,
  events: readonly GameEvent[],
  actingSeat: Seat
): { state: GameState; events: GameEvent[] } | null {
  if (!isCaravansState(next)) return null;
  if (action.type !== 'buildSettlement' && action.type !== 'buildCity') return null;
  if (next.phase.kind !== 'main') return null;
  if (camelsOf(next).length >= CARAVANS_CAMEL_SUPPLY) return null;
  if (legalCamelEdges(next).length === 0) return null;

  const pending: Seat[] = [
    actingSeat,
    ...next.players.map((p) => p.seat).filter((s) => s !== actingSeat),
  ];
  const phase = { kind: 'caravanVote' as const, builder: actingSeat, pending, bids: {}, winner: null };
  return { state: { ...next, phase }, events: [...events, caravanVoteOpened(actingSeat, pending)] };
}

// ---- The caravanVote phase handler (§TB4.2) -----------------------------------------------------

/**
 * `caravanVote`/`placeCamel` (§TB4.2): every pending seat bids `grain + wool` cards, paid to the
 * bank immediately regardless of outcome (`{0,0}` abstains). Once every seat has bid, the sole
 * highest bidder is the winner; a tie (⚠ VERIFY the exact rule against the physical rulebook —
 * provisional per the task's decided data model) awards the BUILDER; an all-abstain vote (every bid
 * 0) places no camel and returns straight to `main`. Otherwise the phase holds at `pending: []` until
 * the winner submits `placeCamel`, which places the camel, recomputes Longest Road (a camel-carrying
 * road counts double, §TB4.3, `rules/longestRoad.ts`), and returns to `main`.
 */
export const caravanVoteHandler: PhaseHandler = (state, seat, action): EngineResult => {
  if (state.phase.kind !== 'caravanVote') return fail('WRONG_PHASE', 'not in the caravanVote phase (§TB4.2)');
  const phase = state.phase;

  if (action.type === 'caravanVote') {
    if (!phase.pending.includes(seat)) {
      return fail('NOT_YOUR_TURN', `seat ${seat} does not owe a caravan vote right now (§TB4.2)`);
    }
    const { grain, wool } = action;
    if (grain < 0 || wool < 0) {
      return fail('BAD_TRADE', 'a caravan bid cannot be negative (§TB4.2)');
    }
    const player = state.players[seat];
    if (!player) throw new Error(`BUG: caravanVote from unknown seat ${seat}`);
    if (player.resources.grain < grain || player.resources.wool < wool) {
      return fail(
        'CANT_AFFORD',
        `seat ${seat} cannot afford a ${grain}-grain/${wool}-wool caravan bid (§TB4.2)`
      );
    }

    const bank = { ...state.bank, grain: state.bank.grain + grain, wool: state.bank.wool + wool };
    const players = state.players.map((p) =>
      p.seat === seat
        ? {
            ...p,
            resources: { ...p.resources, grain: p.resources.grain - grain, wool: p.resources.wool - wool },
          }
        : p
    );
    const bid = grain + wool;
    const bids = { ...phase.bids, [seat]: bid };
    const pending = phase.pending.filter((s) => s !== seat);
    const events: GameEvent[] = [caravanVoteCast(seat, bid)];

    if (pending.length > 0) {
      return { ok: true, state: { ...state, players, bank, phase: { ...phase, pending, bids } }, events };
    }

    // Every seat has bid — resolve.
    const maxBid = Math.max(0, ...Object.values(bids));
    if (maxBid === 0) {
      return {
        ok: true,
        state: { ...state, players, bank, phase: { kind: 'main' } },
        events: [...events, caravanVoteResolved(null)],
      };
    }
    const leaders = state.players.map((p) => p.seat).filter((s) => (bids[s] ?? 0) === maxBid);
    const winner = leaders.length === 1 ? leaders[0]! : phase.builder;
    return {
      ok: true,
      state: { ...state, players, bank, phase: { ...phase, pending, bids, winner } },
      events: [...events, caravanVoteResolved(winner)],
    };
  }

  if (action.type === 'placeCamel') {
    if (phase.pending.length > 0 || phase.winner !== seat) {
      return fail('NOT_YOUR_TURN', `seat ${seat} may not place a camel right now (§TB4.2)`);
    }
    const edge = action.edge;
    const ext = tbExt(state);
    if (!ext) throw new Error('BUG: caravans ext missing in placeCamel');
    if (!(ext.routeEdges ?? []).includes(edge)) {
      return fail('BAD_LOCATION', `edge ${edge} is not a caravan-route edge (§TB4.1)`);
    }
    if ((ext.camels ?? []).includes(edge)) {
      return fail('OCCUPIED', `edge ${edge} already carries a camel`);
    }

    const camels = [...(ext.camels ?? []), edge];
    const withCamel = withTbExt({ ...state, phase: { kind: 'main' } }, { ...ext, camels });
    const awarded = updateAwards(withCamel); // §TB4.3: a camel-carrying road counts double for Longest Road.
    return { ok: true, state: awarded.state, events: [camelPlaced(seat, edge), ...awarded.events] };
  }

  return fail('WRONG_PHASE', `action ${action.type} is not legal during the caravan vote (§TB4.2)`);
};
