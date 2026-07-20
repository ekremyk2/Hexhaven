// Traders & Barbarians action-control logic (T-1008): pure enablement/reason helpers for the 5
// scenarios' new actions, mirroring `citiesKnights/ckActionLogic.ts`'s split exactly — a
// presentational component only ever calls into this module, never re-derives legality itself. Every
// helper treats `view` as a full `GameState` for legal-target enumeration (same documented WIRE
// workaround `actionBarLogic.ts`/`ckActionLogic.ts` use: legal-move enumeration is about the ACTING
// seat's own choices, which redaction never hides from that seat).
import {
  CARAVANS_CAMEL_SUPPLY,
  FISH_EXCHANGE_COST,
  KNIGHT_COST,
  RIVERS_BRIDGE_COST,
  legalBridgeEdges,
  legalCamelEdges,
  legalKnightRecruitEdges,
  legalWagonDestinations,
  riversCoinTradeRate,
} from '@hexhaven/engine';
import type { GameState, PlayerView } from '@hexhaven/engine';
import type { FishBenefit, Seat } from '@hexhaven/shared';
import { oldBootPassTargets, ownActiveKnightEdges, ownWagons, tbOf } from './tbHelpers';

export type TbControlReason =
  | 'notYourTurn'
  | 'notMainPhase'
  | 'cantAfford'
  | 'noLegalTargets'
  | 'notHeld'
  | 'noTarget'
  | 'voteNotOpen'
  | 'notResolvedYet';

export interface TbControlState {
  enabled: boolean;
  reason?: TbControlReason;
  /** Only set alongside `reason: 'cantAfford'` — what's short and by how much (a single unit, e.g.
   *  fish/coins/grain — every T&B cost here is a flat scalar, unlike the base resource bundles). */
  missing?: { unit: string; need: number; have: number };
}

const ENABLED: TbControlState = { enabled: true };

function turnGate(state: GameState, seat: Seat): TbControlState | null {
  if (state.turn.player !== seat) return { enabled: false, reason: 'notYourTurn' };
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notMainPhase' };
  return null;
}

// ---- Fishermen (§TB2.4/§TB2.5) ------------------------------------------------------------------

/** `exchangeFish` button enablement: turn/phase gate, then fish holdings vs. the benefit's fixed
 *  cost (`FISH_EXCHANGE_COST`). Does not check the benefit's OWN extra legality (e.g. `steal` needs a
 *  candidate adjacent to the robber, `freeRoad` needs a legal edge) — callers that offer those
 *  sub-pickers gate the confirm button on the picker itself having a valid selection. */
export function computeExchangeFishState(view: PlayerView, seat: Seat, benefit: FishBenefit): TbControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  const cost = FISH_EXCHANGE_COST[benefit];
  const held = tbOf(view)?.fish?.[seat] ?? 0;
  if (held < cost) return { enabled: false, reason: 'cantAfford', missing: { unit: 'fish', need: cost, have: held } };
  return ENABLED;
}

/** `passOldBoot` button: turn/phase gate, then the seat must hold the boot AND have >=1 legal
 *  trailing-or-tied target. */
export function computePassOldBootState(view: PlayerView, seat: Seat): TbControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  if (tbOf(view)?.oldBoot !== seat) return { enabled: false, reason: 'notHeld' };
  return oldBootPassTargets(view, seat).length === 0 ? { enabled: false, reason: 'noTarget' } : ENABLED;
}

// ---- Rivers (§TB3.2/§TB3.3) ---------------------------------------------------------------------

/** `buildBridge` button: turn/phase gate, a legal river edge, then afford 2 brick + 1 lumber. */
export function computeBuildBridgeState(view: PlayerView, seat: Seat): TbControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  if (legalBridgeEdges(state, seat).length === 0) return { enabled: false, reason: 'noLegalTargets' };
  const player = state.players[seat];
  for (const [res, need] of Object.entries(RIVERS_BRIDGE_COST) as [keyof typeof RIVERS_BRIDGE_COST, number][]) {
    const have = player?.resources[res] ?? 0;
    if (have < need) return { enabled: false, reason: 'cantAfford', missing: { unit: res, need, have } };
  }
  return ENABLED;
}

