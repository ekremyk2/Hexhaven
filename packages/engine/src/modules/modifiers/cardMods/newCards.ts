// The 6 curated new dev-card TYPES (T-904, docs/tasks/modifiers-cards-RESEARCH.md D1c). Mirrors
// Cities & Knights' `playProgressCard` dispatch shape (modules/citiesKnights/progressCards.ts): a
// common guard + hand-removal happens once in `playCardModCard`, then each effect function in
// `CARD_EFFECTS` receives a state whose hand ALREADY has the card removed and the turn's one-dev-
// card allowance ALREADY marked used (via `phases/devCards.ts`'s exported `beginPlay` — the exact
// same R9.3/R9.4 guard every base dev card uses, reused verbatim rather than reimplemented, so
// these compose with `playDevSameTurn` for free). A `fail(...)` from an effect rolls the WHOLE
// action back — an invalid target never consumes the card.
//
// Card summary (data + one handler each, per the task's "cheap" bar):
//   bumperCrop    — gain 1 of every resource type the bank can still supply (fixed bundle, no
//                   targeting UI).
//   merchantsBoon — a one-shot 2:1 bank trade (give 2 of a chosen resource, receive 1 of another),
//                   self-contained (does not touch `bankTrade`/harbor rates in phases/main.ts).
//   roadToll      — every OTHER seat holding >=1 of a named resource gives you exactly 1 of it
//                   (capped at 1/seat, unlike Monopoly's "all") — reuses the `monopolyResolved`
//                   event shape exactly like Cities & Knights' Resource Monopoly card does.
//   trailblazer   — build exactly 1 free road with NO connectivity requirement (only "not already
//                   occupied") — Road Building's smaller, unconnected sibling.
//   windfall      — draw the top 2 cards of `devDeck` into hand for free (still subject to R9.3/R9.4
//                   once IN hand — no infinite-draw risk since drawing never auto-plays a card).
//   highwayman    — relocate the robber with NO steal at all (a purely defensive Knight-lite).
//
// Simplifications documented at each effect below; none needs `state.ext` (all resolve immediately,
// no persistent/turn-scoped flags).

import type { GameEvent, GameState, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../../reduce.js';
import { bankTraded, built, devPlayed, monopolyResolved, production, robberMoved } from '../../../events.js';
import { beginPlay } from '../../../phases/devCards.js';
import { geometryForState } from '../../index.js';
import { isEdgeOccupied } from '../../../rules/placement.js';
import { updateAwards } from '../../../rules/awards.js';
import { fail, RESOURCE_ORDER } from './shared.js';
import type { CardModDevCardId, PlayCardModCardAction } from './types.js';

type CardEffect = (state: GameState, seat: Seat, action: PlayCardModCardAction) => EngineResult;

/** bumperCrop: gain 1 of every resource type, bank-limited per type — no choice, no target fields. */
function effectBumperCrop(state: GameState, seat: Seat): EngineResult {
  const gains: ResourceBundle = {};
  const shortages: ResourceType[] = [];
  const bank = { ...state.bank };
  for (const res of RESOURCE_ORDER) {
    if (bank[res] > 0) {
      gains[res] = 1;
      bank[res] -= 1;
    } else {
      shortages.push(res);
    }
  }
  if (Object.keys(gains).length === 0) return { ok: true, state, events: [] };
  const player = state.players[seat]!;
  const resources = { ...player.resources };
  for (const res of RESOURCE_ORDER) resources[res] += gains[res] ?? 0;
  const players = state.players.map((p) => (p.seat === seat ? { ...p, resources } : p));
  return { ok: true, state: { ...state, players, bank }, events: [production([{ seat, resources: gains }], shortages)] };
}

/** merchantsBoon: one-shot 2:1 trade with the bank (give 2 of `give`, receive 1 of `receive`). */
function effectMerchantsBoon(state: GameState, seat: Seat, action: PlayCardModCardAction): EngineResult {
  const { give, receive } = action;
  if (!give || !receive || give === receive) {
    return fail('BAD_CARD_TARGET', "Merchant's Boon requires distinct give/receive resources");
  }
  const player = state.players[seat]!;
  if (player.resources[give] < 2) return fail('CANT_AFFORD', `need 2 ${give}, seat ${seat} holds ${player.resources[give]}`);
  if (state.bank[receive] < 1) return fail('BANK_EMPTY', `the bank has no ${receive} left`);

  const bank = { ...state.bank, [give]: state.bank[give] + 2, [receive]: state.bank[receive] - 1 };
  const players = state.players.map((p) =>
    p.seat === seat
      ? { ...p, resources: { ...p.resources, [give]: p.resources[give] - 2, [receive]: p.resources[receive] + 1 } }
      : p
  );
  return {
    ok: true,
    state: { ...state, players, bank },
    events: [bankTraded(seat, { [give]: 2 }, { [receive]: 1 }, 2)],
  };
}

/** roadToll: every OTHER seat holding >=1 of `resource` gives you exactly 1 of it (capped at 1). */
function effectRoadToll(state: GameState, seat: Seat, action: PlayCardModCardAction): EngineResult {
  const resource = action.resource;
  if (!resource) return fail('BAD_CARD_TARGET', 'Road Toll requires a resource');

  const taken: { seat: Seat; count: number }[] = [];
  let collected = 0;
  const stripped = state.players.map((p) => {
    if (p.seat === seat) return p;
    const count = Math.min(1, p.resources[resource]);
    taken.push({ seat: p.seat, count });
    if (count === 0) return p;
    collected += count;
    return { ...p, resources: { ...p.resources, [resource]: p.resources[resource] - count } };
  });
  const players = stripped.map((p) =>
    p.seat === seat ? { ...p, resources: { ...p.resources, [resource]: p.resources[resource] + collected } } : p
  );
  return { ok: true, state: { ...state, players }, events: [monopolyResolved(seat, resource, taken)] };
}

/** trailblazer: build exactly 1 free road with NO connectivity requirement — only "not occupied". */
function effectTrailblazer(state: GameState, seat: Seat, action: PlayCardModCardAction): EngineResult {
  const edge = action.edge;
  if (edge === undefined) return fail('BAD_CARD_TARGET', 'Trailblazer requires an edge');
  const geometry = geometryForState(state);
  if (!geometry.edges[edge]) return fail('BAD_LOCATION', `edge ${edge} is off the board`);
  if (isEdgeOccupied(state, edge)) return fail('OCCUPIED', `edge ${edge} already holds a road/ship`);
  const player = state.players[seat]!;
  if (player.piecesLeft.roads <= 0) return fail('NO_PIECES_LEFT', 'no road pieces left');

  const players = state.players.map((p) =>
    p.seat === seat
      ? { ...p, roads: [...p.roads, edge], piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads - 1 } }
      : p
  );
  const awarded = updateAwards({ ...state, players });
  return { ok: true, state: awarded.state, events: [built(seat, 'road', edge), ...awarded.events] };
}

