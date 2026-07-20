// Pure discard-modal math (T-405 requirement 1/6): per-resource stepper bounds, the exact-N
// confirm gate, and the "auto" quick-fill. Mirrors `apps/server/src/timers.ts`'s
// `autoDiscardBundle` (T-206 §3: "largest counts first, ties by resource order") so the manual
// quick-fill button and the server's own timeout auto-discard land on the same result for the same
// hand — kept as an independent copy here (not imported) since apps/server is a different app and
// this task's file allowlist is scoped to src/robber/**.
import type { ResourceBundle, ResourceType } from '@hexhaven/shared';

/** R6.1's resource order (docs/01 preamble) — also the tie-break order for `autoDiscardBundle`. */
export const RESOURCE_PRIORITY: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

/** Sum of a (possibly sparse) selection bundle — how many cards are currently picked. */
export function selectionTotal(selection: ResourceBundle): number {
  return Object.values(selection).reduce((sum: number, n) => sum + (n ?? 0), 0);
}

/** Confirm gates open ONLY at exactly the owed count (never over, never under) — the client-side
 * half of keeping `BAD_DISCARD_COUNT` from ever reaching the server (task requirement 1). */
export function canConfirmDiscard(selection: ResourceBundle, required: number): boolean {
  return required > 0 && selectionTotal(selection) === required;
}

/** Adjusts one resource's picked count by +/-1, clamped to `[0, cap]` (cap = that resource's hand
 * count). Drops the key entirely at 0 so the resulting bundle is always `ResourceBundleSchema`-
 * clean (no zero-value keys) and ready to send as-is on confirm. */
export function stepSelection(
  selection: ResourceBundle,
  resource: ResourceType,
  delta: 1 | -1,
  cap: number,
): ResourceBundle {
  const current = selection[resource] ?? 0;
  const next = Math.min(cap, Math.max(0, current + delta));
  if (next === current) return selection;
  if (next === 0) {
    const rest = { ...selection };
    delete rest[resource];
    return rest;
  }
  return { ...selection, [resource]: next };
}

/**
 * "Auto" quick-fill (task requirement 1): discard `owed` cards, one at a time, always from
 * whichever resource is CURRENTLY the largest pile — ties broken by `RESOURCE_PRIORITY`
 * (brick→lumber→wool→grain→ore), same rule T-206's server-side auto-discard timeout uses.
 */
export function autoDiscardBundle(hand: Record<ResourceType, number>, owed: number): ResourceBundle {
  const counts: Record<ResourceType, number> = { ...hand };
  const bundle: ResourceBundle = {};
  let remaining = owed;
  while (remaining > 0) {
    let pick: ResourceType | null = null;
    for (const r of RESOURCE_PRIORITY) {
      if (counts[r] > 0 && (pick === null || counts[r] > counts[pick])) pick = r;
    }
    if (!pick) break; // defensive: hand can't actually run out before `owed` is reached
    counts[pick] -= 1;
    bundle[pick] = (bundle[pick] ?? 0) + 1;
    remaining -= 1;
  }
  return bundle;
}
