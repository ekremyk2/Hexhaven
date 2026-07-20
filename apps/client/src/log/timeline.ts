// Groups the flat `ViewerEvent[]` log into renderable nodes with turn separators (T-407
// requirement 2: "— Turn 12, Ali —"). Purely structural — no i18n here; `LogPanel.tsx` calls
// `resolveLogParams`/`t()` per node when it renders. A separator is inserted right after each
// `turnEnded` event, naming the seat about to act next; the running turn counter starts at 1 (the
// game's first turn, before any `turnEnded` has fired) and increments once per `turnEnded`.
import type { Seat } from '@hexhaven/shared';
import type { ViewerEvent } from '@hexhaven/engine';
import { formatEvent } from './formatEvent';
import type { LogEntry } from './formatEvent';

export type TimelineNode =
  | ({ kind: 'entry'; id: string } & LogEntry)
  | { kind: 'separator'; id: string; turnNumber: number; seat: Seat };

export function buildTimeline(events: ViewerEvent[], mySeat: Seat): TimelineNode[] {
  const nodes: TimelineNode[] = [];
  let turnNumber = 1;

  events.forEach((ev, i) => {
    formatEvent(ev, mySeat).forEach((entry, j) => {
      nodes.push({ kind: 'entry', id: `${i}-${j}`, ...entry });
    });
    if (ev.type === 'turnEnded') {
      turnNumber += 1;
      nodes.push({ kind: 'separator', id: `sep-${i}`, turnNumber, seat: ev.next });
    }
  });

  return nodes;
}
