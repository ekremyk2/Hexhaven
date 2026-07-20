// toastFormat.ts — pure event -> toast-plan logic (task requirement 5), mirroring
// `robber/toastFormat.ts`'s split: this module only decides WHICH toast variant applies and what
// data it needs; `DevCardsPanel.tsx`'s effect does the actual `t()` calls + `pushToast`. Kept
// i18n-free and React-free so it's directly testable with scripted `ViewerEvent`s.
//
// `log/formatEvent.ts` (T-407, already landed) already turns these same three event types into
// game-log lines — this module is NOT a duplicate of that. It exists because two things the task
// asks for aren't in the log: (1) opponents' plays/buys as a transient toast, not just a permanent
// log line, and (2) the Monopoly per-seat breakdown ("Ali 3, Veli 2, Ayşe 0"), which
// `log.monopolyResolved` deliberately keeps to a single aggregate line.
import type { ViewerEvent } from '@hexhaven/engine';
import type { AnyDevCardId, CardModComboId, ResourceType, Seat } from '@hexhaven/shared';

export type DevPlayedEvent = Extract<ViewerEvent, { type: 'devPlayed' }>;
export type DevBoughtEvent = Extract<ViewerEvent, { type: 'devBought' }>;
export type MonopolyResolvedEvent = Extract<ViewerEvent, { type: 'monopolyResolved' }>;

/**
 * Requirement 5 ("Opponent perspective"): `devPlayed` toasts only ever cover an OPPONENT's play —
 * the viewer already knows what they themselves just played from their own click, so `null` when
 * `ev.seat === mySeat`. `card` is never redacted for `devPlayed` (unlike `devBought`): everyone
 * always learns which card type was played the instant it's played.
 */
export function planDevPlayedToast(
  ev: DevPlayedEvent,
  mySeat: Seat
): { seat: Seat; card: AnyDevCardId | CardModComboId } | null {
  if (ev.seat === mySeat) return null;
  return { seat: ev.seat, card: ev.card };
}

/**
 * Requirement 5: `devBought` toasts only ever cover an OPPONENT's buy, and the type is never
 * present for a non-buyer viewer (`redact.ts`'s `RedactedDevBought`) — render what arrives, per the
 * task's own instruction, rather than assuming a `card` field exists.
 */
export function planDevBoughtToast(ev: DevBoughtEvent, mySeat: Seat): { seat: Seat } | null {
  if (ev.seat === mySeat) return null;
  return { seat: ev.seat };
}

export interface MonopolyToastPlan {
  /** `self` when the viewer is the one who played Monopoly ("You collected…"); `other` otherwise
   * ("{{name}}'s Monopoly collected…"). Shown to EVERY viewer (including the actor) — unlike
   * `devPlayed`/`devBought` above, this is the one dev-card toast the actor also wants to see (task
   * requirement 4's "result toast" after confirming). */
  variant: 'self' | 'other';
  seat: Seat;
  resource: ResourceType;
  total: number;
  /** Every OTHER seat's contribution, in the event's own order (already excludes the actor —
   * `playMonopoly`, packages/engine/src/phases/devCards.ts, never includes the actor in `taken`). */
  breakdown: { seat: Seat; count: number }[];
}

export function planMonopolyToast(ev: MonopolyResolvedEvent, mySeat: Seat): MonopolyToastPlan {
  const total = ev.taken.reduce((sum, t) => sum + t.count, 0);
  return {
    variant: ev.seat === mySeat ? 'self' : 'other',
    seat: ev.seat,
    resource: ev.resource,
    total,
    breakdown: ev.taken,
  };
}
