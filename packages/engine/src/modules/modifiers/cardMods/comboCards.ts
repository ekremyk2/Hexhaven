// The 5 curated "combined card play" one-shots (T-904, docs/tasks/modifiers-cards-RESEARCH.md D1b,
// colonist.io house rules): each CONSUMES two existing BASE dev cards from hand in a single action,
// relaxing the "one card per turn" rule for that specific pairing only (R9.3 still applies to the
// COMBO itself — you get one combo-or-single-card play per turn, never both). Reuses base mechanics
// throughout: `commonPlayBlockReason` (phases/devCards.ts, exported) validates each component card
// independently — CARD_NOT_HELD / DEV_ALREADY_PLAYED / DEV_BOUGHT_THIS_TURN, composing with
// `playDevSameTurn` for free exactly like `shared.ts`'s `isPlayable` — `removeDevCards`/
// `knightRobberMove` (shared.ts) do the rest.
//
// Card summary:
//   rideByNight   — Knight + Road Building together; the free road is capped at 1 (not 2) per the
//                   research doc's "RB builds only 1 road" ruling.
//   nightOfPlenty — Knight + Year of Plenty together; YoP grants only 1 resource (not 2).
//   monorail      — Monopoly + Road Building together; takes ALL lumber AND brick from every other
//                   seat (a fixed two-resource monopoly, not a player-chosen one) and builds 1-2
//                   free roads.
//   megaKnight    — 2 Knights at once; steals a dev card (not a resource) from a chosen opponent.
//                   Picked uniformly at RANDOM via the engine's seeded rng (`pickIndex`) rather than
//                   by position/identity — sidesteps the redaction/hidden-info UI problem the
//                   research doc flags for this card entirely (the base robber steal already picks
//                   randomly from a hand the same way).
//   superSettle   — discard a Victory Point card to upgrade a settlement straight to a city,
//                   bypassing the normal ore+grain cost. VP cards are exempt from R9.3/R9.4 (R9.8) —
//                   this does NOT set `turn.devPlayed`, matching that exemption.
//
// None needs `state.ext` (all resolve immediately, no persistent/turn-scoped flags).

import type { EdgeId, GameEvent, GameState, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../../reduce.js';
import { built, devPlayed, monopolyResolved, production } from '../../../events.js';
import { commonPlayBlockReason } from '../../../phases/devCards.js';
import { geometryForState } from '../../index.js';
import { canPlaceRoad } from '../../../rules/connectivity.js';
import { updateAwards } from '../../../rules/awards.js';
import { pickIndex } from '../../../rng.js';
import { fail, knightRobberMove, playableIndices, removeDevCards } from './shared.js';
import type { CardModComboId, PlayCardModComboAction } from './types.js';

type ComboEffect = (state: GameState, seat: Seat, action: PlayCardModComboAction) => EngineResult;

/** rideByNight: Knight + Road Building together; the free road is capped at 1 (not 2). */
function effectRideByNight(state: GameState, seat: Seat, action: PlayCardModComboAction): EngineResult {
  const knightBlock = commonPlayBlockReason(state, seat, 'knight');
  if (knightBlock) return fail(knightBlock, `Ride by Night requires a playable Knight card (${knightBlock})`);
  const rbBlock = commonPlayBlockReason(state, seat, 'roadBuilding');
  if (rbBlock) return fail(rbBlock, `Ride by Night requires a playable Road Building card (${rbBlock})`);

  const { edge, hex } = action;
  if (edge === undefined || hex === undefined) {
    return fail('BAD_CARD_TARGET', 'Ride by Night requires an edge and a hex');
  }
  const player = state.players[seat]!;
  if (player.piecesLeft.roads <= 0) return fail('NO_PIECES_LEFT', 'no road pieces left');
  if (!canPlaceRoad(state, seat, edge)) return fail('BAD_LOCATION', `edge ${edge} is not a legal free-road spot (R7.2)`);

  const players = removeDevCards(state, seat, ['knight', 'roadBuilding']).map((p) =>
    p.seat === seat
      ? {
          ...p,
          roads: [...p.roads, edge],
          piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads - 1 },
          playedKnights: p.playedKnights + 1,
        }
      : p
  );
  const awarded = updateAwards({ ...state, players, turn: { ...state.turn, devPlayed: true } });
  const events: GameEvent[] = [built(seat, 'road', edge), ...awarded.events];

  const robberResult = knightRobberMove(awarded.state, seat, hex);
  if (!robberResult.ok) return robberResult;
  return { ok: true, state: robberResult.state, events: [...events, ...robberResult.events] };
}

