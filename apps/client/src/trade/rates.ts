// Pure trade logic (T-404): rate lookups + ER-4 validation, kept separate from the presentational
// dialogs the same way `controls/actionBarLogic.ts` splits pure enablement logic from `ActionBar`
// — directly testable, and reused by both the bank dialog and its tests.
//
// WIRE: T-204 — same `PlayerView`-as-`GameState` cast `controls/actionBarLogic.ts`/`store/uiMode.ts`
// document: legal-move/rate enumeration is about the ACTING seat's own choices (never a hidden
// opponent hand), so treating the view as a full engine `GameState` here is safe.
import { bankTradeOptions } from '@hexhaven/engine';
import type { GameState, PlayerView } from '@hexhaven/engine';
import { bundleTotal, hasAtLeast } from '@hexhaven/shared';
import type { ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';

export interface BankRateOption {
  rate: 2 | 3 | 4;
  /** The seat currently holds >= `rate` of this resource. */
  affordable: boolean;
  /** The bank has none of this resource left to give out (independent of `give`'s rate/stock). */
  bankEmpty: boolean;
}

/** R8.2 rate badge (2:1/3:1/4:1) + affordability per resource, for the bank dialog's give picker,
 * plus whether the bank can currently supply each resource (for the receive picker). */
export function bankRateOptions(view: PlayerView, seat: Seat): Record<ResourceType, BankRateOption> {
  const state = view as unknown as GameState;
  const raw = bankTradeOptions(state, seat);
  const out = {} as Record<ResourceType, BankRateOption>;
  for (const res of Object.keys(raw) as ResourceType[]) {
    out[res] = { ...raw[res], bankEmpty: (view.bank[res] ?? 0) <= 0 };
  }
  return out;
}

/** Why the domestic offer builder's Send button is currently blocked (ER-4/R8.1) — mirrors
 * `offerTrade`'s own validation order (engine `phases/main.ts`) so the inline message never
 * disagrees with what the server would reject. `null` = the offer is legal to send. */
export type OfferBlockReason = 'emptyGive' | 'emptyReceive' | 'overlap' | 'cantAfford';

export function validateOffer(
  give: ResourceBundle,
  receive: ResourceBundle,
  ownResources: Record<ResourceType, number>
): OfferBlockReason | null {
  if (bundleTotal(give) === 0) return 'emptyGive';
  if (bundleTotal(receive) === 0) return 'emptyReceive';
  const overlaps = (Object.keys(give) as ResourceType[]).some(
    (res) => (give[res] ?? 0) > 0 && (receive[res] ?? 0) > 0
  );
  if (overlaps) return 'overlap';
  if (!hasAtLeast(ownResources, give)) return 'cantAfford';
  return null;
}

/** Every seat other than the offer's owner (R8.1: any of them may respond), in seat order. */
export function respondingSeats(view: PlayerView, ownerSeat: Seat): Seat[] {
  return view.players.map((p) => p.seat).filter((s) => s !== ownerSeat);
}
