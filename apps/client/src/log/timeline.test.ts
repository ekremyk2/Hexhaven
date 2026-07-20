import { describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import type { ViewerEvent } from '@hexhaven/engine';
import { buildTimeline } from './timeline';

const VIEWER = 0 as Seat;

describe('buildTimeline (T-407 requirement 2: turn separators)', () => {
  it('emits no separator before the first turnEnded', () => {
    const events: ViewerEvent[] = [{ type: 'diceRolled', seat: 0 as Seat, roll: [3, 4] }];
    const nodes = buildTimeline(events, VIEWER);
    expect(nodes.every((n) => n.kind === 'entry')).toBe(true);
  });

  it('inserts a separator right after turnEnded, naming the NEXT seat and incrementing the turn number', () => {
    const events: ViewerEvent[] = [
      { type: 'diceRolled', seat: 0 as Seat, roll: [3, 4] },
      { type: 'turnEnded', seat: 0 as Seat, next: 1 as Seat },
      { type: 'diceRolled', seat: 1 as Seat, roll: [2, 2] },
    ];
    const nodes = buildTimeline(events, VIEWER);
    expect(nodes.map((n) => n.kind)).toEqual(['entry', 'entry', 'separator', 'entry']);
    const separator = nodes[2]!;
    if (separator.kind !== 'separator') throw new Error('expected a separator node');
    expect(separator.turnNumber).toBe(2);
    expect(separator.seat).toBe(1);
  });

  it('increments the turn counter once per turnEnded across multiple turns', () => {
    const events: ViewerEvent[] = [
      { type: 'turnEnded', seat: 0 as Seat, next: 1 as Seat },
      { type: 'turnEnded', seat: 1 as Seat, next: 2 as Seat },
      { type: 'turnEnded', seat: 2 as Seat, next: 3 as Seat },
    ];
    const separators = buildTimeline(events, VIEWER).filter((n) => n.kind === 'separator');
    expect(separators.map((s) => (s.kind === 'separator' ? s.turnNumber : null))).toEqual([2, 3, 4]);
  });

  it('assigns each entry node a stable, unique id', () => {
    const events: ViewerEvent[] = [
      { type: 'production', gains: [{ seat: 0 as Seat, resources: { brick: 1 } }], shortages: [] },
    ];
    const nodes = buildTimeline(events, VIEWER);
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
