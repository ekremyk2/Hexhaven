// Seafarers gold fields (T-703, docs/rules/seafarers-rules.md §S9/ER-S7). A gold hex produces on its
// number like any hex, but the owner of each adjacent building CHOOSES which resource(s) to receive:
// any of the 5 base resources, 1 per adjacent settlement / 2 per adjacent city. There is no gold
// resource card (S9.2). Because it is a per-player decision, a roll that lands on a gold hex enters a
// `chooseGoldResource` sub-phase (like `discard`) that blocks the turn until every owed player picks
// (ER-S7). Bank-shortage rules (R5.3/S9.3) still apply — a player can only take what the bank holds.
//
// Wired through the seafarers module: the `afterAction` hook opens the sub-phase after a producing
// roll (index.ts), and `chooseGoldResourceHandler` resolves each player's picks.

import { bundleTotal, hasAtLeast } from '@hexhaven/shared';
import type { EngineErrorCode, GameEvent, GameState, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { goldChosen } from '../../events.js';
import { geometryForState } from '../index.js';
import { hexTerrainOf } from './state.js';

const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/** A full Seat-keyed record (Phase.chooseGoldResource.owed needs every seat present). */
function zeroSeatAmounts(): Record<Seat, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function bankTotal(state: GameState): number {
  return RESOURCE_TYPES.reduce((sum, r) => sum + state.bank[r], 0);
}

/**
 * S9.1: per-seat gold entitlement for a dice `total` — 1 per adjacent settlement, 2 per adjacent
 * city on any gold hex whose token matches (and which the robber isn't blocking, S9.3/R5.2). Returns
 * the owed map + the pending seats (those owed ≥1). Empty for a base game (no gold hexes).
 */
export function computeGoldOwed(
  state: GameState,
  total: number
): { pending: Seat[]; owed: Record<Seat, number> } {
  const owed = zeroSeatAmounts();
  let any = false;
  for (const hex of geometryForState(state).hexes) {
    if (hex.id === state.board.robber) continue; // R5.2/S9.3: robber blocks its hex
    if (hexTerrainOf(state, hex.id) !== 'gold') continue;
    const tile = state.board.hexes[hex.id];
    if (!tile || tile.token !== total) continue;
    for (const vId of hex.vertices) {
      for (const p of state.players) {
        const level = p.cities.includes(vId) ? 2 : p.settlements.includes(vId) ? 1 : 0;
        if (level > 0) {
          owed[p.seat] += level;
          any = true;
        }
      }
    }
  }
  if (!any) return { pending: [], owed };
  const pending = state.players.filter((p) => owed[p.seat] > 0).map((p) => p.seat);
  return { pending, owed };
}

/** How many cards `seat` must pick this gold choice: their entitlement, capped by what the bank can
 *  still supply right now (R5.3 — a player takes what remains). */
export function goldPickCount(state: GameState, seat: Seat): number {
  if (state.phase.kind !== 'chooseGoldResource') return 0;
  return Math.min(state.phase.owed[seat], bankTotal(state));
}

/**
 * `chooseGoldResource` sub-phase (S9/ER-S7): any pending seat may submit (reduce.ts exempts it from
 * the turn-owner guard via the module's `isActorAllowed`). `picks` must sum to the seat's owed count
 * — or to what the bank can still supply, whichever is smaller (S9.3) — and no pick may exceed the
 * bank's current stock of that resource. Applies the picks, then returns to `main` once all resolve.
 */
export function chooseGoldResourceHandler(state: GameState, seat: Seat, picks: ResourceBundle): EngineResult {
  if (state.phase.kind !== 'chooseGoldResource') return fail('WRONG_PHASE', 'not in the chooseGoldResource phase');
  const phase = state.phase;
  if (!phase.pending.includes(seat)) {
    return fail('NOT_YOUR_TURN', `seat ${seat} does not owe a gold choice right now (S9/ER-S7)`);
  }

  const mustPick = goldPickCount(state, seat);
  const offered = bundleTotal(picks);
  if (offered !== mustPick) {
    return fail(
      'BAD_GOLD_COUNT',
      `seat ${seat} must choose exactly ${mustPick} gold resource(s), offered ${offered}`
    );
  }
  // R5.3/S9.3: every picked resource must come out of the bank's current stock.
  if (!hasAtLeast(state.bank, picks)) {
    return fail('BANK_EMPTY', 'the bank cannot supply the chosen gold resources (R5.3/S9.3)');
  }

  const bank = { ...state.bank };
  const players = state.players.map((p) => {
    if (p.seat !== seat) return p;
    const resources = { ...p.resources };
    for (const res of RESOURCE_TYPES) {
      const amt = picks[res] ?? 0;
      resources[res] += amt;
      bank[res] -= amt;
    }
    return { ...p, resources };
  });

  const pending = phase.pending.filter((s) => s !== seat);
  const events: GameEvent[] = [goldChosen(seat, { ...picks })];
  const nextPhase = pending.length > 0 ? { ...phase, pending } : ({ kind: 'main' } as const);
  return { ok: true, state: { ...state, bank, players, phase: nextPhase }, events };
}