/** `tradeCoins` button: turn/phase gate, then coins held vs. the CURRENT rate (2:1 -> 4:1 cliff). */
export function computeTradeCoinsState(view: PlayerView, seat: Seat): TbControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  const rate = riversCoinTradeRate(state);
  const held = tbOf(view)?.coins?.[seat] ?? 0;
  if (held < rate) return { enabled: false, reason: 'cantAfford', missing: { unit: 'coins', need: rate, have: held } };
  return ENABLED;
}

// ---- Caravans (§TB4.2) ---------------------------------------------------------------------------

/** `caravanVote` bid submit: only while the vote's `pending` list still names this seat. */
export function computeCaravanVoteState(view: PlayerView, seat: Seat): TbControlState {
  return view.phase.kind === 'caravanVote' && view.phase.pending.includes(seat)
    ? ENABLED
    : { enabled: false, reason: 'voteNotOpen' };
}

/** `placeCamel`: only for the vote's resolved winner, once `pending` is empty, and only if a route
 *  edge is still open. */
export function computePlaceCamelState(view: PlayerView, seat: Seat): TbControlState {
  if (view.phase.kind !== 'caravanVote') return { enabled: false, reason: 'voteNotOpen' };
  if (view.phase.pending.length > 0) return { enabled: false, reason: 'notResolvedYet' };
  if (view.phase.winner !== seat) return { enabled: false, reason: 'notHeld' };
  const state = view as unknown as GameState;
  return legalCamelEdges(state).length === 0 ? { enabled: false, reason: 'noLegalTargets' } : ENABLED;
}

/** How many camels are still in the physical supply (§TB4.1) — display only. */
export function camelsRemaining(view: PlayerView): number {
  return CARAVANS_CAMEL_SUPPLY - (tbOf(view)?.camels?.length ?? 0);
}

// ---- Barbarian Attack (§TB5.2) -------------------------------------------------------------------

/** `recruitKnight` button: turn/phase gate, a legal own-network edge, then afford 1 grain/wool/ore. */
export function computeRecruitKnightState(view: PlayerView, seat: Seat): TbControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  if (legalKnightRecruitEdges(state, seat).length === 0) return { enabled: false, reason: 'noLegalTargets' };
  const player = state.players[seat];
  for (const [res, need] of Object.entries(KNIGHT_COST) as [keyof typeof KNIGHT_COST, number][]) {
    const have = player?.resources[res] ?? 0;
    if (have < need) return { enabled: false, reason: 'cantAfford', missing: { unit: res, need, have } };
  }
  return ENABLED;
}

/** `moveBarbarianKnight` button: turn/phase gate, then the seat must own at least one active knight
 *  (board-mode `tbMovingKnight` resolves per-target legality/extension cost itself). */
export function computeMoveKnightState(view: PlayerView, seat: Seat): TbControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  return ownActiveKnightEdges(view, seat).length === 0 ? { enabled: false, reason: 'noLegalTargets' } : ENABLED;
}

// ---- The main scenario (§TB6.2) -------------------------------------------------------------------

/** `moveWagon` button: turn/phase gate, then the seat must own at least one wagon. */
export function computeMoveWagonState(view: PlayerView, seat: Seat): TbControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  return ownWagons(view, seat).length === 0 ? { enabled: false, reason: 'noLegalTargets' } : ENABLED;
}

/** Every destination `seat`'s wagon #`wagonIndex` can reach this turn (§TB6.2), for the in-panel
 *  destination list (mirrors `legalWagonDestinations`'s own shape — re-exported here only so callers
 *  don't need the `as unknown as GameState` cast themselves). */
export function wagonDestinations(view: PlayerView, seat: Seat, wagonIndex: number) {
  return legalWagonDestinations(view as unknown as GameState, seat, wagonIndex);
}
