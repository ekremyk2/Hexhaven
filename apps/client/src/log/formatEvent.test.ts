import { describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import type { ViewerEvent } from '@hexhaven/engine';
import enLog from '../i18n/en/log.json';
import trLog from '../i18n/tr/log.json';
import { formatEvent } from './formatEvent';
import { SAMPLE_VIEWER_EVENTS } from './testEvents';

const VIEWER = 0 as Seat;

/** Looks up a dotted key path (e.g. "stolen.actor") in a parsed locale JSON tree. */
function lookupKey(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, segment) => {
    if (node && typeof node === 'object' && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, tree);
}

describe('formatEvent (T-407 requirement 1: every GameEvent -> a localized log line)', () => {
  it('covers every sample event type with at least one entry', () => {
    for (const [name, ev] of Object.entries(SAMPLE_VIEWER_EVENTS)) {
      const entries = formatEvent(ev, VIEWER);
      expect(entries.length, `${name} produced no entries`).toBeGreaterThan(0);
    }
  });

  it('every returned key resolves to a non-empty string in BOTH en and tr (extends the parity guard)', () => {
    for (const [name, ev] of Object.entries(SAMPLE_VIEWER_EVENTS)) {
      for (const entry of formatEvent(ev, VIEWER)) {
        const enValue = lookupKey(enLog, entry.key);
        const trValue = lookupKey(trLog, entry.key);
        expect(typeof enValue, `${name} -> log.${entry.key} missing in en`).toBe('string');
        expect(enValue, `${name} -> log.${entry.key} empty in en`).not.toBe('');
        expect(typeof trValue, `${name} -> log.${entry.key} missing in tr`).toBe('string');
        expect(trValue, `${name} -> log.${entry.key} empty in tr`).not.toBe('');
      }
    }
  });

  it('every icon is a non-empty string', () => {
    for (const ev of Object.values(SAMPLE_VIEWER_EVENTS)) {
      for (const entry of formatEvent(ev, VIEWER)) {
        expect(entry.icon.length).toBeGreaterThan(0);
      }
    }
  });

  it('diceRolled sums both dice into "total"', () => {
    const [entry] = formatEvent(SAMPLE_VIEWER_EVENTS.diceRolled!, VIEWER);
    expect(entry!.params).toMatchObject({ d1: 3, d2: 6, total: 9 });
  });

  it('production emits one entry per gain PLUS one shortage entry (not a single aggregated line)', () => {
    const entries = formatEvent(SAMPLE_VIEWER_EVENTS.production!, VIEWER);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.key).toBe('production.gain');
    expect(entries[1]!.key).toBe('production.shortage');
  });

  it('discardRequired emits one entry per pending seat', () => {
    const manySeats: ViewerEvent = {
      type: 'discardRequired',
      seats: [
        { seat: 0 as Seat, amount: 4 },
        { seat: 2 as Seat, amount: 5 },
      ],
    };
    const entries = formatEvent(manySeats, VIEWER);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.params.amount).toBe(4);
    expect(entries[1]!.params.amount).toBe(5);
  });

  it('monopolyResolved sums every taken count into a single resource total', () => {
    const [entry] = formatEvent(SAMPLE_VIEWER_EVENTS.monopolyResolved!, VIEWER);
    expect(entry!.params.resources).toEqual({ $resourceCount: { resource: 'grain', count: 5 } });
  });

  describe('stolen: redaction-aware variant picked by comparing to the viewer\'s own seat', () => {
    it('picks stolen.actor when the viewer is the thief', () => {
      const [entry] = formatEvent(SAMPLE_VIEWER_EVENTS.stolenActor!, 0 as Seat);
      expect(entry!.key).toBe('stolen.actor');
    });

    it('picks stolen.viewer when the viewer is the victim', () => {
      const [entry] = formatEvent(SAMPLE_VIEWER_EVENTS.stolenViewer!, 0 as Seat);
      expect(entry!.key).toBe('stolen.viewer');
    });

    it('picks stolen.other (redacted, no resource param) when the viewer is neither', () => {
      const [entry] = formatEvent(SAMPLE_VIEWER_EVENTS.stolenOther!, VIEWER);
      expect(entry!.key).toBe('stolen.other');
      expect(entry!.params.resource).toBeUndefined();
    });
  });

  describe('discarded: full vs redacted shape picks self vs other', () => {
    it('discarded.self when the full `cards` bundle is present', () => {
      const [entry] = formatEvent(SAMPLE_VIEWER_EVENTS.discardedSelf!, VIEWER);
      expect(entry!.key).toBe('discarded.self');
    });

    it('discarded.other when only a redacted `count` is present', () => {
      const [entry] = formatEvent(SAMPLE_VIEWER_EVENTS.discardedOther!, VIEWER);
      expect(entry!.key).toBe('discarded.other');
      expect(entry!.params.count).toBe(3);
    });
  });

  describe('devBought: full vs redacted shape picks self vs other', () => {
    it('devBought.self when the full `card` is present', () => {
      const [entry] = formatEvent(SAMPLE_VIEWER_EVENTS.devBoughtSelf!, VIEWER);
      expect(entry!.key).toBe('devBought.self');
    });

    it('devBought.other when `card` is redacted away', () => {
      const [entry] = formatEvent(SAMPLE_VIEWER_EVENTS.devBoughtOther!, VIEWER);
      expect(entry!.key).toBe('devBought.other');
    });
  });

  it('awardMoved picks the *Cleared key only when holder is null', () => {
    const held = formatEvent(SAMPLE_VIEWER_EVENTS.awardMovedLongestRoad!, VIEWER)[0]!;
    const cleared = formatEvent(SAMPLE_VIEWER_EVENTS.awardMovedLongestRoadCleared!, VIEWER)[0]!;
    expect(held.key).toBe('awardMoved.longestRoad');
    expect(cleared.key).toBe('awardMoved.longestRoadCleared');
    expect(cleared.params).toEqual({});
  });

  it('gameWon reads the total off vpBreakdown defensively', () => {
    const [entry] = formatEvent(SAMPLE_VIEWER_EVENTS.gameWon!, VIEWER);
    expect(entry!.params.vp).toBe(10);

    const malformed: ViewerEvent = { type: 'gameWon', seat: 0 as Seat, vpBreakdown: 'not-an-object' };
    expect(formatEvent(malformed, VIEWER)[0]!.params.vp).toBe(0);
  });

  it('throws a BUG error for an unknown event type (the never-check\'s runtime half)', () => {
    const bogus = { type: 'notARealEvent' } as unknown as ViewerEvent;
    expect(() => formatEvent(bogus, VIEWER)).toThrow(/BUG/);
  });
});
