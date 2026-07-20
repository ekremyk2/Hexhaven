// Resolves the tagged param values `formatEvent.ts` produces into the plain strings/numbers
// i18next needs to interpolate a log line (T-407 requirement 1). Kept separate from
// formatEvent.ts so the formatter itself stays pure (no `t`, no seat->name lookup) and this one
// small function is the only place that touches translation — easy to unit-test with a fake `t`.
import type { ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import type { LogParamValue } from './formatEvent';

/** Minimal shape of the `t()` this module needs — matches `useTranslation('log').t`. */
export type TFunction = (key: string, params?: Record<string, unknown>) => string;

const RESOURCE_ORDER: ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

function bundleList(t: TFunction, resources: ResourceBundle): string {
  return RESOURCE_ORDER.filter((r) => (resources[r] ?? 0) > 0)
    .map((r) => t(`resource.${r}`, { count: resources[r] }))
    .join(', ');
}

/** `shortages` is already a de-duplicated per-roll set of types, but de-dupe defensively and
 * keep the canonical resource order regardless of input order. */
function resourceNameList(t: TFunction, types: ResourceType[]): string {
  const present = new Set(types);
  return RESOURCE_ORDER.filter((r) => present.has(r))
    .map((r) => t(`resourceName.${r}`))
    .join(', ');
}

export function resolveLogParams(
  t: TFunction,
  seatName: (seat: Seat) => string,
  params: Record<string, LogParamValue>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number') {
      out[key] = value;
    } else if ('$seat' in value) {
      out[key] = seatName(value.$seat);
    } else if ('$bundle' in value) {
      out[key] = bundleList(t, value.$bundle);
    } else if ('$resourceCount' in value) {
      out[key] = t(`resource.${value.$resourceCount.resource}`, { count: value.$resourceCount.count });
    } else if ('$resourceNames' in value) {
      out[key] = resourceNameList(t, value.$resourceNames);
    } else if ('$devCard' in value) {
      out[key] = t(`devCard.${value.$devCard}`);
    }
  }
  return out;
}
