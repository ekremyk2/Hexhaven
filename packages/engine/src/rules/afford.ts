// Cost helpers (R7.1): can a player pay a bundle, and applying a payment to the bank.

import type { GameState, PlayerState, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';

/** Does the player hold at least `cost` of every resource in the bundle? */
export function canAfford(player: PlayerState, cost: ResourceBundle): boolean {
  for (const res of Object.keys(cost) as ResourceType[]) {
    if (player.resources[res] < (cost[res] ?? 0)) return false;
  }
  return true;
}

/**
 * Move `cost` from the paying seat's hand to the bank, returning fresh `players`/`bank` (never
 * mutates state). Caller must have checked `canAfford` first.
 */
export function payToBank(
  state: GameState,
  seat: Seat,
  cost: ResourceBundle
): { players: PlayerState[]; bank: GameState['bank'] } {
  const bank = { ...state.bank };
  const players = state.players.map((p) => {
    if (p.seat !== seat) return p;
    const resources = { ...p.resources };
    for (const res of Object.keys(cost) as ResourceType[]) {
      const amt = cost[res] ?? 0;
      resources[res] -= amt;
      bank[res] += amt;
    }
    return { ...p, resources };
  });
  return { players, bank };
}
