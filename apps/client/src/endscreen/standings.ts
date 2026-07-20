// Pure VP-standings computation for the end screen (T-408 requirement 1). Builds one row per seat
// from a `PlayerView` + the game's event log:
//
// - The viewer's OWN seat always gets the full breakdown (`hud/vp.ts`'s `computeOwnVp`) — the
//   viewer always knows their own hidden VP cards, win or lose.
// - The WINNER's seat (docs/01 R13.2: hidden VP cards are revealed "all at once when you win")
//   gets the `gameWon` event's `vpBreakdown` — that event is never redacted for other viewers
//   (`redact.ts`'s `ViewerEvent` only strips `discarded`/`stolen`/`devBought`), so every seat can
//   read the winner's real total once it arrives in the store's event log.
// - Every other seat stops at the public breakdown (`hud/vp.ts`'s `computePublicVp`) — the
//   redacted `PlayerView` never carries anyone else's hidden card count in the first place
//   (docs/02 §6), so there is nothing more to reveal for a losing opponent.
import type { OtherPlayerView, OwnPlayerView, PlayerView, PlayerViewEntry, ViewerEvent, VpBreakdown } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { computeExtraVp, computeOwnVp, computePublicVp } from '../hud/vp';

export interface StandingRow {
  seat: Seat;
  settlements: number;
  cities: number;
  longestRoad: 0 | 2;
  largestArmy: 0 | 2;
  /** `null` = not revealed to this viewer (a losing opponent that isn't the viewer). */
  vpCards: number | null;
  total: number;
  isWinner: boolean;
  isSelf: boolean;
}

function isOtherPlayerView(p: PlayerViewEntry): p is OtherPlayerView {
  return 'resourceCount' in p;
}

function isVpBreakdown(x: unknown): x is VpBreakdown {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as Partial<VpBreakdown>).total === 'number' &&
    typeof (x as Partial<VpBreakdown>).settlements === 'number' &&
    typeof (x as Partial<VpBreakdown>).cities === 'number' &&
    typeof (x as Partial<VpBreakdown>).vpCards === 'number'
  );
}

/**
 * Finds the most recent `gameWon` event in the store's event log and returns its (validated)
 * `vpBreakdown`, or `null` if none has arrived yet (defensive only — in normal play this event is
 * emitted in the same `game.events` batch that flips `phase.kind` to `'ended'`, reduce.ts).
 */
export function findWonBreakdown(events: ViewerEvent[]): VpBreakdown | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev && typeof ev === 'object' && 'type' in ev && (ev as { type: unknown }).type === 'gameWon') {
      const breakdown: unknown = (ev as { vpBreakdown: unknown }).vpBreakdown;
      if (isVpBreakdown(breakdown)) return breakdown;
    }
  }
  return null;
}

/**
 * One row per seat in `view.players`, ranked by (each viewer's own knowledge of) total VP
 * descending, seat ascending on ties. `winner` comes from `view.phase` (caller checks
 * `phase.kind === 'ended'` first); `wonBreakdown` from `findWonBreakdown(events)`.
 */
export function buildStandings(view: PlayerView, winner: Seat, wonBreakdown: VpBreakdown | null): StandingRow[] {
  const rows = view.players.map((entry): StandingRow => {
    const isWinnerSeat = entry.seat === winner;
    // The modifier/C&K award VP the engine's `computeVp` counts but the base client breakdown omits
    // (harbormaster +2, metropolis/defender/merchant) — folded into `total` on every non-authoritative
    // row so a self-winner's standings total matches the engine (B-38). The winner row that has
    // `wonBreakdown` already carries the authoritative engine total, so it doesn't add this.
    const extra = computeExtraVp(view, entry.seat);

    if (entry.seat === view.me && !isOtherPlayerView(entry)) {
      const vp = computeOwnVp(entry as OwnPlayerView, view.awards);
      return {
        seat: entry.seat,
        settlements: vp.settlements,
        cities: vp.cities,
        longestRoad: vp.longestRoad,
        largestArmy: vp.largestArmy,
        vpCards: vp.vpCards,
        total: vp.totalWithHidden + extra,
        isWinner: isWinnerSeat,
        isSelf: true,
      };
    }

    const pub = computePublicVp(entry, view.awards);

    if (isWinnerSeat && wonBreakdown) {
      return {
        seat: entry.seat,
        settlements: wonBreakdown.settlements,
        cities: wonBreakdown.cities,
        longestRoad: wonBreakdown.longestRoad,
        largestArmy: wonBreakdown.largestArmy,
        vpCards: wonBreakdown.vpCards,
        total: wonBreakdown.total,
        isWinner: true,
        isSelf: false,
      };
    }

    return {
      seat: entry.seat,
      settlements: pub.settlements,
      cities: pub.cities,
      longestRoad: pub.longestRoad,
      largestArmy: pub.largestArmy,
      vpCards: null,
      total: pub.total + extra,
      isWinner: isWinnerSeat,
      isSelf: false,
    };
  });

  return rows.sort((a, b) => b.total - a.total || a.seat - b.seat);
}
