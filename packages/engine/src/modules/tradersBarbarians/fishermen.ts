// The Fishermen of Hexhaven (T-1002, docs/rules/traders-barbarians-rules.md §TB2). Fish production off
// the Lake + fishing grounds (§TB2.1/§TB2.2), the five `exchangeFish` benefits (§TB2.4), and the Old
// Boot catch-up mechanic (§TB2.5) — the FIRST T&B scenario, establishing the scenario-init +
// production-hook + exchange-action patterns later scenarios (T-1003…T-1006) reuse. Mirrors
// modules/seafarers/gold.ts's shape: a production hook wired through the module's `phaseHooks`
// (index.ts), plus handler functions the module's `interceptAction` routes new actions to.
//
// No new board layout: T&B plays on the base 3–4p island (§TB1.2) — the Lake is simply the board's
// existing desert hex (already numberless, already where the robber starts, R2) repurposed; the
// fishing grounds are virtual water tiles described purely as (number token, coastal vertices fed),
// never added to `board.hexes` — so base geometry/board-gen code needs no fishermen-awareness at all.

import { GEOMETRY } from '@hexhaven/shared';
import type {
  Action,
  BoardGeometry,
  EdgeId,
  EngineErrorCode,
  FishBenefit,
  GameEvent,
  GameState,
  ResourceType,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { built, devBought, fishExchanged, fishProduced, oldBootAwarded, oldBootPassed, robberMoved } from '../../events.js';
import { updateAwards } from '../../rules/awards.js';
import { canPlaceRoad } from '../../rules/connectivity.js';
import { geometryForState } from '../index.js';
import { resolveSteal, stealCandidatesForHex } from '../../phases/robber.js';
import { shuffle } from '../../rng.js';
import { computeVp } from '../../vp.js';
import { fishOf, tbExt, withTbExt } from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

// ---- Fixed data (§TB2.1/§TB2.2/§TB2.5, ⚠ VERIFY against the physical rulebook) -----------------

/**
 * ⚠ VERIFY exact composition against the rulebook — provisional 19-token stack: 6 each of 1/2/3 fish
 * plus a single Old Boot tile (`0`). Named so a correction is a one-line change; `initialFishermenExt`
 * shuffles a COPY of this (never mutated).
 */
export const FISHERMEN_FISH_STACK: readonly number[] = [
  ...Array<number>(6).fill(1),
  ...Array<number>(6).fill(2),
  ...Array<number>(6).fill(3),
  0,
];

/** Non-Lake number tokens (§TB2.1 — the Lake alone covers 2/3/11/12): one fishing ground per token. */
const FISHING_GROUND_TOKENS: readonly number[] = [4, 5, 6, 8, 9, 10];

/**
 * ⚠ VERIFY exact positions against the diagram — approximate-but-valid placement is acceptable for
 * v1 (docs/rules/traders-barbarians-rules.md's explicit allowance, mirroring the seafarers scenario
 * frame's MEDIUM-confidence data). Six fishing grounds spread evenly around `geometry`'s fixed
 * coastline (`geometry.coastEdges`, a clockwise cycle): each sits "just offshore" of one coastal
 * edge and feeds that edge's two endpoint vertices (§TB2.2). Takes the geometry as a parameter
 * (rather than always reading the base 19-hex `GEOMETRY`) so a fiveSix game's 30-hex `GEOMETRY_EXT56`
 * coastline gets its OWN 6 evenly-spread grounds (Phase 10B, T-1050) — purely a function of
 * `geometry.coastEdges`'s length, no board-size-specific code. Never random (the coastline is fixed
 * for a given geometry), so no `rng` draw is needed at `createGame`.
 */
function computeFishingGrounds(geometry: BoardGeometry): { token: number; vertices: VertexId[] }[] {
  const coast = geometry.coastEdges;
  return FISHING_GROUND_TOKENS.map((token, i) => {
    const edgeId = coast[Math.floor((i * coast.length) / FISHING_GROUND_TOKENS.length)];
    if (edgeId === undefined) throw new Error(`BUG: fishing-ground coast index ${i} out of range`);
    const edge = geometry.edges[edgeId];
    if (edge === undefined) throw new Error(`BUG: fishing-ground coast edge ${edgeId} missing`);
    return { token, vertices: [edge.a, edge.b] };
  });
}

/** The base 3–4p board's fishing grounds — a fixed module-load constant (unchanged from before
 *  T-1050, RK-13). A fiveSix game recomputes its OWN grounds against `GEOMETRY_EXT56` at
 *  `createGame` time instead (see `initialFishermenExt`'s `geometry` parameter below). */
export const FISHERMEN_FISHING_GROUNDS: readonly { token: number; vertices: readonly VertexId[] }[] =
  computeFishingGrounds(GEOMETRY);

/** §TB2.4 ⚠ VERIFY exact ladder against the rulebook — named constants so a correction touches one
 *  line each. */
export const FISH_EXCHANGE_COST: Readonly<Record<FishBenefit, number>> = {
  removeRobber: 2,
  steal: 3,
  bankResource: 4,
  freeRoad: 5,
  devCard: 7,
};

// ---- Init (createGame) ---------------------------------------------------------------------------

/**
 * Seed `ext.tradersBarbarians` for a fishermen game (createGame, gated on
 * `isFishermenConfig(config)`). `board` is the already-generated board (base 19-hex, or — Phase 10B,
 * T-1050 — the 30-hex `GEOMETRY_EXT56` for a fiveSix game) — the Lake is its (first) desert hex (R2:
 * the base board always has exactly one, never numbered; the EXT56 board has two, §EXT56 — only the
 * FIRST becomes the Lake, ⚠ VERIFY against the physical 5–6 rules for whether it should be TWO Lakes
 * there; a single Lake is a safe v1 simplification, the second desert stays a plain blocked hex).
 * `geometry` is the board's resolved geometry (`geometryForConfig(config)` at the call site) — the
 * fishing grounds are computed against IT (not always the base `GEOMETRY`), so a fiveSix game's
 * grounds spread over its own (longer) coastline instead of reusing the base board's fixed 6.
 * Threads `rng` like the seafarers scenario board / C&K ext init do.
 */
export function initialFishermenExt(
  playerCount: number,
  rng: number,
  board: GameState['board'],
  geometry: BoardGeometry
): { rng: number; ext: NonNullable<NonNullable<GameState['ext']>['tradersBarbarians']> } {
  const lakeIndex = board.hexes.findIndex((h) => h.terrain === 'desert');
  if (lakeIndex < 0) {
    throw new Error('BUG: fishermen init found no desert hex on the board to seed as the Lake (§TB2.1)');
  }
  const shuffled = shuffle(rng, FISHERMEN_FISH_STACK);
  const fishingGrounds = geometry === GEOMETRY ? FISHERMEN_FISHING_GROUNDS : computeFishingGrounds(geometry);
  return {
    rng: shuffled.state,
    ext: {
      scenario: 'fishermen',
      fish: Array.from({ length: playerCount }, () => 0),
      fishStack: shuffled.array,
      oldBoot: null,
      lakeHex: lakeIndex as GameState['board']['robber'],
      fishingGrounds: fishingGrounds.map((g) => ({ token: g.token, vertices: [...g.vertices] })),
    },
  };
}

// ---- Production (§TB2.2, module `phaseHooks.afterAction` on `rollDice`) --------------------------

/**
 * §TB2.2: on a producing roll, each settlement adjacent to a producing water source draws 1 fish
 * token, each city 2, popped off the shared face-down stack (index 0 = next draw — stack ORDER is
 * the randomness, no extra `rng` draw here, per the task's design). The Lake (§TB2.1) produces on
 * 2/3/11/12 unless the robber sits on it (§TB2.6); each fishing ground produces on its own token,
 * never blocked by the robber (it isn't a land hex the robber can occupy in this v1 model). A drawn
 * `0` (the Old Boot, §TB2.5) never adds fish to its drawer — it instead goes to the sole current VP
 * leader (a tie leaves the previous holder, or stays unclaimed, exactly like Rivers' Wealthiest
 * Settler tie rule §TB3.4 is flagged to verify). Returns `null` when nothing produced this roll (no
 * fishermen state, or no water source matches the total) — the module's `afterAction` hook already
 * gates on `rollDice`/`next.turn.roll`.
 */
export function applyFishermenProduction(
  next: GameState,
  events: readonly GameEvent[]
): { state: GameState; events: GameEvent[] } | null {
  const ext = tbExt(next);
  if (!ext || ext.scenario !== 'fishermen' || !next.turn.roll) return null;
  const total = next.turn.roll[0] + next.turn.roll[1];

  const demand = new Map<Seat, number>();
  const addDemand = (vertices: readonly VertexId[]): void => {
    for (const v of vertices) {
      for (const p of next.players) {
        const level = p.cities.includes(v) ? 2 : p.settlements.includes(v) ? 1 : 0;
        if (level > 0) demand.set(p.seat, (demand.get(p.seat) ?? 0) + level);
      }
    }
  };

  if ((total === 2 || total === 3 || total === 11 || total === 12) && ext.lakeHex !== undefined) {
    if (next.board.robber !== ext.lakeHex) {
      const lakeHexGeo = geometryForState(next).hexes[ext.lakeHex];
      if (lakeHexGeo) addDemand(lakeHexGeo.vertices);
    }
  }
  for (const ground of ext.fishingGrounds ?? []) {
    if (ground.token === total) addDemand(ground.vertices);
  }

  if (demand.size === 0) return null;

  const stack = [...(ext.fishStack ?? [])];
  const fish = [...(ext.fish ?? [])];
  let oldBoot = ext.oldBoot ?? null;
  const gains: { seat: Seat; amount: number }[] = [];
  let bootDrawn = false;

  for (const seat of [...demand.keys()].sort((a, b) => a - b)) {
    const draws = Math.min(demand.get(seat) ?? 0, stack.length);
    let gained = 0;
    for (let i = 0; i < draws; i++) {
      const token = stack.shift();
      if (token === undefined) break;
      if (token === 0) {
        bootDrawn = true; // §TB2.5: resolved below — never added to the drawer's fish total.
      } else {
        gained += token;
      }
    }
    if (gained > 0) {
      fish[seat] = (fish[seat] ?? 0) + gained;
      gains.push({ seat, amount: gained });
    }
  }

  const outEvents: GameEvent[] = [...events];
  if (gains.length > 0) outEvents.push(fishProduced(gains));

  if (bootDrawn) {
    const vps = next.players.map((p) => ({ seat: p.seat, vp: computeVp(next, p.seat).total }));
    const maxVp = Math.max(...vps.map((v) => v.vp));
    const leaders = vps.filter((v) => v.vp === maxVp).map((v) => v.seat);
    if (leaders.length === 1 && leaders[0] !== oldBoot) {
      oldBoot = leaders[0]!;
      outEvents.push(oldBootAwarded(oldBoot));
    }
  }

  const withExt = withTbExt(next, { ...ext, fish, fishStack: stack, oldBoot });
  return { state: withExt, events: outEvents };
}

// ---- Exchange (§TB2.4) ----------------------------------------------------------------------------

/**
 * `exchangeFish` (§TB2.4): spend the benefit's fixed fish cost for a one-shot effect, reusing
 * existing engine helpers for every effect (robber move, steal, bank take, free road, dev-card draw)
 * rather than reimplementing them. Main phase only (mirrors bank trade / dev-card buy — this isn't a
 * base action, so there's no R-clause tying it to preRoll). Every branch either fully resolves the
 * effect or returns a coded failure BEFORE any fish are spent (all-or-nothing).
 */
export function exchangeFishHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'exchangeFish' }>
): EngineResult {
  if (state.phase.kind !== 'main') {
    return fail('WRONG_PHASE', 'fish may only be exchanged in the main phase (§TB2.4)');
  }
  const cost = FISH_EXCHANGE_COST[action.benefit];
  const held = fishOf(state, seat);
  if (held < cost) {
    return fail(
      'NOT_ENOUGH_FISH',
      `seat ${seat} needs ${cost} fish for '${action.benefit}' (§TB2.4), holds ${held}`
    );
  }

  let resolved: EngineResult;
  let detail: unknown;
  switch (action.benefit) {
    case 'removeRobber': {
      const lake = tbExt(state)?.lakeHex;
      if (lake === undefined) return fail('BAD_LOCATION', 'no Lake hex to move the robber to (§TB2.1)');
      resolved = {
        ok: true,
        state: { ...state, board: { ...state.board, robber: lake } },
        events: [robberMoved(seat, lake)],
      };
      break;
    }
    case 'steal': {
      const candidates = stealCandidatesForHex(state, state.board.robber);
      if (action.from === undefined || !candidates.includes(action.from)) {
        return fail(
          'NOT_A_CANDIDATE',
          `seat ${action.from ?? '?'} is not a legal steal target adjacent to the robber (§TB2.4)`
        );
      }
      detail = { from: action.from };
      resolved = resolveSteal(state, seat, action.from, 'main', []);
      break;
    }
    case 'bankResource': {
      const resource = action.resource;
      if (resource === undefined) {
        return fail('BAD_TRADE', "exchangeFish 'bankResource' requires a resource (§TB2.4)");
      }
      if (state.bank[resource] < 1) {
        return fail('BANK_EMPTY', `the bank holds no ${resource} (§TB2.4)`);
      }
      const bank: Record<ResourceType, number> = { ...state.bank, [resource]: state.bank[resource] - 1 };
      const players = state.players.map((p) =>
        p.seat === seat ? { ...p, resources: { ...p.resources, [resource]: p.resources[resource] + 1 } } : p
      );
      detail = { resource };
      resolved = { ok: true, state: { ...state, bank, players }, events: [] };
      break;
    }
    case 'freeRoad': {
      const edge: EdgeId | undefined = action.edge;
      if (edge === undefined) {
        return fail('BAD_LOCATION', "exchangeFish 'freeRoad' requires an edge (§TB2.4)");
      }
      const player = state.players[seat];
      if (!player || player.piecesLeft.roads <= 0) {
        return fail('NO_PIECES_LEFT', `seat ${seat} has no road pieces left (§TB2.4)`);
      }
      if (!canPlaceRoad(state, seat, edge)) {
        return fail('BAD_LOCATION', `edge ${edge} is not a legal free-road spot (R7.2/§TB2.4)`);
      }
      const players = state.players.map((p) =>
        p.seat === seat
          ? { ...p, roads: [...p.roads, edge], piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads - 1 } }
          : p
      );
      const awarded = updateAwards({ ...state, players });
      detail = { edge };
      resolved = { ok: true, state: awarded.state, events: [built(seat, 'road', edge), ...awarded.events] };
      break;
    }
    case 'devCard': {
      if (state.devDeck.length === 0) return fail('DECK_EMPTY', 'the development card deck is empty (§TB2.4)');
      const card = state.devDeck[0]!;
      const devDeck = state.devDeck.slice(1);
      const players = state.players.map((p) =>
        p.seat === seat
          ? { ...p, devCards: [...p.devCards, { type: card, boughtOnTurn: state.turn.number }] }
          : p
      );
      resolved = { ok: true, state: { ...state, players, devDeck }, events: [devBought(seat, card)] };
      break;
    }
    default:
      // Exhaustive over `FishBenefit` — unreachable unless the union grows without a matching case.
      throw new Error(`BUG: exchangeFish handled an unknown benefit '${String(action.benefit)}'`);
  }

  if (!resolved.ok) return resolved;
  const ext = tbExt(resolved.state);
  if (!ext) throw new Error('BUG: fishermen ext vanished mid-exchange');
  const fish = [...(ext.fish ?? [])];
  fish[seat] = (fish[seat] ?? 0) - cost;
  const withExt = withTbExt(resolved.state, { ...ext, fish });
  return {
    ok: true,
    state: withExt,
    events: [...resolved.events, fishExchanged(seat, action.benefit, cost, detail)],
  };
}

