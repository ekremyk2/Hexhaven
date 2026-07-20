import { describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import { resolveLogParams } from './logParams';
import type { TFunction } from './logParams';

// A tiny fake `t` that mimics i18next just enough for this module: pluralized `resource.*` keys
// interpolate `{{count}}`, everything else returns a recognizable placeholder.
const fakeT: TFunction = (key, params) => {
  if (key.startsWith('resource.')) {
    const resource = key.slice('resource.'.length);
    return `${params?.count} ${resource}`;
  }
  if (key.startsWith('resourceName.')) return key.slice('resourceName.'.length);
  if (key.startsWith('devCard.')) return `[${key.slice('devCard.'.length)}]`;
  return key;
};

const seatName = (seat: Seat) => `Seat${seat}`;

describe('resolveLogParams (T-407 requirement 1: tagged params -> final t() params)', () => {
  it('passes plain strings/numbers through unchanged', () => {
    expect(resolveLogParams(fakeT, seatName, { total: 9, label: 'x' })).toEqual({ total: 9, label: 'x' });
  });

  it('resolves a $seat tag via the seatName callback', () => {
    expect(resolveLogParams(fakeT, seatName, { name: { $seat: 2 as Seat } })).toEqual({ name: 'Seat2' });
  });

  it('resolves a $bundle tag into a comma-joined, canonically-ordered, nonzero-only list', () => {
    const out = resolveLogParams(fakeT, seatName, {
      resources: { $bundle: { ore: 1, brick: 2, wool: 0 } },
    });
    // Canonical order is brick, lumber, wool, grain, ore (per RESOURCE_ORDER) — brick before ore —
    // and `wool: 0` is dropped entirely.
    expect(out.resources).toBe('2 brick, 1 ore');
  });

  it('resolves a $resourceCount tag through the pluralized resource key', () => {
    const out = resolveLogParams(fakeT, seatName, {
      resources: { $resourceCount: { resource: 'grain', count: 5 } },
    });
    expect(out.resources).toBe('5 grain');
  });

  it('resolves a $resourceNames tag into a bare, canonically-ordered, deduplicated list', () => {
    const out = resolveLogParams(fakeT, seatName, {
      resources: { $resourceNames: ['ore', 'brick', 'ore'] },
    });
    expect(out.resources).toBe('brick, ore');
  });

  it('resolves a $devCard tag through the devCard key', () => {
    expect(resolveLogParams(fakeT, seatName, { card: { $devCard: 'knight' } })).toEqual({ card: '[knight]' });
  });
});