/** nightOfPlenty: Knight + Year of Plenty together; YoP grants only 1 resource (not 2). */
function effectNightOfPlenty(state: GameState, seat: Seat, action: PlayCardModComboAction): EngineResult {
  const knightBlock = commonPlayBlockReason(state, seat, 'knight');
  if (knightBlock) return fail(knightBlock, `Night of Plenty requires a playable Knight card (${knightBlock})`);
  const yopBlock = commonPlayBlockReason(state, seat, 'yearOfPlenty');
  if (yopBlock) return fail(yopBlock, `Night of Plenty requires a playable Year of Plenty card (${yopBlock})`);

  const { resource, hex } = action;
  if (!resource || hex === undefined) return fail('BAD_CARD_TARGET', 'Night of Plenty requires a resource and a hex');
  if (state.bank[resource] < 1) return fail('BANK_EMPTY', `the bank has no ${resource} left`);

  const players = removeDevCards(state, seat, ['knight', 'yearOfPlenty']).map((p) =>
    p.seat === seat
      ? { ...p, resources: { ...p.resources, [resource]: p.resources[resource] + 1 }, playedKnights: p.playedKnights + 1 }
      : p
  );
  const bank = { ...state.bank, [resource]: state.bank[resource] - 1 };
  const awarded = updateAwards({ ...state, players, bank, turn: { ...state.turn, devPlayed: true } });
  const events: GameEvent[] = [production([{ seat, resources: { [resource]: 1 } }], []), ...awarded.events];

  const robberResult = knightRobberMove(awarded.state, seat, hex);
  if (!robberResult.ok) return robberResult;
  return { ok: true, state: robberResult.state, events: [...events, ...robberResult.events] };
}

/** monorail: Monopoly + Road Building together; takes ALL lumber+brick from every other seat and
 *  builds 1-2 free roads. */
function effectMonorail(state: GameState, seat: Seat, action: PlayCardModComboAction): EngineResult {
  const monoBlock = commonPlayBlockReason(state, seat, 'monopoly');
  if (monoBlock) return fail(monoBlock, `Monorail requires a playable Monopoly card (${monoBlock})`);
  const rbBlock = commonPlayBlockReason(state, seat, 'roadBuilding');
  if (rbBlock) return fail(rbBlock, `Monorail requires a playable Road Building card (${rbBlock})`);

  const edges: EdgeId[] = action.edges ?? [];
  if (edges.length < 1 || edges.length > 2) return fail('BAD_CARD_TARGET', 'Monorail requires 1 or 2 edges');
  const player = state.players[seat]!;
  if (player.piecesLeft.roads < edges.length) return fail('NO_PIECES_LEFT', 'not enough road pieces left');

  const geometry = geometryForState(state);
  let cur = state;
  const builtEvents: GameEvent[] = [];
  for (const edge of edges) {
    if (!geometry.edges[edge]) return fail('BAD_LOCATION', `edge ${edge} is off the board`);
    if (!canPlaceRoad(cur, seat, edge)) return fail('BAD_LOCATION', `edge ${edge} is not a legal free-road spot (R7.2)`);
    cur = {
      ...cur,
      players: cur.players.map((p) =>
        p.seat === seat
          ? { ...p, roads: [...p.roads, edge], piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads - 1 } }
          : p
      ),
    };
    builtEvents.push(built(seat, 'road', edge));
  }

  const takenLumber: { seat: Seat; count: number }[] = [];
  const takenBrick: { seat: Seat; count: number }[] = [];
  let collectedLumber = 0;
  let collectedBrick = 0;
  const stripped = cur.players.map((p) => {
    if (p.seat === seat) return p;
    const lumber = p.resources.lumber;
    const brick = p.resources.brick;
    takenLumber.push({ seat: p.seat, count: lumber });
    takenBrick.push({ seat: p.seat, count: brick });
    if (lumber === 0 && brick === 0) return p;
    collectedLumber += lumber;
    collectedBrick += brick;
    return { ...p, resources: { ...p.resources, lumber: 0, brick: 0 } };
  });
  const withGains = stripped.map((p) =>
    p.seat === seat
      ? { ...p, resources: { ...p.resources, lumber: p.resources.lumber + collectedLumber, brick: p.resources.brick + collectedBrick } }
      : p
  );

  const players = removeDevCards({ ...cur, players: withGains }, seat, ['monopoly', 'roadBuilding']);
  const awarded = updateAwards({ ...cur, players, turn: { ...cur.turn, devPlayed: true } });
  const events: GameEvent[] = [
    ...builtEvents,
    monopolyResolved(seat, 'lumber', takenLumber),
    monopolyResolved(seat, 'brick', takenBrick),
    ...awarded.events,
  ];
  return { ok: true, state: awarded.state, events };
}