// ---- Old Boot pass (§TB2.5) -----------------------------------------------------------------------

/**
 * `passOldBoot` (§TB2.5): the current holder passes it to an opponent they are trailing OR TIED
 * with (i.e. `to`'s VP >= the holder's VP) — the boot may never be dumped onto a strictly weaker
 * player, or it stops being a catch-up mechanic.
 */
export function passOldBootHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'passOldBoot' }>
): EngineResult {
  if (state.phase.kind !== 'main') {
    return fail('WRONG_PHASE', 'the Old Boot may only be passed in the main phase (§TB2.5)');
  }
  const ext = tbExt(state);
  if (!ext || ext.oldBoot !== seat) {
    return fail('OLD_BOOT_NOT_HELD', `seat ${seat} does not hold the Old Boot (§TB2.5)`);
  }
  if (action.to === seat || !state.players.some((p) => p.seat === action.to)) {
    return fail('BAD_OLD_BOOT_TARGET', `seat ${action.to} is not a valid Old Boot target (§TB2.5)`);
  }
  const myVp = computeVp(state, seat).total;
  const targetVp = computeVp(state, action.to).total;
  if (targetVp < myVp) {
    return fail(
      'BAD_OLD_BOOT_TARGET',
      `the Old Boot may only be passed to a seat you are trailing or tied with (§TB2.5)`
    );
  }
  const withExt = withTbExt(state, { ...ext, oldBoot: action.to });
  return { ok: true, state: withExt, events: [oldBootPassed(seat, action.to)] };
}
