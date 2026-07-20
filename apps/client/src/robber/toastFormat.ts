// Pure event -> toast-plan logic (T-405 requirement 4, ER-9/ER-10). Kept i18n-free and React-free
// on purpose: `RobberOverlay.tsx`'s effect does the `t()` calls + `pushToast`, this module only
// decides WHICH of the three redaction variants applies and what data it needs, so it's directly
// testable with scripted `ViewerEvent`s (no i18next bootstrap required).
import { bundleTotal } from '@hexhaven/shared';
import type { ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import type { ViewerEvent } from '@hexhaven/engine';

export type DiscardedEvent = Extract<ViewerEvent, { type: 'discarded' }>;
export type StolenEvent = Extract<ViewerEvent, { type: 'stolen' }>;

export type DiscardToastPlan =
  | { variant: 'self'; cards: ResourceBundle }
  | { variant: 'other'; seat: Seat; count: number };

/**
 * `discarded` ER-9: the discarder sees their own types (`self`); everyone else sees a bare count
 * (`other`) — true whether the event already arrived pre-redacted (`{ seat, count }`, the normal
 * case for a non-owner viewer) or arrived full (a scripted test, or a future viewer-is-discarder
 * edge case), so this checks `ev.seat === mySeat` first rather than trusting shape alone.
 */
export function planDiscardToast(ev: DiscardedEvent, mySeat: Seat): DiscardToastPlan {
  if ('cards' in ev && ev.seat === mySeat) return { variant: 'self', cards: ev.cards };
  const count = 'count' in ev ? ev.count : bundleTotal(ev.cards);
  return { variant: 'other', seat: ev.seat, count };
}

export type StealToastPlan =
  | { variant: 'thief'; victim: Seat; card: ResourceType }
  | { variant: 'victim'; thief: Seat; card: ResourceType }
  | { variant: 'other'; thief: Seat; victim: Seat };

/**
 * `stolen` ER-10 (`stolen(from: victim, to: thief, card)`, see `packages/engine/src/events.ts`):
 * the thief and the victim both see the real `card`; everyone else sees only that a card changed
 * hands (`other`), never which one.
 */
export function planStealToast(ev: StolenEvent, mySeat: Seat): StealToastPlan {
  if ('card' in ev && mySeat === ev.to) return { variant: 'thief', victim: ev.from, card: ev.card };
  if ('card' in ev && mySeat === ev.from) return { variant: 'victim', thief: ev.to, card: ev.card };
  return { variant: 'other', thief: ev.to, victim: ev.from };
}