/** megaKnight: 2 Knights at once; steals a dev card (not a resource) from a chosen opponent,
 *  selected uniformly at random via the seeded rng. */
function effectMegaKnight(state: GameState, seat: Seat, action: PlayCardModComboAction): EngineResult {
  const knightBlock = commonPlayBlockReason(state, seat, 'knight');
  if (knightBlock) return fail(knightBlock, `Mega Knight requires a playable Knight card (${knightBlock})`);
  if (playableIndices(state, seat, 'knight').length < 2) {
    return fail('CARD_NOT_HELD', `seat ${seat} needs 2 playable Knight cards for Mega Knight`);
  }
  const targetSeat = action.targetSeat;
  if (targetSeat === undefined || targetSeat === seat) {
    return fail('BAD_CARD_TARGET', 'Mega Knight requires an opposing targetSeat');
  }
  const target = state.players[targetSeat];
  if (!target) return fail('BAD_CARD_TARGET', `seat ${targetSeat} does not exist`);
  if (target.devCards.length === 0) return fail('NOT_A_CANDIDATE', `seat ${targetSeat} holds no dev cards to steal`);

  const players = removeDevCards(state, seat, ['knight', 'knight']).map((p) =>
    p.seat === seat ? { ...p, playedKnights: p.playedKnights + 2 } : p
  );
  const awarded = updateAwards({ ...state, players, turn: { ...state.turn, devPlayed: true } });

  const draw = pickIndex(awarded.state.rng, target.devCards.length);
  const stolenCard = target.devCards[draw.value]!;
  const finalPlayers = awarded.state.players.map((p) => {
    if (p.seat === targetSeat) {
      return { ...p, devCards: [...p.devCards.slice(0, draw.value), ...p.devCards.slice(draw.value + 1)] };
    }
    if (p.seat === seat) return { ...p, devCards: [...p.devCards, stolenCard] };
    return p;
  });
  return { ok: true, state: { ...awarded.state, rng: draw.state, players: finalPlayers }, events: awarded.events };
}

/** superSettle: discard a Victory Point card to upgrade a settlement straight to a city, bypassing
 *  the ore+grain cost. VP cards are exempt from R9.3/R9.4 (R9.8) — does NOT set `turn.devPlayed`. */
function effectSuperSettle(state: GameState, seat: Seat, action: PlayCardModComboAction): EngineResult {
  const vertex = action.vertex;
  if (vertex === undefined) return fail('BAD_CARD_TARGET', 'Super-Settle requires a vertex');
  const player = state.players[seat]!;
  const vpIndex = player.devCards.findIndex((c) => c.type === 'victoryPoint');
  if (vpIndex === -1) return fail('CARD_NOT_HELD', `seat ${seat} holds no Victory Point card`);
  if (!player.settlements.includes(vertex)) {
    return fail('BAD_LOCATION', 'a city must replace one of your own settlements (R7.4)');
  }
  if (player.piecesLeft.cities <= 0) return fail('NO_PIECES_LEFT', 'no city pieces left');

  const devCards = [...player.devCards.slice(0, vpIndex), ...player.devCards.slice(vpIndex + 1)];
  const players = state.players.map((p) =>
    p.seat === seat
      ? {
          ...p,
          devCards,
          settlements: p.settlements.filter((s) => s !== vertex),
          cities: [...p.cities, vertex],
          piecesLeft: { ...p.piecesLeft, settlements: p.piecesLeft.settlements + 1, cities: p.piecesLeft.cities - 1 },
        }
      : p
  );
  return { ok: true, state: { ...state, players }, events: [built(seat, 'city', vertex)] };
}

const COMBO_EFFECTS: Record<CardModComboId, ComboEffect> = {
  rideByNight: effectRideByNight,
  nightOfPlenty: effectNightOfPlenty,
  monorail: effectMonorail,
  megaKnight: effectMegaKnight,
  superSettle: effectSuperSettle,
};

/**
 * Play a combo card. Unlike `playCardModCard` (single base `beginPlay` guard), each combo effect
 * validates its OWN component cards independently (different counts/types per combo), so there is
 * no single shared guard to hoist here — each effect fails fast via `fail(...)` before touching
 * state if any component isn't playable. `devPlayed`'s `card` field admits a `CardModComboId`
 * directly (packages/shared/src/types.ts) for exactly this log event, so no cast is needed.
 */
export function playCardModCombo(state: GameState, seat: Seat, action: PlayCardModComboAction): EngineResult {
  const effect = COMBO_EFFECTS[action.combo];
  const result = effect(state, seat, action);
  if (!result.ok) return result;

  const events: GameEvent[] = [devPlayed(seat, action.combo), ...result.events];
  return { ok: true, state: result.state, events };
}