/** windfall: draw the top 2 cards of `devDeck` into hand for free (fewer if the deck runs short). */
function effectWindfall(state: GameState, seat: Seat): EngineResult {
  if (state.devDeck.length === 0) return { ok: true, state, events: [] };
  const drawn = state.devDeck.slice(0, 2);
  const devDeck = state.devDeck.slice(2);
  const players = state.players.map((p) =>
    p.seat === seat
      ? { ...p, devCards: [...p.devCards, ...drawn.map((type) => ({ type, boughtOnTurn: state.turn.number }))] }
      : p
  );
  return { ok: true, state: { ...state, players, devDeck }, events: drawn.map((type) => devPlayed(seat, type, { windfall: true })) };
}

/** highwayman: relocate the robber with NO steal at all — a purely defensive Knight-lite. */
function effectHighwayman(state: GameState, seat: Seat, action: PlayCardModCardAction): EngineResult {
  const hex = action.hex;
  if (hex === undefined) return fail('BAD_CARD_TARGET', 'Highwayman requires a hex');
  const geometry = geometryForState(state);
  if (!geometry.hexes[hex]) return fail('BAD_LOCATION', `hex ${hex} is off the board`);
  if (hex === state.board.robber) return fail('ROBBER_SAME_HEX', 'the robber must move to a different hex (ER-8)');
  return { ok: true, state: { ...state, board: { ...state.board, robber: hex } }, events: [robberMoved(seat, hex)] };
}

const CARD_EFFECTS: Record<CardModDevCardId, CardEffect> = {
  bumperCrop: effectBumperCrop,
  merchantsBoon: effectMerchantsBoon,
  roadToll: effectRoadToll,
  trailblazer: effectTrailblazer,
  windfall: effectWindfall,
  highwayman: effectHighwayman,
};

/**
 * Play a curated new-type dev card from `seat`'s hand. `beginPlay` (phases/devCards.ts) is the
 * SAME function every base dev card uses for the CARD_NOT_HELD/DEV_ALREADY_PLAYED/
 * DEV_BOUGHT_THIS_TURN guard + hand removal + `turn.devPlayed` bookkeeping — `action.card` is a
 * real `AnyDevCardId` member (packages/shared/src/types.ts), so no cast is needed at this boundary.
 */
export function playCardModCard(state: GameState, seat: Seat, action: PlayCardModCardAction): EngineResult {
  const guard = beginPlay(state, seat, action.card);
  if (!guard.ok) return guard;

  const effect = CARD_EFFECTS[action.card];
  const result = effect(guard.state, seat, action);
  if (!result.ok) return result;

  const events: GameEvent[] = [devPlayed(seat, action.card), ...result.events];
  return { ok: true, state: result.state, events };
}

/** Curated additions to the base 25-card dev deck (1 copy each, 6 cards total) — PM reference for
 *  merging into the real `ModuleConstants.devDeck` composition at wiring time (index.ts checklist). */
export const CARD_MOD_DEV_DECK_ADDITIONS: Readonly<Record<CardModDevCardId, number>> = {
  bumperCrop: 1,
  merchantsBoon: 1,
  roadToll: 1,
  trailblazer: 1,
  windfall: 1,
  highwayman: 1,
};
